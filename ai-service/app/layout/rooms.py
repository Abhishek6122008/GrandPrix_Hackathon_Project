"""Room decomposition — telling circulation apart from enclosed rooms.

``geometry.build_walkable_mask`` answers "where is there floor". On an open venue that
is the whole question: an arena's floor *is* its circulation. On an architectural floor
plan it is not, and treating it that way is what made the tracer draw corridors straight
through bedrooms — a plan's rooms are as white as its corridors, so a single "light means
floor" mask sees one undivided blob and skeletonises the building's diagonal.

This module splits that blob:

* **Rooms** — light regions fully enclosed by wall ink. Bedrooms, toilets, halls.
* **Circulation** — what is left. Corridors, lobbies, stair cores; the roads.

The split is by *enclosure*, not by size or by any painted colour, so it survives plans
with no legend, no labels and no colour coding.

Each room then gets classified by its own footprint:

* **small** (bedroom, toilet, kitchen) — a destination. People go *to* it, not through
  it. It joins the graph at its doorway.
* **large** (drawing room, dining hall, exhibition floor) — traversable. Its interior
  is circulation too, because a route legitimately crosses a big hall.

The threshold is taken from the plan's own room-size distribution rather than a constant
in pixels. A constant cannot be right for both a 3-bedroom flat and a stadium concourse
in the same codebase, and a plan always contains its own sense of scale.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

log = logging.getLogger(__name__)

#: A region smaller than this fraction of the canvas is furniture, a label box or
#: threshold noise, never a room worth routing to.
MIN_ROOM_AREA_FRAC = 0.0012

#: A region larger than this is the building envelope or the sheet background, not a
#: room. Without it the outer margin of the plan is "the biggest room".
MAX_ROOM_AREA_FRAC = 0.35

#: Rooms at or above this share of the median room area are treated as traversable
#: halls. 2.2 rather than 1.0 because the median room in a flat is a bedroom, and a
#: drawing room is a small multiple of it — this asks for "clearly bigger than typical",
#: not merely "above average".
LARGE_ROOM_MEDIAN_MULTIPLE = 2.2

#: Absolute floor on being called large: a room must also occupy at least this fraction
#: of the canvas. Stops every room being "large" on a plan of six identical rooms, where
#: the median is meaningless.
LARGE_ROOM_MIN_FRAC = 0.02

#: Opening kernel that clears the gaps between a room and its wall. Anything narrower
#: than this is a construction sliver, not somewhere a person walks. At
#: TARGET_LONG_EDGE=1600 this is roughly a 60cm gap on a typical residential plan —
#: below a real doorway, above any partition thickness.
SLIVER_KERNEL = 15

#: Minimum wall-run length, in pixels, for ink to count as structure rather than text.
#: The single most plan-dependent number here: a CAD export draws hairline walls that a
#: large value erases, while a scanned blueprint has thick labels a small value keeps.
#: Exposed through the API so an operator can correct it without a redeploy.
WALL_RUN_PX = 11


@dataclass
class RoomTuning:
    """Operator-adjustable knobs for the room/circulation split.

    Every default here is the value that worked across the plans tested, and every one
    of them is a guess about a drawing convention rather than a fact. Auto-tracing a
    floor plan is inherently approximate — the honest design is to expose the knobs and
    show the result, not to pretend one constant fits a CAD export and a phone photo of
    a printed blueprint equally well.
    """

    #: See WALL_RUN_PX.
    wall_run_px: int = WALL_RUN_PX
    #: See SLIVER_KERNEL. Raise to erase more construction slack, lower to keep a
    #: genuinely narrow corridor.
    corridor_min_px: int = SLIVER_KERNEL
    #: See LARGE_ROOM_MEDIAN_MULTIPLE. Lower to let more rooms be walked through.
    large_room_multiple: float = LARGE_ROOM_MEDIAN_MULTIPLE
    #: When true, room interiors are never carved out — the old open-venue behaviour.
    #: Correct for an arena, wrong for anything with bedrooms in it.
    treat_rooms_as_open: bool = False

    def clamped(self) -> "RoomTuning":
        """Keeps operator input inside values the morphology can actually use.

        An even kernel size or a zero silently degrades OpenCV's behaviour rather than
        raising, which would surface as a mysteriously empty map.
        """
        return RoomTuning(
            wall_run_px=max(3, min(41, int(self.wall_run_px) | 1)),
            corridor_min_px=max(3, min(61, int(self.corridor_min_px) | 1)),
            large_room_multiple=float(max(1.05, min(20.0, self.large_room_multiple))),
            treat_rooms_as_open=bool(self.treat_rooms_as_open),
        )


@dataclass
class Room:
    """One enclosed region of the plan."""

    id: int
    #: Binary mask of just this room, same shape as the plan.
    mask: np.ndarray
    area_px: int
    centroid: tuple[float, float]  # (x, y)
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1
    #: True when the room is big enough that routes may cross its interior.
    traversable: bool = False

    @property
    def width_px(self) -> int:
        return self.bbox[2] - self.bbox[0]

    @property
    def height_px(self) -> int:
        return self.bbox[3] - self.bbox[1]


def _wall_ink(image_bgr: np.ndarray, run_px: int = WALL_RUN_PX) -> np.ndarray:
    """Wall line-work only: dark, and thick enough to be structure.

    An adaptive threshold alone returns every dark pixel, which on a dimensioned plan
    means the walls *and* the text, the furniture, the hatching and the dimension
    arrows. Text is what breaks enclosure detection — a label sitting across a doorway
    seals it, and a room that should be reachable becomes a sealed box.

    So the ink is opened with a small kernel: wall runs are long and connected and
    survive it, glyphs and stipple are not and do not.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 60, 60)
    ink = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 8
    )

    # Keep only ink that belongs to an extended structure. Two directional openings
    # rather than one square: a wall is long in one axis and thin in the other, so a
    # square kernel large enough to drop text also drops thin walls.
    run = max(3, int(run_px) | 1)
    horizontal = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (run, 1))
    )
    vertical = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, run))
    )
    walls = cv2.bitwise_or(horizontal, vertical)

    # Rejoin wall runs broken by a dimension line crossing them. Small, so a real
    # doorway gap (much wider) stays open.
    return cv2.morphologyEx(
        walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )


def detect_rooms(
    image_bgr: np.ndarray, tuning: RoomTuning | None = None
) -> tuple[list[Room], np.ndarray]:
    """Find enclosed rooms.

    Returns ``(rooms, wall_mask)``. Rooms are ordered largest first.

    The method is deliberately plain: erase the walls from the image and see what
    separate pockets of white remain. A room is a pocket bounded on all sides; the
    corridor is the pocket that touches everything else. No model is consulted, so the
    same plan always decomposes the same way.
    """
    tune = (tuning or RoomTuning()).clamped()
    walls = _wall_ink(image_bgr, tune.wall_run_px)
    free = cv2.bitwise_not(walls)

    # Erode slightly so two rooms sharing a wall that the threshold rendered one pixel
    # thin do not bleed into a single component.
    free = cv2.erode(free, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        (free > 0).astype(np.uint8), 8
    )

    canvas_area = float(image_bgr.shape[0] * image_bgr.shape[1])
    rooms: list[Room] = []

    for label in range(1, count):  # 0 is the wall/background label
        area = int(stats[label, cv2.CC_STAT_AREA])
        frac = area / canvas_area
        if frac < MIN_ROOM_AREA_FRAC or frac > MAX_ROOM_AREA_FRAC:
            continue

        x0 = int(stats[label, cv2.CC_STAT_LEFT])
        y0 = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])

        rooms.append(
            Room(
                id=label,
                mask=(labels == label).astype(np.uint8) * 255,
                area_px=area,
                centroid=(float(centroids[label][0]), float(centroids[label][1])),
                bbox=(x0, y0, x0 + w, y0 + h),
            )
        )

    rooms = _drop_containers(rooms)
    rooms.sort(key=lambda r: r.area_px, reverse=True)
    _classify_by_size(rooms, canvas_area, tune)
    return rooms, walls


def _drop_containers(rooms: list[Room]) -> list[Room]:
    """Discard regions that merely enclose other regions.

    An apartment plan nests: the unit envelope (TYPE-A) is a closed outline, and so is
    every bedroom inside it. Connected components finds both, and the envelope — being
    the largest — then wins every "is this a hall" test and swallows the unit whole.
    That is how a whole flat came out as one traversable room.

    A region whose bounding box contains the box of two or more *other* regions is a
    container, not a room. Two rather than one: an ensuite genuinely sits inside a
    bedroom on some plans, and that bedroom is still a room.
    """
    kept: list[Room] = []
    for room in rooms:
        x0, y0, x1, y1 = room.bbox
        enclosed = 0
        for other in rooms:
            if other is room:
                continue
            ox0, oy0, ox1, oy1 = other.bbox
            if ox0 >= x0 and oy0 >= y0 and ox1 <= x1 and oy1 <= y1:
                enclosed += 1
                if enclosed >= 2:
                    break
        if enclosed < 2:
            kept.append(room)

    if len(kept) != len(rooms):
        log.info("Dropped %d container regions (unit envelopes)", len(rooms) - len(kept))
    return kept


def _classify_by_size(
    rooms: list[Room], canvas_area: float, tuning: RoomTuning | None = None
) -> None:
    """Mark the rooms big enough to route through. Mutates ``rooms``.

    Both conditions must hold — clearly bigger than the typical room here, *and* a
    meaningful share of the plan. Either alone misfires: the multiple alone calls a
    slightly-roomier bedroom a hall on a uniform plan, and the fraction alone calls
    every room a hall on a plan that only contains four of them.
    """
    if not rooms:
        return

    tune = (tuning or RoomTuning()).clamped()
    if tune.treat_rooms_as_open:
        # Open-venue mode: nothing is a barrier, which is the correct reading of an
        # arena plan where the halls are the space rather than obstacles in it.
        for room in rooms:
            room.traversable = True
        return

    median = float(np.median([r.area_px for r in rooms]))
    for room in rooms:
        big_for_this_plan = room.area_px >= median * tune.large_room_multiple
        big_absolutely = room.area_px / canvas_area >= LARGE_ROOM_MIN_FRAC
        room.traversable = bool(big_for_this_plan and big_absolutely)


def build_circulation_mask(
    image_bgr: np.ndarray,
    rooms: list[Room],
    walls: np.ndarray,
    tuning: RoomTuning | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """The mask the skeleton should actually run on.

    Returns ``(circulation, rooms_mask)``:

    * ``circulation`` — corridors, lobbies, stair cores, plus the interior of any room
      classified traversable. This is what becomes roads.
    * ``rooms_mask`` — every detected room, traversable or not. Used to attach
      destination nodes and to keep the renderer honest about what is a room.

    Non-traversable rooms are punched out of the circulation, which is the whole fix:
    the skeleton can no longer cut a diagonal through a bedroom because, as far as the
    tracer is concerned, there is no floor there.
    """
    tune = (tuning or RoomTuning()).clamped()
    free = cv2.bitwise_not(walls)

    # Confine everything to the building before anything else looks at it.
    #
    # The margin around a plan is white, and it reaches the interior through every
    # doorway — so a flood-fill inward from the sheet edge does not stop at the
    # building line, it pours through the entrance and consumes the corridor behind
    # it. Measured on an 800px plan that took 46% of the canvas, the central spine
    # included, which is why the corridor never became road.
    #
    # Bounding the fill by the outer wall contour instead makes the leak impossible:
    # outside is outside by construction, and a doorway is a hole in a boundary rather
    # than a route to the sheet edge.
    envelope = _building_envelope(walls)
    free = cv2.bitwise_and(free, envelope)

    circulation = free.copy()
    rooms_mask = np.zeros_like(free)

    for room in rooms:
        rooms_mask = cv2.bitwise_or(rooms_mask, room.mask)
        if not room.traversable:
            circulation[room.mask > 0] = 0

    # Erase the slivers left inside a unit envelope.
    #
    # Punching the rooms out of the free space leaves the gaps *between* them — the
    # few pixels either side of a partition wall, plus the band under the unit's own
    # outline. Those slivers are contiguous and wrap right around a flat, so they form
    # a large pocket that outvotes the real corridor and the skeleton runs a ring road
    # inside somebody's apartment.
    #
    # An opening removes them by width alone: a sliver is a wall's width across, a
    # corridor is a person's. Nothing else distinguishes the two reliably — both are
    # white, both are enclosed, both touch rooms.
    circulation = cv2.morphologyEx(
        circulation,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (tune.corridor_min_px, tune.corridor_min_px)
        ),
    )

    # Rejoin a corridor severed by the rooms either side of it.
    #
    # A doorway is a gap in a wall, so punching the rooms out leaves the corridor
    # pinched to almost nothing at every door — and the opening above then cuts it
    # there, leaving several stubs where there is one continuous hallway. The result is
    # a graph that stops at the first door and an exit nothing can reach.
    #
    # Closing along each axis separately, because a corridor is long in one direction:
    # a square kernel wide enough to bridge a doorway also swells the corridor sideways
    # into the rooms it was just carved away from.
    span = max(3, tune.corridor_min_px | 1)
    bridged_h = cv2.morphologyEx(
        circulation, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (span, 1))
    )
    bridged_v = cv2.morphologyEx(
        circulation, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, span))
    )
    bridged = cv2.bitwise_or(bridged_h, bridged_v)

    # Only keep what the bridge added *between* rooms.
    #
    # A closing large enough to span a doorway also spans the wall between two rooms,
    # so applied unrestricted it floods a whole flat — the corridor came out right and
    # the bedrooms came out green with it. Masking the new pixels against everything
    # that is not a carved room keeps the join and discards the flood.
    room_block = np.zeros_like(circulation)
    for room in rooms:
        if not room.traversable:
            room_block = cv2.bitwise_or(room_block, room.mask)
    circulation = cv2.bitwise_and(bridged, cv2.bitwise_not(room_block))

    # The envelope above already excluded everything outside the building.

    # Close hairline breaks so a doorway reads as one opening rather than two nicks.
    circulation = cv2.morphologyEx(
        circulation, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    )
    cv2.rectangle(
        circulation, (0, 0), (circulation.shape[1] - 1, circulation.shape[0] - 1), 0, 3
    )
    return circulation, rooms_mask


def _building_envelope(walls: np.ndarray) -> np.ndarray:
    """Everything inside the outermost wall, as a filled mask.

    Taken as the convex hull of the largest wall contour. The hull matters: an outer
    wall drawn with doorway gaps in it is not a closed contour, and filling it directly
    leaks straight back out through those gaps — the exact failure this replaces. A
    hull closes them without needing the drawing to be watertight.

    Falls back to the whole canvas when no wall structure is found, which is the honest
    answer for a plan with no drawn envelope: better to trace the whole sheet than to
    return an empty mask and claim the building has no floor.
    """
    # Dilate before contouring. The outer wall is drawn with doorway gaps and is often
    # broken by dimension lines, so on the raw ink `RETR_EXTERNAL` returns whichever
    # closed loop it finds first — frequently an interior room — and the envelope then
    # clips the plan to one corner. Joining the wall runs first makes the outermost
    # contour actually the outermost.
    joined = cv2.dilate(
        (walls > 0).astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)),
    )
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.full(walls.shape[:2], 255, np.uint8)

    largest = max(contours, key=cv2.contourArea)
    # A contour that covers almost nothing is stray ink, not a building.
    if cv2.contourArea(largest) < 0.05 * walls.shape[0] * walls.shape[1]:
        return np.full(walls.shape[:2], 255, np.uint8)

    envelope = np.zeros(walls.shape[:2], np.uint8)
    cv2.drawContours(envelope, [cv2.convexHull(largest)], -1, 255, thickness=-1)
    # Pull in off the wall itself so the envelope's own edge is not walkable.
    return cv2.erode(envelope, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))


def _drop_border_region(mask: np.ndarray) -> np.ndarray:
    """Remove whitespace connected to the edge of the sheet.

    Flood-filling inward from the border is what distinguishes "outside the building"
    from "inside it": the margin reaches the sheet edge, every interior space does not.
    """
    h, w = mask.shape[:2]
    flood = mask.copy()
    ff_mask = np.zeros((h + 2, w + 2), np.uint8)

    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if flood[seed[1], seed[0]] > 0:
            cv2.floodFill(flood, ff_mask, seed, 0)

    return flood


def keep_main_network(mask: np.ndarray, rooms: list[Room]) -> np.ndarray:
    """The main circulation network, with disconnected fragments dropped.

    Chosen by **how many rooms it serves**, not by area. Area picks the wrong blob on
    exactly the plans this module exists for: on an apartment floor the widest pocket of
    free space is the gap inside a unit envelope, while the corridor that actually joins
    the flats to the stairs is long and thin and loses on pixel count. Selecting by area
    there returns one flat's interior and throws the building's only route away.

    Serving a room means passing within a few pixels of its edge — that is a doorway.
    Ties break on area, which restores the old behaviour for an open venue where no
    room is detected at all.
    """
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    if count <= 1:
        return mask

    # Dilate each room once so "touching the corridor" tolerates the wall between them.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

    best_label, best_key = 1, (-1, -1)
    for label in range(1, count):
        component = labels == label
        served = 0
        for room in rooms:
            if np.any(component & (cv2.dilate(room.mask, kernel) > 0)):
                served += 1
        key = (served, int(stats[label, cv2.CC_STAT_AREA]))
        if key > best_key:
            best_key, best_label = key, label

    log.info("Circulation network serves %d rooms (%d px)", best_key[0], best_key[1])
    return np.where(labels == best_label, 255, 0).astype(np.uint8)


def describe(rooms: list[Room]) -> dict:
    """Summary for the parse metadata, so an operator sees what was decided."""
    traversable = [r for r in rooms if r.traversable]
    return {
        "rooms": len(rooms),
        "traversable": len(traversable),
        "destinations": len(rooms) - len(traversable),
    }


#: Preview colours, BGR. Deliberately the same meanings the Layout Studio legend uses.
_PREVIEW_WALL = (60, 60, 60)
_PREVIEW_DESTINATION = (205, 205, 205)
_PREVIEW_TRAVERSABLE = (225, 190, 140)
_PREVIEW_CIRCULATION = (90, 220, 120)


def render_preview(
    image_bgr: np.ndarray,
    rooms: list[Room],
    walls: np.ndarray,
    circulation: np.ndarray,
) -> np.ndarray:
    """A human-readable picture of what the mask stage decided.

    This exists because the numbers do not tell an operator whether the trace is right.
    "22 nodes, 30 edges, no issues" was reported for a parse that ran corridors through
    four bedrooms and put the exit inside one — the count was fine and the map was
    nonsense. Showing which pixels became road is the only honest way to review it, and
    it is what makes the tuning sliders usable rather than guesswork.
    """
    view = np.full((*circulation.shape[:2], 3), 255, np.uint8)
    view[walls > 0] = _PREVIEW_WALL
    for room in rooms:
        view[room.mask > 0] = (
            _PREVIEW_TRAVERSABLE if room.traversable else _PREVIEW_DESTINATION
        )
    view[circulation > 0] = _PREVIEW_CIRCULATION

    # Blend the original back in faintly so the operator can still read the drawing
    # underneath and tell whether the green is following the corridor they can see.
    return cv2.addWeighted(view, 0.72, image_bgr, 0.28, 0)
