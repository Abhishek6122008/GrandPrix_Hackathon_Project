# Demo Script — 2 minutes

Rehearse against the clock. The whole thing has to land inside two minutes, and the summary
screen at the end is the part that wins it — leave time for it.

**Before you start**

- All three processes up: AI service (8000), backend (8080), frontend (5173). See the
  [README](../README.md).
- A client account already registered and **already signed in**. Do not spend demo time typing a
  password into a form.
- A session already created but **not started**, sample arena loaded.
- Second tab open on `/access` → Walker, with the venue code ready to type.
- Check `GET http://localhost:8000/health` — it names which model path will answer, so you know
  in advance whether to say "our trained GNN" or "the offline model".

---

## 0:00 — 0:15 · The problem

> "Gates, food counters, exits. People bunch up, nobody sees it coming, and by the time it's
> visible it's a crush. Here's a venue about to have that problem."

Landing page, then straight into the client portal. Don't narrate the sign-in.

## 0:15 — 0:35 · What the organiser sees

- Live map with the venue graph — gates, walkways, concessions, exits.
- Press **Create session**, then start it.

> "Every zone has a real capacity. Four thousand people arrive over ten minutes, and we simulate
> them individually — this is a social force model, so people slow down and swerve around each
> other rather than passing through."

## 0:35 — 1:00 · It fills, and it starts to hurt

- Zone circles grow, colours shift green → amber.
- Point at a gate that is climbing **before** it goes red.

> "This isn't a replay. It's running now, ten ticks a second, and that gate is about to go over."

## 1:00 — 1:20 · The AI layer answers

- The **crowd-safety panel** ranks the zones becoming dangerous, with what to do about each.
- Read the advisory sentence out loud.

> "That sentence came from a model, and it's the reason we guard it — a small model will happily
> tell a marshal to send people to a zone that doesn't exist. Anything naming a zone that wasn't
> in the prompt gets rejected and we fall back to a template. Fluent and wrong is worse than
> plain and right when someone's about to act on it."

## 1:20 — 1:40 · The attendee's view

- Switch to the walker tab. Type the **venue code** from the entrance signage, **Check in**.

> "Same live data, completely different view. The route out is coloured by live congestion, and
> it's planned *around* the crowd, not through it. It tells you it diverted you and what that
> cost you in metres."

Say the honest bit — it lands better than glossing it:

> "Position is zone-level and self-declared. We simulate a crowd; we don't track anyone's phone,
> and the UI says so rather than drawing a fake accuracy circle."

## 1:40 — 2:00 · The proof

- Jump to the summary. Two runs, side by side.

> "Same venue, same crowd, same arrivals, same random seed — one run with our rerouting, one
> without. The second one ran hidden the whole time. **51 zone-ticks above critical, down to
> zero.** Peak 100% down to 85%."

> "That's the point. We didn't visualise the problem, we measurably removed it — and the
> comparison is real simulation output, not an estimate."

---

## If asked: where's the AI, really?

Two models, and they were adopted in opposite directions on purpose:

1. **Risk prediction — trained, not found.** Nothing on the Hub predicts congestion from a venue
   graph; searching returns molecule GNNs and image-based crowd *counting*. None share an input
   space with a venue graph, so we trained [`abhi1005/congestion-gnn`](https://huggingface.co/abhi1005/congestion-gnn)
   and published it.
2. **Advisory text — found, not trained.** Turning four facts into one clear sentence is exactly
   what small instruct models already do, so Qwen2.5-0.5B-Instruct is used as-is.

The simulation and the shortest path are deliberately **not** AI. Deterministic problems with
exact algorithms; forcing a model in would be slower and worse.

## If asked: how good is the GNN, honestly?

Quote the onset number, not the headline one:

> "87% of bottlenecks caught before they form, at 95% precision. The naive 'assume every zone
> stays as it is' baseline scores 0% on that by construction — it only looks good on the metric
> that measures reporting rather than prediction."

## If asked: is any of this persisted?

> "Accounts are — Flyway-managed schema, H2 locally, Postgres in the cloud profile, no code
> change between them. Simulation runs are in memory and die with the process. That's a known
> limit, and it's a `SessionManager` change, not a config switch."

## If the demo breaks

- **AI service down** → nothing visibly changes. The session keeps ticking on measured density
  and the fallbacks answer. Say "that's the degradation path" and keep going.
- **Backend down** → the frontend still renders. Say so, move to the summary screenshot.
- **Last resort** → the recorded screen capture. Have it on the desktop, not in a cloud folder.
