-- 016_engagement_resolver.sql — Identity resolver tables + engagement v2 columns
-- Supports convergence_transition_master §2 (engagement model) and §3 (resolver contract)

BEGIN;

-- ============================================================================
-- engagements — add v2 columns for AOS tenant pair identity
-- ============================================================================

ALTER TABLE engagements
    ADD COLUMN IF NOT EXISTS acquirer_tenant_id UUID,
    ADD COLUMN IF NOT EXISTS target_tenant_id UUID,
    ADD COLUMN IF NOT EXISTS created_by TEXT,
    ADD COLUMN IF NOT EXISTS resolver_version TEXT,
    ADD COLUMN IF NOT EXISTS config_snapshot JSONB;

-- ============================================================================
-- resolver_decisions — per-record resolution outcomes across domains
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolver_decisions (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id       UUID          NOT NULL REFERENCES engagements(engagement_id),
    domain              TEXT          NOT NULL,
    acquirer_record_id  TEXT          NOT NULL,
    target_record_id    TEXT,
    confidence          NUMERIC       NOT NULL,
    evidence_json       JSONB         NOT NULL,
    tier_matched        TEXT          NOT NULL,
    hitl_state          TEXT          NOT NULL DEFAULT 'auto_accepted'
        CHECK (hitl_state IN (
            'auto_accepted', 'pending_hitl', 'confirmed',
            'rejected', 'deferred', 'stale', 'no_match'
        )),
    hitl_operator       TEXT,
    hitl_timestamp      TIMESTAMPTZ,
    content_hash_acq    TEXT          NOT NULL,
    content_hash_tgt    TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolver_decisions_engagement
    ON resolver_decisions (engagement_id);
CREATE INDEX IF NOT EXISTS idx_resolver_decisions_engagement_domain
    ON resolver_decisions (engagement_id, domain);
CREATE INDEX IF NOT EXISTS idx_resolver_decisions_hitl
    ON resolver_decisions (engagement_id, domain, hitl_state);

-- ============================================================================
-- engagement_adjustments — accounting adjustments applied during engagement
-- ============================================================================

CREATE TABLE IF NOT EXISTS engagement_adjustments (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id       UUID          NOT NULL REFERENCES engagements(engagement_id),
    adjustment_type     TEXT          NOT NULL,
    payload_json        JSONB         NOT NULL,
    applied_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    applied_by          TEXT          NOT NULL,
    source              TEXT          NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_adjustments_engagement
    ON engagement_adjustments (engagement_id);

-- ============================================================================
-- engagement_runs — history of engagement run invocations
-- ============================================================================

CREATE TABLE IF NOT EXISTS engagement_runs (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id       UUID          NOT NULL REFERENCES engagements(engagement_id),
    engagement_run_id   UUID          NOT NULL,
    started_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    resolver_stats      JSONB,
    triggered_by        TEXT          NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_runs_engagement
    ON engagement_runs (engagement_id);

COMMIT;
