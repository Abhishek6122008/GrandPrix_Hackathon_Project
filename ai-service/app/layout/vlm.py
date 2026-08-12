"""Semantic understanding stage — Qwen2.5-VL-3B-Instruct.

The model is loaded on demand, used once per uploaded image, and unloaded before the
geometry stage runs. On a 4 GB card that ordering is not an optimisation, it is the
difference between working and OOM: OpenCV needs no VRAM, so holding the VLM through
the rest of the pipeline buys nothing and costs the whole budget.

Design rules enforced here:

* One inference per upload. Never per node, per zone or per edge.
* Strict JSON out, parsed defensively — a VLM that returns prose is a soft failure,
  not an exception.
* The model never produces geometry. It names things; ``geometry.py`` measures them.
* Import of torch/transformers happens inside the load function, so a machine without
  them still runs the pipeline in fallback mode.

If ``LAYOUT_VLM_ENABLED`` is false or the model cannot be loaded, callers get a
``SemanticLayout`` with ``degraded=True`` and empty hints. The CV stage handles that
case on its own and the UI tells the operator to verify the result.
"""

from __future__ import annotations

import gc
import json
import logging
import os
import re
import time
from typing import Any

from app.layout.schemas import (
    Canvas,
    SemanticLayout,
    SemanticPoint,
    SemanticZone,
    ZoneKind,
)

log = logging.getLogger(__name__)

MODEL_ID = os.getenv("LAYOUT_VLM_MODEL", "Qwen/Qwen2.5-VL-3B-Instruct")
VLM_ENABLED = os.getenv("LAYOUT_VLM_ENABLED", "true").lower() not in {"0", "false", "no"}
#: 4-bit keeps a 3B VLM near ~2.2 GB, leaving headroom on a 3050. Set false only if
#: bitsandbytes is unavailable — fp16 will need ~6 GB and will not fit.
VLM_4BIT = os.getenv("LAYOUT_VLM_4BIT", "true").lower() not in {"0", "false", "no"}
#: Long edge the image is resized to before inference. Bigger costs VRAM quadratically
#: through the vision tower for very little semantic gain on floor plans.
VLM_MAX_EDGE = int(os.getenv("LAYOUT_VLM_MAX_EDGE", "896"))

_PROMPT = """You are reading a 2D venue floor plan. Identify what is in it.

Return ONLY a JSON object, no prose, no markdown fences, matching this shape:

{
  "venue_type": "<event_venue|stadium|exhibition_hall|mall|campus|airport|convention_center|other>",
  "entrances": [{"id": "entrance_1", "location": [x, y], "label": "<text on plan or null>"}],
  "exits":     [{"id": "exit_1", "location": [x, y], "label": null}],
  "zones":     [{"id": "zone_1", "type": "<hall|room|corridor|food_court|retail|seating|open_area>",
                 "bbox": [x_min, y_min, x_max, y_max], "label": "<text or null>"}],
  "obstacles": [{"id": "obstacle_1", "type": "<obstacle|restricted|stage>",
                 "bbox": [x_min, y_min, x_max, y_max], "label": null}]
}

Rules:
- Coordinates are pixels in the image you were given, origin top-left.
- Approximate boxes are fine. Do not guess corridors you cannot see.
- Do not invent paths, roads or connections between zones. Only report regions.
- If you cannot find any entrance, return an empty list rather than a guess.
- Read labels printed on the plan when legible and put them in "label".
"""


def _extract_json(text: str) -> dict[str, Any] | None:
    """Pull the first JSON object out of a model response.

    Handles the three things Qwen actually does: clean JSON, JSON in ```json fences,
    and JSON preceded by a sentence of explanation. Returns None if nothing parses —
    the caller degrades rather than raising.
    """
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    if start == -1:
        return None
    # Walk braces so a trailing sentence after the object doesn't break parsing.
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _coerce_zone(raw: dict[str, Any], idx: int, prefix: str) -> SemanticZone | None:
    """Best-effort convert one raw dict into a SemanticZone, or drop it."""
    bbox = raw.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return None
    # Models occasionally emit the corners in the wrong order.
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    try:
        kind = ZoneKind(str(raw.get("type", "unknown")).lower())
    except ValueError:
        kind = ZoneKind.UNKNOWN
    return SemanticZone(
        id=str(raw.get("id") or f"{prefix}_{idx}"),
        type=kind,
        bbox=(x0, y0, x1, y1),
        label=raw.get("label") or None,
        confidence=float(raw.get("confidence", 0.6)),
    )


def _coerce_point(raw: dict[str, Any], idx: int, prefix: str) -> SemanticPoint | None:
    loc = raw.get("location")
    if not isinstance(loc, (list, tuple)) or len(loc) != 2:
        return None
    try:
        x, y = float(loc[0]), float(loc[1])
    except (TypeError, ValueError):
        return None
    return SemanticPoint(
        id=str(raw.get("id") or f"{prefix}_{idx}"),
        location=(x, y),
        label=raw.get("label") or None,
        confidence=float(raw.get("confidence", 0.6)),
    )


def parse_semantic_json(payload: dict[str, Any], canvas: Canvas) -> SemanticLayout:
    """Turn a raw model dict into a validated SemanticLayout, dropping junk entries.

    Pure and side-effect free so it can be unit-tested against recorded model output
    without a GPU. See ``tests/test_layout_vlm_parsing.py``.
    """
    zones = [
        z
        for i, raw in enumerate(payload.get("zones") or [])
        if isinstance(raw, dict) and (z := _coerce_zone(raw, i, "zone")) is not None
    ]
    obstacles = [
        z
        for i, raw in enumerate(payload.get("obstacles") or [])
        if isinstance(raw, dict) and (z := _coerce_zone(raw, i, "obstacle")) is not None
    ]
    entrances = [
        p
        for i, raw in enumerate(payload.get("entrances") or [])
        if isinstance(raw, dict) and (p := _coerce_point(raw, i, "entrance")) is not None
    ]
    exits = [
        p
        for i, raw in enumerate(payload.get("exits") or [])
        if isinstance(raw, dict) and (p := _coerce_point(raw, i, "exit")) is not None
    ]

    # Clamp everything into the canvas — models drift outside it on tall plans.
    def _clamp_zone(z: SemanticZone) -> SemanticZone:
        x0, y0, x1, y1 = z.bbox
        z.bbox = (
            max(0.0, min(x0, canvas.width)),
            max(0.0, min(y0, canvas.height)),
            max(0.0, min(x1, canvas.width)),
            max(0.0, min(y1, canvas.height)),
        )
        return z

    return SemanticLayout(
        venue_type=str(payload.get("venue_type", "unknown")),
        canvas=canvas,
        entrances=entrances,
        exits=exits,
        zones=[_clamp_zone(z) for z in zones],
        obstacles=[_clamp_zone(z) for z in obstacles],
        notes=payload.get("notes"),
        degraded=False,
    )


class VlmSession:
    """Load → infer → unload, as a context manager.

    Usage::

        with VlmSession() as vlm:
            semantic = vlm.describe(image_bgr)
        # VRAM is already released here, before OpenCV starts.

    Never hold this open across the geometry stage.
    """

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._torch = None
        self.loaded = False
        self.model_id = MODEL_ID

    def __enter__(self) -> VlmSession:
        if VLM_ENABLED:
            self._load()
        return self

    def __exit__(self, *exc: object) -> None:
        self.unload()

    def _load(self) -> None:
        try:
            import torch
            from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration
        except ImportError:
            log.warning(
                "torch/transformers not installed — layout parsing will run CV-only. "
                "Install ai-service/requirements-layout.txt to enable the VLM."
            )
            return

        self._torch = torch
        kwargs: dict[str, Any] = {"torch_dtype": torch.float16, "device_map": "auto"}

        if VLM_4BIT:
            try:
                from transformers import BitsAndBytesConfig

                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                )
            except ImportError:
                log.warning("bitsandbytes missing — falling back to fp16, needs ~6GB VRAM.")

        try:
            t0 = time.perf_counter()
            self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(MODEL_ID, **kwargs)
            self._processor = AutoProcessor.from_pretrained(MODEL_ID)
            self._model.eval()
            self.loaded = True
            log.info("Loaded %s in %.1fs", MODEL_ID, time.perf_counter() - t0)
        except Exception:
            log.exception("VLM load failed — continuing CV-only.")
            self._model = self._processor = None

    def unload(self) -> None:
        """Drop references and empty the CUDA cache.

        Without ``empty_cache`` the allocator keeps the arena reserved and a second
        upload in the same process will OOM even though Python freed the model.
        """
        if self._model is None and self._processor is None:
            return
        self._model = None
        self._processor = None
        self.loaded = False
        gc.collect()
        if self._torch is not None and self._torch.cuda.is_available():
            self._torch.cuda.empty_cache()
            self._torch.cuda.ipc_collect()
        log.info("VLM unloaded, VRAM released.")

    def describe(self, image_rgb, canvas: Canvas) -> SemanticLayout:
        """One inference. Returns a degraded layout rather than raising on any failure."""
        if not self.loaded or self._model is None:
            return SemanticLayout(canvas=canvas, degraded=True)

        try:
            from PIL import Image

            pil = Image.fromarray(image_rgb)
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": pil},
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ]
            text = self._processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = self._processor(text=[text], images=[pil], return_tensors="pt")
            inputs = inputs.to(self._model.device)

            with self._torch.inference_mode():
                out = self._model.generate(
                    **inputs,
                    max_new_tokens=1024,
                    do_sample=False,  # deterministic: same plan → same hints
                )
            trimmed = out[:, inputs["input_ids"].shape[1] :]
            raw = self._processor.batch_decode(trimmed, skip_special_tokens=True)[0]

            payload = _extract_json(raw)
            if payload is None:
                log.warning("VLM returned unparseable output; degrading to CV-only.")
                return SemanticLayout(canvas=canvas, degraded=True)
            return parse_semantic_json(payload, canvas)

        except Exception:
            log.exception("VLM inference failed — degrading to CV-only.")
            return SemanticLayout(canvas=canvas, degraded=True)
