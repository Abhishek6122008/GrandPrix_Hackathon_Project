# ============================================================
# app.py
#
# FastAPI application entry point.
#
# Startup sequence:
#   1.  Validate GNN model (HuggingFace Inference API warm-up)
#   2.  Validate LLM model (HuggingFace Inference API warm-up)
#   3.  Instantiate services and attach to app.state
#   4.  Register routers
#   5.  Ready to serve requests
#
# Run with:
#   uvicorn app:app --host 0.0.0.0 --port 8000
# ============================================================

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from models.gnn_model import GNNModel
from models.llm_model import LLMModel
from routes.simulation import router as simulation_router
from services.graph_service import GraphService
from services.predictor import PredictorService
from utils.logger import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: model loading (runs once on startup, cleanup on shutdown)
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    FastAPI lifespan context manager.

    Models are loaded here — ONCE — so every request can reuse them
    without paying the initialisation cost.
    """
    logger.info("=" * 60)
    logger.info("  Crowd AI Backend — starting up (HuggingFace Inference API mode)")
    logger.info("=" * 60)

    t_boot = time.perf_counter()

    # --- Validate GNN model (API warm-up ping, ~1–60s on cold start) ---
    gnn_model = GNNModel()
    gnn_model.load()

    # --- Validate LLM model (API warm-up ping, ~1–60s on cold start) ---
    llm_model = LLMModel()
    llm_model.load()

    # --- Instantiate services ---
    graph_service = GraphService()
    predictor_service = PredictorService(
        gnn=gnn_model,
        llm=llm_model,
        gs=graph_service,
    )

    # Attach to app.state so routes can access them via request.app.state
    app.state.gnn_model = gnn_model
    app.state.llm_model = llm_model
    app.state.graph_service = graph_service
    app.state.predictor_service = predictor_service

    elapsed = time.perf_counter() - t_boot
    logger.info("  All models loaded and services ready in %.2fs", elapsed)
    logger.info("  Swagger UI  → http://127.0.0.1:%d/docs", settings.PORT)
    logger.info("  ReDoc       → http://127.0.0.1:%d/redoc", settings.PORT)
    logger.info("=" * 60)

    yield  # Application runs here

    # Shutdown cleanup (nothing persistent to close for in-memory stores)
    logger.info("Crowd AI Backend — shutting down")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title="Crowd Simulation AI Backend",
        description=(
            "Python FastAPI service that provides AI-driven crowd risk analysis "
            "for the Crowd Simulation and Management System. "
            "Communicates exclusively with the Spring Boot backend."
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # -----------------------------------------------------------------------
    # CORS — restrict to Spring Boot origin in production
    # -----------------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],   # tighten this in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -----------------------------------------------------------------------
    # Global exception handler — catch-all for unhandled errors
    # -----------------------------------------------------------------------
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception on %s %s", request.method, request.url)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error. Check server logs for details."},
        )

    # -----------------------------------------------------------------------
    # Routers
    # -----------------------------------------------------------------------
    app.include_router(simulation_router)

    # -----------------------------------------------------------------------
    # Health check endpoint
    # -----------------------------------------------------------------------
    @app.get("/health", tags=["Health"], summary="Service health check")
    async def health() -> dict:
        return {"status": "ok", "service": "crowd-ai-backend"}

    return app


# Module-level app instance (Uvicorn needs this)
app = create_app()
