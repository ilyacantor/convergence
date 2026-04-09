"""
Convergence (ME) API — app factory.

Multi-Entity / Convergence M&A service. Owns: entity resolution, COFA,
combining financials, EBITDA bridge, QoE, cross-sell, overlap, what-if,
merge overview, merge conflicts.

Does NOT own: triple store, ontology, semantic graph, query resolution,
visualization. Those live in DCL.
"""

from dotenv import load_dotenv
load_dotenv()

import os
import signal
import time
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.core.db import PoolExhausted
from backend.utils.log_utils import get_logger

# Route modules
from backend.api.routes.resolution_v2 import router as resolution_v2_router
from backend.api.routes.reports_combining_v2 import router as reports_combining_v2_router
from backend.api.routes.reports_overlap_v2 import router as reports_overlap_v2_router
from backend.api.routes.reports_bridge_v2 import router as reports_bridge_v2_router
from backend.api.routes.reports_whatif_v2 import router as reports_whatif_v2_router
from backend.api.routes.reports_detail_v2 import router as reports_detail_v2_router
from backend.api.routes.cofa_validation import router as cofa_validation_router
from backend.api.routes.cofa_mapping import router as cofa_mapping_router
from backend.api.routes.merge_overview import router as merge_overview_router
from backend.api.routes.merge_conflicts import router as merge_conflicts_router
from backend.api.routes.engagement_api import router as engagement_api_router
from backend.api.routes.ingest_triples import router as ingest_triples_router
from backend.api.routes.verify import router as verify_router
from backend.api.routes.triple_browse import router as triple_browse_router
from backend.api.routes.semantic_catalog import router as semantic_catalog_router
from backend.api.routes.coa_accounts import router as coa_accounts_router
from backend.api.routes.tenants import router as tenants_router

logger = get_logger(__name__)

_cors_raw = os.getenv("CORS_ORIGINS", "").strip()
if not _cors_raw:
    raise RuntimeError(
        "FATAL: CORS_ORIGINS must be set. "
        "Convergence refuses to boot with a wildcard or dev-only CORS "
        "fallback — set CORS_ORIGINS to a comma-separated list of allowed "
        "origins (Console, DCL, Platform, Convergence FE)."
    )
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]


def _log_startup_targets() -> None:
    """Log resolved DB target and HTTP partner URLs at startup.

    Makes "wrong DB" or "wrong port" failures trivial to spot in logs.
    Masks credentials from DATABASE_URL.
    """
    from urllib.parse import urlparse

    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        try:
            parsed = urlparse(db_url)
            user = parsed.username or "unknown"
            host = parsed.hostname or "unknown"
            port = parsed.port or 5432
            db = parsed.path.lstrip("/") if parsed.path else "unknown"
            db_target = f"postgresql://{user}@{host}:{port}/{db}"
        except Exception:
            db_target = "(failed to parse DATABASE_URL)"
    else:
        db_target = "(DATABASE_URL not set)"

    from backend.api.clients.maestra_client import PLATFORM_URL
    logger.info(f"[startup] DB target: {db_target}")
    logger.info(f"[startup] HTTP partners: maestra={PLATFORM_URL}")


async def _probe_downstreams() -> None:
    """Validate downstream URLs at boot. Refuses to boot on misconfig.

    Converts runtime connection errors (wrong host, typo'd DNS) into
    deploy-time boot failures. Convergence's only outbound HTTP dependency
    is Platform/Maestra for engagement lifecycle reads. DCL is reached
    via DATABASE_URL directly (no HTTP). Farm pushes TO Convergence,
    not the other way around.
    """
    import socket
    from urllib.parse import urlparse
    import httpx

    from backend.api.clients.maestra_client import PLATFORM_URL

    downstreams: list[tuple[str, str, str]] = [
        ("PLATFORM_URL", PLATFORM_URL, "/api/health"),
    ]

    errors: list[str] = []
    async with httpx.AsyncClient(timeout=2.0) as client:
        for var_name, url, health_path in downstreams:
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.hostname:
                errors.append(f"{var_name}={url}: malformed URL (missing scheme or host)")
                continue
            try:
                socket.gethostbyname(parsed.hostname)
            except socket.gaierror as e:
                errors.append(
                    f"{var_name}={url}: DNS resolution failed for '{parsed.hostname}': {e}"
                )
                continue
            health_url = f"{parsed.scheme}://{parsed.netloc}{health_path}"
            try:
                resp = await client.get(health_url)
                if resp.status_code >= 500:
                    errors.append(
                        f"{var_name}: {health_url} returned HTTP {resp.status_code}"
                    )
                else:
                    logger.info(
                        "[startup] %s OK: %s -> %s (%d)",
                        var_name, parsed.hostname, health_url, resp.status_code,
                    )
            except httpx.HTTPError as e:
                errors.append(
                    f"{var_name}: health probe at {health_url} failed: {type(e).__name__}: {e}"
                )

    if errors:
        raise RuntimeError(
            f"[startup] {len(errors)} downstream probe(s) failed — refusing to boot:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle for Convergence."""
    logger.info("=== Convergence (ME) Starting ===")
    _log_startup_targets()

    # Boot-time downstream probes — refuse to boot on misconfig.
    await _probe_downstreams()

    # Run migration assertions (verify tables exist, no schema creation)
    try:
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "migrations/run_migration.py"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        logger.info("[Migration] Table assertions passed")
    except Exception as e:
        if os.getenv("CONVERGENCE_ENV", "dev").lower() == "production":
            logger.error(f"[Migration] FAILED in production: {e}")
            raise
        logger.warning(f"[Migration] Assertion failed (non-prod, continuing): {e}")

    logger.info("=== Convergence (ME) Ready ===")
    yield

    logger.info("[Shutdown] Convergence shutting down")


app = FastAPI(
    title="Convergence (ME) API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pool exhaustion middleware ---
@app.middleware("http")
async def pool_guard(request: Request, call_next):
    try:
        return await call_next(request)
    except PoolExhausted:
        return JSONResponse(
            status_code=503,
            content={"error": "Convergence DB pool exhausted. Retry shortly."},
        )


# --- Health check ---
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "convergence",
        "port": int(os.getenv("BACKEND_PORT", "8010")),
    }


# =============================================================================
# Mount route modules
# =============================================================================

app.include_router(resolution_v2_router)
app.include_router(reports_combining_v2_router)
app.include_router(reports_overlap_v2_router)
app.include_router(reports_bridge_v2_router)
app.include_router(reports_whatif_v2_router)
app.include_router(reports_detail_v2_router)
app.include_router(cofa_validation_router)
app.include_router(cofa_mapping_router)
app.include_router(merge_overview_router)
app.include_router(merge_conflicts_router)
app.include_router(engagement_api_router)
app.include_router(ingest_triples_router)
app.include_router(verify_router)
app.include_router(triple_browse_router)
app.include_router(semantic_catalog_router)
app.include_router(coa_accounts_router)
app.include_router(tenants_router)


# =============================================================================
# Graceful shutdown
# =============================================================================

def _handle_sigterm(*args):
    logger.info("[Convergence] Received SIGTERM, shutting down gracefully")
    raise SystemExit(0)

signal.signal(signal.SIGTERM, _handle_sigterm)


# =============================================================================
# SPA serving (must be last — catch-all routes)
# =============================================================================

DIST_DIR = Path(__file__).parent.parent.parent / "dist"

if DIST_DIR.exists() and (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/")
async def serve_root():
    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(
            index_file,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
        )
    return {"status": "Convergence (ME) API is running", "version": "1.0.0", "note": "Frontend not built"}


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    blocked = ("data/", "data\\", ".json", ".yaml", ".yml", ".csv", ".env")
    if any(full_path.lower().startswith(b) or full_path.lower().endswith(b) for b in blocked):
        raise HTTPException(status_code=403, detail="Direct file access is blocked. Use the query API.")
    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(
            index_file,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
        )
    raise HTTPException(status_code=404, detail="Frontend not built")
