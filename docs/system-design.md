# System Design

## The problem in one line

Crowds bunch up at gates, food counters and exits without warning. We simulate the venue,
spot the pile-up before it forms, and say where to send people instead.

## Three tiers, and a fourth client

```
┌─────────────────────────────────────────────────────────────┐
│  React (Vite)                                               │
│  SetupPage → LivePage → SummaryPage                         │
│  REST via useSimulationApi · live ticks via                 │
│  useSimulationSocket                                        │
└───────────────┬──────────────────────────┬──────────────────┘
                │ HTTP                     │ WebSocket
                │
   ┌────────────┴──────────────┐
   │  Flutter (mobile/)        │  attendees only: polls state, PUTs its zone.
   │  consent → join → live    │  Never holds the socket — a frame is ~240 KB/s
   └───────────────────────────┘  of agent positions it is forbidden to draw.
┌───────────────▼──────────────────────────▼──────────────────┐
│  Spring Boot                                                │
│  Controllers → SimulationEngine (tick loop)                 │
│              → DensityDetector (threshold + trend)          │
│              → RerouteEngine   (Dijkstra)                   │
│              → GnnRiskClient / AdvisoryService ──── HTTP ──┐ │
│  In-memory repositories (ConcurrentHashMap)                │ │
└────────────────────────────────────────────────────────────┼─┘
                                                             │
┌────────────────────────────────────────────────────────────▼─┐
│  Hugging Face                                                 │
│  congestion-gnn        — where congestion spreads next        │
│  advisory-generator    — density numbers → a sentence         │
└───────────────────────────────────────────────────────────────┘
```

## What is a classic algorithm, and what is AI

Deliberate split — forcing ML into the deterministic parts would cost time and buy nothing:

| Piece | Approach | Why |
|---|---|---|
| Crowd movement per tick | Flow over a capacitated graph | Deterministic, fast, debuggable |
| Reroute suggestion | Dijkstra | Provably shortest, nothing to train |
| Where congestion spreads next | **GNN on Hugging Face** | Needs the graph structure — a per-node threshold cannot see a neighbour pushing crowd into you |
| Turning numbers into an instruction | **Text generation on Hugging Face** | Operators read sentences, not density vectors |

## Data flow, one tick

1. The scheduler in `SimulationSocketHandler` fires every `simulation.tick-interval-ms`.
2. `SimulationEngine.advanceTick` — exits drain, everyone else advances toward the nearest
   exit as far as downstream capacity and edge throughput allow, then arrivals enter at the
   gates. People who cannot move stay put; that is what makes density climb.
3. `GnnRiskClient.predictRisk` — current densities + graph → risk a few ticks ahead.
4. `DensityDetector.detect` — nodes over threshold, tagged RISING / FLAT / FALLING from the
   last `simulation.trend-window` ticks.
5. For each *newly* alerting node: `RerouteEngine.findReroute` then `AdvisoryService.generate`.
   Alerts are only recorded when a node's severity changes, otherwise the feed floods.
6. The new state is pushed to every WebSocket watching that run.

## Before/after comparison

Starting a run with `rerouteEnabled: true` also starts a hidden twin with rerouting off, on
the same venue and crowd, ticked in lockstep. `GET /summary` compares the two. The
difference is real simulation output, not an estimate — that pairing is the demo's proof.

Two levers, both matching what the advisories actually tell staff to do:

1. **Spill sideways.** People may move *laterally* (to a node the same hop-distance from the
   exit) when the direct route is full, instead of queueing. Never backwards — sending people
   back toward the gate is not a reroute, it is a crush.
2. **Hold intake.** A gate stops accepting arrivals just below the critical threshold, so
   people wait outside rather than pack into the gate.

On the sample venue that is 51 → 0 zone-ticks above critical, peaking at 85% instead of 100%.

### Real attendees are excluded from it, deliberately

Attendees on the mobile app raise the density an operator sees. They are kept out of
`peakDensity` and `criticalNodeTicks`, which are the two numbers `GET /summary` compares.

The twin has no real attendees and cannot have any — it is a second simulation of the same
seed, not a second venue people can walk into. So counting a phone standing in a gate would
add it to the optimised side and nowhere else, and the narrative would report that rerouting
had made the venue worse. The split is one line in `SessionManager.advance`:
`Session.occupancy()` defines the comparison, `Session.liveOccupancy()` defines the display.

`WalkerIngestTest.realAttendeesRaiseLiveDensityButNeverTheBaselineNumbers` is the executable
form of that sentence.

### Reading the numbers

`criticalNodeTicks` — total zone-ticks spent above critical — is the headline. The other two
mislead on their own: peak density gets pinned at 100% by any single undersized kiosk
regardless of routing, and `bottleneckCount` *rises* when a crowd is successfully spread out,
because more zones briefly touch the threshold. Time-in-the-red is what routing actually moves.

### Why flow is limited at the destination

Congestion slows people *entering* a crowded space; it does not paralyse the one they are
leaving. A packed gate still empties at the corridor's rate. Modelling it the other way round
(scaling emission by the source's own density) makes jams self-locking — they never clear, and
no routing change can help, which is exactly the dead end this model avoids.

## Venue model

A directed graph. Nodes are zones (`GATE`, `WALKWAY`, `CONCESSION`, `SEATING`, `EXIT`) with a
capacity and map coordinates; edges are walkable connections with length (the Dijkstra
weight) and width (the per-tick throughput cap). See `sample-data/venue-layout-sample.json`.

## Failure modes we handle

- **HF endpoint down or not built yet** — every HF caller has a deterministic mock fallback,
  switched by `hf.mock-enabled`. The demo never depends on the network.
- **Venue with no exit** — unreachable nodes get infinite hop distance; people accumulate and
  the detector flags it rather than the engine crashing.
- **Nowhere to reroute to** — `ReroutePath.none`, and the advisory says to hold intake.

## Not built yet

- `SocialForceModel` — only the density→speed curve is real; the per-agent force terms are
  stubbed. `AgentFactory` returns an aggregate speed factor, not individual agents.
- Persistence — everything is in `ConcurrentHashMap`, gone on restart.
- The GNN's prediction is computed and logged but not yet shown in the UI.
