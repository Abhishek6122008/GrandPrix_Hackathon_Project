"""Score an already-trained checkpoint, without retraining.

    python evaluate.py --data ../out --checkpoint ../out/congestion_gnn.pt

Same report the training run prints at the end. Exists so a checkpoint can be re-scored after
the metric changes — or compared against a teammate's — without paying for another training
run to ask a different question of the same weights.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch

from model import load_checkpoint
from train_gnn import load_graph, report, to_snapshots


def evaluate(data_dir: Path, checkpoint: Path) -> None:
    if not checkpoint.exists():
        raise SystemExit(f"no checkpoint at {checkpoint} — run train_gnn.py first")

    node_ids, edge_index = load_graph(data_dir)
    frame = pd.read_csv(data_dir / "synthetic_runs.csv")

    # Same holdout split as training, so this scores runs the model never saw.
    holdout = frame["run_id"].max() * 0.8
    val_set = to_snapshots(frame[frame["run_id"] > holdout], node_ids, edge_index)
    print(f"{len(val_set)} held-out snapshots from {checkpoint.name}")

    report(load_checkpoint(str(checkpoint)), val_set)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[1] / "out")
    parser.add_argument("--checkpoint", type=Path,
                        default=Path(__file__).resolve().parents[1] / "out" / "congestion_gnn.pt")
    args = parser.parse_args()
    evaluate(args.data, args.checkpoint)
