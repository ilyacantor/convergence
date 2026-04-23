"""
Stage 3A Harness — Query Resolver on Triples.

Entity pair resolved from /api/convergence/catalog at session start.
All assertions are structural (identity checks, presence, error paths).
Value-specific tests were removed in Commit 3 of
feature/entity-id-freely-selectable.
"""
import pytest
from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.engine.materialized_views import MaterializedViews

from tests.conftest import TENANT_ID, RUN_ID, ENTITY_A, ENTITY_B, gt_overlap_count


@pytest.fixture
def resolver():
    return TripleQueryResolver(TENANT_ID, RUN_ID)


@pytest.fixture
def views():
    return MaterializedViews(TENANT_ID, RUN_ID)


# --- P&L identity (per entity, structural) ---
def test_pnl_identity_entity_a(resolver):
    stmt = resolver.get_income_statement(ENTITY_A, "2025-Q1")
    calc_ebitda = round(stmt["revenue"]["total"] - stmt["cogs"]["total"] - stmt["opex"]["total"], 2)
    assert calc_ebitda == pytest.approx(stmt["ebitda"], abs=0.02)


def test_pnl_identity_entity_b(resolver):
    stmt = resolver.get_income_statement(ENTITY_B, "2025-Q1")
    calc_ebitda = round(stmt["revenue"]["total"] - stmt["cogs"]["total"] - stmt["opex"]["total"], 2)
    assert calc_ebitda == pytest.approx(stmt["ebitda"], abs=0.02)


# --- BS identity ---
def test_bs_identity_entity_a(resolver):
    bs = resolver.get_balance_sheet(ENTITY_A, "2025-Q1")
    assert round(bs["assets"]["total"], 2) == round(bs["liabilities"]["total"] + bs["equity"]["total"], 2)


def test_bs_identity_entity_b(resolver):
    bs = resolver.get_balance_sheet(ENTITY_B, "2025-Q1")
    assert round(bs["assets"]["total"], 2) == round(bs["liabilities"]["total"] + bs["equity"]["total"], 2)


# --- CF identity ---
def test_cf_identity_entity_a(resolver):
    cf = resolver.get_cash_flow(ENTITY_A, "2025-Q1")
    assert round(cf["operating"]["total"] + cf["investing"]["total"] + cf["financing"]["total"], 2) == cf["net_change"]


# --- Overlap retrieval (structural via live-DB gt_overlap_count) ---
def test_customer_overlap(resolver):
    overlaps = resolver.get_overlapping_concepts("customer")
    assert len(overlaps) == gt_overlap_count("customer")


def test_vendor_overlap(resolver):
    overlaps = resolver.get_overlapping_concepts("vendor")
    assert len(overlaps) == gt_overlap_count("vendor")


def test_employee_overlap(resolver):
    overlaps = resolver.get_overlapping_concepts("employee")
    assert len(overlaps) == gt_overlap_count("employee")


# --- Error paths ---
def test_missing_concept_raises(resolver):
    with pytest.raises(ValueError, match="not found"):
        resolver.get_metric("revenue.nonexistent", ENTITY_A, "2025-Q1")


def test_missing_entity_raises(resolver):
    with pytest.raises(ValueError, match="not found"):
        resolver.get_metric("revenue.total", "nonexistent_entity", "2025-Q1")


# --- Provenance ---
def test_provenance_has_pipeline_run_id(resolver):
    prov = resolver.get_provenance("revenue.total", ENTITY_A, "2025-Q1")
    assert prov["pipeline_run_id"] is not None, (
        "Provenance must include pipeline_run_id (I1: no bare run_id)"
    )
    assert len(str(prov["pipeline_run_id"])) == 36, (
        f"pipeline_run_id should be a UUID, got: {prov['pipeline_run_id']}"
    )


# --- Materialized views ---
def test_all_periods(views):
    periods = views.get_all_periods()
    assert len(periods) > 0
    assert all(isinstance(p, str) for p in periods)


def test_all_entities(views):
    entities = set(views.get_all_entities())
    assert ENTITY_A in entities
    assert ENTITY_B in entities


def test_entity_summary(views):
    summary = views.get_entity_summary(ENTITY_A)
    assert summary["total_triples"] > 0
