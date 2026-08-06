"""Loads and wraps the congestion-propagation GNN.

Self-hosted: the checkpoint is loaded into this process once at startup and inference runs
locally. No calls to the Hugging Face Inference API at request time.

The architecture is imported from ml/gnn/model.py rather than redefined here — one
definition, so training and serving cannot drift apart.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# ml/gnn is a sibling of this service, not an installed package.
ML_GNN_DIR = Path(__file__).resolve().parents[3] / "ml" / "gnn"
if str(ML_GNN_DIR) not in sys.path:
    sys.path.insert(0, str(ML_GNN_DIR))

DEFAULT_CHECKPOINT = Path(__file__).resolve().parents[3] / "ml" / "out" / "congestion_gnn.pt"


class GnnRiskModel:
    """Holds the loaded model. `loaded` is False until `load()` succeeds."""

    def __init__(self) -> None:
        self.model = None
        self.loaded = False
        self.error: str | None = None
        self.checkpoint = Path(os.environ.get("CROWDFLOW_GNN_CHECKPOINT", DEFAULT_CHECKPOINT))

    def load(self) -> None:
        """Called once from the FastAPI lifespan. Never raises — /health reports the failure."""
        try:
            import torch  # noqa: F401  (imported for its side effect of validating the install)
            from model import CongestionGNN, load_checkpoint  # from ml/gnn/model.py

            if not self.checkpoint.exists():
                raise FileNotFoundError(
                    f"no checkpoint at {self.checkpoint} — run ml/gnn/train_gnn.py first"
                )
            self.model = load_checkpoint(str(self.checkpoint))
            self.loaded = True
        except Exception as exc:  # noqa: BLE001 — startup must not die on a missing model
            self.error = f"{type(exc).__name__}: {exc}"
            self.loaded = False

    def predict(self, nodes, edges) -> dict[str, float]:
        """
        nodes: list[RiskNode], edges: list[RiskEdge] -> {node_id: risk in [0,1]}.

        TODO: build the feature matrix in FEATURE_COLUMNS order (density,
        neighbour_max_density, trend), build edge_index from the node ordering, run the
        model, and zip the output back onto node ids.
        """
        raise NotImplementedError("GNN inference not implemented yet")


# Module-level singleton, populated by the lifespan handler in main.py.
gnn_risk_model = GnnRiskModel()
