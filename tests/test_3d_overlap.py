"""
Stage 3D Harness — Overlap + Cross-sell.

Structural tests only. Overlap counts are queried live from the triple
store via gt_overlap_count — the engine's answer must match the raw
triple-store answer, regardless of whether the two synced entities
have overlapping customers/vendors/employees at all.
"""
import pytest
from backend.engine.overlap_v2 import OverlapEngineV2
from backend.engine.cross_sell_v2 import CrossSellEngineV2

from tests.conftest import TENANT_ID, RUN_ID, ENG_DATA, ENTITY_A, ENTITY_B, gt_overlap_count


@pytest.fixture
def overlap():
    return OverlapEngineV2(ENG_DATA)


@pytest.fixture
def cross_sell():
    return CrossSellEngineV2(ENG_DATA)


# --- Overlap summary: engine answer matches raw triple-store answer ---
def test_overlap_summary(overlap):
    summary = overlap.get_overlap_summary()
    for category in ("customer", "vendor", "employee"):
        if category in summary:
            assert summary[category]["overlap_count"] == gt_overlap_count(category)


# --- Engine produces the expected response shape per domain ---
def test_entity_totals(overlap):
    summary = overlap.get_overlap_summary()
    assert "customer" in summary
    for category in summary:
        row = summary[category]
        assert "entity_a_total" in row
        assert "entity_b_total" in row
        assert "overlap_count" in row


# --- Cross-sell response shape ---
def test_cross_sell_summary(cross_sell):
    summary = cross_sell.get_cross_sell_summary()
    assert "total_opportunities" in summary
    assert "total_potential_acv" in summary
    assert "by_service" in summary
    assert "by_direction" in summary


# --- Overlap has both-entities shape when any overlap exists ---
def test_overlap_has_both_entities(overlap):
    concepts = overlap.get_overlapping_concepts("customer")
    for c in concepts[:5]:  # spot check first 5
        assert "entity_a_properties" in c
        assert "entity_b_properties" in c


# --- Employee overlap: engine answer matches raw query ---
def test_employee_overlap(overlap):
    concepts = overlap.get_overlapping_concepts("employee")
    assert len(concepts) == gt_overlap_count("employee")
