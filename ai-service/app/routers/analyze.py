"""POST /analyze — the single endpoint the Spring backend calls.

Pipeline, in order:

1. validate the graph and density payload (Pydantic, then structural checks)
2. build node features and the edge index
3. predict per-node congestion risk
4. turn that risk into a human-readable advisory
5. combine into one {predictions, advisory} response

Steps 3 and 4 each run against Hugging Face when it is configured, and against the offline
model in ``app.scoring`` when it is not. That choice is per-step, not global: a working GNN
endpoint and a missing LLM one gives you hosted risk with local prose, which is strictly
better than dropping either.

Step 4 depends on step 3 — the advisory is written *from* the predicted risk — so they are
sequential. When the hosted GNN fails and the local model is not wanted either, the advisory
is still written, against measured density instead of prediction: telling an operator what is
happening now beats telling them nothing.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import scoring
from app.clients import hf_gnn_client, hf_llm_client
from app.clients.hf_gnn_client import HfResult
from app.config import settings
from app.gnn_local import local_gnn
from app.schemas.analyze_schema import Advisory, AnalyzeRequest, AnalyzeResponse
from app.services import postprocessing, preprocessing

log = logging.getLogger(__name__)

router = APIRouter(tags=["analyze"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Always answers with an `AnalyzeResponse` body.

    - 200 for `ok` and `partial` — Spring uses whatever came back.
    - 502 for `failed` (nothing answered), still with a full body naming both failures, so the
      backend can log the real reason rather than "the AI service broke".
    - 422 only for input the caller can fix.

    With the offline model enabled (the default), `failed` is unreachable — which is the
    point. The status field still exists because a deployment that pins itself to hosted
    inference can absolutely see it.
    """
    try:
        preprocessing.validate(request)
        features = preprocessing.build_features(request)
    except preprocessing.ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # --- Step 3: predicted congestion, a few ticks ahead. -------------------
    # Three sources, best first. Each is a real deployment mode rather than defensive
    # layering: hosted inference is the architecture diagram's path, the in-process GNN is
    # what the project plan calls for (Hugging Face as the model registry, not a per-request
    # dependency), and the linear model is what makes a clean checkout work with no setup.
    gnn_result = HfResult(error="hugging face GNN not configured")

    if settings.hf_gnn_configured:
        gnn_result = await hf_gnn_client.predict_risk(
            features.node_ids, features.features, features.edge_index
        )
        if not gnn_result.ok:
            log.warning("hosted GNN failed, falling back: %s", gnn_result.error)

    if not gnn_result.ok and local_gnn.ready:
        try:
            gnn_result = HfResult(
                value=local_gnn.predict(
                    features.node_ids, features.features, features.edge_index
                ),
                model=f"congestion-gnn ({local_gnn.source})",
            )
        except Exception as exc:  # noqa: BLE001 — a bad tensor must not 500 the endpoint
            log.warning("local GNN inference failed: %s", exc)
            gnn_result = HfResult(error=f"local GNN: {exc}")

    if not gnn_result.ok and settings.LOCAL_FALLBACK:
        gnn_result = HfResult(
            value=scoring.predict_risk(features.node_ids, features.features),
            model=scoring.MODEL_NAME,
        )

    # --- Step 4: prose from that risk. -------------------------------------
    if gnn_result.ok:
        risk_by_node = gnn_result.value
    else:
        # Nothing predicted, so speak about what was measured rather than staying silent.
        risk_by_node = {node_id: request.density.get(node_id, 0.0) for node_id in features.node_ids}

    llm_result = HfResult(error="hugging face LLM not configured")
    if settings.hf_llm_configured:
        llm_result = await hf_llm_client.generate_advisory(
            preprocessing.build_advisory_prompt(request, risk_by_node)
        )
        if not llm_result.ok:
            log.warning("hosted LLM failed, falling back to local: %s", llm_result.error)

    if not llm_result.ok and settings.LOCAL_FALLBACK:
        llm_result = HfResult(
            value=_local_advisory(request, risk_by_node),
            model=scoring.ADVISORY_MODEL_NAME,
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


def _local_advisory(request: AnalyzeRequest, risk_by_node: dict[str, float]) -> Advisory:
    """
    Builds the structured advisory from the offline templates.

    Returns an `Advisory` rather than a string on purpose: the hosted path returns free text
    that postprocessing has to parse a headline and actions back out of, and round-tripping
    already-structured data through that parser would only lose information.
    """
    names = {node.id: (node.name or node.id) for node in request.graph.nodes}
    ranked = sorted(risk_by_node.items(), key=lambda item: item[1], reverse=True)[:3]

    # Only zones actually worth naming — a "worst" zone at 8% is noise, not an advisory.
    concerning = [
        (
            names.get(node_id, node_id),
            request.density.get(node_id, 0.0),
            risk,
            request.context.trends.get(node_id, "FLAT"),
        )
        for node_id, risk in ranked
        if risk >= scoring.WARNING or request.density.get(node_id, 0.0) >= scoring.WARNING
    ]

    headline, message, actions = scoring.generate_summary_advisory(
        request.context.venueName,
        concerning,
        request.context.peopleInside,
        request.context.pendingArrivals,
        request.context.rerouteEnabled,
    )
    return Advisory(headline=headline, message=message, actions=actions)
