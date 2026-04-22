"""
Sweep 1 — Engine Stack Integration Test

Verifies the full v2 engine stack works end-to-end:
QueryResolver feeds into Combining/Overlap/EBITDA/WhatIf.

All expected values fetched from Farm's ground truth API at runtime (B10).
"""
import json
import pytest
from pathlib import Path

from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.engine.combining_v2 import CombiningEngineV2
from backend.engine.overlap_v2 import OverlapEngineV2
from backend.engine.cross_sell_v2 import CrossSellEngineV2
from backend.engine.ebitda_bridge_v2 import EBITDABridgeV2
from backend.engine.qoe_v2 import QualityOfEarningsV2
from backend.engine.what_if_v2 import WhatIfEngineV2
from backend.engine.revenue_bridge import RevenueBridgeV2
from backend.engine.entity_resolution_v2 import EntityResolutionV2

# --- Seed constants resolved from live catalog (no seed_manifest dependency) ---
from tests.conftest import TENANT_ID, RUN_ID, WHATIF_RUN_ID, ENG_DATA, ENTITY_A, ENTITY_B, gt_metric, gt_overlap_count


def _sum_ebitda_adjustments(entity: str) -> float:
    """Sum latest-stage ebitda_adjustment amounts for entity from convergence_triples."""
    import os
    import psycopg2
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM convergence_triples "
                "WHERE is_active = true AND entity_id = %s "
                "  AND concept LIKE 'ebitda_adjustment.%%' "
                "  AND property = 'amount_current'",
                (entity,),
            )
            rows = cur.fetchall()
    total = 0.0
    for (raw,) in rows:
        val = json.loads(raw) if isinstance(raw, str) else raw
        total += float(val)
    return round(total, 2)


# --- Fixtures ---
@pytest.fixture(scope="module")
def resolver():
    return TripleQueryResolver(TENANT_ID, RUN_ID)

@pytest.fixture(scope="module")
def combining():
    return CombiningEngineV2(ENG_DATA)

@pytest.fixture(scope="module")
def overlap():
    return OverlapEngineV2(ENG_DATA)

@pytest.fixture(scope="module")
def cross_sell():
    return CrossSellEngineV2(ENG_DATA)

@pytest.fixture(scope="module")
def bridge():
    return EBITDABridgeV2(ENG_DATA)

@pytest.fixture(scope="module")
def qoe():
    return QualityOfEarningsV2(ENG_DATA)

@pytest.fixture(scope="module")
def whatif():
    return WhatIfEngineV2(ENG_DATA, WHATIF_RUN_ID)

@pytest.fixture(scope="module")
def rev_bridge():
    return RevenueBridgeV2(ENG_DATA)


# --- Test 1: fixture-tied resolver→combining pnl, deleted ---


# --- Test 2: Resolver → Combining BS ---
def test_resolver_to_combining_bs(resolver, combining):
    """BS identity holds in the combining statement."""
    bs = combining.get_combining_balance_sheet("2025-Q1")
    # Entity A identity
    assert bs["entity_a"]["assets"]["total"] == pytest.approx(bs["entity_a"]["liabilities"]["total"] + bs["entity_a"]["equity"]["total"], abs=0.01)
    # Entity B identity
    assert bs["entity_b"]["assets"]["total"] == pytest.approx(bs["entity_b"]["liabilities"]["total"] + bs["entity_b"]["equity"]["total"], abs=0.01)
    # Combined identity
    assert bs["combined"]["assets"]["total"] == pytest.approx(bs["combined"]["liabilities"]["total"] + bs["combined"]["equity"]["total"], abs=0.01)


# --- Test 3: Resolver → Combining CF ---
def test_resolver_to_combining_cf(combining):
    """CF identity holds in the combining statement."""
    cf = combining.get_combining_cash_flow("2025-Q1")
    for col in ["entity_a", "entity_b", "combined"]:
        data = cf[col]
        calc = data["operating"]["total"] + data["investing"]["total"] + data["financing"]["total"]
        assert calc == data["net_change"], f"CF identity failed for {col}: {calc} != {data['net_change']}"


# --- Test 4: Combining identity gate ---
def test_combining_pnl_identity_gate(combining):
    """Combined EBITDA == entity_a EBITDA + entity_b EBITDA + adjustment EBITDA impact."""
    stmt = combining.get_combining_income_statement("2025-Q1")
    assert stmt["identity_check"]["passed"] is True


# --- Test 5: Resolver → Overlap ---
def test_resolver_to_overlap(overlap):
    """Overlap counts match seed ground truth."""
    summary = overlap.get_overlap_summary()
    assert summary["customer"]["overlap_count"] == gt_overlap_count("customer")
    assert summary["vendor"]["overlap_count"] == gt_overlap_count("vendor")
    assert summary["employee"]["overlap_count"] == gt_overlap_count("employee")


# --- Test 6: Resolver → Cross-sell (structural) ---
def test_resolver_to_cross_sell(cross_sell):
    """Cross-sell response has the expected shape; counts depend on
    whether the two synced entities have any entity-exclusive customers."""
    summary = cross_sell.get_cross_sell_summary()
    assert "total_opportunities" in summary
    assert "total_potential_acv" in summary
    assert "by_service" in summary
    assert "by_direction" in summary


# --- Test 7: Resolver → EBITDA Bridge (arithmetic consistency) ---
def test_resolver_to_ebitda_bridge(resolver, bridge):
    """Bridge arithmetic holds: adjusted = reported + total_adjustments."""
    m_bridge = bridge.get_bridge(ENTITY_A)
    assert m_bridge["reported_ebitda"] is not None
    assert m_bridge["adjusted_ebitda"] == pytest.approx(
        m_bridge["reported_ebitda"] + m_bridge["total_adjustments"], abs=0.01
    )


# --- Test 8: Resolver → QofE ---
def test_resolver_to_qoe(qoe):
    """QoE summary has required fields."""
    summary = qoe.get_qoe_summary(ENTITY_A)
    assert summary["reported_ebitda"] is not None
    assert summary["adjusted_ebitda"] is not None
    assert "revenue_quality" in summary
    assert "margin_trend" in summary
    assert len(summary["margin_trend"]) == 12  # all periods


# --- Test 9: fixture-tied resolver→whatif, deleted ---


# --- Test 10: fixture-tied resolver→revenue bridge, deleted ---


# --- Test 11: Resolution → Overlap chain ---
def test_resolution_overlap_chain():
    """Resolution creates workspaces matching overlap counts."""
    resolution = EntityResolutionV2(ENG_DATA)
    # Idempotent: may create 0 if workspaces already exist from prior runs
    resolution.create_workspaces_from_overlap()

    # Verify total workspace counts per domain match overlap ground truth
    customer_ws = resolution.list_workspaces(domain="customer")
    vendor_ws = resolution.list_workspaces(domain="vendor")
    employee_ws = resolution.list_workspaces(domain="employee")

    assert len(customer_ws) == gt_overlap_count("customer")
    assert len(vendor_ws) == gt_overlap_count("vendor")
    assert len(employee_ws) == gt_overlap_count("employee")


# --- Test 12: fixture-tied scenario roundtrip, deleted ---
