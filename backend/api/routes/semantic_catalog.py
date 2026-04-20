"""
Semantic catalog endpoints — NLQ-facing catalog/search/query API.

Response schemas match DCL's /api/dcl/semantic-export/* and /api/dcl/query
endpoints exactly so NLQ can route between DCL (SE mode) and Convergence
(ME mode) transparently.

Shares the same concept registry YAML files as DCL (same ontology).
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.db import PoolExhausted, get_connection
from backend.db.triple_store import TripleStore
from backend.engine.engagement import get_active_engagement
from backend.engine.engagement_data import EngagementData
from backend.engine.query_resolver_v2 import TripleQueryResolver
from backend.api.routes.v2_helpers import resolve_engagement_or_tenant, build_identity_context
from backend.utils.log_utils import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Semantic Catalog"])

_triple_store = TripleStore()


# ---------------------------------------------------------------------------
# Models (identical to DCL's semantic_export.py)
# ---------------------------------------------------------------------------

class Pack(str):
    pass


class TimeGrain(str):
    pass


class MetricDefinition(BaseModel):
    id: str
    name: str
    description: str
    aliases: List[str] = Field(default_factory=list)
    pack: str
    unit: Optional[str] = None
    allowed_dims: List[str] = Field(default_factory=list)
    allowed_grains: List[str] = Field(default_factory=list)
    measure_op: Optional[str] = None
    default_grain: Optional[str] = None
    best_direction: str = "high"
    rankable_dimensions: List[str] = Field(default_factory=list)
    version_history: Optional[list] = None


class EntityDefinition(BaseModel):
    id: str
    name: str
    description: str
    aliases: List[str] = Field(default_factory=list)
    pack: Optional[str] = None
    allowed_values: List[str] = Field(default_factory=list)


class BindingSummary(BaseModel):
    source_system: str
    canonical_event: str
    quality_score: float = Field(ge=0.0, le=1.0)
    freshness_score: float = Field(ge=0.0, le=1.0)
    dims_coverage: Dict[str, bool] = Field(default_factory=dict)


class ModeInfo(BaseModel):
    data_mode: str
    run_mode: str
    last_updated: Optional[str] = None


class IngestSummary(BaseModel):
    available: bool = False
    total_rows: int = 0
    total_sources: int = 0
    total_pipes: int = 0
    source_systems: List[str] = Field(default_factory=list)
    tenant_names: List[str] = Field(default_factory=list)


class SemanticExport(BaseModel):
    version: str = "1.0.0"
    tenant_id: str = "default"
    mode: ModeInfo
    metrics: List[MetricDefinition] = Field(default_factory=list)
    entities: List[EntityDefinition] = Field(default_factory=list)
    persona_concepts: Dict[str, List[str]] = Field(default_factory=dict)
    bindings: List[BindingSummary] = Field(default_factory=list)
    metric_entity_matrix: Dict[str, List[str]] = Field(default_factory=dict)
    ingest_summary: Optional[IngestSummary] = None


# ---------------------------------------------------------------------------
# YAML config loading (shared definitions with DCL)
# ---------------------------------------------------------------------------

CONFIG_DIR = Path(__file__).resolve().parents[3] / "config" / "definitions"


def _load_metrics() -> List[MetricDefinition]:
    config_path = CONFIG_DIR / "metrics.yaml"
    if not config_path.exists():
        logger.warning("Metrics config not found: %s", config_path)
        return []
    with open(config_path) as f:
        data = yaml.safe_load(f)
    metrics = []
    for m in data.get("metrics", []):
        metrics.append(MetricDefinition(
            id=m["id"],
            name=m["name"],
            description=m["description"],
            aliases=m.get("aliases", []),
            pack=m["pack"],
            unit=m.get("unit"),
            allowed_dims=m.get("allowed_dims", []),
            allowed_grains=m.get("allowed_grains", []),
            measure_op=m.get("measure_op"),
            default_grain=m.get("default_grain"),
            best_direction=m.get("best_direction", "high"),
            rankable_dimensions=m.get("rankable_dimensions", []),
        ))
    return metrics


def _load_entities() -> List[EntityDefinition]:
    config_path = CONFIG_DIR / "entities.yaml"
    if not config_path.exists():
        logger.warning("Entities config not found: %s", config_path)
        return []
    with open(config_path) as f:
        data = yaml.safe_load(f)
    entities = []
    for e in data.get("entities", []):
        entities.append(EntityDefinition(
            id=e["id"],
            name=e["name"],
            description=e["description"],
            aliases=e.get("aliases", []),
            pack=e.get("pack"),
            allowed_values=e.get("allowed_values", []),
        ))
    return entities


def _load_bindings() -> List[BindingSummary]:
    config_path = CONFIG_DIR / "bindings.yaml"
    if not config_path.exists():
        logger.warning("Bindings config not found: %s", config_path)
        return []
    with open(config_path) as f:
        data = yaml.safe_load(f)
    bindings = []
    for b in data.get("bindings", []):
        bindings.append(BindingSummary(
            source_system=b["source_system"],
            canonical_event=b["canonical_event"],
            quality_score=b["quality_score"],
            freshness_score=b["freshness_score"],
            dims_coverage=b.get("dims_coverage", {}),
        ))
    return bindings


def _load_persona_concepts() -> Dict[str, List[str]]:
    config_path = CONFIG_DIR / "persona_concepts.yaml"
    if not config_path.exists():
        logger.warning("Persona concepts config not found: %s", config_path)
        return {}
    with open(config_path) as f:
        data = yaml.safe_load(f)
    return data.get("persona_concepts", {})


PUBLISHED_METRICS: List[MetricDefinition] = _load_metrics()
PUBLISHED_ENTITIES: List[EntityDefinition] = _load_entities()
BINDINGS: List[BindingSummary] = _load_bindings()
DEFAULT_PERSONA_CONCEPTS: Dict[str, List[str]] = _load_persona_concepts()


# ---------------------------------------------------------------------------
# Scoring / resolution (identical logic to DCL's semantic_export.py)
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "of", "in", "to",
    "for", "with", "on", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "and", "or",
    "but", "not", "no", "nor", "so", "yet", "both", "each", "every",
    "all", "any", "few", "more", "most", "other", "some", "such", "only",
    "own", "same", "than", "too", "very", "just", "about", "per", "which",
    "what", "how", "who", "where", "when", "why", "that", "this", "these",
    "those", "it", "its", "my", "our", "your", "his", "her", "their",
    "me", "us", "him", "them", "i", "we", "you", "he", "she", "they",
})


def _tokenize(text: str) -> List[str]:
    words = re.findall(r'[a-z0-9]+', text.lower())
    return [w for w in words if w not in _STOP_WORDS and len(w) > 1]


def _get_searchable_text(item: Union[MetricDefinition, EntityDefinition]) -> str:
    parts = [item.id, item.name, item.description]
    parts.extend(item.aliases)
    return " ".join(parts)


def _score_match(query: str, item: Union[MetricDefinition, EntityDefinition]) -> float:
    query_lower = query.lower().strip()

    if query_lower == item.id:
        return 100.0
    aliases_lower = [a.lower() for a in item.aliases]
    if query_lower in aliases_lower:
        return 90.0

    name_lower = item.name.lower()
    desc_lower = item.description.lower()

    if query_lower in name_lower:
        return 70.0
    if query_lower in desc_lower:
        return 60.0
    for alias in aliases_lower:
        if query_lower in alias or alias in query_lower:
            return 60.0

    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return 0.0

    item_tokens = set(_tokenize(_get_searchable_text(item)))
    if not item_tokens:
        return 0.0

    overlap = query_tokens & item_tokens
    if not overlap:
        return 0.0

    coverage = len(overlap) / len(query_tokens)
    return coverage * 50.0


def _resolve_metric(query: str) -> Optional[MetricDefinition]:
    best_score = 0.0
    best_match: Optional[MetricDefinition] = None
    for metric in PUBLISHED_METRICS:
        score = _score_match(query, metric)
        if score >= 90.0:
            return metric
        if score > best_score:
            best_score = score
            best_match = metric
    if best_score >= 65.0:
        return best_match
    return None


def _resolve_entity(query: str) -> Optional[EntityDefinition]:
    best_score = 0.0
    best_match: Optional[EntityDefinition] = None
    for entity in PUBLISHED_ENTITIES:
        score = _score_match(query, entity)
        if score >= 90.0:
            return entity
        if score > best_score:
            best_score = score
            best_match = entity
    if best_score >= 65.0:
        return best_match
    return None


def _search_metrics(query: str, limit: int = 5) -> List[MetricDefinition]:
    scored = []
    for metric in PUBLISHED_METRICS:
        score = _score_match(query, metric)
        if score > 0.0:
            scored.append((score, metric))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def _search_entities(query: str, limit: int = 5) -> List[EntityDefinition]:
    scored = []
    for entity in PUBLISHED_ENTITIES:
        score = _score_match(query, entity)
        if score > 0.0:
            scored.append((score, entity))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


# ---------------------------------------------------------------------------
# Ingest summary from convergence_ingest_log
# ---------------------------------------------------------------------------

def _build_ingest_summary() -> Optional[IngestSummary]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(triples_written), 0), "
                    "COUNT(DISTINCT unnest_source), "
                    "COUNT(DISTINCT run_id), "
                    "ARRAY_AGG(DISTINCT unnest_source) "
                    "FROM convergence_ingest_log, "
                    "LATERAL unnest(source_systems) AS unnest_source"
                )
                row = cur.fetchone()
                if row and row[0] > 0:
                    return IngestSummary(
                        available=True,
                        total_rows=row[0],
                        total_sources=row[1],
                        total_pipes=row[2],
                        source_systems=row[3] if row[3] else [],
                    )
        return None
    except Exception as exc:
        logger.error("Failed to build ingest summary: %s", exc)
        raise


# ---------------------------------------------------------------------------
# GET /api/convergence/semantic-export
# ---------------------------------------------------------------------------

@router.get("/api/convergence/semantic-export")
async def get_semantic_export(tenant_id: str = "default"):
    """Full semantic catalog for NLQ consumption.

    Response schema matches DCL's GET /api/dcl/semantic-export exactly.
    """
    mode_info = ModeInfo(
        data_mode="Ingest",
        run_mode="Dev",
        last_updated=datetime.utcnow().isoformat(),
    )

    ingest_summary = _build_ingest_summary()

    return SemanticExport(
        version="1.0.0",
        tenant_id=tenant_id,
        mode=mode_info,
        metrics=PUBLISHED_METRICS,
        entities=PUBLISHED_ENTITIES,
        persona_concepts=DEFAULT_PERSONA_CONCEPTS,
        bindings=BINDINGS,
        metric_entity_matrix={m.id: m.allowed_dims for m in PUBLISHED_METRICS},
        ingest_summary=ingest_summary,
    )


# ---------------------------------------------------------------------------
# GET /api/convergence/semantic-export/resolve/metric
# ---------------------------------------------------------------------------

@router.get("/api/convergence/semantic-export/resolve/metric")
async def resolve_metric_alias(q: str = Query(..., description="Query string to resolve")):
    """Resolve a metric alias to its canonical definition.

    Response schema matches DCL's GET /api/dcl/semantic-export/resolve/metric.
    """
    result = _resolve_metric(q)
    if result:
        return result

    suggestions = [
        {"id": m.id, "name": m.name}
        for m in _search_metrics(q, limit=3)
    ]
    raise HTTPException(
        status_code=404,
        detail={
            "error": "METRIC_NOT_FOUND",
            "query": q,
            "suggestions": suggestions,
            "suggestion": "Use GET /api/convergence/semantic-export/search?q=... to search the catalog",
        },
    )


# ---------------------------------------------------------------------------
# GET /api/convergence/semantic-export/resolve/entity
# ---------------------------------------------------------------------------

@router.get("/api/convergence/semantic-export/resolve/entity")
async def resolve_entity_alias(q: str = Query(..., description="Query string to resolve")):
    """Resolve an entity/dimension alias to its canonical definition.

    Response schema matches DCL's GET /api/dcl/semantic-export/resolve/entity.
    """
    result = _resolve_entity(q)
    if result:
        return result

    suggestions = [
        {"id": e.id, "name": e.name}
        for e in _search_entities(q, limit=3)
    ]
    raise HTTPException(
        status_code=404,
        detail={
            "error": "ENTITY_NOT_FOUND",
            "query": q,
            "suggestions": suggestions,
            "suggestion": "Use GET /api/convergence/semantic-export/search?q=... to search the catalog",
        },
    )


# ---------------------------------------------------------------------------
# GET /api/convergence/semantic-export/search
# ---------------------------------------------------------------------------

@router.get("/api/convergence/semantic-export/search")
async def search_semantic_catalog(
    q: str = Query(..., description="Search query"),
    limit: int = Query(5, ge=1, le=50, description="Max results per type"),
):
    """Search both metrics and entities using fuzzy matching.

    Response schema matches DCL's GET /api/dcl/semantic-export/search.
    """
    metrics = _search_metrics(q, limit=limit)
    entities = _search_entities(q, limit=limit)
    return {
        "query": q,
        "metrics": metrics,
        "entities": entities,
        "total": len(metrics) + len(entities),
    }


# ---------------------------------------------------------------------------
# POST /api/convergence/query
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    metric: str
    dimensions: List[str] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)
    time_range: Optional[Dict[str, str]] = None
    grain: Optional[str] = None
    order_by: Optional[str] = None
    limit: Optional[int] = None
    persona: Optional[str] = None
    entity: Optional[str] = None
    tenant_id: Optional[str] = None
    entity_id: Optional[str] = None
    consolidate: bool = False


@router.post("/api/convergence/query")
async def execute_query(
    request: QueryRequest,
    engagement_id: str = Query(None),
    tenant_id: str = Query(None),
    pipeline_run_id: str = Query(None),
):
    """Execute a data query against convergence_triples.

    Response schema matches DCL's POST /api/dcl/query.
    """
    tid = request.tenant_id or tenant_id
    rid = pipeline_run_id
    if not tid or not rid:
        eng_data, tid_resolved, rid_resolved = resolve_engagement_or_tenant(engagement_id, tid, rid)
        tid, rid = tid_resolved, rid_resolved

    metric_def = _resolve_metric(request.metric)
    if not metric_def:
        raise HTTPException(
            status_code=404,
            detail={
                "error": f"Metric '{request.metric}' not found",
                "code": "METRIC_NOT_FOUND",
                "details": {
                    "closest_match": _search_metrics(request.metric, limit=1)[0].id
                    if _search_metrics(request.metric, limit=1)
                    else None,
                },
            },
        )

    entity_id = request.entity_id or request.entity
    if not entity_id:
        raise HTTPException(
            status_code=422,
            detail="entity_id is required — pass entity_id or entity in the request body",
        )
    grain = request.grain or (metric_def.default_grain if metric_def else "quarter")

    try:
        resolver = TripleQueryResolver(tid, rid)

        # Map metric id to concept name (concept = domain.metric_id pattern)
        concept = request.metric
        if "." not in concept:
            # Try to find the full concept by browsing for it
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT DISTINCT concept FROM convergence_triples "
                        "WHERE tenant_id = %s AND run_id = %s "
                        "AND (concept = %s OR concept LIKE %s) "
                        "AND property = 'amount' LIMIT 1",
                        [tid, rid, concept, f"%.{concept}"],
                    )
                    row = cur.fetchone()
                    if row:
                        concept = row[0]

        # Get timeseries data for all available periods
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT period FROM convergence_triples "
                    "WHERE tenant_id = %s AND run_id = %s AND period IS NOT NULL "
                    "ORDER BY period",
                    [tid, rid],
                )
                all_periods = [r[0] for r in cur.fetchall()]

        data_points = []
        sources: set[str] = set()
        for period in all_periods:
            try:
                result = resolver.get_metric(concept, entity_id, period)
                if result:
                    data_points.append({
                        "period": period,
                        "value": float(result.get("value", 0)),
                        "dimensions": {},
                        "entity_id": result.get("entity_id"),
                        "confidence_score": result.get("confidence_score"),
                        "confidence_tier": result.get("confidence_tier"),
                    })
                    if result.get("source_system"):
                        sources.add(result["source_system"])
            except (ValueError, RuntimeError):
                continue

        if request.order_by == "desc":
            data_points.sort(key=lambda d: d["value"], reverse=True)
        elif request.order_by == "asc":
            data_points.sort(key=lambda d: d["value"])

        if request.limit and request.limit < len(data_points):
            data_points = data_points[: request.limit]

        status = "ok" if data_points else "no_data"

        return {
            "status": status,
            "metric": request.metric,
            "metric_name": metric_def.name,
            "dimensions": request.dimensions,
            "grain": grain,
            "unit": metric_def.unit or "number",
            "data": data_points,
            "metadata": {
                "sources": sorted(sources),
                "freshness": datetime.utcnow().isoformat(),
                "quality_score": 1.0,
                "mode": "Ingest",
                "record_count": len(data_points),
                "source": "convergence",
                "entity_id": entity_id,
                "tenant_id": tid,
            },
        }

    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")
    except ValueError as exc:
        return {
            "status": "no_data",
            "metric": request.metric,
            "metric_name": metric_def.name if metric_def else request.metric,
            "dimensions": request.dimensions,
            "grain": grain,
            "unit": metric_def.unit if metric_def else "number",
            "data": [],
            "metadata": {
                "sources": [],
                "freshness": datetime.utcnow().isoformat(),
                "quality_score": 0.0,
                "mode": "Ingest",
                "record_count": 0,
                "source": "convergence",
                "entity_id": entity_id,
                "tenant_id": tid,
                "error": str(exc),
            },
        }


# ---------------------------------------------------------------------------
# GET /api/convergence/ingest/runs
# ---------------------------------------------------------------------------

@router.get("/api/convergence/ingest/runs")
async def list_ingest_runs():
    """List all ingestion run receipts from convergence_ingest_log.

    Response shape mirrors DCL's ingest runs endpoint for viewer compatibility.
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, run_id, entity_id, tenant_id, triples_received, "
                    "triples_written, triples_rejected, source_systems, "
                    "duration_ms, created_at "
                    "FROM convergence_ingest_log ORDER BY created_at DESC"
                )
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

                # Build stats
                cur.execute(
                    "SELECT COALESCE(SUM(triples_written), 0), "
                    "COUNT(DISTINCT run_id) "
                    "FROM convergence_ingest_log"
                )
                stats_row = cur.fetchone()

                # Distinct source systems across all runs
                cur.execute(
                    "SELECT ARRAY_AGG(DISTINCT unnest_source) "
                    "FROM convergence_ingest_log, "
                    "LATERAL unnest(source_systems) AS unnest_source"
                )
                src_row = cur.fetchone()
                source_names = src_row[0] if src_row and src_row[0] else []

    except PoolExhausted as exc:
        raise HTTPException(status_code=503, detail=f"Database pool exhausted — {exc}")

    runs = []
    for r in rows:
        runs.append({
            "convergence_ingest_id": str(r["run_id"]),
            "dispatch_id": "",
            "pipe_id": str(r["run_id"]),
            "source_system": r["source_systems"][0] if r.get("source_systems") else "unknown",
            "canonical_source_id": r["source_systems"][0] if r.get("source_systems") else "unknown",
            "tenant_id": str(r["tenant_id"]),
            "snapshot_name": f"convergence_{r.get('entity_id', 'unknown')}",
            "run_timestamp": r["created_at"].isoformat() if r.get("created_at") else None,
            "received_at": r["created_at"].isoformat() if r.get("created_at") else None,
            "schema_version": "1.0",
            "row_count": r["triples_written"],
            "schema_drift": False,
            "drift_fields": [],
        })

    return {
        "runs": runs,
        "stats": {
            "total_rows_buffered": stats_row[0] if stats_row else 0,
            "unique_sources": len(source_names),
            "pipes_tracked": stats_row[1] if stats_row else 0,
            "source_system_names": source_names,
            "tenant_names": [],
        },
    }
