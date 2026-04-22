"""Shared test fixtures — catalog-sourced entities + live-DB ground truth.

The fixture seed that previously lived in seed_manifest.json was removed in
feature/entity-id-freely-selectable. Tests now resolve their entity pair
via the live Convergence catalog (GET /api/convergence/catalog) at session
start, and ground-truth values are read from convergence_triples directly
— the same store the engines read. Structural assertions (identity checks,
field presence, counts) are what survives; value-specific assertions that
bound to a particular entity's content were deleted in Commit 3.

Required environment:
- Convergence backend running at CONVERGENCE_API_URL (default localhost:8010)
- convergence_triples populated via scripts/sync_entity_catalog.py (at least
  two shape-compliant entities present). The conftest fails loudly if the
  catalog returns fewer than 2 passing entities.
"""

import os

import httpx
import pytest


CONVERGENCE_URL = os.environ.get("CONVERGENCE_API_URL", "http://localhost:8010")


def _fetch_catalog() -> dict:
    url = f"{CONVERGENCE_URL}/api/convergence/catalog"
    try:
        resp = httpx.get(url, timeout=10.0)
    except httpx.ConnectError as e:
        raise ConnectionError(
            f"Cannot reach Convergence catalog at {url} — is the service "
            f"running? Error: {e}"
        ) from e
    if resp.status_code != 200:
        raise RuntimeError(
            f"Catalog endpoint returned HTTP {resp.status_code}: "
            f"{resp.text[:200]}"
        )
    return resp.json()


def _resolve_catalog_pair() -> tuple[str, str, str, str]:
    """Return (tenant_id, entity_a, entity_b, pipeline_run_id).

    tenant_id is a real UUID owned by the sync script's synthetic tenant.
    pipeline_run_id is resolved from convergence_tenant_runs; None means
    'use is_active = true' in SQL scopes.
    """
    cat = _fetch_catalog()
    passing = cat.get("passing_entities") or []
    if len(passing) < 2:
        raise RuntimeError(
            f"Convergence catalog has fewer than 2 shape-compliant entities "
            f"({len(passing)}). Run scripts/sync_entity_catalog.py to seed."
        )
    entity_a_row, entity_b_row = passing[0], passing[1]
    tenant_id = entity_a_row["tenant_id"]
    entity_a = entity_a_row["entity_id"]
    entity_b = entity_b_row["entity_id"]
    return tenant_id, entity_a, entity_b, None


_TENANT_ID, _ENTITY_A, _ENTITY_B, _RUN_ID_FROM_CAT = _resolve_catalog_pair()


def _resolve_pipeline_run_id(tenant_id: str, entity_id: str) -> str:
    """Pull the live run_id for a tenant+entity from convergence_triples.

    Legacy tests pass `pipeline_run_id` through to engines that scope reads
    and writes by run (TripleQueryResolver, WhatIf save_scenario, ...). A
    synthesized UUID is fine for SELECT scoping; for INSERT NOT NULL
    columns we just need a stable non-null value per session.
    """
    import psycopg2
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL required to resolve pipeline_run_id")
    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id FROM convergence_triples "
                "WHERE is_active = true AND tenant_id = %s::uuid AND entity_id = %s "
                "LIMIT 1",
                (tenant_id, entity_id),
            )
            row = cur.fetchone()
    if row and row[0]:
        return str(row[0])
    # Fallback: synthesize a deterministic UUID from tenant+entity.
    import uuid as _uuid
    return str(_uuid.uuid5(_uuid.UUID(tenant_id), f"test-run-{entity_id}"))


# Module-level exports that legacy tests import directly.
TENANT_ID: str = _TENANT_ID
ENTITY_A: str = _ENTITY_A
ENTITY_B: str = _ENTITY_B

# RUN_ID is None so TripleQueryResolver and engines fall back to
# is_active=true scoping and see all synced triples (the sync wrote under
# two distinct convergence_ingest_ids — one per pair). WHATIF_RUN_ID
# carries a real UUID for save_scenario's NOT NULL run_id column.
RUN_ID = None
WHATIF_RUN_ID: str = _resolve_pipeline_run_id(TENANT_ID, ENTITY_A)


def _resolve_or_create_engagement(tenant_id: str, acquirer: str, target: str) -> str:
    """Return an engagement_id for (acquirer, target) in lifecycle_stage='active'.

    Reuses an existing engagement pairing the same two entities under the
    same tenant; otherwise POSTs a new one through the live backend so the
    test run shares the catalog's authority boundary. Promotes to active
    if needed — report endpoints require an active engagement.
    """
    url = f"{CONVERGENCE_URL}/api/convergence/engagements"
    resp = httpx.get(url, params={"tenant_id": tenant_id}, timeout=10.0)
    eng_id = None
    if resp.status_code == 200:
        for row in resp.json() or []:
            if row.get("acquirer_entity_id") == acquirer and row.get("target_entity_id") == target:
                eng_id = row["engagement_id"]
                if row.get("lifecycle_stage") == "active":
                    return eng_id
                break
    if eng_id is None:
        create = httpx.post(
            url,
            json={
                "tenant_id": tenant_id,
                "acquirer_entity_id": acquirer,
                "target_entity_id": target,
                "engagement_type": "MA",
            },
            timeout=15.0,
        )
        if create.status_code not in (200, 201):
            raise RuntimeError(
                f"Could not create test engagement: HTTP {create.status_code} "
                f"{create.text[:300]}"
            )
        body = create.json()
        eng_id = body.get("engagement_id")
        if not eng_id:
            raise RuntimeError(f"Engagement create returned no engagement_id: {body}")
    # Promote to active via PATCH.
    patch = httpx.patch(
        f"{url}/{eng_id}",
        json={"lifecycle_stage": "active"},
        timeout=10.0,
    )
    if patch.status_code not in (200, 204):
        # Acceptable if already active; fall through.
        if "cannot move from 'active'" not in (patch.text or ""):
            raise RuntimeError(
                f"Could not promote engagement {eng_id} to active: "
                f"HTTP {patch.status_code} {patch.text[:300]}"
            )
    return eng_id


ENGAGEMENT_ID: str = _resolve_or_create_engagement(TENANT_ID, ENTITY_A, ENTITY_B)


def _build_eng_data():
    """Construct an EngagementData instance for the catalog-resolved pair.

    Deferred import because backend requires PYTHONPATH to be set before
    this module-level code runs — tests set PYTHONPATH explicitly.
    """
    from backend.engine.engagement_data import EngagementData
    return EngagementData(ENGAGEMENT_ID)


ENG_DATA = _build_eng_data()


@pytest.fixture(scope="session")
def catalog_pair() -> dict:
    """Session-scoped entity pair resolved from the live catalog.

    Yields:
        {'tenant_id': str, 'entity_a': str, 'entity_b': str,
         'engagement_id': str, 'pipeline_run_id': str | None}
    """
    return {
        "tenant_id": TENANT_ID,
        "entity_a": ENTITY_A,
        "entity_b": ENTITY_B,
        "engagement_id": ENGAGEMENT_ID,
        "pipeline_run_id": RUN_ID,
    }


@pytest.fixture(scope="session")
def eng_data():
    """Session-scoped EngagementData instance for the catalog-resolved pair."""
    return ENG_DATA


@pytest.fixture
def seed_tenant_id() -> str:
    return TENANT_ID


@pytest.fixture
def seed_run_id():
    return RUN_ID


# --- Ground-truth helpers: query convergence_triples directly ----------------
#
# Previous Farm-API ground truth was keyed on fixture entity names. Since
# sync_entity_catalog.py remaps entity_ids when loading triples, Farm ground
# truth is not reachable by catalog entity_id. Instead, the live triples in
# convergence_triples ARE the ground truth: whatever the engines compute,
# they compute from these rows.
#
# Tests using these helpers assert 'engine output matches raw triple value'
# — a structural check, not a fixture-value check.


def _db_conn():
    import psycopg2
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set — cannot read ground truth")
    return psycopg2.connect(db_url)


def gt_metric(entity: str, period: str, concept: str) -> float:
    """Query the raw value for (entity, period, concept) from convergence_triples.

    Returns the value from the property='amount' row. Raises KeyError if
    the triple does not exist in the active snapshot for this entity.
    """
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM convergence_triples "
                "WHERE is_active = true AND entity_id = %s "
                "  AND concept = %s AND period = %s AND property = 'amount' "
                "ORDER BY created_at DESC LIMIT 1",
                (entity, concept, period),
            )
            row = cur.fetchone()
    if row is None:
        raise KeyError(
            f"No triple for entity={entity!r} period={period!r} "
            f"concept={concept!r} in convergence_triples"
        )
    val = row[0]
    if isinstance(val, str):
        import json
        val = json.loads(val)
    return float(val)


def gt_overlap_count(category: str) -> int:
    """Count entity-level concepts in `category` shared by both entities.

    Mirrors OverlapEngineV2._find_overlapping_concepts exactly:
      - 2-segment concepts only (exclude subcategory {domain}.x.y)
      - HAVING COUNT(DISTINCT entity_id) > 1 (in both entities)
      - HAVING COUNT(DISTINCT property) > 1 (actual business entity,
        not a single-property domain-level KPI)
    Keeps conftest ground truth aligned with the engine's semantics.
    """
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM ("
                "  SELECT concept FROM convergence_triples "
                "  WHERE is_active = true "
                "    AND tenant_id = %s::uuid "
                "    AND concept LIKE %s "
                "    AND concept NOT LIKE %s "
                "  GROUP BY concept "
                "  HAVING COUNT(DISTINCT entity_id) > 1 "
                "    AND COUNT(DISTINCT property) > 1"
                ") sub",
                (TENANT_ID, f"{category}.%", f"{category}.%.%"),
            )
            return int(cur.fetchone()[0])


def gt_atemporal(entity: str, concept: str, prop: str = "amount_current") -> float:
    """Return an atemporal property (e.g. ebitda_adjustment.*) value."""
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM convergence_triples "
                "WHERE is_active = true AND entity_id = %s "
                "  AND concept LIKE %s AND property = %s "
                "ORDER BY created_at DESC LIMIT 1",
                (entity, f"{concept}%", prop),
            )
            row = cur.fetchone()
    if row is None:
        raise KeyError(
            f"No atemporal triple for entity={entity!r} concept={concept!r} "
            f"property={prop!r}"
        )
    val = row[0]
    if isinstance(val, str):
        import json
        val = json.loads(val)
    return float(val)
