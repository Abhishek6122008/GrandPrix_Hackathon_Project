"""Validation and feature building for POST /analyze.

Everything here is pure and synchronous — no I/O, no model. That is deliberate: it means the
whole feature pipeline can be exercised in a unit check without a Hugging Face token, which
is exactly what tests/test_analyze.py does.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.analyze_schema import TREND_ENCODING, AnalyzeRequest

# Order matters: the GNN was trained on columns in this order (see ml/gnn/model.py). Adding a
# feature means retraining, not just appending here.
FEATURE_COLUMNS = (
    "density",
    "trend",
    "capacity_norm",
    "degree_norm",
    "neighbour_max_density",
    "density_delta",
)


class ValidationError(ValueError):
    """Raised for input the caller can fix. The router turns this into a 422."""


@dataclass
class GraphFeatures:
    """What the GNN client sends and the postprocessor maps results back through."""

    node_ids: list[str]
    features: list[list[float]]
    edge_index: list[list[int]]
    #: node id -> index in `node_ids`, so results can be zipped back onto ids
    index_of: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.index_of:
            self.index_of = {node_id: i for i, node_id in enumerate(self.node_ids)}


def validate(request: AnalyzeRequest) -> None:
    """
    Structural checks Pydantic cannot express.

    Deliberately strict about edges pointing at nodes that do not exist: an edge_index with an
    out-of-range column is the kind of thing that produces a confusing tensor error deep inside
    the model instead of a clear 422 here.
    """
    node_ids = {node.id for node in request.graph.nodes}
    if len(node_ids) != len(request.graph.nodes):
        raise ValidationError("graph.nodes contains duplicate ids")

    for edge in request.graph.edges:
        missing = {edge.source, edge.target} - node_ids
        if missing:
            raise ValidationError(
                f"edge {edge.source}->{edge.target} references unknown node(s): {sorted(missing)}"
            )

    unknown_density = set(request.density) - node_ids
    if unknown_density:
        raise ValidationError(f"density has unknown node(s): {sorted(unknown_density)}")


def build_features(request: AnalyzeRequest) -> GraphFeatures:
    """
    Builds the node feature matrix and edge index the GNN expects.

    History is folded in as a single `density_delta` (now minus the oldest frame we were sent)
    rather than a full sequence: the model is a graph net, not a recurrent one, so the shape of
    the trajectory has to arrive as a feature.
    """
    nodes = request.graph.nodes
    node_ids = [node.id for node in nodes]
    index_of = {node_id: i for i, node_id in enumerate(node_ids)}

    density = {node_id: float(request.density.get(node_id, 0.0)) for node_id in node_ids}
    oldest = request.history[0].density if request.history else density

    # Adjacency, for degree and neighbour-max. Edges arrive already expanded to one entry per
    # direction from the Spring side, but tolerate a one-sided list anyway.
    neighbours: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    for edge in request.graph.edges:
        neighbours[edge.source].add(edge.target)
        neighbours[edge.target].add(edge.source)

    max_capacity = max((node.capacity for node in nodes), default=1) or 1
    max_degree = max((len(n) for n in neighbours.values()), default=1) or 1

    features: list[list[float]] = []
    for node in nodes:
        own = density[node.id]
        neighbour_max = max((density[n] for n in neighbours[node.id]), default=0.0)
        features.append(
            [
                own,
                TREND_ENCODING.get(request.context.trends.get(node.id, "FLAT"), 0.0),
                node.capacity / max_capacity,
                len(neighbours[node.id]) / max_degree,
                neighbour_max,
                own - float(oldest.get(node.id, own)),
            ]
        )

    edge_index = [
        [index_of[edge.source] for edge in request.graph.edges],
        [index_of[edge.target] for edge in request.graph.edges],
    ]
    return GraphFeatures(node_ids=node_ids, features=features, edge_index=edge_index, index_of=index_of)


def build_advisory_prompt(request: AnalyzeRequest, risk_by_node: dict[str, float]) -> str:
    """
    The LLM prompt. Structured fields only — the Spring side never sends prose, so the wording
    of every advisory is decided here, in one place, next to the model that reads it.
    """
    names = {node.id: (node.name or node.id) for node in request.graph.nodes}

    ranked = sorted(risk_by_node.items(), key=lambda item: item[1], reverse=True)[:3]
    if ranked:
        zones = "\n".join(
            f"- {names.get(node_id, node_id)}: "
            f"{request.density.get(node_id, 0.0) * 100:.0f}% full now, "
            f"{request.context.trends.get(node_id, 'FLAT').lower()}, "
            f"predicted risk {risk * 100:.0f}%"
            for node_id, risk in ranked
        )
    else:
        zones = "- No zone is above the warning threshold."

    minutes_in = request.tick * request.context.tickSeconds / 60
    return (
        "You are a venue safety operator writing a live advisory for event staff.\n"
        "Be specific and actionable. Two sentences maximum. No preamble.\n\n"
        f"Venue: {request.context.venueName or 'the venue'}\n"
        f"Time into event: {minutes_in:.0f} min\n"
        f"People inside: {request.context.peopleInside}, still to arrive: "
        f"{request.context.pendingArrivals}\n"
        f"Automatic rerouting: {'on' if request.context.rerouteEnabled else 'off'}\n"
        f"Zones of concern:\n{zones}\n\n"
        "Advisory:"
    )
