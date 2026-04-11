-- 012_uploads.sql — File upload records for GL/CoA intake
-- Moved from Console (console.uploads) to Convergence as canonical owner.

BEGIN;

CREATE TABLE IF NOT EXISTS uploads (
    upload_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    engagement_id UUID,
    entity_id     VARCHAR(100)  NOT NULL,
    file_name     VARCHAR(500)  NOT NULL,
    file_type     VARCHAR(10)   NOT NULL,
    file_size     INTEGER,
    file_content  BYTEA,
    parse_result  JSONB,
    status        VARCHAR(20)   NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploads_engagement ON uploads (engagement_id);
CREATE INDEX IF NOT EXISTS idx_uploads_tenant ON uploads (tenant_id);

COMMIT;
