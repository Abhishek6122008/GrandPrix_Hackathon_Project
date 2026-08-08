"""Does the GNN earn its place? Scores it against the two cheaper things it could be replaced by.

    python compare.py --data ../out --checkpoint ../out/congestion_gnn.pt

The three contenders, all on the same held-out runs and the same 0.85 critical line:

* **persistence** — "assume every zone stays exactly as it is". Free. Scores 0% on onset by
  construction, since it is guessing the current value and the current value is below the line.
* **linear** — the offline scorer in ai-service/app/scoring.py. Fifteen lines, no training, no
  torch, and it already does one-hop neighbour propagation. This is the honest bar: if the GNN
  cannot clear it, the GNN is 200MB of dependency and an hour of training for nothing.
* **GNN** — the trained checkpoint.

Reported on ONSET cases only — zones below the line now that cross it within the horizon. That
is the claim the project makes, and the only comparison that is about prediction rather than
about reporting the present.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd
import torch

from model import FEATURE_COLUMNS, load_checkpoint
from train_gnn import CRITICAL, load_graph, to_snapshots

# The linear scorer lives in the service, not here. Imported rather than reimplemented so this
# scores the model that actually ships, not a copy of it that can drift.
AI_SERVICE = Path(__file__).resolve().parents[2] / "ai-service"
if str(AI_SERVICE) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE))
from app.scoring import score_features  # noqa: E402


def rates(tp: int, fp: int, fn: int) -> tuple[float, float]:
    caught, raised = tp + fn, tp + fp
    return (tp / caught if caught else 0.0, tp / raised if raised else 0.0)


def compare(data_dir: Path, checkpoint: Path) -> None:
    node_ids, edge_index = load_graph(data_dir)
    frame = pd.read_csv(data_dir / "synthetic_runs.csv")
    holdout = frame["run_id"].max() * 0.8
    val_set = to_snapshots(frame[frame["run_id"] > holdout], node_ids, edge_index)

    model = load_checkpoint(str(checkpoint))
    model.eval()

    counts = {name: {"tp": 0, "fp": 0, "fn": 0} for name in ("gnn", "linear", "persistence")}

    with torch.no_grad():
        for snapshot in val_set:
            density = snapshot.x[:, FEATURE_COLUMNS.index("density")]
            actual = snapshot.y >= CRITICAL
            onset = actual & (density < CRITICAL)
            quiet_stayed_quiet = ~actual & (density < CRITICAL)

            scores = {
                "gnn": model(snapshot.x, snapshot.edge_index),
                "linear": torch.tensor(score_features(snapshot.x.tolist()), dtype=torch.float),
                "persistence": density,
            }
            for name, value in scores.items():
                flagged = value >= CRITICAL
                counts[name]["tp"] += int((flagged & onset).sum())
                counts[name]["fn"] += int((~flagged & onset).sum())
                counts[name]["fp"] += int((flagged & quiet_stayed_quiet).sum())

    total = counts["gnn"]["tp"] + counts["gnn"]["fn"]
    print(f"\nONSET — zones below {CRITICAL:.0%} that cross it within the horizon "
          f"({total} cases, held-out runs)\n")
    print(f"  {'model':<14}{'caught':>8}{'recall':>9}{'precision':>11}")
    for name in ("gnn", "linear", "persistence"):
        recall, precision = rates(**counts[name])
        print(f"  {name:<14}{counts[name]['tp']:>8}{recall:>8.0%}{precision:>11.0%}")

    gnn_recall, gnn_precision = rates(**counts["gnn"])
    lin_recall, lin_precision = rates(**counts["linear"])
    print()
    if gnn_recall > lin_recall + 0.05:
        print(f"  The GNN is worth its weight: +{gnn_recall - lin_recall:.0%} recall over the "
              "15-line linear scorer.")
    elif gnn_recall >= lin_recall:
        print(f"  Marginal: +{gnn_recall - lin_recall:.0%} recall over the linear scorer. Worth "
              "asking whether the dependency and the training time are buying anything.")
    else:
        print("  !! The linear scorer beats the GNN on the metric that matters. Ship the linear "
              "one and say so — it is the honest result.")
    if gnn_precision < lin_precision - 0.05:
        print(f"  Note the GNN cries wolf more: {gnn_precision:.0%} precision against "
              f"{lin_precision:.0%}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[1] / "out")
    parser.add_argument("--checkpoint", type=Path,
                        default=Path(__file__).resolve().parents[1] / "out" / "congestion_gnn.pt")
    args = parser.parse_args()
    compare(args.data, args.checkpoint)
