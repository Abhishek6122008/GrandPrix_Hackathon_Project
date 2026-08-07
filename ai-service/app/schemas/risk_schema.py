"""Request/response models for POST /predict/risk."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Trend = Literal["RISING", "FLAT", "FALLING"]

# Numeric encoding fed to the GNN. Must match ml/data/generate_synthetic_runs.py.
TREND_ENCODING: dict[str, float] = {"FALLING": -1.0, "FLAT": 0.0, "RISING": 1.0}


class RiskNode(BaseModel):
    id: str
    density: float = Field(ge=0.0, description="occupancy / capacity; may exceed 1 if overfilled")
    trend: Trend = "FLAT"


class RiskEdge(BaseModel):
    source: str
    target: str


class RiskRequest(BaseModel):
    nodes: list[RiskNode] = Field(min_length=1)
    edges: list[RiskEdge] = Field(default_factory=list)


class RiskResponse(BaseModel):
    """Predicted congestion risk in [0,1] per node, a few ticks ahead."""

    risk: dict[str, float]
    model: str = Field(description="Which model answered, for display in the demo")
