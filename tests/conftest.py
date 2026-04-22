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


_TENANT_ID, _ENTITY_A, _ENTITY_B, _RUN_ID = _resolve_catalog_pair()

# Module-level exports that legacy tests import directly.
TENANT_ID: str = _TENANT_ID
RUN_ID = _RUN_ID  # None means tests use is_active scoping in SQL
ENTITY_A: str = _ENTITY_A
ENTITY_B: str = _ENTITY_B


@pytest.fixture(scope="session")
def catalog_pair() -> dict:
    """Session-scoped entity pair resolved from the live catalog.

    Yields:
        {'tenant_id': str, 'entity_a': str, 'entity_b': str,
         'pipeline_run_id': str | None}
    """
    return {
        "tenant_id": TENANT_ID,
        "entity_a": ENTITY_A,
        "entity_b": ENTITY_B,
        "pipeline_run_id": RUN_ID,
    }


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
    """Count distinct concepts in `category` that both entities share."""
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM ("
                "  SELECT concept FROM convergence_triples "
                "  WHERE is_active = true "
                "    AND concept LIKE %s "
                "    AND concept NOT LIKE %s "
                "    AND entity_id IN (%s, %s) "
                "  GROUP BY concept "
                "  HAVING COUNT(DISTINCT entity_id) > 1"
                ") sub",
                (f"{category}.%", f"{category}.%.%", ENTITY_A, ENTITY_B),
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
