# Demo Script — 2 minutes

> Placeholder outline. Fill in the exact numbers on Day 4 once a real run is recorded, and
> rehearse against the clock — the whole thing has to land inside two minutes.

**Before you start:** backend running, frontend running, `sample-data/venue-layout-sample.json`
on the desktop, `hf.mock-enabled` set correctly for whichever models are actually live.

---

## 0:00 — 0:15 · The problem

> "Gates, food counters, exits. People bunch up, and nobody sees it coming until it's a
> crush. Here's a venue about to have that problem."

Setup screen already open, venue layout loaded.

## 0:15 — 0:35 · Setup

- Show the venue graph — gates, walkways, concessions, exits.
- Set crowd size to **_[TBD — pick the number that peaks convincingly]_**, rerouting on.
- Hit **Run**.

> "Four thousand people arriving over ten minutes. Simulated tick by tick."

## 0:35 — 1:00 · Live fill

- Map fills. Node circles grow, colours shift green → amber.
- Point at the gate that's climbing before it goes red.

> "This isn't a replay — it's running now. Every node has a capacity, and the crowd moves
> across the graph respecting it."

## 1:00 — 1:20 · Alert fires

- Alerts panel slides in a **CRITICAL** card.
- Read the advisory line out loud — that's the HF text model.

> "It didn't just say 91%. It said what to do about it."

## 1:20 — 1:40 · Reroute

- Click the alert. Dashed path animates on the map.
- Say where it routes to and why.

> "Dijkstra to the nearest zone with headroom. Shortest walk, not just any exit."

## 1:40 — 2:00 · Summary — the proof

- Jump to the summary screen. Two columns, side by side.

> "Same venue, same crowd, same arrivals — one run with our rerouting, one without.
> Peak density **_[X]%_** down to **_[Y]%_**. **_[N]_** congested zones down to **_[M]_**."

> "That's the whole point: we didn't just visualise the problem, we measurably reduced it."

---

## If asked: where's the AI?

Two Hugging Face models, both doing something a rule couldn't:

1. **Congestion-propagation GNN** — predicts risk at *neighbouring* zones. A threshold sees
   one node; message passing sees the walkway about to be overwhelmed by the gate feeding it.
2. **Advisory generator** — density vectors into an instruction an operator can act on
   without interpreting a chart.

The simulation and the shortest path are deliberately *not* AI. They're deterministic
problems with exact algorithms; forcing a model in would be slower and worse.

## If the demo breaks

- HF endpoint down → mock fallbacks are already on, nothing visibly changes.
- Backend down → the frontend still renders on mock data; say so, keep moving.
- **_[TBD: record a 30-second screen capture on Day 4 as the last-resort fallback.]_**
