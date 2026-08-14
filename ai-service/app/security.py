"""Shared-secret gate between the Spring backend and this service.

Every inference route here is expensive by design. ``/analyze`` fans out to two model calls,
and ``/layout/*`` runs OpenCV and OCR over an uploaded floor plan — hundreds of milliseconds
of CPU that the caller gets to spend for free. The service is also published on a port in
docker-compose, so "only the backend calls it" was a statement about intent rather than a
control: anything that could reach the port could spend that CPU, with no account, no rate
limit, and no way to tell one caller from another.

The gate is a shared secret in a header rather than anything richer because the only client
is another service we control. There is no user identity to carry, no session to establish,
and no third party to federate with, so a signed token would add key handling without adding
a property we need.

Unset means open. A clean checkout has to run with no configuration — that is the same
contract the rest of this service keeps for ``HF_API_TOKEN`` — so an absent token is a
supported development state, logged loudly at startup rather than treated as an error.
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import Header, HTTPException, status

log = logging.getLogger(__name__)

#: Shared with the backend as ML_SERVICE_TOKEN / AI_SERVICE_TOKEN. Read once at import.
SERVICE_TOKEN: str = os.environ.get("AI_SERVICE_TOKEN", "").strip()

HEADER_NAME = "X-Service-Token"


def describe() -> str:
    """One line for /health and the startup log."""
    return "required" if SERVICE_TOKEN else "not set (service is open)"


def warn_if_open() -> None:
    if not SERVICE_TOKEN:
        log.warning(
            "AI_SERVICE_TOKEN is not set — every inference endpoint is callable by anyone "
            "who can reach this port. Fine on a laptop; set it before exposing the service."
        )


async def require_service_token(
    x_service_token: str | None = Header(default=None, alias=HEADER_NAME),
) -> None:
    """
    Reject callers that cannot present the shared secret.

    Comparison is ``hmac.compare_digest`` rather than ``==``. A plain string comparison in
    CPython short-circuits on the first differing byte, so the time it takes leaks how much of
    a guess was correct, and a caller who can measure that can recover the token one byte at a
    time instead of brute-forcing the whole thing.
    """
    if not SERVICE_TOKEN:
        return

    if x_service_token is None or not hmac.compare_digest(x_service_token, SERVICE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Missing or invalid {HEADER_NAME}.",
        )
