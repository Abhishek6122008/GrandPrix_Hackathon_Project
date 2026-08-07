"""Request/response models for POST /generate/advisory."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Trend = Literal["RISING", "FLAT", "FALLING"]


class AdvisoryRequest(BaseModel):
    node: str = Field(description="Zone name if known, otherwise its id")
    density: float = Field(ge=0.0)
    trend: Trend = "FLAT"
    reroutePath: list[str] = Field(
        default_factory=list,
        description="Node ids from the congested zone to the suggested one; empty when there is nowhere to send people",
    )


class AdvisoryResponse(BaseModel):
    message: str
    model: str = Field(description="Which model answered, for display in the demo")
