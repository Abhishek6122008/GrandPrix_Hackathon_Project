# API Contract

Base URL: `http://localhost:8080` (override with `VITE_API_BASE_URL`).
All request and response bodies are JSON. Validation failures return **400**; unknown ids
return **404**.

---

## `POST /venues`

Uploads a venue layout. `id` is optional — one is generated when omitted.

**Request**
```json
{
  "id": "venue-sample",
  "name": "Grandprix Arena — North Wing",
  "nodes": [
    { "id": "gate-a", "name": "Gate A", "type": "GATE", "capacity": 320, "x": 60, "y": 120 }
  ],
  "edges": [
    { "from": "gate-a", "to": "walk-north", "length": 25, "width": 6, "bidirectional": true }
  ]
}
```

`type` is one of `GATE`, `WALKWAY`, `CONCESSION`, `SEATING`, `EXIT`.
`capacity` ≥ 1, `length` and `width` > 0, `nodes` and `edges` non-empty.

**201** — the stored venue, same shape, `id` populated.

---

## `GET /venues/{id}`

**200** — the venue as above. **404** if unknown.

---

## `POST /simulations`

Starts a run. It begins ticking immediately at `simulation.tick-interval-ms`.
With `rerouteEnabled: true` a hidden no-intervention twin starts too, so the summary has a
real before/after.

**Request**
```json
{ "venueId": "venue-sample", "crowdSize": 4000, "ticks": 60, "arrivalRate": 120, "rerouteEnabled": true }
```

`crowdSize` 1–500000, `ticks` 1–2000, `arrivalRate` ≥ 1.

**201**
```json
{ "id": "sim-3f9a2b41", "venueId": "venue-sample", "crowdSize": 4000, "totalTicks": 60, "status": "RUNNING" }
```

`status` is `RUNNING` or `COMPLETED`.

---

## `GET /simulations/{id}/state?t=`

Node densities at tick `t`. Omit `t` for the live tick; out-of-range values return the live
snapshot.

**200**
```json
{
  "simulationId": "sim-3f9a2b41",
  "venueId": "venue-sample",
  "tick": 12,
  "totalTicks": 60,
  "status": "RUNNING",
  "nodes": [
    { "nodeId": "gate-a", "occupancy": 290, "capacity": 320, "density": 0.91, "status": "CRITICAL" }
  ]
}
```

`status` per node is `OK`, `WARNING` (≥ 0.70) or `CRITICAL` (≥ 0.85), thresholds from
`application.yml`.

---

## `WS /simulations/{id}/stream`

Pushes exactly the `GET /state` payload above, once per tick. The current frame is sent
immediately on connect, so the map is never blank. No client → server messages.

---

## `GET /simulations/{id}/alerts`

Bottleneck alerts raised so far, newest first. A node only produces a new alert when its
severity *changes* — otherwise the feed would repeat every tick.

**200**
```json
[
  {
    "id": "alert-8c1d2e7a",
    "tick": 12,
    "nodeId": "gate-a",
    "severity": "CRITICAL",
    "density": 0.91,
    "trend": "RISING",
    "message": "Gate A at 91% capacity and still filling"
  }
]
```

`severity`: `WARNING` | `CRITICAL`. `trend`: `RISING` | `FLAT` | `FALLING`, measured across
the last `simulation.trend-window` ticks.

---

## `GET /simulations/{id}/reroutes/{nodeId}`

Dijkstra from `nodeId` to the nearest node still under the warning threshold.

**200**
```json
{ "fromNodeId": "gate-a", "toNodeId": "walk-south", "path": ["gate-a", "walk-north", "walk-south"], "cost": 55.0 }
```

When nowhere has headroom: `toNodeId` is `null`, `path` is `[]`, `cost` is infinity.

---

## `GET /simulations/{id}/advisories`

Plain-language guidance generated per alert, newest first. Comes from the Hugging Face
text-generation endpoint, or a template when `hf.mock-enabled` is set.

**200**
```json
[
  { "tick": 12, "nodeId": "gate-a", "text": "Act now: Gate A is at 91% capacity and still filling. Divert to South Walkway." }
]
```

---

## `GET /simulations/{id}/summary`

**200**
```json
{
  "simulationId": "sim-3f9a2b41",
  "ticks": 50,
  "peakDensity": 0.85,
  "bottleneckCount": 0,
  "baseline":  { "peakDensity": 1.0,  "bottleneckCount": 2, "criticalNodeTicks": 51, "avgClearTicks": 50 },
  "optimised": { "peakDensity": 0.85, "bottleneckCount": 0, "criticalNodeTicks": 0,  "avgClearTicks": 50 },
  "narrative": "Rerouting cut time spent above the critical threshold by 100% (51 → 0 zone-ticks), peaking at 85% instead of 100%."
}
```

| Metric | Meaning |
|---|---|
| `peakDensity` | Highest density any zone reached |
| `bottleneckCount` | Distinct zones that went critical at any point |
| `criticalNodeTicks` | **Headline number** — total zone-ticks spent above critical |
| `avgClearTicks` | Tick at which the venue emptied, or the run length if it never did |

Read `criticalNodeTicks` first. Peak density is pinned to 100% by any single undersized
kiosk, and zone count *rises* when a crowd is successfully spread out — neither one measures
how long people spent in a crush.

When the run had `rerouteEnabled: false`, `baseline` and `optimised` are identical — there
is no twin to compare against.
