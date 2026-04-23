#!/usr/bin/env python3
"""Sync entity catalog — populate convergence_triples per Farm snapshot.

One-shot seeding path for the freely-selectable entity feature. For each
snapshot returned by ``GET /api/snapshots`` on Farm, calls
``POST /api/snapshots/{snapshot_id}/push-triples`` with a target_url
pointing at Convergence's ingest-triples endpoint. Farm runs the SE
triple stack against the named snapshot and POSTs the result to
Convergence under ``tenant_id=$AOS_TENANT_ID`` and
``entity_id=<snapshot.meta.tenant_id>``.

Replaces the prior template + remap path
(``/api/business-data/generate-multi-entity-triples`` +
``remap_to_convergence_triples``) that grafted Farm snapshot business
keys onto Multi-Entity template output — producing correct-shape
``entity_id`` strings paired with the wrong template's financials.

Pre-existing gaps tracked in convergence_deferred_work.md:

* Convergence catalog is populated via this Farm-snapshot sync stub
  for the AOD → AAM → DCL → Convergence pipeline. When AAM + DCL land,
  swap source to a DCL read; the convergence_triples contract and the
  catalog endpoint stay unchanged.
* The snapshot list limit is hardcoded at 150. Revisit when the real
  ingestion pipeline exists.
* Farm's snapshot ``meta.tenant_id`` carries a business-key-shaped
  value, not a UUID. Mapped here to Convergence's ``entity_id``. See
  convergence_deferred_work.md entry 21.

Idempotent. Farm's push endpoint passes ``?replace=true`` for the first
batch, which deletes the prior (tenant_id, entity_id) rows in
convergence_triples before inserting, so re-runs cleanly replace.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Allow running from repo root or scripts/ without sys.path gymnastics.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from backend.core.entity_id import ENTITY_ID_PATTERN

FARM_BASE = os.environ.get("FARM_BASE_URL", "http://localhost:8003")
CONVERGENCE_BASE = os.environ.get("CONVERGENCE_BASE_URL", "http://localhost:8010")

# Known limit — see deferred-work entry 20. Revisit with real ingestion.
FARM_SNAPSHOT_LIMIT = 150

# Frontend reads build-time VITE_AOS_TENANT_ID to filter engagements and
# report queries. Farm's push endpoint stamps this on every triple at the
# ingest boundary so the frontend and engines resolve the same rows.
SYNC_TENANT_ID = os.environ.get("AOS_TENANT_ID") or os.environ.get("VITE_AOS_TENANT_ID")
if not SYNC_TENANT_ID:
    raise SystemExit(
        "AOS_TENANT_ID (or VITE_AOS_TENANT_ID) must be set — Farm stamps "
        "this on every triple at the ingest boundary so the frontend and "
        "engines resolve the same rows. Check .env.development."
    )

logging.basicConfig(
    level=logging.INFO,
    format="[sync-catalog] %(message)s",
)
log = logging.getLogger("sync-catalog")

_SHAPE_RE = re.compile(ENTITY_ID_PATTERN)


def _http_get_json(url: str, timeout: float = 30.0) -> list | dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_post_json(url: str, body: dict | None = None, timeout: float = 600.0) -> dict:
    data = json.dumps(body or {}).encode("utf-8") if body else b""
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_snapshots(limit: int) -> list[dict]:
    """Return up to `limit` snapshots from Farm that carry a shape-compliant
    ``meta.tenant_id``.

    Snapshots whose ``meta.tenant_id`` does not match ``ENTITY_ID_PATTERN``
    are skipped — Convergence's ingest-triples endpoint rejects non-compliant
    entity_ids at write time, so there's no reason to send them.
    """
    url = f"{FARM_BASE}/api/snapshots?limit={limit}"
    log.info(f"Fetching snapshots from {url}")
    payload = _http_get_json(url)
    snapshots = payload if isinstance(payload, list) else payload.get("snapshots", [])

    shape_compliant: list[dict] = []
    skipped_shape = 0
    seen_entities: set[str] = set()
    for s in snapshots:
        entity_id = s.get("tenant_id") or s.get("entity_id")
        if not entity_id or not _SHAPE_RE.match(entity_id):
            skipped_shape += 1
            continue
        if entity_id in seen_entities:
            continue  # dedupe: first snapshot per business key wins
        seen_entities.add(entity_id)
        shape_compliant.append(s)

    log.info(
        f"Found {len(shape_compliant)} shape-compliant snapshots "
        f"(skipped {skipped_shape} non-compliant, deduped to unique entity_ids)"
    )
    if not shape_compliant:
        raise SystemExit(
            "No shape-compliant snapshots returned by Farm. Generate snapshots "
            f"via POST {FARM_BASE}/api/snapshots first."
        )
    return shape_compliant


def push_snapshot_to_convergence(snapshot: dict) -> dict:
    """Call Farm's POST /api/snapshots/{id}/push-triples with target_url set
    to Convergence's ingest-triples endpoint.

    Farm generates the SE triple stack against the snapshot and POSTs the
    resulting JSONL to Convergence in batches. Returns Farm's response body
    (farm_manifest_id, entity_id, triples_generated, pushed, total, ...).
    """
    snapshot_id = snapshot["snapshot_id"]
    entity_id = snapshot.get("tenant_id") or snapshot.get("entity_id")
    target_url = f"{CONVERGENCE_BASE}/api/convergence/ingest-triples"
    push_url = (
        f"{FARM_BASE}/api/snapshots/{snapshot_id}/push-triples"
        f"?target_url={target_url}&tenant_id={SYNC_TENANT_ID}"
    )
    log.info(f"Pushing snapshot {snapshot_id} (entity_id={entity_id}) → {target_url}")
    try:
        result = _http_post_json(push_url)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"Farm push-triples failed for snapshot {snapshot_id} "
            f"(entity_id={entity_id}): HTTP {e.code} — {body_text}"
        ) from e
    pushed = result.get("pushed", 0)
    total = result.get("total", 0)
    success = result.get("success", False)
    if not success or pushed != total:
        raise SystemExit(
            f"Farm push-triples reported incomplete push for snapshot "
            f"{snapshot_id} (entity_id={entity_id}): success={success}, "
            f"pushed={pushed}, total={total}, errors={result.get('errors')}"
        )
    log.info(
        f"Snapshot {snapshot_id} done: entity_id={result.get('entity_id')}, "
        f"triples={pushed}, farm_manifest_id={result.get('farm_manifest_id')}"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-snapshots",
        type=int,
        default=FARM_SNAPSHOT_LIMIT,
        help=(
            f"Maximum number of shape-compliant snapshots to sync in this "
            f"run. Default {FARM_SNAPSHOT_LIMIT}."
        ),
    )
    args = parser.parse_args()

    t_start = time.monotonic()

    snapshots = fetch_snapshots(limit=FARM_SNAPSHOT_LIMIT)
    if args.max_snapshots < len(snapshots):
        log.info(
            f"Capping sync at --max-snapshots={args.max_snapshots} "
            f"(out of {len(snapshots)} shape-compliant snapshots found)"
        )
        snapshots = snapshots[: args.max_snapshots]

    total_triples = 0
    for idx, snap in enumerate(snapshots, 1):
        log.info(
            f"[{idx}/{len(snapshots)}] snapshot_id={snap['snapshot_id']} "
            f"industry={snap.get('industry')}"
        )
        result = push_snapshot_to_convergence(snap)
        total_triples += result.get("pushed", 0)

    elapsed = round(time.monotonic() - t_start, 1)
    log.info(
        f"Done. Synced {len(snapshots)} snapshots, {total_triples} triples, "
        f"in {elapsed}s."
    )
    log.info(f"Sync tenant_id={SYNC_TENANT_ID}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
