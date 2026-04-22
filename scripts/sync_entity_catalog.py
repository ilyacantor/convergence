#!/usr/bin/env python3
"""Sync entity catalog — populate convergence_triples with shape-compliant entity_ids.

One-shot seeding path for the freely-selectable entity feature. Pulls
properly-shaped business keys from Farm's snapshot catalog
(``GET /api/snapshots?limit=150``), drives a pair of Farm Multi-Entity
triple runs to get real P&L/BS/CF/EBITDA data under the two available
industry templates (bpm_services + saas_consultancy), remaps the
template-derived entity_ids onto Farm-sourced business keys, and POSTs
the result to Convergence's ingest-triples endpoint.

Pre-existing Farm gaps tracked in convergence_deferred_work.md:

* Convergence catalog is populated via this sync-from-Farm-snapshot
  stub for the Farm → AOD → AAM → DCL → Convergence pipeline. When AAM
  + DCL land, swap source to a DCL read; the convergence_triples
  contract and the catalog endpoint stay unchanged.
* The limit=150 constant is hardcoded. Revisit when the ingestion
  pipeline is real.
* Farm's snapshot ``meta.tenant_id`` carries a business-key-shaped
  value, not a UUID. Mapped here to Convergence's ``entity_id``. See
  convergence_deferred_work.md.

Idempotent. Re-running replaces the prior sync-owned triples via the
``?replace=true`` query on the Convergence ingest endpoint.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import uuid
from pathlib import Path

import urllib.request
import urllib.error

# Allow running from repo root or scripts/ without sys.path gymnastics.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from backend.core.entity_id import ENTITY_ID_PATTERN, is_valid_entity_id

FARM_BASE = os.environ.get("FARM_BASE_URL", "http://localhost:8003")
CONVERGENCE_BASE = os.environ.get("CONVERGENCE_BASE_URL", "http://localhost:8010")

# Known limit — see deferred-work entry above. Revisit with real ingestion.
FARM_SNAPSHOT_LIMIT = 150

# Stable tenant_id so re-runs replace the prior sync instead of cloning.
_SYNC_NS = uuid.UUID("12345678-1234-5678-1234-567812345678")
SYNC_TENANT_ID = str(uuid.uuid5(_SYNC_NS, "convergence-sync-entity-catalog"))

# Farm Multi-Entity templates available today. The sync remaps their
# emitted entity_ids onto Farm-sourced business keys so the resulting
# triple rows carry shape-compliant entity_ids end-to-end.
_TEMPLATE_ORDER = ["bpm_services", "saas_consultancy"]

logging.basicConfig(
    level=logging.INFO,
    format="[sync-catalog] %(message)s",
)
log = logging.getLogger("sync-catalog")

_SHAPE_RE = re.compile(ENTITY_ID_PATTERN)


def _http_get_json(url: str, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_post_json(url: str, body: dict, timeout: float = 120.0) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_shape_compliant_entity_ids(n: int) -> list[str]:
    """Pull Farm's snapshot list and return the first `n` shape-compliant ids.

    Reads ``meta.tenant_id`` per snapshot — that's where Farm currently stores
    the business key. Deduplicates while preserving order.
    """
    url = f"{FARM_BASE}/api/snapshots?limit={FARM_SNAPSHOT_LIMIT}"
    log.info(f"Fetching snapshots from {url}")
    payload = _http_get_json(url)
    snaps = payload if isinstance(payload, list) else payload.get("snapshots", [])
    seen: set[str] = set()
    picks: list[str] = []
    for s in snaps:
        eid = s.get("tenant_id") or s.get("entity_id")  # Farm quirk
        if not eid or eid in seen:
            continue
        if _SHAPE_RE.match(eid):
            picks.append(eid)
            seen.add(eid)
        if len(picks) >= n:
            break
    if len(picks) < n:
        raise RuntimeError(
            f"Farm returned only {len(picks)} shape-compliant entity_ids "
            f"(needed {n}). Generate more enterprise snapshots first."
        )
    log.info(f"Picked {len(picks)} shape-compliant entity_ids: {picks}")
    return picks


def _poll_farm_generation_idle(timeout_s: float = 180.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        status = _http_get_json(f"{FARM_BASE}/api/business-data/generation-status")
        if status.get("status") == "idle":
            return
        time.sleep(1.0)
    raise RuntimeError("Farm Multi-Entity generation did not return to idle in time")


def drive_farm_multi_entity_run(seed: int) -> str:
    """Kick off a Multi-Entity triple run (skip_push=true) and wait for idle.

    Returns the ``farm_manifest_id`` for the run on disk.
    """
    entities = ",".join(_TEMPLATE_ORDER)
    url = (
        f"{FARM_BASE}/api/business-data/generate-multi-entity-triples"
        f"?entities={entities}&seed={seed}&skip_push=true"
    )
    log.info(f"Driving Farm Multi-Entity run (seed={seed})")
    # The endpoint is POST; body is empty (params in query).
    req = urllib.request.Request(url, data=b"", method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180.0) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    run_id = result.get("farm_manifest_id") or result.get("run_id")
    if not run_id:
        # Fall back to polling status for the most recent run.
        status = _http_get_json(f"{FARM_BASE}/api/business-data/generation-status")
        run_id = status.get("farm_manifest_id")
    _poll_farm_generation_idle()
    if not run_id:
        raise RuntimeError("Farm Multi-Entity run finished but no farm_manifest_id surfaced")
    log.info(f"Farm run landed: farm_manifest_id={run_id}")
    return run_id


def load_farm_jsonl(farm_manifest_id: str) -> list[dict]:
    """Stream the Farm output JSONL for a Multi-Entity run from disk."""
    # Farm's canonical output path (see farm/src/api/business_data.py:_get_triples_output_dir).
    output_dir = _REPO_ROOT.parent / "farm" / "output" / "triples"
    path = output_dir / f"{farm_manifest_id}_triples.jsonl"
    if not path.is_file():
        raise RuntimeError(f"Farm JSONL not found at {path}")
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    log.info(f"Loaded {len(rows)} triples from {path.name}")
    return rows


def remap_to_convergence_triples(
    raw_rows: list[dict],
    entity_remap: dict[str, str],
) -> list[dict]:
    """Transform Farm JSONL rows into Convergence ingest-triples payload shape.

    Rewrites ``entity_id`` per ``entity_remap`` (template name → business key),
    drops Farm-only metadata (``fabric_plane``, ``fabric_product``, ``tenant_id``,
    ``run_id``), and fills in Convergence-required optional fields.
    """
    out: list[dict] = []
    for r in raw_rows:
        src_eid = r.get("entity_id")
        if src_eid not in entity_remap:
            continue  # defensive: ignore triples outside the remap set
        target_eid = entity_remap[src_eid]
        if not is_valid_entity_id(target_eid):
            raise RuntimeError(
                f"Remap target {target_eid!r} for {src_eid!r} is not shape-compliant"
            )
        out.append({
            "entity_id": target_eid,
            "concept": r["concept"],
            "property": r["property"],
            "value": r["value"],
            "period": r.get("period"),
            "currency": r.get("currency", "USD"),
            "unit": r.get("unit"),
            "source_system": r.get("source_system") or "farm-sync",
            "source_table": r.get("source_table"),
            "source_field": r.get("source_field"),
            "pipe_id": r.get("pipe_id"),
            "confidence_score": r.get("confidence_score", 0.9),
            "confidence_tier": r.get("confidence_tier", "high"),
            "canonical_id": None,
            "resolution_method": None,
            "resolution_confidence": None,
        })
    return out


def push_batch_to_convergence(
    triples: list[dict],
    source_run_tag: str,
    batch_size: int = 2000,
) -> str:
    """POST triples to Convergence's ingest-triples endpoint in batches.

    Returns the convergence_ingest_id used for the batch run.
    """
    convergence_ingest_id = str(uuid.uuid4())
    url = f"{CONVERGENCE_BASE}/api/convergence/ingest-triples?replace=true"
    first = True
    total = 0
    for i in range(0, len(triples), batch_size):
        chunk = triples[i:i + batch_size]
        body = {
            "tenant_id": SYNC_TENANT_ID,
            "convergence_ingest_id": convergence_ingest_id,
            "source_run_tag": source_run_tag,
            "snapshot_name": f"sync-{source_run_tag}",
            "triples": chunk,
        }
        # First batch uses ?replace=true; subsequent batches use ?append=true.
        batch_url = url if first else f"{CONVERGENCE_BASE}/api/convergence/ingest-triples?append=true"
        resp = _http_post_json(batch_url, body)
        total += resp.get("triples_written", len(chunk))
        first = False
    log.info(f"Pushed {total} triples under convergence_ingest_id={convergence_ingest_id}")
    return convergence_ingest_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pairs", type=int, default=2,
                        help="Number of pairs to seed (4 entities per 2 pairs). Default 2.")
    args = parser.parse_args()
    n_entities = args.pairs * len(_TEMPLATE_ORDER)

    picks = fetch_shape_compliant_entity_ids(n_entities)

    for pair_idx in range(args.pairs):
        seed = 42 + pair_idx * 4200
        farm_run = drive_farm_multi_entity_run(seed=seed)
        raw_rows = load_farm_jsonl(farm_run)
        start = pair_idx * len(_TEMPLATE_ORDER)
        remap = {
            tpl: picks[start + i]
            for i, tpl in enumerate(_TEMPLATE_ORDER)
        }
        log.info(f"Pair {pair_idx + 1}/{args.pairs} remap: {remap}")
        triples = remap_to_convergence_triples(raw_rows, remap)
        push_batch_to_convergence(
            triples,
            source_run_tag=f"sync-entity-catalog-pair-{pair_idx + 1}",
        )

    log.info(f"Done. Synced {n_entities} shape-compliant entities into convergence_triples.")
    log.info(f"Synthetic sync tenant_id={SYNC_TENANT_ID}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
