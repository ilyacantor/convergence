"""
QualityOfEarningsV2 — QoE analysis derived from EBITDA bridge and financial triples.

QoE assesses how reliable the reported earnings are by analyzing:
1. Adjustment magnitude relative to EBITDA
2. Confidence distribution of adjustments
3. Revenue quality (recurring vs non-recurring mix)
4. Margin trends over time

All data sourced from convergence_triples in PG — no JSON files.
"""

from backend.core.db import get_connection
from backend.engine.ebitda_bridge_v2 import EBITDABridgeV2
from backend.engine.cross_sell_v2 import CrossSellEngineV2
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

# All periods for trend analysis (12 quarters: 2023-Q1 through 2025-Q4)
_ALL_PERIODS = [
    f"{year}-Q{q}" for year in (2023, 2024, 2025) for q in (1, 2, 3, 4)
]

# 2025 quarters for annual revenue
_ANNUAL_PERIODS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]

# Current year for tenure calculations
_CURRENT_YEAR = 2026


def _to_float(value) -> float:
    """Convert a JSONB value to float."""
    return float(value)


class QualityOfEarningsV2:
    """
    Quality of Earnings analysis derived from EBITDA bridge and financial triples.

    QoE assesses how reliable the reported earnings are by analyzing:
    1. Adjustment magnitude relative to EBITDA
    2. Confidence distribution of adjustments
    3. Revenue quality (recurring vs non-recurring mix)
    4. Margin trends over time
    """

    def __init__(self, tenant_id: str, pipeline_run_id: str):
        self.tenant_id = tenant_id
        self.pipeline_run_id = pipeline_run_id
        self._bridge_engine = EBITDABridgeV2(tenant_id, pipeline_run_id)

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

    def _get_metric(self, concept: str, entity_id: str, period: str) -> float | None:
        """Get a single metric value, returning None if not found."""
        sql = f"""
            SELECT DISTINCT ON (entity_id, concept, period)
                   value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept = %s AND entity_id = %s AND period = %s
              AND property = 'amount'
            ORDER BY entity_id, concept, period, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, concept, entity_id, period])
        if not rows:
            return None
        return _to_float(rows[0]["value"])

    def _get_revenue_streams(self, entity_id: str) -> list[dict]:
        """Get all revenue.* concepts for an entity across 2025 quarters.

        Uses a CTE with DISTINCT ON to dedup across runs before aggregating.
        """
        placeholders = ", ".join(["%s"] * len(_ANNUAL_PERIODS))
        sql = f"""
            WITH deduped AS (
                SELECT DISTINCT ON (entity_id, concept, period)
                       concept, period, value
                FROM convergence_triples
                WHERE tenant_id = %s AND {self._run_clause}
                  AND concept LIKE 'revenue.%%'
                  AND entity_id = %s
                  AND property = 'amount'
                  AND period IN ({placeholders})
                ORDER BY entity_id, concept, period, created_at DESC
            )
            SELECT concept, SUM((value #>> '{{}}')::float) as total_value
            FROM deduped
            GROUP BY concept
            ORDER BY SUM((value #>> '{{}}')::float) DESC
        """
        params = [self.tenant_id, *self._run_params, entity_id] + _ANNUAL_PERIODS
        return self._query(sql, params)

    def _get_margin_trend(self, entity_id: str) -> list[dict]:
        """Get EBITDA margin trend across all available periods."""
        # Get revenue.total and pnl.ebitda for each period
        sql = f"""
            SELECT DISTINCT ON (entity_id, concept, period)
                   period, concept, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept IN ('revenue.total', 'pnl.ebitda')
              AND entity_id = %s
              AND property = 'amount'
            ORDER BY entity_id, concept, period, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, entity_id])

        # Group by period
        by_period: dict[str, dict[str, float]] = {}
        for row in rows:
            period = row["period"]
            if period not in by_period:
                by_period[period] = {}
            by_period[period][row["concept"]] = _to_float(row["value"])

        # Calculate margins
        trend = []
        for period in sorted(by_period.keys()):
            data = by_period[period]
            rev = data.get("revenue.total")
            ebitda = data.get("pnl.ebitda")
            if rev is not None and ebitda is not None and rev != 0:
                margin = round(ebitda / rev * 100, 2)
                trend.append({"period": period, "ebitda_margin": margin})

        return trend

    def _get_all_customer_data(self, entity_id: str) -> list[dict]:
        """Get all customer.* triples for an entity, grouped by concept.

        Queries customer.% NOT LIKE customer.%.% to get top-level customer
        concepts only (not customer_service subcategories).

        Returns list of dicts, each with properties for one customer:
        {"concept": str, "revenue": float, "industry": str, ...}
        """
        sql = f"""
            SELECT DISTINCT ON (concept, property)
                   concept, property, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept LIKE 'customer.%%'
              AND concept NOT LIKE 'customer.%%.%%'
              AND entity_id = %s
            ORDER BY concept, property, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, entity_id])

        customers: dict[str, dict] = {}
        for row in rows:
            concept = row["concept"]
            if concept not in customers:
                customers[concept] = {"concept": concept}
            customers[concept][row["property"]] = row["value"]

        return list(customers.values())

    def _get_customer_service_data(self, entity_id: str) -> list[dict]:
        """Get customer_service.* triples for engagement data.

        Returns list of dicts with per-engagement properties:
        {"concept": str, "engagement_start_year": float, "contract_type": str, ...}
        """
        sql = f"""
            SELECT DISTINCT ON (concept, property)
                   concept, property, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept LIKE 'customer_service.%%'
              AND entity_id = %s
            ORDER BY concept, property, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, entity_id])

        engagements: dict[str, dict] = {}
        for row in rows:
            concept = row["concept"]
            if concept not in engagements:
                engagements[concept] = {"concept": concept}
            engagements[concept][row["property"]] = row["value"]

        return list(engagements.values())

    def _compute_full_revenue_quality(
        self,
        entity_id: str,
        revenue_streams: list[dict],
        total_revenue: float,
        *,
        customers: list[dict] | None = None,
        cs_engagements: list[dict] | None = None,
    ) -> dict:
        """Compute the full revenue_quality shape matching the frontend QofEData type.

        Computes customer concentration, contract quality, revenue mix,
        cohort retention, and cross-sell penetration from convergence_triples.

        Pass pre-computed customers/cs_engagements to override the default
        single-entity query (used by the combined summary to merge both entities).
        """
        if customers is None:
            customers = self._get_all_customer_data(entity_id)
        if cs_engagements is None:
            cs_engagements = self._get_customer_service_data(entity_id)

        # ── Customer Concentration ──
        revenues = sorted(
            [
                float(c["revenue"])
                for c in customers
                if c.get("revenue") is not None and float(c["revenue"]) > 0
            ],
            reverse=True,
        )
        total_cust_rev = sum(revenues)
        top_10_rev = sum(revenues[:10])
        top_20_rev = sum(revenues[:20])
        top_50_rev = sum(revenues[:50])
        top_10_pct = (top_10_rev / total_cust_rev * 100) if total_cust_rev > 0 else 0
        top_20_pct = (top_20_rev / total_cust_rev * 100) if total_cust_rev > 0 else 0
        top_50_pct = (top_50_rev / total_cust_rev * 100) if total_cust_rev > 0 else 0

        # HHI: sum of squared market shares (each share as a percentage)
        shares = [(r / total_cust_rev * 100) for r in revenues] if total_cust_rev > 0 else []
        hhi = sum(s * s for s in shares)

        # Concentration threshold alerts
        threshold_alerts = []
        for c in customers:
            rev = float(c.get("revenue", 0)) if c.get("revenue") is not None else 0
            if total_cust_rev > 0 and rev > 0:
                pct = rev / total_cust_rev * 100
                # Extract customer name from concept (customer.{name})
                cust_name = c["concept"].split(".", 1)[1] if "." in c["concept"] else c["concept"]
                if pct >= 10:
                    threshold_alerts.append({"customer": cust_name, "pct": round(pct, 2), "threshold": "10%"})
                elif pct >= 5:
                    threshold_alerts.append({"customer": cust_name, "pct": round(pct, 2), "threshold": "5%"})

        # ── Contract Quality ──
        # Triple data uses contract_type values: recurring, project, retainer
        # Map to frontend categories: MSA (recurring), SOW (project), T&M (retainer)
        _CT_MAP = {"recurring": "MSA", "project": "SOW", "retainer": "T&M"}
        contract_counts: dict[str, int] = {"MSA": 0, "SOW": 0, "T&M": 0}
        tenure_years_list: list[int] = []

        for eng in cs_engagements:
            raw_ct = str(eng.get("contract_type", "")) if eng.get("contract_type") is not None else ""
            ct = _CT_MAP.get(raw_ct, raw_ct)
            if ct in contract_counts:
                contract_counts[ct] += 1
            start_year = eng.get("engagement_start_year")
            if start_year is not None:
                try:
                    yrs = _CURRENT_YEAR - int(float(start_year))
                    if yrs > 0:
                        tenure_years_list.append(yrs)
                except (TypeError, ValueError):
                    pass

        total_contracts = sum(contract_counts.values()) or 1
        msa_pct = contract_counts["MSA"] / total_contracts * 100
        sow_pct = contract_counts["SOW"] / total_contracts * 100
        t_and_m_pct = contract_counts["T&M"] / total_contracts * 100
        avg_tenure = sum(tenure_years_list) / len(tenure_years_list) if tenure_years_list else 0

        # ── Revenue Mix ──
        # Map stream concepts to the frontend fields
        stream_map: dict[str, float] = {}
        for s in revenue_streams:
            stream_map[s["concept"]] = round(float(s["total_value"]), 2)

        managed_services_M = stream_map.get("revenue.managed_services", 0.0)
        per_fte_M = stream_map.get("revenue.per_fte", 0.0)
        per_transaction_M = stream_map.get("revenue.per_transaction", 0.0)
        # T&M / consulting is recurring (ongoing client engagements)
        consulting_tm_M = (
            stream_map.get("revenue.consulting", 0.0)
            or stream_map.get("revenue.advisory", 0.0)
            or stream_map.get("revenue.advisory_consulting", 0.0)
        )
        # Fixed-fee is non-recurring (project-based)
        fixed_fee_M = stream_map.get("revenue.fixed_fee", 0.0)

        recurring_rev = consulting_tm_M + managed_services_M + per_fte_M + per_transaction_M
        non_recurring_rev = fixed_fee_M
        total_mix = recurring_rev + non_recurring_rev
        recurring_pct = (recurring_rev / total_mix * 100) if total_mix > 0 else 0
        non_recurring_pct = (non_recurring_rev / total_mix * 100) if total_mix > 0 else 0

        # ── Cohort Retention ──
        cohorts: dict[int, float] = {}
        for c in customers:
            rev = float(c.get("revenue", 0)) if c.get("revenue") is not None else 0
            if rev <= 0:
                continue
            # Find engagement_start_year from customer_service data for this customer
            cust_norm = c["concept"].split(".", 1)[1] if "." in c["concept"] else ""
            # Look for customer_service.{cust_norm}.* entries
            for eng in cs_engagements:
                parts = eng["concept"].split(".", 2)
                if len(parts) >= 2 and parts[1] == cust_norm:
                    start_year = eng.get("engagement_start_year")
                    if start_year is not None:
                        try:
                            yrs = _CURRENT_YEAR - int(float(start_year))
                            if yrs > 0:
                                cohorts.setdefault(yrs, 0)
                                cohorts[yrs] += rev
                        except (TypeError, ValueError):
                            pass
                    break  # one tenure per customer is enough

        cohort_retention = [
            {"years_as_client": yr, "total_revenue_M": round(rev, 2)}
            for yr, rev in sorted(cohorts.items())
        ]

        # ── Cross-sell Penetration ──
        cross_sell_engine = CrossSellEngineV2(self.tenant_id, self.pipeline_run_id)
        cs_summary = cross_sell_engine.get_cross_sell_summary()
        total_candidates = cs_summary["total_opportunities"]
        total_pipeline_acv_M = round(cs_summary["total_potential_acv"], 2)

        return {
            "customer_concentration": {
                "hhi": round(hhi, 1),
                "top_10_pct": round(top_10_pct, 2),
                "top_20_pct": round(top_20_pct, 2),
                "top_50_pct": round(top_50_pct, 2),
                "threshold_alerts": threshold_alerts[:10],
                "total_customers": len(customers),
            },
            "contract_quality": {
                "msa_pct": round(msa_pct, 1),
                "sow_pct": round(sow_pct, 1),
                "t_and_m_pct": round(t_and_m_pct, 1),
                "avg_tenure_years": round(avg_tenure, 1),
            },
            "revenue_mix": {
                "recurring_pct": round(recurring_pct, 1),
                "non_recurring_pct": round(non_recurring_pct, 1),
                "consulting_tm_M": round(consulting_tm_M, 2),
                "managed_services_M": round(managed_services_M, 2),
                "per_fte_M": round(per_fte_M, 2),
                "per_transaction_M": round(per_transaction_M, 2),
                "fixed_fee_M": round(fixed_fee_M, 2),
            },
            "cohort_retention": cohort_retention,
            "cross_sell_penetration": {
                "total_candidates": total_candidates,
                "total_pipeline_acv_M": total_pipeline_acv_M,
                "converted_count": 0,
                "converted_acv_M": 0,
                "conversion_rate_pct": 0,
            },
        }

    def get_qoe_summary(self, entity_id: str) -> dict:
        """QoE summary for one entity (fetches its own bridge)."""
        bridge = self._bridge_engine.get_bridge(entity_id)
        return self._get_qoe_summary_with_bridge(entity_id, bridge)

    def _get_qoe_summary_with_bridge(self, entity_id: str, bridge: dict) -> dict:
        """QoE summary using a pre-computed bridge (avoids redundant DB calls)."""
        reported = bridge["reported_ebitda"]
        adjusted = bridge["adjusted_ebitda"]
        total_adj = bridge["total_adjustments"]

        if reported == 0:
            raise ValueError(
                f"Reported EBITDA is zero for entity_id='{entity_id}' — "
                f"cannot compute QoE adjustment percentage"
            )

        adjustment_pct = round(total_adj / reported * 100, 2)

        conf_weighted_adj = sum(
            a["amount"] * a["confidence"] for a in bridge["adjustments"]
        )
        confidence_weighted_ebitda = round(reported + conf_weighted_adj, 2)

        # Revenue quality
        streams = self._get_revenue_streams(entity_id)
        total_revenue = 0.0
        by_stream = []
        for s in streams:
            val = round(float(s["total_value"]), 2)
            if s["concept"] == "revenue.total":
                total_revenue = val
            else:
                by_stream.append({
                    "concept": s["concept"],
                    "value": val,
                })

        for item in by_stream:
            item["pct"] = round(item["value"] / total_revenue * 100, 2) if total_revenue != 0 else 0.0

        # Full revenue quality with concentration, contract, mix, cohort, cross-sell
        full_revenue_quality = self._compute_full_revenue_quality(
            entity_id, streams, total_revenue
        )
        # Preserve total_revenue and by_stream for backward compatibility
        full_revenue_quality["total_revenue"] = total_revenue
        full_revenue_quality["by_stream"] = by_stream

        margin_trend = self._get_margin_trend(entity_id)
        risk_factors = self._compute_risk_factors(bridge, adjustment_pct, margin_trend)
        adjustment_lifecycle = self._build_adjustment_lifecycle(bridge)
        sustainability_trend = self._compute_sustainability_trend(
            bridge, margin_trend
        )

        return {
            "entity_id": entity_id,
            "reported_ebitda": reported,
            "adjusted_ebitda": adjusted,
            "adjustment_pct": adjustment_pct,
            "confidence_weighted_ebitda": confidence_weighted_ebitda,
            "revenue_quality": full_revenue_quality,
            "margin_trend": margin_trend,
            "risk_factors": risk_factors,
            "adjustment_lifecycle": adjustment_lifecycle,
            "sustainability_trend": sustainability_trend,
        }

    def get_combined_qoe(self) -> dict:
        """Combined QoE for both entities.

        Computes per-entity bridges once and reuses them everywhere,
        avoiding redundant DB round-trips (was 18 queries, now 11).
        Includes the combined bridge in the response so callers (NLQ)
        don't need a separate /bridge call.
        """
        entity_a, entity_b = self._bridge_engine._get_entities()

        # Compute bridges once — these are the heaviest DB calls
        bridge_a = self._bridge_engine.get_bridge(entity_a)
        bridge_b = self._bridge_engine.get_bridge(entity_b)
        combined_bridge = self._merge_bridges(bridge_a, bridge_b)

        # Per-entity QoE, passing pre-computed bridges to avoid re-fetching
        qoe_a = self._get_qoe_summary_with_bridge(entity_a, bridge_a)
        qoe_b = self._get_qoe_summary_with_bridge(entity_b, bridge_b)

        combined = self._get_combined_summary(
            entity_a, entity_b, combined_bridge,
            qoe_a.get("margin_trend", []),
            qoe_b.get("margin_trend", []),
        )

        return {
            "entity_a": qoe_a,
            "entity_b": qoe_b,
            "combined": combined,
            "bridge": combined_bridge,
        }

    def _merge_bridges(self, bridge_a: dict, bridge_b: dict) -> dict:
        """Merge two per-entity bridges into a combined bridge."""
        reported = round(bridge_a["reported_ebitda"] + bridge_b["reported_ebitda"], 2)

        adj_map: dict[str, dict] = {}
        for adj in bridge_a["adjustments"] + bridge_b["adjustments"]:
            concept = adj["concept"]
            if concept not in adj_map:
                adj_map[concept] = {
                    "name": adj["name"],
                    "concept": concept,
                    "lever": adj["lever"],
                    "amount": 0.0,
                    "diligence_amount": 0.0,
                    "prior_amount": 0.0,
                    "amount_low": 0.0,
                    "amount_high": 0.0,
                    "confidence": adj["confidence"],
                    "lifecycle_stage": adj["lifecycle_stage"],
                    "period": adj["period"],
                    "period_type": adj["period_type"],
                    "rationale": adj["rationale"],
                    "support_reference": adj["support_reference"],
                    "lifecycle_history": [],
                }
            adj_map[concept]["amount"] = round(
                adj_map[concept]["amount"] + adj["amount"], 2
            )
            adj_map[concept]["amount_low"] = round(
                adj_map[concept]["amount_low"] + adj["amount_low"], 2
            )
            adj_map[concept]["amount_high"] = round(
                adj_map[concept]["amount_high"] + adj["amount_high"], 2
            )
            if adj["diligence_amount"] is not None:
                if adj_map[concept]["diligence_amount"] is None:
                    adj_map[concept]["diligence_amount"] = 0.0
                adj_map[concept]["diligence_amount"] = round(
                    adj_map[concept]["diligence_amount"] + adj["diligence_amount"], 2
                )
            if adj["prior_amount"] is not None:
                if adj_map[concept]["prior_amount"] is None:
                    adj_map[concept]["prior_amount"] = 0.0
                adj_map[concept]["prior_amount"] = round(
                    adj_map[concept]["prior_amount"] + adj["prior_amount"], 2
                )

            # Merge lifecycle histories by stage
            stage_index = {
                h["stage"]: h for h in adj_map[concept]["lifecycle_history"]
            }
            for entry in adj["lifecycle_history"]:
                existing = stage_index.get(entry["stage"])
                if existing:
                    existing["amount"] = round(existing["amount"] + entry["amount"], 2)
                    existing["amount_low"] = round(existing["amount_low"] + entry["amount_low"], 2)
                    existing["amount_high"] = round(existing["amount_high"] + entry["amount_high"], 2)
                else:
                    new_entry = {
                        "stage": entry["stage"],
                        "amount": entry["amount"],
                        "amount_low": entry["amount_low"],
                        "amount_high": entry["amount_high"],
                        "confidence": entry["confidence"],
                    }
                    adj_map[concept]["lifecycle_history"].append(new_entry)
                    stage_index[entry["stage"]] = new_entry

        from backend.engine.ebitda_bridge_v2 import STAGE_ORDER, _derive_trend
        for entry in adj_map.values():
            entry["lifecycle_history"].sort(
                key=lambda h: STAGE_ORDER.get(h["stage"], 99)
            )
            entry["trend"] = _derive_trend(
                entry["amount"], entry["prior_amount"]
            )

        adjustments = [adj_map[c] for c in sorted(adj_map.keys())]
        total_adjustments = round(sum(a["amount"] for a in adjustments), 2)
        adjusted_ebitda = round(reported + total_adjustments, 2)

        by_lever: dict[str, float] = {
            "normalization": 0.0,
            "cost_reduction": 0.0,
            "synergy": 0.0,
        }
        for adj in adjustments:
            by_lever[adj["lever"]] = round(
                by_lever[adj["lever"]] + adj["amount"], 2
            )

        return {
            "reported_ebitda": reported,
            "adjustments": adjustments,
            "total_adjustments": total_adjustments,
            "adjusted_ebitda": adjusted_ebitda,
            "by_lever": by_lever,
        }

    def _get_combined_summary(
        self,
        entity_a: str,
        entity_b: str,
        bridge: dict,
        margin_trend_a: list[dict],
        margin_trend_b: list[dict],
    ) -> dict:
        """Produce combined QoE summary.

        Accepts pre-computed bridge and margin trends to avoid redundant
        DB queries (previously re-fetched everything from scratch).
        """
        reported = bridge["reported_ebitda"]
        adjusted = bridge["adjusted_ebitda"]
        total_adj = bridge["total_adjustments"]

        if reported == 0:
            raise ValueError(
                "Combined reported EBITDA is zero — cannot compute QoE"
            )

        adjustment_pct = round(total_adj / reported * 100, 2)

        conf_weighted_adj = sum(
            a["amount"] * a["confidence"] for a in bridge["adjustments"]
        )
        confidence_weighted_ebitda = round(reported + conf_weighted_adj, 2)

        # Merge margin trend periods from both entities
        margin_map_a = {m["period"]: m["ebitda_margin"] for m in margin_trend_a}
        margin_map_b = {m["period"]: m["ebitda_margin"] for m in margin_trend_b}
        all_periods = sorted(set(margin_map_a.keys()) | set(margin_map_b.keys()))

        # Batch-fetch raw revenue and EBITDA for both entities in one query
        sql = f"""
            SELECT DISTINCT ON (entity_id, concept, period)
                   entity_id, concept, period, value
            FROM convergence_triples
            WHERE tenant_id = %s AND {self._run_clause}
              AND concept IN ('revenue.total', 'pnl.ebitda')
              AND entity_id IN (%s, %s)
              AND property = 'amount'
            ORDER BY entity_id, concept, period, created_at DESC
        """
        rows = self._query(sql, [self.tenant_id, *self._run_params, entity_a, entity_b])

        metric_map: dict[tuple[str, str, str], float] = {}
        for row in rows:
            metric_map[(row["entity_id"], row["concept"], row["period"])] = _to_float(row["value"])

        combined_trend = []
        for period in all_periods:
            rev_a = metric_map.get((entity_a, "revenue.total", period))
            rev_b = metric_map.get((entity_b, "revenue.total", period))
            ebitda_a = metric_map.get((entity_a, "pnl.ebitda", period))
            ebitda_b = metric_map.get((entity_b, "pnl.ebitda", period))

            if all(v is not None for v in (rev_a, rev_b, ebitda_a, ebitda_b)):
                total_rev = rev_a + rev_b
                total_ebitda = ebitda_a + ebitda_b
                if total_rev != 0:
                    combined_trend.append({
                        "period": period,
                        "ebitda_margin": round(total_ebitda / total_rev * 100, 2),
                    })

        risk_factors = self._compute_risk_factors(bridge, adjustment_pct, combined_trend)
        adjustment_lifecycle = self._build_adjustment_lifecycle(bridge)
        sustainability_trend = self._compute_sustainability_trend(
            bridge, combined_trend
        )

        # Combined revenue quality: merge streams from both entities, use all
        # customer data from both entities for concentration/contract analysis
        streams_a = self._get_revenue_streams(entity_a)
        streams_b = self._get_revenue_streams(entity_b)
        total_rev_a = sum(
            float(s["total_value"]) for s in streams_a if s["concept"] == "revenue.total"
        )
        total_rev_b = sum(
            float(s["total_value"]) for s in streams_b if s["concept"] == "revenue.total"
        )
        combined_total_revenue = total_rev_a + total_rev_b

        # Merge revenue streams (sum values for same concepts)
        stream_merge: dict[str, float] = {}
        for s in streams_a + streams_b:
            concept = s["concept"]
            stream_merge[concept] = stream_merge.get(concept, 0) + float(s["total_value"])
        merged_streams = [
            {"concept": c, "total_value": v} for c, v in stream_merge.items()
        ]

        # Merge customers from both entities for combined concentration analysis
        customers_a = self._get_all_customer_data(entity_a)
        customers_b = self._get_all_customer_data(entity_b)
        cs_engagements_a = self._get_customer_service_data(entity_a)
        cs_engagements_b = self._get_customer_service_data(entity_b)
        combined_revenue_quality = self._compute_full_revenue_quality(
            entity_a, merged_streams, combined_total_revenue,
            customers=customers_a + customers_b,
            cs_engagements=cs_engagements_a + cs_engagements_b,
        )

        return {
            "entity_id": "combined",
            "reported_ebitda": reported,
            "adjusted_ebitda": adjusted,
            "adjustment_pct": adjustment_pct,
            "confidence_weighted_ebitda": confidence_weighted_ebitda,
            "revenue_quality": combined_revenue_quality,
            "margin_trend": combined_trend,
            "risk_factors": risk_factors,
            "adjustment_lifecycle": adjustment_lifecycle,
            "sustainability_trend": sustainability_trend,
        }

    @staticmethod
    def _build_adjustment_lifecycle(bridge: dict) -> dict:
        """Build adjustment_lifecycle from bridge adjustments.

        Returns {category_name: [{stage, amount, confidence}, ...]} for each
        adjustment that has lifecycle_history data.
        """
        result = {}
        for adj in bridge.get("adjustments", []):
            history = adj.get("lifecycle_history", [])
            if not history:
                continue
            # Key by category name (strip ebitda_adjustment. prefix)
            category = adj["concept"].split(".", 1)[1] if "." in adj["concept"] else adj["concept"]
            result[category] = [
                {
                    "stage": entry["stage"],
                    "amount": entry["amount"],
                    "confidence": entry["confidence"],
                }
                for entry in history
            ]
        return result

    @staticmethod
    def _compute_sustainability_trend(
        bridge: dict,
        margin_trend: list[dict],
    ) -> list[dict]:
        """Compute sustainability score per available assessment period.

        Score is derived from:
        - Average confidence across adjustments (higher = better)
        - Adjustment magnitude relative to EBITDA (lower = better)
        - Margin stability (less volatile = better)

        Returns [{period, score, grade}, ...].
        """
        reported = bridge.get("reported_ebitda", 0)
        adjustments = bridge.get("adjustments", [])

        if not margin_trend or reported == 0:
            return []

        # Average confidence across all adjustments
        if adjustments:
            avg_confidence = sum(a["confidence"] for a in adjustments) / len(adjustments)
        else:
            avg_confidence = 1.0

        # Adjustment magnitude penalty: |total_adj / reported|
        total_adj = bridge.get("total_adjustments", 0)
        adj_ratio = abs(total_adj / reported) if reported != 0 else 0

        # Base score from confidence and adjustment magnitude
        # confidence contributes 60%, adj_ratio penalty contributes 40%
        conf_score = avg_confidence * 60
        adj_penalty = max(0, 40 - adj_ratio * 200)  # penalize heavily if adjustments > 20%

        # Compute per-period scores with margin stability component
        result = []
        for i, point in enumerate(margin_trend):
            period = point["period"]
            # Margin stability bonus: compare to previous period
            margin_bonus = 0
            if i > 0:
                delta = abs(point["ebitda_margin"] - margin_trend[i - 1]["ebitda_margin"])
                margin_bonus = max(0, 10 - delta * 2)  # up to 10 points for stability
            else:
                margin_bonus = 5  # neutral for first period

            score = round(min(100, conf_score + adj_penalty + margin_bonus))

            # Grade from score
            if score >= 90:
                grade = "A"
            elif score >= 80:
                grade = "B"
            elif score >= 70:
                grade = "C"
            elif score >= 60:
                grade = "D"
            else:
                grade = "F"

            result.append({
                "period": period,
                "score": score,
                "grade": grade,
            })

        return result

    @staticmethod
    def _compute_risk_factors(
        bridge: dict,
        adjustment_pct: float,
        margin_trend: list[dict],
    ) -> list[str]:
        """Identify risk factors from the bridge and margin data."""
        risks = []

        # Large adjustment magnitude
        if abs(adjustment_pct) > 20:
            risks.append(
                f"Total adjustments represent {adjustment_pct:.1f}% of reported EBITDA — "
                f"high adjustment magnitude raises reliability concerns"
            )

        # Low confidence adjustments
        low_conf = [a for a in bridge["adjustments"] if a["confidence"] < 0.70]
        if low_conf:
            names = ", ".join(a["name"] for a in low_conf)
            risks.append(
                f"{len(low_conf)} adjustment(s) have confidence below 0.70: {names}"
            )

        # Declining margins
        if len(margin_trend) >= 2:
            recent = margin_trend[-1]["ebitda_margin"]
            prior = margin_trend[-2]["ebitda_margin"]
            if recent < prior - 1.0:
                risks.append(
                    f"EBITDA margin declining: {prior:.1f}% → {recent:.1f}% "
                    f"({margin_trend[-2]['period']} → {margin_trend[-1]['period']})"
                )

        # Synergy dominance
        by_lever = bridge.get("by_lever", {})
        total_adj = bridge.get("total_adjustments", 0)
        synergy = by_lever.get("synergy", 0)
        if total_adj > 0 and synergy / total_adj > 0.60:
            risks.append(
                f"Synergies represent {synergy / total_adj * 100:.0f}% of total adjustments — "
                f"high dependency on forward-looking estimates"
            )

        return risks
