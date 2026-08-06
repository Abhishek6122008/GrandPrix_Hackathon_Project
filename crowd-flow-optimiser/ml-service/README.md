# ml-service

The AI orchestration layer. Two ways in, and they exist for different days:

| Path | What it does | Needs |
|---|---|---|
| **`POST /analyze`** (primary) | Graph + density + history + context → calls the **Hugging Face Inference API** for the GNN, then for the LLM → `{predictions, advisory}` | HF token + network |
| `POST /predict/risk`, `POST /generate/advisory` | Self-hosted: models loaded into this process at startup, no network at inference time | `torch` / `transformers` + a checkpoint |

The Spring backend calls `/analyze`. The self-hosted pair is the demo-day safety net for when
the venue wifi or a cold HF endpoint is not cooperating.

## Run

```bash
cd ml-service
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                             # then fill in your HF token + endpoints
uvicorn app.main:app --reload --port 8000
```

Interactive API docs at `http://localhost:8000/docs`.

`/analyze` only needs the first five packages in `requirements.txt`. `torch` and
`transformers` are for the self-hosted fallback and can be skipped — the service starts
without them and `/health` reports them as unloaded.

## Configuration

**Every credential comes from the environment. Nothing is hardcoded, and `.env` is gitignored.**
Copy `.env.example` to `.env` and fill it in.

| Env var | Default | Purpose |
|---|---|---|
| `HF_API_TOKEN` | — | Hugging Face read token. Required by `/analyze`. |
| `HF_GNN_URL` | — | Full endpoint URL for the congestion GNN. |
| `HF_LLM_URL` | — | Full endpoint URL for the advisory text-generation model. |
| `HF_GNN_MODEL` / `HF_LLM_MODEL` | the URL | Cosmetic; echoed back in `modelInfo`. |
| `HF_TIMEOUT_SECONDS` | `12` | Per-attempt timeout. |
| `HF_MAX_RETRIES` | `2` | Retries after the first attempt, so up to 3 calls. |
| `HF_LLM_MAX_NEW_TOKENS` | `90` | Advisory length ceiling. |
| `CROWDFLOW_GNN_CHECKPOINT` | `../ml/out/congestion_gnn.pt` | Self-hosted path only. |
| `CROWDFLOW_ADVISORY_MODEL` | `Qwen/Qwen2.5-0.5B-Instruct` | Self-hosted path only. |

Both URLs work with either serverless Inference API
(`https://api-inference.huggingface.co/models/<org>/<model>`) or a dedicated Inference
Endpoint (`https://<id>.<region>.aws.endpoints.huggingface.cloud`).

## `POST /analyze`

```json
{
  "sessionId": "sess-ab49d7f1",
  "tick": 152,
  "graph": {
    "nodes": [{ "id": "gate-a", "name": "Gate A", "type": "GATE", "capacity": 320, "x": 60, "y": 120 }],
    "edges": [{ "source": "gate-a", "target": "walk-north", "length": 25, "width": 6 }]
  },
  "density": { "gate-a": 0.85, "walk-north": 0.62 },
  "history": [{ "tick": 140, "density": { "gate-a": 0.71, "walk-north": 0.58 } }],
  "context": {
    "venueName": "Grandprix Arena — North Wing",
    "tickSeconds": 2.0, "crowdSize": 2500, "peopleInside": 1504, "pendingArrivals": 993,
    "status": "RUNNING", "rerouteEnabled": true,
    "trends": { "gate-a": "RISING" },
    "highRiskNodeIds": ["gate-a"]
  }
}
```

→

```json
{
  "status": "ok",
  "predictions": [{ "nodeId": "gate-a", "risk": 0.771, "horizonTicks": 30 }],
  "advisory": {
    "headline": "Gate A at 85% capacity",
    "message": "Hold intake and stage arrivals away from Gate A; it is filling faster than it drains.",
    "actions": ["Hold gate intake for 2 minutes"]
  },
  "errors": [],
  "modelInfo": { "gnn": "your-org/congestion-gnn", "llm": "Qwen/Qwen2.5-0.5B-Instruct" }
}
```

### What happens when Hugging Face fails

This is the contract the Spring backend leans on, so it is worth being precise about.

| `status` | HTTP | Meaning | What Spring does |
|---|---|---|---|
| `ok` | 200 | Both calls answered | Shows predicted risk + advisory |
| `partial` | 200 | One answered; `errors` names the other | Keeps the half it got — raw density with no prose, or prose with no risk |
| `failed` | 502 | Neither answered | Falls back to its own deterministic mock; the session keeps running on measured density |

The service **never invents an answer**. A failed model call comes back as an empty key plus a
named error, never as a plausible-looking number. Spring already has one deterministic
fallback; a second, quietly different one here would mean two layers disagreeing about what
the crowd is doing with no way to tell which you were looking at.

Both HF clients retry on timeouts, transport errors and the cold-start status codes
(408/429/5xx), with exponential backoff plus jitter, and honour the `estimated_time` HF
returns with a 503 while a serverless model loads.

`422` is returned only for input the caller can fix — a duplicate node id, an edge pointing at
a node that does not exist, or a negative density. Density **above** 1.0 is allowed on
purpose: a zone past capacity is the interesting case, not an error.

## Tests

```bash
.venv/Scripts/python -m pytest tests -q
```

Runs with **no Hugging Face token**: the model calls are pointed at a stub HTTP server started
in-process, which covers the request shapes sent, the response shapes accepted (HF wraps
text-generation output at least four different ways), the cold-start retry, and — the one that
matters — that a dead endpoint degrades instead of taking the session down.

## Self-hosted fallback status

Wiring, schemas, health reporting and the 503 path are in place. Still `NotImplementedError`:

- `GnnRiskModel.predict` — build the feature matrix and edge index, run the model.
- `AdvisoryModel.generate` — format the prompt, run the pipeline, strip the prompt back off.

`GET /health` reports which of the two paths are actually usable:

```json
{
  "status": "ok",
  "models": { "gnn_risk": { "loaded": false, "error": "..." }, "advisory": { "loaded": false, "error": "..." } },
  "analyze": { "configured": true, "gnn_url_set": true, "llm_url_set": true, "token_set": true }
}
```

`status` is `ok` when at least one path works — both self-hosted models loaded, **or**
`/analyze` fully configured. `token_set` reports presence only; the token is never echoed.
