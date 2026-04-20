"""
V2 overlap, cross-sell, and upsell routes — data from convergence_triples.

Mounts at /api/convergence/reports/v2:
  GET /api/convergence/reports/v2/overlap/summary
  GET /api/convergence/reports/v2/overlap/{domain}
  GET /api/convergence/reports/v2/overlap/{domain}/entity-only/{entity_id}
  GET /api/convergence/reports/v2/cross-sell
  GET /api/convergence/reports/v2/cross-sell/summary
  GET /api/convergence/reports/v2/upsell
  GET /api/convergence/reports/v2/upsell/summary
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.routes.v2_helpers import resolve_engagement_or_tenant, build_identity_context
from backend.core.db import PoolExhausted
from backend.engine.cross_sell_v2 import CrossSellEngineV2
from backend.engine.engagement_data import EngagementData
from backend.engine.overlap_v2 import OverlapEngineV2
from backend.engine.upsell_v2 import UpsellEngineV2
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/reports/v2", tags=["Reports V2 Overlap"])


@router.get("/overlap/summary")
async def get_overlap_summary(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Overlap summary across customer/vendor/employee domains."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = OverlapEngineV2(eng_data, rid)
        result = engine.get_overlap_summary()
        return {**identity, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/overlap/{domain}")
async def get_overlap_domain(
    domain: str,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Overlapping concepts with detail for a specific domain."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = OverlapEngineV2(eng_data, rid)
        concepts = engine.get_overlapping_concepts(domain)
        return {**identity, "domain": domain, "overlap_count": len(concepts), "concepts": concepts}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/overlap/{domain}/entity-only/{entity_id}")
async def get_entity_only(
    domain: str,
    entity_id: str,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Concepts in a domain that appear ONLY under the given entity."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = OverlapEngineV2(eng_data, rid)
        only = engine.get_entity_only_concepts(domain, entity_id)
        return {**identity, "entity_id": entity_id, "domain": domain, "count": len(only), "concepts": only}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/cross-sell")
async def get_cross_sell(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Cross-sell opportunities from overlapping customers and service portfolios."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = CrossSellEngineV2(eng_data, rid)
        opportunities = engine.get_cross_sell_opportunities()
        return {**identity, "total": len(opportunities), "opportunities": opportunities}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/cross-sell/summary")
async def get_cross_sell_summary(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Summary of cross-sell opportunities with ACV totals and breakdowns."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = CrossSellEngineV2(eng_data, rid)
        result = engine.get_cross_sell_summary()
        return {**identity, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/upsell")
async def get_upsell(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Upsell opportunities from shared customers and service gap analysis."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = UpsellEngineV2(eng_data, rid)
        opportunities = engine.get_upsell_opportunities()
        return {**identity, "total": len(opportunities), "opportunities": opportunities}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/upsell/summary")
async def get_upsell_summary(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Summary of upsell opportunities with expansion ACV totals and breakdowns."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = UpsellEngineV2(eng_data, rid)
        result = engine.get_upsell_summary()
        return {**identity, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
