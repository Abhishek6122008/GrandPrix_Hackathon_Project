# API Contract

Base URL: `http://localhost:8080` (override with `VITE_API_BASE_URL`).
All request and response bodies are JSON. Validation failures return **400**; unknown ids
return **404**. Error bodies are `ApiError`:
`{ timestamp, status, error, message, details[] }`.

There are **two simulation surfaces**, and they are not alternatives to each other:

| Surface | Model | Use it for |
|---|---|---|
| **`/sessions`** | Individual agents under a social force model, ~10 ticks/second, live WebSocket | The live map: people moving, heatmap, alerts, reroutes, AI advisories |
| `/venues` + `/simulations` | Aggregate flow, per-node counts, 2 ticks/second | The before/after summary, and anything that only needs numbers |

`/sessions` is the one the architecture describes. `/venues` + `/simulations` predates it,
still works, and is what the current React app calls.

---

# Sessions (live agent simulation)

## `POST /sessions`

Uploads a venue layout **and** creates a session in one call. The venue is also stored, so
`GET /venues/{id}` works on it afterwards.

**Request**
```json
{
  "venue": { "id": "venue-sample", "name": "...", "nodes": [...], "edges": [...] },
  "crowdSize": 2500,
  "arrivalRate": 45,
  "maxTicks": 3000,
  "tickSeconds": 2.0,
  "rerouteEnabled": true
}
```

`venue` is the same shape as `POST /venues` below. `crowdSize` 1–20000, `arrivalRate` 1–2000
(people admitted per tick, split across gates). `maxTicks` defaults to 1200, `tickSeconds` to
1.0, `rerouteEnabled` to true.

**400** if the venue has no `GATE` node, has duplicate node ids, or has an edge referencing a
node that does not exist. A venue with **no `EXIT`** is accepted on purpose — it is a scenario
worth simulating, and the detector will light the whole venue up, which is the right answer.

**201** — `SessionInfo` (see `GET /sessions/{id}`). Status is `CREATED`; nothing ticks yet.

---

## `POST /sessions/{id}/start` · `/pause` · `/stop`

**200** — `SessionInfo` with the new status.

- `start` — begins or resumes ticking. **409** if the session is already `STOPPED` or `COMPLETED`.
- `pause` — holds the clock, keeps all state. `start` resumes from the same tick.
- `stop` — terminal. Viewers keep the last frame; the numbers are final.

Status is one of `CREATED`, `RUNNING`, `PAUSED`, `STOPPED`, `COMPLETED`. `COMPLETED` is
reached on its own when `maxTicks` is hit or the whole crowd has left.

---

## `GET /sessions/{id}`

**200**
```json
{
  "sessionId": "sess-ab49d7f1", "venueId": "venue-sample", "venueName": "...",
  "status": "RUNNING", "tick": 152, "maxTicks": 3000,
  "crowdSize": 2500, "arrivalRate": 45, "tickSeconds": 2.0, "rerouteEnabled": true,
  "peopleInside": 1504, "spawned": 1507, "exited": 3,
  "viewers": 1, "alertCount": 9,
  "aiStatus": "ok", "latestAdvisory": "Hold intake and stage arrivals away from Gate B..."
}
```

`aiStatus` is deliberately visible: `not-yet-called`, `calling (tick N)`, `ok`, `partial (llm
unavailable)`, `unavailable: ...`, or `disabled (ml-service.mock-enabled)`. When the AI layer
is down the session keeps running on measured density and this says so.

---

## `GET /sessions/{id}/state`

**200** — the same frame the WebSocket pushes, for clients that would rather poll. `null`
before the first frame is published.

---

## `WS /sessions/{id}/stream`

Organiser and viewers connect to the same path and receive identical frames. The current
frame is pushed on connect, so a late joiner never sees a blank map. Read-only: inbound
messages are ignored and cannot perturb the simulation.

Frames are pushed every `session.broadcast-every-ticks` ticks (default 2, so ~5/second at the
default 100 ms tick).

```json
{
  "sessionId": "sess-ab49d7f1",
  "venueId": "venue-sample",
  "tick": 152,
  "simulationSeconds": 304.0,
  "status": "RUNNING",

  "people": [{ "id": "sess-ab49d7f1-0", "x": 135.9, "y": 141.2, "nodeId": "gate-a", "type": "SOLO", "rerouted": true }],
  "sampledFrom": 1504,

  "nodes": [{
    "nodeId": "gate-a", "name": "Gate A", "occupancy": 274, "capacity": 320,
    "density": 0.85, "status": "CRITICAL", "trend": "RISING", "predictedRisk": 0.771
  }],

  "alerts": [{ "id": "alert-1a2b", "tick": 148, "nodeId": "gate-a", "severity": "CRITICAL",
               "density": 0.9, "trend": "RISING", "message": "Gate A at 90% capacity and still filling" }],
  "reroutes": [{ "fromNodeId": "gate-a", "toNodeId": "exit-east",
                 "path": ["gate-a", "walk-north", "stand-lower", "concourse", "exit-east"], "cost": 95.0 }],

  "predictedRisk": { "gate-a": 0.771 },
  "advisory": "Hold intake and stage arrivals away from Gate B...",
  "aiStatus": "ok",

  "metrics": {
    "peopleInside": 1504, "spawned": 1507, "exited": 3, "pendingArrivals": 993,
    "peakDensity": 0.91, "criticalNodeTicks": 250, "activeAlerts": 3, "viewers": 1
  }
}
```

Notes a client needs:

- **`people` is a sample.** It is capped at `session.max-people-in-frame` (default 600) by
  taking every *n*th agent, so the shape of the crowd survives. `sampledFrom` is the true
  count — scale your own counters off that and `metrics`, never off `people.length`.
- **`density` can exceed 1.0.** A zone past capacity is the interesting case. `status` uses
  the same thresholds throughout: `WARNING` ≥ 0.70, `CRITICAL` ≥ 0.85.
- `alerts` and `reroutes` are the most recent 20 and 10; the full feeds are on the session.
- `predictedRisk` is empty `{}` until the AI layer answers, and stays at its last good value
  if a later call fails. `predictedRisk` on a node is 0.0 when unknown — check `aiStatus`
  before drawing it as a real prediction.
- **Set your client's max message size.** A busy frame is tens of kilobytes and the usual 8 KB
  default *closes the connection* rather than truncating. The server side is raised via
  `session.socket-buffer-bytes` (default 512 KB).

---

# Venues and flow simulations

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

**Request — constant arrival rate (current frontend-compatible form)**
```json
{ "venueId": "venue-sample", "crowdSize": 4000, "ticks": 60, "arrivalRate": 120, "rerouteEnabled": true }
```

**Request — scheduled arrivals**
```json
{
  "venueId": "venue-sample",
  "crowdSize": 4200,
  "eventSchedule": {
    "eventId": "gp-race-day-1",
    "name": "Race Day — Qualifying",
    "tickSeconds": 10,
    "phases": [
      { "name": "Doors open", "startTick": 0, "endTick": 40, "arrivalRate": 140 },
      { "name": "Pre-race rush", "startTick": 40, "endTick": 70, "arrivalRate": 320 },
      { "name": "Session", "startTick": 70, "endTick": 140, "arrivalRate": 0 }
    ]
  },
  "rerouteEnabled": true
}
```

Provide either `ticks` plus `arrivalRate`, or `eventSchedule`. Schedule phase ranges are
zero-based and end-exclusive; they must be ordered, non-overlapping, and end after they
start. The final phase end tick determines the run duration (maximum 2000 ticks).
`crowdSize` is 1–500000. A scheduled `arrivalRate` may be zero.

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
