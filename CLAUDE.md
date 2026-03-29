# Convergence (ME) — Multi-Entity / Convergence M&A

**Service identity:** Entity resolution, COFA mapping, combining financials, EBITDA bridge, QoE, cross-sell, overlap, what-if scenario analysis, merge overview, merge conflicts.

**Ports:** Backend 8010 / Frontend 3010

**Database:** Shared Supabase PG (same instance as DCL).
- **Reads** `semantic_triples`, `dimension_values_v2`, `tenant_runs` directly (SELECT only)
- **Writes** triples via DCL's `POST /api/dcl/ingest-triples` (never writes directly to DCL-owned tables)
- **Owns** `resolution_workspaces_v2`, `whatif_scenarios`, `engagement_state`

**Does NOT own:** Triple store, ontology, semantic graph, query resolution, visualization, Sankey graph. Those live in DCL.

**API prefix:** `/api/convergence/`

**Cross-service boundary:**
- DCL's `maestra.py` calls `GET /api/convergence/engagement/active` for engagement context
- Convergence calls `POST /api/dcl/ingest-triples` for COFA triple writes

**Canonical plan:** `~/code/dcl/docs/CONVERGENCE_CARVEOUT_BLUEPRINT_CANONICAL.md`
