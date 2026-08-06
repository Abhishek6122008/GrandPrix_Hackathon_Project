# ============================================================
# routes/simulation.py
#
# FastAPI router for all /simulation/* endpoints.
#
# Responsibilities:
#   - Parse and validate HTTP requests (via Pydantic schemas)
#   - Delegate ALL business logic to service layer
#   - Return appropriate HTTP responses and status codes
#   - Log incoming requests
#
# No business logic lives here.
# ============================================================

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from schemas.simulation import (
    AnalyzeRequest,
    AnalyzeResponse,
    DeleteResponse,
    InitRequest,
    InitResponse,
)
from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/simulation", tags=["Simulation AI"])


# ---------------------------------------------------------------------------
# POST /simulation/init
# ---------------------------------------------------------------------------


@router.post(
    "/init",
    response_model=InitResponse,
    status_code=status.HTTP_200_OK,
    summary="Initialize simulation graph",
    description=(
        "Called ONCE when a simulation starts. "
        "Stores the static graph (nodes + edges) in memory. "
        "Do NOT call this again for the same simulationId without deleting first."
    ),
)
async def init_simulation(body: InitRequest, request: Request) -> InitResponse:
    """
    Build and store the graph for a new simulation session.

    - Accepts static graph topology from Spring Boot
    - Stores it in memory (never rebuilt per analyze call)
    - Initialises history buffer
    """
    logger.info(
        "POST /simulation/init | simulationId=%s | nodes=%d | edges=%d",
        body.simulationId,
        len(body.nodes),
        len(body.edges),
    )

    # Access services injected into app.state
    graph_service = request.app.state.graph_service

    if graph_service.exists(body.simulationId):
        logger.warning(
            "POST /simulation/init | simulationId=%s already exists — overwriting",
            body.simulationId,
        )

    graph_service.build_and_store(body)

    return InitResponse(
        status="INITIALIZED",
        message=f"Graph stored successfully for simulationId={body.simulationId}.",
    )


# ---------------------------------------------------------------------------
# POST /simulation/analyze
# ---------------------------------------------------------------------------


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    status_code=status.HTTP_200_OK,
    summary="Run AI analysis on current crowd state",
    description=(
        "Main AI endpoint. Called by Spring Boot whenever analysis is required. "
        "Graph must already be initialized via /simulation/init. "
        "Returns per-node risk alerts with LLM-generated advisories."
    ),
)
async def analyze_simulation(body: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    """
    Full prediction pipeline:
      1. Validate simulationId exists
      2. Update node features on existing graph
      3. Persist snapshot to history
      4. Run GNN → risk scores
      5. Run LLM → advisory messages
      6. Return structured alerts
    """
    logger.info(
        "POST /simulation/analyze | simulationId=%s | timestamp=%d | nodes=%d",
        body.simulationId,
        body.timestamp,
        len(body.nodeFeatures),
    )

    graph_service = request.app.state.graph_service
    predictor_service = request.app.state.predictor_service

    # Guard: simulation must be initialized first
    if not graph_service.exists(body.simulationId):
        logger.error(
            "POST /simulation/analyze | simulationId=%s not found", body.simulationId
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation '{body.simulationId}' not initialized. "
                   "Call POST /simulation/init first.",
        )

    try:
        alerts = await predictor_service.analyze(body)
    except Exception as exc:
        logger.exception(
            "POST /simulation/analyze | prediction failed for simulationId=%s",
            body.simulationId,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction pipeline error: {exc}",
        ) from exc

    return AnalyzeResponse(alerts=alerts)


# ---------------------------------------------------------------------------
# DELETE /simulation/{simulationId}
# ---------------------------------------------------------------------------


@router.delete(
    "/{simulationId}",
    response_model=DeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="End a simulation session",
    description=(
        "Called when a simulation ends. "
        "Removes the graph, history, and prediction cache for the given simulationId."
    ),
)
async def delete_simulation(simulationId: str, request: Request) -> DeleteResponse:
    """
    Clean up all in-memory data for a finished simulation.
    """
    logger.info("DELETE /simulation/%s", simulationId)

    graph_service = request.app.state.graph_service
    predictor_service = request.app.state.predictor_service

    if not graph_service.exists(simulationId):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation '{simulationId}' not found.",
        )

    # Remove graph
    graph_service.remove(simulationId)

    # Remove history + prediction cache
    predictor_service.cleanup(simulationId)

    logger.info("DELETE /simulation/%s | cleanup complete", simulationId)
    return DeleteResponse(status="SUCCESS", message="Simulation removed.")
