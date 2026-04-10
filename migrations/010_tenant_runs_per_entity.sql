-- Migration 010: per-entity convergence_tenant_runs
--
-- Mirrors DCL migration 013. convergence_tenant_runs was keyed by
-- tenant_id alone. One pointer per tenant meant each entity push
-- deactivated the previous entity's triples.
--
-- Fix: key by (tenant_id, entity_id). Each entity gets its own
-- current_run_id pointer.
--
-- Backfills entity_id from the referenced run's actual triples.
-- Idempotent — safe to run multiple times.

-- Step 1: add nullable column
ALTER TABLE convergence_tenant_runs ADD COLUMN IF NOT EXISTS entity_id TEXT;

-- Step 2: backfill from the referenced run's triples
UPDATE convergence_tenant_runs t
SET entity_id = sub.entity_id
FROM (
    SELECT DISTINCT ON (s.run_id) s.run_id, s.entity_id
    FROM convergence_triples s
    WHERE s.entity_id IS NOT NULL
    ORDER BY s.run_id, s.created_at DESC
) sub
WHERE sub.run_id = t.current_run_id
  AND t.entity_id IS NULL;

-- Step 3: enforce NOT NULL (rows without backfill match = no triples = stale, delete them)
DELETE FROM convergence_tenant_runs WHERE entity_id IS NULL;
ALTER TABLE convergence_tenant_runs ALTER COLUMN entity_id SET NOT NULL;

-- Step 4: change PK from (tenant_id) to (tenant_id, entity_id)
ALTER TABLE convergence_tenant_runs DROP CONSTRAINT IF EXISTS convergence_tenant_runs_pkey;
ALTER TABLE convergence_tenant_runs ADD PRIMARY KEY (tenant_id, entity_id);
