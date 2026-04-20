"""
V2 detail report routes — pipeline funnel, dimensional drill-through,
revenue-by-customer pivot, and report dimensions.

Migrated from NLQ dcl_proxy.py as part of the Reports surface move to Convergence.

Mounts at /api/convergence/reports/v2:
  GET /api/convergence/reports/v2/pipeline?period=2025-Q1
  GET /api/convergence/reports/v2/dimensional-detail?line_key=revenue&entity_id={entity_id}
  GET /api/convergence/reports/v2/revenue-by-customer?entity_id={entity_id}
  GET /api/convergence/reports/v2/dimensions
"""

from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.routes.v2_helpers import resolve_engagement_or_tenant, build_identity_context
from backend.core.db import PoolExhausted, get_connection
from backend.engine.engagement import get_active_engagement
from backend.engine.engagement_data import EngagementData
from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/convergence/reports/v2", tags=["Reports V2 - Detail"])


# ---------------------------------------------------------------------------
# Dimensional drill-through mapping (P&L line items → domain queries)
# ---------------------------------------------------------------------------

_DIMENSIONAL_MAP: dict[str, dict] = {
    "revenue": {
        "domain": "revenue",
        "sections": [
            {"label": "By Customer", "mode": "property_based", "concept": "revenue.by_customer"},
            {"label": "By Stream", "mode": "concept_based", "exclude": ["revenue.total", "revenue.by_customer"]},
        ],
    },
    "total_revenue": {
        "domain": "revenue",
        "sections": [
            {"label": "By Customer", "mode": "property_based", "concept": "revenue.by_customer"},
            {"label": "By Stream", "mode": "concept_based", "exclude": ["revenue.total", "revenue.by_customer"]},
        ],
    },
    "cogs": {
        "domain": "cogs",
        "sections": [
            {"label": "By Category", "mode": "concept_based", "exclude": ["cogs.total"]},
        ],
    },
    "opex": {
        "domain": "opex",
        "sections": [
            {"label": "By Category", "mode": "concept_based", "exclude": ["opex.total"]},
        ],
    },
}


# ---------------------------------------------------------------------------
# GET /api/convergence/reports/v2/pipeline
# ---------------------------------------------------------------------------

def _fetch_pipeline_stages(
    resolver: TripleQueryResolver, entity_id: str, period: str,
) -> list[dict]:
    """Fetch customer.pipeline.* triples for one entity and format as funnel stages."""
    triples = resolver.get_domain("customer", entity_id, period)

    stage_values: dict[str, float] = {}
    for t in triples:
        concept = t.get("concept", "")
        if not concept.startswith("customer.pipeline."):
            continue
        suffix = concept[len("customer.pipeline."):]
        if not suffix or "." in suffix:
            continue
        val = t.get("value")
        if val is not None:
            stage_values[suffix] = float(val)

    if not stage_values:
        return []

    ordered = sorted(stage_values.items(), key=lambda x: x[1], reverse=True)
    first_val = ordered[0][1] if ordered else 1.0
    if first_val == 0:
        first_val = 1.0

    return [
        {
            "label": stage.replace("_", " ").title(),
            "value": round(val, 2),
            "percent": round((val / first_val) * 100, 1),
        }
        for stage, val in ordered
    ]


def _sum_pipeline_stages(stage_lists: list[list[dict]]) -> list[dict]:
    """Sum pipeline stages across entities and recompute percentages."""
    totals: dict[str, float] = {}
    label_map: dict[str, str] = {}
    for stages in stage_lists:
        for s in stages:
            key = s["label"]
            totals[key] = totals.get(key, 0) + s["value"]
            label_map[key] = s["label"]

    if not totals:
        return []

    ordered = sorted(totals.items(), key=lambda x: x[1], reverse=True)
    first_val = ordered[0][1] if ordered else 1.0
    if first_val == 0:
        first_val = 1.0

    return [
        {
            "label": label,
            "value": round(val, 2),
            "percent": round((val / first_val) * 100, 1),
        }
        for label, val in ordered
    ]


@router.get("/pipeline")
async def get_pipeline_report(
    period: str = Query(..., description="Period (e.g. 2025-Q1)"),
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Pipeline funnel data — per-entity panels plus a combined panel."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        resolver = TripleQueryResolver(tid, rid)
        eng = eng_data.config
        entity_ids = list(eng.entity_ids())

        panels = []
        for eid in entity_ids:
            stages = _fetch_pipeline_stages(resolver, eid, period)
            entity = eng.entity_by_id(eid)
            panels.append({
                "entity_id": eid,
                "entity_name": entity.display_name,
                "period": period,
                "stages": stages,
            })

        combined_stages = _sum_pipeline_stages([p["stages"] for p in panels])
        panels.append({
            "entity_id": "combined",
            "entity_name": "Combined",
            "period": period,
            "stages": combined_stages,
        })

        return {**identity, "panels": panels}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "data_incomplete", "detail": str(e)})
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/convergence/reports/v2/dimensional-detail
# ---------------------------------------------------------------------------

def _query_dimensional_triples(
    resolver: TripleQueryResolver, domain: str, entity_ids: list[str], period: str | None,
) -> list[dict]:
    """Query all triples for a domain across entity_ids, including non-amount properties."""
    period_clause = "AND period = %s" if period else ""
    period_params = [period] if period else []

    placeholders = ", ".join(["%s"] * len(entity_ids))
    sql = f"""
        SELECT DISTINCT ON (entity_id, concept, property, period)
               concept, entity_id, period, property, value
        FROM convergence_triples
        WHERE tenant_id = %s
          {resolver._run_clause}
          AND concept LIKE %s
          AND entity_id IN ({placeholders})
          {period_clause}
        ORDER BY entity_id, concept, property, period, created_at DESC
    """
    params = [resolver.tenant_id, *resolver._run_params, f"{domain}.%", *entity_ids, *period_params]
    return resolver._query(sql, params)


@router.get("/dimensional-detail")
async def get_dimensional_detail(
    line_key: str = Query(..., description="P&L line item key (revenue, cogs, opex)"),
    entity_id: str = Query(..., description="Entity ID or 'combined'"),
    period: Optional[str] = Query(None, description="Period filter (e.g. 2025-Q1)"),
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Dimensional breakdown for a P&L line item."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)

    mapping = _DIMENSIONAL_MAP.get(line_key)
    if not mapping:
        return {**identity, "line_key": line_key, "entity_id": entity_id, "dimensions": []}

    try:
        resolver = TripleQueryResolver(tid, rid)
        eng = eng_data.config

        if entity_id == "combined":
            query_entity_ids = list(eng.entity_ids())
        else:
            query_entity_ids = [entity_id]

        triples = _query_dimensional_triples(resolver, mapping["domain"], query_entity_ids, period)

        dimensions = []
        for section in mapping["sections"]:
            mode = section["mode"]
            totals: dict[str, float] = defaultdict(float)

            if mode == "property_based":
                for t in triples:
                    if t.get("concept") != section["concept"]:
                        continue
                    prop = t.get("property")
                    raw_val = t.get("value")
                    val = float(raw_val) if raw_val is not None else None
                    if prop and val is not None:
                        totals[prop] += val
            elif mode == "concept_based":
                exclude = set(section.get("exclude", []))
                for t in triples:
                    concept = t.get("concept", "")
                    if concept in exclude:
                        continue
                    if t.get("property") != "amount":
                        continue
                    raw_val = t.get("value")
                    val = float(raw_val) if raw_val is not None else None
                    if val is not None:
                        suffix = concept.split(".", 1)[1] if "." in concept else concept
                        label = suffix.replace("_", " ").title()
                        totals[label] += val

            if not totals:
                continue

            grand_total = sum(totals.values())
            items = [
                {
                    "property": prop,
                    "value": round(val, 2),
                    "pct_of_total": round((val / abs(grand_total)) * 100, 1) if grand_total else None,
                }
                for prop, val in sorted(totals.items(), key=lambda x: abs(x[1]), reverse=True)
            ]

            dimensions.append({
                "name": section["label"],
                "items": items,
                "total": round(grand_total, 2),
            })

        return {**identity, "line_key": line_key, "entity_id": entity_id, "dimensions": dimensions}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/convergence/reports/v2/revenue-by-customer
# ---------------------------------------------------------------------------

@router.get("/revenue-by-customer")
async def get_revenue_by_customer(
    entity_id: str = Query(..., description="Entity ID"),
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Revenue by customer pivoted into a quarterly table."""
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        resolver = TripleQueryResolver(tid, rid)

        # Query revenue.by_customer triples — property field holds customer name
        sql = f"""
            SELECT DISTINCT ON (entity_id, concept, property, period)
                   concept, property, period, value
            FROM convergence_triples
            WHERE tenant_id = %s
              {resolver._run_clause}
              AND concept = 'revenue.by_customer'
              AND entity_id = %s
              AND property != 'amount'
            ORDER BY entity_id, concept, property, period, created_at DESC
        """
        rows = resolver._query(sql, [resolver.tenant_id, *resolver._run_params, entity_id])

        pivot: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        quarters_set: set[str] = set()
        for row in rows:
            customer = row.get("property")
            period = row.get("period")
            raw_value = row.get("value")
            value = float(raw_value) if raw_value is not None else None
            if customer and period and value is not None:
                pivot[customer][period] += value
                quarters_set.add(period)

        quarters = sorted(quarters_set)

        customers = []
        for name, qvals in pivot.items():
            total = sum(qvals.values())
            row_data: dict = {"name": name, "total": round(total, 2)}
            for q in quarters:
                row_data[q] = round(qvals.get(q, 0), 2)
            customers.append(row_data)
        customers.sort(key=lambda c: c["total"], reverse=True)

        total_revenue = sum(c["total"] for c in customers)

        return {
            **identity,
            "entity_id": entity_id,
            "quarters": quarters,
            "customers": customers,
            "total_revenue": round(total_revenue, 2),
            "customer_count": len(customers),
        }
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/convergence/reports/v2/dimensions
# ---------------------------------------------------------------------------

@router.get("/dimensions")
async def get_report_dimensions(
    engagement_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    pipeline_run_id: Optional[str] = Query(None),
):
    """Available periods and segments for report selectors.

    Queries convergence_triples for distinct periods and derives segments
    from concepts that have property-based dimensional breakdowns.
    """
    eng_data, tid, rid = resolve_engagement_or_tenant(engagement_id, tenant_id, pipeline_run_id)
    if eng_data is None:
        eng_cfg = get_active_engagement(tid)
        eng_data = EngagementData(eng_cfg.engagement_id)
    identity = build_identity_context(tid, rid, eng_data=eng_data)
    try:
        resolver = TripleQueryResolver(tid, rid)
        eng = eng_data.config
        entity_ids = list(eng.entity_ids())

        # Distinct periods with data
        placeholders = ", ".join(["%s"] * len(entity_ids))
        period_sql = f"""
            SELECT DISTINCT period
            FROM convergence_triples
            WHERE tenant_id = %s
              {resolver._run_clause}
              AND entity_id IN ({placeholders})
              AND property = 'amount'
            ORDER BY period
        """
        period_rows = resolver._query(
            period_sql, [resolver.tenant_id, *resolver._run_params, *entity_ids],
        )
        periods = []
        for row in period_rows:
            p = row["period"]
            if not p:
                continue
            # Parse period into structured form
            parts = p.split("-")
            year = int(parts[0]) if parts[0].isdigit() else 0
            quarter = int(parts[1][1]) if len(parts) > 1 and parts[1].startswith("Q") else 0
            # Check which entities have data for this period
            has_data = {}
            for eid in entity_ids:
                count_sql = f"""
                    SELECT COUNT(*) FROM convergence_triples
                    WHERE tenant_id = %s {resolver._run_clause}
                      AND entity_id = %s AND period = %s AND property = 'amount'
                    LIMIT 1
                """
                count = resolver._query_scalar(
                    count_sql, [resolver.tenant_id, *resolver._run_params, eid, p],
                )
                has_data[eid] = (count or 0) > 0
            periods.append({
                "label": p,
                "year": year,
                "quarter": quarter,
                "period_type": "actual",
                "has_data": has_data,
            })

        # Segments from revenue breakdown (by concept suffix)
        seg_sql = f"""
            SELECT DISTINCT concept
            FROM convergence_triples
            WHERE tenant_id = %s
              {resolver._run_clause}
              AND concept LIKE 'revenue.%%'
              AND concept != 'revenue.total'
              AND concept != 'revenue.by_customer'
              AND property = 'amount'
        """
        seg_rows = resolver._query(seg_sql, [resolver.tenant_id, *resolver._run_params])
        segments = sorted({
            r["concept"].split(".", 1)[1].replace("_", " ").title()
            for r in seg_rows
            if "." in r["concept"]
        })

        return {**identity, "periods": periods, "segments": segments}
    except PoolExhausted as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database pool exhausted — too many concurrent requests. {e}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
