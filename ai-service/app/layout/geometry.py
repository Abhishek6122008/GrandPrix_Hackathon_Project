"""Geometry stage — turn an image plus semantic hints into a walkable mask.

Everything here is CPU OpenCV/NumPy. It runs after the VLM has been unloaded, so it
has the whole machine and none of the VRAM budget.

The output contract is a single binary mask, ``255 = walkable, 0 = blocked``. That mask
is the only thing the skeleton stage sees, which keeps the "AI names things, algorithms
measure things" split honest: nothing the VLM said reaches the graph except through a
region that survived here.

Floor plans vary wildly, so walkability is decided by voting across three cheap cues
rather than one clever one:

1. **Ink density** — plans are light with dark line-work. Large light regions bounded
   by dark lines are usually floor.
2. **Morphological opening** — removes text, hatching and furniture stipple that would
   otherwise fragment the floor into confetti.
3. **Semantic carving** — obstacle/restricted/stage boxes from the VLM are punched out,
   and zone boxes are protected from being eroded away.

Then the largest connected component wins. A plan's floor is contiguous; anything
disconnected from it is a legend, a title block or a neighbouring building.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from app.layout.schemas import NON_WALKABLE_KINDS, Canvas, SemanticLayout

log = logging.getLogger(__name__)

#: Long edge the plan is normalised to. Large enough that a 1-pixel corridor line
#: survives, small enough that skeletonize stays well under a second.
TARGET_LONG_EDGE = 1600

#: Opening kernel, in pixels at TARGET_LONG_EDGE. Sized to swallow ~10pt label text
#: without eating a genuine doorway gap.
OPEN_KERNEL = 5
CLOSE_KERNEL = 9


#: Below this, a plan is upscaled before anything measures it. Every kernel in this
#: package is expressed in pixels at TARGET_LONG_EDGE, so a small image is not merely
#: lower quality — it is measured with the wrong ruler. On a 400px plan the corridor
#: opening kernel is nearly 4% of the image and erases the corridor it was meant to
#: clean, which is why small screenshots traced to nothing.
MIN_LONG_EDGE = 1100


def normalise(image_bgr: np.ndarray) -> tuple[np.ndarray, Canvas, float]:
    """Resize the plan so the long edge lands in the band the kernels assume.

    Returns ``(image, canvas, scale)``; ``scale`` maps original pixels → normalised
    pixels, so a caller can put VLM hints produced at a different resolution into the
    same frame.

    Both directions matter. Shrinking a huge scan keeps skeletonisation affordable;
    **enlarging** a small one is what makes a phone screenshot or a low-resolution
    export traceable at all.
    """
    h, w = image_bgr.shape[:2]
    long_edge = max(h, w)
    if long_edge <= 0:
        return image_bgr, Canvas(width=w, height=h), 1.0

    if long_edge > TARGET_LONG_EDGE:
        scale = TARGET_LONG_EDGE / float(long_edge)
        # Area interpolation preserves thin dark lines better than linear when shrinking.
        interpolation = cv2.INTER_AREA
    elif long_edge < MIN_LONG_EDGE:
        scale = MIN_LONG_EDGE / float(long_edge)
        # Cubic keeps wall edges crisp going up. Nearest would give them a staircase
        # the wall-run opening then reads as broken line-work; linear blurs them below
        # the adaptive threshold and the walls vanish.
        interpolation = cv2.INTER_CUBIC
    else:
        return image_bgr, Canvas(width=w, height=h), 1.0

    image_bgr = cv2.resize(image_bgr, None, fx=scale, fy=scale, interpolation=interpolation)
    h, w = image_bgr.shape[:2]
    return image_bgr, Canvas(width=w, height=h), scale


def _binarise(gray: np.ndarray) -> np.ndarray:
    """Dark line-work → 255, background → 0.

    Adaptive thresholding rather than Otsu: scanned plans have uneven exposure and a
    global threshold loses the light half of the drawing entirely.
    """
    gray = cv2.bilateralFilter(gray, 7, 60, 60)  # denoise, keep edges crisp
    ink = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 8
    )
    return ink


def _largest_component(mask: np.ndarray) -> np.ndarray:
    """Keep only the biggest blob. The floor of a plan is contiguous; legends are not."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    if count <= 1:
        return mask
    # Row 0 is background.
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == largest, 255, 0).astype(np.uint8)


def build_walkable_mask(
    image_bgr: np.ndarray,
    semantic: SemanticLayout,
    *,
    keep_largest: bool = True,
) -> np.ndarray:
    """Produce the binary walkable mask. ``255`` walkable, ``0`` blocked.

    Args:
        image_bgr: normalised plan, BGR.
        semantic: VLM hints. Safe to pass a degraded/empty layout — the mask is then
            derived from image structure alone, which is the whole point of doing the
            geometry classically.
        keep_largest: drop everything not connected to the main floor. Turn this off
            for multi-building campuses where disconnected areas are legitimate.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    ink = _binarise(gray)

    # Free space is everything that is not ink.
    free = cv2.bitwise_not(ink)

    # Opening kills text and stipple; closing seals hairline gaps in wall runs so the
    # floor doesn't leak into the surrounding whitespace through a 1px crack.
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (OPEN_KERNEL, OPEN_KERNEL))
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_KERNEL, CLOSE_KERNEL))
    free = cv2.morphologyEx(free, cv2.MORPH_OPEN, k_open, iterations=1)
    walkable = cv2.morphologyEx(free, cv2.MORPH_CLOSE, k_close, iterations=1)

    # Protect zones the VLM named as walkable — morphology sometimes erodes a lightly
    # drawn hall down to nothing.
    for zone in semantic.zones:
        if zone.type in NON_WALKABLE_KINDS:
            continue
        x0, y0, x1, y1 = (int(round(v)) for v in zone.bbox)
        if x1 <= x0 or y1 <= y0:
            continue
        patch = walkable[y0:y1, x0:x1]
        if patch.size and float(np.count_nonzero(patch)) / patch.size < 0.15:
            # Almost nothing survived here but the VLM says it is a room. Restore the
            # interior, inset so we don't punch through its own walls.
            inset = 4
            walkable[y0 + inset : y1 - inset, x0 + inset : x1 - inset] = 255

    if keep_largest:
        walkable = _largest_component(walkable)

    # Carve obstacles last so nothing above can put them back.
    for obs in [*semantic.obstacles, *(z for z in semantic.zones if z.type in NON_WALKABLE_KINDS)]:
        x0, y0, x1, y1 = (int(round(v)) for v in obs.bbox)
        cv2.rectangle(walkable, (x0, y0), (x1, y1), 0, thickness=-1)

    # Hard border — stops the skeleton from running around the outside of the plan.
    cv2.rectangle(walkable, (0, 0), (walkable.shape[1] - 1, walkable.shape[0] - 1), 0, thickness=3)

    return walkable


def walkable_ratio(mask: np.ndarray) -> float:
    """Fraction of the canvas that is walkable. A sanity signal for confidence scoring.

    Note the expected range is wide. CAD-style line drawings are legitimately 90%+
    walkable — thin wall strokes on a white floor. Only the extremes indicate failure:
    below ~0.05 thresholding ate the floor; above ~0.99 no walls were detected at all.
    """
    return float(np.count_nonzero(mask)) / float(mask.size)


def distance_field(mask: np.ndarray) -> np.ndarray:
    """Euclidean distance from every walkable pixel to the nearest wall.

    Used later to give edges a real ``width`` in metres instead of a constant: the
    distance value at a skeleton pixel is half the local corridor width, which is
    exactly what the simulation's throughput cap needs.
    """
    return cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
