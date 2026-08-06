"""POST /predict/risk — congestion propagation from the self-hosted GNN."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.gnn_risk import gnn_risk_model
from app.schemas.risk_schema import RiskRequest, RiskResponse

router = APIRouter(prefix="/predict", tags=["risk"])


@router.post("/risk", response_model=RiskResponse)
def predict_risk(request: RiskRequest) -> RiskResponse:
    """
    503 when the model is not loaded — the Spring backend treats that as a failure and
    falls back to its own mock. Deliberately no fallback here: one fallback path, in one
    place, rather than two that can disagree.
    """
    if not gnn_risk_model.loaded:
        raise HTTPException(status_code=503, detail=f"GNN not loaded: {gnn_risk_model.error}")

    risk = gnn_risk_model.predict(request.nodes, request.edges)
    return RiskResponse(risk=risk, model="gnn")
