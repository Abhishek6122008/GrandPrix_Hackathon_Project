"""POST /analyze — the single endpoint the Spring backend calls.

Pipeline, in order:

1. validate the graph and density payload (Pydantic, then structural checks)
2. build node features and the edge index for the GNN
3. call the Hugging Face GNN endpoint for predicted risk
4. call the Hugging Face LLM endpoint to turn that risk into a human-readable advisory
5. combine into one {predictions, advisory} response

Steps 3 and 4 are sequential on purpose: the advisory is written *from* the predicted risk,
so the LLM cannot start until the GNN has answered. When the GNN fails, step 4 still runs —
on measured density instead of prediction — because an advisory about what is happening now
is far more useful to an operator than no advisory at all.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.clients import hf_gnn_client, hf_llm_client
from app.schemas.analyze_schema import AnalyzeRequest, AnalyzeResponse
from app.services import postprocessing, preprocessing

log = logging.getLogger(__name__)

router = APIRouter(tags=["analyze"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Always answers with an `AnalyzeResponse` body.

    - 200 for `ok` and `partial` — Spring uses whatever came back.
    - 502 for `failed` (both model calls down), still with a full body naming both failures,
      so the backend can log the real reason rather than "the AI service broke".
    - 422 only for input the caller can fix.
    """
    try:
        preprocessing.validate(request)
        features = preprocessing.build_features(request)
    except preprocessing.ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Step 3 — predicted congestion, a few ticks ahead.
    gnn_result = await hf_gnn_client.predict_risk(
        features.node_ids, features.features, features.edge_index
    )

    # Step 4 — prose from that risk, falling back to measured density if the GNN is down.
    if gnn_result.ok:
        risk_by_node = gnn_result.value
    else:
        risk_by_node = {node_id: request.density.get(node_id, 0.0) for node_id in features.node_ids}
    llm_result = await hf_llm_client.generate_advisory(
        preprocessing.build_advisory_prompt(request, risk_by_node)
    )

    response = postprocessing.build_response(request, gnn_result, llm_result)

    if response.status != "ok":
        log.warning(
            "analyze %s for session %s tick %s: %s",
            response.status, request.sessionId, request.tick,
            [f"{e.stage}: {e.detail}" for e in response.errors],
        )
    if response.status == "failed":
        return JSONResponse(status_code=502, content=response.model_dump())
    return response
