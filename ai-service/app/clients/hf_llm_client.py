"""Calls the Hugging Face Inference API for the advisory text-generation model.

Shares the retry/backoff machinery with the GNN client rather than duplicating it — the
failure modes (cold start, rate limit, timeout) are identical, and having two copies would
mean fixing cold-start handling twice.
"""

from __future__ import annotations

import os
from typing import Any

from app.clients.hf_gnn_client import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    HfResult,
    _env_float,
    _env_int,
    _post_with_retry,
)

DEFAULT_MAX_NEW_TOKENS = 90


async def generate_advisory(prompt: str) -> HfResult:
    """
    Sends the prompt built by `preprocessing.build_advisory_prompt` and returns the raw
    generated text in `HfResult.value`. Trimming and shaping happen in postprocessing —
    this layer's only job is to get bytes back or say why it could not.
    """
    url = os.environ.get("HF_LLM_URL", "").strip()
    token = os.environ.get("HF_API_TOKEN", "").strip()
    if not url:
        return HfResult(error="HF_LLM_URL is not set")
    if not token:
        return HfResult(error="HF_API_TOKEN is not set")

    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": _env_int("HF_LLM_MAX_NEW_TOKENS", DEFAULT_MAX_NEW_TOKENS),
            "temperature": 0.3,  # low: this is an instruction, not a poem
            "return_full_text": False,
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

    text = _extract_text(result.value)
    if not text:
        return HfResult(error=f"unexpected LLM response shape: {str(result.value)[:200]}")

    return HfResult(value=text, model=os.environ.get("HF_LLM_MODEL", url))


def _extract_text(body: Any) -> str | None:
    """
    Unwraps the several shapes HF text-generation answers in: a list of
    `{"generated_text": ...}`, a bare object, a chat-completions envelope, or a plain string.
    """
    if isinstance(body, str):
        return body.strip() or None
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict):
        for key in ("generated_text", "summary_text", "text"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        # OpenAI-shaped chat endpoints on HF routers.
        choices = body.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") or {}
            content = message.get("content") or choices[0].get("text")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return None
