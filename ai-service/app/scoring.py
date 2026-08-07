"""The offline model: congestion risk and advisory text, with no network and no torch.

This is what answers when Hugging Face is not configured — which, on a demo laptop behind
conference wifi, is most of the time. It is deliberately not a neural network, and the code
says so rather than dressing itself up as one: it is a **one-hop linear propagation model**
over the same feature columns the GNN is trained on.

Why that is worth having rather than nothing:

* A per-node threshold cannot see a neighbour pushing crowd into you. This can — that is what
  the ``neighbour_max_density`` term is, and it is the single thing the GNN is meant to learn.
* It is deterministic, so a demo replays identically and a test can assert on the number.
* It costs one dot product per node, so it runs inside the tick budget with room to spare.

Honesty rule: nothing here reports itself as a GNN or an LLM. ``model_name()`` returns
``local-linear`` / ``local-template`` and that string is what ends up in ``modelInfo``, so an
operator reading the UI always knows which of the two paths actually answered.

ponytail: plain Python, no numpy. The whole model is six multiplies per node; importing a
numeric stack to do that would cost more to install than it saves to run. Vectorise if venues
ever reach thousands of nodes, which a venue graph does not.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- risk

#: Weights over preprocessing.FEATURE_COLUMNS, in that exact order:
#: (density, trend, capacity_norm, degree_norm, neighbour_max_density, density_delta)
#:
#: Tuned by hand against sample-data/venue-layout-sample.json, not learned. They encode four
#: claims, each of which is meant to be arguable rather than magic:
#:
#: * ``density`` dominates — how full a zone is now is most of how risky it is.
#: * ``neighbour_max_density`` is the propagation term: a packed neighbour will push into you.
#: * ``trend`` and ``density_delta`` are direction — filling at 60% is worse than draining at 70%.
#: * ``degree_norm`` is negative on purpose: a well-connected zone has more ways to shed crowd,
#:   so the same density there is less dangerous than in a dead end.
#:
#: ``capacity_norm`` sits at zero: density already divides by capacity, so weighting raw size
#: again would double-count it. It stays in the vector because the column order is shared with
#: the trained GNN and dropping it here would silently misalign the two.
WEIGHTS: tuple[float, ...] = (
    0.62,   # density
    0.08,   # trend            (RISING=+1, FLAT=0, FALLING=-1)
    0.00,   # capacity_norm    (see above — deliberately unweighted)
    -0.06,  # degree_norm      (more exits out = less trapped)
    0.28,   # neighbour_max_density
    0.35,   # density_delta    (change since the oldest history frame we were given)
)

#: Risk floor/ceiling. Clamped because a linear model has no opinion about staying in [0,1].
RISK_MIN, RISK_MAX = 0.0, 1.0

MODEL_NAME = "local-linear"
ADVISORY_MODEL_NAME = "local-template"


def score_features(features: list[list[float]]) -> list[float]:
    """
    Risk in [0,1] for each row of the feature matrix built by ``preprocessing.build_features``.

    Rows must be in FEATURE_COLUMNS order. A row of the wrong width is a programming error
    upstream, so it raises rather than silently scoring garbage.
    """
    scored: list[float] = []
    for row in features:
        if len(row) != len(WEIGHTS):
            raise ValueError(
                f"feature row has {len(row)} columns, expected {len(WEIGHTS)} "
                "(preprocessing.FEATURE_COLUMNS and scoring.WEIGHTS have drifted apart)"
            )
        total = sum(value * weight for value, weight in zip(row, WEIGHTS))
        scored.append(min(RISK_MAX, max(RISK_MIN, total)))
    return scored


def predict_risk(node_ids: list[str], features: list[list[float]]) -> dict[str, float]:
    """``{node_id: risk}``, the same shape the Hugging Face GNN client returns on success."""
    return dict(zip(node_ids, score_features(features)))


def risk_from_graph(
    nodes: list[tuple[str, float, str]],
    edges: list[tuple[str, str]],
) -> dict[str, float]:
    """
    Risk straight from ``(id, density, trend)`` triples and ``(source, target)`` pairs.

    This is the entry point for ``POST /predict/risk``, whose payload carries density and trend
    but no capacity, history or coordinates. The missing columns are filled with the neutral
    values the weights were tuned against — zero delta, mid capacity — so the two endpoints
    agree on any input they can both express.
    """
    density = {node_id: value for node_id, value, _ in nodes}
    trend = {node_id: label for node_id, _, label in nodes}

    neighbours: dict[str, set[str]] = {node_id: set() for node_id, _, _ in nodes}
    for source, target in edges:
        if source in neighbours:
            neighbours[source].add(target)
        if target in neighbours:
            neighbours[target].add(source)

    max_degree = max((len(n) for n in neighbours.values()), default=1) or 1

    node_ids = [node_id for node_id, _, _ in nodes]
    features = [
        [
            density[node_id],
            TREND_ENCODING.get(trend[node_id], 0.0),
            0.5,  # capacity_norm — unweighted, so the value cannot affect the score
            len(neighbours[node_id]) / max_degree,
            max((density.get(n, 0.0) for n in neighbours[node_id]), default=0.0),
            0.0,  # density_delta — this endpoint sends no history
        ]
        for node_id in node_ids
    ]
    return predict_risk(node_ids, features)


#: Duplicated from the schemas rather than imported, to keep this module free of any
#: dependency on the wire format. If they drift the tests catch it.
TREND_ENCODING: dict[str, float] = {"FALLING": -1.0, "FLAT": 0.0, "RISING": 1.0}


# --------------------------------------------------------------------------- advisory

#: Density bands the advisory wording keys off. Same numbers as the Spring detector's
#: warning/critical thresholds in application.yml — if you change them there, change them here,
#: or the prose and the colour on the map will disagree about the same zone.
CRITICAL, WARNING = 0.85, 0.70


def generate_advisory(node: str, density: float, trend: str, reroute_path: list[str]) -> str:
    """
    One actionable sentence for one zone. Used by ``POST /generate/advisory``.

    Templates rather than a language model because the useful content of an advisory is
    entirely determined by (zone, how full, which way it is moving, where else to send people).
    A 0.5B model asked to render those four facts mostly produces the same sentence more slowly,
    and occasionally produces a confidently wrong one — which for safety guidance is worse than
    plain.
    """
    pct = round(density * 100)
    where = f"Divert to {reroute_path[-1]}" if reroute_path else "Hold intake at the gates"

    if density >= CRITICAL:
        return f"{node} is at {pct}% of capacity and unsafe. {where} now."
    if density >= WARNING:
        direction = "still filling" if trend == "RISING" else "holding"
        return f"{node} is at {pct}% and {direction}. {where} before it goes critical."
    if trend == "RISING":
        return f"{node} is at {pct}% but filling. Watch it; no action needed yet."
    return f"{node} is at {pct}% and flowing normally. No action needed."


def generate_summary_advisory(
    venue_name: str,
    ranked: list[tuple[str, float, float, str]],
    people_inside: int,
    pending: int,
    reroute_enabled: bool,
) -> tuple[str, str, list[str]]:
    """
    The venue-wide advisory for ``POST /analyze``: ``(headline, message, actions)``.

    ``ranked`` is ``(zone name, density now, predicted risk, trend)``, worst first — normally
    the top three, which is as many as an operator can act on at once.
    """
    if not ranked:
        return (
            "Crowd flowing normally",
            f"No zone in {venue_name or 'the venue'} is above the warning line. "
            f"{people_inside} inside, {pending} still to arrive.",
            [],
        )

    name, density, risk, trend = ranked[0]
    pct, risk_pct = round(density * 100), round(risk * 100)

    headline = f"{name} at {pct}% capacity"
    if density >= CRITICAL:
        message = (
            f"{name} is at {pct}% of capacity with predicted risk {risk_pct}%. "
            f"Hold intake and stage arrivals away from it until it drains."
        )
    elif density >= WARNING or risk >= WARNING:
        message = (
            f"{name} is at {pct}% and {'filling' if trend == 'RISING' else 'steady'}, "
            f"predicted risk {risk_pct}%. Move staff there before it crosses the line."
        )
    else:
        headline = "Crowd flowing normally"
        message = (
            f"Busiest zone is {name} at {pct}%, well inside limits. "
            f"{people_inside} inside, {pending} still to arrive."
        )

    actions = [
        f"{zone}: {round(d * 100)}% now, risk {round(r * 100)}%, {t.lower()}"
        for zone, d, r, t in ranked[:3]
    ]
    if not reroute_enabled and density >= WARNING:
        actions.append("Automatic rerouting is off — diversions must be called manually.")

    return headline, message, actions


# --------------------------------------------------------------------------- self-check


def _demo() -> None:
    """Runnable check: `python -m app.scoring`. Asserts the properties the weights encode."""
    # A packed neighbour must raise your risk even when your own density is unchanged.
    alone = risk_from_graph([("a", 0.5, "FLAT")], [])
    crowded_neighbour = risk_from_graph(
        [("a", 0.5, "FLAT"), ("b", 0.95, "RISING")], [("a", "b")]
    )
    assert crowded_neighbour["a"] > alone["a"], "propagation term is not propagating"

    # Direction matters: filling is worse than draining at the same density.
    rising = risk_from_graph([("a", 0.6, "RISING")], [])["a"]
    falling = risk_from_graph([("a", 0.6, "FALLING")], [])["a"]
    assert rising > falling, "trend term has the wrong sign"

    # Always in range, including for an overfull node.
    overfull = risk_from_graph([("a", 3.0, "RISING")], [])["a"]
    assert 0.0 <= overfull <= 1.0, f"risk escaped [0,1]: {overfull}"

    # A column-count mismatch must shout rather than score nonsense.
    try:
        score_features([[0.1, 0.2]])
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("short feature row was accepted")

    # Advisory wording tracks the bands.
    assert "unsafe" in generate_advisory("Gate A", 0.91, "RISING", ["walk", "exit-e"])
    assert "Divert to exit-e" in generate_advisory("Gate A", 0.91, "RISING", ["walk", "exit-e"])
    assert "Hold intake" in generate_advisory("Gate A", 0.91, "RISING", [])
    assert "No action needed" in generate_advisory("Exit E", 0.10, "FLAT", [])

    headline, message, actions = generate_summary_advisory(
        "Arena", [("Gate A", 0.91, 0.88, "RISING")], 1800, 400, True
    )
    assert "Gate A" in headline and "Hold intake" in message and actions

    print("scoring.py self-check passed")


if __name__ == "__main__":
    _demo()
