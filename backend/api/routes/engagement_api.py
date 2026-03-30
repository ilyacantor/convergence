"""
Engagement API — exposes the active engagement config over HTTP.

DCL's maestra.py calls GET /api/convergence/engagement/active instead of
importing engagement.py directly. This is the cross-service boundary.
"""

import httpx
from fastapi import APIRouter, HTTPException, Request

from backend.engine.engagement import get_active_engagement
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

PLATFORM_URL = "http://localhost:8006"

router = APIRouter(prefix="/api/convergence", tags=["engagement"])


@router.get("/engagements")
async def list_engagements():
    """List engagements with identity fields. ORDER BY created_at DESC.

    Returns engagement_id, engagement_short_name, entity_pair, status, created_at.
    Enriches Platform data with engagement config.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{PLATFORM_URL}/api/maestra/engagements")
            resp.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot reach Platform at {PLATFORM_URL}/api/maestra/engagements — {e}",
        )

    # Enrich with engagement config for short_name and entity_pair
    try:
        eng = get_active_engagement()
        short_name = eng.short_name
        entity_pair = [eng.entity_a.id, eng.entity_b.id]
    except Exception:
        short_name = None
        entity_pair = None

    engagements = []
    for item in resp.json():
        engagements.append({
            "engagement_id": item["engagement_id"],
            "engagement_short_name": short_name,
            "entity_pair": entity_pair,
            "status": item.get("state", item.get("status")),
            "created_at": item["created_at"],
        })

    # ORDER BY created_at DESC
    engagements.sort(key=lambda e: e["created_at"] or "", reverse=True)
    return engagements


@router.post("/maestra/cofa-chat")
async def cofa_chat(request: Request):
    """Proxy COFA chat to Platform's Maestra endpoint."""
    body = await request.json()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
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


@router.get("/engagement/active")
async def get_engagement():
    """Return the active engagement config as JSON.

    Called by DCL's maestra.py over HTTP. Fails loudly if no engagement
    is configured — no silent fallback.
    """
    eng = get_active_engagement()
    return {
        "engagement_id": eng.engagement_id,
        "engagement_short_name": eng.short_name,
        "deal_name": eng.deal_name,
        "entity_pair": [eng.entity_a.id, eng.entity_b.id],
        "entity_a": {
            "id": eng.entity_a.id,
            "display_name": eng.entity_a.display_name,
            "role": eng.entity_a.role,
            "business_model": eng.entity_a.business_model,
            "source_systems": eng.entity_a.source_systems,
        },
        "entity_b": {
            "id": eng.entity_b.id,
            "display_name": eng.entity_b.display_name,
            "role": eng.entity_b.role,
            "business_model": eng.entity_b.business_model,
            "source_systems": eng.entity_b.source_systems,
        },
        "deal_parameters": eng.deal_parameters,
        "synergy_targets": eng.synergy_targets,
    }
