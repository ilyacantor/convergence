# Convergence (ME) — Multi-Entity / Convergence M&A

**Service identity:** Entity resolution, COFA mapping, combining financials, EBITDA bridge, QoE, cross-sell, overlap, what-if scenario analysis, merge overview, merge conflicts.

**Ports:** Backend 8010 / Frontend 3010

**Database:** Shared Supabase PG (same instance as DCL).
- **Owns** `convergence_triples` (ME triple store — full data isolation from DCL's `semantic_triples`)
- **Owns** `convergence_tenant_runs` (run pointer for ME data)
- **Owns** `convergence_ingest_log` (ingest observability)
- **Owns** `resolution_workspaces_v2`, `whatif_scenarios`, `engagement_state`
- **Reads** `semantic_triples`, `dimension_values_v2`, `tenant_runs` (DCL-owned, SELECT only for SE data)

**Does NOT own:** `semantic_triples`, ontology, semantic graph, query resolution, visualization, Sankey graph. Those live in DCL.

**API prefix:** `/api/convergence/`

**Ingest:** `POST /api/convergence/ingest-triples` — receives ME triples from Farm. Same contract as DCL's ingest endpoint (`?replace=true`, `?append=true`). Writes to `convergence_triples`, not `semantic_triples`.

**Cross-service boundary:**
- DCL's `maestra.py` calls `GET /api/convergence/engagement/active` for engagement context
- Farm's `generate-multi-entity-triples` pushes to `POST /api/convergence/ingest-triples` (via `CONVERGENCE_INGEST_URL`)
- Convergence reads DCL's `semantic_triples` for SE data (SELECT only)

**Canonical plan:** `~/code/dcl/docs/CONVERGENCE_CARVEOUT_BLUEPRINT_CANONICAL.md`
