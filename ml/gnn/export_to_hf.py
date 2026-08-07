"""Push a trained congestion GNN to the Hugging Face Hub.

    huggingface-cli login          # or set HF_TOKEN
    python export_to_hf.py --repo <your-username>/congestion-gnn

Uploads everything the Endpoint needs to serve itself: the checkpoint, the architecture it was
saved from, the handler that turns a venue graph into a tensor, and a pinned requirements file.
A repo missing any of these deploys and then answers errors, which is a slow way to find out.

Then point the AI service at it — in `ai-service/.env`:

    HF_API_TOKEN=hf_...
    HF_GNN_URL=https://<id>.<region>.aws.endpoints.huggingface.cloud

That is the only wiring needed. `POST /analyze` prefers Hugging Face whenever both are set and
falls back to the offline model otherwise, per step — see ai-service/app/routers/analyze.py.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from huggingface_hub import HfApi

from model import FEATURE_COLUMNS

CARD = """---
tags:
  - graph-neural-network
  - crowd-simulation
library_name: pytorch
pipeline_tag: graph-ml
---

# Congestion Propagation GNN

Predicts each venue zone's crowd density {horizon} ticks ahead from the current densities and
the venue's walkway graph. Trained on synthetic runs from the Crowd Flow Optimiser simulator.

Two-layer GraphSAGE. Message passing is the whole point: a gate backing up should raise the
predicted risk of the walkway feeding it, which a per-zone threshold cannot see.

## Input

`features` rows must be in this exact column order:

`{columns}`

```json
{{{{"inputs": {{{{
  "node_ids": ["gate-a", "walk", "exit-e"],
  "features": [[0.93, 1.0, 0.35, 0.20, 0.44, 0.32],
               [0.44, 0.0, 0.55, 1.00, 0.93, 0.04],
               [0.05, 0.0, 0.44, 0.40, 0.44, 0.01]],
  "edge_index": [[0, 1], [1, 2]]
}}}}}}}}
```

`edge_index` is `[all_sources, all_targets]` — PyTorch Geometric's `[2, num_edges]` layout,
not a list of pairs.

## Output

```json
{{{{"risk": {{{{"gate-a": 1.0, "walk": 0.8, "exit-e": 0.1}}}}}}}}
```

Note the second zone: 44% full, but scored 0.80 because its neighbour is at 93% and pushing
into it. That is the behaviour this model exists to provide.

## Consumed by

`ai-service/app/clients/hf_gnn_client.py` in the Crowd Flow Optimiser, which falls back to a
local linear model whenever this endpoint is unset or unreachable.
"""

#: Pinned for the Endpoint's own container. torch-geometric needs torch present at build time.
REQUIREMENTS = """torch>=2.2
torch-geometric>=2.5
"""


def export(checkpoint: Path, repo_id: str, horizon: int, private: bool) -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("Set HF_TOKEN (or run `huggingface-cli login`) before exporting.")
    if not checkpoint.exists():
        raise SystemExit(f"No checkpoint at {checkpoint} — run train_gnn.py first.")

    here = Path(__file__).resolve().parent
    handler, architecture = here / "handler.py", here / "model.py"
    for required in (handler, architecture):
        if not required.exists():
            raise SystemExit(f"{required.name} is missing — the Endpoint cannot serve without it.")

    api = HfApi(token=token)
    api.create_repo(repo_id=repo_id, exist_ok=True, private=private)

    staging = checkpoint.parent
    card = staging / "README.md"
    card.write_text(
        CARD.format(horizon=horizon, columns="`, `".join(FEATURE_COLUMNS)), encoding="utf-8")
    requirements = staging / "requirements.txt"
    requirements.write_text(REQUIREMENTS, encoding="utf-8")

    # handler.py and model.py go up as-is: the handler imports the architecture by name, so the
    # served model is definitionally the one that was trained rather than a copy that can drift.
    for path in (checkpoint, card, requirements, handler, architecture):
        api.upload_file(path_or_fileobj=str(path), path_in_repo=path.name, repo_id=repo_id)
        print(f"uploaded {path.name}")

    print(f"\nhttps://huggingface.co/{repo_id}")
    print("Deploy this as an Inference Endpoint, then put its URL in ai-service/.env as "
          "HF_GNN_URL (with HF_API_TOKEN).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="e.g. your-username/congestion-gnn")
    parser.add_argument("--checkpoint", type=Path,
                        default=Path(__file__).resolve().parents[1] / "out" / "congestion_gnn.pt")
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--private", action="store_true")
    args = parser.parse_args()
    export(args.checkpoint, args.repo, args.horizon, args.private)
