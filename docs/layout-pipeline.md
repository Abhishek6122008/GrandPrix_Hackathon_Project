# Layout → Graph pipeline

Converts an uploaded 2D venue plan into a simulation-ready venue graph, and feeds that
graph into the crowd simulation that already exists.

**The graph is the source of truth.** No PNG, no rendered map, no model output is
canonical — only `VenueGraph`. Everything downstream (frontend map, Dijkstra routing,
density, GNN risk, advisory) reads that one object.

---

## Where the files go

```
ai-service/
  app/layout/
    __init__.py
    schemas.py      # SemanticLayout (hints) + VenueGraph (canonical)
    vlm.py          # Qwen2.5-VL-3B: load → infer → unload
    geometry.py     # OpenCV walkable mask, distance field
    graph.py        # skeletonize → junctions → edges → VenueGraph
    validate.py     # Phase 6 checks + deterministic repair
    pipeline.py     # orchestrator, cache, concurrency lock
  app/routers/layout.py
  requirements-layout.txt
  .env.layout.example
  tests/test_layout_pipeline.py

frontend/src/LayoutStudio.jsx
docs/layout-studio-handoff.md
```

Register the router in `ai-service/app/main.py`:

```python
from app.routers import advisory, analyze, risk, layout   # add layout

app.include_router(layout.router)
```

That one line is the only change to an existing file.

---

## Install

```bash
cd ai-service
pip install -r requirements.txt
pip install -r requirements-layout.txt      # CV stack: opencv, numpy, scikit-image
```

The CV stack alone gives you a working pipeline — CV-only mode, no GPU, ~2s per plan.
For semantic understanding, uncomment the VLM block in `requirements-layout.txt`:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install transformers>=4.49 accelerate bitsandbytes qwen-vl-utils
```

Then `cp .env.layout.example .env` and set `LAYOUT_VLM_ENABLED=true`.

**The core service still has zero heavy dependencies.** `/analyze`, `/predict/risk` and
`/generate/advisory` keep working whether or not any of this is installed — if the
layout deps are missing, only the layout endpoints degrade.

---

## The 4GB VRAM constraint

This is the design driver, not an afterthought.

```
Upload → normalise → [ load VLM → infer → UNLOAD ] → OpenCV → skeleton → graph → validate
                     └──── the only VRAM window ────┘
```

- **Structural, not disciplined.** `with VlmSession() as vlm:` closes before the geometry
  stage. Relying on remembering to call `unload()` fails on the *second* upload, which
  is the worst thing to debug during a demo.
- **4-bit by default.** Qwen2.5-VL-3B at nf4 sits near 2.2GB. fp16 needs ~6GB and will
  not fit — `LAYOUT_VLM_4BIT=false` is for machines with headroom, not for the 3050.
- **896px long edge.** The vision tower's cost grows quadratically with resolution and
  floor plans gain little semantic detail past this.
- **`empty_cache()` + `ipc_collect()` on unload.** Without them the allocator keeps the
  arena reserved and upload #2 OOMs even though Python freed the model.
- **One parse at a time.** A module-level lock serialises requests. Two concurrent
  uploads would both try to load the model. Queueing is slower; OOM is broken.
- **One inference per upload.** Never per node, per zone or per edge.

Measured on the synthetic test plan, CV-only (no GPU):

| Stage | Time |
|---|---|
| normalise | 72ms |
| geometry | 246ms |
| skeleton | 1508ms |
| graph | 137ms |
| validate | 1ms |

Skeletonization dominates. If it becomes a problem, drop `TARGET_LONG_EDGE` in
`geometry.py` from 1600 — it scales roughly with pixel count.

---

## Division of labour

| AI does | Algorithms do |
|---|---|
| Recognise entrances, exits, halls, obstacles | All geometry |
| Read labels printed on the plan | Walkable mask, skeleton, junctions |
| Assign semantic categories | Edge lengths and widths |
| Interpret ambiguous drawings | Routing, connectivity, validation |

The VLM is explicitly instructed **not** to invent paths or connections. Its coordinates
are hints; a zone the CV stage can't corroborate never reaches the graph. That's what
makes the output deterministic: same plan, same graph, every time.

---

## API

### `POST /layout/parse`

`multipart/form-data`: `layout` (file, required), `venue_name`, `metres_per_px`,
`use_vlm`.

```json
{
  "layout_id": "37cda72412bc",
  "venue": { "id": "venue-37cda72412bc", "name": "...", "nodes": [...], "edges": [...] },
  "semantic": { "venue_type": "...", "zones": [...], "degraded": false },
  "metadata": {
    "confidence": 0.72,
    "vlm_used": true,
    "issues": [{ "severity": "error", "code": "no_exit", "message": "..." }],
    "repairs": ["Merged 129 skeleton branch points into 38 intersections."],
    "timings_ms": { "vlm_ms": 8100, "skeleton_ms": 1508 }
  }
}
```

`venue` serialises with `from`, not `from_` — it drops straight into Spring's
`POST /venues` with no adapter. There's a test pinning that.

### `GET /layout/{layout_id}`
Re-fetch without re-parsing. In-memory, 32-entry LRU, cleared on restart.

### `PUT /layout/{layout_id}/confirm`
Operator's edited graph in; re-validated server-side; returns `ready`. **The client's
graph is never trusted** — an operator can disconnect a gate just as easily as the
pipeline can.

---

## Validation and repair (Phase 6)

Deterministic only. No model is consulted to fix a model's mistake.

| Check | Repair |
|---|---|
| Self-loops, dangling edges | Dropped |
| `length`/`width` ≤ 0 | Clamped to 0.5m / 0.8m |
| Isolated node | Edge to nearest neighbour, reported |
| No GATE | Promote perimeter node, reported |
| No EXIT | Promote perimeter node **biased away from gates** |
| GATE can't reach EXIT | **Not repaired** — reported as an error, blocks simulation |

That last row matters. Auto-connecting a gate to an exit would produce a corridor that
doesn't exist in the building and a simulation that evacuates through a wall. Better to
show the gap and make someone look at it.

Every repair is surfaced in the UI. The operator always sees what the pipeline decided
on its own.

---

## Two bugs testing caught

Both are pinned by regression tests now.

**Inferred exit landed next to the inferred entrance.** The perimeter picker returned
the same corner twice (gate and exit both at y=89). An exit beside the entrance makes
the whole simulation meaningless — everyone leaves through the door they came in.
`_perimeter_candidate` now scores separation from existing gates. Post-fix the two sit
916px apart on a 1200px-wide plan, and `test_inferred_exit_is_not_adjacent_to_inferred_gate`
asserts >25% of the diagonal.

**Confidence scoring was calibrated for the wrong kind of plan.** The band assumed
15–70% of a plan is walkable. CAD-style line drawings — thin black strokes on white
floor — are legitimately 98%+ walkable, so correct extraction of the most common input
was being scored as failure. The band is now 12–98.5%, with only the true extremes
(no floor found, or no walls found) penalised.

---

## Integration with the existing simulation

```
LayoutStudio → POST /layout/parse → operator verifies → PUT confirm
    → POST /venues (Spring)   ← unchanged, existing endpoint
    → POST /sessions          ← unchanged
    → tick loop → DensityDetector → RerouteEngine → /analyze → advisory
```

Nothing in `SimulationEngine`, `RerouteEngine`, `DensityDetector` or `VenueValidator`
changes. The pipeline produces the same `Venue` shape as `sampleVenue.json`; the
simulation cannot tell the difference between a hand-authored venue and a parsed one,
which is the entire point.

**Capacity is the one thing worth reviewing by hand.** Defaults come from
`DEFAULT_CAPACITY` by node type and have no relationship to the real room — a parsed
20m² store and a 2000-seat hall both start at their type default. Congestion thresholds
are ratios against capacity, so a wrong capacity produces a confidently wrong
simulation. The node inspector exists for this.

---

## Not built

- **SAM2 segmentation.** The brief makes it conditional on classical CV proving
  insufficient. On the plans tested, morphology + connected components was enough, and
  adding a second model to the VRAM budget needs evidence first.
- **Real scale detection.** `metres_per_px` defaults to 0.05. Dijkstra uses ratios, so
  routes are correct regardless, but absolute distances and throughput are only as good
  as that constant. Reading a scale bar off the plan is the obvious next step.
- **Keyboard editing on the map.** See the accessibility gap in the handoff doc.
