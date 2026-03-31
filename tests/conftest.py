"""
Shared test fixtures — tenant_id, run_id, and ground truth from Farm.

Copied from DCL's conftest.py. Convergence tests use the same seed data
and Farm ground truth as DCL tests.

Auto-seed: if the expected overlap data is missing from the DB (e.g. because
a Console ME pipeline replaced the data), this conftest re-generates
comprehensive triples via Farm and pushes them to Convergence before tests run.
"""

import json
import os
from pathlib import Path

import httpx
import psycopg2
import pytest

_MANIFEST_PATH = Path(__file__).resolve().parent.parent / "data" / "seed_manifest.json"


def _load_manifest() -> dict:
    """Load seed_manifest.json. Fails loudly if missing."""
    if not _MANIFEST_PATH.exists():
        raise FileNotFoundError(
            f"seed_manifest.json not found at {_MANIFEST_PATH}. "
            f"Run the seed pipeline before executing tests."
        )
    with open(_MANIFEST_PATH) as f:
        return json.load(f)


def _db_has_overlap_data(tenant_id: str, run_id: str) -> bool:
    """Check if convergence_triples has customer overlap data for this run."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return False
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            "SELECT count(*) FROM ("
            "  SELECT concept FROM convergence_triples"
            "  WHERE tenant_id=%s AND run_id=%s"
            "    AND concept LIKE 'customer.%%'"
            "    AND concept NOT LIKE 'customer.%%.%%'"
            "  GROUP BY concept HAVING COUNT(DISTINCT entity_id) > 1"
            ") x",
            (tenant_id, run_id),
        )
        overlap_count = cur.fetchone()[0]
        conn.close()
        return overlap_count > 0
    except Exception:
        return False


def _reseed_from_farm(manifest: dict) -> dict:
    """Generate comprehensive triples via Farm and push to Convergence.

    Returns updated manifest dict with new run_id and farm_run_id.
    Raises on failure — no silent fallback.
    """
    farm_url = os.environ.get("FARM_API_URL", "http://localhost:8003")
    convergence_url = os.environ.get(
        "CONVERGENCE_API_URL", "http://localhost:8010"
    )
    tenant_id = manifest["tenant_id"]

    # Step 1: generate comprehensive triples (includes overlap data)
    gen_resp = httpx.post(
        f"{farm_url}/api/business-data/generate-multi-entity-triples",
        json={
            "tenant_id": tenant_id,
            "entities": [manifest["entity_a_id"], manifest["entity_b_id"]],
            "seed": 42,
        },
        timeout=120.0,
    )
    if gen_resp.status_code != 200:
        raise RuntimeError(
            f"Farm generate-multi-entity-triples failed: "
            f"HTTP {gen_resp.status_code} — {gen_resp.text[:300]}"
        )
    gen_data = gen_resp.json()
    farm_run_id = gen_data["farm_manifest_id"]

    # Step 2: push to Convergence ingest
    push_resp = httpx.post(
        f"{farm_url}/api/business-data/triple-runs/{farm_run_id}/push-to-dcl",
        json={
            "dcl_url": f"{convergence_url}/api/convergence/ingest-triples",
            "tenant_id": tenant_id,
        },
        timeout=120.0,
    )
    if push_resp.status_code != 200:
        raise RuntimeError(
            f"Farm push-to-dcl failed: "
            f"HTTP {push_resp.status_code} — {push_resp.text[:300]}"
        )
    push_data = push_resp.json()
    if not push_data.get("success"):
        raise RuntimeError(
            f"Farm push-to-dcl returned success=false: {push_data}"
        )

    # Step 3: read the new run_id from convergence_tenant_runs
    db_url = os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        "SELECT current_run_id FROM convergence_tenant_runs WHERE tenant_id=%s",
        (tenant_id,),
    )
    new_run_id = cur.fetchone()[0]
    cur.execute(
        "SELECT count(*) FROM convergence_triples WHERE run_id=%s",
        (new_run_id,),
    )
    triple_count = cur.fetchone()[0]
    conn.close()

    # Step 4: update manifest file
    manifest["run_id"] = new_run_id
    manifest["farm_run_id"] = farm_run_id
    manifest["total_triples"] = triple_count
    with open(_MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    return manifest


def _ensure_seed_data() -> dict:
    """Load manifest and re-seed if overlap data is missing."""
    manifest = _load_manifest()
    if not _db_has_overlap_data(manifest["tenant_id"], manifest["run_id"]):
        manifest = _reseed_from_farm(manifest)
    return manifest


_manifest = _ensure_seed_data()

TENANT_ID: str = _manifest["tenant_id"]
RUN_ID: str = _manifest["run_id"]
FARM_RUN_ID: str = _manifest["farm_run_id"]


def _fetch_ground_truth() -> dict:
    """Fetch ground truth from Farm's API. Fails loudly if unavailable."""
    farm_url = os.environ.get("FARM_API_URL", "http://localhost:8003")
    url = f"{farm_url}/api/business-data/ground-truth/{FARM_RUN_ID}"
    try:
        response = httpx.get(url, timeout=30.0)
    except httpx.ConnectError as e:
        raise ConnectionError(
            f"Cannot reach Farm at {farm_url} — is Farm running? "
            f"Ground truth is required for test verification (B10). Error: {e}"
        ) from e
    if response.status_code != 200:
        raise ValueError(
            f"Ground truth not available from Farm at {url}: "
            f"HTTP {response.status_code} — {response.text[:200]}. "
            f"Ensure Farm is running and has data for {FARM_RUN_ID}."
        )
    return response.json()


_ground_truth_cache = None


def _get_ground_truth() -> dict:
    global _ground_truth_cache
    if _ground_truth_cache is None:
        _ground_truth_cache = _fetch_ground_truth()
    return _ground_truth_cache


def gt_metric(entity: str, period: str, concept: str) -> float:
    """Look up a single ground truth value by entity/period/concept."""
    gt = _get_ground_truth()
    tgt = gt.get("triple_ground_truth", {})
    entity_data = tgt.get(entity)
    if entity_data is None:
        raise KeyError(
            f"Entity '{entity}' not found in ground truth. "
            f"Available: {list(tgt.keys())}"
        )
    period_data = entity_data.get(period)
    if period_data is None:
        raise KeyError(
            f"Period '{period}' not found for entity '{entity}'. "
            f"Available: {sorted(entity_data.keys())}"
        )
    if concept not in period_data:
        raise KeyError(
            f"Concept '{concept}' not found for {entity}/{period}. "
            f"Available: {sorted(period_data.keys())}"
        )
    return period_data[concept]


def gt_overlap_count(category: str) -> int:
    """Look up overlap count by category (customer, vendor, employee)."""
    gt = _get_ground_truth()
    counts = gt.get("overlap_counts", {})
    if category not in counts:
        raise KeyError(
            f"Overlap category '{category}' not found. "
            f"Available: {list(counts.keys())}"
        )
    return counts[category]


def gt_atemporal(entity: str, concept: str, prop: str = "amount_current") -> float:
    """Look up an atemporal ground truth value."""
    gt = _get_ground_truth()
    agt = gt.get("atemporal_ground_truth", {})
    entity_data = agt.get(entity)
    if entity_data is None:
        raise KeyError(
            f"Entity '{entity}' not found in atemporal ground truth. "
            f"Available: {list(agt.keys())}"
        )
    concept_data = entity_data.get(concept)
    if concept_data is None:
        raise KeyError(
            f"Concept '{concept}' not found for entity '{entity}'. "
            f"Available: {sorted(k for k in entity_data.keys())}"
        )
    if prop not in concept_data:
        raise KeyError(
            f"Property '{prop}' not found for {entity}/{concept}. "
            f"Available: {sorted(concept_data.keys())}"
        )
    return concept_data[prop]


@pytest.fixture
def seed_tenant_id() -> str:
    return TENANT_ID


@pytest.fixture
def seed_run_id() -> str:
    return RUN_ID
