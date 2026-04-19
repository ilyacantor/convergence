"""
ResolverStore — CRUD for resolver_decisions table.

Sync psycopg2, parameterized queries. Supports the identity resolver's
tier-based matching and HITL state machine.
"""

import json
import logging
from datetime import datetime, timezone

from psycopg2.extras import RealDictCursor, execute_values

from backend.core.db import get_connection

logger = logging.getLogger(__name__)


def _row_to_dict(row: dict) -> dict:
    evidence = row.get("evidence_json")
    if isinstance(evidence, str):
        evidence = json.loads(evidence)
    return {
        "id": str(row["id"]),
        "engagement_id": str(row["engagement_id"]),
        "domain": row["domain"],
        "acquirer_record_id": row["acquirer_record_id"],
        "target_record_id": row.get("target_record_id"),
        "confidence": float(row["confidence"]),
        "evidence": evidence,
        "tier_matched": row["tier_matched"],
        "hitl_state": row["hitl_state"],
        "hitl_operator": row.get("hitl_operator"),
        "hitl_timestamp": (
            row["hitl_timestamp"].isoformat()
            if row.get("hitl_timestamp")
            else None
        ),
        "content_hash_acq": row["content_hash_acq"],
        "content_hash_tgt": row.get("content_hash_tgt"),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def insert_decisions(engagement_id: str, decisions: list[dict]) -> int:
    """Bulk insert resolver decisions. Returns count inserted."""
    if not decisions:
        return 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO resolver_decisions
                    (engagement_id, domain, acquirer_record_id, target_record_id,
                     confidence, evidence_json, tier_matched, hitl_state,
                     content_hash_acq, content_hash_tgt)
                VALUES %s
            """
            values = [
                (
                    engagement_id,
                    d["domain"],
                    d["acquirer_record_id"],
                    d.get("target_record_id"),
                    d["confidence"],
                    json.dumps(d["evidence"]),
                    d["tier_matched"],
                    d["hitl_state"],
                    d["content_hash_acq"],
                    d.get("content_hash_tgt"),
                )
                for d in decisions
            ]
            execute_values(cur, sql, values)
            conn.commit()
            return len(values)


def get_decisions(
    engagement_id: str,
    domain: str | None = None,
    hitl_state: str | None = None,
) -> list[dict]:
    """Query resolver decisions with optional filters."""
    clauses = ["engagement_id = %s::uuid"]
    params: list = [engagement_id]
    if domain:
        clauses.append("domain = %s")
        params.append(domain)
    if hitl_state:
        clauses.append("hitl_state = %s")
        params.append(hitl_state)

    sql = (
        f"SELECT * FROM resolver_decisions "
        f"WHERE {' AND '.join(clauses)} "
        f"ORDER BY domain, confidence DESC"
    )

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return [_row_to_dict(r) for r in cur.fetchall()]


def get_decision(decision_id: str) -> dict | None:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM resolver_decisions WHERE id = %s::uuid",
                (decision_id,),
            )
            row = cur.fetchone()
            return _row_to_dict(row) if row else None


def update_hitl(
    decision_id: str,
    hitl_state: str,
    operator: str,
) -> dict:
    """Update HITL state on a resolver decision. Enforces state machine rules."""
    existing = get_decision(decision_id)
    if not existing:
        raise ValueError(f"Resolver decision not found: {decision_id}")

    current = existing["hitl_state"]
    if current == "auto_accepted":
        raise ValueError(
            f"Cannot modify auto_accepted decision {decision_id}. "
            f"Auto-accepted decisions are terminal."
        )
    if current == hitl_state:
        raise ValueError(
            f"Decision {decision_id} is already in state '{hitl_state}'."
        )

    valid_transitions = {
        "pending_hitl": {"confirmed", "rejected", "deferred"},
        "stale": {"confirmed", "rejected", "deferred"},
        "deferred": {"confirmed", "rejected"},
        "confirmed": set(),
        "rejected": set(),
    }
    allowed = valid_transitions.get(current, set())
    if hitl_state not in allowed:
        raise ValueError(
            f"Invalid HITL transition: '{current}' -> '{hitl_state}'. "
            f"Allowed from '{current}': {sorted(allowed) if allowed else 'none (terminal)'}."
        )

    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE resolver_decisions
                SET hitl_state = %s, hitl_operator = %s, hitl_timestamp = %s
                WHERE id = %s::uuid
                RETURNING *
                """,
                (hitl_state, operator, now, decision_id),
            )
            conn.commit()
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Failed to update decision: {decision_id}")
            return _row_to_dict(row)


def get_summary(engagement_id: str) -> dict:
    """Aggregate counts per domain and total for an engagement."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT domain, hitl_state, COUNT(*) AS cnt
                FROM resolver_decisions
                WHERE engagement_id = %s::uuid
                GROUP BY domain, hitl_state
                ORDER BY domain, hitl_state
                """,
                (engagement_id,),
            )
            rows = cur.fetchall()

    per_domain: dict = {}
    totals: dict[str, int] = {}
    for row in rows:
        domain = row["domain"]
        state = row["hitl_state"]
        count = row["cnt"]
        if domain not in per_domain:
            per_domain[domain] = {}
        per_domain[domain][state] = count
        totals[state] = totals.get(state, 0) + count

    return {
        "engagement_id": engagement_id,
        "per_domain": per_domain,
        "totals": totals,
        "total_decisions": sum(totals.values()),
    }


def delete_decisions_for_domain(engagement_id: str, domain: str) -> int:
    """Delete all decisions for an engagement+domain (for re-resolve)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM resolver_decisions WHERE engagement_id = %s::uuid AND domain = %s",
                (engagement_id, domain),
            )
            conn.commit()
            return cur.rowcount


def mark_stale(engagement_id: str, decision_ids: list[str]) -> int:
    """Mark specific decisions as stale (content hash changed)."""
    if not decision_ids:
        return 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE resolver_decisions
                SET hitl_state = 'stale'
                WHERE engagement_id = %s::uuid
                  AND id = ANY(%s::uuid[])
                  AND hitl_state NOT IN ('auto_accepted')
                """,
                (engagement_id, decision_ids),
            )
            conn.commit()
            return cur.rowcount
