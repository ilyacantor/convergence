"""
Tenant run-state endpoints.

GET /api/convergence/tenants/active     — most recently updated tenant + run
GET /api/convergence/tenants/{tenant_id} — run state for a specific tenant

Replaces the SQL fallback in Mai's _resolve_tenant_id().
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException

from backend.core.db import PoolExhausted
from backend.db.triple_store import TripleStore
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/tenants", tags=["Tenants"])

_triple_store = TripleStore()


def _serialize_run_state(row: dict) -> dict:
    """Serialize a convergence_tenant_runs row for JSON response.

    Surfaces run identifiers under namespaced names (current_run_id /
    previous_run_id), never as bare 'run_id' (I1).
    """
    def _val(v):
        if v is None:
            return None
        if isinstance(v, UUID):
            return str(v)
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, Decimal):
            return float(v)
        return v

    return {
        "tenant_id": _val(row.get("tenant_id")),
        "current_run_id": _val(row.get("current_run_id")),
        "previous_run_id": _val(row.get("previous_run_id")),
        "current_snapshot_name": row.get("current_snapshot_name"),
        "previous_snapshot_name": row.get("previous_snapshot_name"),
        "updated_at": _val(row.get("updated_at")),
    }


@router.get("/active")
async def get_active_tenant():
    """Return the most recently updated tenant run state.

    Used by Mai to discover the active dataset when no explicit
    tenant_id is configured. Returns 404 when no pipeline has run yet.
    """
    try:
        row = _triple_store.get_active_tenant_run_state()
    except PoolExhausted as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Convergence DB pool exhausted while reading tenant runs — {exc}",
        )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No active tenant — convergence_tenant_runs is empty. "
                "Run the ingest pipeline first."
            ),
        )

    return _serialize_run_state(row)


@router.get("/{tenant_id}")
async def get_tenant(tenant_id: str):
    """Return run state for a specific tenant.

    Used by Mai to validate a configured tenant_id has live data.
    422 on invalid UUID, 404 when tenant has no row in tenant_runs.
    """
    try:
        UUID(tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"tenant_id must be a valid UUID — got '{tenant_id}'",
        )

    try:
        row = _triple_store.get_tenant_run_state(tenant_id)
    except PoolExhausted as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Convergence DB pool exhausted while reading tenant run — {exc}",
        )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Tenant '{tenant_id}' has no row in convergence_tenant_runs. "
                f"Either the tenant_id is wrong, or no pipeline has run for "
                f"this tenant yet."
            ),
        )

    return _serialize_run_state(row)
