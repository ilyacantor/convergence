-- Migration 008: whatif_scenarios — TEXT to UUID type consistency
-- Every other table uses native PG UUID. This aligns whatif_scenarios.
-- Safe to run on empty table. For tables with data, existing TEXT values
-- must be valid UUIDs or the ALTER will fail (by design — invalid data = bug).

ALTER TABLE whatif_scenarios
    ALTER COLUMN id TYPE UUID USING id::uuid,
    ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid,
    ALTER COLUMN run_id TYPE UUID USING run_id::uuid;
