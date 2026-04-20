"""
OverlapEngineV2 — entity overlap analysis using resolver decisions + convergence_triples.

For domains covered by the identity resolver (customer, vendor, employee):
overlap is determined from resolver_decisions (confirmed + auto_accepted mappings).

For domains not covered by the resolver (it_asset):
falls back to concept-name matching in convergence_triples.
"""

from __future__ import annotations

import re as _re
from typing import TYPE_CHECKING

from backend.core.db import get_connection
from backend.utils.log_utils import get_logger

if TYPE_CHECKING:
    from backend.engine.engagement_data import EngagementData

logger = get_logger(__name__)

_ALLOWED_DOMAINS = ("customer", "vendor", "employee", "it_asset")
_RESOLVER_DOMAINS = ("customer", "vendor", "employee")

_NUMERIC_RE = _re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _safe_sort_float(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().strip('"')
    if _NUMERIC_RE.match(s):
        return float(s)
    return 0.0


class OverlapEngineV2:
    """Entity overlap analysis. Resolver-backed for customer/vendor/employee."""

    def __init__(self, eng_data: EngagementData, pipeline_run_id: str | None = None):
        self._eng = eng_data
        self.tenant_id = eng_data.tenant_id
        self.pipeline_run_id = pipeline_run_id

    @property
    def _run_clause(self) -> str:
        """SQL WHERE fragment for run scoping."""
        return "run_id = %s" if self.pipeline_run_id else "is_active = true"

    @property
    def _run_params(self) -> list:
        """SQL params for the run filter (empty when using is_active)."""
        return [self.pipeline_run_id] if self.pipeline_run_id else []

    def _query(self, sql: str, params: list) -> list[dict]:
        """Execute a parameterized query and return rows as dicts."""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _get_entities(self) -> tuple[str, str]:
        return self._eng.entity_a_id, self._eng.entity_b_id

    def _use_resolver(self, domain: str) -> bool:
        """Check if resolver data exists for this domain."""
        return domain in _RESOLVER_DOMAINS and self._eng.has_resolver_data(domain)

    def _get_resolver_overlap(self, domain: str) -> list[str]:
        """Get overlapping concept names from resolver confirmed mappings."""
        mappings = self._eng.get_resolved_mappings(domain)
        return [m["acquirer_record_id"] for m in mappings]

    def _count_records_from_resolver(self, domain: str, entity_id: str) -> int:
        """Count total records for one entity from resolver decisions."""
        from backend.db import resolver_store
        all_decisions = resolver_store.get_decisions(
            self._eng.engagement_id, domain=domain,
        )
        if entity_id == self._eng.entity_a_id:
            return len({d["acquirer_record_id"] for d in all_decisions})
        return len({
            d["target_record_id"] for d in all_decisions
            if d["target_record_id"] is not None
        })

    def _count_concepts_for_entity(self, domain: str, entity_id: str) -> int:
        """Count distinct entity-level concepts in a domain for a specific entity.

        Excludes subcategory concepts and domain-level KPIs (single-property
        aggregate metrics like customer.acv) — counts only actual business
        entities (companies, vendors, employees).
        """
        sql = f"""
            SELECT COUNT(*) as cnt FROM (
                SELECT concept
                FROM convergence_triples
                WHERE tenant_id = %s AND {self._run_clause}
                  AND concept LIKE %s
                  AND concept NOT LIKE %s
                  AND entity_id = %s
                GROUP BY concept
                HAVING COUNT(DISTINCT property) > 1
            ) sub
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, f"{domain}.%", f"{domain}.%.%", entity_id])
        return rows[0]["cnt"] if rows else 0

    def _find_overlapping_concepts(self, domain: str) -> list[str]:
        """Find entity-level concepts in a domain that appear under both entity_ids.

        Excludes subcategory concepts (e.g. customer.pipeline.closed_won) which
        represent structural metadata, not actual entity overlaps.
        Also excludes domain-level KPI concepts (e.g. customer.acv, customer.nps)
        which have only a single property and represent aggregate metrics,
        not actual business entities.
        """
        sql = f"""
            SELECT concept
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept LIKE %s
              AND concept NOT LIKE %s
            GROUP BY concept
            HAVING COUNT(DISTINCT entity_id) > 1
              AND COUNT(DISTINCT property) > 1
            ORDER BY concept
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, f"{domain}.%", f"{domain}.%.%"])
        return [r["concept"] for r in rows]

    def get_overlap_summary(self) -> dict:
        """Returns overlap summary per domain.

        Uses resolver decisions for customer/vendor/employee when available.
        Falls back to convergence_triples concept-matching for it_asset
        or when no resolver data exists.
        """
        entity_a, entity_b = self._get_entities()
        summary = {}

        for domain in _ALLOWED_DOMAINS:
            if self._use_resolver(domain):
                overlapping = self._get_resolver_overlap(domain)
                overlap_count = len(overlapping)
                a_total = self._count_records_from_resolver(domain, entity_a)
                b_total = self._count_records_from_resolver(domain, entity_b)
            else:
                overlapping = self._find_overlapping_concepts(domain)
                overlap_count = len(overlapping)
                a_total = self._count_concepts_for_entity(domain, entity_a)
                b_total = self._count_concepts_for_entity(domain, entity_b)

            overlap_pct_a = round(overlap_count / a_total * 100, 2) if a_total > 0 else 0.0
            overlap_pct_b = round(overlap_count / b_total * 100, 2) if b_total > 0 else 0.0

            summary[domain] = {
                "overlap_count": overlap_count,
                "entity_a_total": a_total,
                "entity_b_total": b_total,
                "overlap_pct_a": overlap_pct_a,
                "overlap_pct_b": overlap_pct_b,
                "source": "resolver" if self._use_resolver(domain) else "concept_match",
            }

        logger.info(
            "OverlapEngineV2.get_overlap_summary: %s for tenant=%s",
            {d: s["overlap_count"] for d, s in summary.items()},
            self.tenant_id,
        )
        return summary

    def get_overlapping_concepts(self, domain: str) -> list[dict]:
        """Returns overlapping concepts with properties from both entities.

        When resolver data exists: matched pairs from resolver_decisions, with
        each pair's properties fetched from convergence_triples.
        When no resolver data: concept-name matching in convergence_triples.
        """
        if domain not in _ALLOWED_DOMAINS:
            raise ValueError(
                f"Invalid domain '{domain}'. Must be one of: {', '.join(_ALLOWED_DOMAINS)}"
            )

        entity_a, entity_b = self._get_entities()

        if self._use_resolver(domain):
            return self._get_resolver_overlapping_concepts(domain, entity_a, entity_b)

        overlapping = self._find_overlapping_concepts(domain)

        if not overlapping:
            return []

        # Fetch all properties for overlapping concepts in one query
        placeholders = ", ".join(["%s"] * len(overlapping))
        sql = f"""
            SELECT concept, entity_id, property, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept IN ({placeholders})
            ORDER BY concept, entity_id, property
        """
        params = [self.tenant_id, *self._run_params] + overlapping
        rows = self._query(sql, params)

        # Organize by concept → entity → properties
        concept_data: dict[str, dict[str, dict]] = {}
        for row in rows:
            concept = row["concept"]
            eid = row["entity_id"]
            prop = row["property"]
            val = row["value"]

            if concept not in concept_data:
                concept_data[concept] = {}
            if eid not in concept_data[concept]:
                concept_data[concept][eid] = {}
            concept_data[concept][eid][prop] = val

        result = []
        for concept in overlapping:
            props = concept_data.get(concept, {})
            result.append({
                "concept": concept,
                "entity_a_properties": props.get(entity_a, {}),
                "entity_b_properties": props.get(entity_b, {}),
            })

        return result

    def _get_resolver_overlapping_concepts(
        self, domain: str, entity_a: str, entity_b: str,
    ) -> list[dict]:
        """Build overlapping concept list from resolver matched pairs.

        For each confirmed mapping, fetch properties for both the acquirer
        and target record from convergence_triples.
        """
        mappings = self._eng.get_resolved_mappings(domain)
        if not mappings:
            return []

        acq_concepts = [m["acquirer_record_id"] for m in mappings]
        tgt_concepts = [m["target_record_id"] for m in mappings]
        all_concepts = list(set(acq_concepts + tgt_concepts))

        placeholders = ", ".join(["%s"] * len(all_concepts))
        sql = f"""
            SELECT concept, entity_id, property, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept IN ({placeholders})
            ORDER BY concept, entity_id, property
        """
        params = [self.tenant_id, *self._run_params] + all_concepts
        rows = self._query(sql, params)

        concept_data: dict[str, dict[str, dict]] = {}
        for row in rows:
            concept = row["concept"]
            eid = row["entity_id"]
            if concept not in concept_data:
                concept_data[concept] = {}
            if eid not in concept_data[concept]:
                concept_data[concept][eid] = {}
            concept_data[concept][eid][row["property"]] = row["value"]

        result = []
        for m in mappings:
            acq_id = m["acquirer_record_id"]
            tgt_id = m["target_record_id"]
            result.append({
                "concept": acq_id,
                "matched_concept": tgt_id,
                "confidence": m["confidence"],
                "tier": m["tier_matched"],
                "entity_a_properties": concept_data.get(acq_id, {}).get(entity_a, {}),
                "entity_b_properties": concept_data.get(tgt_id, {}).get(entity_b, {}),
            })
        return result

    def get_entity_only_concepts(self, domain: str, entity_id: str) -> list[str]:
        """Concepts in domain that appear ONLY under the given entity."""
        if domain not in _ALLOWED_DOMAINS:
            raise ValueError(
                f"Invalid domain '{domain}'. Must be one of: {', '.join(_ALLOWED_DOMAINS)}"
            )

        if self._use_resolver(domain):
            role = self._eng.role_for_entity_id(entity_id)
            return self._eng.get_unmatched_records(domain, side=role)

        overlapping_set = set(self._find_overlapping_concepts(domain))

        sql = f"""
            SELECT concept
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept LIKE %s
              AND concept NOT LIKE %s
              AND entity_id = %s
            GROUP BY concept
            HAVING COUNT(DISTINCT property) > 1
            ORDER BY concept
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, f"{domain}.%", f"{domain}.%.%", entity_id])
        all_concepts = [r["concept"] for r in rows]

        return [c for c in all_concepts if c not in overlapping_set]

    def get_overlap_by_property(self, domain: str, property_name: str) -> list[dict]:
        """Compare a specific property across overlapping concepts."""
        if domain not in _ALLOWED_DOMAINS:
            raise ValueError(
                f"Invalid domain '{domain}'. Must be one of: {', '.join(_ALLOWED_DOMAINS)}"
            )

        entity_a, entity_b = self._get_entities()

        if self._use_resolver(domain):
            overlapping = self._get_resolver_overlap(domain)
        else:
            overlapping = self._find_overlapping_concepts(domain)

        if not overlapping:
            return []

        placeholders = ", ".join(["%s"] * len(overlapping))
        sql = f"""
            SELECT concept, entity_id, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept IN ({placeholders})
              AND property = %s
            ORDER BY concept, entity_id
        """
        params = [self.tenant_id, *self._run_params] + overlapping + [property_name]
        rows = self._query(sql, params)

        # Group by concept
        concept_values: dict[str, dict[str, object]] = {}
        for row in rows:
            concept = row["concept"]
            if concept not in concept_values:
                concept_values[concept] = {}
            concept_values[concept][row["entity_id"]] = row["value"]

        result = []
        for concept in overlapping:
            vals = concept_values.get(concept, {})
            result.append({
                "concept": concept,
                "entity_a_value": vals.get(entity_a),
                "entity_b_value": vals.get(entity_b),
            })

        # Sort by entity_a value descending
        def sort_key(item):
            val = item.get("entity_a_value")
            return _safe_sort_float(val)

        result.sort(key=sort_key, reverse=True)
        return result
