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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.core.db import PoolExhausted
from backend.utils.log_utils import get_logger

# Route modules
from backend.api.routes.resolution_v2 import router as resolution_v2_router
from backend.api.routes.reports_combining_v2 import router as reports_combining_v2_router
from backend.api.routes.reports_overlap_v2 import router as reports_overlap_v2_router
from backend.api.routes.reports_bridge_v2 import router as reports_bridge_v2_router
from backend.api.routes.reports_whatif_v2 import router as reports_whatif_v2_router
from backend.api.routes.cofa_validation import router as cofa_validation_router
from backend.api.routes.cofa_mapping import router as cofa_mapping_router
from backend.api.routes.merge_overview import router as merge_overview_router
from backend.api.routes.merge_conflicts import router as merge_conflicts_router
from backend.api.routes.engagement_api import router as engagement_api_router

logger = get_logger(__name__)

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3010,http://localhost:3009,http://localhost:3004",
    ).split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle for Convergence."""
    logger.info("=== Convergence (ME) Starting ===")

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
app.include_router(cofa_validation_router)
app.include_router(cofa_mapping_router)
app.include_router(merge_overview_router)
app.include_router(merge_conflicts_router)
app.include_router(engagement_api_router)


# =============================================================================
# Graceful shutdown
# =============================================================================

def _handle_sigterm(*args):
    logger.info("[Convergence] Received SIGTERM, shutting down gracefully")
    raise SystemExit(0)

signal.signal(signal.SIGTERM, _handle_sigterm)
