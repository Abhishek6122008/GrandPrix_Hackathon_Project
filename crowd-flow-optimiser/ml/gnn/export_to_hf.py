"""Push a trained congestion GNN to the Hugging Face Hub.

    huggingface-cli login          # or set HF_TOKEN
    python export_to_hf.py --repo <your-username>/congestion-gnn

Then point the backend at it in backend/src/main/resources/application.yml:

    hf:
      mock-enabled: false
      gnn-endpoint: https://api-inference.huggingface.co/models/<your-username>/congestion-gnn

Stub status: uploads the checkpoint and a model card. The inference handler that turns
the backend's {node_ids, density, edge_index} payload into a tensor still has to be
written — see the TODO at the bottom.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from huggingface_hub import HfApi

CARD = """---
tags:
  - graph-neural-network
  - crowd-simulation
library_name: pytorch
---

# Congestion Propagation GNN

Predicts each venue zone's crowd density {horizon} ticks ahead from the current densities
and the venue graph. Trained on synthetic runs from the Crowd Flow Optimiser simulator.

## Input

```json
{{"inputs": {{"node_ids": ["gate-a"], "density": [0.91], "capacity": [320], "edge_index": [[0, 1]]}}}}
```

## Output

```json
{{"risk": {{"gate-a": 0.94}}}}
```

Consumed by `GnnRiskClient.java` in the backend.
"""


def export(checkpoint: Path, repo_id: str, horizon: int, private: bool) -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("Set HF_TOKEN (or run `huggingface-cli login`) before exporting.")
    if not checkpoint.exists():
        raise SystemExit(f"No checkpoint at {checkpoint} — run train_gnn.py first.")

    api = HfApi(token=token)
    api.create_repo(repo_id=repo_id, exist_ok=True, private=private)

    card = checkpoint.parent / "README.md"
    card.write_text(CARD.format(horizon=horizon), encoding="utf-8")

    for path in (checkpoint, card):
        api.upload_file(path_or_fileobj=str(path), path_in_repo=path.name, repo_id=repo_id)
        print(f"uploaded {path.name}")

    print(f"https://huggingface.co/{repo_id}")

    # TODO(day 3): add handler.py so the Inference Endpoint can serve this directly —
    # it needs to rebuild the feature matrix in FEATURE_COLUMNS order from the JSON
    # payload, run the model, and return {"risk": {node_id: value}}.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="e.g. your-username/congestion-gnn")
    parser.add_argument("--checkpoint", type=Path,
                        default=Path(__file__).resolve().parents[1] / "out" / "congestion_gnn.pt")
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--private", action="store_true")
    args = parser.parse_args()
    export(args.checkpoint, args.repo, args.horizon, args.private)
