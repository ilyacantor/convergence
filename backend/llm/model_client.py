"""
Convergence semantic-mapper LLM client.

Single async entry point: invoke_semantic_mapper(...) -> SemanticMapping.
One constrained Anthropic call. No agent loop, no tool use, no retries on
content. Structured JSON output mirrored as a Pydantic model. The workflow
handler in routes/cofa_run.py owns identity (engagement_id, entity_ids,
tenant_id, run_id), gating (COFACompletionGate), and persistence
(cofa_mapping_writer + run_ledger).
"""

from __future__ import annotations

import json
import os
from typing import Optional

from anthropic import AsyncAnthropic
from pydantic import BaseModel, Field, ValidationError

from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 16000
_TEMPERATURE = 0.0


# ── Output schema (mirrors cofa_mapping_writer.write_cofa_mapping inputs) ──

class MappingEntry(BaseModel):
    unified_account: str
    acquirer_account: Optional[str] = None
    target_account: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    mapping_basis: str


class ConflictEntry(BaseModel):
    conflict_id: str
    conflict_type: str
    severity: str
    dollar_impact: float
    description: str
    acquirer_treatment: str
    target_treatment: str
    resolution_status: str
    impact_area: str
    revenue_impact: float
    expense_impact: float
    ebitda_impact: float
    from_category: Optional[str] = None
    to_category: Optional[str] = None


class UnifiedAccountEntry(BaseModel):
    account_name: str
    account_type: str
    hierarchy_parent: str
    source_entities: list[str]


class SemanticMapping(BaseModel):
    mappings: list[MappingEntry]
    conflicts: list[ConflictEntry] = Field(default_factory=list)
    unified_accounts: list[UnifiedAccountEntry] = Field(default_factory=list)


class SemanticMapperError(RuntimeError):
    """Raised when the LLM call or its output cannot produce a valid mapping."""


# ── System prompt (constrained, no chain-of-thought) ───────────────────────

_SYSTEM_PROMPT = """You unify two enterprise charts of accounts for an M&A combining workbook.

Inputs you receive:
- Acquirer CoA: numbered list of account_name strings.
- Target CoA: numbered list of account_name strings.
- Optional acquirer/target accounting policies (recognition, classification, capitalization, etc.).

Output a single JSON object — no prose, no markdown fence — matching:

{
  "mappings": [
    {"unified_account": "<str>", "acquirer_account": "<str|null>", "target_account": "<str|null>",
     "confidence": <0..1>, "mapping_basis": "<short rationale>"}
  ],
  "conflicts": [
    {"conflict_id": "COFA-001", "conflict_type": "recognition|classification|capitalization|policy",
     "severity": "low|medium|high|critical", "dollar_impact": <number>,
     "description": "<str>", "acquirer_treatment": "<str>", "target_treatment": "<str>",
     "resolution_status": "unresolved|resolved|deferred",
     "impact_area": "revenue|expense_reclassification|ebitda|depreciation",
     "revenue_impact": <number>, "expense_impact": <number>, "ebitda_impact": <number>,
     "from_category": "<str|null>", "to_category": "<str|null>"}
  ],
  "unified_accounts": [
    {"account_name": "<str>", "account_type": "<str>",
     "hierarchy_parent": "<str>", "source_entities": ["<entity_id>", ...]}
  ]
}

Mapping rules — non-negotiable:
- EVERY account from BOTH CoA lists must appear in mappings[]. Orphans are rejected by the gate.
- Use the exact account_name strings from the inputs.
- Entity-specific accounts with no counterpart: set the other side to null.
- Many-to-one mappings allowed (multiple source accounts -> one unified_account).
- mapping_basis is short ("exact match", "semantic: both are revenue", "hierarchy: subcategory").

Conflict rules:
- Only emit conflicts that are evidenced by the supplied policies. Absence of policy = no conflict, not a guess.
- conflict_id format: "COFA-001", "COFA-002", ...
- impact_area / revenue_impact / expense_impact / ebitda_impact must be internally consistent
  (recognition -> revenue + ebitda; classification -> from/to categories, ebitda zero;
   capitalization -> negative expense, positive ebitda; policy -> depreciation/ebitda).

Return JSON only. No reasoning, no explanation, no fence.
"""


# ── Public entry point ────────────────────────────────────────────────────

async def invoke_semantic_mapper(
    *,
    acquirer_entity_id: str,
    target_entity_id: str,
    acquirer_coa: list[str],
    target_coa: list[str],
    acquirer_policies: Optional[str] = None,
    target_policies: Optional[str] = None,
) -> SemanticMapping:
    """Run one Anthropic call and parse the structured mapping.

    Raises SemanticMapperError on missing API key, transport failure, empty
    response, or schema-invalid output. Never returns a partial mapping —
    callers can rely on the result type.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise SemanticMapperError(
            "ANTHROPIC_API_KEY is not set — Convergence cannot run cofa_merge "
            "semantic mapping. Set it in convergence/.env (local) or Render "
            "dashboard (prod)."
        )

    user_message = _build_user_message(
        acquirer_entity_id=acquirer_entity_id,
        target_entity_id=target_entity_id,
        acquirer_coa=acquirer_coa,
        target_coa=target_coa,
        acquirer_policies=acquirer_policies,
        target_policies=target_policies,
    )

    client = AsyncAnthropic(api_key=api_key)
    logger.info(
        "[cofa_merge] semantic mapper call — model=%s acquirer=%s(%d) target=%s(%d)",
        _MODEL, acquirer_entity_id, len(acquirer_coa),
        target_entity_id, len(target_coa),
    )

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as exc:
        raise SemanticMapperError(
            f"Anthropic call failed: {type(exc).__name__}: {exc}"
        ) from exc

    text_blocks = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    raw = "".join(text_blocks).strip()
    if not raw:
        raise SemanticMapperError(
            f"Anthropic returned no text content. stop_reason={response.stop_reason}"
        )

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SemanticMapperError(
            f"Anthropic output is not valid JSON: {exc.msg} at pos {exc.pos}. "
            f"First 200 chars: {raw[:200]!r}"
        ) from exc

    try:
        mapping = SemanticMapping.model_validate(payload)
    except ValidationError as exc:
        raise SemanticMapperError(
            f"Anthropic output failed schema validation: {exc.error_count()} errors. "
            f"First: {exc.errors()[0]}"
        ) from exc

    logger.info(
        "[cofa_merge] mapping returned — mappings=%d conflicts=%d unified=%d "
        "tokens_in=%d tokens_out=%d",
        len(mapping.mappings), len(mapping.conflicts), len(mapping.unified_accounts),
        response.usage.input_tokens, response.usage.output_tokens,
    )
    return mapping


def _build_user_message(
    *,
    acquirer_entity_id: str,
    target_entity_id: str,
    acquirer_coa: list[str],
    target_coa: list[str],
    acquirer_policies: Optional[str],
    target_policies: Optional[str],
) -> str:
    parts = [
        f"# Acquirer CoA ({acquirer_entity_id}) — {len(acquirer_coa)} accounts\n",
        "\n".join(f"  {i+1}. {n}" for i, n in enumerate(acquirer_coa)),
        f"\n\n# Target CoA ({target_entity_id}) — {len(target_coa)} accounts\n",
        "\n".join(f"  {i+1}. {n}" for i, n in enumerate(target_coa)),
    ]
    if acquirer_policies:
        parts.append(f"\n\n# Acquirer Policies ({acquirer_entity_id})\n{acquirer_policies}")
    if target_policies:
        parts.append(f"\n\n# Target Policies ({target_entity_id})\n{target_policies}")
    parts.append(
        "\n\nProduce the unified mapping JSON now. Every CoA account must appear."
    )
    return "".join(parts)
