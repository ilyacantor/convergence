"""
Verify Route
============
POST /api/convergence/verify

Pipeline verification step — runs after COFA unification.
Verifies combined data integrity for both entities.
"""

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.core.db import get_connection
from backend.engine.engagement import get_active_engagement
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence", tags=["Verify"])


class VerifyRequest(BaseModel):
    cofa_run_id: str
    pipeline_run_id: str
    tenant_id: Optional[str] = None


@router.post(
    "/verify",
    summary="Pipeline verification step",
    description=(
        "Verifies that COFA unification produced valid combined data "
        "for both entities. Returns verify_id on success."
    ),
)
async def verify_cofa(req: VerifyRequest):
    """Verify COFA output — both entities must have active triples."""
    eng = get_active_engagement()
    entity_a_id = eng.entity_a.id
    entity_b_id = eng.entity_b.id

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT entity_id, COUNT(*) FROM convergence_triples "
                "WHERE entity_id IN (%s, %s) AND is_active = true "
                "GROUP BY entity_id",
                (entity_a_id, entity_b_id),
            )
            counts = {row[0]: row[1] for row in cur.fetchall()}

    missing = []
    if entity_a_id not in counts or counts[entity_a_id] == 0:
        missing.append(entity_a_id)
    if entity_b_id not in counts or counts[entity_b_id] == 0:
        missing.append(entity_b_id)

    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Verification failed — no active triples for: "
                f"{', '.join(missing)}. "
                f"cofa_run_id={req.cofa_run_id}"
            ),
        )

    verify_id = str(uuid.uuid4())

    logger.info(
        "[VERIFY] Complete — verify_id=%s, cofa_run_id=%s, "
        "entity_a=%s (%d triples), entity_b=%s (%d triples)",
        verify_id, req.cofa_run_id,
        entity_a_id, counts.get(entity_a_id, 0),
        entity_b_id, counts.get(entity_b_id, 0),
    )

    return {
        "verify_id": verify_id,
        "cofa_run_id": req.cofa_run_id,
        "pipeline_run_id": req.pipeline_run_id,
        "entity_pair": [entity_a_id, entity_b_id],
        "entity_triple_counts": counts,
        "status": "verified",
    }
