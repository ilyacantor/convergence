"""
Engagement API — canonical engagement CRUD + legacy compat endpoints.

POST-MOVE: All engagement state lives in Convergence's engagements table.
Platform (Maestra) and Console read via these endpoints. No proxy to Platform.

Keeps GET /engagement/active for DCL/NLQ/ReportPortal backwards compat.
"""

import os
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.db import engagement_store
from backend.db.triple_store import TripleStore
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

PLATFORM_URL = (
    os.environ.get("PLATFORM_URL")
    or os.environ.get("MAESTRA_BASE_URL")
    or "http://localhost:8006"
).rstrip("/")

router = APIRouter(prefix="/api/convergence", tags=["engagement"])

_triple_store = TripleStore()


# ── Request models ──────────────────────────────────────────────────────────

class CreateEngagementRequest(BaseModel):
    tenant_id: str
    acquirer_entity_id: str
    target_entity_id: str
    engagement_type: str = "MA"
    engagement_short_name: str | None = None
    state: dict = Field(default_factory=dict)
    engagement_id: str | None = None


class UpdateEngagementRequest(BaseModel):
    lifecycle_stage: str | None = None
    state: dict | None = None
    engagement_short_name: str | None = None


class CreateRunStepRequest(BaseModel):
    tenant_id: str
    step_name: str
    idempotency_key: str
    inputs_hash: str
    upstream_deps: list[str] | None = None


class UpdateRunStepRequest(BaseModel):
    status: str
    outputs_ref: str | None = None
    error: str | None = None


class CreateReviewRequest(BaseModel):
    tenant_id: str
    action: str
    context: dict = Field(default_factory=dict)
    tier: int = 3
    requested_by: str = "maestra"


class UpdateReviewRequest(BaseModel):
    status: str
    by: str
    reason: str | None = None


# ── Engagement CRUD ─────────────────────────────────────────────────────────

@router.post("/engagements")
async def create_engagement(req: CreateEngagementRequest):
    """Create a new engagement."""
    return engagement_store.create_engagement(
        tenant_id=req.tenant_id,
        acquirer_entity_id=req.acquirer_entity_id,
        target_entity_id=req.target_entity_id,
        engagement_type=req.engagement_type,
        engagement_short_name=req.engagement_short_name,
        state=req.state,
        engagement_id=req.engagement_id,
    )


@router.get("/engagements")
async def list_engagements(
    tenant_id: UUID = Query(..., description="Tenant UUID (required, I2)"),
    lifecycle_stage: str | None = Query(None),
):
    """List engagements for tenant. Returns flat array."""
    return engagement_store.list_engagements(
        tenant_id=str(tenant_id),
        lifecycle_stage=lifecycle_stage,
    )


@router.get("/engagements/active")
async def get_active_engagement(
    tenant_id: UUID = Query(..., description="Tenant UUID (required, I2)"),
):
    """Return the active engagement for a tenant. 404 if none, 422 if tenant_id missing."""
    eng = engagement_store.get_active_engagement(str(tenant_id))
    if not eng:
        raise HTTPException(
            status_code=404,
            detail=f"No active engagement for tenant_id={tenant_id}",
        )
    return eng


@router.get("/engagements/{engagement_id}")
async def get_engagement_by_id(engagement_id: str):
    """Return engagement details by ID."""
    eng = engagement_store.get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")
    return eng


@router.patch("/engagements/{engagement_id}")
async def update_engagement(engagement_id: str, req: UpdateEngagementRequest):
    """Update engagement lifecycle_stage, state, or short_name."""
    result = engagement_store.update_engagement(
        engagement_id=engagement_id,
        lifecycle_stage=req.lifecycle_stage,
        state=req.state,
        engagement_short_name=req.engagement_short_name,
    )
    if not result:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")
    return result


@router.delete("/engagements/{engagement_id}")
async def delete_engagement(engagement_id: str):
    """Delete engagement by ID."""
    deleted = engagement_store.delete_engagement(engagement_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")
    return {"deleted": True, "engagement_id": engagement_id}


# ── Run Ledger ──────────────────────────────────────────────────────────────

@router.post("/engagements/{engagement_id}/runs")
async def create_run_step(engagement_id: str, req: CreateRunStepRequest):
    """Record a pipeline run step with idempotency."""
    return engagement_store.record_run_step(
        tenant_id=req.tenant_id,
        engagement_id=engagement_id,
        step_name=req.step_name,
        idempotency_key=req.idempotency_key,
        inputs_hash=req.inputs_hash,
        upstream_deps=req.upstream_deps,
    )


@router.get("/engagements/{engagement_id}/runs")
async def list_run_steps(engagement_id: str, status: str | None = None):
    """List run ledger steps for an engagement."""
    return engagement_store.list_run_steps(engagement_id, status=status)


@router.get("/runs/{step_id}")
async def get_run_step(step_id: str):
    """Get a single run ledger step by ID."""
    step = engagement_store.get_run_step(step_id)
    if not step:
        raise HTTPException(status_code=404, detail=f"Run step not found: {step_id}")
    return step


@router.patch("/runs/{step_id}")
async def update_run_step(step_id: str, req: UpdateRunStepRequest):
    """Update run step status."""
    return engagement_store.update_run_step(
        step_id=step_id,
        status=req.status,
        outputs_ref=req.outputs_ref,
        error=req.error,
    )


# ── Human Reviews ───────────────────────────────────────────────────────────

@router.post("/engagements/{engagement_id}/reviews")
async def create_review(engagement_id: str, req: CreateReviewRequest):
    """Create a human review request."""
    return engagement_store.create_review(
        tenant_id=req.tenant_id,
        engagement_id=engagement_id,
        action=req.action,
        context=req.context,
        tier=req.tier,
        requested_by=req.requested_by,
    )


@router.get("/engagements/{engagement_id}/reviews")
async def list_reviews(engagement_id: str, status: str | None = None):
    """List reviews for an engagement."""
    return engagement_store.list_reviews(engagement_id, status_filter=status)


@router.get("/engagements/{engagement_id}/reviews/pending")
async def list_pending_reviews(engagement_id: str):
    """List pending reviews for an engagement."""
    return engagement_store.list_reviews(engagement_id, status_filter="pending")


@router.patch("/reviews/{review_id}")
async def update_review(review_id: str, req: UpdateReviewRequest):
    """Update a review (approve or reject)."""
    return engagement_store.update_review(
        review_id=review_id,
        status=req.status,
        by=req.by,
        reason=req.reason,
    )


# ── Legacy compat: GET /engagement/active (DCL, NLQ, ReportPortal) ──────────

@router.get("/engagement/active")
async def get_engagement_active_compat(
    tenant_id: str = Query(None),
):
    """Legacy endpoint for DCL/NLQ/ReportPortal.

    Returns enriched engagement config. tenant_id is optional here for
    backwards compat — if missing, discovers from convergence_tenant_runs.
    New callers should use GET /engagements/active?tenant_id=X instead.
    """
    resolved_tenant_id = tenant_id
    if not resolved_tenant_id:
        resolved_tenant_id = _triple_store.get_active_tenant_id()
    if not resolved_tenant_id:
        raise HTTPException(
            status_code=422,
            detail="No active tenant — no convergence_tenant_runs row and no tenant_id param",
        )

    eng = engagement_store.get_active_engagement(resolved_tenant_id)
    if not eng:
        raise HTTPException(
            status_code=404,
            detail=f"No active engagement for tenant_id={resolved_tenant_id}",
        )

    state = eng.get("state", {})

    result = {
        "tenant_id": resolved_tenant_id,
        "engagement_id": eng["engagement_id"],
        "engagement_short_name": eng.get("engagement_short_name"),
        "deal_name": state.get("deal_name", ""),
        "entity_pair": [eng["acquirer_entity_id"], eng["target_entity_id"]],
        "entity_a": {
            "id": eng["acquirer_entity_id"],
            "display_name": state.get("entity_a_name", eng["acquirer_entity_id"]),
            "role": "acquirer",
            "business_model": state.get("entity_a_business_model", ""),
            "source_systems": state.get("entity_a_source_systems", {}),
        },
        "entity_b": {
            "id": eng["target_entity_id"],
            "display_name": state.get("entity_b_name", eng["target_entity_id"]),
            "role": "target",
            "business_model": state.get("entity_b_business_model", ""),
            "source_systems": state.get("entity_b_source_systems", {}),
        },
        "deal_parameters": state.get("deal_parameters", {}),
        "synergy_targets": state.get("synergy_targets", {}),
    }

    try:
        result["current_pipeline_run_id"] = _triple_store.get_current_run_id(resolved_tenant_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "NO_PIPELINE_RUN", "message": str(exc)},
        )

    return result


# ── Engagement Monitor endpoints ─────────────────────────────────────────────
# These serve the EngagementMonitor UI. Convergence-local — no Platform dependency.


@router.get("/status")
async def engagement_status():
    """Engagement system status — active engagement, review counts."""
    tenant_id = _triple_store.get_active_tenant_id()
    active = None
    pending_reviews = 0
    if tenant_id:
        active = engagement_store.get_active_engagement(tenant_id)
        if active:
            reviews = engagement_store.list_reviews(
                active["engagement_id"], status_filter="pending",
            )
            pending_reviews = len(reviews)

    return {
        "status": "operational",
        "active_engagement": active,
        "pending_reviews_count": pending_reviews,
    }


@router.get("/run-stats/{engagement_id}")
async def run_stats(engagement_id: str, step_name: str = Query(None)):
    """Aggregate run stats for an engagement — triple counts, conflicts, mappings."""
    from backend.core.db import get_connection

    eng = engagement_store.get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement {engagement_id} not found")

    tenant_id = eng["tenant_id"]

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Triple counts by domain
            cur.execute(
                "SELECT split_part(concept, '.', 1) AS domain, COUNT(*) "
                "FROM convergence_triples "
                "WHERE is_active = true AND tenant_id = %s::uuid "
                "GROUP BY domain ORDER BY COUNT(*) DESC",
                (tenant_id,),
            )
            domain_breakdown = {row[0]: row[1] for row in cur.fetchall()}
            triple_count = sum(domain_breakdown.values())
            domain_count = len(domain_breakdown)

            # Entity count
            cur.execute(
                "SELECT COUNT(DISTINCT entity_id) FROM convergence_triples "
                "WHERE is_active = true AND tenant_id = %s::uuid",
                (tenant_id,),
            )
            entity_count = cur.fetchone()[0]

            # Conflict stats
            cur.execute(
                "SELECT "
                "  COUNT(DISTINCT concept) AS total, "
                "  COUNT(DISTINCT CASE WHEN property = 'resolution_status' "
                "    AND value #>> '{}' = 'resolved' THEN concept END) AS resolved "
                "FROM convergence_triples "
                "WHERE is_active = true AND split_part(concept, '.', 1) = 'cofa_conflict' "
                "  AND tenant_id = %s::uuid",
                (tenant_id,),
            )
            cr = cur.fetchone()
            conflict_count = cr[0] if cr else 0
            conflicts_resolved = cr[1] if cr else 0

            # Mapped count
            cur.execute(
                "SELECT COUNT(DISTINCT concept) FROM convergence_triples "
                "WHERE is_active = true AND split_part(concept, '.', 1) = 'cofa_mapping' "
                "  AND tenant_id = %s::uuid",
                (tenant_id,),
            )
            mapped_count = cur.fetchone()[0]

            # Source run tag
            cur.execute(
                "SELECT DISTINCT source_run_tag FROM convergence_triples "
                "WHERE is_active = true AND tenant_id = %s::uuid "
                "  AND source_run_tag IS NOT NULL "
                "ORDER BY source_run_tag DESC LIMIT 1",
                (tenant_id,),
            )
            tag_row = cur.fetchone()

    return {
        "source_run_tag": tag_row[0] if tag_row else None,
        "triple_count": triple_count,
        "domain_count": domain_count,
        "entity_count": entity_count,
        "domain_breakdown": domain_breakdown,
        "conflict_count": conflict_count,
        "conflicts_resolved": conflicts_resolved,
        "conflicts_pending": conflict_count - conflicts_resolved,
        "mapped_count": mapped_count,
        "resolved_count": conflicts_resolved,
    }


# ── COFA chat proxy to Platform/Maestra ─────────────────────────────────────

@router.post("/maestra/cofa-chat")
async def cofa_chat(request: Request):
    """Proxy COFA chat to Platform's Maestra endpoint.

    Maestra's chat handler stays in Platform. This is a pass-through.
    """
    body = await request.json()
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{PLATFORM_URL}/api/maestra/cofa-chat",
                json=body,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Cannot reach Platform at {PLATFORM_URL}/api/maestra/cofa-chat — {e}",
            )
    return resp.json()
