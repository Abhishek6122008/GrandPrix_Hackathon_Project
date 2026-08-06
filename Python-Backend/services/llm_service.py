# ============================================================
# services/llm_service.py
#
# Thin facade around LLMModel.
# Provides a clean service interface so routes / predictor
# never import model classes directly.
# ============================================================

from __future__ import annotations

from models.llm_model import LLMModel
from utils.logger import get_logger

logger = get_logger(__name__)


class LLMService:
    """
    Facade around the raw LLMModel.

    Keeps routing and orchestration code decoupled from the
    specific model implementation.
    """

    def __init__(self, llm_model: LLMModel) -> None:
        self._model = llm_model

    def generate_alert(
        self,
        node_name: str,
        severity: str,
        risk_score: float,
        predicted_in_seconds: int,
        recommended_route: str,
    ) -> str:
        """Delegate to the underlying LLM model."""
        return self._model.generate_alert(
            node_name=node_name,
            severity=severity,
            risk_score=risk_score,
            predicted_in_seconds=predicted_in_seconds,
            recommended_route=recommended_route,
        )
