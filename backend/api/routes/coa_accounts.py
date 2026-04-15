"""
Chart-of-Accounts read endpoint.

GET /api/convergence/coa/accounts?tenant_id=X&entity_id=Y

Replaces Mai's raw SQL on convergence_triples for CoA loading.
One endpoint, one job — accounts only. Run state lives on /tenants/*.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from backend.core.db import PoolExhausted
from backend.db.triple_store import TripleStore
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/coa", tags=["CoA"])

_triple_store = TripleStore()


@router.get("/accounts")
async def get_coa_accounts(
    tenant_id: str = Query(..., description="Tenant UUID (required, I2)"),
    entity_id: str = Query(..., description="Entity ID (required, I2)"),
):
    """Return Chart of Accounts for an entity in the tenant's current run.

    Used by Mai's COFA chat to load CoA context into prompts.
    Returns an empty 404 if the entity has no CoA triples — no silent
    fallback, no demo data.
    """
    # Validate tenant_id is a UUID — fail loud per I6, no string mangling.
    try:
        UUID(tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"tenant_id must be a valid UUID — got '{tenant_id}'",
        )

    try:
        accounts = _triple_store.get_coa_accounts(tenant_id, entity_id)
    except PoolExhausted as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Convergence DB pool exhausted while loading CoA — {exc}",
        )

    if not accounts:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No CoA triples found for entity_id='{entity_id}' "
                f"in tenant_id='{tenant_id}' current run. "
                f"Run the Farm/COFA pipeline for this entity first."
            ),
        )

    return {
        "tenant_id": tenant_id,
        "entity_id": entity_id,
        "accounts": accounts,
        "count": len(accounts),
    }
