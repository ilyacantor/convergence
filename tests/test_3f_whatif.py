"""
Stage 3F Harness — What-If + Revenue Bridge + Scenarios.

Value-binding constants removed in Commit 3. Remaining tests assert on
structure: scenario application produces a baseline and an adjusted
output, sensitivity analysis respects direction, scenario round-trip
persists.
"""
import pytest
from backend.engine.what_if_v2 import WhatIfEngineV2
from backend.engine.revenue_bridge import RevenueBridgeV2

from tests.conftest import TENANT_ID, RUN_ID, ENTITY_A


@pytest.fixture
def whatif():
    return WhatIfEngineV2(TENANT_ID, RUN_ID)


@pytest.fixture
def bridge():
    return RevenueBridgeV2(TENANT_ID, RUN_ID)


# --- What-if scenario: 10% revenue decline ---
def test_revenue_decline_scenario(whatif):
    result = whatif.apply_scenario(ENTITY_A, "2025-Q1", [
        {"concept": "revenue.total", "type": "pct", "value": -10.0}
    ])
    baseline = result["baseline"]["revenue"]["total"]
    adjusted = result["adjusted"]["revenue"]["total"]
    assert abs(adjusted - round(baseline * 0.90, 2)) < 0.01


# --- Scenario comparison ---
def test_scenario_comparison(whatif):
    result = whatif.compare_scenarios(ENTITY_A, "2025-Q1", {
        "bear": [{"concept": "revenue.total", "type": "pct", "value": -20.0}],
        "base": [],
        "bull": [{"concept": "revenue.total", "type": "pct", "value": 10.0}],
    })
    base_rev = result["scenarios"]["base"]["adjusted"]["revenue"]["total"]
    bear_rev = result["scenarios"]["bear"]["adjusted"]["revenue"]["total"]
    bull_rev = result["scenarios"]["bull"]["adjusted"]["revenue"]["total"]
    assert bear_rev < base_rev < bull_rev


# --- Sensitivity analysis ---
def test_sensitivity(whatif):
    results = whatif.sensitivity_analysis(ENTITY_A, "2025-Q1", "revenue.total", 20.0, 5)
    assert len(results) == 5
    ebitdas = [r["ebitda"] for r in results]
    assert ebitdas[0] < ebitdas[-1]  # lower revenue = lower EBITDA


# --- Save and load scenario ---
def test_save_load_scenario(whatif):
    scenario_id = whatif.save_scenario("test_bear", ENTITY_A, "2025-Q1", [
        {"concept": "revenue.total", "type": "pct", "value": -15.0}
    ])
    assert scenario_id is not None
    loaded = whatif.load_scenario(scenario_id)
    assert loaded["baseline"]["revenue"]["total"] > 0


# --- List scenarios ---
def test_list_scenarios(whatif):
    whatif.save_scenario("test_list", ENTITY_A, "2025-Q1", [])
    scenarios = whatif.list_scenarios()
    assert len(scenarios) > 0
    names = [s["name"] for s in scenarios]
    assert "test_list" in names


# --- Absolute adjustment ---
def test_absolute_adjustment(whatif):
    result = whatif.apply_scenario(ENTITY_A, "2025-Q1", [
        {"concept": "revenue.total", "type": "abs", "value": -100.0}
    ])
    baseline = result["baseline"]["revenue"]["total"]
    adjusted = result["adjusted"]["revenue"]["total"]
    assert adjusted == pytest.approx(baseline - 100.0, abs=0.01)
