-- 013_drop_console_dead_tables.sql — Drop dead Console artifacts post engagement-move
--
-- After the engagement-move work, Convergence owns the canonical engagements
-- and uploads tables in the public schema. Console's engagement routes now
-- proxy to Convergence over HTTP (console/backend/app/routes/engagements.py)
-- and Console has no upload routes. The legacy tables in the console schema
-- are dead: console.engagements held 1 placeholder row, console.uploads held 0.
-- Verified via grep that no code in convergence/, platform/, or console/ reads
-- or writes these tables.
--
-- Other tables in the console schema (change_events, cron_runs, pipeline_jobs,
-- maestra_runs, conflicts, console_config, pipeline_runs, recon_history) are
-- live and MUST NOT be touched by this migration.

BEGIN;

DROP TABLE IF EXISTS console.engagements;
DROP TABLE IF EXISTS console.uploads;

COMMIT;
