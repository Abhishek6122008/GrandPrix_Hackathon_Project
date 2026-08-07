"""POST /predict/risk — congestion propagation, standalone.

The narrow sibling of /analyze: same model, but the payload carries only density and trend, so
there is no history, no capacity and no run context to fold in. Spring's `GnnRiskClient` calls
this on the older /simulations flow-mode path.

Always answers. There is no 503 here any more because there is no longer a checkpoint that can
fail to load — the model is a closed-form scorer in `app.scoring`.
"""

from __future__ import annotations

from fastapi import APIRouter

from app import scoring
from app.schemas.risk_schema import RiskRequest, RiskResponse

router = APIRouter(prefix="/predict", tags=["risk"])


@router.post("/risk", response_model=RiskResponse)
def predict_risk(request: RiskRequest) -> RiskResponse:
    risk = scoring.risk_from_graph(
        [(node.id, node.density, node.trend) for node in request.nodes],
        [(edge.source, edge.target) for edge in request.edges],
    )
    return RiskResponse(risk=risk, model=scoring.MODEL_NAME)
