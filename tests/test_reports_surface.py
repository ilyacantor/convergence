"""
Reports Surface Harness — tests every report endpoint served by Convergence.

Validates that the Reports surface (migrated from NLQ) works end-to-end
through Convergence's own API endpoints (port 8010).

Each test: HTTP 200, data present, correct entity_ids, tenant_id present (I2).
"""

import httpx
import pytest

BASE = "http://localhost:8010"
REPORTS = f"{BASE}/api/convergence/reports/v2"

# conftest provides TENANT_ID and RUN_ID from seed_manifest.json
from tests.conftest import TENANT_ID, ENTITY_A


@pytest.fixture
def params():
    """Standard query params for all report endpoints."""
    return {"tenant_id": TENANT_ID}


# ---------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------

def test_dimensions(params):
    """GET /dimensions — periods and segments for report selectors."""
    r = httpx.get(f"{REPORTS}/dimensions", params=params, timeout=15)
    assert r.status_code == 200, f"dimensions returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "Missing tenant_id (I2 violation)"
    assert "periods" in data, "Missing periods"
    assert isinstance(data["periods"], list), "periods must be a list"


# ---------------------------------------------------------------------------
# Single-entity financial statements
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("statement,endpoint", [
    ("income-statement", "/income-statement"),
    ("balance-sheet", "/balance-sheet"),
    ("cash-flow", "/cash-flow"),
])
def test_single_entity_statement(params, statement, endpoint):
    """GET /{statement} — single-entity financial statement."""
    p = {**params, "entity_id": ENTITY_A, "period": "2025-Q1"}
    r = httpx.get(f"{REPORTS}{endpoint}", params=p, timeout=15)
    assert r.status_code == 200, f"{statement} returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, f"{statement}: missing tenant_id (I2)"
    assert "entity_id" in data, f"{statement}: missing entity_id (I2)"
    assert data["entity_id"] == ENTITY_A


# ---------------------------------------------------------------------------
# Combining financial statements (four-column)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("statement,endpoint", [
    ("combining-is", "/combining/income-statement"),
    ("combining-bs", "/combining/balance-sheet"),
    ("combining-cf", "/combining/cash-flow"),
])
def test_combining_statement(params, statement, endpoint):
    """GET /combining/{statement} — four-column combining statement."""
    p = {**params, "period": "2025-Q1"}
    r = httpx.get(f"{REPORTS}{endpoint}", params=p, timeout=15)
    assert r.status_code == 200, f"{statement} returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, f"{statement}: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# Overlap
# ---------------------------------------------------------------------------

def test_overlap_summary(params):
    """GET /overlap/summary — cross-entity overlap analysis."""
    r = httpx.get(f"{REPORTS}/overlap/summary", params=params, timeout=15)
    assert r.status_code == 200, f"overlap returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "overlap: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# Cross-sell
# ---------------------------------------------------------------------------

def test_cross_sell(params):
    """GET /cross-sell — cross-sell pipeline opportunities."""
    r = httpx.get(f"{REPORTS}/cross-sell", params=params, timeout=15)
    assert r.status_code == 200, f"cross-sell returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "cross-sell: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# Upsell
# ---------------------------------------------------------------------------

def test_upsell(params):
    """GET /upsell — upsell penetration analysis.

    Accepts either 200 (customer_service.* triples present → upsell scored)
    or 422 data_incomplete (customer_service.* absent → informative error).
    Both are structurally valid responses of the UpsellEngineV2 contract.
    """
    r = httpx.get(f"{REPORTS}/upsell", params=params, timeout=15)
    assert r.status_code in (200, 422), f"upsell returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    if r.status_code == 200:
        assert "tenant_id" in data, "upsell: missing tenant_id (I2)"
    else:
        # 422 path: error text must name both entities (per UpsellEngineV2 rewrite)
        detail_str = str(data.get("detail", ""))
        assert "snapshot present" in detail_str


# ---------------------------------------------------------------------------
# EBITDA Bridge
# ---------------------------------------------------------------------------

def test_ebitda_bridge(params):
    """GET /bridge — EBITDA bridge adjustments."""
    r = httpx.get(f"{REPORTS}/bridge", params=params, timeout=15)
    assert r.status_code == 200, f"bridge returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "bridge: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# QoE
# ---------------------------------------------------------------------------

def test_qoe(params):
    """GET /qoe — Quality of Earnings."""
    p = {**params, "entity_id": ENTITY_A}
    r = httpx.get(f"{REPORTS}/qoe", params=p, timeout=15)
    assert r.status_code == 200, f"qoe returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "qoe: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# What-If
# ---------------------------------------------------------------------------

def test_whatif_scenario(params):
    """POST /whatif/scenario — apply what-if adjustments."""
    body = {
        "entity_id": ENTITY_A,
        "period": "2025-Q1",
        "adjustments": [{"concept": "revenue.total", "type": "pct", "value": 10.0}],
    }
    r = httpx.post(
        f"{REPORTS}/whatif/scenario",
        params=params,
        json=body,
        timeout=15,
    )
    assert r.status_code == 200, f"whatif returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "whatif: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# Revenue Bridge
# ---------------------------------------------------------------------------

def test_revenue_bridge(params):
    """GET /revenue-bridge — period-over-period revenue analysis."""
    p = {**params, "entity_id": ENTITY_A, "period_from": "2024-Q1", "period_to": "2025-Q1"}
    r = httpx.get(f"{REPORTS}/revenue-bridge", params=p, timeout=15)
    assert r.status_code == 200, f"revenue-bridge returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "revenue-bridge: missing tenant_id (I2)"


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def test_pipeline(params):
    """GET /pipeline — pipeline funnel per entity + combined."""
    p = {**params, "period": "2025-Q1"}
    r = httpx.get(f"{REPORTS}/pipeline", params=p, timeout=15)
    assert r.status_code == 200, f"pipeline returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "pipeline: missing tenant_id (I2)"
    assert "panels" in data, "pipeline: missing panels"


# ---------------------------------------------------------------------------
# Dimensional Detail
# ---------------------------------------------------------------------------

def test_dimensional_detail(params):
    """GET /dimensional-detail — drill-through on revenue."""
    p = {**params, "line_key": "revenue", "entity_id": ENTITY_A}
    r = httpx.get(f"{REPORTS}/dimensional-detail", params=p, timeout=15)
    assert r.status_code == 200, f"dimensional-detail returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "dimensional-detail: missing tenant_id (I2)"
    assert "dimensions" in data, "dimensional-detail: missing dimensions"


# ---------------------------------------------------------------------------
# Revenue by Customer
# ---------------------------------------------------------------------------

def test_revenue_by_customer(params):
    """GET /revenue-by-customer — customer revenue pivot."""
    p = {**params, "entity_id": ENTITY_A}
    r = httpx.get(f"{REPORTS}/revenue-by-customer", params=p, timeout=15)
    assert r.status_code == 200, f"revenue-by-customer returned {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert "tenant_id" in data, "revenue-by-customer: missing tenant_id (I2)"
    assert "entity_id" in data, "revenue-by-customer: missing entity_id (I2)"
    assert data["entity_id"] == ENTITY_A
