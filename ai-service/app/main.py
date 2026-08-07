"""Crowd Flow Optimiser — AI orchestration layer (FastAPI).

    uvicorn app.main:app --reload --port 8000

Three endpoints, one model behind them:

* ``POST /analyze`` — the primary one. Spring sends the venue graph, current density, recent
  history and run context; this returns ``{predictions, advisory}``.
* ``POST /predict/risk`` — risk only, from density and trend. Used by the older
  ``/simulations`` flow-mode path in Spring.
* ``POST /generate/advisory`` — one sentence for one zone. Same caller.

Each inference step runs against the Hugging Face Inference API when ``HF_API_TOKEN`` and the
matching URL are set, and against the offline model in :mod:`app.scoring` otherwise. Nothing
is loaded at startup and nothing can fail to load, so the service is ready the moment the
process is up — see ``/health`` for which path is live.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.environ. Never commit that file — see README.md.
load_dotenv()

from app import scoring  # noqa: E402  (must follow load_dotenv)
from app.config import settings  # noqa: E402
from app.routers import advisory, analyze, risk  # noqa: E402

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("crowdflow.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Loads the in-process GNN if there is one, then says which path is actually live.

    The log line saves an hour of 'why is the advisory generic' during a demo. The load never
    raises: a missing checkpoint or an absent torch install is an expected state, reported at
    /health, not a reason the service will not start.
    """
    local_gnn.load()

    config = settings.describe()
    log.info(
        "AI service ready — GNN: %s | advisory: %s | local fallback: %s",
        "hugging face" if config["hostedGnn"]
        else f"in-process ({local_gnn.source})" if local_gnn.ready
        else scoring.MODEL_NAME,
        "hugging face" if config["hostedLlm"] else scoring.ADVISORY_MODEL_NAME,
        "on" if config["localFallback"] else "OFF (hosted inference is mandatory)",
    )
    yield


app = FastAPI(
    title="Crowd Flow Optimiser — AI Service",
    description=(
        "Predicts per-zone congestion risk and writes the operator advisory that goes with it. "
        "Called only by the Spring Boot backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router)
app.include_router(risk.router)
app.include_router(advisory.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    """
    Spring checks this before relying on the service.

    `status` is "ok" whenever at least one inference path can answer — which, with the local
    fallback on, is always. "degraded" means hosted inference is mandatory and unconfigured,
    so every /analyze will 502.
    """
    config = settings.describe()
    usable = config["localFallback"] or local_gnn.ready or (config["hostedGnn"] and config["hostedLlm"])
    return {
        "status": "ok" if usable else "degraded",
        "service": "crowdflow-ai",
        "inference": {
            "gnn": "huggingface" if config["hostedGnn"]
                   else "congestion-gnn" if local_gnn.ready
                   else scoring.MODEL_NAME,
            "advisory": "huggingface" if config["hostedLlm"] else scoring.ADVISORY_MODEL_NAME,
        },
        "localGnn": local_gnn.describe(),
        "config": config,
    }
