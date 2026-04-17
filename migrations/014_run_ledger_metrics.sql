-- 014_run_ledger_metrics.sql — Additive metrics columns for workflow runs
--
-- Purpose: capture LLM model + token + cost telemetry for the cofa_merge
-- workflow (and any future Convergence-owned workflow). Mai reads these via
-- GET /api/convergence/runs to answer concierge questions like "what model
-- ran COFA?" / "how many tokens did the last run consume?".
--
-- Additive only. All columns nullable. Existing INSERT and UPDATE statements
-- in engagement_store.record_run_step / update_run_step continue to work
-- without modification (they don't list these columns). Backfill of historic
-- rows is intentionally skipped — historic runs predate metrics.

BEGIN;

ALTER TABLE run_ledger
    ADD COLUMN IF NOT EXISTS model_version TEXT,
    ADD COLUMN IF NOT EXISTS tokens_in     INTEGER,
    ADD COLUMN IF NOT EXISTS tokens_out    INTEGER,
    ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(10, 4);

COMMIT;
