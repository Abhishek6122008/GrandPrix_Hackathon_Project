"""POST /generate/advisory — plain-language guidance for a single zone.

Per-zone sibling of the venue-wide advisory /analyze returns. Spring's `AdvisoryService` calls
this from the older /simulations flow-mode path, one call per alert.

Always answers, for the same reason as /predict/risk: the generator is a template in
`app.scoring`, so there is no model load that can fail.
"""

from __future__ import annotations

from fastapi import APIRouter

from app import scoring
from app.schemas.advisory_schema import AdvisoryRequest, AdvisoryResponse

router = APIRouter(prefix="/generate", tags=["advisory"])


@router.post("/advisory", response_model=AdvisoryResponse)
def generate_advisory(request: AdvisoryRequest) -> AdvisoryResponse:
    message = scoring.generate_advisory(
        request.node, request.density, request.trend, request.reroutePath
    )
    return AdvisoryResponse(message=message, model=scoring.ADVISORY_MODEL_NAME)
