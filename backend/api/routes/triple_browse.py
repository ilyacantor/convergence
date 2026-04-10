"""
Triple browse endpoints — NLQ-facing read-side API for convergence_triples.

Response schemas match DCL's /api/dcl/triples/* endpoints exactly so NLQ
can route between DCL (SE mode) and Convergence (ME mode) transparently.
"""

import datetime
import json
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.core.db import PoolExhausted, get_connection
from backend.db.triple_store import TripleStore
from backend.engine.engagement import get_active_engagement
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/triples", tags=["Triples Browse"])

_triple_store = TripleStore()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_value(val: Any) -> Any:
    """Convert PG types to JSON-safe primitives matching DCL's serialization."""
    if val is None:
        return None
    if isinstance(val, UUID):
        return str(val)
    if isinstance(val, datetime.datetime):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, memoryview):
        return bytes(val).decode("utf-8")
    return val


def _serialize_triple(row: dict) -> dict:
    """Serialize a convergence_triples row to match DCL's browse response shape."""
    return {k: _serialize_value(v) for k, v in row.items()}


def _run_id_clause(tenant_id: str, pipeline_run_id: str | None) -> tuple[str, list]:
    """Build WHERE clause scoping to current run.

    If pipeline_run_id is provided, scope to that run directly.
    Otherwise, use the current_run_id pointer from convergence_tenant_runs.
    """
    if pipeline_run_id:
        return "tenant_id = %s AND run_id = %s", [tenant_id, pipeline_run_id]
    return (
        "tenant_id = %s AND run_id IN "
        "(SELECT current_run_id FROM convergence_tenant_runs WHERE tenant_id = %s)",
        [tenant_id, tenant_id],
    )


# ---------------------------------------------------------------------------
# GET /api/convergence/triples/browse
# ---------------------------------------------------------------------------

@router.get("/browse")
async def browse_triples(
    tenant_id: str = Query(..., description="Tenant UUID (required, I2)"),
    pipeline_run_id: Optional[str] = Query(None, description="Pipeline run UUID — defaults to current run"),
    domain: Optional[str] = Query(None, description="Filter by concept domain prefix"),
    entity_id: Optional[str] = Query(None, description="Filter by entity_id"),
    period: Optional[str] = Query(None, description="Filter by period"),
    property: Optional[str] = Query(None, description="Filter by property"),
    limit: int = Query(50, ge=1, le=500, description="Page size"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
):
    """Browse convergence triples with optional filters.

    Response schema matches DCL's GET /api/dcl/triples/browse exactly.
    """
    base_clause, params = _run_id_clause(tenant_id, pipeline_run_id)
    clauses = [base_clause]

    filters_applied: dict[str, str] = {}
    if domain:
        clauses.append("concept LIKE %s")
        params.append(f"{domain}.%")
        filters_applied["domain"] = domain
    if entity_id:
        clauses.append("entity_id = %s")
        params.append(entity_id)
        filters_applied["entity_id"] = entity_id
    if period:
        clauses.append("period = %s")
        params.append(period)
        filters_applied["period"] = period
    if property:
        clauses.append("property = %s")
        params.append(property)
        filters_applied["property"] = property

    where = " AND ".join(clauses)

    count_sql = f"SELECT COUNT(*) FROM convergence_triples WHERE {where}"
    fetch_sql = (
        f"SELECT DISTINCT ON (entity_id, concept, property, period) * "
        f"FROM convergence_triples WHERE {where} "
        f"ORDER BY entity_id, concept, property, period, created_at DESC "
        f"LIMIT %s OFFSET %s"
    )

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(count_sql, params)
                total_count = cur.fetchone()[0]

                cur.execute(fetch_sql, params + [limit, offset])
                columns = [desc[0] for desc in cur.description]
                triples = [
                    _serialize_triple(dict(zip(columns, row)))
                    for row in cur.fetchall()
                ]
    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")

    return {
        "triples": triples,
        "total_count": total_count,
        "filters_applied": filters_applied,
    }


# ---------------------------------------------------------------------------
# POST /api/convergence/triples/browse-batch
# ---------------------------------------------------------------------------

class BrowseBatchRequest(BaseModel):
    domains: list[str]
    entity_ids: Optional[list[str]] = None
    period: Optional[str] = None
    per_domain_limit: Optional[int] = None


@router.post("/browse-batch")
async def browse_triples_batch(
    body: BrowseBatchRequest,
    tenant_id: str = Query(..., description="Tenant UUID (required, I2)"),
    pipeline_run_id: Optional[str] = Query(None, description="Pipeline run UUID — defaults to current run"),
):
    """Batch browse convergence triples by domain list.

    Response schema matches DCL's POST /api/dcl/triples/browse-batch exactly.

    When ``per_domain_limit`` is set, each domain returns at most that many
    rows ordered by period DESC (most recent first). Without a limit the full
    result set is returned, which can be expensive for large tenants.
    """
    base_clause, base_params = _run_id_clause(tenant_id, pipeline_run_id)

    triples_by_domain: dict[str, list[dict]] = {}
    total_count = 0
    domains_returned: list[str] = []

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                for domain in body.domains:
                    clauses = [base_clause, "concept LIKE %s"]
                    params = list(base_params) + [f"{domain}.%"]

                    if body.entity_ids:
                        placeholders = ", ".join(["%s"] * len(body.entity_ids))
                        clauses.append(f"entity_id IN ({placeholders})")
                        params.extend(body.entity_ids)
                    if body.period:
                        clauses.append("period = %s")
                        params.append(body.period)

                    where = " AND ".join(clauses)
                    if body.per_domain_limit is not None:
                        sql = (
                            f"SELECT DISTINCT ON (entity_id, concept, property, period) * "
                            f"FROM convergence_triples WHERE {where} "
                            f"ORDER BY entity_id, concept, property, period, period DESC, created_at DESC "
                            f"LIMIT %s"
                        )
                        params = params + [body.per_domain_limit]
                    else:
                        sql = (
                            f"SELECT DISTINCT ON (entity_id, concept, property, period) * "
                            f"FROM convergence_triples WHERE {where} "
                            f"ORDER BY entity_id, concept, property, period, created_at DESC"
                        )
                    cur.execute(sql, params)
                    columns = [desc[0] for desc in cur.description]
                    rows = [
                        _serialize_triple(dict(zip(columns, row)))
                        for row in cur.fetchall()
                    ]
                    triples_by_domain[domain] = rows
                    total_count += len(rows)
                    if rows:
                        domains_returned.append(domain)
    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")

    return {
        "triples_by_domain": triples_by_domain,
        "total_count": total_count,
        "domains_requested": body.domains,
        "domains_returned": domains_returned,
    }


# ---------------------------------------------------------------------------
# GET /api/convergence/triples/overview
# ---------------------------------------------------------------------------

@router.get("/overview")
async def triples_overview(
    tenant_id: str = Query(..., description="Tenant UUID (required, I2)"),
    pipeline_run_id: Optional[str] = Query(None, description="Pipeline run UUID — defaults to current run"),
):
    """Aggregated overview of convergence triples.

    Response schema matches DCL's GET /api/dcl/triples/overview exactly.
    """
    base_clause, base_params = _run_id_clause(tenant_id, pipeline_run_id)

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # Total + active counts
                cur.execute(
                    f"SELECT COUNT(*) FROM convergence_triples WHERE {base_clause}",
                    base_params,
                )
                active_triples = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM convergence_triples WHERE tenant_id = %s", [tenant_id])
                total_triples = cur.fetchone()[0]

                # Per-entity breakdown
                cur.execute(
                    f"SELECT entity_id, COUNT(*) AS triple_count, MAX(created_at) AS latest_ingest "
                    f"FROM convergence_triples WHERE {base_clause} "
                    f"GROUP BY entity_id ORDER BY entity_id",
                    list(base_params),
                )
                entity_rows = cur.fetchall()
                max_ingest = max((r[2] for r in entity_rows), default=None) if entity_rows else None
                entities = [
                    {
                        "entity_id": r[0],
                        "display_name": r[0].replace("_", " ").title() if r[0] else r[0],
                        "triple_count": r[1],
                        "latest_ingest": _serialize_value(r[2]),
                        "is_most_recent": r[2] == max_ingest if max_ingest else False,
                    }
                    for r in entity_rows
                ]

                # Per-domain breakdown with by_entity
                cur.execute(
                    f"SELECT split_part(concept, '.', 1) AS domain, entity_id, COUNT(*) AS cnt "
                    f"FROM convergence_triples WHERE {base_clause} "
                    f"GROUP BY domain, entity_id ORDER BY domain, entity_id",
                    list(base_params),
                )
                domain_map: dict[str, dict[str, int]] = {}
                for row in cur.fetchall():
                    d, eid, cnt = row[0], row[1], row[2]
                    domain_map.setdefault(d, {})[eid] = cnt
                domains = [
                    {
                        "domain": d,
                        "count": sum(by_entity.values()),
                        "by_entity": by_entity,
                    }
                    for d, by_entity in sorted(domain_map.items())
                ]

                # Distinct periods
                cur.execute(
                    f"SELECT DISTINCT period FROM convergence_triples "
                    f"WHERE {base_clause} AND period IS NOT NULL "
                    f"ORDER BY period",
                    list(base_params),
                )
                periods = [r[0] for r in cur.fetchall()]

                # Last ingest from convergence_ingest_log
                cur.execute(
                    "SELECT run_id, created_at, triples_written FROM convergence_ingest_log "
                    "WHERE tenant_id = %s ORDER BY created_at DESC LIMIT 1",
                    [tenant_id],
                )
                ingest_row = cur.fetchone()
                last_ingest = None
                if ingest_row:
                    last_ingest = {
                        "convergence_ingest_id": _serialize_value(ingest_row[0]),
                        "timestamp": _serialize_value(ingest_row[1]),
                        "triple_count": ingest_row[2],
                    }

                # Conflict count (canonical_id not null = resolved conflict)
                cur.execute(
                    f"SELECT COUNT(*) FROM convergence_triples "
                    f"WHERE {base_clause} AND canonical_id IS NOT NULL",
                    list(base_params),
                )
                conflict_count = cur.fetchone()[0]

    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")

    return {
        "total_triples": total_triples,
        "active_triples": active_triples,
        "entities": entities,
        "domains": domains,
        "periods": periods,
        "last_ingest": last_ingest,
        "conflict_count": conflict_count,
    }


# ---------------------------------------------------------------------------
# GET /api/convergence/triples/persona-stats
# ---------------------------------------------------------------------------

_PERSONA_DOMAINS: dict[str, list[str]] | None = None


def _load_persona_domains() -> dict[str, list[str]]:
    global _PERSONA_DOMAINS
    if _PERSONA_DOMAINS is None:
        cfg_path = Path(__file__).resolve().parents[3] / "config" / "persona_domains.yaml"
        with open(cfg_path) as f:
            data = yaml.safe_load(f)
        _PERSONA_DOMAINS = {
            persona: info["domains"]
            for persona, info in data["personas"].items()
        }
    return _PERSONA_DOMAINS


@router.get("/persona-stats")
async def persona_stats():
    """Per-persona domain statistics from convergence triples.

    Response schema matches DCL's GET /api/dcl/triples/persona-stats exactly.
    """
    try:
        persona_map = _load_persona_domains()
        return _triple_store.get_persona_domain_stats(persona_map)
    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")


# ---------------------------------------------------------------------------
# GET /api/convergence/triples/engagement
# ---------------------------------------------------------------------------

@router.get("/engagement")
async def triples_engagement():
    """Engagement metadata in DCL's response shape.

    Returns the simplified engagement structure that NLQ expects from
    DCL's GET /api/dcl/triples/engagement. No shape translation in NLQ.
    """
    eng = get_active_engagement()
    return {
        "engagement_id": eng.engagement_id,
        "entity_a": {
            "id": eng.entity_a.id,
            "display_name": eng.entity_a.display_name,
        },
        "entity_b": {
            "id": eng.entity_b.id,
            "display_name": eng.entity_b.display_name,
        },
        "status": "active",
    }
