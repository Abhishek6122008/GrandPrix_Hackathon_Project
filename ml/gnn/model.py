"""Congestion-propagation GNN.

Given every node's current density and the venue graph, predict each node's density
HORIZON ticks ahead. Message passing is the point: a gate backing up should raise the
predicted risk of the walkway feeding it, which a per-node regressor cannot see.

Stub status: the shape below is a plain 2-layer GraphSAGE. Swap in the real architecture
once we know how far congestion actually propagates in the generated data.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torch_geometric.nn import SAGEConv

# Node features produced by data/generate_synthetic_runs.py.
FEATURE_COLUMNS = ["density", "neighbour_max_density", "arrival_rate", "reroute"]
IN_CHANNELS = len(FEATURE_COLUMNS)


class CongestionGNN(nn.Module):
    """Regresses density HORIZON ticks ahead, one value per node."""

    def __init__(self, in_channels: int = IN_CHANNELS, hidden: int = 64, layers: int = 2):
        super().__init__()
        # TODO(day 2): try GATConv instead — attention over neighbours is a better fit for
        # "which adjacent zone is actually pushing crowd into me", and it gives us
        # interpretable weights to show in the demo.
        self.convs = nn.ModuleList()
        self.convs.append(SAGEConv(in_channels, hidden))
        for _ in range(layers - 1):
            self.convs.append(SAGEConv(hidden, hidden))
        self.head = nn.Linear(hidden, 1)
        self.activation = nn.ReLU()

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        """x: [num_nodes, IN_CHANNELS], edge_index: [2, num_edges] -> [num_nodes] in [0,1]."""
        for conv in self.convs:
            x = self.activation(conv(x, edge_index))
        # TODO(day 3): add edge weights (walkway width) — a wide corridor propagates
        # congestion differently from a narrow one, and right now the model cannot tell.
        return torch.sigmoid(self.head(x)).squeeze(-1)


def load_checkpoint(path: str, device: str = "cpu") -> CongestionGNN:
    model = CongestionGNN()
    model.load_state_dict(torch.load(path, map_location=device))
    model.eval()
    return model
