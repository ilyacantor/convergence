"""
V2 combining financial statement routes — data from convergence_triples.

Mounts at /api/convergence/reports/v2:
  GET /api/convergence/reports/v2/combining/income-statement?period=2025-Q1
  GET /api/convergence/reports/v2/combining/balance-sheet?period=2025-Q1
  GET /api/convergence/reports/v2/combining/cash-flow?period=2025-Q1
  GET /api/convergence/reports/v2/cofa-adjustments?period=2025-Q1
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.routes.v2_helpers import resolve_tenant_and_run, build_identity_context
from backend.core.db import PoolExhausted
from backend.engine.combining_v2 import CombiningEngineV2
from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/reports/v2", tags=["Reports V2"])


@router.get("/combining/income-statement")
async def get_combining_income_statement_v2(
    period: str = "2025-Q1",
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Four-column combining income statement from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        engine = CombiningEngineV2(tid, rid)
        result = engine.get_combining_income_statement(period)
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


@router.get("/combining/balance-sheet")
async def get_combining_balance_sheet_v2(
    period: str = "2025-Q1",
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Four-column combining balance sheet from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        engine = CombiningEngineV2(tid, rid)
        result = engine.get_combining_balance_sheet(period)
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


@router.get("/combining/cash-flow")
async def get_combining_cash_flow_v2(
    period: str = "2025-Q1",
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Four-column combining cash flow from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        engine = CombiningEngineV2(tid, rid)
        result = engine.get_combining_cash_flow(period)
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


@router.get("/cofa-adjustments")
async def get_cofa_adjustments_v2(
    period: Optional[str] = None,
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Get all COFA adjustments from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        engine = CombiningEngineV2(tid, rid)
        result = engine.get_cofa_adjustments(period=period)
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
# Single-entity financial statements (structured endpoints for Reports portal)
# ---------------------------------------------------------------------------


@router.get("/income-statement")
async def get_income_statement_v2(
    entity_id: str = Query(..., description="Entity ID"),
    period: str = Query(..., description="Period (e.g., 2025-Q1)"),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Single-entity income statement from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        resolver = TripleQueryResolver(tid, rid)
        result = resolver.get_income_statement(entity_id, period)
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


@router.get("/balance-sheet")
async def get_balance_sheet_v2(
    entity_id: str = Query(..., description="Entity ID"),
    period: str = Query(..., description="Period (e.g., 2025-Q1)"),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Single-entity balance sheet from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        resolver = TripleQueryResolver(tid, rid)
        result = resolver.get_balance_sheet(entity_id, period)
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


@router.get("/cash-flow")
async def get_cash_flow_v2(
    entity_id: str = Query(..., description="Entity ID"),
    period: str = Query(..., description="Period (e.g., 2025-Q1)"),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Single-entity cash flow statement from convergence_triples."""
    tid, rid = resolve_tenant_and_run(tenant_id, pipeline_run_id)
    identity = build_identity_context(tid, rid)
    try:
        resolver = TripleQueryResolver(tid, rid)
        result = resolver.get_cash_flow(entity_id, period)
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
