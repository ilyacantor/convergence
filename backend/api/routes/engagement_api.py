"""
Engagement API — exposes the active engagement config over HTTP.

DCL's maestra.py calls GET /api/convergence/engagement/active instead of
importing engagement.py directly. This is the cross-service boundary.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from backend.db.triple_store import TripleStore
from backend.engine.engagement import get_active_engagement
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

PLATFORM_URL = "http://localhost:8006"

router = APIRouter(prefix="/api/convergence", tags=["engagement"])

_triple_store = TripleStore()


def _resolve_entity_roles(eng) -> tuple[str, str]:
    """Return (acquirer_entity_id, target_entity_id) from engagement config."""
    if eng.entity_a.role == "acquirer":
        return eng.entity_a.id, eng.entity_b.id
    return eng.entity_b.id, eng.entity_a.id


@router.get("/engagements/{engagement_id}")
async def get_engagement_by_id(engagement_id: str):
    """Return engagement details by ID.

    The list endpoint enriches Platform IDs with the active engagement
    config.  This endpoint returns the same enrichment for any ID that
    was surfaced through the list.  With a single active config file this
    is always the same data — the ID is echoed back so the caller's
    provenance chain stays intact.
    """
    eng = get_active_engagement()

    acquirer_id, target_id = _resolve_entity_roles(eng)
    return {
        "engagement_id": engagement_id,
        "engagement_short_name": eng.short_name,
        "short_name": eng.short_name,
        "deal_name": eng.deal_name,
        "entity_pair": [eng.entity_a.id, eng.entity_b.id],
        "acquirer_entity_id": acquirer_id,
        "target_entity_id": target_id,
        "entity_a": {
            "id": eng.entity_a.id,
            "display_name": eng.entity_a.display_name,
            "role": eng.entity_a.role,
        },
        "entity_b": {
            "id": eng.entity_b.id,
            "display_name": eng.entity_b.display_name,
            "role": eng.entity_b.role,
        },
        "status": "active",
    }


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

    # Enrich with engagement config for short_name and entity roles
    eng = get_active_engagement()
    short_name = eng.short_name
    entity_pair = [eng.entity_a.id, eng.entity_b.id]

    # Derive acquirer/target from role attribute (Console matches by these)
    acquirer_id, target_id = _resolve_entity_roles(eng)

    engagements = []
    for item in resp.json():
        engagements.append({
            "engagement_id": item["engagement_id"],
            "engagement_short_name": short_name,
            "short_name": short_name,
            "entity_pair": entity_pair,
            "acquirer_entity_id": acquirer_id,
            "target_entity_id": target_id,
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
async def get_engagement(tenant_id: str = Query(None)):
    """Return the active engagement config as JSON.

    Called by DCL's maestra.py and NLQ's report proxy over HTTP.
    Fails loudly if no engagement is configured — no silent fallback.

    When tenant_id is provided, includes current_pipeline_run_id from
    convergence_tenant_runs so callers can pass it to v2 report endpoints.
    """
    eng = get_active_engagement()
    result = {
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
    if tenant_id:
        try:
            result["current_pipeline_run_id"] = _triple_store.get_current_run_id(tenant_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "NO_PIPELINE_RUN",
                    "message": str(exc),
                },
            )
    return result
