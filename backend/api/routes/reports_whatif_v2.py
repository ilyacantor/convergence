"""
V2 What-If + Revenue Bridge routes — data from convergence_triples.

Mounts at /api/convergence/reports/v2:
  POST /api/convergence/reports/v2/whatif/scenario
  POST /api/convergence/reports/v2/whatif/compare
  GET  /api/convergence/reports/v2/whatif/sensitivity
  POST /api/convergence/reports/v2/whatif/save
  GET  /api/convergence/reports/v2/whatif/scenarios
  GET  /api/convergence/reports/v2/whatif/scenarios/{scenario_id}
  GET  /api/convergence/reports/v2/revenue-bridge
  GET  /api/convergence/reports/v2/revenue-bridge/yoy
  GET  /api/convergence/reports/v2/revenue-bridge/combined
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.api.routes.v2_helpers import resolve_engagement_or_tenant, build_identity_context
from backend.core.db import PoolExhausted
from backend.engine.engagement_data import EngagementData
from backend.engine.what_if_v2 import WhatIfEngineV2
from backend.engine.revenue_bridge import RevenueBridgeV2
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/reports/v2", tags=["Reports V2 - What-If & Revenue Bridge"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class AdjustmentItem(BaseModel):
    concept: str
    type: str  # "pct" or "abs"
    value: float


class ScenarioRequest(BaseModel):
    entity_id: str
    period: str
    adjustments: list[AdjustmentItem]


class CompareRequest(BaseModel):
    entity_id: str
    period: str
    scenarios: dict[str, list[AdjustmentItem]]


class SaveScenarioRequest(BaseModel):
    name: str
    entity_id: str
    period: str
    adjustments: list[AdjustmentItem]


# ---------------------------------------------------------------------------
# What-If endpoints
# ---------------------------------------------------------------------------


@router.post("/whatif/scenario")
async def apply_scenario(
    request: ScenarioRequest,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Apply what-if adjustments to a baseline and compute impacts."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        adjustments = [a.model_dump() for a in request.adjustments]
        result = engine.apply_scenario(request.entity_id, request.period, adjustments)
        return {**identity, "entity_id": request.entity_id, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/whatif/compare")
async def compare_scenarios(
    request: CompareRequest,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Compare multiple named scenarios side by side."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        scenarios = {
            name: [a.model_dump() for a in adjs]
            for name, adjs in request.scenarios.items()
        }
        result = engine.compare_scenarios(request.entity_id, request.period, scenarios)
        return {**identity, "entity_id": request.entity_id, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/whatif/sensitivity")
async def sensitivity_analysis(
    entity_id: str = Query(..., description="Entity ID"),
    period: str = "2025-Q1",
    concept: str = "revenue.total",
    range_pct: float = 20.0,
    steps: int = 5,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Vary a single concept and show impact on EBITDA/net income."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        steps_result = engine.sensitivity_analysis(entity_id, period, concept, range_pct, steps)
        return {**identity, "entity_id": entity_id, "steps": steps_result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/whatif/save")
async def save_scenario(
    request: SaveScenarioRequest,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Persist a scenario to the database."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        adjustments = [a.model_dump() for a in request.adjustments]
        scenario_id = engine.save_scenario(
            request.name, request.entity_id, request.period, adjustments,
        )
        return {**identity, "scenario_id": scenario_id, "name": request.name}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/whatif/scenarios")
async def list_scenarios(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """List all saved scenarios."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        scenarios = engine.list_scenarios()
        return {**identity, "scenarios": scenarios}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/whatif/scenarios/{scenario_id}")
async def load_scenario(
    scenario_id: str,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Load a saved scenario and re-apply against current baselines."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        engine = WhatIfEngineV2(eng_data, rid)
        result = engine.load_scenario(scenario_id)
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


# ---------------------------------------------------------------------------
# Revenue Bridge endpoints
# ---------------------------------------------------------------------------


@router.get("/revenue-bridge")
async def get_revenue_bridge(
    entity_id: str = Query(..., description="Entity ID"),
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Revenue bridge between two periods."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        bridge = RevenueBridgeV2(eng_data, rid)
        if period_from is None or period_to is None:
            raise ValueError(
                "Revenue bridge requires 'period_from' and 'period_to' query parameters. "
                "Example: ?entity_id=<entity>&period_from=2024-Q1&period_to=2025-Q1"
            )
        result = bridge.get_revenue_bridge(entity_id, period_from, period_to)
        return {**identity, "entity_id": entity_id, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/revenue-bridge/yoy")
async def get_yoy_bridge(
    entity_id: str = Query(..., description="Entity ID"),
    period: str = "2025-Q1",
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Year-over-year revenue bridge."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        bridge = RevenueBridgeV2(eng_data, rid)
        result = bridge.get_yoy_bridge(entity_id, period)
        return {**identity, "entity_id": entity_id, **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/revenue-bridge/combined")
async def get_combined_revenue_bridge(
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Combined (all entities) revenue bridge."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        from backend.engine.engagement import get_active_engagement
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        bridge = RevenueBridgeV2(eng_data, rid)
        if period_from is None or period_to is None:
            raise ValueError(
                "Combined revenue bridge requires 'period_from' and 'period_to' query parameters."
            )
        result = bridge.get_combined_revenue_bridge(period_from, period_to)
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
