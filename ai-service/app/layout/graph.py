"""Skeleton and graph construction — the deterministic heart of the pipeline.

Pipeline within this module::

    walkable mask
        → skeletonize (scikit-image, Zhang-Suen)
        → classify pixels by neighbour count (endpoint / path / junction)
        → trace runs between junctions into polylines
        → collapse polylines to graph edges, width from the distance field
        → attach semantic zones as named nodes
        → simplify (merge near-duplicate junctions, drop stubs)
        → VenueGraph

Nothing here calls a model. Given the same mask it produces the same graph every time,
which is what makes the output safe to hand to a simulation.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict, deque

import numpy as np

from app.layout.schemas import (
    DEFAULT_CAPACITY,
    ZONE_KIND_TO_NODE_TYPE,
    GraphEdge,
    GraphNode,
    SemanticLayout,
    SemanticZone,
    VenueGraph,
    ZoneKind,
)

log = logging.getLogger(__name__)

#: Junctions closer than this (px) are the same real intersection seen twice — the
#: skeleton of a wide corridor crossing frays into several adjacent branch points.
JUNCTION_MERGE_RADIUS = 26

#: Skeleton spurs shorter than this are thresholding artefacts, not corridors.
MIN_BRANCH_LENGTH = 34

#: Metres per pixel. Without a scale bar this is a guess; it only affects absolute
#: lengths, and Dijkstra cares about ratios, so a wrong constant does not change routes.
DEFAULT_METRES_PER_PX = 0.05

_NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeletonize_mask(mask: np.ndarray) -> np.ndarray:
    """Reduce the walkable region to a 1-pixel-wide centreline.

    scikit-image's ``skeletonize`` is the documented choice and is well behaved on
    binary input; the fallback keeps the module importable without it, using OpenCV's
    thinning if opencv-contrib is present.
    """
    binary = (mask > 0)
    try:
        from skimage.morphology import skeletonize

        return skeletonize(binary).astype(np.uint8)
    except ImportError:
        try:
            import cv2

            thinned = cv2.ximgproc.thinning((binary * 255).astype(np.uint8))
            return (thinned > 0).astype(np.uint8)
        except Exception as exc:  # pragma: no cover - environment dependent
            raise RuntimeError(
                "Neither scikit-image nor opencv-contrib is available; "
                "install scikit-image to run the layout pipeline."
            ) from exc


def _neighbour_count(skel: np.ndarray) -> np.ndarray:
    """8-neighbour count for every skeleton pixel, via shifted sums (no Python loop)."""
    padded = np.pad(skel, 1, mode="constant")
    total = np.zeros_like(skel, dtype=np.uint8)
    for dy, dx in _NEIGHBOURS:
        total += padded[1 + dy : 1 + dy + skel.shape[0], 1 + dx : 1 + dx + skel.shape[1]]
    return total * skel


def classify_pixels(skel: np.ndarray) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """Split skeleton pixels into (endpoints, junctions).

    Endpoint = exactly one neighbour (a dead end, usually a doorway or a stub).
    Junction = three or more (a real fork).
    """
    counts = _neighbour_count(skel)
    endpoints = [(int(y), int(x)) for y, x in zip(*np.where(counts == 1))]
    junctions = [(int(y), int(x)) for y, x in zip(*np.where(counts >= 3))]
    return endpoints, junctions


def _merge_close_points(
    points: list[tuple[int, int]], radius: int
) -> list[tuple[int, int]]:
    """Cluster points within ``radius`` and return one representative each.

    Simple grid-bucketed union-find; the point count here is in the hundreds, so this
    stays trivial next to the morphology that produced them.
    """
    if not points:
        return []
    parent = list(range(len(points)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (y, x) in enumerate(points):
        buckets[(y // radius, x // radius)].append(i)

    r2 = radius * radius
    for (by, bx), idxs in buckets.items():
        near = [
            j
            for dy in (-1, 0, 1)
            for dx in (-1, 0, 1)
            for j in buckets.get((by + dy, bx + dx), [])
        ]
        for i in idxs:
            yi, xi = points[i]
            for j in near:
                if i >= j:
                    continue
                yj, xj = points[j]
                if (yi - yj) ** 2 + (xi - xj) ** 2 <= r2:
                    union(i, j)

    clusters: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for i, p in enumerate(points):
        clusters[find(i)].append(p)

    return [
        (int(round(sum(p[0] for p in pts) / len(pts))), int(round(sum(p[1] for p in pts) / len(pts))))
        for pts in clusters.values()
    ]


def trace_paths(
    skel: np.ndarray, anchors: list[tuple[int, int]]
) -> list[tuple[tuple[int, int], tuple[int, int], list[tuple[int, int]]]]:
    """Walk the skeleton between anchor pixels, returning (start, end, polyline) runs.

    Anchors are the merged junctions plus endpoints. Every skeleton pixel belongs to
    exactly one run, so the resulting edge set covers the whole centreline with no
    double-counting.
    """
    anchor_set = set(anchors)
    h, w = skel.shape
    visited_edges: set[frozenset[tuple[int, int]]] = set()
    runs: list[tuple[tuple[int, int], tuple[int, int], list[tuple[int, int]]]] = []

    def neighbours(p: tuple[int, int]) -> list[tuple[int, int]]:
        y, x = p
        out = []
        for dy, dx in _NEIGHBOURS:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and skel[ny, nx]:
                out.append((ny, nx))
        return out

    for anchor in anchors:
        for first in neighbours(anchor):
            key = frozenset((anchor, first))
            if key in visited_edges:
                continue
            polyline = [anchor, first]
            visited_edges.add(key)
            prev, cur = anchor, first

            # Follow the corridor until the next anchor or a dead end.
            while cur not in anchor_set:
                nxt = [n for n in neighbours(cur) if n != prev]
                if not nxt:
                    break
                step = nxt[0]
                visited_edges.add(frozenset((cur, step)))
                polyline.append(step)
                prev, cur = cur, step

            if len(polyline) >= 2:
                runs.append((anchor, polyline[-1], polyline))

    return runs


def _polyline_length(poly: list[tuple[int, int]]) -> float:
    return sum(
        math.dist(poly[i], poly[i + 1]) for i in range(len(poly) - 1)
    )


def _mean_width_px(poly: list[tuple[int, int]], dist: np.ndarray) -> float:
    """Corridor width at this run = 2 × mean distance-to-wall along its centreline."""
    if dist.size == 0:
        return 4.0
    samples = [float(dist[y, x]) for y, x in poly[:: max(1, len(poly) // 24)]]
    return max(1.0, 2.0 * (sum(samples) / len(samples)))


def _zone_node_type(zone: SemanticZone) -> str:
    return ZONE_KIND_TO_NODE_TYPE.get(zone.type, "WALKWAY")


def _slug(text: str, fallback: str) -> str:
    cleaned = "".join(c.lower() if c.isalnum() else "-" for c in (text or "")).strip("-")
    cleaned = "-".join(filter(None, cleaned.split("-")))
    return cleaned or fallback


def build_graph(
    skel: np.ndarray,
    dist: np.ndarray,
    semantic: SemanticLayout,
    *,
    venue_id: str,
    venue_name: str,
    metres_per_px: float = DEFAULT_METRES_PER_PX,
) -> tuple[VenueGraph, list[str]]:
    """Assemble the venue graph from skeleton + semantics.

    Returns the graph and a list of human-readable notes about what was simplified,
    which the UI shows so an operator knows what the pipeline decided on its own.
    """
    notes: list[str] = []
    endpoints, junctions = classify_pixels(skel)

    anchors = _merge_close_points(junctions + endpoints, JUNCTION_MERGE_RADIUS)
    if len(junctions) and len(anchors) < len(junctions):
        notes.append(
            f"Merged {len(junctions) + len(endpoints)} skeleton branch points into "
            f"{len(anchors)} intersections."
        )

    runs = trace_paths(skel, anchors)

    # Drop stubs — short runs ending in a dead end are threshold noise.
    anchor_degree: dict[tuple[int, int], int] = defaultdict(int)
    for a, b, _ in runs:
        anchor_degree[a] += 1
        anchor_degree[b] += 1

    kept = []
    dropped = 0
    for a, b, poly in runs:
        length = _polyline_length(poly)
        is_stub = length < MIN_BRANCH_LENGTH and (anchor_degree[a] == 1 or anchor_degree[b] == 1)
        if is_stub:
            dropped += 1
            continue
        kept.append((a, b, poly, length))
    if dropped:
        notes.append(f"Removed {dropped} skeleton stubs shorter than {MIN_BRANCH_LENGTH}px.")

    # ---- nodes -----------------------------------------------------------------
    node_ids: dict[tuple[int, int], str] = {}
    nodes: list[GraphNode] = []

    def register(point: tuple[int, int], node_type: str, name: str, node_id: str) -> str:
        y, x = point
        node_ids[point] = node_id
        nodes.append(
            GraphNode(
                id=node_id,
                name=name,
                type=node_type,  # type: ignore[arg-type]
                capacity=DEFAULT_CAPACITY.get(node_type, 300),
                x=float(x),
                y=float(y),
            )
        )
        return node_id

    used_anchors = {a for a, _, _, _ in kept} | {b for _, b, _, _ in kept}

    # Semantic zones claim the nearest anchor so a named hall becomes a real node
    # rather than a floating label next to an anonymous intersection.
    claimed: dict[tuple[int, int], SemanticZone] = {}
    for zone in semantic.zones:
        if zone.type in {ZoneKind.OBSTACLE, ZoneKind.RESTRICTED}:
            continue
        cx, cy = zone.centre()
        candidates = [p for p in used_anchors if p not in claimed]
        if not candidates:
            break
        nearest = min(candidates, key=lambda p: (p[1] - cx) ** 2 + (p[0] - cy) ** 2)
        if math.dist((nearest[1], nearest[0]), (cx, cy)) > max(skel.shape) * 0.25:
            continue  # too far to plausibly be this zone
        claimed[nearest] = zone

    # Entrance/exit points likewise claim their closest anchor.
    for point_list, node_type, prefix in (
        (semantic.entrances, "GATE", "gate"),
        (semantic.exits, "EXIT", "exit"),
    ):
        for i, sp in enumerate(point_list):
            px, py = sp.location
            candidates = [p for p in used_anchors if p not in claimed]
            if not candidates:
                break
            nearest = min(candidates, key=lambda p: (p[1] - px) ** 2 + (p[0] - py) ** 2)
            claimed[nearest] = SemanticZone(
                id=sp.id,
                type=ZoneKind.ENTRANCE if node_type == "GATE" else ZoneKind.EXIT,
                bbox=(px - 1, py - 1, px + 1, py + 1),
                label=sp.label or f"{prefix.title()} {i + 1}",
                confidence=sp.confidence,
            )

    seen_ids: set[str] = set()
    for idx, anchor in enumerate(sorted(used_anchors)):
        zone = claimed.get(anchor)
        if zone is not None:
            node_type = _zone_node_type(zone)
            name = zone.label or zone.type.value.replace("_", " ").title()
            base = _slug(name, f"node-{idx}")
        else:
            node_type = "WALKWAY"
            name = f"Junction {idx + 1}"
            base = f"junction-{idx + 1}"
        node_id = base
        suffix = 2
        while node_id in seen_ids:
            node_id = f"{base}-{suffix}"
            suffix += 1
        seen_ids.add(node_id)
        register(anchor, node_type, name, node_id)

    # ---- edges -----------------------------------------------------------------
    edges: list[GraphEdge] = []
    seen_pairs: set[tuple[str, str]] = set()
    for a, b, poly, length_px in kept:
        ia, ib = node_ids.get(a), node_ids.get(b)
        if ia is None or ib is None or ia == ib:
            continue
        pair = (ia, ib) if ia < ib else (ib, ia)
        if pair in seen_pairs:
            continue  # parallel corridors between the same pair collapse to one
        seen_pairs.add(pair)
        width_m = max(0.8, _mean_width_px(poly, dist) * metres_per_px)
        edges.append(
            GraphEdge(
                **{
                    "from": ia,
                    "to": ib,
                    "length": max(0.5, round(length_px * metres_per_px, 2)),
                    "width": round(width_m, 2),
                    "bidirectional": True,
                }
            )
        )

    graph = VenueGraph(id=venue_id, name=venue_name, nodes=nodes, edges=edges)
    return graph, notes


def largest_connected_subgraph(graph: VenueGraph) -> tuple[VenueGraph, int]:
    """Keep only the biggest connected component. Returns (graph, nodes_removed).

    An isolated cluster is unreachable in the simulation, and the sim's Dijkstra will
    happily route into it and strand agents. Better to drop it and say so.
    """
    adjacency: dict[str, set[str]] = defaultdict(set)
    for e in graph.edges:
        adjacency[e.from_].add(e.to)
        adjacency[e.to].add(e.from_)

    unvisited = {n.id for n in graph.nodes}
    best: set[str] = set()
    while unvisited:
        seed = next(iter(unvisited))
        component: set[str] = set()
        queue = deque([seed])
        while queue:
            cur = queue.popleft()
            if cur in component:
                continue
            component.add(cur)
            queue.extend(adjacency[cur] - component)
        unvisited -= component
        if len(component) > len(best):
            best = component

    removed = len(graph.nodes) - len(best)
    if removed == 0:
        return graph, 0

    return (
        VenueGraph(
            id=graph.id,
            name=graph.name,
            nodes=[n for n in graph.nodes if n.id in best],
            edges=[e for e in graph.edges if e.from_ in best and e.to in best],
        ),
        removed,
    )
