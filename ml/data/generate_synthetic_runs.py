"""Generate synthetic density histories for GNN training.

Mirrors the backend tick engine (SimulationEngine.java) closely enough that a model
trained here transfers: exits drain, people advance toward the nearest exit as far as
downstream capacity allows, arrivals queue at the gates.

Each sample is (density at tick t, density at tick t+HORIZON) per node — that is exactly
what the congestion-propagation GNN has to predict.

    python generate_synthetic_runs.py --runs 200 --out ../../ml/out

Stdlib only: this runs before anyone installs torch.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from collections import deque
from pathlib import Path

DEFAULT_LAYOUT = Path(__file__).resolve().parents[2] / "sample-data" / "venue-layout-sample.json"

# Ticks ahead the model is asked to predict. Keep in step with the backend's trend window.
HORIZON = 5

# Share of a node's occupants that try to move each tick, by node type.
MOBILITY = {"WALKWAY": 0.80, "GATE": 0.70, "CONCESSION": 0.25, "SEATING": 0.10, "EXIT": 1.0}

# --- Feature definitions, mirrored from the serving path -----------------------------------
# Every constant below exists in the running system too. The generator has to reproduce them
# exactly, because a model trained on a differently-defined feature is being asked a different
# question at inference time than the one it learned to answer.

#: Ticks the trend is measured over. Mirrors `simulation.trend-window` in application.yml and
#: DensityDetector.trendsOf.
TREND_WINDOW = 5

#: Dead band before a change counts as RISING or FALLING. Mirrors DensityDetector's +/-0.03 —
#: without it, float noise would label a perfectly steady zone as moving.
TREND_DEADBAND = 0.03

#: Frames of history the backend ships to /analyze, and therefore the span `density_delta`
#: covers. Mirrors FastApiClient.HISTORY_FRAMES.
HISTORY_FRAMES = 12


def load_layout(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def adjacency(layout: dict) -> dict[str, list[dict]]:
    adj: dict[str, list[dict]] = {n["id"]: [] for n in layout["nodes"]}
    for edge in layout["edges"]:
        adj[edge["from"]].append(edge)
        if edge.get("bidirectional", True):
            adj[edge["to"]].append({**edge, "from": edge["to"], "to": edge["from"]})
    return adj


def hops_to_exit(layout: dict) -> dict[str, int]:
    """BFS backwards from every exit; unreachable nodes get a large number."""
    incoming: dict[str, list[str]] = {n["id"]: [] for n in layout["nodes"]}
    for edge in layout["edges"]:
        incoming[edge["to"]].append(edge["from"])
        if edge.get("bidirectional", True):
            incoming[edge["from"]].append(edge["to"])

    hops = {n["id"]: 10**6 for n in layout["nodes"]}
    queue = deque()
    for node in layout["nodes"]:
        if node["type"] == "EXIT":
            hops[node["id"]] = 0
            queue.append(node["id"])
    while queue:
        node = queue.popleft()
        for previous in incoming[node]:
            if hops[previous] > hops[node] + 1:
                hops[previous] = hops[node] + 1
                queue.append(previous)
    return hops


def throughput(edge: dict) -> int:
    """~1.3 people per metre of width per second, 10s ticks. Matches VenueEdge.throughputPerTick."""
    return max(1, int(edge["width"] * 1.3 * 10))


def congestion_slowdown(density: float) -> float:
    """Linear fundamental diagram — same curve as SocialForceModel.congestionSlowdown."""
    return max(0.05, 1.0 - min(1.0, max(0.0, density)) * 0.9)


def simulate(layout: dict, crowd_size: int, ticks: int, arrival_rate: int,
             reroute: bool, rng: random.Random) -> list[dict[str, float]]:
    """Returns per-tick density (occupancy / capacity) for every node."""
    nodes = {n["id"]: n for n in layout["nodes"]}
    adj = adjacency(layout)
    hops = hops_to_exit(layout)
    gates = [n for n in layout["nodes"] if n["type"] == "GATE"]

    occupancy = {node_id: 0 for node_id in nodes}
    pending = crowd_size
    history = [dict.fromkeys(nodes, 0.0)]

    order = sorted((n for n in layout["nodes"] if n["type"] != "EXIT"), key=lambda n: hops[n["id"]])

    for _ in range(ticks):
        current = dict(occupancy)
        nxt = dict(occupancy)

        for node in layout["nodes"]:
            if node["type"] == "EXIT":
                nxt[node["id"]] -= current[node["id"]]

        for node in order:
            here = current[node["id"]]
            if here == 0:
                continue
            density = here / node["capacity"]
            fraction = MOBILITY[node["type"]] * congestion_slowdown(density)
            # Small jitter so runs are not carbon copies of each other.
            movers = round(here * fraction * rng.uniform(0.85, 1.15))

            downstream = [
                e for e in adj[node["id"]]
                if hops[e["to"]] < hops[node["id"]] or (reroute and hops[e["to"]] == hops[node["id"]])
            ]
            for edge in sorted(downstream, key=lambda e: hops[e["to"]]):
                if movers <= 0:
                    break
                spare = nodes[edge["to"]]["capacity"] - nxt[edge["to"]]
                moved = min(movers, spare, throughput(edge))
                if moved <= 0:
                    continue
                nxt[node["id"]] -= moved
                nxt[edge["to"]] += moved
                movers -= moved

        if gates:
            per_gate = max(1, arrival_rate // len(gates))
            for gate in gates:
                spare = max(0, gate["capacity"] - nxt[gate["id"]])
                arriving = min(per_gate, spare, pending)
                pending -= arriving
                nxt[gate["id"]] += arriving

        occupancy = nxt
        history.append({nid: occupancy[nid] / nodes[nid]["capacity"] for nid in nodes})

    return history


def static_features(layout: dict) -> dict[str, dict[str, float]]:
    """
    The per-node features that depend only on the venue, not on the run.

    Computed exactly as `preprocessing.build_features` does at serving time: normalised against
    the largest capacity and the highest degree *in this venue*, not against absolute figures.
    That is what lets one model serve venues of wildly different sizes.
    """
    adj = adjacency(layout)
    max_capacity = max((n["capacity"] for n in layout["nodes"]), default=1) or 1

    # Degree counts distinct neighbours, matching the service's `neighbours` set — an
    # edge list that names the same pair twice must not inflate a node's degree.
    degree = {n["id"]: len({e["to"] for e in adj[n["id"]]}) for n in layout["nodes"]}
    max_degree = max(degree.values(), default=1) or 1

    return {
        n["id"]: {
            "capacity_norm": n["capacity"] / max_capacity,
            "degree_norm": degree[n["id"]] / max_degree,
        }
        for n in layout["nodes"]
    }


def encode_trend(now: float, then: float) -> float:
    """DensityDetector's rule, as the number the model sees. See TREND_DEADBAND."""
    delta = now - then
    if delta > TREND_DEADBAND:
        return 1.0
    return -1.0 if delta < -TREND_DEADBAND else 0.0


def build_samples(layout: dict, runs: int, seed: int) -> list[dict]:
    """
    One row per (run, tick, node): the six serving features plus the label HORIZON ticks later.

    Columns and their order are dictated by `ml/gnn/model.py::FEATURE_COLUMNS`, which in turn
    mirrors the service. Do not add a column here without adding it in both.
    """
    rng = random.Random(seed)
    node_ids = [n["id"] for n in layout["nodes"]]
    rows: list[dict] = []

    # Hoisted out of the row loop below. The layout never changes, and rebuilding this per
    # (run, tick, node) meant constructing the whole adjacency map a few million times for a
    # 300-run generation — minutes of pure waste before a single sample was written.
    adj = adjacency(layout)
    static = static_features(layout)

    for run_id in range(runs):
        crowd = rng.randint(1_500, 9_000)
        arrival = rng.randint(80, 400)
        reroute = rng.random() < 0.5
        history = simulate(layout, crowd, ticks=80, arrival_rate=arrival, reroute=reroute, rng=rng)

        for tick in range(len(history) - HORIZON):
            # Both look back as far as the window allows and no further, exactly as the service
            # does early in a run when it has not accumulated a full history yet.
            trend_base = history[max(0, tick - TREND_WINDOW)]
            delta_base = history[max(0, tick - HISTORY_FRAMES)]

            for node_id in node_ids:
                density = history[tick][node_id]
                rows.append({
                    "run_id": run_id,
                    "tick": tick,
                    "node_id": node_id,
                    # --- the six feature columns, in FEATURE_COLUMNS order ---
                    "density": round(density, 4),
                    "trend": encode_trend(density, trend_base[node_id]),
                    "capacity_norm": round(static[node_id]["capacity_norm"], 4),
                    "degree_norm": round(static[node_id]["degree_norm"], 4),
                    "neighbour_max_density": round(
                        max((history[tick][e["to"]] for e in adj[node_id]), default=0.0), 4),
                    "density_delta": round(density - delta_base[node_id], 4),
                    # --- label ---
                    "density_ahead": round(history[tick + HORIZON][node_id], 4),
                    # --- context, kept for analysis; NOT fed to the model ---
                    "crowd_size": crowd,
                    "arrival_rate": arrival,
                    "reroute": int(reroute),
                })
    return rows


def write_outputs(rows: list[dict], layout: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_path = out_dir / "synthetic_runs.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    # Graph structure the GNN needs, saved once alongside the samples.
    node_ids = [n["id"] for n in layout["nodes"]]
    index = {node_id: i for i, node_id in enumerate(node_ids)}
    edge_index = []
    for edge in layout["edges"]:
        edge_index.append([index[edge["from"]], index[edge["to"]]])
        if edge.get("bidirectional", True):
            edge_index.append([index[edge["to"]], index[edge["from"]]])

    (out_dir / "graph.json").write_text(
        json.dumps({"node_ids": node_ids, "edge_index": edge_index, "horizon": HORIZON}, indent=2),
        encoding="utf-8")

    print(f"{len(rows)} samples -> {csv_path}")
    print(f"graph -> {out_dir / 'graph.json'}")


def self_check() -> None:
    """Cheap invariants: densities stay in range and congestion actually builds somewhere."""
    layout = load_layout(DEFAULT_LAYOUT)
    history = simulate(layout, crowd_size=8_000, ticks=40, arrival_rate=400,
                       reroute=False, rng=random.Random(1))
    assert len(history) == 41, "one snapshot per tick plus the empty start"
    assert all(0.0 <= d <= 1.0 for frame in history for d in frame.values()), "density out of range"
    assert max(max(frame.values()) for frame in history) > 0.7, "no congestion built up at all"

    rows = build_samples(layout, runs=1, seed=7)
    assert rows and set(rows[0]) >= {"density", "density_ahead", "node_id"}

    # The feature contract. Duplicated here as a literal rather than imported from
    # ml/gnn/model.py on purpose — this module is stdlib-only so it can run before anyone
    # installs torch. ai-service/tests/test_feature_contract.py is what keeps the copies honest.
    expected = ["density", "trend", "capacity_norm", "degree_norm",
                "neighbour_max_density", "density_delta"]
    emitted = [key for key in rows[0] if key in set(expected)]
    assert emitted == expected, f"feature columns drifted: emitted {emitted}, expected {expected}"

    # Trend must actually vary, or the column is a constant the model will learn to ignore.
    trends = {row["trend"] for row in rows}
    assert trends >= {1.0, 0.0}, f"trend column is degenerate: only saw {trends}"

    # A label that never moves means the run never congested and there is nothing to learn.
    assert max(row["density_ahead"] for row in rows) > 0.5, "no congestion in the sample run"

    print("self-check ok")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--layout", type=Path, default=DEFAULT_LAYOUT)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "out")
    parser.add_argument("--self-check", action="store_true", help="run invariants and exit")
    args = parser.parse_args()

    if args.self_check:
        self_check()
    else:
        venue = load_layout(args.layout)
        write_outputs(build_samples(venue, args.runs, args.seed), venue, args.out)
