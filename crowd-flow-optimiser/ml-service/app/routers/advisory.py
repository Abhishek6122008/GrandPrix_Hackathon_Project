"""POST /generate/advisory — plain-language guidance from the self-hosted text-gen model."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.advisory_gen import advisory_model
from app.schemas.advisory_schema import AdvisoryRequest, AdvisoryResponse

router = APIRouter(prefix="/generate", tags=["advisory"])


@router.post("/advisory", response_model=AdvisoryResponse)
def generate_advisory(request: AdvisoryRequest) -> AdvisoryResponse:
    """503 when the model is not loaded — Spring falls back to its template. See risk.py."""
    if not advisory_model.loaded:
        raise HTTPException(status_code=503, detail=f"Advisory model not loaded: {advisory_model.error}")

    message = advisory_model.generate(
        request.node, request.density, request.trend, request.reroutePath
    )
    return AdvisoryResponse(message=message, model="text-generation")
