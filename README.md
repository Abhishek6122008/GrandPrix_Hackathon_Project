# Crowd Flow Optimiser

**Geek Room AI Race Month · Grandprix — Problem Statement #3**

Simulate a venue, predict where the crowd will jam, and route around it — before the queue
becomes a crush.

Upload a venue layout, and the system runs a live agent simulation of the crowd moving through
it, measures density per zone, asks an AI layer which zones are about to become dangerous, and
diverts people away from them. A hidden baseline run executes alongside with rerouting off, on
the same crowd and the same random seed, so the summary shows a real before/after rather than
an estimate.

---

## Repository layout

| Path | What it is |
|---|---|
| [`backend/`](backend/) | Spring Boot. Sessions, the agent simulation, density detection, rerouting, WebSocket broadcast. Port **8080**. |
| [`ai-service/`](ai-service/) | Python FastAPI. Per-zone risk prediction and the operator advisory. Port **8000**. |
| [`frontend/`](frontend/) | React + Vite. Three portals over one live map. Port **5173**. |
| [`ml/`](ml/) | Model training and export to the Hugging Face Hub. Not needed to run the app. |
| [`sample-data/`](sample-data/) | A ready-made venue layout and event schedule. |
| [`docs/`](docs/) | API contract, system design, demo script. |

---

## Running it

Three processes. Start them in any order — each degrades gracefully while the others are down.

### 1. AI service (port 8000)

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

No configuration, no API token and no model download. See [Which model answers](#which-model-answers).

### 2. Backend (port 8080)

```bash
cd backend
./mvnw spring-boot:run
```

Needs JDK 21.

### 3. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Then open <http://localhost:5173>, go to **Access → Client**, sign in with anything, and press
**Create session**. The sample arena is pre-loaded, so it is one click to a running crowd.

---

## How the pieces talk

```
Browser ──HTTP──> Spring Boot ──HTTP /analyze──> FastAPI ──(optional)──> Hugging Face
   ^                   │                            │
   └──── WebSocket ────┘                     app/scoring.py
        live frames                       (offline, always available)
```

1. The frontend uploads a venue and opens a session: `POST /sessions`.
2. Spring ticks that session every 100 ms — agents move under a social force model, and each
   zone's density is measured.
3. When density has moved enough to be worth asking about, Spring calls the AI service's
   `POST /analyze` with the graph, current density, recent history and run context. **This call
   is always off the tick thread** — a session must never stall waiting on a model.
4. The AI service returns per-zone risk and a written advisory.
5. Zones that go critical trigger a Dijkstra reroute; everyone heading into the jam is diverted.
6. Every other tick, the whole state is broadcast to every connected viewer over
   `WS /sessions/{id}/stream`.

If the AI service is down, the session keeps running and keeps broadcasting measured density —
degraded, not broken. The full contract is in [`docs/api-contract.md`](docs/api-contract.md).

---

## Which model answers

The AI service has two inference paths and reports which one it used, in `modelInfo` on every
response and at `GET /health`.

| Path | When it runs | Reports as |
|---|---|---|
| **Hugging Face Inference API** | `HF_API_TOKEN` and the matching `HF_*_URL` are set | `huggingface` |
| **Offline model** (`ai-service/app/scoring.py`) | otherwise, or when a hosted call fails | `local-linear` / `local-template` |

The choice is made **per step**, so a working GNN endpoint with a missing LLM one gives you
hosted risk scores with locally written prose.

The offline model is deliberately not a neural network, and does not claim to be. It is a
one-hop linear propagation model over the same feature columns the GNN trains on — a zone's own
density, its busiest neighbour's, the trend and the change over the history window. The
neighbour term is the part a per-zone threshold cannot do: it is what lets the system say
"Gate B is about to be pushed over by the concourse next to it."

To use Hugging Face instead, copy `ai-service/.env.example` to `ai-service/.env` and fill it
in. To make hosted inference mandatory so a bad token fails loudly rather than silently falling
back, set `CROWDFLOW_LOCAL_FALLBACK=false`.

---

## The three portals

All three read the same live session; they differ in what they are allowed to see.

- **Walker** (attendee) — the venue map, live zone congestion, and a real walking route to the
  nearest exit computed over the venue's own edges. Position is **zone-level and self-declared**:
  the system simulates a crowd, it does not track anyone's phone, and the UI says so instead of
  drawing a false accuracy circle. Other attendees are never shown.
- **Client** (organiser) — session setup and start/pause/stop, the live map with agent positions,
  per-zone occupancy, the AI advisory, and the diversion overlay.
- **Admin** — every session on the backend, aggregate figures, and the alert feed.

---

## Tests

```bash
cd backend    && ./mvnw test                      # 22 tests
cd ai-service && .venv/Scripts/python -m pytest tests -q   # 8 tests
cd ai-service && .venv/Scripts/python -m app.scoring       # model self-check
```

---

## Notes on the numbers

**Critical node-ticks** is the headline safety metric: one zone spending one tick above the
critical threshold. Peak density and bottleneck count both mislead — one undersized kiosk pins
peak at 1.0, and spreading a crowd out (the entire goal) touches *more* zones, not fewer.

The summary deliberately does not compare throughput between the two runs. The untreated run
usually gets more people through, because it never holds intake — it achieves that by packing
gates several times over capacity, which is precisely the thing being prevented.
