-- Convergence-owned triple store — full data isolation from DCL's semantic_triples.
-- ME (multi-entity) data lives here. SE (single-entity) data lives in semantic_triples (DCL-owned).

CREATE TABLE IF NOT EXISTS convergence_triples (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    entity_id             TEXT        NOT NULL,
    concept               TEXT        NOT NULL,
    property              TEXT        NOT NULL,
    value                 JSONB       NOT NULL,
    period                TEXT,
    currency              TEXT        DEFAULT 'USD',
    unit                  TEXT,
    source_system         TEXT        NOT NULL,
    source_table          TEXT,
    source_field          TEXT,
    pipe_id               UUID,
    run_id                UUID        NOT NULL,
    confidence_score      NUMERIC     NOT NULL,
    confidence_tier       TEXT        NOT NULL,
    canonical_id          UUID,
    resolution_method     TEXT,
    resolution_confidence NUMERIC,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now(),
    is_active             BOOLEAN     DEFAULT true,
    source_run_tag        TEXT,
    PRIMARY KEY (id)
);

-- Indexes mirror semantic_triples for equivalent query performance
CREATE INDEX IF NOT EXISTS idx_conv_triples_entity_concept
    ON convergence_triples (tenant_id, entity_id, concept);

CREATE INDEX IF NOT EXISTS idx_conv_triples_concept_period
    ON convergence_triples (tenant_id, concept, period);

CREATE INDEX IF NOT EXISTS idx_conv_triples_run
    ON convergence_triples (run_id);

CREATE INDEX IF NOT EXISTS idx_conv_triples_canonical
    ON convergence_triples (canonical_id) WHERE canonical_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_triples_entity_period
    ON convergence_triples (tenant_id, entity_id, period);

CREATE INDEX IF NOT EXISTS idx_conv_triples_active
    ON convergence_triples (tenant_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_conv_triples_source_run_tag
    ON convergence_triples (source_run_tag) WHERE source_run_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_triples_concept_domain
    ON convergence_triples (split_part(concept, '.', 1), entity_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_conv_triples_canonical_entity
    ON convergence_triples (canonical_id, entity_id)
    WHERE canonical_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_conv_triples_tenant_run
    ON convergence_triples (tenant_id, run_id);


-- Convergence-owned tenant_runs — tracks current run pointer per tenant for ME data.
CREATE TABLE IF NOT EXISTS convergence_tenant_runs (
    tenant_id       UUID        NOT NULL PRIMARY KEY,
    current_run_id  UUID        NOT NULL,
    previous_run_id UUID,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Convergence-owned ingest log — observability for ME ingest operations.
CREATE TABLE IF NOT EXISTS convergence_ingest_log (
    id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id            UUID        NOT NULL,
    entity_id         TEXT,
    tenant_id         UUID        NOT NULL,
    triples_received  INTEGER     NOT NULL,
    triples_written   INTEGER     NOT NULL,
    triples_rejected  INTEGER     NOT NULL DEFAULT 0,
    rejection_reasons JSONB       DEFAULT '[]'::jsonb,
    source_systems    TEXT[]      DEFAULT '{}'::text[],
    duration_ms       INTEGER     NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now()
);
