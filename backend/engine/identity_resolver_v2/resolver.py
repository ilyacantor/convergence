"""
Identity resolver v2 — open-world business record matching across AOS tenants.

Per convergence_transition_master §3: five tiers, first-match-wins,
evidence accumulated, HITL for ambiguous matches.

Module location: convergence/engine/identity_resolver_v2/
Not a fork of AOD's resolver (AOD = closed-world source catalog matching).
"""

import hashlib
import json
import logging
from dataclasses import dataclass, field, asdict
from uuid import UUID

from backend.core.db import get_connection
from backend.engine.contract_check import IDENTIFIER_PRIORITY
from backend.lib.identity_primitives import (
    normalize_name,
    levenshtein,
    token_sort_ratio,
    embedding_distance,
)

logger = logging.getLogger(__name__)

DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.90
DEFAULT_AUTO_REJECT_THRESHOLD = 0.40
DEFAULT_FUZZY_TOKEN_THRESHOLD = 0.75
DEFAULT_FUZZY_LEVENSHTEIN_MAX = 3


@dataclass
class MappingEntry:
    acquirer_record_id: str
    target_record_id: str
    confidence: float
    tier: str
    hitl_state: str
    evidence: dict
    content_hash_acq: str = ""
    content_hash_tgt: str = ""


@dataclass
class DecisionData:
    """Raw decision row for direct persistence to resolver_decisions."""
    domain: str
    acquirer_record_id: str
    target_record_id: str | None
    confidence: float
    evidence: dict
    tier_matched: str
    hitl_state: str
    content_hash_acq: str
    content_hash_tgt: str | None


@dataclass
class ResolverOutput:
    domain: str
    mappings: list[MappingEntry] = field(default_factory=list)
    unmatched_acq: list[str] = field(default_factory=list)
    unmatched_tgt: list[str] = field(default_factory=list)
    decisions: list[DecisionData] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "domain": self.domain,
            "mappings": [asdict(m) for m in self.mappings],
            "unmatched_acq": self.unmatched_acq,
            "unmatched_tgt": self.unmatched_tgt,
        }


def _compute_content_hash(record: dict, domain: str) -> str:
    """Hash of (display_name, normalized_name, all identifier values)."""
    identifiers = IDENTIFIER_PRIORITY.get(domain, ["normalized_name"])
    parts = [
        record.get("display_name", ""),
        record.get("normalized_name", ""),
    ]
    for ident in identifiers:
        parts.append(record.get(ident, ""))
    canonical = json.dumps(parts, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _get_domain_records(tenant_id: str, domain: str) -> dict[str, dict[str, str]]:
    """Get all business_record concepts for a domain from semantic_triples."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT concept, property, value #>> '{}'
                FROM semantic_triples
                WHERE tenant_id = %s::uuid
                  AND split_part(concept, '.', 1) = %s
                  AND property NOT IN ('namespace_type')
                  AND is_active = true
                """,
                (tenant_id, domain),
            )
            records: dict[str, dict[str, str]] = {}
            for concept, prop, val in cur.fetchall():
                if concept not in records:
                    records[concept] = {}
                records[concept][prop] = val
            return records


def _determine_hitl_state(
    confidence: float,
    auto_accept: float,
    auto_reject: float,
) -> str:
    if confidence >= auto_accept:
        return "auto_accepted"
    if confidence < auto_reject:
        return "no_match"
    return "pending_hitl"


def resolve(
    engagement_id: str | UUID,
    domain: str,
    acquirer_tenant_id: str | UUID,
    target_tenant_id: str | UUID,
    config: dict | None = None,
) -> ResolverOutput:
    """Run the identity resolver across one domain for an engagement pair.

    Reads acquirer and target triples from DCL (SELECT only).
    Returns ResolverOutput with mappings, unmatched_acq, unmatched_tgt.
    """
    cfg = config or {}
    auto_accept = cfg.get("auto_accept_threshold", DEFAULT_AUTO_ACCEPT_THRESHOLD)
    auto_reject = cfg.get("auto_reject_threshold", DEFAULT_AUTO_REJECT_THRESHOLD)
    fuzzy_token_threshold = cfg.get("fuzzy_token_threshold", DEFAULT_FUZZY_TOKEN_THRESHOLD)
    fuzzy_lev_max = cfg.get("fuzzy_levenshtein_max", DEFAULT_FUZZY_LEVENSHTEIN_MAX)

    acq_records = _get_domain_records(str(acquirer_tenant_id), domain)
    tgt_records = _get_domain_records(str(target_tenant_id), domain)

    if not acq_records and not tgt_records:
        return ResolverOutput(domain=domain)

    identifiers = IDENTIFIER_PRIORITY.get(domain, ["normalized_name"])
    matched_acq: set[str] = set()
    matched_tgt: set[str] = set()
    mappings: list[MappingEntry] = []
    all_decisions: list[DecisionData] = []

    def _add_match(acq_id, tgt_id, conf, tier_name, evidence, acq_props, tgt_props):
        h_acq = _compute_content_hash(acq_props, domain)
        h_tgt = _compute_content_hash(tgt_props, domain)
        state = _determine_hitl_state(conf, auto_accept, auto_reject)
        mappings.append(MappingEntry(
            acquirer_record_id=acq_id, target_record_id=tgt_id,
            confidence=conf, tier=tier_name, hitl_state=state,
            evidence=evidence, content_hash_acq=h_acq, content_hash_tgt=h_tgt,
        ))
        all_decisions.append(DecisionData(
            domain=domain, acquirer_record_id=acq_id, target_record_id=tgt_id,
            confidence=conf, evidence=evidence, tier_matched=tier_name,
            hitl_state=state, content_hash_acq=h_acq, content_hash_tgt=h_tgt,
        ))
        matched_acq.add(acq_id)
        matched_tgt.add(tgt_id)

    # --- Tier 1: Identifier match ---
    for ident in identifiers:
        if ident == "normalized_name":
            continue
        tgt_index: dict[str, str] = {}
        for tgt_id, tgt_props in tgt_records.items():
            if tgt_id in matched_tgt:
                continue
            val = tgt_props.get(ident)
            if val:
                tgt_index[val] = tgt_id

        for acq_id, acq_props in acq_records.items():
            if acq_id in matched_acq:
                continue
            val = acq_props.get(ident)
            if val and val in tgt_index:
                tgt_id = tgt_index[val]
                if tgt_id in matched_tgt:
                    continue
                _add_match(
                    acq_id, tgt_id, 1.0, "identifier",
                    {"tier": "identifier", "identifier_type": ident, "value": val},
                    acq_props, tgt_records[tgt_id],
                )

    # --- Tier 2: Normalized name match ---
    for acq_id, acq_props in acq_records.items():
        if acq_id in matched_acq:
            continue
        acq_norm = acq_props.get("normalized_name", "")
        if not acq_norm:
            continue
        for tgt_id, tgt_props in tgt_records.items():
            if tgt_id in matched_tgt:
                continue
            if acq_norm == tgt_props.get("normalized_name", ""):
                _add_match(
                    acq_id, tgt_id, 0.92, "normalized_name",
                    {"tier": "normalized_name", "normalized": acq_norm},
                    acq_props, tgt_props,
                )
                break

    # --- Tier 3: Fuzzy name match ---
    for acq_id, acq_props in acq_records.items():
        if acq_id in matched_acq:
            continue
        acq_name = acq_props.get("display_name", "")
        if not acq_name:
            continue
        best_score = 0.0
        best_lev = 999
        best_tgt_id = None

        for tgt_id, tgt_props in tgt_records.items():
            if tgt_id in matched_tgt:
                continue
            tgt_name = tgt_props.get("display_name", "")
            if not tgt_name:
                continue
            tsr = token_sort_ratio(acq_name, tgt_name)
            lev = levenshtein(normalize_name(acq_name), normalize_name(tgt_name))
            if tsr > fuzzy_token_threshold and lev <= fuzzy_lev_max:
                if tsr > best_score or (tsr == best_score and lev < best_lev):
                    best_score = tsr
                    best_lev = lev
                    best_tgt_id = tgt_id

        if best_tgt_id is not None:
            conf = round(0.60 + (best_score - fuzzy_token_threshold) * (0.30 / (1.0 - fuzzy_token_threshold)), 2)
            conf = min(max(conf, 0.60), 0.90)
            _add_match(
                acq_id, best_tgt_id, conf, "fuzzy",
                {"tier": "fuzzy", "token_sort_ratio": round(best_score, 3), "levenshtein": best_lev},
                acq_props, tgt_records[best_tgt_id],
            )

    # --- Tier 4: Embedding similarity (STUB — WP3.5) ---

    # --- Tier 5: No match ---
    unmatched_acq = [rid for rid in acq_records if rid not in matched_acq]
    unmatched_tgt = [rid for rid in tgt_records if rid not in matched_tgt]

    for acq_id in unmatched_acq:
        all_decisions.append(DecisionData(
            domain=domain, acquirer_record_id=acq_id, target_record_id=None,
            confidence=0.0, evidence={"tier": "no_match"}, tier_matched="no_match",
            hitl_state="no_match",
            content_hash_acq=_compute_content_hash(acq_records[acq_id], domain),
            content_hash_tgt=None,
        ))

    return ResolverOutput(
        domain=domain,
        mappings=mappings,
        unmatched_acq=unmatched_acq,
        unmatched_tgt=unmatched_tgt,
        decisions=all_decisions,
    )


def resolve_all_domains(
    engagement_id: str | UUID,
    acquirer_tenant_id: str | UUID,
    target_tenant_id: str | UUID,
    config: dict | None = None,
) -> list[ResolverOutput]:
    """Resolve all business_record domains for an engagement pair."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            acq_domains = set()
            tgt_domains = set()
            for tid, domain_set in [
                (str(acquirer_tenant_id), acq_domains),
                (str(target_tenant_id), tgt_domains),
            ]:
                cur.execute(
                    """
                    SELECT DISTINCT split_part(concept, '.', 1)
                    FROM semantic_triples
                    WHERE tenant_id = %s::uuid
                      AND is_active = true
                      AND property = 'namespace_type'
                      AND value #>> '{}' = 'business_record'
                    """,
                    (tid,),
                )
                for (d,) in cur.fetchall():
                    domain_set.add(d)

    all_domains = sorted(acq_domains | tgt_domains)
    results = []
    for domain in all_domains:
        output = resolve(
            engagement_id=engagement_id,
            domain=domain,
            acquirer_tenant_id=acquirer_tenant_id,
            target_tenant_id=target_tenant_id,
            config=config,
        )
        results.append(output)
    return results
