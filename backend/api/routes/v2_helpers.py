"""
Shared helpers for v2 route files — tenant_id and pipeline_run_id validation.

Every v2 endpoint that needs a tenant_id or pipeline_run_id must use these
helpers. No hardcoded UUIDs anywhere in route handlers.

Pattern: explicit param required -> 422 if missing.
No silent fallback. No engagement_state guessing. No "most recent" lookup.
"""

from fastapi import HTTPException

from backend.engine.engagement import get_active_engagement
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


def build_identity_context(tenant_id: str, pipeline_run_id: str | None) -> dict:
    """Build the identity context dict required on every API response (I2).

    Returns tenant_id, pipeline_run_id, engagement_id, entity_pair, run_name.
    """
    eng = get_active_engagement()
    run_name = f"{eng.short_name}-{pipeline_run_id[:4]}" if pipeline_run_id else eng.short_name
    return {
        "tenant_id": tenant_id,
        "pipeline_run_id": pipeline_run_id,
        "engagement_id": eng.engagement_id,
        "entity_pair": [eng.entity_a.id, eng.entity_b.id],
        "run_name": run_name,
    }
