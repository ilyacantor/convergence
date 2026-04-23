"""
Stage 3C Harness — Combining Financial Statements.

Tests four-column combining with COFA adjustments and identity gates.
Value-binding constants removed in Commit 3 of
feature/entity-id-freely-selectable. Remaining tests assert on
structure: identity gates, COFA payload shape, error paths.
"""
import pytest
from backend.engine.combining_v2 import CombiningEngineV2

from tests.conftest import TENANT_ID, RUN_ID, ENG_DATA


@pytest.fixture
def engine():
    return CombiningEngineV2(ENG_DATA)


# --- COFA adjustments returns valid list ---
def test_cofa_adjustments_count(engine):
    cofas = engine.get_cofa_adjustments()
    assert isinstance(cofas, list)


# --- COFA conflicts have dollar impact field ---
def test_cofa_has_dollar_impact(engine):
    cofas = engine.get_cofa_adjustments()
    for cofa in cofas:
        assert "dollar_impact" in cofa, f"COFA conflict missing dollar_impact: {cofa}"
        assert isinstance(cofa["dollar_impact"], (int, float)), (
            f"dollar_impact must be numeric: {cofa}"
        )


# --- Combined revenue sums the entities ---
def test_combined_revenue(engine):
    stmt = engine.get_combining_income_statement("2025-Q1")
    combined = stmt["combined"]["revenue"]["total"]
    entity_sum = round(
        stmt["entity_a"]["revenue"]["total"] + stmt["entity_b"]["revenue"]["total"], 2
    )
    assert combined == pytest.approx(entity_sum, abs=0.01)


# --- P&L identity gate ---
def test_pnl_identity_gate(engine):
    stmt = engine.get_combining_income_statement("2025-Q1")
    assert stmt["identity_check"]["passed"] is True


# --- BS identity ---
def test_bs_identity(engine):
    bs = engine.get_combining_balance_sheet("2025-Q1")
    combined = bs["combined"]
    assert combined["assets"]["total"] == pytest.approx(
        combined["liabilities"]["total"] + combined["equity"]["total"], abs=0.01
    )


# --- CF identity ---
def test_cf_identity(engine):
    cf = engine.get_combining_cash_flow("2025-Q1")
    combined = cf["combined"]
    assert (
        combined["operating"]["total"]
        + combined["investing"]["total"]
        + combined["financing"]["total"]
    ) == pytest.approx(combined["net_change"], abs=0.01)


# --- COFA structure ---
def test_cofa_structure(engine):
    cofas = engine.get_cofa_adjustments()
    for cofa in cofas:
        assert "conflict_id" in cofa
        assert "concept" in cofa
        assert "description" in cofa
        assert "dollar_impact" in cofa


# --- Error path ---
def test_bad_period_raises(engine):
    with pytest.raises(ValueError):
        engine.get_combining_income_statement("2099-Q1")


# --- Quarterly periods produce valid statements ---
def test_all_periods_valid(engine):
    """Every quarterly period that has P&L coverage for both entities produces
    a statement whose identity check passes."""
    from backend.engine.materialized_views import MaterializedViews
    views = MaterializedViews(TENANT_ID, RUN_ID)
    periods = [p for p in views.get_all_periods() if "-Q" in p]
    at_least_one = False
    for p in periods:
        try:
            stmt = engine.get_combining_income_statement(p)
        except ValueError:
            # Incomplete period — no P&L coverage for this quarter. Skip.
            continue
        at_least_one = True
        assert stmt["identity_check"]["passed"] is True, (
            f"P&L identity failed for {p}"
        )
    assert at_least_one, "No quarterly period produced a combining statement"
