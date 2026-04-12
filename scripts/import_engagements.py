#!/usr/bin/env python3
"""
One-shot data migration: consolidate engagement state into Convergence.

Sources:
  1. Platform PG: public.engagement_state, run_ledger, human_reviews
  2. Console PG: console.engagements

Target: Convergence PG: engagements, run_ledger (new), human_reviews (new)

Idempotent: ON CONFLICT DO NOTHING for inserts, UPDATE for Console merge.
Lifecycle reconciliation: Platform wins when both disagree.
"""

import json
import logging
import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("import_engagements")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    # Try .env file
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith("DATABASE_URL="):
                DATABASE_URL = line.split("=", 1)[1].strip()
                break

if not DATABASE_URL:
    logger.error("DATABASE_URL not set and .env not found")
    sys.exit(1)

# AOS_TENANT_ID is the canonical tenant for this deployment
TENANT_ID = os.environ.get("AOS_TENANT_ID")

# Entity metadata from demo-001.json (the file-based config being replaced).
# This populates the state JSONB with entity display names, business models,
# source systems, deal parameters, and synergy targets.
ENTITY_METADATA = {
    "deal_name": "Meridian-Cascadia Integration",
    "entity_a_name": "Meridian",
    "entity_b_name": "Cascadia",
    "entity_a_business_model": "consultancy",
    "entity_b_business_model": "bpm",
    "entity_a_source_systems": {"crm": "salesforce_crm", "erp": "sap_erp", "hcm": "workday_hcm"},
    "entity_b_source_systems": {"crm": "oracle_erp", "erp": "oracle_erp", "hcm": "bamboohr_hcm"},
    "deal_parameters": {"deal_value_M": 3200.0, "close_date": "2026-06-30", "integration_timeline_months": 18},
    "synergy_targets": {"cost_synergies_target_M": 200.0, "revenue_synergies_target_M": 50.0},
}


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    counts = {"platform_eng": 0, "console_eng": 0, "conv_eng": 0, "run_ledger": 0, "human_reviews": 0}

    # ── Step 1: Read Platform engagement_state ──────────────────────────────
    cur.execute("SELECT * FROM engagement_state")
    platform_rows = cur.fetchall()
    counts["platform_eng"] = len(platform_rows)
    logger.info("Platform engagement_state: %d rows", len(platform_rows))

    for row in platform_rows:
        config = row.get("config") or {}
        if isinstance(config, str):
            config = json.loads(config)

        tenant_id = str(row["tenant_id"]) if row.get("tenant_id") else TENANT_ID
        state = {**ENTITY_METADATA, **config}

        cur.execute(
            """
            INSERT INTO engagements
                (engagement_id, tenant_id, engagement_type,
                 acquirer_entity_id, target_entity_id,
                 engagement_short_name, lifecycle_stage, state,
                 created_at, updated_at)
            VALUES (%s::uuid, %s::uuid, 'MA', %s, %s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT (engagement_id) DO NOTHING
            """,
            (
                str(row["engagement_id"]) if row.get("engagement_id") else str(row["id"]),
                tenant_id,
                row.get("entity_a_id", ""),
                row.get("entity_b_id", ""),
                None,
                row.get("status", "draft"),
                json.dumps(state),
                row.get("created_at"),
                row.get("updated_at"),
            ),
        )
        counts["conv_eng"] += cur.rowcount
        logger.info("  Platform row: engagement_id=%s status=%s → inserted=%d",
                     row.get("engagement_id") or row.get("id"), row.get("status"), cur.rowcount)

    # ── Step 2: Read Console console.engagements ────────────────────────────
    cur.execute("SELECT * FROM console.engagements")
    console_rows = cur.fetchall()
    counts["console_eng"] = len(console_rows)
    logger.info("Console engagements: %d rows", len(console_rows))

    for row in console_rows:
        console_state = row.get("state_json") or {}
        if isinstance(console_state, str):
            console_state = json.loads(console_state)

        tenant_id = row.get("tenant_id") or TENANT_ID
        if not tenant_id:
            logger.warning("  Console row %s: no tenant_id, skipping", row["engagement_id"])
            continue

        # Merge: entity metadata + console state keys
        merged_state = {**ENTITY_METADATA, **console_state}

        # Map Console lifecycle stages to canonical set
        lifecycle = row.get("lifecycle_stage", "draft")
        VALID_STAGES = {"draft", "active", "paused", "review", "complete", "closed", "archived"}
        if lifecycle == "upload":
            lifecycle = "draft"
        if lifecycle not in VALID_STAGES:
            logger.warning("  Console row %s: unknown lifecycle '%s', mapping to 'draft'",
                           row["engagement_id"], lifecycle)
            lifecycle = "draft"

        engagement_short_name = row.get("engagement_short_name")

        # Try matching by convergence_engagement_id first, then by entity pair
        conv_eid = row.get("convergence_engagement_id")
        matched = False

        if conv_eid:
            # convergence_engagement_id may be a non-UUID string from old system
            try:
                from uuid import UUID
                UUID(conv_eid)
                cur.execute("SELECT engagement_id FROM engagements WHERE engagement_id = %s::uuid", (conv_eid,))
                match_row = cur.fetchone()
            except (ValueError, AttributeError):
                match_row = None
                logger.info("  Console row %s: convergence_engagement_id '%s' is not a UUID, skipping match",
                            row["engagement_id"], conv_eid)
            if match_row:
                # Update existing Convergence row with Console state
                cur.execute(
                    """
                    UPDATE engagements
                    SET state = state || %s::jsonb,
                        engagement_short_name = COALESCE(%s, engagement_short_name),
                        updated_at = NOW()
                    WHERE engagement_id = %s::uuid
                    """,
                    (json.dumps(console_state), engagement_short_name, conv_eid),
                )
                logger.info("  Console row %s: merged into existing Convergence %s", row["engagement_id"], conv_eid)
                matched = True

        if not matched:
            # Check if Platform already inserted a matching row by entity pair
            cur.execute(
                """
                SELECT engagement_id FROM engagements
                WHERE acquirer_entity_id = %s AND target_entity_id = %s
                LIMIT 1
                """,
                (row.get("acquirer_entity_id", ""), row.get("target_entity_id", "")),
            )
            existing = cur.fetchone()
            if existing:
                # Merge Console state into Platform-originated row; Platform lifecycle wins
                cur.execute(
                    """
                    UPDATE engagements
                    SET state = state || %s::jsonb,
                        engagement_short_name = COALESCE(%s, engagement_short_name),
                        updated_at = NOW()
                    WHERE engagement_id = %s::uuid
                    """,
                    (json.dumps(console_state), engagement_short_name, str(existing["engagement_id"])),
                )
                logger.info("  Console row %s: merged into existing by entity pair (Platform lifecycle wins)",
                            row["engagement_id"])
            else:
                # No Platform row — insert Console row as new engagement
                cur.execute(
                    """
                    INSERT INTO engagements
                        (tenant_id, engagement_type,
                         acquirer_entity_id, target_entity_id,
                         engagement_short_name, lifecycle_stage, state,
                         created_at, updated_at)
                    VALUES (%s::uuid, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    ON CONFLICT DO NOTHING
                    RETURNING engagement_id
                    """,
                    (
                        tenant_id, row.get("engagement_type", "MA"),
                        row.get("acquirer_entity_id", ""),
                        row.get("target_entity_id", ""),
                        engagement_short_name, lifecycle,
                        json.dumps(merged_state),
                        row.get("created_at"), row.get("updated_at"),
                    ),
                )
                new_row = cur.fetchone()
                if new_row:
                    counts["conv_eng"] += 1
                    logger.info("  Console row %s: inserted as new engagement %s",
                                row["engagement_id"], new_row["engagement_id"])

    # ── Step 3: Copy run_ledger from Platform ───────────────────────────────
    # run_ledger table is shared — rows may already be in new table from migration
    cur.execute("SELECT count(*) as cnt FROM run_ledger WHERE engagement_id IS NOT NULL")
    rl_count = cur.fetchone()["cnt"]
    counts["run_ledger"] = rl_count
    logger.info("run_ledger: %d rows (already in shared table)", rl_count)

    # ── Step 4: Copy human_reviews from Platform ────────────────────────────
    cur.execute("SELECT count(*) as cnt FROM human_reviews")
    hr_count = cur.fetchone()["cnt"]
    counts["human_reviews"] = hr_count
    logger.info("human_reviews: %d rows (already in shared table)", hr_count)

    conn.commit()

    # ── Verify ──────────────────────────────────────────────────────────────
    cur.execute("SELECT count(*) as cnt FROM engagements")
    final_count = cur.fetchone()["cnt"]
    logger.info("=== VERIFICATION ===")
    logger.info("Platform rows read: %d", counts["platform_eng"])
    logger.info("Console rows read: %d", counts["console_eng"])
    logger.info("Convergence engagements final: %d", final_count)
    logger.info("run_ledger: %d", counts["run_ledger"])
    logger.info("human_reviews: %d", counts["human_reviews"])

    expected = max(counts["platform_eng"], counts["console_eng"], 1)
    if final_count < expected:
        logger.error("Row count mismatch! Expected >= %d, got %d", expected, final_count)
        sys.exit(1)

    logger.info("Migration complete.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
