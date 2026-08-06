"""Crowd Flow Optimiser — self-hosted ML serving layer.

    uvicorn app.main:app --reload --port 8000

Both models load once here at startup, not per request, and inference runs in this
process. Nothing calls the Hugging Face Inference API at request time.

A model that fails to load does not stop the service: /health reports it, the matching
endpoint returns 503, and the Spring backend falls back to its own mock. That keeps the
demo alive when a checkpoint is missing or a download has not finished.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models.advisory_gen import advisory_model
from app.models.gnn_risk import gnn_risk_model
from app.routers import advisory, risk


@asynccontextmanager
async def lifespan(app: FastAPI):
    gnn_risk_model.load()
    advisory_model.load()
    yield
    # Nothing to release — the models are freed with the process.


app = FastAPI(title="Crowd Flow Optimiser ML Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(risk.router)
app.include_router(advisory.router)


@app.get("/health")
def health() -> dict:
    """
    Spring checks this before relying on the service. `status` is "ok" only when both
    models loaded; "degraded" means the service is up but at least one endpoint will 503.
    """
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
    return {"status": "ok" if every_model_up else "degraded", "models": models}
