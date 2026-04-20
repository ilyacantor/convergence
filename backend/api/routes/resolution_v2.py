"""
Resolution V2 routes — PG-backed entity resolution from triple overlap.

Mounted at /api/convergence/resolution/v2 in main.py.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.api.routes.v2_helpers import resolve_engagement_or_tenant, build_identity_context
from backend.core.db import PoolExhausted
from backend.engine.engagement import get_active_engagement
from backend.engine.engagement_data import EngagementData
from backend.engine.entity_resolution_v2 import EntityResolutionV2
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/resolution/v2", tags=["Resolution V2"])


def _get_resolver(eng_data: EngagementData, tid: str, rid: str) -> EntityResolutionV2:
    """Build a resolver from EngagementData (preferred) or tenant/run IDs."""
    return EntityResolutionV2(eng_data, pipeline_run_id=rid)


class CreateWorkspacesRequest(BaseModel):
    tenant_id: Optional[str] = None
    pipeline_run_id: Optional[str] = None


class ConfirmRequest(BaseModel):
    canonical_id: str
    decided_by: str = "system"


class EscalateRequest(BaseModel):
    reason: str
    decided_by: str = "system"


class DecisionRequest(BaseModel):
    decided_by: str = "system"


@router.post("/create-workspaces")
def create_workspaces(request: CreateWorkspacesRequest = CreateWorkspacesRequest()):
    """Create resolution workspaces from triple overlap."""
    eng_data, tid, rid = resolve_engagement_or_tenant(None, request.tenant_id, request.pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    result = resolver.create_workspaces_from_overlap()
    return {**identity, "status": "ok", **result}


@router.get("/workspaces")
def list_workspaces(
    domain: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """List resolution workspaces with optional filters."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    workspaces = resolver.list_workspaces(domain=domain, status=status)
    return {**identity, "workspaces": workspaces, "count": len(workspaces)}


@router.get("/workspaces/{workspace_id}")
def get_workspace(
    workspace_id: str,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Get a single workspace by ID."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    try:
        ws = resolver.get_workspace(workspace_id)
        return {**identity, **ws}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/workspaces/{workspace_id}/confirm")
def confirm_match(
    workspace_id: str,
    request: ConfirmRequest,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Confirm that overlapping concepts are the same real-world entity."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    try:
        ws = resolver.confirm_match(
            workspace_id, request.canonical_id, request.decided_by
        )
        return {**identity, **ws}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/workspaces/{workspace_id}/reject")
def reject_match(
    workspace_id: str,
    request: DecisionRequest = DecisionRequest(),
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Reject the match — concepts are different entities."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    try:
        ws = resolver.reject_match(workspace_id, request.decided_by)
        return {**identity, **ws}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/workspaces/{workspace_id}/escalate")
def escalate(
    workspace_id: str,
    request: EscalateRequest,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Escalate for human review."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    try:
        ws = resolver.escalate(
            workspace_id, request.reason, request.decided_by
        )
        return {**identity, **ws}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/workspaces/{workspace_id}/undo")
def undo_decision(
    workspace_id: str,
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Undo a decision — reset to pending."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    try:
        ws = resolver.undo_decision(workspace_id)
        return {**identity, **ws}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"DCL database pool exhausted — too many concurrent requests. {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/stats")
def get_stats(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Get resolution statistics."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    resolver = _get_resolver(eng_data, tid, rid)
    result = resolver.get_resolution_stats()
    return {**identity, **result}
