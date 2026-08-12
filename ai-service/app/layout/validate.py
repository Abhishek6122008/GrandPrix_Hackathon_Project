"""Phase 6 — validate the generated graph, and repair it deterministically.

The rule from the brief: *if validation fails, attempt deterministic repair before
involving another AI model.* Nothing in this module calls a model. Every repair is a
documented, reproducible edit, and every edit is reported back so the operator sees
exactly what the pipeline changed on its own.

Checks, in the order they run:

1. Structural — positive lengths/widths, no self-loops, no dangling edge endpoints.
2. Reachability — every GATE reaches at least one EXIT.
3. Presence — the venue has at least one GATE and one EXIT at all.
4. Isolation — no node stranded with no edges.

A graph that still has ``severity="error"`` issues after repair is returned anyway,
flagged, and the UI blocks "Start simulation" until an operator fixes it by hand. It is
better to show a broken map and say so than to silently invent a plausible one.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque

from app.layout.schemas import (
    DEFAULT_CAPACITY,
    GraphEdge,
    GraphNode,
    ValidationIssue,
    VenueGraph,
)

#: Below this, a "corridor" is a rounding artefact rather than a walkable link.
MIN_EDGE_LENGTH_M = 0.5
MIN_EDGE_WIDTH_M = 0.8


def _adjacency(graph: VenueGraph) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = defaultdict(set)
    for e in graph.edges:
        adj[e.from_].add(e.to)
        if e.bidirectional:
            adj[e.to].add(e.from_)
    return adj


def _reaches_any(start: str, targets: set[str], adj: dict[str, set[str]]) -> bool:
    seen: set[str] = set()
    queue = deque([start])
    while queue:
        cur = queue.popleft()
        if cur in targets:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        queue.extend(adj[cur] - seen)
    return False


def _nearest(node: GraphNode, others: list[GraphNode]) -> GraphNode | None:
    if not others:
        return None
    return min(others, key=lambda o: math.dist((node.x, node.y), (o.x, o.y)))


def validate_and_repair(
    graph: VenueGraph, *, metres_per_px: float = 0.05
) -> tuple[VenueGraph, list[ValidationIssue], list[str]]:
    """Run checks and deterministic repairs.

    Returns ``(graph, issues, repairs)``. ``issues`` describes what is still wrong
    after repair; ``repairs`` describes what was changed.
    """
    issues: list[ValidationIssue] = []
    repairs: list[str] = []

    nodes = {n.id: n for n in graph.nodes}
    edges: list[GraphEdge] = []

    # --- 1. structural ------------------------------------------------------
    dropped_dangling = 0
    for e in graph.edges:
        if e.from_ == e.to:
            dropped_dangling += 1
            continue
        if e.from_ not in nodes or e.to not in nodes:
            dropped_dangling += 1
            continue
        fixed = e.model_copy()
        if fixed.length < MIN_EDGE_LENGTH_M:
            fixed.length = MIN_EDGE_LENGTH_M
        if fixed.width < MIN_EDGE_WIDTH_M:
            fixed.width = MIN_EDGE_WIDTH_M
        edges.append(fixed)

    if dropped_dangling:
        repairs.append(f"Dropped {dropped_dangling} self-loop or dangling edges.")

    graph = VenueGraph(id=graph.id, name=graph.name, nodes=list(nodes.values()), edges=edges)
    adj = _adjacency(graph)

    # --- 2. isolated nodes --------------------------------------------------
    isolated = [n for n in graph.nodes if not adj[n.id]]
    if isolated:
        connectable = [n for n in graph.nodes if adj[n.id]]
        reconnected = 0
        for node in isolated:
            target = _nearest(node, connectable)
            if target is None:
                continue
            dist_px = math.dist((node.x, node.y), (target.x, target.y))
            graph.edges.append(
                GraphEdge(
                    **{
                        "from": node.id,
                        "to": target.id,
                        "length": max(MIN_EDGE_LENGTH_M, round(dist_px * metres_per_px, 2)),
                        "width": 2.0,
                        "bidirectional": True,
                    }
                )
            )
            reconnected += 1
        if reconnected:
            repairs.append(
                f"Connected {reconnected} isolated node(s) to their nearest neighbour. "
                "Verify these links against the plan — they are inferred, not observed."
            )
            adj = _adjacency(graph)

    # --- 3. gates and exits exist ------------------------------------------
    gates = [n for n in graph.nodes if n.type == "GATE"]
    exits = [n for n in graph.nodes if n.type == "EXIT"]

    if not gates:
        # Promote the walkway node closest to the canvas edge — entrances are, almost
        # by definition, on the perimeter.
        candidate = _perimeter_candidate(graph)
        if candidate is not None:
            candidate.type = "GATE"
            candidate.name = "Inferred Entrance"
            candidate.capacity = DEFAULT_CAPACITY["GATE"]
            gates = [candidate]
            repairs.append(
                f"No entrance detected; promoted perimeter node '{candidate.id}' to GATE. "
                "Confirm this before running the simulation."
            )
        else:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="no_entrance",
                    message="No entrance could be identified or inferred. Mark one manually.",
                )
            )

    if not exits:
        # Bias away from the gates. Without this the picker returns the same corner it
        # gave the entrance, and an exit beside the entrance makes the simulation
        # meaningless — everyone leaves through the door they came in.
        candidate = _perimeter_candidate(
            graph, exclude={n.id for n in gates}, far_from=gates
        )
        if candidate is not None:
            candidate.type = "EXIT"
            candidate.name = "Inferred Exit"
            candidate.capacity = DEFAULT_CAPACITY["EXIT"]
            exits = [candidate]
            repairs.append(
                f"No exit detected; promoted perimeter node '{candidate.id}' to EXIT. "
                "Confirm this before running the simulation."
            )
        else:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="no_exit",
                    message="No exit could be identified or inferred. Mark one manually.",
                )
            )

    # --- 4. reachability ----------------------------------------------------
    exit_ids = {n.id for n in exits}
    if exit_ids:
        stranded = [g.id for g in gates if not _reaches_any(g.id, exit_ids, adj)]
        if stranded:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="gate_cannot_reach_exit",
                    message=(
                        f"{len(stranded)} entrance(s) have no path to any exit. "
                        "Add the missing corridor in the editor before simulating."
                    ),
                    node_ids=stranded,
                )
            )

    # --- 5. soft warnings ---------------------------------------------------
    if len(graph.nodes) < 4:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="sparse_graph",
                message=(
                    f"Only {len(graph.nodes)} nodes were extracted. The plan may be low "
                    "contrast — check the map against the upload."
                ),
            )
        )

    degree = defaultdict(int)
    for e in graph.edges:
        degree[e.from_] += 1
        degree[e.to] += 1
    dead_ends = [n.id for n in graph.nodes if degree[n.id] == 1 and n.type not in {"GATE", "EXIT"}]
    if len(dead_ends) > max(3, len(graph.nodes) // 4):
        issues.append(
            ValidationIssue(
                severity="warning",
                code="many_dead_ends",
                message=(
                    f"{len(dead_ends)} non-gate nodes are dead ends. Corridors may have "
                    "been broken by thresholding."
                ),
                node_ids=dead_ends[:12],
            )
        )

    return graph, issues, repairs


def _perimeter_candidate(
    graph: VenueGraph,
    exclude: set[str] | None = None,
    far_from: list[GraphNode] | None = None,
) -> GraphNode | None:
    """The walkway node nearest the bounding-box edge — the likeliest doorway.

    ``far_from`` adds a separation term so a second call doesn't return the same corner
    as the first. Scored rather than filtered: on a small graph every node may be near
    the gate, and returning something is better than returning nothing.
    """
    exclude = exclude or set()
    pool = [n for n in graph.nodes if n.id not in exclude and n.type == "WALKWAY"]
    if not pool:
        pool = [n for n in graph.nodes if n.id not in exclude]
    if not pool:
        return None

    xs = [n.x for n in graph.nodes]
    ys = [n.y for n in graph.nodes]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    diagonal = max(1.0, math.dist((x0, y0), (x1, y1)))

    def score(n: GraphNode) -> float:
        # Lower is better. Normalised so the two terms are comparable.
        edge_gap = min(n.x - x0, x1 - n.x, n.y - y0, y1 - n.y) / diagonal
        if not far_from:
            return edge_gap
        nearest_excluded = min(math.dist((n.x, n.y), (o.x, o.y)) for o in far_from)
        separation = nearest_excluded / diagonal  # want this large
        return edge_gap - separation

    return min(pool, key=score)


def confidence_score(
    *,
    vlm_used: bool,
    walkable_fraction: float,
    node_count: int,
    error_count: int,
    repair_count: int,
) -> float:
    """A single 0–1 number for the UI, from signals that actually correlate with quality.

    Deliberately pessimistic: this drives whether an operator is nudged to check the
    map, and an over-confident score is worse than a cautious one.
    """
    score = 0.55 if vlm_used else 0.40

    # Calibration note: CAD-style line drawings are legitimately 90%+ floor — thin
    # black wall strokes on white. A narrow band here wrongly punished correct
    # extraction of exactly the plans we expect most often. Only the extremes signal
    # failure: near-0 means over-thresholding ate the floor, near-1.0 means no walls
    # were detected at all and the whole page was called walkable.
    if 0.12 <= walkable_fraction <= 0.985:
        score += 0.20
    elif 0.05 <= walkable_fraction <= 0.995:
        score += 0.08

    if node_count >= 8:
        score += 0.15
    elif node_count >= 4:
        score += 0.08

    score -= 0.25 * error_count
    score -= 0.04 * repair_count

    return round(max(0.0, min(1.0, score)), 2)
