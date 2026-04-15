"""
Engagement store — canonical engagement CRUD on Convergence's engagements table.

Single source of truth for engagement lifecycle, run ledger, and human reviews.
Platform (Mai) and Console read via HTTP. No proxying back to Platform.
"""

import json
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

import httpx
from psycopg2.extras import RealDictCursor

from backend.core.constants import FARM_API_URL
from backend.core.db import get_connection

logger = logging.getLogger(__name__)

VALID_TRANSITIONS = {
    "draft": {"active"},
    "active": {"paused", "review"},
    "paused": {"active"},
    "review": {"closed", "active", "complete"},
    "complete": {"archived"},
    "closed": {"archived"},
    "archived": set(),
}


class UnsanctionedEntityError(ValueError):
    """Raised when an engagement references an entity_id Farm has no config for."""


class FarmUnavailableError(RuntimeError):
    """Raised when Farm's triple-configs endpoint is unreachable or returns 5xx."""


_sanctioned_cache: dict = {"entities": None, "expires_at": 0.0}
_SANCTIONED_TTL_SECONDS = 60.0


def _fetch_sanctioned_entities() -> set[str]:
    """Return the set of entity_ids Farm has configs for. Cached for 60s.

    Farm is the sole authority on entity_id (RACI). Calls Farm's
    /api/business-data/triple-configs and extracts entity_id from each
    config. On Farm 5xx or unreachable: raises FarmUnavailableError with a
    loud message. No silent "allow all" fallback — refusing to validate is
    refusing to create.
    """
    now = time.monotonic()
    cached = _sanctioned_cache["entities"]
    if cached is not None and now < _sanctioned_cache["expires_at"]:
        return cached

    url = f"{FARM_API_URL.rstrip('/')}/api/business-data/triple-configs"
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url)
    except httpx.ConnectError as e:
        raise FarmUnavailableError(
            f"Cannot validate entity_id — Farm unreachable at {url} "
            f"(connection refused: {e}). Refusing to create engagement "
            f"without Farm-authoritative entity validation."
        ) from e
    except httpx.TimeoutException as e:
        raise FarmUnavailableError(
            f"Cannot validate entity_id — Farm at {url} timed out after 5s "
            f"({e}). Refusing to create engagement."
        ) from e

    if resp.status_code >= 500:
        raise FarmUnavailableError(
            f"Cannot validate entity_id — Farm returned {resp.status_code} "
            f"at {url} (body: {resp.text[:200]!r}). Refusing to create "
            f"engagement."
        )
    if resp.status_code != 200:
        raise FarmUnavailableError(
            f"Cannot validate entity_id — Farm returned unexpected "
            f"{resp.status_code} at {url} (body: {resp.text[:200]!r})."
        )

    configs = resp.json().get("configs") or []
    entities = {c["entity_id"] for c in configs if c.get("entity_id")}
    if not entities:
        raise FarmUnavailableError(
            f"Farm at {url} returned empty sanctioned entity set. "
            f"Refusing to create engagement."
        )

    _sanctioned_cache["entities"] = entities
    _sanctioned_cache["expires_at"] = now + _SANCTIONED_TTL_SECONDS
    return entities


def _validate_sanctioned_entities(acquirer: str, target: str) -> None:
    sanctioned = _fetch_sanctioned_entities()
    rejected = sorted({e for e in (acquirer, target) if e not in sanctioned})
    if rejected:
        raise UnsanctionedEntityError(
            f"entity_id(s) not in Farm's sanctioned set: {rejected}. "
            f"Farm configured entities: {sorted(sanctioned)}. "
            f"Add farm_config_{{entity}}.yaml in Farm before creating "
            f"engagements with new entities."
        )


def _validate_uuid(val: str, name: str) -> str:
    """Validate and return UUID string. Raises ValueError on bad format."""
    try:
        return str(UUID(val))
    except (ValueError, AttributeError):
        raise ValueError(f"{name} must be a valid UUID, got: {val!r}")


def _row_to_dict(row: dict) -> dict:
    """Convert PG engagements row to API response dict."""
    state = row.get("state") or {}
    if isinstance(state, str):
        state = json.loads(state)
    return {
        "engagement_id": str(row["engagement_id"]),
        "tenant_id": str(row["tenant_id"]),
        "engagement_type": row["engagement_type"],
        "acquirer_entity_id": row["acquirer_entity_id"],
        "target_entity_id": row["target_entity_id"],
        "engagement_short_name": row.get("engagement_short_name"),
        "lifecycle_stage": row["lifecycle_stage"],
        # Legacy aliases for Platform compatibility
        "entity_a": row["acquirer_entity_id"],
        "entity_b": row["target_entity_id"],
        "entity_a_id": row["acquirer_entity_id"],
        "entity_b_id": row["target_entity_id"],
        "entity_a_name": state.get("entity_a_name", ""),
        "entity_b_name": state.get("entity_b_name", ""),
        "status": row["lifecycle_stage"],
        "state": state,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


# ── Engagement CRUD ─────────────────────────────────────────────────────────

def create_engagement(
    tenant_id: str,
    acquirer_entity_id: str,
    target_entity_id: str,
    engagement_type: str = "MA",
    engagement_short_name: str | None = None,
    state: dict | None = None,
    engagement_id: str | None = None,
) -> dict:
    _validate_uuid(tenant_id, "tenant_id")
    _validate_sanctioned_entities(acquirer_entity_id, target_entity_id)
    now = datetime.now(timezone.utc)
    state_json = json.dumps(state or {})

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if engagement_id:
                cur.execute(
                    """
                    INSERT INTO engagements
                        (engagement_id, tenant_id, engagement_type,
                         acquirer_entity_id, target_entity_id,
                         engagement_short_name, state, created_at, updated_at)
                    VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    RETURNING *
                    """,
                    (engagement_id, tenant_id, engagement_type,
                     acquirer_entity_id, target_entity_id,
                     engagement_short_name, state_json, now, now),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO engagements
                        (tenant_id, engagement_type,
                         acquirer_entity_id, target_entity_id,
                         engagement_short_name, state, created_at, updated_at)
                    VALUES (%s::uuid, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    RETURNING *
                    """,
                    (tenant_id, engagement_type,
                     acquirer_entity_id, target_entity_id,
                     engagement_short_name, state_json, now, now),
                )
            conn.commit()
            return _row_to_dict(cur.fetchone())


def get_engagement(engagement_id: str) -> dict | None:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM engagements WHERE engagement_id = %s::uuid",
                (engagement_id,),
            )
            row = cur.fetchone()
            return _row_to_dict(row) if row else None


def get_active_engagement(tenant_id: str) -> dict | None:
    _validate_uuid(tenant_id, "tenant_id")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT * FROM engagements
                WHERE tenant_id = %s::uuid AND lifecycle_stage = 'active'
                ORDER BY updated_at DESC LIMIT 1
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
            return _row_to_dict(row) if row else None


def list_engagements(tenant_id: str, lifecycle_stage: str | None = None) -> list[dict]:
    _validate_uuid(tenant_id, "tenant_id")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if lifecycle_stage:
                cur.execute(
                    """
                    SELECT * FROM engagements
                    WHERE tenant_id = %s::uuid AND lifecycle_stage = %s
                    ORDER BY created_at DESC
                    """,
                    (tenant_id, lifecycle_stage),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM engagements
                    WHERE tenant_id = %s::uuid
                    ORDER BY created_at DESC
                    """,
                    (tenant_id,),
                )
            return [_row_to_dict(r) for r in cur.fetchall()]


def update_engagement(
    engagement_id: str,
    lifecycle_stage: str | None = None,
    state: dict | None = None,
    engagement_short_name: str | None = None,
) -> dict | None:
    existing = get_engagement(engagement_id)
    if not existing:
        return None

    if lifecycle_stage:
        current = existing["lifecycle_stage"]
        allowed = VALID_TRANSITIONS.get(current, set())
        if lifecycle_stage not in allowed:
            raise ValueError(
                f"Invalid transition: cannot move from '{current}' to '{lifecycle_stage}'. "
                f"Allowed: {sorted(allowed) if allowed else 'none'}"
            )

    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            sets = ["updated_at = %s"]
            params: list = [now]

            if lifecycle_stage:
                sets.append("lifecycle_stage = %s")
                params.append(lifecycle_stage)
            if state is not None:
                sets.append("state = %s::jsonb")
                params.append(json.dumps(state))
            if engagement_short_name is not None:
                sets.append("engagement_short_name = %s")
                params.append(engagement_short_name)

            params.append(engagement_id)
            cur.execute(
                f"UPDATE engagements SET {', '.join(sets)} WHERE engagement_id = %s::uuid RETURNING *",
                params,
            )
            conn.commit()
            row = cur.fetchone()
            return _row_to_dict(row) if row else None


def delete_engagement(engagement_id: str) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM engagements WHERE engagement_id = %s::uuid",
                (engagement_id,),
            )
            conn.commit()
            return cur.rowcount > 0


# ── Run Ledger ──────────────────────────────────────────────────────────────

def _run_row_to_dict(row: dict) -> dict:
    return {
        "step_id": str(row["id"]),
        "engagement_id": row["engagement_id"],
        "step_name": row["step_name"],
        "status": row["status"],
        "idempotency_key": row["idempotency_key"],
        "inputs_hash": row.get("inputs_hash"),
        "upstream_deps": row.get("upstream_deps"),
        "outputs_ref": row.get("outputs_ref"),
        "error": row.get("error"),
        "started_at": row["started_at"].isoformat() if row.get("started_at") else None,
        "completed_at": row["completed_at"].isoformat() if row.get("completed_at") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
    }


def record_run_step(
    tenant_id: str,
    engagement_id: str,
    step_name: str,
    idempotency_key: str,
    inputs_hash: str,
    upstream_deps: list[str] | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check existing
            cur.execute(
                "SELECT * FROM run_ledger WHERE idempotency_key = %s AND engagement_id = %s",
                (idempotency_key, engagement_id),
            )
            existing = cur.fetchone()

            if existing:
                if existing["inputs_hash"] == inputs_hash:
                    return {
                        "step_id": str(existing["id"]),
                        "step_name": existing["step_name"],
                        "status": existing["status"],
                        "is_new": False,
                    }
                cur.execute(
                    "UPDATE run_ledger SET inputs_hash = %s, status = 'pending' WHERE id = %s",
                    (inputs_hash, existing["id"]),
                )
                conn.commit()
                return {
                    "step_id": str(existing["id"]),
                    "step_name": existing["step_name"],
                    "status": "pending",
                    "is_new": False,
                }

            cur.execute(
                """
                INSERT INTO run_ledger
                    (tenant_id, engagement_id, step_name, status,
                     idempotency_key, inputs_hash, upstream_deps, created_at)
                VALUES (%s::uuid, %s, %s, 'pending', %s, %s, %s, %s)
                RETURNING id
                """,
                (tenant_id, engagement_id, step_name,
                 idempotency_key, inputs_hash, upstream_deps, now),
            )
            conn.commit()
            new_id = cur.fetchone()["id"]
            return {
                "step_id": str(new_id),
                "step_name": step_name,
                "status": "pending",
                "is_new": True,
            }


def update_run_step(step_id: str, status: str, outputs_ref: str | None = None, error: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status == "running":
                cur.execute(
                    "UPDATE run_ledger SET status = 'running', started_at = %s WHERE id = %s::uuid RETURNING *",
                    (now, step_id),
                )
            elif status == "complete":
                cur.execute(
                    "UPDATE run_ledger SET status = 'complete', completed_at = %s, outputs_ref = %s WHERE id = %s::uuid RETURNING *",
                    (now, outputs_ref, step_id),
                )
            elif status == "failed":
                cur.execute(
                    "UPDATE run_ledger SET status = 'failed', completed_at = %s, error = %s WHERE id = %s::uuid RETURNING *",
                    (now, error, step_id),
                )
            elif status == "stale":
                cur.execute(
                    "UPDATE run_ledger SET status = 'stale' WHERE id = %s::uuid RETURNING *",
                    (step_id,),
                )
            else:
                raise ValueError(f"Invalid run step status: {status}")
            conn.commit()
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Run step not found: {step_id}")
            return _run_row_to_dict(row)


def list_run_steps(engagement_id: str, status: str | None = None) -> list[dict]:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status:
                cur.execute(
                    "SELECT * FROM run_ledger WHERE engagement_id = %s AND status = %s ORDER BY created_at",
                    (engagement_id, status),
                )
            else:
                cur.execute(
                    "SELECT * FROM run_ledger WHERE engagement_id = %s ORDER BY created_at",
                    (engagement_id,),
                )
            return [_run_row_to_dict(r) for r in cur.fetchall()]


def get_run_step(step_id: str) -> dict | None:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM run_ledger WHERE id = %s::uuid", (step_id,))
            row = cur.fetchone()
            return _run_row_to_dict(row) if row else None


# ── Human Reviews ───────────────────────────────────────────────────────────

def _review_row_to_dict(row: dict) -> dict:
    context = row.get("context") or {}
    if isinstance(context, str):
        context = json.loads(context)
    return {
        "review_id": str(row["id"]),
        "engagement_id": row["engagement_id"],
        "action": row["action"],
        "context": context,
        "tier": row["tier"],
        "status": row["status"],
        "requested_by": row["requested_by"],
        "approved_by": row.get("approved_by"),
        "rejected_by": row.get("rejected_by"),
        "rejection_reason": row.get("rejection_reason"),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
        "resolved_at": row["resolved_at"].isoformat() if row.get("resolved_at") else None,
    }


def create_review(
    tenant_id: str,
    engagement_id: str,
    action: str,
    context: dict,
    tier: int,
    requested_by: str = "mai",
) -> dict:
    now = datetime.now(timezone.utc)
    status = "approved" if tier == 1 else "pending"
    resolved_at = now if tier == 1 else None

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO human_reviews
                    (tenant_id, engagement_id, action, context, tier, status,
                     requested_by, created_at, resolved_at)
                VALUES (%s::uuid, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (tenant_id, engagement_id, action, json.dumps(context),
                 tier, status, requested_by, now, resolved_at),
            )
            conn.commit()
            return _review_row_to_dict(cur.fetchone())


def list_reviews(engagement_id: str, status_filter: str | None = None) -> list[dict]:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status_filter:
                cur.execute(
                    """
                    SELECT * FROM human_reviews
                    WHERE engagement_id = %s AND status = %s
                    ORDER BY created_at
                    """,
                    (engagement_id, status_filter),
                )
            else:
                cur.execute(
                    "SELECT * FROM human_reviews WHERE engagement_id = %s ORDER BY created_at",
                    (engagement_id,),
                )
            return [_review_row_to_dict(r) for r in cur.fetchall()]


def update_review(review_id: str, status: str, by: str, reason: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status == "approved":
                cur.execute(
                    """
                    UPDATE human_reviews
                    SET status = 'approved', approved_by = %s, resolved_at = %s
                    WHERE id = %s::uuid RETURNING *
                    """,
                    (by, now, review_id),
                )
            elif status == "rejected":
                cur.execute(
                    """
                    UPDATE human_reviews
                    SET status = 'rejected', rejected_by = %s,
                        rejection_reason = %s, resolved_at = %s
                    WHERE id = %s::uuid RETURNING *
                    """,
                    (by, reason, now, review_id),
                )
            else:
                raise ValueError(f"Invalid review status: {status}")
            conn.commit()
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Review not found: {review_id}")
            return _review_row_to_dict(row)
