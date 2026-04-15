# Phase 0 Decision Log

## v1 Engine Files

| File | Imported By | Decision | Rationale |
|------|-------------|----------|-----------|
| engine/entity_resolution.py | conflict_detection.py, entities.py route, mai.py route, query.py | **Move** | All importers are ME-specific except query.py and mai.py route (decoupled in Phase 3) |
| engine/ebitda_bridge.py | qoe.py (v1), _engine_cache.py, what_if.py (v1) | **Move** | All importers are ME engines that also move |
| engine/qoe.py | _engine_cache.py, reports.py route | **Move** | reports.py deleted in Phase 5; _engine_cache moves |
| engine/cross_sell.py | qoe.py (v1), ebitda_bridge.py (v1), _engine_cache.py | **Move** | All importers are ME engines that also move |
| engine/what_if.py | reports.py route | **Move** | reports.py deleted in Phase 5 |

## Support Files (verified)

| File | Imported By | Decision | Rationale |
|------|-------------|----------|-----------|
| engine/_engine_cache.py | dashboards.py, mai.py (lines 666-682), reports.py | **Move** | Caches cross_sell, ebitda_bridge, qoe — all ME. mai.py decoupled in Phase 3. |
| engine/dashboards.py | mai.py (line 934) | **Move** | Imports get_active_engagement + _engine_cache. mai.py decoupled in Phase 3. |
| engine/revenue_bridge.py | reports_whatif_v2.py, test_3f_whatif.py, test_sweep1_engine_stack.py | **Move** | Used exclusively by what-if (ME) |
| engine/conflict_detection.py | entities.py route | **Move** | Imports entity_resolution v1; pure ME |

## Additional Test Files (discovered in audit)

| File | Decision | Rationale |
|------|----------|-----------|
| tests/test_sweep1_engine_stack.py | **Move** | Imports ALL ME v2 engines |

## Unexpected Dependencies Found

| File | Unexpected Import | Resolution |
|------|-------------------|------------|
| backend/api/query.py:692 | `entity_resolution.get_entity_store` | Phase 3: Remove import, return error if entity resolution is requested without convergence |
| backend/api/routes/mai.py:34 | `entity_resolution.get_entity_store` | Phase 3: Replace with HTTP call to convergence |
| tests/test_s1_dcl.py:25-26 | `ResolutionStore`, `EngagementStore` | Phase 5: Remove these imports and any tests that use them |
