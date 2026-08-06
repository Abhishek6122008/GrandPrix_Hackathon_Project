# ============================================================
# services/predictor.py
#
# Orchestrates the full AI prediction pipeline:
#
#   1. Update graph with fresh node features
#   2. Store snapshot in history
#   3. Run GNN → per-node risk scores
#   4. Run LLM → per-node advisory messages
#   5. Assemble and return AlertItem list
#
# This is the only service that talks to both ML models.
# It does NOT know about HTTP — that is the route's concern.
# ============================================================

from __future__ import annotations

import time

from config import settings
from models.gnn_model import GNNModel, GNNPrediction
from models.llm_model import LLMModel
from schemas.simulation import AlertItem, AnalyzeRequest
from services.graph_service import GraphService
from utils.cache import history_cache, prediction_cache
from utils.logger import get_logger

logger = get_logger(__name__)

# Severity thresholds (configurable via .env)
_HIGH = settings.HIGH_RISK_THRESHOLD
_MEDIUM = settings.MEDIUM_RISK_THRESHOLD


def _score_to_severity(risk: float) -> str:
    """Map a numeric risk score to a severity label."""
    if risk >= 0.90:
        return "CRITICAL"
    if risk >= _HIGH:
        return "HIGH"
    if risk >= _MEDIUM:
        return "MEDIUM"
    return "LOW"


def _pick_recommended_route(
    simulation_id: str,
    node_id: int,
    graph_service: GraphService,
) -> str:
    """
    Choose the best alternate route from graph successors.
    Falls back to 'Exit' if no neighbors exist.
    """
    neighbors = graph_service.get_neighbor_names(simulation_id, node_id)
    return neighbors[0] if neighbors else "Exit"


class PredictorService:
    """
    Orchestrates GNN + LLM to produce crowd-safety alerts.

    Dependencies are injected at construction time so this class
    remains independently testable.
    """

    def __init__(self, gnn: GNNModel, llm: LLMModel, gs: GraphService) -> None:
        self._gnn = gnn
        self._llm = llm
        self._graph_service = gs

    async def analyze(self, request: AnalyzeRequest) -> list[AlertItem]:
        """
        Full prediction pipeline for one analyze request.

        Args:
            request: Validated AnalyzeRequest from the route layer.

        Returns:
            List of AlertItem, one per node that has a risk score ≥ LOW.
        """
        simulation_id = request.simulationId
        t_start = time.perf_counter()

        logger.info(
            "PredictorService | analyze | simulationId=%s, timestamp=%d, nodes=%d",
            simulation_id,
            request.timestamp,
            len(request.nodeFeatures),
        )

        # -------------------------------------------------------------------
        # Step 1 — Update graph node features in-place
        # -------------------------------------------------------------------
        self._graph_service.update_features(simulation_id, request.nodeFeatures)

        # -------------------------------------------------------------------
        # Step 2 — Persist snapshot to history (list of dicts for GNN)
        # -------------------------------------------------------------------
        snapshot = [nf.model_dump() for nf in request.nodeFeatures]
        history_cache.append(simulation_id, snapshot)
        history: list[list[dict]] = history_cache.get(simulation_id)

        # -------------------------------------------------------------------
        # Step 3 — Run GNN prediction
        # -------------------------------------------------------------------
        node_features_dicts = snapshot  # already dicts with camelCase keys
        gnn_predictions: list[GNNPrediction] = self._gnn.predict(
            node_features_list=node_features_dicts,
            history=history,
        )

        # -------------------------------------------------------------------
        # Step 4 — Generate LLM advisories and assemble alerts
        # -------------------------------------------------------------------
        alerts: list[AlertItem] = []

        for pred in gnn_predictions:
            severity = _score_to_severity(pred.risk_score)
            node_name = self._graph_service.get_node_name(simulation_id, pred.node_id)
            recommended_route = _pick_recommended_route(
                simulation_id, pred.node_id, self._graph_service
            )

            # Generate advisory message (use fast template if USE_LOCAL_LLM=False, otherwise use LLM)
            if not settings.USE_LOCAL_LLM:
                if severity == "LOW":
                    message = f"Crowd flow is normal at {node_name}. No safety advisories at this time."
                elif severity in ("CRITICAL", "HIGH"):
                    message = f"{node_name} has critical crowd congestion risk, please route to {recommended_route} immediately."
                else:
                    message = f"{node_name} has high crowd risk, consider routing to {recommended_route}."
            else:
                if severity == "LOW":
                    message = (
                        f"Crowd flow is normal at {node_name}. "
                        f"No safety advisories at this time."
                    )
                else:
                    try:
                        message = self._llm.generate_alert(
                            node_name=node_name,
                            severity=severity,
                            risk_score=pred.risk_score,
                            predicted_in_seconds=pred.predicted_in_seconds,
                            recommended_route=recommended_route,
                        )
                    except Exception as exc:  # noqa: BLE001
                        # Degrade gracefully — do not fail the whole request over LLM error
                        logger.warning(
                            "PredictorService | LLM advisory failed for nodeId=%d: %s",
                            pred.node_id,
                            exc,
                        )
                        message = (
                            f"{node_name} shows {severity} risk ({pred.risk_score:.2f}). "
                            f"Consider redirecting crowd to {recommended_route}."
                        )

            alerts.append(
                AlertItem(
                    nodeId=pred.node_id,
                    severity=severity,
                    riskScore=pred.risk_score,
                    confidence=pred.confidence,
                    predictedInSeconds=pred.predicted_in_seconds,
                    recommendedRoute=recommended_route,
                    message=message,
                )
            )

        # Cache the latest prediction result
        prediction_cache.set(simulation_id, alerts)

        elapsed = time.perf_counter() - t_start
        logger.info(
            "PredictorService | analyze done | simulationId=%s | %d alerts in %.3fs",
            simulation_id,
            len(alerts),
            elapsed,
        )
        return alerts

    def cleanup(self, simulation_id: str) -> None:
        """Remove all cached data for a simulation (called at DELETE)."""
        history_cache.delete(simulation_id)
        prediction_cache.delete(simulation_id)
        logger.info("PredictorService | cleared caches for simulationId=%s", simulation_id)
