-- 015_run_ledger_workflow_columns.sql — Add validation_result, human_decision,
-- summary columns to run_ledger for full workflow pattern support.
--
-- validation_result: outcome of COFACompletionGate or equivalent validation step.
-- human_decision: HITL resolution stored as structured JSON (nullable).
-- summary: structured snapshot of the workflow output (account counts, conflicts, mappings).

BEGIN;

ALTER TABLE run_ledger
    ADD COLUMN IF NOT EXISTS validation_result TEXT,
    ADD COLUMN IF NOT EXISTS human_decision    JSONB,
    ADD COLUMN IF NOT EXISTS summary           JSONB;

COMMIT;
