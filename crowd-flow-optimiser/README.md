# Crowd Flow Optimiser

Simulates how crowds move through a venue, predicts where bottlenecks will form, and
suggests rerouting before they turn dangerous.

Built for **Geek Room AI Race Month · Grandprix**, problem statement #3.

---

## What it does

1. Upload a venue layout — gates, walkways, concessions, exits, each with a capacity.
2. Run a tick-based simulation of a crowd arriving and moving through it.
3. Watch density climb live on the map; alerts fire when a zone crosses threshold *and* is
   still filling.
4. Click an alert to see the shortest diversion to a zone with headroom.
5. End on a side-by-side comparison: same crowd, with rerouting vs without.

The simulation and the shortest path are classic algorithms. The two Hugging Face models
handle what rules can't: a **GNN** predicting how congestion spreads to neighbouring zones,
and a **text-generation model** turning density numbers into an instruction an operator can
act on.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite, React Router |
| Backend | Spring Boot 3.3, Java 21, Maven |
| Live updates | WebSocket (`/simulations/{id}/stream`) |
| ML serving | FastAPI, self-hosted — congestion GNN + advisory generator loaded in-process |
| ML tooling | Python, PyTorch + torch-geometric, huggingface_hub |
| Visuals | Pixel-art tileset + crowd sprites (PixelLab MCP), optional reskin |

## Layout

```
frontend/     React app — setup, live map, summary
backend/      Spring Boot API, simulation engine, WebSocket
ml-service/   FastAPI model serving, port 8000
ml/           synthetic data generation, GNN training, HF export
sample-data/  example venue layout and event schedule
docs/         system design, API contract, demo script
```

## Running all three services

Open three terminals. **Start order does not matter** — each tier degrades on its own when
the one below it is absent.

```bash
# 1. ML serving (port 8000)
cd ml-service && uvicorn app.main:app --reload --port 8000

# 2. Backend (port 8080)
cd backend && ./mvnw spring-boot:run          # Windows: .\mvnw.cmd spring-boot:run

# 3. Frontend (port 5173)
cd frontend && npm run dev
```

| If this is down | What happens |
|---|---|
| `ml-service` | Spring uses its deterministic mocks; alerts and advisories still work |
| `backend` | Frontend renders on mock data; every screen still navigates |
| pixel-art assets | `PixelVenueMap` falls back to the plain marker map |

Check the ML layer with `curl http://localhost:8000/health` — `status` is `ok` only when
both models loaded, `degraded` when the service is up but an endpoint will 503.

---

## Running it

### Backend

Needs **JDK 21**. Maven not required — use the wrapper.

```bash
cd backend
./mvnw clean install      # Windows: .\mvnw.cmd clean install
./mvnw spring-boot:run
```

API on `http://localhost:8080`. Everything is in memory — restarting wipes all runs.

Config lives in `backend/src/main/resources/application.yml`: tick interval, density
thresholds, allowed CORS origins, Hugging Face endpoints.

### Frontend

Needs **Node 20.19+**.

```bash
cd frontend
cp .env.example .env.local     # Windows: copy .env.example .env.local
npm install
npm run dev
```

App on `http://localhost:5173`. It renders on mock data if the backend isn't up, so you can
work on the UI independently.

### Smoke test

```bash
curl -X POST http://localhost:8080/venues \
  -H "Content-Type: application/json" \
  -d @sample-data/venue-layout-sample.json

curl -X POST http://localhost:8080/simulations \
  -H "Content-Type: application/json" \
  -d '{"venueId":"venue-sample","crowdSize":4000,"ticks":60,"arrivalRate":300,"rerouteEnabled":true}'

curl http://localhost:8080/simulations/<id>/state
curl http://localhost:8080/simulations/<id>/alerts
curl http://localhost:8080/simulations/<id>/summary
```

Full endpoint list with request/response shapes: [docs/api-contract.md](docs/api-contract.md).

### ML

```bash
cd ml
python -m venv .venv && .venv/Scripts/activate    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

python data/generate_synthetic_runs.py --runs 300     # writes ml/out/synthetic_runs.csv + graph.json
python gnn/train_gnn.py --data out --epochs 50        # writes ml/out/congestion_gnn.pt
HF_TOKEN=... python gnn/export_to_hf.py --repo <your-username>/congestion-gnn
```

`generate_synthetic_runs.py` is stdlib-only and mirrors the backend's tick engine, so it
runs before you install torch:

```bash
python data/generate_synthetic_runs.py --self-check
```

### Pointing the backend at your models

Until both models are live, `hf.mock-enabled: true` keeps deterministic fallbacks in play —
the app never blocks on the network. When a model is up:

```yaml
hf:
  mock-enabled: false
  token: ${HF_TOKEN}
  gnn-endpoint: https://api-inference.huggingface.co/models/<you>/congestion-gnn
  advisory-endpoint: https://api-inference.huggingface.co/models/<you>/advisory-generator
```

Each client still falls back to its mock if a call fails, so a flaky endpoint degrades
instead of breaking the demo.

---

## Current state

Working end to end: venue upload, tick simulation with capacity limits, threshold + trend
detection, Dijkstra rerouting, WebSocket streaming, before/after summary from a real paired
run, and the full REST surface.

Stubbed with TODOs:

- `SocialForceModel` — only the density→speed curve is implemented; per-agent force terms
  are signatures with TODOs.
- `AgentFactory` — returns an aggregate crowd speed factor, not individual agents.
- `ml/gnn/*` — the training loop runs, but the architecture is a placeholder GraphSAGE and
  the HF inference handler isn't written.
- No persistence, no auth.

See [docs/system-design.md](docs/system-design.md) for the architecture and
[docs/demo-script.md](docs/demo-script.md) for the demo outline.
