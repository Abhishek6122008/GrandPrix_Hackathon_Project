"""Crowd Flow Optimiser — AI orchestration layer.

    uvicorn app.main:app --reload --port 8000

Two routes into the same job, and they exist for different days:

* ``POST /analyze`` is the primary one the Spring backend calls. It takes the venue graph,
  current density, recent history and run context, calls the Hugging Face Inference API for
  the GNN and then the LLM, and returns ``{predictions, advisory}``. Needs a token and a
  network.
* ``POST /predict/risk`` and ``POST /generate/advisory`` are the self-hosted path: models
  loaded once at startup into this process, no network at inference time. This is the
  demo-day safety net for when the venue wifi or a cold HF endpoint is not cooperating.

A self-hosted model that fails to load does not stop the service: /health reports it, the
matching endpoint returns 503, and the Spring backend falls back to its own mock. /analyze is
independent of both — it degrades on its own terms, see app/routers/analyze.py.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.environ. Never commit that file — see README.md.
load_dotenv()

from app.models.advisory_gen import advisory_model  # noqa: E402  (must follow load_dotenv)
from app.models.gnn_risk import gnn_risk_model  # noqa: E402
from app.routers import advisory, analyze, risk  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    gnn_risk_model.load()
    advisory_model.load()
    yield
    # Nothing to release — the models are freed with the process.


app = FastAPI(title="Crowd Flow Optimiser ML Service", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router)
app.include_router(risk.router)
app.include_router(advisory.router)


@app.get("/health")
def health() -> dict:
    """
    Spring checks this before relying on the service. `status` is "ok" only when both
    models loaded; "degraded" means the service is up but at least one endpoint will 503.
    """
    hf = {
        "gnn_url_set": bool(os.environ.get("HF_GNN_URL", "").strip()),
        "llm_url_set": bool(os.environ.get("HF_LLM_URL", "").strip()),
        # Deliberately reports presence, never the value.
        "token_set": bool(os.environ.get("HF_API_TOKEN", "").strip()),
    }
    models = {
        "gnn_risk": {
            "loaded": gnn_risk_model.loaded,
            "checkpoint": str(gnn_risk_model.checkpoint),
            "error": gnn_risk_model.error,
        },
        "advisory": {
            "loaded": advisory_model.loaded,
            "model_id": advisory_model.model_id,
            "error": advisory_model.error,
        },
    }
    every_model_up = all(m["loaded"] for m in models.values())
    analyze_configured = all(hf.values())
    # "ok" needs at least one working path: self-hosted models, or a configured /analyze.
    return {
        "status": "ok" if (every_model_up or analyze_configured) else "degraded",
        "models": models,
        "analyze": {"configured": analyze_configured, **hf},
    }
