"""Inference handler for the Hugging Face Endpoint that serves the congestion GNN.

Hugging Face calls `EndpointHandler(path)(payload)` for every request. This file is uploaded
alongside the checkpoint by `export_to_hf.py`; without it the endpoint has no idea how to turn
a venue graph into a tensor and the deployment answers 400 to everything.

The wire format is dictated by the caller, `ai-service/app/clients/hf_gnn_client.py`:

    request   {"inputs": {"node_ids": [...], "features": [[...], ...], "edge_index": [[src...],[tgt...]]}}
    response  {"risk": {node_id: float}}

`features` rows are already in FEATURE_COLUMNS order — the service builds them that way — so
this handler must not reorder or renormalise them. Its whole job is tensor plumbing.

Note `edge_index` arrives as two parallel rows (all sources, then all targets), which is
PyTorch Geometric's own [2, num_edges] layout, not a list of pairs.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import torch

from model import FEATURE_COLUMNS, CongestionGNN

CHECKPOINT_NAME = "congestion_gnn.pt"


class EndpointHandler:
    def __init__(self, path: str = "") -> None:
        checkpoint = Path(path or os.getcwd()) / CHECKPOINT_NAME
        if not checkpoint.exists():
            raise FileNotFoundError(f"no {CHECKPOINT_NAME} beside the handler at {path}")

        self.model = CongestionGNN()
        self.model.load_state_dict(torch.load(checkpoint, map_location="cpu"))
        self.model.eval()

    def __call__(self, data: dict[str, Any]) -> dict[str, Any]:
        inputs = data.get("inputs") or {}
        node_ids = inputs.get("node_ids") or []
        features = inputs.get("features") or []
        edge_index = inputs.get("edge_index") or [[], []]

        if not node_ids:
            return {"error": "node_ids is empty"}
        if len(features) != len(node_ids):
            return {"error": f"{len(features)} feature rows for {len(node_ids)} nodes"}

        width = len(FEATURE_COLUMNS)
        bad = [i for i, row in enumerate(features) if len(row) != width]
        if bad:
            # Caught here rather than left to fail inside the model, where it surfaces as an
            # opaque shape error with no mention of which column list is wrong.
            return {
                "error": f"rows {bad[:5]} have the wrong width; expected {width} "
                         f"columns in order {list(FEATURE_COLUMNS)}"
            }

        x = torch.tensor(features, dtype=torch.float)
        edges = torch.tensor(edge_index, dtype=torch.long)
        if edges.numel() == 0:
            # A venue with no edges is legal — an isolated node still has a density to predict.
            # Message passing simply has nothing to pass, so hand the model an empty [2, 0].
            edges = torch.zeros((2, 0), dtype=torch.long)
        elif edges.shape[0] != 2:
            return {"error": f"edge_index must be [2, num_edges], got {list(edges.shape)}"}
        elif int(edges.max()) >= len(node_ids):
            return {"error": "edge_index references a node beyond the end of node_ids"}

        with torch.no_grad():
            scores = self.model(x, edges)

        return {"risk": {node_id: float(score) for node_id, score in zip(node_ids, scores)}}


def _demo() -> None:
    """Runnable check: `python handler.py`, from a directory holding the checkpoint."""
    handler = EndpointHandler(str(Path(__file__).resolve().parents[1] / "out"))

    payload = {
        "inputs": {
            "node_ids": ["gate-a", "walk", "exit-e"],
            # density, trend, capacity_norm, degree_norm, neighbour_max_density, density_delta
            "features": [
                [0.93, 1.0, 0.35, 0.20, 0.44, 0.32],
                [0.44, 0.0, 0.55, 1.00, 0.93, 0.04],
                [0.05, 0.0, 0.44, 0.40, 0.44, 0.01],
            ],
            "edge_index": [[0, 1], [1, 2]],
        }
    }
    out = handler(payload)
    assert "risk" in out, out
    assert set(out["risk"]) == {"gate-a", "walk", "exit-e"}
    assert all(0.0 <= v <= 1.0 for v in out["risk"].values()), out

    # A malformed row must be named, not crash the endpoint.
    broken = {"inputs": {**payload["inputs"], "features": [[0.1, 0.2]] * 3}}
    assert "error" in handler(broken)

    # An empty graph is legal.
    solo = {"inputs": {"node_ids": ["a"], "features": [[0.5, 0, 1, 0, 0, 0]], "edge_index": [[], []]}}
    assert "risk" in handler(solo), handler(solo)

    print("handler self-check passed:", out["risk"])


if __name__ == "__main__":
    _demo()
