"""Combines the GNN and LLM results into the single response Spring consumes.

The one rule this module exists to enforce: **never invent an answer.** If a Hugging Face call
failed, the corresponding key comes back empty and the failure is named in `errors`. Spring
has its own deterministic fallback; a second, quietly different one here would mean two
layers disagreeing about what the crowd is doing, and no way to tell which you were looking at.
"""

from __future__ import annotations

import re

from app.clients.hf_gnn_client import HfResult
from app.schemas.analyze_schema import (
    Advisory,
    AnalyzeError,
    AnalyzeRequest,
    AnalyzeResponse,
    ModelInfo,
    Prediction,
)

#: How far ahead the GNN's risk score is meant to look. Matches the training horizon in
#: ml/data/generate_synthetic_runs.py — reported so the UI can label the overlay honestly.
HORIZON_TICKS = 30


def build_response(request: AnalyzeRequest, gnn: HfResult, llm: HfResult) -> AnalyzeResponse:
    """Assembles predictions + advisory + status. Never raises."""
    errors: list[AnalyzeError] = []

    predictions: list[Prediction] = []
    if gnn.ok:
        predictions = _to_predictions(gnn.value)
    else:
        errors.append(AnalyzeError(stage="gnn", detail=gnn.error or "unknown GNN failure"))

    advisory: Advisory | None = None
    if llm.ok:
        advisory = _to_advisory(llm.value, request)
    else:
        errors.append(AnalyzeError(stage="llm", detail=llm.error or "unknown LLM failure"))

    if gnn.ok and llm.ok:
        status = "ok"
    elif gnn.ok or llm.ok:
        status = "partial"
    else:
        status = "failed"

    return AnalyzeResponse(
        status=status,
        predictions=predictions,
        advisory=advisory,
        errors=errors,
        modelInfo=ModelInfo(gnn=gnn.model, llm=llm.model),
    )


def _to_predictions(risk_by_node: dict[str, float]) -> list[Prediction]:
    """Clamps to [0,1] and sorts worst first, so a client can take the head and stop."""
    return sorted(
        (
            Prediction(nodeId=node_id, risk=min(1.0, max(0.0, float(risk))), horizonTicks=HORIZON_TICKS)
            for node_id, risk in risk_by_node.items()
        ),
        key=lambda prediction: prediction.risk,
        reverse=True,
    )


def _to_advisory(text: str, request: AnalyzeRequest) -> Advisory:
    """
    Shapes free text into a headline, a message and any actions the model listed.

    Small instruct models like to restate the prompt and keep going past the point, so this
    cuts at the first two sentences and strips a leading "Advisory:" echo.
    """
    cleaned = re.sub(r"^\s*advisory\s*:\s*", "", text.strip(), flags=re.IGNORECASE)

    # Bullet or numbered lines are the model offering discrete actions; keep them separate.
    actions: list[str] = []
    prose_lines: list[str] = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r"^([-*•]|\d+[.)])\s+", stripped):
            actions.append(re.sub(r"^([-*•]|\d+[.)])\s+", "", stripped))
        else:
            prose_lines.append(stripped)

    prose = " ".join(prose_lines).strip()
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", prose) if s.strip()]
    message = " ".join(sentences[:2]) if sentences else (actions[0] if actions else cleaned[:200])

    return Advisory(
        headline=_headline(request),
        message=message.strip(),
        actions=actions[:4],
    )


def _headline(request: AnalyzeRequest) -> str:
    """A deterministic one-liner from the data, so the card has a title even if the prose is odd."""
    names = {node.id: (node.name or node.id) for node in request.graph.nodes}
    worst = request.context.highRiskNodeIds[0] if request.context.highRiskNodeIds else None
    if worst is None:
        return "Crowd flowing normally"
    return f"{names.get(worst, worst)} at {request.density.get(worst, 0.0) * 100:.0f}% capacity"
