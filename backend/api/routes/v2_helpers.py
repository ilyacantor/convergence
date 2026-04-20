"""
Shared helpers for v2 route files — engagement_id / tenant_id resolution.

Every v2 endpoint that needs an engagement context must use these helpers.
No hardcoded UUIDs anywhere in route handlers.

Two paths:
  1. engagement_id provided → EngagementData (preferred, generic two-entity)
  2. tenant_id only → legacy path (backward compat, uses get_active_engagement)
"""

from fastapi import HTTPException

from backend.engine.engagement import get_active_engagement
from backend.engine.engagement_data import EngagementData
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)


def resolve_tenant_id(tenant_id: str | None) -> str:
    """Validate tenant_id is explicitly provided. 422 if missing."""
    if tenant_id:
        return tenant_id
    raise HTTPException(
        status_code=422,
        detail={
            "error": "MISSING_REQUIRED_FIELD",
            "field": "tenant_id",
            "message": (
                "tenant_id is required. Pass ?tenant_id=<UUID> explicitly. "
                "No implicit resolution — the caller must know which tenant."
            ),
        },
    )


def resolve_pipeline_run_id(pipeline_run_id: str | None) -> str | None:
    """Return pipeline_run_id if provided, None otherwise.

    When None, callers use is_active=true filtering instead of run_id scoping.
    This supports multi-batch ingests where triples are spread across
    multiple run_ids but all share is_active=true.
    """
    return pipeline_run_id if pipeline_run_id else None


def resolve_tenant_and_run(
    tenant_id: str | None,
    pipeline_run_id: str | None,
) -> tuple[str, str | None]:
    """Validate tenant_id (required). pipeline_run_id is optional."""
    tid = resolve_tenant_id(tenant_id)
    rid = resolve_pipeline_run_id(pipeline_run_id)
    return tid, rid


def resolve_engagement_or_tenant(
    engagement_id: str | None,
    tenant_id: str | None,
    pipeline_run_id: str | None,
) -> tuple[EngagementData | None, str, str | None]:
    """Resolve context from engagement_id (preferred) or tenant_id (legacy).

    Returns (engagement_data_or_none, tenant_id, pipeline_run_id).
    When engagement_id is provided, constructs EngagementData and derives tenant_id.
    When only tenant_id is provided, returns None for EngagementData (legacy path).
    422 if neither is provided.
    """
    rid = resolve_pipeline_run_id(pipeline_run_id)

    if engagement_id:
        try:
            eng_data = EngagementData(engagement_id)
        except ValueError as e:
            raise HTTPException(status_code=422, detail={"error": "INVALID_ENGAGEMENT", "message": str(e)})
        return eng_data, eng_data.tenant_id, rid

    if tenant_id:
        return None, tenant_id, rid

    raise HTTPException(
        status_code=422,
        detail={
            "error": "MISSING_REQUIRED_FIELD",
            "message": (
                "Either engagement_id or tenant_id is required. "
                "engagement_id is preferred for generic two-entity routing."
            ),
        },
    )


def build_identity_context(
    tenant_id: str,
    pipeline_run_id: str | None,
    eng_data: EngagementData | None = None,
) -> dict:
    """Build the identity context dict required on every API response (I2).

    Returns tenant_id, pipeline_run_id, engagement_id, entity_pair, run_name,
    entity_a_name, entity_b_name.
    """
    if eng_data:
        cfg = eng_data.config
    else:
        cfg = get_active_engagement()
    run_name = f"{cfg.short_name}-{pipeline_run_id[:4]}" if pipeline_run_id else cfg.short_name
    return {
        "tenant_id": tenant_id,
        "pipeline_run_id": pipeline_run_id,
        "engagement_id": cfg.engagement_id,
        "entity_pair": [cfg.entity_a.id, cfg.entity_b.id],
        "entity_a_name": cfg.entity_a.display_name,
        "entity_b_name": cfg.entity_b.display_name,
        "run_name": run_name,
    }
