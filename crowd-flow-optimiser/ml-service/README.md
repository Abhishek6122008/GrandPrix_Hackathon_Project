# ml-service

Self-hosted ML serving layer. Both models are loaded into this process at startup and
inference runs locally — nothing calls the Hugging Face Inference API at request time.

## Run

```bash
cd ml-service
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Interactive API docs at `http://localhost:8000/docs`.

## Endpoints

### `GET /health`

Spring checks this before relying on the service.

```json
{
  "status": "degraded",
  "models": {
    "gnn_risk":  { "loaded": false, "checkpoint": "...", "error": "FileNotFoundError: no checkpoint at ..." },
    "advisory":  { "loaded": true,  "model_id": "Qwen/Qwen2.5-0.5B-Instruct", "error": null }
  }
}
```

`status` is `ok` only when both models loaded. `degraded` means the service is up but at
least one endpoint will return 503.

### `POST /predict/risk`

```json
{
  "nodes": [{ "id": "gate-a", "density": 0.91, "trend": "RISING" }],
  "edges": [{ "source": "gate-a", "target": "walk-north" }]
}
```

→ `{ "risk": { "gate-a": 0.94 }, "model": "gnn" }`

### `POST /generate/advisory`

```json
{ "node": "Gate A", "density": 0.91, "trend": "RISING", "reroutePath": ["gate-a", "walk-north"] }
```

→ `{ "message": "Hold intake at Gate A and send arrivals to North Walkway.", "model": "text-generation" }`

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CROWDFLOW_GNN_CHECKPOINT` | `../ml/out/congestion_gnn.pt` | Trained GNN weights |
| `CROWDFLOW_ADVISORY_MODEL` | `Qwen/Qwen2.5-0.5B-Instruct` | Text-generation model id |

The GNN architecture is imported from `ml/gnn/model.py` rather than redefined here, so
training and serving cannot drift apart. Produce a checkpoint with:

```bash
cd ../ml
python data/generate_synthetic_runs.py --runs 300
python gnn/train_gnn.py --data out --epochs 50
```

## Where the fallbacks live

Deliberately **not** here. A missing model gives a 503; the Spring backend catches that and
uses its own mock. One fallback path in one place, rather than two that can disagree about
what the crowd is doing.

## Skeleton status

Wiring, schemas, health reporting and the 503 path are in place. Still `NotImplementedError`:

- `GnnRiskModel.predict` — build the feature matrix and edge index, run the model.
- `AdvisoryModel.generate` — format the prompt, run the pipeline, strip the prompt back off.
