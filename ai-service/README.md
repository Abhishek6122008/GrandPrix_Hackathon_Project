# AI Service

The Python half of the Crowd Flow Optimiser. Predicts per-zone congestion risk and writes the
operator advisory that goes with it.

Called only by the Spring Boot backend — never by the browser.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

No API token, no model download, no configuration. Swagger UI at
<http://127.0.0.1:8000/docs>.

---

## Endpoints

| Endpoint | Used by | Returns |
|---|---|---|
| `POST /analyze` | Spring's `FastApiClient`, on the `/sessions` path | `{predictions, advisory, status, errors, modelInfo}` |
| `POST /predict/risk` | Spring's `GnnRiskClient`, on the older `/simulations` path | `{risk: {nodeId: 0..1}, model}` |
| `POST /generate/advisory` | Spring's `AdvisoryService`, same path | `{message, model}` |
| `GET /health` | Spring's health check | which inference path is live |

`/analyze` is the main one. It receives the venue graph, current density per zone, a window of
recent history and the run context, and returns risk plus prose in a single round trip.

Request and response shapes mirror the Java records in
`backend/src/main/java/com/crowdflow/dto/AnalyzeRequest.java` and `AnalyzeResponse.java`.
**If you change a field name in one, change it in the other — nothing checks.**

---

## Two inference paths

Every step runs against Hugging Face when it is configured, and against the offline model in
[`app/scoring.py`](app/scoring.py) when it is not. The choice is made **per step**: a working
GNN endpoint and a missing LLM one gives hosted risk with locally written prose.

Whichever answered is named in `modelInfo` on every response, so nobody has to guess.

### The offline model

Deliberately not a neural network, and it does not claim to be — it reports itself as
`local-linear`, never as a GNN. It is a one-hop linear propagation model over the same feature
columns the GNN trains on:

```
risk = 0.62·density + 0.28·neighbour_max_density + 0.35·density_delta
     + 0.08·trend   − 0.06·degree_norm
```

The `neighbour_max_density` term is the point. A per-zone threshold cannot see a packed
neighbour about to push crowd into you; this can, and that is the one thing the GNN exists to
learn. `degree_norm` is negative because a well-connected zone has more ways to shed crowd, so
the same density there is less dangerous than in a dead end.

The weights are hand-tuned against `sample-data/venue-layout-sample.json`, not learned. They
are the calibration knob — a venue whose coordinates or capacities are on a very different
scale may want them adjusted.

### Using Hugging Face instead

```bash
cp .env.example .env    # then fill in HF_API_TOKEN and the HF_*_URL you want
```

To make hosted inference mandatory — so a bad token returns 502 rather than quietly falling
back — set `CROWDFLOW_LOCAL_FALLBACK=false`.

---

## The `status` field

`/analyze` always answers with a full body. `status` is what lets Spring degrade instead of break:

- **`ok`** — both halves answered.
- **`partial`** — one did. The other key is empty and `errors` names which. Spring keeps the
  half it got: risk without prose, or prose without risk.
- **`failed`** — neither, returned with HTTP 502 so Spring falls back to its own mock and the
  session carries on showing measured density.

With the offline model enabled (the default) `failed` is unreachable. The state still exists
because a deployment pinned to hosted inference can absolutely reach it.

`422` is returned only for input the caller can fix — a duplicate node id, an edge pointing at
a node that does not exist, a negative density.

---

## Tests

```bash
.venv/Scripts/python -m pytest tests -q      # 8 checks, no token needed
.venv/Scripts/python -m app.scoring          # model self-check
```

The tests point the Hugging Face clients at a stub HTTP server started in-process, which covers
the parts that actually break: the request shapes sent, the response shapes accepted, cold-start
retries, and — the important one — that a dead model endpoint degrades instead of taking the
session down.
