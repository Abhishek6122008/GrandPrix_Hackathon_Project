"""Reading the words printed on a floor plan, and turning them into zone semantics.

A plan already says what each space is — "M.BED", "LIFT LOBBY", "EXIT", "FOOD COURT".
Geometry alone can only report that a region exists; the label is what says whether it
is somewhere people sit, queue, or leave through. Without it every traced node is an
anonymous ``junction-17`` and the operator has to name the whole building by hand.

This is deliberately *not* the VLM. Qwen2.5-VL needs ~2.2GB of VRAM and a torch install
to guess at the same words that are printed in the image in plain text. RapidOCR reads
them directly, on CPU, in about a second and a half, with no GPU and no model download
at request time — and it is right rather than plausible, which for a safety tool is the
distinction that matters. The VLM stage remains for plans whose meaning is genuinely
pictorial; this runs first and handles the common case.

Output feeds ``SemanticLayout``, the same hint structure the VLM produces, so nothing
downstream needs to know which one supplied it.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import numpy as np

from app.layout.schemas import Canvas, SemanticLayout, SemanticZone, ZoneKind

log = logging.getLogger(__name__)

#: Loaded once and reused. Construction reads several ONNX models off disk, which is
#: slow enough that doing it per request would dominate the parse.
_ENGINE = None
_ENGINE_FAILED = False


def _engine():
    """The OCR engine, or None when RapidOCR is not installed.

    Absence is an expected state, not an error: the layout extras are optional, and a
    plan with no readable labels still traces geometrically. Callers degrade rather
    than fail.
    """
    global _ENGINE, _ENGINE_FAILED
    if _ENGINE is not None or _ENGINE_FAILED:
        return _ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR

        _ENGINE = RapidOCR()
        log.info("OCR engine ready (rapidocr-onnxruntime)")
    except Exception as exc:  # pragma: no cover - depends on what is installed
        _ENGINE_FAILED = True
        log.warning("OCR unavailable (%s); plans will trace without labels", exc)
    return _ENGINE


@dataclass
class Label:
    """One piece of text read off the plan, with where it sits."""

    text: str
    x: float
    y: float
    confidence: float

    @property
    def normalised(self) -> str:
        """Upper case, punctuation folded to spaces — what the keyword tables match on."""
        return re.sub(r"[^A-Z0-9 ]+", " ", self.text.upper()).strip()


# --------------------------------------------------------------------------- #
#  Label → meaning                                                             #
# --------------------------------------------------------------------------- #

#: Ordered most-specific first. "FIRE EXIT" must beat "EXIT", and "EXIT" must not be
#: found inside "EXHIBITION" — hence word-boundary matching in `_classify`.
#:
#: Each entry maps a set of printed words to the zone kind the simulation understands.
#: The vocabulary is drawn from residential, commercial and venue plans, because the
#: same tool is pointed at an apartment floor and a stadium concourse.
_KEYWORDS: list[tuple[ZoneKind, tuple[str, ...]]] = [
    (ZoneKind.EXIT, (
        "FIRE EXIT", "EMERGENCY EXIT", "EXIT", "EGRESS", "WAY OUT",
    )),
    (ZoneKind.ENTRANCE, (
        "MAIN ENTRANCE", "ENTRANCE", "ENTRY", "GATE", "RECEPTION", "FOYER",
        "VESTIBULE", "PORCH",
    )),
    (ZoneKind.CORRIDOR, (
        "LIFT LOBBY", "LOBBY", "CORRIDOR", "PASSAGE", "HALLWAY", "WALKWAY",
        "CONCOURSE", "STAIR", "STAIRS", "STAIRCASE", "LIFT", "ELEVATOR",
        "ESCALATOR", "RAMP", "AISLE", "LANDING", "VERANDAH", "BALCONY",
    )),
    (ZoneKind.FOOD_COURT, (
        "FOOD COURT", "CONCESSION", "CAFE", "CAFETERIA", "CANTEEN",
        "RESTAURANT", "BAR", "PANTRY", "KITCHEN", "DINING",
    )),
    (ZoneKind.RETAIL, (
        "KIOSK", "SHOP", "STORE", "MERCH", "RETAIL",
    )),
    (ZoneKind.SEATING, (
        "AUDITORIUM", "SEATING", "STAND", "GALLERY", "TRIBUNE", "STALLS",
        "DRAWING", "LIVING", "LOUNGE", "WAITING", "BEDROOM", "BED",
        "OFFICE", "CABIN", "MEETING", "CONFERENCE", "CLASSROOM", "WARD",
    )),
    (ZoneKind.HALL, (
        "HALL", "BANQUET", "BALLROOM", "ATRIUM",
    )),
    # No FACILITY kind in the schema: a toilet is somewhere people go and dwell, which
    # is a room as far as the simulation is concerned.
    (ZoneKind.ROOM, (
        "TOILET", "WC", "RESTROOM", "WASHROOM", "BATHROOM", "LAVATORY",
        "WATER", "DRINKING", "FIRST AID", "MEDICAL", "NURSE", "BABY",
    )),
    (ZoneKind.STAGE, (
        "STAGE", "PODIUM", "DAIS",
    )),
    (ZoneKind.OBSTACLE, (
        "PLANT ROOM", "SERVICE", "STORAGE", "STORE ROOM", "DUCT",
        "SHAFT", "MACHINE", "ELECTRICAL", "SUBSTATION",
    )),
]

#: Abbreviations that appear on residential plans without a full word to match.
#: Matched exactly rather than by substring: "M.BED" is a bedroom, but a bare "B" is not.
_ABBREVIATIONS: dict[str, ZoneKind] = {
    "M BED": ZoneKind.SEATING,
    "G BED": ZoneKind.SEATING,
    "C BED": ZoneKind.SEATING,
    "MBR": ZoneKind.SEATING,
    "BR": ZoneKind.SEATING,
    "WC": ZoneKind.ROOM,
    "TLT": ZoneKind.ROOM,
    "KIT": ZoneKind.FOOD_COURT,
    "VER": ZoneKind.CORRIDOR,   # verandah
    "BAL": ZoneKind.CORRIDOR,
    "COR": ZoneKind.CORRIDOR,
    "LOB": ZoneKind.CORRIDOR,
}


def _classify(label: Label) -> ZoneKind | None:
    """The zone kind a label implies, or None when the text means nothing to us.

    Returning None matters: a dimension string like "12'-6\"" or a drawing title is
    text on the plan that is not a room, and inventing a zone for it would put a node
    in the middle of a wall.
    """
    text = label.normalised
    if not text:
        return None

    if text in _ABBREVIATIONS:
        return _ABBREVIATIONS[text]

    # Pure dimensions/numbers are never room names.
    if not re.search(r"[A-Z]{2,}", text):
        return None

    for kind, words in _KEYWORDS:
        for word in words:
            # Word-boundary match so EXIT does not fire inside EXHIBITION.
            if re.search(rf"(?<![A-Z]){re.escape(word)}(?![A-Z])", text):
                return kind
    return None


def read_labels(image_bgr: np.ndarray, min_confidence: float = 0.5) -> list[Label]:
    """Every legible word on the plan, with its centre in image pixels.

    Returns an empty list when OCR is unavailable or the plan carries no text, which
    both mean the same thing downstream: trace it geometrically.
    """
    engine = _engine()
    if engine is None:
        return []

    try:
        result, _elapsed = engine(image_bgr)
    except Exception as exc:  # pragma: no cover - engine-internal failures
        log.warning("OCR failed on this plan (%s); continuing without labels", exc)
        return []

    labels: list[Label] = []
    for box, text, confidence in result or []:
        if confidence < min_confidence:
            continue
        cleaned = str(text).strip()
        if not cleaned:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        labels.append(
            Label(
                text=cleaned,
                x=sum(xs) / len(xs),
                y=sum(ys) / len(ys),
                confidence=float(confidence),
            )
        )
    return labels


def semantic_from_labels(
    labels: list[Label],
    rooms: list,  # list[rooms.Room], untyped to avoid a circular import
    canvas: Canvas,
) -> SemanticLayout:
    """Attach labels to the rooms they sit inside, producing VLM-shaped hints.

    A label is claimed by the room containing its centre. Containment rather than
    nearest-centroid, deliberately: "KITCHEN" printed near the edge of a small room is
    closer to the neighbouring hall's centre than to its own, and nearest-match hands
    the name to the wrong room. Labels landing in no room — a title block, a corridor
    annotation — are kept as zones in their own right so the corridor still gets named.
    """
    zones: list[SemanticZone] = []
    used: set[int] = set()

    for label in labels:
        kind = _classify(label)
        if kind is None:
            continue

        owner = None
        for index, room in enumerate(rooms):
            x0, y0, x1, y1 = room.bbox
            if x0 <= label.x <= x1 and y0 <= label.y <= y1 and index not in used:
                # Prefer the smallest containing room: on a nested plan the unit
                # envelope also contains the label, and the bedroom is the answer.
                if owner is None or room.area_px < rooms[owner].area_px:
                    owner = index

        if owner is not None:
            used.add(owner)
            x0, y0, x1, y1 = rooms[owner].bbox
        else:
            # No room around it — give the label a small box of its own so the graph
            # stage can still anchor a node near it.
            span = max(canvas.width, canvas.height) * 0.03
            x0, y0 = label.x - span, label.y - span
            x1, y1 = label.x + span, label.y + span

        zones.append(
            SemanticZone(
                id=f"ocr-{len(zones) + 1}",
                label=label.text,
                type=kind,
                bbox=(
                    max(0.0, x0), max(0.0, y0),
                    min(float(canvas.width), x1), min(float(canvas.height), y1),
                ),
                confidence=label.confidence,
            )
        )

    # Obstacles travel in their own list — the geometry stage carves those out rather
    # than treating them as places to walk.
    obstacles = [z for z in zones if z.type in {ZoneKind.OBSTACLE, ZoneKind.STAGE}]
    walkable = [z for z in zones if z not in obstacles]

    log.info("OCR named %d zones from %d labels", len(zones), len(labels))
    return SemanticLayout(
        canvas=canvas,
        zones=walkable,
        obstacles=obstacles,
        # Not degraded: the plan was genuinely read, just not by a vision model. Marking
        # this degraded would put a "check everything" banner on the most reliable path
        # the pipeline has.
        degraded=not zones,
        notes=f"{len(zones)} zones named by OCR" if zones else None,
    )
