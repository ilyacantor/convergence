# Deferred work — convergence

1. 2026-04-10 | https://claude.ai/chat/ef997e58-7ae6-4321-8fb7-d81f308bab55 | connection pool | stale connections in pool. Real bug, not env-class. Severity: degraded. Blocking: intermittent 503s under load.

2. 2026-04-12 | https://claude.ai/chat/43b358dc-2cb5-4432-9b0a-055e8c1b252b | scripts/precommit.sh | hook bypassed via --no-verify when committing RACI v8.4 CSV containing legitimate references to the sanctioned DCL ingest-triples endpoint. Hook needs ONGOING_PROMPTS/* exclusion so --no-verify is not the path of least resistance. C13 violation pattern. Severity: degraded. Blocking: hook discipline erodes when bypass becomes normal.

3. 2026-04-09 | https://claude.ai/chat/e68ee425-14aa-40ae-8963-bd873d66f0f4 | src/convergence/.../cross_sell_v2.py:178,211,225,348,394,404 | A1 silent default values masked customer profile data missing failure across 5 default branches (31/100 baseline scoring). Severity: degraded. Blocking: silent fallback class bug hides future input-data failures.

4. 2026-04-08 | https://claude.ai/chat/1ff5065b-4b83-41b7-a2b6-d29c64300b87 | Supabase project yuxrdoamtjmodjzqpeds | accumulated 2M rows of AAM stub writes via Console e2e runs (collectors.py, controls.py, drift.py, fabric_planes.py). Truncate + ensure AAM demo UI exercises write path against ephemeral truncated DB only. Severity: degraded. Blocking: Maestra accidentally reading from this DB instead of canonical gdbmdrouocxjxiohpixr was root cause of cofa-chat 500.

5. 2026-04-07 | https://claude.ai/chat/f33e2a8e-1d4c-49d1-b375-336053e80c1c | snapshot.meta.collisions | HITL collision review UI not built. Authority-ranked collision data flows through but no operator review surface. Severity: degraded. Blocking: collision authority layer is data-only without HITL gate.
