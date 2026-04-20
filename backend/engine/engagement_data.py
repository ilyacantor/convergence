"""
EngagementData — engagement-scoped data access layer for all engines.

Resolves engagement_id to entity IDs, provides access to convergence_triples
and resolver_decisions. No singleton cache — one instance per request.

Every engine takes EngagementData instead of (tenant_id, pipeline_run_id).
"""

from backend.core.db import get_connection
from backend.db import engagement_store, resolver_store
from backend.engine.engagement import EngagementConfig, EngagementEntity, _build_config
from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

_CONFIRMED_STATES = ("auto_accepted", "confirmed")


class EngagementData:
    """Engagement-scoped data access for engines.

    Constructed per-request from an engagement_id. Provides entity identity,
    triple queries, and resolver decision access.
    """

    def __init__(self, engagement_id: str):
        row = engagement_store.get_engagement(engagement_id)
        if not row:
            raise ValueError(
                f"Engagement not found: {engagement_id}. "
                f"Verify the engagement exists and has not been archived."
            )
        self._config: EngagementConfig = _build_config(row)
        self._tenant_id: str = str(row["tenant_id"])
        self._engagement_id: str = str(row["engagement_id"])

    @property
    def engagement_id(self) -> str:
        return self._engagement_id

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    @property
    def entity_a_id(self) -> str:
        return self._config.entity_a.id

    @property
    def entity_b_id(self) -> str:
        return self._config.entity_b.id

    @property
    def entity_a_display_name(self) -> str:
        return self._config.entity_a.display_name

    @property
    def entity_b_display_name(self) -> str:
        return self._config.entity_b.display_name

    @property
    def config(self) -> EngagementConfig:
        return self._config

    def entity_id_for_role(self, role: str) -> str:
        if role == "acquirer":
            return self.entity_a_id
        if role == "target":
            return self.entity_b_id
        raise ValueError(f"Invalid role '{role}'. Must be 'acquirer' or 'target'.")

    def role_for_entity_id(self, entity_id: str) -> str:
        if entity_id == self.entity_a_id:
            return "acquirer"
        if entity_id == self.entity_b_id:
            return "target"
        raise ValueError(
            f"Entity '{entity_id}' not in engagement {self._engagement_id}. "
            f"Known: {self.entity_a_id}, {self.entity_b_id}"
        )

    def triple_resolver(self, pipeline_run_id: str | None = None) -> TripleQueryResolver:
        return TripleQueryResolver(self._tenant_id, pipeline_run_id)

    def get_entity_triples(
        self,
        role: str,
        domain: str,
        pipeline_run_id: str | None = None,
    ) -> list[dict]:
        """Get convergence_triples for one entity in a domain.

        role: 'acquirer' or 'target'
        domain: e.g. 'customer', 'revenue', 'vendor'
        """
        entity_id = self.entity_id_for_role(role)
        run_clause = "AND run_id = %s" if pipeline_run_id else "AND is_active = true"
        run_params = [pipeline_run_id] if pipeline_run_id else []

        sql = f"""
            SELECT concept, property, value, period, confidence_score,
                   confidence_tier, entity_id
            FROM convergence_triples
            WHERE tenant_id = %s::uuid
              AND entity_id = %s
              AND concept LIKE %s
              {run_clause}
            ORDER BY concept, property
        """
        params = [self._tenant_id, entity_id, f"{domain}.%"] + run_params

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def get_resolved_mappings(
        self,
        domain: str,
        include_states: tuple[str, ...] = _CONFIRMED_STATES,
    ) -> list[dict]:
        """Get confirmed resolver mappings for a domain.

        Returns matched pairs only — decisions where both sides exist and
        hitl_state is in include_states.
        """
        all_decisions = resolver_store.get_decisions(
            self._engagement_id, domain=domain,
        )
        return [
            d for d in all_decisions
            if d["hitl_state"] in include_states
            and d["target_record_id"] is not None
        ]

    def get_unmatched_records(self, domain: str, side: str = "acquirer") -> list[str]:
        """Get record IDs with no confirmed match.

        side: 'acquirer' — returns acquirer records with tier_matched='no_match'
              'target' — returns target records with tier_matched='no_match'
        """
        all_decisions = resolver_store.get_decisions(
            self._engagement_id, domain=domain,
        )
        if side == "acquirer":
            return [
                d["acquirer_record_id"] for d in all_decisions
                if d["tier_matched"] == "no_match"
            ]
        if side == "target":
            matched_targets = {
                d["target_record_id"] for d in all_decisions
                if d["target_record_id"] is not None
                and d["hitl_state"] in _CONFIRMED_STATES
            }
            all_targets = {
                d["target_record_id"] for d in all_decisions
                if d["target_record_id"] is not None
            }
            return list(all_targets - matched_targets)
        raise ValueError(f"Invalid side '{side}'. Must be 'acquirer' or 'target'.")

    def get_matched_pairs(
        self,
        domain: str,
        pipeline_run_id: str | None = None,
    ) -> list[dict]:
        """Convenience: for each confirmed mapping, fetch both sides' triple data.

        Returns list of {acquirer_record, target_record, confidence, mapping}.
        """
        mappings = self.get_resolved_mappings(domain)
        if not mappings:
            return []

        pairs = []
        for m in mappings:
            acq_triples = self._get_record_triples(
                m["acquirer_record_id"], pipeline_run_id,
            )
            tgt_triples = self._get_record_triples(
                m["target_record_id"], pipeline_run_id,
            )
            pairs.append({
                "acquirer_record": acq_triples,
                "target_record": tgt_triples,
                "confidence": m["confidence"],
                "tier": m["tier_matched"],
                "mapping": m,
            })
        return pairs

    def _get_record_triples(
        self, record_id: str, pipeline_run_id: str | None = None,
    ) -> list[dict]:
        """Fetch all triples for a specific record concept."""
        run_clause = "AND run_id = %s" if pipeline_run_id else "AND is_active = true"
        run_params = [pipeline_run_id] if pipeline_run_id else []

        sql = f"""
            SELECT concept, property, value, period, entity_id,
                   confidence_score, confidence_tier
            FROM convergence_triples
            WHERE tenant_id = %s::uuid
              AND concept = %s
              {run_clause}
            ORDER BY property
        """
        params = [self._tenant_id, record_id] + run_params

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def has_resolver_data(self, domain: str) -> bool:
        """Check if resolver decisions exist for this engagement + domain."""
        decisions = resolver_store.get_decisions(
            self._engagement_id, domain=domain,
        )
        return len(decisions) > 0
