"""
Maestra HTTP client — Convergence calls Platform/Maestra over HTTP for
engagement state. No direct reads of Platform's engagement_state table.

The rule: Convergence never reads Maestra's database. All engagement
lifecycle data flows through this client.

All methods:
  - Take an explicit tenant_id parameter (I2 — no env-var fallback).
  - Raise httpx.HTTPError on connection / timeout / non-2xx response.
  - Return parsed JSON dicts as documented per method.

Callers in route handlers convert exceptions to FastAPI HTTPException
with 502 (unreachable), 504 (timeout), 422 (validation), 404 (not found).
"""

import os

import httpx

from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

# Platform/Maestra base URL.  PLATFORM_URL is the canonical name; MAESTRA_BASE_URL
# is supported as an alias for symmetry with the Platform side.
PLATFORM_URL = (
    os.environ.get("PLATFORM_URL")
    or os.environ.get("MAESTRA_BASE_URL")
    or "http://localhost:8006"
).rstrip("/")

# Per-call timeout for engagement reads. Engagement endpoints are simple
# DB lookups — anything past 5s is a real failure, not slow normal.
_DEFAULT_TIMEOUT_S = 5.0


async def get_engagements(
    tenant_id: str,
    state: str | None = None,
) -> dict:
    """List engagements for the given tenant.

    Calls GET /api/maestra/engagements?tenant_id=X[&state=Y]

    Returns the wrapped response shape:
        {
            "tenant_id": str,
            "engagements": [ {engagement_id, engagement_short_name, ...}, ... ],
            "count": int
        }

    Raises httpx.HTTPError on connection failure or non-2xx response.
    """
    if not tenant_id:
        raise ValueError("get_engagements requires tenant_id")

    params: dict[str, str] = {"tenant_id": tenant_id}
    if state:
        params["state"] = state

    url = f"{PLATFORM_URL}/api/maestra/engagements"
    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()


async def get_active_engagement(tenant_id: str) -> dict:
    """Return the single active engagement for the given tenant.

    Calls GET /api/maestra/engagements/active?tenant_id=X

    Returns one engagement object:
        {
            "engagement_id": str,
            "engagement_short_name": str,
            "deal_name": str,
            "entity_a_id": str, "entity_b_id": str,
            "entity_a_name": str, "entity_b_name": str,
            "status": str,
            "config": dict,
            "created_at": str,
            "updated_at": str,
            "tenant_id": str
        }

    Raises httpx.HTTPError on connection failure, non-2xx response, or 404
    when no active engagement exists for the tenant.
    """
    if not tenant_id:
        raise ValueError("get_active_engagement requires tenant_id")

    url = f"{PLATFORM_URL}/api/maestra/engagements/active"
    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
        resp = await client.get(url, params={"tenant_id": tenant_id})
        resp.raise_for_status()
        return resp.json()


async def get_engagement_by_id(
    tenant_id: str,
    engagement_id: str,
) -> dict:
    """Return engagement details by ID for the given tenant.

    Calls GET /api/maestra/engagements/{engagement_id}?tenant_id=X

    Returns one engagement object (same shape as get_active_engagement).

    Raises httpx.HTTPError on connection failure, 404 (not found),
    or 403 (engagement belongs to a different tenant).
    """
    if not tenant_id:
        raise ValueError("get_engagement_by_id requires tenant_id")
    if not engagement_id:
        raise ValueError("get_engagement_by_id requires engagement_id")

    url = f"{PLATFORM_URL}/api/maestra/engagements/{engagement_id}"
    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
        resp = await client.get(url, params={"tenant_id": tenant_id})
        resp.raise_for_status()
        return resp.json()
