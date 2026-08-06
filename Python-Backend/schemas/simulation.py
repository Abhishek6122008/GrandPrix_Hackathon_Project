# ============================================================
# schemas/simulation.py
# Pydantic models for request / response validation.
# Spring Boot talks to FastAPI through these contracts.
# ============================================================

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared sub-models
# ---------------------------------------------------------------------------


class NodeInfo(BaseModel):
    """Static node metadata sent at init time."""

    id: int = Field(..., description="Unique node identifier")
    name: str = Field(..., description="Human-readable node name (e.g. 'Entrance')")
    capacity: int = Field(..., gt=0, description="Maximum crowd capacity")
    area: float = Field(..., gt=0, description="Physical area in square metres")


class NodeFeature(BaseModel):
    """Dynamic node features sent on every analyze call."""

    nodeId: int = Field(..., description="Must match a node id from init")
    population: int = Field(..., ge=0, description="Current number of people")
    capacity: int = Field(..., gt=0, description="Maximum capacity of the node")
    density: float = Field(..., ge=0.0, le=1.0, description="Current occupancy ratio")
    entryRate: float = Field(..., ge=0.0, description="People entering per second")
    exitRate: float = Field(..., ge=0.0, description="People exiting per second")
    averageSpeed: float = Field(..., ge=0.0, description="Average crowd speed m/s")
    neighborDensity: float = Field(
        ..., ge=0.0, le=1.0, description="Average density of adjacent nodes"
    )
    queueLength: int = Field(..., ge=0, description="Current queue length")


class AlertItem(BaseModel):
    """A single alert generated for one node."""

    nodeId: int
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    riskScore: float = Field(..., ge=0.0, le=1.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    predictedInSeconds: int = Field(..., ge=0)
    recommendedRoute: str
    message: str


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class InitRequest(BaseModel):
    """Payload for POST /simulation/init"""

    simulationId: str = Field(..., description="Unique identifier for this simulation")
    nodes: list[NodeInfo] = Field(..., min_length=1)
    edges: list[list[int]] = Field(
        ..., description="List of [source, target] node-id pairs"
    )


class AnalyzeRequest(BaseModel):
    """Payload for POST /simulation/analyze"""

    simulationId: str
    timestamp: int = Field(..., ge=0, description="Simulation tick / time in seconds")
    nodeFeatures: list[NodeFeature] = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class InitResponse(BaseModel):
    status: str
    message: str


class AnalyzeResponse(BaseModel):
    alerts: list[AlertItem]


class DeleteResponse(BaseModel):
    status: str
    message: str
