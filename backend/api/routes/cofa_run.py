"""
COFA Merge Workflow Route
=========================
POST /api/convergence/cofa/run — synchronous JSON workflow.

Convergence-owned workflow. Embedded LLM intelligence (single constrained
Anthropic call via backend.llm.model_client) — no agent loop, no tool use,
no SSE. Mai is concierge-only and never invokes this; Console (or any
operator surface) calls it directly.

Flow:
  1. Resolve engagement -> entity_a / entity_b
  2. Load CoA account names from convergence_triples
  3. record_run_step(step_name="cofa_merge")  -> step_id
  4. update_run_step(step_id, "running")
  5. invoke_semantic_mapper(...)  -> SemanticMapping
  6. COFACompletionGate via _check_completeness  -> 422 on orphans
  7. cofa_mapping_writer.write_cofa_mapping(...)  -> triple counts
  8. update_run_step(step_id, "complete", outputs_ref=...)
  9. Return JSON: {cofa_run_id, tenant_id, engagement_id, entity_pair,
                   triples_written, mapping_count, conflict_count,
                   unified_account_count, consumed_dcl_ingest_ids}

Identity (I2) preserved on every response. Bare run_id banned (I1) —
namespaced as cofa_run_id.
"""

import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.db import get_connection
from backend.db.engagement_store import (
    get_engagement,
    record_run_step,
    update_run_step,
)
from backend.engine.cofa_mapping_writer import write_cofa_mapping
from backend.llm.model_client import (
    SemanticMapperError,
    invoke_semantic_mapper,
)
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/cofa", tags=["COFA"])

_WORKFLOW_STEP_NAME = "cofa_merge"


# ── Request / response ─────────────────────────────────────────────────────

class COFARunRequest(BaseModel):
    engagement_id: str
    dcl_ingest_ids: list[str] = Field(default_factory=list)
    pipeline_run_id: Optional[str] = None


# ── Helpers (forked from the deleted cofa_mapping.py route) ────────────────

def _load_coa_accounts(cur, entity_id: str) -> dict[str, str]:
    """Return {account_name: account_number} for an entity from convergence_triples."""
    cur.execute(
        "SELECT split_part(concept, '.', 2) AS acct_num, "
        "       value #>> '{}' AS acct_name "
        "FROM convergence_triples "
        "WHERE concept LIKE 'coa.%%' AND entity_id = %s "
        "  AND property = 'account_name' AND is_active = true ",
        (entity_id,),
    )
    return {
        row[1].strip('"'): row[0]
        for row in cur.fetchall()
        if row[1]
    }


def _check_completeness(
    acquirer_coa: dict[str, str],
    target_coa: dict[str, str],
    mappings: list[dict],
) -> dict:
    """Return completeness report. complete=True iff every CoA name is mapped."""
    mapped_acquirer: set[str] = set()
    mapped_target: set[str] = set()
    for m in mappings:
        if m.get("acquirer_account"):
            mapped_acquirer.add(m["acquirer_account"])
        if m.get("target_account"):
            mapped_target.add(m["target_account"])

    acq_orphans = {n: num for n, num in acquirer_coa.items() if n not in mapped_acquirer}
    tgt_orphans = {n: num for n, num in target_coa.items() if n not in mapped_target}

    return {
        "complete": not acq_orphans and not tgt_orphans,
        "acquirer_orphans": [
            {"account_number": num, "account_name": n}
            for n, num in sorted(acq_orphans.items(), key=lambda x: x[1])
        ],
        "target_orphans": [
            {"account_number": num, "account_name": n}
            for n, num in sorted(tgt_orphans.items(), key=lambda x: x[1])
        ],
        "acquirer_total": len(acquirer_coa),
        "target_total": len(target_coa),
        "acquirer_mapped": len(acquirer_coa) - len(acq_orphans),
        "target_mapped": len(target_coa) - len(tgt_orphans),
    }


def _get_consumed_dcl_ingest_ids(entity_ids: list[str]) -> list[str]:
    """Return DISTINCT current_run_id pointers for these entities (provenance)."""
    if not entity_ids:
        return []
    placeholders = ", ".join(["%s"] * len(entity_ids))
    sql = (
        f"SELECT DISTINCT current_run_id::text FROM tenant_runs "
        f"WHERE entity_id IN ({placeholders}) "
        f"ORDER BY current_run_id"
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, entity_ids)
            return [row[0] for row in cur.fetchall()]


_POLICIES_DIR = Path(__file__).resolve().parent.parent.parent / "policies"
_GENERIC_POLICY_PATH = _POLICIES_DIR / "_generic_policy.md"


def _load_accounting_policies(entity_id: str) -> tuple[str, str]:
    """Load per-entity accounting policies.

    Returns (policy_text, policy_source) where policy_source is either
    "entity" (backend/policies/{entity_id}_policy.md was present) or
    "generic" (fell back to _generic_policy.md). The generic path emits
    a WARN log so the fallback never goes silent — see deferred entry
    for industry verticalization.

    WIP: the previous behavior was a hard 422 reject on missing
    entity-specific policy. That branch is commented in place below
    until Farm WP2 emits accounting_policy triples per entity and
    Convergence reads policy from the triple store instead of the
    filesystem (convergence_deferred_work.md, industry verticalization).
    """
    policy_path = _POLICIES_DIR / f"{entity_id}_policy.md"
    if policy_path.is_file():
        text = policy_path.read_text(encoding="utf-8").strip()
        if text:
            return text, "entity"
    # WIP: hard-reject branch kept for reference — restore when
    # industry-specific policies ship (see deferred-work entry 25).
    # if not policy_path.is_file():
    #     raise HTTPException(422, detail=f"No accounting policy file for entity_id='{entity_id}'")

    if not _GENERIC_POLICY_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail=(
                "Generic policy fallback missing — neither "
                f"{policy_path.name} nor _generic_policy.md exists under "
                f"{_POLICIES_DIR}. COFA merge aborted."
            ),
        )
    text = _GENERIC_POLICY_PATH.read_text(encoding="utf-8").strip()
    if not text:
        raise HTTPException(
            status_code=503,
            detail=(
                "Generic policy fallback is empty "
                f"({_GENERIC_POLICY_PATH}). COFA merge aborted."
            ),
        )
    logger.warning(
        "[cofa_merge] Generic policy in use for entity_id=%s. "
        "Industry verticalization pending. See convergence_deferred_work.md.",
        entity_id,
    )
    return text, "generic"


def _orphan_detail(report: dict, acquirer_id: str, target_id: str) -> str:
    parts = [
        "COFACompletionGate REJECTED: mapping is incomplete.",
        f"Acquirer ({acquirer_id}): "
        f"{report['acquirer_mapped']}/{report['acquirer_total']} mapped.",
        f"Target ({target_id}): "
        f"{report['target_mapped']}/{report['target_total']} mapped.",
    ]
    if report["acquirer_orphans"]:
        parts.append(
            "Missing acquirer accounts: "
            + ", ".join(f"{o['account_number']} ({o['account_name']})"
                        for o in report["acquirer_orphans"])
        )
    if report["target_orphans"]:
        parts.append(
            "Missing target accounts: "
            + ", ".join(f"{o['account_number']} ({o['account_name']})"
                        for o in report["target_orphans"])
        )
    return " ".join(parts)


# ── POST /api/convergence/cofa/run ─────────────────────────────────────────

@router.post(
    "/run",
    summary="Run the COFA merge workflow (synchronous)",
    description=(
        "End-to-end COFA merge: load CoA, invoke semantic mapper, enforce "
        "COFACompletionGate, write triples, record run_ledger. Synchronous "
        "JSON request/response — no SSE."
    ),
)
async def run_cofa_merge(req: COFARunRequest):
    engagement = get_engagement(req.engagement_id)
    if not engagement:
        raise HTTPException(
            status_code=404,
            detail=f"Engagement {req.engagement_id} not found.",
        )

    tenant_id = engagement["tenant_id"]
    acquirer_id = engagement["acquirer_entity_id"]
    target_id = engagement["target_entity_id"]
    cofa_run_id = str(uuid.uuid4())

    with get_connection() as conn:
        with conn.cursor() as cur:
            acquirer_coa = _load_coa_accounts(cur, acquirer_id)
            target_coa = _load_coa_accounts(cur, target_id)

    if not acquirer_coa or not target_coa:
        raise HTTPException(
            status_code=422,
            detail=(
                f"COFA merge requires CoA triples for both entities. "
                f"acquirer({acquirer_id})={len(acquirer_coa)} accounts, "
                f"target({target_id})={len(target_coa)} accounts. "
                f"Run the per-entity Farm + DCL ingest before COFA merge."
            ),
        )

    idempotency_key = f"{req.engagement_id}:cofa_merge:{cofa_run_id}"
    inputs_hash = uuid.uuid5(
        uuid.NAMESPACE_OID,
        f"{acquirer_id}:{target_id}:{','.join(sorted(req.dcl_ingest_ids))}",
    ).hex[:16]

    step = record_run_step(
        tenant_id=tenant_id,
        engagement_id=req.engagement_id,
        step_name=_WORKFLOW_STEP_NAME,
        idempotency_key=idempotency_key,
        inputs_hash=inputs_hash,
        upstream_deps=req.dcl_ingest_ids or ["ingest"],
    )
    step_id = step["step_id"]
    update_run_step(step_id, "running")

    try:
        acquirer_policies, acquirer_policy_source = _load_accounting_policies(acquirer_id)
        target_policies, target_policy_source = _load_accounting_policies(target_id)
    except HTTPException as exc:
        update_run_step(step_id, "failed", error=str(exc.detail))
        raise

    try:
        mapping, usage = await invoke_semantic_mapper(
            acquirer_entity_id=acquirer_id,
            target_entity_id=target_id,
            acquirer_coa=list(acquirer_coa.keys()),
            target_coa=list(target_coa.keys()),
            acquirer_policies=acquirer_policies,
            target_policies=target_policies,
        )
    except SemanticMapperError as exc:
        update_run_step(step_id, "failed", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    mapping_dicts = [m.model_dump() for m in mapping.mappings]
    completeness = _check_completeness(acquirer_coa, target_coa, mapping_dicts)
    if not completeness["complete"]:
        detail = _orphan_detail(completeness, acquirer_id, target_id)
        logger.warning("[cofa_merge] gate rejected: %s", detail)
        update_run_step(step_id, "failed", error=detail, validation_result="failed")
        raise HTTPException(status_code=422, detail=detail)

    writer_input = {
        "engagement_id": req.engagement_id,
        "acquirer_entity_id": acquirer_id,
        "target_entity_id": target_id,
        "tenant_id": tenant_id,
        "run_id": cofa_run_id,
        "mappings": mapping_dicts,
        "conflicts": [c.model_dump() for c in mapping.conflicts],
        "unified_accounts": [u.model_dump() for u in mapping.unified_accounts],
    }
    writer_result = write_cofa_mapping(writer_input)
    if writer_result["status"] != "success":
        err = f"cofa_mapping_writer rejected input: {writer_result.get('errors')}"
        update_run_step(step_id, "failed", error=err)
        raise HTTPException(status_code=422, detail=writer_result)

    consumed_ids = _get_consumed_dcl_ingest_ids([acquirer_id, target_id])
    outputs_ref = f"convergence_triples:cofa_run_id={cofa_run_id}"
    run_summary = {
        "acquirer_accounts": completeness["acquirer_total"],
        "target_accounts": completeness["target_total"],
        "mappings": len(mapping_dicts),
        "conflicts": writer_result["conflict_count"],
        "orphan_accounts": completeness.get("orphans", []),
    }
    update_run_step(
        step_id,
        "complete",
        outputs_ref=outputs_ref,
        model_version=usage.model_version,
        tokens_in=usage.tokens_in,
        tokens_out=usage.tokens_out,
        cost_usd=usage.cost_usd,
        validation_result="pass",
        summary=run_summary,
    )

    triples_written = writer_result["triple_count"]
    mapping_count = writer_result["mapping_count"]
    source_rows = (
        mapping_count
        + writer_result["conflict_count"]
        + writer_result["unified_account_count"]
    )

    response: dict[str, Any] = {
        "cofa_run_id": cofa_run_id,
        "tenant_id": tenant_id,
        "engagement_id": req.engagement_id,
        "entity_pair": [acquirer_id, target_id],
        "step_id": step_id,
        "consumed_dcl_ingest_ids": consumed_ids,
        "triples_written": triples_written,
        "mapping_count": mapping_count,
        "conflict_count": writer_result["conflict_count"],
        "unified_account_count": writer_result["unified_account_count"],
        "source_rows": source_rows,
        "expansion_factor": (
            round(triples_written / source_rows, 4) if source_rows > 0 else 0.0
        ),
        "breakdown": writer_result["breakdown"],
        "completeness": {
            "acquirer_mapped": completeness["acquirer_mapped"],
            "acquirer_total": completeness["acquirer_total"],
            "target_mapped": completeness["target_mapped"],
            "target_total": completeness["target_total"],
        },
        "policy_sources": {
            acquirer_id: acquirer_policy_source,
            target_id: target_policy_source,
        },
    }
    if req.pipeline_run_id:
        response["pipeline_run_id"] = req.pipeline_run_id

    logger.info(
        "[cofa_merge] success — cofa_run_id=%s engagement=%s triples=%d",
        cofa_run_id, req.engagement_id, triples_written,
    )
    return JSONResponse(status_code=201, content=response)
