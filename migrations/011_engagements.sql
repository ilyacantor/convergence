-- 011_engagements.sql — Canonical engagement state, run ledger, human reviews
-- Migrated from Platform (engagement_state, run_ledger, human_reviews)
-- and Console (console.engagements). Single source of truth post-move.

BEGIN;

-- ============================================================================
-- engagements — single canonical engagement table
-- ============================================================================

CREATE TABLE IF NOT EXISTS engagements (
    engagement_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    engagement_type   VARCHAR(10)   NOT NULL DEFAULT 'MA',
    acquirer_entity_id VARCHAR(100) NOT NULL,
    target_entity_id  VARCHAR(100)  NOT NULL,
    engagement_short_name VARCHAR(50),
    lifecycle_stage   VARCHAR(20)   NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_stage IN (
            'draft', 'active', 'paused', 'review',
            'complete', 'closed', 'archived'
        )),
    -- Single JSONB blob for all state.
    -- Platform keys: entity_a_name, entity_b_name, created_by
    -- Console keys: conflicts_resolved, conflicts_total, deliverables_ready,
    --               total_cost, total_runs, total_tokens
    state             JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagements_tenant
    ON engagements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_engagements_tenant_stage
    ON engagements (tenant_id, lifecycle_stage);

-- ============================================================================
-- run_ledger — pipeline step tracking (verbatim from Platform)
-- ============================================================================

CREATE TABLE IF NOT EXISTS run_ledger (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    engagement_id     TEXT          NOT NULL,
    step_name         TEXT          NOT NULL,
    status            TEXT          NOT NULL DEFAULT 'pending',
    idempotency_key   TEXT          NOT NULL,
    inputs_hash       TEXT,
    upstream_deps     TEXT[],
    outputs_ref       TEXT,
    error             TEXT,
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_ledger_engagement
    ON run_ledger (engagement_id);
CREATE INDEX IF NOT EXISTS idx_run_ledger_idempotency
    ON run_ledger (idempotency_key, engagement_id);

-- ============================================================================
-- human_reviews — 4-tier HITL workflow (verbatim from Platform)
-- ============================================================================

CREATE TABLE IF NOT EXISTS human_reviews (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    engagement_id     TEXT          NOT NULL,
    action            TEXT          NOT NULL,
    context           JSONB         DEFAULT '{}'::jsonb,
    tier              INTEGER       NOT NULL DEFAULT 3,
    status            TEXT          NOT NULL DEFAULT 'pending',
    requested_by      TEXT          DEFAULT 'maestra',
    approved_by       TEXT,
    rejected_by       TEXT,
    rejection_reason  TEXT,
    resolved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_human_reviews_tenant
    ON human_reviews (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_human_reviews_engagement
    ON human_reviews (engagement_id);

COMMIT;
