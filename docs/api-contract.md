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

`venue` is the same shape as `POST /venues` below. `crowdSize` 1–10000, `arrivalRate` 1–2000
(people admitted per tick, split across gates). `maxTicks` defaults to 1200, `tickSeconds` to
1.0, `rerouteEnabled` to true.

The `crowdSize` ceiling is measured, not guessed: one tick costs ~13 ms at 2,500 agents,
~58 ms at 10,000 and ~112 ms at 20,000 — past the 100 ms tick budget, where the simulated
clock quietly starts running slower than the wall clock. Raise it only alongside a
re-measurement, and note a baseline twin doubles the real agent count.

**400** if the venue has no `GATE` node, has duplicate node ids, or has an edge referencing a
node that does not exist. A venue with **no `EXIT`** is accepted on purpose — it is a scenario
worth simulating, and the detector will light the whole venue up, which is the right answer.

**201** — `SessionInfo` (see `GET /sessions/{id}`). Status is `CREATED`; nothing ticks yet.

### The baseline twin

When `rerouteEnabled` is true, a second session is created at `{id}-baseline`: same venue,
same crowd, **same seed**, rerouting off. It ticks in lockstep, is never broadcast and never
sent to the AI layer, and is hidden from `GET /sessions`. It exists so
`GET /sessions/{id}/summary` can compare two runs that differ only by the intervention.

Sharing the seed means both runs draw the same crowd — same mix of families and solo
attendees, same walking speeds, same spawn scatter. Arrival *volume* still differs, because
holding intake at a critical gate is precisely the intervention being measured.

`start`, `pause` and `stop` on a session always move its twin too. You can read the twin
directly at `GET /sessions/{id}-baseline` if you want its raw numbers.

---

## `POST /sessions/{id}/start` · `/pause` · `/stop`

**200** — `SessionInfo` with the new status.

- `start` — begins or resumes ticking. **409** if the session is already `STOPPED` or `COMPLETED`.
- `pause` — holds the clock, keeps all state. `start` resumes from the same tick.
- `stop` — terminal. Viewers keep the last frame; the numbers are final.

Status is one of `CREATED`, `RUNNING`, `PAUSED`, `STOPPED`, `COMPLETED`. `COMPLETED` is
reached on its own when `maxTicks` is hit or the whole crowd has left.

A session that reaches `STOPPED` or `COMPLETED` is evicted, with its twin, after
`session.retain-after-finish-ms` (default 10 minutes) and then 404s. Nothing here survives a
restart anyway; the sweep stops a long demo accumulating dead runs in memory.

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

## `GET /sessions`

**200** — an array of `SessionInfo`, every live and recently finished session. Baseline twins
are hidden.

---

## `GET /sessions/{id}/state`

**200** — the same frame the WebSocket pushes, for clients that would rather poll. `null`
before the first frame is published.

---

## `GET /sessions/{id}/summary`

Post-run stats and the before/after comparison. Readable while the run is still going — the
numbers are running totals, not final ones.

**200**
```json
{
  "sessionId": "sess-1b1f94d8", "venueId": "venue-sample", "venueName": "...",
  "status": "STOPPED", "ticks": 296, "simulationSeconds": 592.0,
  "comparisonAvailable": true,
  "baseline":  { "peakDensity": 4.48, "criticalNodeTicks": 676, "bottleneckCount": 3,
                 "spawned": 3000, "exited": 510, "stillInside": 2490 },
  "optimised": { "peakDensity": 0.95, "criticalNodeTicks": 489, "bottleneckCount": 5,
                 "spawned": 2485, "exited": 425, "stillInside": 2060 },
  "narrative": "Rerouting cut time above the critical threshold by 28% (676 to 489 zone-ticks), and held the worst zone to 95% of capacity instead of 448%."
}
```

`comparisonAvailable` is false when the session ran with `rerouteEnabled: false` — there is no
twin, so `baseline` and `optimised` are the same numbers and the narrative says so rather than
implying a comparison that never happened.

Read `criticalNodeTicks` as the headline safety number. The other two mislead if quoted alone:

- `peakDensity` is pinned at 1.0 by any single undersized zone, so it barely moves between runs
  that are wildly different everywhere else. It is worth quoting here only because the
  untreated run blows past it — 4.48 means a gate packed to 448% of capacity.
- `bottleneckCount` usually goes **up** when rerouting works, because spreading a crowd out
  touches more zones. Above, 3 → 5 zones is the system working, not failing.
- Exits are deliberately absent from the narrative. The untreated run typically gets *more*
  people through, by packing gates several times over capacity — the exact thing being
  prevented. Quoted side by side without that context it reads as rerouting being worse.

---

## `WS /sessions/{id}/stream`

Organiser and viewers connect to the same path and receive identical frames. The current
frame is pushed on connect, so a late joiner never sees a blank map. Read-only: inbound
messages are ignored and cannot perturb the simulation.

Handshakes are restricted to the same `cors.allowed-origins` list as the REST API. A
WebSocket handshake is not covered by CORS, so leaving it open while the REST API is pinned
would let any page on the internet stream from a locally running backend.

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
