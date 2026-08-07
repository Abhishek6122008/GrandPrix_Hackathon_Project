"""Train the congestion-propagation GNN on synthetic runs.

    python ../data/generate_synthetic_runs.py --runs 300
    python train_gnn.py --data ../out --epochs 50

Stub status: the loop below is real but deliberately plain — MSE, Adam, no scheduler,
no early stopping, no validation split beyond a holdout on run_id. Tighten it once the
architecture in model.py settles.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
import torch
from torch_geometric.data import Data

from model import FEATURE_COLUMNS, CongestionGNN


def load_graph(data_dir: Path) -> tuple[list[str], torch.Tensor]:
    graph = json.loads((data_dir / "graph.json").read_text(encoding="utf-8"))
    edge_index = torch.tensor(graph["edge_index"], dtype=torch.long).t().contiguous()
    return graph["node_ids"], edge_index


def to_snapshots(frame: pd.DataFrame, node_ids: list[str], edge_index: torch.Tensor) -> list[Data]:
    """One PyG Data object per (run, tick): all nodes of the venue at that instant."""
    snapshots = []
    for _, group in frame.groupby(["run_id", "tick"], sort=False):
        ordered = group.set_index("node_id").reindex(node_ids)
        x = torch.tensor(ordered[FEATURE_COLUMNS].to_numpy(), dtype=torch.float)
        y = torch.tensor(ordered["density_ahead"].to_numpy(), dtype=torch.float)
        snapshots.append(Data(x=x, edge_index=edge_index, y=y))
    return snapshots


#: A zone is "in trouble" at or above this density. Mirrors `simulation.critical-threshold`
#: in the backend's application.yml — the metric below is only meaningful if it scores the
#: model against the same line the running system alerts on.
CRITICAL = 0.85


def report(model: CongestionGNN, val_set: list[Data]) -> None:
    """
    Scores the model the way the demo will be judged, not the way the loss function sees it.

    MSE answers "how close are the numbers on average", which is dominated by the many quiet
    zones sitting near zero and says nothing about the only case anyone cares about: did we
    see the crush coming. So this reports, over the held-out runs:

      * recall    — of the zones that really did go critical HORIZON ticks later, how many did
                    the model flag in advance. Missing one of these is the failure that matters.
      * precision — of the zones it flagged, how many really did. Low precision means crying
                    wolf, which gets an operator to start ignoring the system.

    Compared against a persistence baseline ("assume every zone stays exactly as it is"), which
    is the honest bar: on a slow-moving venue that baseline is already decent, and a model that
    cannot beat it has learned nothing worth deploying.
    """
    model.eval()
    stats = {"tp": 0, "fp": 0, "fn": 0}
    base = {"tp": 0, "fp": 0, "fn": 0}

    with torch.no_grad():
        for snapshot in val_set:
            predicted = model(snapshot.x, snapshot.edge_index)
            # Column 0 is `density` — see FEATURE_COLUMNS. Persistence predicts it unchanged.
            persistence = snapshot.x[:, 0]

            for scores, into in ((predicted, stats), (persistence, base)):
                flagged = scores >= CRITICAL
                actual = snapshot.y >= CRITICAL
                into["tp"] += int((flagged & actual).sum())
                into["fp"] += int((flagged & ~actual).sum())
                into["fn"] += int((~flagged & actual).sum())

    def rates(counts: dict[str, int]) -> tuple[float, float]:
        caught = counts["tp"] + counts["fn"]
        raised = counts["tp"] + counts["fp"]
        return (counts["tp"] / caught if caught else 0.0,
                counts["tp"] / raised if raised else 0.0)

    recall, precision = rates(stats)
    base_recall, base_precision = rates(base)
    events = stats["tp"] + stats["fn"]

    print(f"\n--- held-out runs: {events} zone-ticks actually crossed {CRITICAL:.0%} ---")
    print(f"  GNN         caught {stats['tp']:5d} of {events:5d} "
          f"({recall:.0%} recall, {precision:.0%} precision)")
    print(f"  persistence caught {base['tp']:5d} of {events:5d} "
          f"({base_recall:.0%} recall, {base_precision:.0%} precision)")
    if events == 0:
        print("  !! nothing went critical in the held-out runs — raise --runs or the arrival rate")
    elif recall <= base_recall and precision <= base_precision:
        print("  !! the model does not beat 'assume nothing changes'. Do not ship this checkpoint.")


def train(data_dir: Path, epochs: int, lr: float, out: Path) -> None:
    node_ids, edge_index = load_graph(data_dir)
    frame = pd.read_csv(data_dir / "synthetic_runs.csv")

    # Holdout by run so the model is never scored on a run it trained on.
    holdout = frame["run_id"].max() * 0.8
    train_set = to_snapshots(frame[frame["run_id"] <= holdout], node_ids, edge_index)
    val_set = to_snapshots(frame[frame["run_id"] > holdout], node_ids, edge_index)
    print(f"{len(train_set)} train snapshots, {len(val_set)} val snapshots")

    model = CongestionGNN()
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = torch.nn.MSELoss()

    for epoch in range(1, epochs + 1):
        model.train()
        total = 0.0
        for snapshot in train_set:
            optimiser.zero_grad()
            loss = loss_fn(model(snapshot.x, snapshot.edge_index), snapshot.y)
            loss.backward()
            optimiser.step()
            total += loss.item()

        model.eval()
        with torch.no_grad():
            val = sum(loss_fn(model(s.x, s.edge_index), s.y).item() for s in val_set) / max(1, len(val_set))
        print(f"epoch {epoch:3d}  train {total / max(1, len(train_set)):.5f}  val {val:.5f}")

    report(model, val_set)

    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out)
    print(f"saved {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[1] / "out")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parents[1] / "out" / "congestion_gnn.pt")
    args = parser.parse_args()
    train(args.data, args.epochs, args.lr, args.out)
