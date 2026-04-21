"""
Resolver API — identity resolver endpoints for Convergence engagements.

POST /resolve — run resolver across all business_record domains
GET /resolutions — query resolution decisions
GET /resolutions/summary — aggregate counts
PATCH /resolutions/{id} — HITL state update
GET /catalog — AOS tenants passing contract check

Per convergence_transition_master §3 (resolver contract).
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.db import resolver_store
from backend.db.engagement_store import get_engagement
from backend.engine.contract_check import check_aos_contract, check_entity_contract
from backend.engine.identity_resolver_v2.resolver import (
    resolve_all_domains,
)
from backend.core.constants import FARM_API_URL
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence", tags=["resolver"])


# ── Resolver endpoints ────────────────────────────────────────────────────────


class ResolveRequest(BaseModel):
    config: dict | None = None


@router.post("/engagements/{engagement_id}/resolve")
async def run_resolver(engagement_id: str, req: ResolveRequest | None = None):
    """Run identity resolver across all business_record domains for an engagement.

    Entity-keyed: reads convergence_triples by entity_id within shared tenant.
    Falls back to semantic_triples by tenant_id for legacy tenant-pair engagements.
    """
    eng = get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")

    acq_eid = eng.get("acquirer_entity_id", "")
    tgt_eid = eng.get("target_entity_id", "")
    tenant_id = eng.get("tenant_id", "")

    if not acq_eid or not tgt_eid:
        raise HTTPException(
            status_code=422,
            detail=f"Engagement {engagement_id} missing acquirer_entity_id or target_entity_id.",
        )

    acq_tid = eng.get("acquirer_tenant_id") or tenant_id
    tgt_tid = eng.get("target_tenant_id") or tenant_id

    config = (req.config if req else None) or {}

    results = resolve_all_domains(
        engagement_id=engagement_id,
        acquirer_tenant_id=acq_tid,
        target_tenant_id=tgt_tid,
        config=config,
        acquirer_entity_id=acq_eid,
        target_entity_id=tgt_eid,
    )

    total_auto = 0
    total_pending = 0
    total_no_match = 0

    for output in results:
        from dataclasses import asdict
        decisions = [asdict(d) for d in output.decisions]

        for d in output.decisions:
            if d.hitl_state == "auto_accepted":
                total_auto += 1
            elif d.hitl_state == "pending_hitl":
                total_pending += 1
            elif d.hitl_state == "no_match":
                total_no_match += 1

        resolver_store.delete_decisions_for_domain(engagement_id, output.domain)
        resolver_store.insert_decisions(engagement_id, decisions)

    return {
        "engagement_id": engagement_id,
        "domains_resolved": len(results),
        "stats": {
            "auto_accepted": total_auto,
            "pending_hitl": total_pending,
            "no_match": total_no_match,
        },
    }


@router.get("/engagements/{engagement_id}/resolutions")
async def get_resolutions(
    engagement_id: str,
    domain: str | None = Query(None),
    hitl_state: str | None = Query(None),
):
    """Query resolver decisions for an engagement."""
    eng = get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")

    decisions = resolver_store.get_decisions(
        engagement_id=engagement_id,
        domain=domain,
        hitl_state=hitl_state,
    )

    by_domain: dict = {}
    for d in decisions:
        dom = d["domain"]
        if dom not in by_domain:
            by_domain[dom] = {"domain": dom, "mappings": [], "unmatched_acq": [], "unmatched_tgt": []}
        if d["hitl_state"] == "no_match":
            by_domain[dom]["unmatched_acq"].append(d["acquirer_record_id"])
        else:
            by_domain[dom]["mappings"].append(d)

    return {
        "engagement_id": engagement_id,
        "domains": list(by_domain.values()),
        "total_decisions": len(decisions),
    }


@router.get("/engagements/{engagement_id}/resolutions/summary")
async def get_resolutions_summary(engagement_id: str):
    """Aggregate resolution counts per domain and total."""
    eng = get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")

    return resolver_store.get_summary(engagement_id)


class HITLUpdateRequest(BaseModel):
    hitl_state: str
    operator: str


@router.patch("/engagements/{engagement_id}/resolutions/{decision_id}")
async def update_resolution(engagement_id: str, decision_id: str, req: HITLUpdateRequest):
    """Update HITL state on a resolver decision.

    Valid transitions: pending_hitl -> confirmed|rejected|deferred.
    Auto-accepted decisions are terminal (422 if attempted).
    """
    eng = get_engagement(engagement_id)
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engagement not found: {engagement_id}")

    try:
        return resolver_store.update_hitl(
            decision_id=decision_id,
            hitl_state=req.hitl_state,
            operator=req.operator,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# ── Catalog endpoint ──────────────────────────────────────────────────────────


@router.get("/catalog")
async def get_catalog():
    """Entity snapshots available for Convergence engagements.

    Each snapshot = one entity_id under one tenant_id in convergence_triples.
    The pair selector picks two entity_ids as acquirer and target.
    """
    from backend.core.db import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT tenant_id, entity_id, COUNT(*) as triple_count "
                "FROM convergence_triples "
                "WHERE is_active = true "
                "GROUP BY tenant_id, entity_id "
                "ORDER BY triple_count DESC"
            )
            snapshots_raw = [
                {"tenant_id": str(tid), "entity_id": eid, "triple_count": cnt}
                for tid, eid, cnt in cur.fetchall()
            ]

    if not snapshots_raw:
        return {"passing_entities": [], "existing_engagements": []}

    contract_cache: dict[tuple[str, str], object] = {}
    for snap in snapshots_raw:
        key = (snap["tenant_id"], snap["entity_id"])
        if key not in contract_cache:
            contract_cache[key] = check_entity_contract(snap["tenant_id"], snap["entity_id"])

    entities = []
    for snap in snapshots_raw:
        key = (snap["tenant_id"], snap["entity_id"])
        contract = contract_cache[key]
        domain_coverage = [d.domain for d in contract.domains if d.record_count > 0]
        display_name = snap["entity_id"].replace("-", " ").rsplit(" ", 1)[0]
        entities.append({
            "tenant_id": snap["tenant_id"],
            "entity_id": snap["entity_id"],
            "display_name": display_name,
            "triple_count": snap["triple_count"],
            "domain_coverage": domain_coverage,
            "contract_passed": contract.passed,
        })

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT engagement_id, acquirer_entity_id, target_entity_id "
                "FROM engagements "
                "WHERE acquirer_entity_id IS NOT NULL AND target_entity_id IS NOT NULL"
            )
            existing_pairs: list[dict] = []
            for row in cur.fetchall():
                existing_pairs.append({
                    "engagement_id": str(row[0]),
                    "acquirer_entity_id": str(row[1]),
                    "target_entity_id": str(row[2]),
                })

    return {
        "passing_entities": [e for e in entities if e["contract_passed"]],
        "all_entities": entities,
        "existing_engagements": existing_pairs,
    }
