"""Calls the Hugging Face Inference API for the congestion-propagation GNN.

Endpoint and token come from the environment, never from code — see ml-service/README.md and
.env.example for the variable names.

Returns a `HfResult` instead of raising. A failed model call is an expected, survivable state
in this system: Spring is built to keep showing measured density when prediction is missing,
and it can only do that if the failure arrives as data.
"""

from __future__ import annotations

import asyncio
import os
import random
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_TIMEOUT_SECONDS = 12.0
DEFAULT_MAX_RETRIES = 2
#: HF returns these while a serverless endpoint cold-starts or is rate limited.
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


@dataclass
class HfResult:
    """Either `value` is set, or `error` is. Never both, never neither."""

    value: Any = None
    error: str | None = None
    model: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


async def _post_with_retry(url: str, token: str, payload: dict, timeout: float, max_retries: int) -> HfResult:
    """
    One POST, retried on timeouts, transport errors and the cold-start status codes.

    Backoff is exponential with jitter, and honours HF's own `estimated_time` when it tells us
    how long the model needs to load — sleeping the amount it asked for beats guessing.
    """
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    last_error = "no attempt made"

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(max_retries + 1):
            try:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code == 200:
                    return HfResult(value=response.json())

                body = response.text[:300]
                last_error = f"HTTP {response.status_code}: {body}"
                if response.status_code not in RETRYABLE_STATUS or attempt == max_retries:
                    return HfResult(error=last_error)

                wait = _cold_start_wait(response, timeout)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt == max_retries:
                    return HfResult(error=last_error)
                wait = None
            except ValueError as exc:  # JSON that is not JSON
                return HfResult(error=f"malformed response body: {exc}")

            if wait is None:
                wait = min(8.0, (2**attempt) * 0.5 + random.uniform(0, 0.3))
            await asyncio.sleep(wait)

    return HfResult(error=last_error)


def _cold_start_wait(response: httpx.Response, timeout: float) -> float | None:
    """HF 503s carry `estimated_time` (seconds) while a model loads. Capped so we still fail fast."""
    try:
        estimated = float(response.json().get("estimated_time", 0))
    except (ValueError, AttributeError, TypeError):
        return None
    return min(estimated, timeout) if estimated > 0 else None


async def predict_risk(node_ids: list[str], features: list[list[float]],
                       edge_index: list[list[int]]) -> HfResult:
    """
    Asks the GNN for per-node congestion risk.

    Returns `HfResult.value` as `{node_id: risk}` on success. The endpoint is expected to
    answer with either a bare list of scores in node order, or an object carrying one — both
    shapes are accepted because HF wraps custom handlers inconsistently.
    """
    url = os.environ.get("HF_GNN_URL", "").strip()
    token = os.environ.get("HF_API_TOKEN", "").strip()
    if not url:
        return HfResult(error="HF_GNN_URL is not set")
    if not token:
        return HfResult(error="HF_API_TOKEN is not set")

    payload = {
        "inputs": {
            "node_ids": node_ids,
            "features": features,
            "edge_index": edge_index,
        },
        "options": {"wait_for_model": True},
    }
    result = await _post_with_retry(
        url,
        token,
        payload,
        _env_float("HF_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS),
        _env_int("HF_MAX_RETRIES", DEFAULT_MAX_RETRIES),
    )
    if not result.ok:
        return result

    scores = _extract_scores(result.value)
    if scores is None:
        return HfResult(error=f"unexpected GNN response shape: {str(result.value)[:200]}")
    if len(scores) != len(node_ids):
        return HfResult(error=f"GNN returned {len(scores)} scores for {len(node_ids)} nodes")

    return HfResult(value=dict(zip(node_ids, scores)), model=os.environ.get("HF_GNN_MODEL", url))


def _extract_scores(body: Any) -> list[float] | None:
    """Pulls a flat list of floats out of whatever the endpoint wrapped them in."""
    if isinstance(body, dict):
        for key in ("risk", "scores", "predictions", "outputs"):
            if key in body:
                body = body[key]
                break
    if isinstance(body, list) and body and isinstance(body[0], list):
        body = [row[0] for row in body]  # [[0.1],[0.2]] -> [0.1,0.2]
    if isinstance(body, list) and all(isinstance(v, (int, float)) for v in body):
        return [float(v) for v in body]
    return None
