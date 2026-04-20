"""
COFA Routes
===========
POST /api/convergence/cofa/unify             — pipeline COFA unification step
POST /api/convergence/cofa/validate-completeness — validate mapping completeness
"""

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional

from backend.core.db import get_connection
from backend.engine.cofa_validation import COFACompletionGate
from backend.engine.engagement import get_active_engagement
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/cofa", tags=["COFA"])

_gate = COFACompletionGate()


class COFAUnifyRequest(BaseModel):
    engagement_id: str
    dcl_ingest_ids: list[str]
    pipeline_run_id: str
    tenant_id: Optional[str] = None


@router.post(
    "/unify",
    summary="Pipeline COFA unification step",
    description=(
        "Verifies per-entity data from both Farm+DCL ingest steps exists, "
        "then marks the COFA stage complete. Returns cofa_run_id and the "
        "DCL ingest IDs that were consumed."
    ),
)
async def cofa_unify(req: COFAUnifyRequest):
    """Pipeline COFA unification — triggered by Console after parallel Farm+DCL.

    Verifies triples exist for both entities in the engagement, generates a
    cofa_run_id, and returns consumed_dcl_ingest_ids for provenance (I3).
    """
    eng = get_active_engagement()
    entity_a_id = eng.entity_a.id
    entity_b_id = eng.entity_b.id

    # Verify both entities have triples from the provided ingest IDs
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT entity_id FROM convergence_triples "
                "WHERE run_id::text = ANY(%s) AND is_active = true "
                "AND entity_id IN (%s, %s)",
                (req.dcl_ingest_ids, entity_a_id, entity_b_id),
            )
            found_entities = {row[0] for row in cur.fetchall()}

    missing = []
    if entity_a_id not in found_entities:
        missing.append(entity_a_id)
    if entity_b_id not in found_entities:
        missing.append(entity_b_id)

    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"COFA unification requires triples for both entities. "
                f"Missing data for: {', '.join(missing)}. "
                f"dcl_ingest_ids checked: {req.dcl_ingest_ids}"
            ),
        )

    cofa_run_id = str(uuid.uuid4())

    logger.info(
        "[COFA] Unification complete — cofa_run_id=%s, engagement=%s, "
        "entities=[%s, %s], consumed_dcl_ingest_ids=%s",
        cofa_run_id, req.engagement_id,
        entity_a_id, entity_b_id, req.dcl_ingest_ids,
    )

    return {
        "cofa_run_id": cofa_run_id,
        "engagement_id": req.engagement_id,
        "entity_pair": [entity_a_id, entity_b_id],
        "consumed_dcl_ingest_ids": req.dcl_ingest_ids,
        "pipeline_run_id": req.pipeline_run_id,
        "status": "unified",
    }


class COFAValidationRequest(BaseModel):
    source_coa: list[dict[str, Any]] = Field(
        ...,
        description="Source chart of accounts. Each item needs at least "
        "'account_number' and 'account_name'.",
    )
    mapping_entries: list[dict[str, Any]] = Field(
        ...,
        description="COFA mapping entries produced by Mai. "
        "Each entry should reference source accounts via "
        "'entity_a_account_number' and/or 'entity_b_account_number'.",
    )
    source_key: str = Field(
        default="account_number",
        description="Field name for the account identifier in source_coa.",
    )


class COFAValidationResponse(BaseModel):
    complete: bool
    source_count: int
    mapped_count: int
    orphaned_accounts: list[dict[str, Any]]
    message: str
    rejection_message: str | None = None


@router.post(
    "/validate-completeness",
    response_model=COFAValidationResponse,
    summary="Validate COFA mapping completeness",
    description=(
        "Checks that every account in the source CoA appears in the mapping. "
        "Returns orphaned accounts if incomplete."
    ),
)
async def validate_cofa_completeness(
    req: COFAValidationRequest,
) -> COFAValidationResponse:
    result = _gate.validate_and_reject(
        source_coa=req.source_coa,
        mapping_entries=req.mapping_entries,
        source_key=req.source_key,
    )
    return COFAValidationResponse(**result)
