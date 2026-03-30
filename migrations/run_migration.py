"""
Convergence migration runner — ASSERT-ONLY.

Verifies that convergence-owned tables exist in PG. Does NOT create tables.
Tables are created by the migration SQL files run during initial setup.
Fails loudly if any table is missing.
"""

import os
import sys

import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)

REQUIRED_TABLES = [
    "engagement_state",
    "resolution_workspaces_v2",
    # semantic_triples is DCL-owned but convergence reads it — verify it exists
    "semantic_triples",
    # Convergence-owned triple store (ME data isolation)
    "convergence_triples",
    "convergence_tenant_runs",
    "convergence_ingest_log",
    # What-if scenario persistence
    "whatif_scenarios",
]


def main():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            for table in REQUIRED_TABLES:
                cur.execute(
                    "SELECT EXISTS ("
                    "  SELECT 1 FROM information_schema.tables "
                    "  WHERE table_name = %s"
                    ")",
                    (table,),
                )
                exists = cur.fetchone()[0]
                if not exists:
                    print(
                        f"ERROR: Required table '{table}' does not exist in PG. "
                        f"Run the migration SQL files first.",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                print(f"  OK: {table}")
    finally:
        conn.close()

    print("All required tables verified.")


if __name__ == "__main__":
    main()
