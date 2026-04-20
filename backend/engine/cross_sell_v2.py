"""
CrossSellEngineV2 — cross-sell opportunity scoring.

Uses resolver unmatched records (when available) to identify entity-exclusive
customers. Falls back to convergence_triples concept-matching when no resolver data.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from backend.core.db import get_connection
from backend.engine.overlap_v2 import OverlapEngineV2
from backend.utils.log_utils import get_logger

if TYPE_CHECKING:
    from backend.engine.engagement_data import EngagementData

logger = get_logger(__name__)


def _to_float(value, context: str = "") -> float:
    """Convert a JSONB value to float. Raises on failure — financial data must not silently become zero."""
    if value is None:
        raise ValueError(f"Null numeric value{' in ' + context if context else ''}")
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise ValueError(f"Cannot convert {value!r} to numeric{' in ' + context if context else ''}: {e}")


class CrossSellEngineV2:
    """
    Cross-sell opportunity scoring from overlap analysis.

    Identifies services that Entity A offers to shared customers
    that Entity B could also offer (and vice versa).

    Computes propensity scores from customer and service triples.
    """

    def __init__(self, eng_data: EngagementData, pipeline_run_id: str | None = None):
        self._eng = eng_data
        self.tenant_id = eng_data.tenant_id
        self.pipeline_run_id = pipeline_run_id
        self._overlap_engine = OverlapEngineV2(eng_data, pipeline_run_id)

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
        """Get the two entity_ids, ordered descending (entity_a first)."""
        return self._overlap_engine._get_entities()

    def _get_service_portfolio(self, entity_id: str) -> list[dict]:
        """
        Get service portfolio for an entity from service.* triples.
        Returns list of {"concept": str, "typical_acv": float, "description": str,
                         "delivery_model": str}.
        """
        sql = f"""
            SELECT DISTINCT ON (concept, property)
                   concept, property, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept LIKE 'service.%%'
              AND entity_id = %s
            ORDER BY concept, property, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, entity_id])

        # Group by concept
        services: dict[str, dict] = {}
        for row in rows:
            concept = row["concept"]
            if concept not in services:
                services[concept] = {"concept": concept}
            services[concept][row["property"]] = row["value"]

        result = []
        for concept, props in sorted(services.items()):
            result.append({
                "concept": concept,
                "typical_acv": _to_float(props.get("typical_acv", 0), context=f"service {concept} typical_acv"),
                "description": str(props.get("description", "")),
                "delivery_model": str(props.get("delivery_model", "")),
            })
        return result

    def _get_exclusive_customer_data(self, entity_id: str, other_entity_id: str) -> dict[str, dict]:
        """Get customer data for customers exclusive to entity_id.

        When resolver data exists: uses resolver unmatched records for the entity's side.
        When no resolver data: SQL NOT EXISTS against convergence_triples.
        """
        if self._eng.has_resolver_data("customer"):
            role = self._eng.role_for_entity_id(entity_id)
            unmatched_ids = self._eng.get_unmatched_records("customer", side=role)
            if not unmatched_ids:
                return {}
            placeholders = ", ".join(["%s"] * len(unmatched_ids))
            sql = f"""
                SELECT DISTINCT ON (concept, property)
                       concept, property, value
                FROM convergence_triples
                WHERE tenant_id = %s AND {self._run_clause}
                  AND concept IN ({placeholders})
                  AND entity_id = %s
                  AND property IN ('revenue', 'industry', 'segment', 'size', 'avg_service_spend')
                ORDER BY concept, property, created_at DESC
            """
            rows = self._query(
                sql,
                [self.tenant_id, *self._run_params] + unmatched_ids + [entity_id],
            )
        else:
            sql = f"""
                SELECT DISTINCT ON (st.concept, st.property)
                       st.concept, st.property, st.value
                FROM convergence_triples st
                WHERE st.tenant_id = %s AND st.{self._run_clause}
                  AND st.concept LIKE 'customer.%%'
                  AND st.concept NOT LIKE 'customer.%%.%%'
                  AND st.entity_id = %s
                  AND st.property IN ('revenue', 'industry', 'segment', 'size', 'avg_service_spend')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM convergence_triples other
                      WHERE other.tenant_id = %s AND other.{self._run_clause}
                        AND other.concept = st.concept
                        AND other.concept LIKE 'customer.%%'
                        AND other.concept NOT LIKE 'customer.%%.%%'
                        AND other.entity_id = %s
                  )
                ORDER BY st.concept, st.property, st.created_at DESC
            """
            rows = self._query(sql, [self.tenant_id, *self._run_params, entity_id, self.tenant_id, *self._run_params, other_entity_id])

        customers: dict[str, dict] = {}
        for row in rows:
            concept = row["concept"]
            if concept not in customers:
                customers[concept] = {}
            customers[concept][row["property"]] = row["value"]

        return customers

    @staticmethod
    def _validate_customer_props(
        customer_concept: str,
        props: dict,
        entity_id: str,
        tenant_id: str,
    ) -> None:
        """
        Ensure every customer carries the properties propensity scoring requires.

        Raises ValueError with full identity context when any are absent — we refuse
        to silently default to moderate scores (A1). A missing property here means
        Farm's CustomerProfileTripleGenerator did not run (or did not reach
        convergence_triples), which Console's `convergence_overlay` stage is
        responsible for ensuring.
        """
        # Cross-sell operates on entity-exclusive customers (customers in one
        # entity but not the other). match_confidence is an overlap-only
        # property (written by Farm's OverlapTripleGenerator for shared
        # customers) — it does NOT exist for exclusives by construction.
        # Requiring it here would mean cross-sell can never run. Propensity
        # scoring derives relationship_strength from `segment` instead.
        required_numeric = ("revenue", "size")
        required_string = ("industry", "segment")
        missing = [
            k for k in (*required_numeric, *required_string)
            if props.get(k) in (None, "")
        ]
        if missing:
            raise ValueError(
                f"CrossSellEngineV2: customer '{customer_concept}' "
                f"(entity_id='{entity_id}', tenant_id='{tenant_id}') is missing "
                f"required scoring properties: {missing}. "
                f"Verify Farm generated customer.* triples and Console's "
                f"convergence_overlay stage pushed them into convergence_triples."
            )
        for k in required_numeric:
            try:
                float(props[k])
            except (TypeError, ValueError) as e:
                raise ValueError(
                    f"CrossSellEngineV2: customer '{customer_concept}' "
                    f"(entity_id='{entity_id}', tenant_id='{tenant_id}') has "
                    f"non-numeric '{k}'={props[k]!r}: {e}"
                )

    def _compute_propensity_score(
        self,
        customer_props: dict,
        service_acv: float,
        delivery_model: str,
    ) -> dict:
        """
        Compute propensity sub-scores from customer triple properties.

        Assumes customer_props has already passed _validate_customer_props.

        Scoring rubric:
          industry_match (0-25): Enterprise customers in services-aligned industries score higher
          size_match (0-20): Larger customers (by employee count) are better targets
          behavioral_score (0-30): Higher current engagement revenue = stronger signal
          engagement_fit (0-15): Service ACV relative to customer engagement
          relationship_strength (0-10): Segment-based — enterprise customers
              have deeper, multi-stakeholder relationships that convert more
              easily to cross-sell than SMB customers. Segment is the right
              signal here because cross-sell targets entity-exclusive
              customers, where match_confidence (overlap-only) does not apply.
        """
        revenue = float(customer_props["revenue"])
        size = float(customer_props["size"])
        segment = str(customer_props["segment"]).lower()
        industry = str(customer_props["industry"])

        # industry_match (0-25): known service industries score higher
        services_industries = {
            "professional services", "technology", "financial services",
            "healthcare", "manufacturing", "retail", "energy",
            "telecommunications", "media", "insurance",
        }
        ind_lower = industry.lower()
        if any(si in ind_lower for si in services_industries):
            industry_match = 20
        else:
            industry_match = 12
        # Enterprise segment bonus
        if segment == "enterprise":
            industry_match = min(25, industry_match + 5)
        elif segment == "mid-market":
            industry_match = min(25, industry_match + 2)

        # size_match (0-20): scale by employee count
        if size >= 10000:
            size_match = 20
        elif size >= 5000:
            size_match = 16
        elif size >= 1000:
            size_match = 12
        elif size > 0:
            size_match = 8
        else:
            size_match = 10  # unknown size = moderate

        # behavioral_score (0-30): engagement depth by revenue
        if revenue >= 10.0:
            behavioral_score = 28
        elif revenue >= 5.0:
            behavioral_score = 24
        elif revenue >= 2.0:
            behavioral_score = 18
        elif revenue >= 0.5:
            behavioral_score = 12
        elif revenue > 0:
            behavioral_score = 8
        else:
            behavioral_score = 4

        # engagement_fit (0-15): service ACV fit
        if service_acv >= 5.0:
            engagement_fit = 13
        elif service_acv >= 3.0:
            engagement_fit = 10
        else:
            engagement_fit = 7
        # Delivery model bonus for team-based (lower implementation risk)
        if delivery_model in ("team_based", "hybrid_onshore_nearshore"):
            engagement_fit = min(15, engagement_fit + 2)

        # relationship_strength (0-10): segment depth — enterprise customers
        # have multi-stakeholder relationships (stronger cross-sell propensity)
        # than SMB customers.
        if segment == "enterprise":
            relationship_strength = 10
        elif segment == "mid-market":
            relationship_strength = 6
        elif segment == "smb":
            relationship_strength = 3
        else:
            relationship_strength = 5

        total = industry_match + size_match + behavioral_score + engagement_fit + relationship_strength

        return {
            "propensity_score": total,
            "industry_match": industry_match,
            "size_match": size_match,
            "behavioral_score": behavioral_score,
            "engagement_fit": engagement_fit,
            "relationship_strength": relationship_strength,
        }

    def get_cross_sell_opportunities(self) -> list[dict]:
        """
        For each overlapping customer, identify services from one entity
        that could be offered by the other, with propensity scoring.

        Returns list of:
        {
            "customer": str,
            "customer_id": str,
            "customer_name": str,
            "current_entity": str,
            "opportunity_entity": str,
            "service": str,
            "recommended_service": str,
            "typical_acv": float,
            "estimated_acv": float,
            "propensity_score": int,
            "industry_match": int,
            "size_match": int,
            "behavioral_score": int,
            "engagement_fit": int,
            "relationship_strength": int,
            "customer_engagement_M": float,
            "industry": str,
            "segment": str,
            "buyer_persona": str,
            "years_as_client": int,
            "comparable_customers": list[str],
            "rationale": str,
        }
        """
        entity_a, entity_b = self._get_entities()

        # Get service portfolios
        a_services = self._get_service_portfolio(entity_a)
        b_services = self._get_service_portfolio(entity_b)

        if not a_services:
            raise ValueError(
                f"CrossSellEngineV2: no service.* triples found for entity_id='{entity_a}' "
                f"in tenant_id='{self.tenant_id}'"
            )
        if not b_services:
            raise ValueError(
                f"CrossSellEngineV2: no service.* triples found for entity_id='{entity_b}' "
                f"in tenant_id='{self.tenant_id}'"
            )

        # Determine which services are unique to each entity
        a_concepts = {s["concept"] for s in a_services}
        b_concepts = {s["concept"] for s in b_services}
        a_only = a_concepts - b_concepts
        b_only = b_concepts - a_concepts

        # Get customer data for entity-exclusive customers only (SQL-filtered).
        b_customers = self._get_exclusive_customer_data(entity_b, entity_a)
        a_customers = self._get_exclusive_customer_data(entity_a, entity_b)

        b_exclusive = set(b_customers.keys())
        a_exclusive = set(a_customers.keys())

        if not b_exclusive and not a_exclusive:
            logger.info(
                "CrossSellEngineV2: no entity-exclusive customers found for tenant=%s "
                "(a_customers=%d, b_customers=%d, all shared) — no cross-sell opportunities",
                self.tenant_id, len(a_customers), len(b_customers),
            )
            return []

        # Service lookup dicts
        a_svc_map = {s["concept"]: s for s in a_services}
        b_svc_map = {s["concept"]: s for s in b_services}

        # Buyer persona mapping by delivery model
        persona_map = {
            "senior_partner_led": "CEO / Managing Partner",
            "specialist_led": "CRO / General Counsel",
            "team_based": "COO / VP Operations",
            "hybrid_onshore_nearshore": "CTO / VP Engineering",
            "hybrid_onshore_offshore": "CHRO / VP People",
            "offshore_delivery_center": "CFO / VP Finance",
            "multi_geo_delivery": "COO / SVP Customer Success",
            "nearshore_delivery_center": "COO / VP Supply Chain",
        }

        opportunities = []

        def _build_opportunity(
            customer_concept: str,
            current_entity: str,
            opportunity_entity: str,
            svc: dict,
            customer_props: dict,
        ) -> dict:
            self._validate_customer_props(
                customer_concept, customer_props, opportunity_entity, self.tenant_id,
            )
            customer_name = customer_concept.split(".", 1)[1] if "." in customer_concept else customer_concept
            service_name = svc["concept"].split(".", 1)[1] if "." in svc["concept"] else svc["concept"]
            revenue = float(customer_props["revenue"])
            industry = str(customer_props["industry"])
            segment = str(customer_props["segment"])

            scores = self._compute_propensity_score(
                customer_props, svc["typical_acv"], svc.get("delivery_model", ""),
            )

            # Estimated ACV from customer's actual spending pattern (Farm-generated),
            # falling back to service typical ACV if the customer has no spend history yet
            spend_raw = customer_props.get("avg_service_spend")
            estimated_acv = round(
                float(spend_raw) if spend_raw not in (None, "") else svc["typical_acv"],
                2,
            )

            return {
                "customer": customer_name,
                "customer_id": customer_name,
                "customer_name": customer_name.replace("_", " ").title(),
                "current_entity": current_entity,
                "opportunity_entity": opportunity_entity,
                "service": service_name,
                "recommended_service": service_name.replace("_", " ").title(),
                "typical_acv": svc["typical_acv"],
                "estimated_acv": estimated_acv,
                **scores,
                "customer_engagement_M": round(revenue, 2),
                "industry": industry,
                "segment": segment,
                "buyer_persona": persona_map.get(svc.get("delivery_model", ""), "CFO"),
                "years_as_client": 3,  # Not in triples — use reasonable default
                "comparable_customers": [],
                "rationale": (
                    f"{current_entity} offers {service_name} "
                    f"(typical ACV ${svc['typical_acv']}M). "
                    f"{customer_name.replace('_', ' ').title()} is an exclusive "
                    f"{opportunity_entity} client with ${revenue}M engagement — "
                    f"estimated ${estimated_acv}M based on spending pattern."
                ),
            }

        # Direction a_to_b: Entity A's unique services → entity B's exclusive clients
        for svc in a_services:
            if svc["concept"] not in a_only:
                continue
            for customer_concept in sorted(b_exclusive):
                opportunities.append(_build_opportunity(
                    customer_concept, entity_a, entity_b, svc, b_customers[customer_concept],
                ))

        # Direction b_to_a: Entity B's unique services → entity A's exclusive clients
        for svc in b_services:
            if svc["concept"] not in b_only:
                continue
            for customer_concept in sorted(a_exclusive):
                opportunities.append(_build_opportunity(
                    customer_concept, entity_b, entity_a, svc, a_customers[customer_concept],
                ))

        # Sort by propensity score descending
        opportunities.sort(key=lambda x: x["propensity_score"], reverse=True)

        # Add comparable customers: top 2 customers with highest propensity in same direction.
        # Pre-index by (service, opportunity_entity) to avoid O(n²) scan.
        comp_index: dict[tuple[str, str], list[str]] = defaultdict(list)
        for opp in opportunities:
            if opp["propensity_score"] >= 70:
                key = (opp["service"], opp["opportunity_entity"])
                comp_index[key].append(opp["customer_name"])

        for opp in opportunities:
            key = (opp["service"], opp["opportunity_entity"])
            candidates = comp_index.get(key, [])
            opp["comparable_customers"] = [c for c in candidates if c != opp["customer_name"]][:2]

        logger.info(
            "CrossSellEngineV2: %d opportunities (%d a_to_b, %d b_to_a) "
            "from %d/%d exclusive customers for tenant=%s",
            len(opportunities),
            sum(1 for o in opportunities if o["opportunity_entity"] == entity_b),
            sum(1 for o in opportunities if o["opportunity_entity"] == entity_a),
            len(b_exclusive),
            len(a_exclusive),
            self.tenant_id,
        )

        return opportunities

    def get_cross_sell_summary(self) -> dict:
        """
        Returns:
        {
            "total_opportunities": int,
            "total_potential_acv": float,
            "by_service": [{"service": str, "count": int, "total_acv": float}],
            "by_direction": {"a_to_b": int, "b_to_a": int}
        }
        """
        entity_a, entity_b = self._get_entities()
        opportunities = self.get_cross_sell_opportunities()

        total_acv = sum(o["typical_acv"] for o in opportunities)

        # Group by service
        service_map: dict[str, dict] = {}
        for o in opportunities:
            svc = o["service"]
            if svc not in service_map:
                service_map[svc] = {"service": svc, "count": 0, "total_acv": 0.0}
            service_map[svc]["count"] += 1
            service_map[svc]["total_acv"] += o["typical_acv"]

        by_service = sorted(service_map.values(), key=lambda x: x["total_acv"], reverse=True)

        # Round ACVs
        for entry in by_service:
            entry["total_acv"] = round(entry["total_acv"], 2)

        # Count by direction
        a_to_b = sum(1 for o in opportunities if o["opportunity_entity"] == entity_b)
        b_to_a = sum(1 for o in opportunities if o["opportunity_entity"] == entity_a)

        return {
            "total_opportunities": len(opportunities),
            "total_potential_acv": round(total_acv, 2),
            "by_service": by_service,
            "by_direction": {"a_to_b": a_to_b, "b_to_a": b_to_a},
        }
