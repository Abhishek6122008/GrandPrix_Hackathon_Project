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

## If asked: does it track people's phones?

Not the simulation. Those agents are a model — no device is involved, and that is true of
everything on the operator's map by default.

The attendee app is opt-in and does report position, so the honest answer is "only for people
who choose it, and only as a zone":

- A GPS fix is turned into a zone id at the ingest boundary and the **coordinates are
  discarded**. `Session` holds a zone and an expiry per attendee and has no field for a
  coordinate.
- **Foreground only.** No background permission is requested. Close the app and you drop off
  the map in 30 seconds.
- **No account.** The id is a UUID the app generates for itself.
- If the fix is less accurate than the zone is wide, the app **places nobody** and says so,
  rather than drawing a dot it cannot justify.
- Real attendees never enter the before/after numbers — the baseline twin has none, so
  counting them would make rerouting look worse than it is.

The demo runs identically with zero phones connected, which is the point: this adds precision
where it exists and changes nothing where it does not.
