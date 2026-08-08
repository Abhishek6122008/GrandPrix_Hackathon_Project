"""Checks for POST /analyze.

Runs without a Hugging Face token. The two model calls are pointed at a stub HTTP server
started in-process, which is enough to prove the parts that actually break: the request
shapes we send, the response shapes we accept, and — the important one — that a dead model
endpoint degrades instead of taking the session down.

    cd ml-service
    .venv/Scripts/python -m pytest tests -q      # or: python -m pytest tests -q
"""

from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

STUB_PORT = 8799
STUB = f"http://127.0.0.1:{STUB_PORT}"

VENUE_REQUEST = {
    "sessionId": "sess-test",
    "tick": 40,
    "graph": {
        "nodes": [
            {"id": "gate-a", "name": "Gate A", "type": "GATE", "capacity": 320, "x": 60, "y": 120},
            {"id": "walk", "name": "Walkway", "type": "WALKWAY", "capacity": 500, "x": 220, "y": 140},
            {"id": "exit-e", "name": "Exit East", "type": "EXIT", "capacity": 400, "x": 680, "y": 160},
        ],
        "edges": [
            {"source": "gate-a", "target": "walk", "length": 25, "width": 6},
            {"source": "walk", "target": "exit-e", "length": 18, "width": 8},
        ],
    },
    "density": {"gate-a": 0.93, "walk": 0.44, "exit-e": 0.05},
    "history": [
        {"tick": 28, "density": {"gate-a": 0.61, "walk": 0.40, "exit-e": 0.03}},
        {"tick": 34, "density": {"gate-a": 0.80, "walk": 0.42, "exit-e": 0.04}},
    ],
    "context": {
        "venueName": "Grandprix Arena",
        "tickSeconds": 1.0,
        "crowdSize": 4200,
        "peopleInside": 1180,
        "pendingArrivals": 3020,
        "status": "RUNNING",
        "rerouteEnabled": True,
        "trends": {"gate-a": "RISING", "walk": "FLAT", "exit-e": "FLAT"},
        "highRiskNodeIds": ["gate-a"],
    },
}


# --------------------------------------------------------------------- stub HF endpoints

def _build_stub() -> FastAPI:
    """Stands in for the two Hugging Face endpoints, including a cold-start 503 on first call."""
    stub = FastAPI()
    state = {"gnn_calls": 0}

    @stub.post("/gnn")
    async def gnn(request: Request):
        state["gnn_calls"] += 1
        body = await request.json()
        node_count = len(body["inputs"]["node_ids"])
        if state["gnn_calls"] == 1:
            # First call cold-starts, exactly as the serverless API does. The client must
            # retry this rather than reporting a failure.
            return JSONResponse(status_code=503, content={"estimated_time": 0.2})
        return [round(0.3 + 0.2 * i, 3) for i in range(node_count)]

    @stub.post("/llm")
    async def llm():
        return [{"generated_text": "Hold intake at Gate A and open the north lane.\n- Divert to Walkway\n"}]

    return stub


@contextmanager
def stub_server():
    server = uvicorn.Server(uvicorn.Config(_build_stub(), host="127.0.0.1", port=STUB_PORT, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):  # ~5s ceiling; the server binds in well under that
        if server.started:
            break
        time.sleep(0.05)
    try:
        yield
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@contextmanager
def hf_env(**overrides: str):
    """Sets HF_* for one test and puts the environment back afterwards."""
    previous = {key: os.environ.get(key) for key in overrides}
    os.environ.update(overrides)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


@pytest.fixture
def without_in_process_models():
    """
    Forces TinyBERT and the trained GNN off for one test, leaving only the linear fallback.

    Needed because these tests must assert the *same* thing on every machine, and whether
    either model answers depends on what a gitignored `.env` happens to say and whether torch
    happens to be installed. Without this, enabling a model silently changes what the suite is
    testing rather than failing loudly.
    """
    from app.gnn_local import local_gnn
    from app.tinybert_local import tinybert_risk

    was_ready = (tinybert_risk.ready, local_gnn.ready)
    tinybert_risk.ready = local_gnn.ready = False
    try:
        yield
    finally:
        tinybert_risk.ready, local_gnn.ready = was_ready


# --------------------------------------------------------------------- the checks

def test_returns_predictions_and_advisory_when_both_models_answer(client):
    with stub_server(), hf_env(
        HF_API_TOKEN="test-token",
        HF_GNN_URL=f"{STUB}/gnn",
        HF_LLM_URL=f"{STUB}/llm",
        HF_MAX_RETRIES="2",
        HF_TIMEOUT_SECONDS="5",
    ):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok", body["errors"]

    # One prediction per node, clamped, worst first.
    assert {p["nodeId"] for p in body["predictions"]} == {"gate-a", "walk", "exit-e"}
    risks = [p["risk"] for p in body["predictions"]]
    assert risks == sorted(risks, reverse=True)
    assert all(0.0 <= r <= 1.0 for r in risks)

    assert "Gate A" in body["advisory"]["headline"]
    assert body["advisory"]["message"]
    assert body["advisory"]["actions"] == ["Divert to Walkway"]


def test_answers_from_the_local_model_when_hugging_face_is_not_configured(client, without_in_process_models):
    """
    The default path, and the one the demo actually runs on: no token, no network, still a
    full answer. This is what makes the whole stack work on conference wifi.
    """
    with hf_env(HF_API_TOKEN="", HF_GNN_URL="", HF_LLM_URL=""):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok", body["errors"]

    assert {p["nodeId"] for p in body["predictions"]} == {"gate-a", "walk", "exit-e"}
    # Gate A is 93% full and rising; it must come out worst of the three.
    assert body["predictions"][0]["nodeId"] == "gate-a"

    assert "Gate A" in body["advisory"]["headline"]
    assert body["advisory"]["message"]
    # The response says plainly which model answered, so nobody mistakes this for the GNN.
    assert body["modelInfo"]["gnn"] == "local-linear"
    assert body["modelInfo"]["llm"] == "local-template"


def test_degrades_to_failed_with_a_full_body_when_hosted_inference_is_mandatory(client, without_in_process_models):
    """
    The contract Spring depends on: a clear error, not a hang and not a 500.

    Only reachable with the local fallback switched off — a deployment that would rather fail
    loudly than serve a linear model's answer.
    """
    with hf_env(
        HF_API_TOKEN="", HF_GNN_URL="", HF_LLM_URL="", CROWDFLOW_LOCAL_FALLBACK="false"
    ):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 502
    body = response.json()
    assert body["status"] == "failed"
    assert body["predictions"] == []
    assert body["advisory"] is None
    assert {e["stage"] for e in body["errors"]} == {"gnn", "llm"}


def test_partial_when_only_the_gnn_is_down_and_there_is_no_fallback(client, without_in_process_models):
    """Advisory survives a dead GNN — it falls back to measured density for the prompt."""
    with stub_server(), hf_env(
        HF_API_TOKEN="test-token",
        HF_GNN_URL=f"{STUB}/nonexistent",
        HF_LLM_URL=f"{STUB}/llm",
        HF_MAX_RETRIES="0",
        HF_TIMEOUT_SECONDS="5",
        CROWDFLOW_LOCAL_FALLBACK="false",
    ):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "partial"
    assert body["predictions"] == []
    assert body["advisory"]["message"]
    assert [e["stage"] for e in body["errors"]] == ["gnn"]


def test_a_dead_hosted_gnn_falls_through_to_the_local_model(client, without_in_process_models):
    """Hosted risk fails, local risk answers, hosted prose still works — the mixed path."""
    with stub_server(), hf_env(
        HF_API_TOKEN="test-token",
        HF_GNN_URL=f"{STUB}/nonexistent",
        HF_LLM_URL=f"{STUB}/llm",
        HF_MAX_RETRIES="0",
        HF_TIMEOUT_SECONDS="5",
    ):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["predictions"], "local model should have filled in for the dead endpoint"
    assert body["modelInfo"]["gnn"] == "local-linear"
    # The advisory still came from the stub, so both halves are independently sourced.
    assert body["advisory"]["actions"] == ["Divert to Walkway"]


def test_tinybert_answers_and_takes_priority_when_it_is_enabled(client):
    """
    The beta path: CROWDFLOW_TINYBERT=true makes TinyBERT the model behind /analyze, ahead of
    the trained GNN and the linear fallback.

    Skipped when it is not enabled — the suite must be green on a checkout that has never set
    the flag or installed transformers, which is the default.

    Loads the model itself rather than relying on the app's startup hook: `TestClient(app)`
    outside a `with` block never runs the lifespan, so without this the check would skip even
    with the flag on — passing green while testing nothing.
    """
    from app.tinybert_local import tinybert_risk

    if not tinybert_risk.ready:
        tinybert_risk.load()
    if not tinybert_risk.ready:
        pytest.skip(f"TinyBERT not loaded ({tinybert_risk.error})")

    with hf_env(HF_API_TOKEN="", HF_GNN_URL="", HF_LLM_URL=""):
        response = client.post("/analyze", json=VENUE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok", body["errors"]
    assert body["modelInfo"]["gnn"].startswith("tinybert"), body["modelInfo"]

    risk = {p["nodeId"]: p["risk"] for p in body["predictions"]}
    assert set(risk) == {"gate-a", "walk", "exit-e"}
    assert all(0.0 <= v <= 1.0 for v in risk.values())

    # The embedding term is only 30% of the score, so the feature half still has to carry the
    # ordering: the gate at 93% must outrank the exit at 5%.
    assert risk["gate-a"] > risk["exit-e"], risk


def test_risk_and_advisory_endpoints_answer_without_any_model_configured(client):
    """/predict/risk and /generate/advisory used to 503 unconditionally. They must not."""
    risk = client.post("/predict/risk", json={
        "nodes": [
            {"id": "gate-a", "density": 0.93, "trend": "RISING"},
            {"id": "walk", "density": 0.44, "trend": "FLAT"},
        ],
        "edges": [{"source": "gate-a", "target": "walk"}],
    })
    assert risk.status_code == 200
    body = risk.json()
    assert set(body["risk"]) == {"gate-a", "walk"}
    assert body["risk"]["gate-a"] > body["risk"]["walk"]

    advisory = client.post("/generate/advisory", json={
        "node": "Gate A", "density": 0.93, "trend": "RISING", "reroutePath": ["gate-a", "walk"],
    })
    assert advisory.status_code == 200
    assert "Gate A" in advisory.json()["message"]


def test_rejects_an_edge_pointing_at_a_node_that_does_not_exist(client):
    broken = {**VENUE_REQUEST, "graph": {
        "nodes": VENUE_REQUEST["graph"]["nodes"],
        "edges": [{"source": "gate-a", "target": "ghost", "length": 5, "width": 2}],
    }}
    response = client.post("/analyze", json=broken)

    assert response.status_code == 422
    assert "ghost" in response.json()["detail"]


def test_feature_matrix_has_one_row_per_node_in_declared_column_order():
    from app.schemas.analyze_schema import AnalyzeRequest
    from app.services.preprocessing import FEATURE_COLUMNS, build_features

    features = build_features(AnalyzeRequest(**VENUE_REQUEST))

    assert features.node_ids == ["gate-a", "walk", "exit-e"]
    assert all(len(row) == len(FEATURE_COLUMNS) for row in features.features)
    # edge_index is [sources, targets] as parallel index columns.
    assert features.edge_index == [[0, 1], [1, 2]]

    gate = features.features[0]
    assert gate[FEATURE_COLUMNS.index("density")] == pytest.approx(0.93)
    assert gate[FEATURE_COLUMNS.index("trend")] == 1.0  # RISING
    # Density climbed 0.61 -> 0.93 across the history window; that delta is the whole point.
    assert gate[FEATURE_COLUMNS.index("density_delta")] == pytest.approx(0.32)
