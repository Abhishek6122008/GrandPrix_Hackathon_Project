"""Tests for the layout → graph pipeline.

All CPU, no GPU, no model download: the VLM stage is exercised through
``parse_semantic_json`` against recorded-shape payloads, and the geometry/graph stages
run on a synthetic plan drawn here. That means CI can cover the deterministic core
even on a machine that could never load Qwen.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import pytest

from app.layout import geometry, graph as graph_mod, pipeline, validate
from app.layout.schemas import Canvas, SemanticLayout, VenueGraph
from app.layout.vlm import _extract_json, parse_semantic_json


# --------------------------------------------------------------------------- #
#  Fixtures                                                                    #
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def synthetic_plan() -> bytes:
    """A floor plan with outer walls, a stage obstacle, side rooms and doorways."""
    w, h = 1200, 800
    img = np.full((h, w, 3), 245, np.uint8)
    ink = (30, 30, 30)
    bg = (245, 245, 245)

    cv2.rectangle(img, (60, 60), (w - 60, h - 60), ink, 6)
    cv2.rectangle(img, (480, 180), (760, 380), ink, 6)  # stage
    cv2.line(img, (300, 60), (300, 300), ink, 6)
    cv2.line(img, (60, 300), (300, 300), ink, 6)
    cv2.line(img, (300, 480), (300, h - 60), ink, 6)
    cv2.line(img, (60, 480), (300, 480), ink, 6)
    cv2.line(img, (900, 60), (900, 320), ink, 6)
    cv2.line(img, (900, 320), (w - 60, 320), ink, 6)

    for gap in [((300, 150), (300, 210)), ((300, 560), (300, 620)), ((900, 140), (900, 200))]:
        cv2.line(img, gap[0], gap[1], bg, 10)
    cv2.line(img, (60, 380), (60, 460), bg, 12)      # entrance
    cv2.line(img, (w - 60, 520), (w - 60, 600), bg, 12)  # exit

    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


# --------------------------------------------------------------------------- #
#  VLM output parsing — no model needed                                        #
# --------------------------------------------------------------------------- #

def test_extract_json_handles_fenced_output():
    raw = 'Here is the layout:\n```json\n{"venue_type": "mall"}\n```\nHope that helps.'
    assert _extract_json(raw) == {"venue_type": "mall"}


def test_extract_json_handles_trailing_prose():
    raw = '{"venue_type": "stadium"} This plan shows a stadium.'
    assert _extract_json(raw) == {"venue_type": "stadium"}


def test_extract_json_returns_none_on_garbage():
    assert _extract_json("I cannot read this floor plan.") is None


def test_parse_semantic_json_drops_malformed_entries():
    canvas = Canvas(width=1000, height=800)
    payload = {
        "venue_type": "exhibition_hall",
        "zones": [
            {"id": "z1", "type": "hall", "bbox": [10, 10, 200, 200]},
            {"id": "z2", "type": "hall", "bbox": [10, 10]},           # wrong arity
            {"id": "z3", "type": "hall", "bbox": [50, 50, 51, 51]},   # degenerate
            {"id": "z4", "type": "not_a_real_kind", "bbox": [300, 300, 500, 500]},
        ],
        "entrances": [{"id": "e1", "location": [5, 400]}, {"id": "e2", "location": "nope"}],
    }
    layout = parse_semantic_json(payload, canvas)

    assert [z.id for z in layout.zones] == ["z1", "z4"]
    assert layout.zones[1].type.value == "unknown"  # unrecognised kind degrades safely
    assert [e.id for e in layout.entrances] == ["e1"]
    assert layout.degraded is False


def test_parse_semantic_json_clamps_to_canvas():
    canvas = Canvas(width=500, height=500)
    payload = {"zones": [{"id": "z", "type": "hall", "bbox": [-50, -50, 9000, 9000]}]}
    layout = parse_semantic_json(payload, canvas)
    assert layout.zones[0].bbox == (0.0, 0.0, 500.0, 500.0)


def test_swapped_bbox_corners_are_normalised():
    canvas = Canvas(width=500, height=500)
    payload = {"zones": [{"id": "z", "type": "hall", "bbox": [400, 300, 100, 50]}]}
    layout = parse_semantic_json(payload, canvas)
    x0, y0, x1, y1 = layout.zones[0].bbox
    assert x0 < x1 and y0 < y1


# --------------------------------------------------------------------------- #
#  Geometry                                                                    #
# --------------------------------------------------------------------------- #

def test_walkable_mask_is_plausible(synthetic_plan):
    img = pipeline.decode_image(synthetic_plan)
    img, canvas, _ = geometry.normalise(img)
    mask = geometry.build_walkable_mask(img, SemanticLayout(canvas=canvas, degraded=True))

    ratio = geometry.walkable_ratio(mask)
    # Line-drawing plans are legitimately mostly floor; only the extremes are failures.
    assert 0.10 < ratio < 0.995, f"implausible walkable ratio {ratio:.2f}"
    assert mask.dtype == np.uint8
    assert set(np.unique(mask)) <= {0, 255}


def test_obstacles_are_carved_out():
    """A zone the VLM flags as an obstacle must not remain walkable."""
    img = np.full((400, 400, 3), 245, np.uint8)
    cv2.rectangle(img, (20, 20), (380, 380), (30, 30, 30), 4)
    canvas = Canvas(width=400, height=400)

    semantic = SemanticLayout(
        canvas=canvas,
        obstacles=[
            {"id": "o1", "type": "obstacle", "bbox": (150.0, 150.0, 250.0, 250.0)}  # type: ignore[list-item]
        ],
    )
    mask = geometry.build_walkable_mask(img, semantic)
    assert mask[200, 200] == 0, "obstacle interior should be blocked"


# --------------------------------------------------------------------------- #
#  Graph construction and validation                                           #
# --------------------------------------------------------------------------- #

def test_pipeline_produces_connected_graph(synthetic_plan):
    res = pipeline.parse_layout(synthetic_plan, venue_name="Test", use_vlm=False)

    assert len(res.venue.nodes) >= 4
    assert len(res.venue.edges) >= 3
    # largest_connected_subgraph runs inside the pipeline, so this must hold.
    ids = {n.id for n in res.venue.nodes}
    for e in res.venue.edges:
        assert e.from_ in ids and e.to in ids


def test_every_edge_has_positive_weights(synthetic_plan):
    """A zero-length edge makes every route through it free and breaks Dijkstra."""
    res = pipeline.parse_layout(synthetic_plan, venue_name="Test", use_vlm=False)
    for e in res.venue.edges:
        assert e.length > 0
        assert e.width > 0


def test_inferred_exit_is_not_adjacent_to_inferred_gate(synthetic_plan):
    """Regression: both inferred doors used to land on the same perimeter corner.

    An exit beside the entrance makes the simulation meaningless, so the exit picker
    scores separation from existing gates.
    """
    res = pipeline.parse_layout(synthetic_plan, venue_name="Test", use_vlm=False)
    gates = [n for n in res.venue.nodes if n.type == "GATE"]
    exits = [n for n in res.venue.nodes if n.type == "EXIT"]
    assert gates and exits

    xs = [n.x for n in res.venue.nodes]
    ys = [n.y for n in res.venue.nodes]
    diagonal = math.dist((min(xs), min(ys)), (max(xs), max(ys)))
    separation = min(
        math.dist((g.x, g.y), (e.x, e.y)) for g in gates for e in exits
    )
    assert separation > 0.25 * diagonal, (
        f"gate and exit only {separation:.0f}px apart on a {diagonal:.0f}px diagonal"
    )


def test_gate_can_reach_exit(synthetic_plan):
    from collections import defaultdict, deque

    res = pipeline.parse_layout(synthetic_plan, venue_name="Test", use_vlm=False)
    adj = defaultdict(set)
    for e in res.venue.edges:
        adj[e.from_].add(e.to)
        adj[e.to].add(e.from_)

    exit_ids = {n.id for n in res.venue.nodes if n.type == "EXIT"}
    for gate in (n for n in res.venue.nodes if n.type == "GATE"):
        seen, queue = set(), deque([gate.id])
        while queue:
            cur = queue.popleft()
            if cur in seen:
                continue
            seen.add(cur)
            queue.extend(adj[cur] - seen)
        assert seen & exit_ids, f"gate {gate.id} cannot reach any exit"


def test_isolated_node_is_reconnected():
    graph = VenueGraph(
        id="v", name="V",
        nodes=[
            {"id": "a", "name": "A", "type": "GATE", "capacity": 10, "x": 0, "y": 0},      # type: ignore[list-item]
            {"id": "b", "name": "B", "type": "EXIT", "capacity": 10, "x": 100, "y": 0},    # type: ignore[list-item]
            {"id": "c", "name": "C", "type": "WALKWAY", "capacity": 10, "x": 50, "y": 50}, # type: ignore[list-item]
        ],
        edges=[{"from": "a", "to": "b", "length": 10, "width": 2, "bidirectional": True}],  # type: ignore[list-item]
    )
    repaired, issues, repairs = validate.validate_and_repair(graph)

    connected = {e.from_ for e in repaired.edges} | {e.to for e in repaired.edges}
    assert "c" in connected
    assert any("isolated" in r for r in repairs)


def test_dangling_edge_is_dropped():
    graph = VenueGraph(
        id="v", name="V",
        nodes=[
            {"id": "a", "name": "A", "type": "GATE", "capacity": 10, "x": 0, "y": 0},    # type: ignore[list-item]
            {"id": "b", "name": "B", "type": "EXIT", "capacity": 10, "x": 100, "y": 0},  # type: ignore[list-item]
        ],
        edges=[
            {"from": "a", "to": "b", "length": 10, "width": 2, "bidirectional": True},   # type: ignore[list-item]
            {"from": "a", "to": "ghost", "length": 5, "width": 2, "bidirectional": True},# type: ignore[list-item]
        ],
    )
    repaired, _, repairs = validate.validate_and_repair(graph)
    assert len(repaired.edges) == 1
    assert any("dangling" in r for r in repairs)


def test_confidence_penalises_errors():
    high = validate.confidence_score(
        vlm_used=True, walkable_fraction=0.4, node_count=12, error_count=0, repair_count=0
    )
    low = validate.confidence_score(
        vlm_used=True, walkable_fraction=0.4, node_count=12, error_count=2, repair_count=3
    )
    assert high > low
    assert 0.0 <= low <= 1.0


def test_spring_payload_uses_from_not_from_underscore(synthetic_plan):
    """Spring's VenueEdge record binds ``from``; ``from_`` would fail validation."""
    res = pipeline.parse_layout(synthetic_plan, venue_name="Test", use_vlm=False)
    payload = res.venue.to_spring_payload()
    assert payload["edges"], "expected at least one edge"
    assert "from" in payload["edges"][0]
    assert "from_" not in payload["edges"][0]


# --------------------------------------------------------------------------- #
#  Room-aware tracing — the apartment/office case                              #
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def rooms_plan() -> np.ndarray:
    """An architectural plan: enclosed rooms either side of a central corridor.

    The case the open-venue reading gets wrong. Its rooms are as white as its
    corridor, so a mask built on "light means floor" sees one undivided slab and
    traces diagonals through the bedrooms.
    """
    w, h = 1000, 1200
    img = np.full((h, w, 3), 255, np.uint8)
    ink = (0, 0, 0)

    cv2.rectangle(img, (40, 40), (w - 40, h - 40), ink, 5)
    # Central corridor walls, leaving a 200px-wide spine down the middle.
    cv2.line(img, (400, 120), (400, h - 120), ink, 4)
    cv2.line(img, (600, 120), (600, h - 120), ink, 4)

    # Four enclosed rooms, two a side.
    for x0, x1 in ((90, 395), (605, 910)):
        for y0, y1 in ((150, 560), (640, 1050)):
            cv2.rectangle(img, (x0, y0), (x1, y1), ink, 4)

    # Doorways from each room onto the corridor.
    for y in (350, 840):
        cv2.line(img, (400, y - 35), (400, y + 35), (255, 255, 255), 9)
        cv2.line(img, (600, y - 35), (600, y + 35), (255, 255, 255), 9)

    return img


def test_room_aware_mask_excludes_room_interiors(rooms_plan):
    """The fix: a bedroom must not be walkable, or routes cut straight through it."""
    from app.layout import rooms as rooms_mod

    found, walls = rooms_mod.detect_rooms(rooms_plan)
    assert found, "expected enclosed rooms to be detected"

    circulation, _ = rooms_mod.build_circulation_mask(rooms_plan, found, walls)

    # A non-traversable room's centre must not be walkable.
    carved = [r for r in found if not r.traversable]
    assert carved, "expected at least one destination-only room"
    for room in carved:
        cx, cy = int(room.centroid[0]), int(room.centroid[1])
        assert circulation[cy, cx] == 0, f"room {room.id} centre is still walkable"


def test_room_aware_mask_is_far_smaller_than_open_reading(rooms_plan):
    """The two readings must genuinely differ, or the option is decorative."""
    from app.layout import rooms as rooms_mod

    found, walls = rooms_mod.detect_rooms(rooms_plan)
    circulation, _ = rooms_mod.build_circulation_mask(rooms_plan, found, walls)

    open_mask = geometry.build_walkable_mask(
        rooms_plan, SemanticLayout(canvas=Canvas(width=1000, height=1200), degraded=True)
    )

    room_aware_ratio = float(np.count_nonzero(circulation)) / circulation.size
    open_ratio = float(np.count_nonzero(open_mask)) / open_mask.size
    assert room_aware_ratio < open_ratio * 0.6, (
        f"room-aware {room_aware_ratio:.2f} should be well under open {open_ratio:.2f}"
    )


def test_containers_are_not_mistaken_for_rooms():
    """A unit envelope wrapping several rooms is not itself a room.

    Without this the whole flat is the biggest 'room' on the plan, wins the
    walk-through test, and the carve-out does nothing.
    """
    from app.layout import rooms as rooms_mod

    img = np.full((900, 900, 3), 255, np.uint8)
    cv2.rectangle(img, (60, 60), (840, 840), (0, 0, 0), 4)      # envelope
    cv2.rectangle(img, (120, 120), (420, 420), (0, 0, 0), 4)    # room 1
    cv2.rectangle(img, (480, 120), (780, 420), (0, 0, 0), 4)    # room 2
    cv2.rectangle(img, (120, 480), (420, 780), (0, 0, 0), 4)    # room 3

    found, _ = rooms_mod.detect_rooms(img)
    boxes = [r.bbox for r in found]
    # The envelope spans nearly the whole canvas; no kept room should.
    assert not any(
        (b[2] - b[0]) > 700 and (b[3] - b[1]) > 700 for b in boxes
    ), f"envelope was kept as a room: {boxes}"


def test_tuning_is_clamped_to_usable_values():
    """Even kernel sizes and zeros degrade OpenCV silently rather than raising."""
    from app.layout.rooms import RoomTuning

    t = RoomTuning(
        wall_run_px=0, corridor_min_px=1000, large_room_multiple=0.1
    ).clamped()
    assert t.wall_run_px % 2 == 1 and t.wall_run_px >= 3
    assert t.corridor_min_px % 2 == 1 and t.corridor_min_px <= 61
    assert t.large_room_multiple >= 1.05


def test_open_venue_parse_is_unchanged_by_default(synthetic_plan):
    """Passing no tuning must keep the original behaviour for arenas."""
    res = pipeline.parse_layout(synthetic_plan, venue_name="Arena", use_vlm=False)
    assert res.metadata.rooms is None
    assert len(res.venue.nodes) >= 3
