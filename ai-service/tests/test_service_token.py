"""Checks for the X-Service-Token gate in app/security.py.

The gate shipped without tests, and it is the only thing standing between an exposed port and
endpoints that run OpenCV and OCR on whatever they are handed. These pin the three cases that
matter: refused without the header, refused with the wrong value, and — the one most likely to
regress — /health staying open so the container healthcheck does not start failing the moment a
token is configured.

    cd ai-service
    python -m pytest tests/test_service_token.py -q
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import security
from app.main import app

TOKEN = "test-service-token"


@pytest.fixture
def guarded(monkeypatch):
    """A client with the gate switched on.

    `SERVICE_TOKEN` is read once at import, so this patches the module attribute rather than
    the environment — setting the variable here would be read by nothing.
    """
    monkeypatch.setattr(security, "SERVICE_TOKEN", TOKEN)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def open_service(monkeypatch):
    """A client with no token configured — the clean-checkout default."""
    monkeypatch.setattr(security, "SERVICE_TOKEN", "")
    with TestClient(app) as client:
        yield client


def test_a_request_without_the_token_is_refused(guarded):
    res = guarded.post("/predict/risk", json={})
    assert res.status_code == 401
    assert "X-Service-Token" in res.json()["detail"]


def test_a_request_with_the_wrong_token_is_refused(guarded):
    res = guarded.post("/predict/risk", json={}, headers={"X-Service-Token": "not-it"})
    assert res.status_code == 401


def test_the_right_token_reaches_the_endpoint(guarded):
    # An empty body is invalid for this endpoint, so a 422 is the endpoint answering — which is
    # the point. Anything other than 401 proves the gate let it through.
    res = guarded.post("/predict/risk", json={}, headers={"X-Service-Token": TOKEN})
    assert res.status_code != 401


def test_health_stays_open_so_the_container_healthcheck_still_works(guarded):
    # Gating this would make an authenticated service look permanently unhealthy, and compose
    # would never bring the backend up behind it.
    res = guarded.get("/health")
    assert res.status_code == 200
    assert res.json()["serviceToken"] == "required"


def test_nothing_is_gated_when_no_token_is_configured(open_service):
    assert open_service.post("/predict/risk", json={}).status_code != 401
    assert open_service.get("/health").json()["serviceToken"].startswith("not set")


def test_health_never_reports_the_token_itself(guarded):
    # It says whether a secret is present, never what it is — same contract as HF_API_TOKEN.
    assert TOKEN not in guarded.get("/health").text
