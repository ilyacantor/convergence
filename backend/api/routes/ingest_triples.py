"""
Semantic triple ingest endpoint for Convergence (ME).

POST /api/convergence/ingest-triples — batch ingest triples

Contract mirrors DCL's ingest_triples.py so Farm's dcl_triple_pusher.py
can push to either target with the same request shape and query params.
"""

import json
import time
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

from backend.core.db import get_connection
from backend.db.triple_store import TripleStore
from backend.engine.engagement import get_active_engagement
from backend.registry.concept_registry import ConceptRegistry
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Triple Ingest"])

_triple_store = TripleStore()
_concept_registry = ConceptRegistry()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class TriplePayload(BaseModel):
    entity_id: str
    concept: str
    property: str
    value: object
    period: Optional[str] = None
    currency: Optional[str] = "USD"
    unit: Optional[str] = None
    source_system: str
    source_table: Optional[str] = None
    source_field: Optional[str] = None
    pipe_id: Optional[str] = None
    confidence_score: float
    confidence_tier: str
    canonical_id: Optional[str] = None
    resolution_method: Optional[str] = None
    resolution_confidence: Optional[float] = None


class IngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    tenant_id: str
    convergence_ingest_id: str = Field(alias="run_id")
    source_run_tag: Optional[str] = None
    snapshot_name: Optional[str] = None
    triples: list[TriplePayload]


class IngestResponse(BaseModel):
    convergence_ingest_id: str
    tenant_id: str
    engagement_id: str
    entity_ids: list[str]
    run_name: str
    triple_count: int
    concept_summary: dict
    source_rows: int
    triples_written: int
    expansion_factor: float


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_uuid(value: str, field_name: str) -> None:
    """Raise HTTPException if value is not a valid UUID."""
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"'{field_name}' must be a valid UUID. Got: {value!r}",
            },
        )


_VALID_TIERS = {"exact", "high", "medium", "low"}


def _validate_triple(t: TriplePayload, index: int) -> None:
    """Validate a single triple. Raises HTTPException on failure."""
    if not t.entity_id or not t.entity_id.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: entity_id is required and must be non-empty.",
            },
        )

    if not t.concept or not t.concept.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: concept is required and must be non-empty.",
            },
        )

    if not _concept_registry.is_valid_concept(t.concept):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_CONCEPT",
                "message": f"Triple #{index}: concept '{t.concept}' is not a registered concept. "
                           f"Root segment must match a known ontology concept.",
                "concept": t.concept,
            },
        )

    if not t.property or not t.property.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: property is required and must be non-empty.",
            },
        )

    if t.value is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: value is required and must not be null.",
            },
        )

    if not t.source_system or not t.source_system.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: source_system is required and must be non-empty.",
            },
        )

    if not (0.0 <= t.confidence_score <= 1.0):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: confidence_score must be between 0.0 and 1.0. Got: {t.confidence_score}",
            },
        )

    if t.confidence_tier not in _VALID_TIERS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: confidence_tier must be one of {_VALID_TIERS}. Got: {t.confidence_tier!r}",
            },
        )

    if t.resolution_method is not None and t.resolution_method not in {"deterministic", "fuzzy", "manual"}:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": f"Triple #{index}: resolution_method must be deterministic/fuzzy/manual or null. Got: {t.resolution_method!r}",
            },
        )


# ---------------------------------------------------------------------------
# Ingest activity log
# ---------------------------------------------------------------------------

def _record_convergence_ingest_log(
    pipeline_run_id: str,
    tenant_id: str,
    entity_id: str | None,
    source_systems: list[str],
    triples_received: int,
    triples_written: int,
    duration_ms: int,
    triples_rejected: int = 0,
    rejection_reasons: list | None = None,
) -> None:
    """Write a row to convergence_ingest_log. Failure is logged, never raised."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO convergence_ingest_log "
                    "(run_id, entity_id, tenant_id, triples_received, triples_written, "
                    " triples_rejected, rejection_reasons, source_systems, duration_ms) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        pipeline_run_id, entity_id, tenant_id,
                        triples_received, triples_written,
                        triples_rejected,
                        json.dumps(rejection_reasons or []),
                        source_systems,
                        duration_ms,
                    ),
                )
                conn.commit()
    except Exception as e:
        logger.warning(f"[ingest-log] Failed to record ingest log: {e}")


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/convergence/ingest-triples", status_code=201, response_model=IngestResponse)
def ingest_triples(
    req: IngestRequest,
    replace: bool = Query(False),
    append: bool = Query(False),
):
    """
    Batch ingest semantic triples for multi-entity / convergence data.

    - Validates all triples before inserting any (atomic batch).
    - If pipeline_run_id already exists: returns 409 unless ?replace=true or ?append=true.
    - With ?replace=true: deactivates old triples, inserts new ones.
    - With ?append=true: skips idempotency check, adds triples to existing run.
      Use this for multi-batch ingestion where the caller sends the same pipeline_run_id
      across multiple requests (e.g. Farm pushing 18K triples in 1K batches).
    """
    _validate_uuid(req.tenant_id, "tenant_id")
    _validate_uuid(req.convergence_ingest_id, "convergence_ingest_id")

    if not req.triples:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "VALIDATION_FAILED",
                "message": "triples list must not be empty.",
            },
        )

    # Validate every triple BEFORE any DB writes (batch atomicity)
    for i, t in enumerate(req.triples):
        _validate_triple(t, i)

    # Idempotency check — skipped when append=true (multi-batch ingestion)
    run_exists = _triple_store.run_exists(req.convergence_ingest_id)
    if run_exists and not replace and not append:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "RUN_ALREADY_EXISTS",
                "message": f"convergence_ingest_id {req.convergence_ingest_id} already has triples in the store. "
                           "Use ?replace=true to deactivate old triples and re-ingest, "
                           "or ?append=true to add more triples to this run.",
                "convergence_ingest_id": req.convergence_ingest_id,
            },
        )

    if run_exists and replace:
        logger.info(
            f"[ingest-triples] replace=true for existing convergence_ingest_id={req.convergence_ingest_id}; "
            f"inserting new triples, pointer will be updated after insert"
        )

    # Build triple dicts for insertion
    rows = []
    for t in req.triples:
        rows.append({
            "tenant_id": req.tenant_id,
            "entity_id": t.entity_id,
            "concept": t.concept,
            "property": t.property,
            "value": t.value,
            "period": t.period,
            "currency": t.currency,
            "unit": t.unit,
            "source_system": t.source_system,
            "source_table": t.source_table,
            "source_field": t.source_field,
            "pipe_id": t.pipe_id,
            "run_id": req.convergence_ingest_id,  # DB column
            "source_run_tag": req.source_run_tag,
            "confidence_score": t.confidence_score,
            "confidence_tier": t.confidence_tier,
            "canonical_id": t.canonical_id,
            "resolution_method": t.resolution_method,
            "resolution_confidence": t.resolution_confidence,
        })

    triples_received = len(rows)
    entity_ids = sorted({r["entity_id"] for r in rows if r.get("entity_id")})
    source_systems = sorted({r["source_system"] for r in rows if r.get("source_system")})

    start_ts = time.monotonic()
    try:
        if replace:
            count = _triple_store.replace_tenant_triples(str(req.tenant_id), rows)
        else:
            count = _triple_store.insert_triples(rows)
    except Exception as db_err:
        duration_ms = int((time.monotonic() - start_ts) * 1000)
        logger.error(
            f"[ingest-triples] DB write failed after {duration_ms}ms for "
            f"convergence_ingest_id={req.convergence_ingest_id}, tenant_id={req.tenant_id}, "
            f"triples_attempted={triples_received}: {db_err}",
            exc_info=True,
        )
        err_str = str(db_err)
        if "statement timeout" in err_str or "canceling statement" in err_str:
            raise HTTPException(
                status_code=504,
                detail={
                    "error": "INGEST_STATEMENT_TIMEOUT",
                    "message": (
                        f"Triple INSERT timed out after {duration_ms}ms "
                        f"({triples_received} triples). The database statement "
                        f"timeout was exceeded — the batch may be too large for "
                        f"current Supabase PG capacity."
                    ),
                    "triples_attempted": triples_received,
                    "duration_ms": duration_ms,
                },
            )
        raise HTTPException(
            status_code=503,
            detail={
                "error": "INGEST_DB_ERROR",
                "message": f"Database write failed: {err_str[:300]}",
                "triples_attempted": triples_received,
                "duration_ms": duration_ms,
            },
        )
    duration_ms = int((time.monotonic() - start_ts) * 1000)

    # Atomic pointer swap — O(1), single-row UPSERT, no table scan.
    # Not set for append=true (multi-batch ingest keeps existing pointer).
    if not append:
        _triple_store.upsert_tenant_run(
            str(req.tenant_id), str(req.convergence_ingest_id),
            snapshot_name=req.snapshot_name,
        )
        logger.info(
            f"[ingest-triples] convergence_tenant_runs updated: tenant_id={req.tenant_id} "
            f"→ convergence_ingest_id={req.convergence_ingest_id}"
        )

    concept_summary = _triple_store.count_by_domain(req.tenant_id, run_id=req.convergence_ingest_id)

    # Engagement identity context
    eng = get_active_engagement()
    run_name = f"{eng.short_name}-{req.convergence_ingest_id[:4]}"

    logger.info(
        f"[ingest-triples] Ingested {count} triples for convergence_ingest_id={req.convergence_ingest_id}, "
        f"tenant_id={req.tenant_id}, concepts={concept_summary}, duration={duration_ms}ms"
    )

    # Record to convergence_ingest_log — observability only, never fails the ingest
    _record_convergence_ingest_log(
        pipeline_run_id=req.convergence_ingest_id,
        tenant_id=req.tenant_id,
        entity_id=entity_ids[0] if len(entity_ids) == 1 else None,
        source_systems=source_systems,
        triples_received=triples_received,
        triples_written=count,
        duration_ms=duration_ms,
    )

    expansion_factor = round(count / triples_received, 4) if triples_received > 0 else 0.0

    return IngestResponse(
        convergence_ingest_id=req.convergence_ingest_id,
        tenant_id=req.tenant_id,
        engagement_id=eng.engagement_id,
        entity_ids=entity_ids,
        run_name=run_name,
        triple_count=count,
        concept_summary=concept_summary,
        source_rows=triples_received,
        triples_written=count,
        expansion_factor=expansion_factor,
    )
