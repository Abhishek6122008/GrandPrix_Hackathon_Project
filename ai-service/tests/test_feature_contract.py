"""The feature contract: three files must agree on what the GNN's input columns are.

Nothing at runtime checks this, and a mismatch does not raise — it silently feeds the model
the wrong number in each slot and produces confident nonsense. That is exactly what had
happened: the model trained on four columns (`density, neighbour_max_density, arrival_rate,
reroute`) while the service sent six in a different order, so the trained model could never
have been deployed against real traffic at all.

The three copies exist for a reason, so this test guards them rather than merging them:

* `ai-service/app/services/preprocessing.py` — builds the matrix at inference time. Source of truth.
* `ml/gnn/model.py` — sizes the network's input layer.
* `ml/data/generate_synthetic_runs.py` — emits the training columns. Stdlib-only by design, so
  it cannot import either of the others.

Parsed textually rather than imported, so this runs in the ai-service venv without torch.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.services.preprocessing import FEATURE_COLUMNS as SERVING_COLUMNS

REPO = Path(__file__).resolve().parents[2]


def _literal_list(path: Path, name: str) -> list[str]:
    """Reads `name = [...]` out of a module without importing it."""
    if not path.exists():
        pytest.skip(f"{path} not present")

    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == name for t in node.targets
        ):
            return [str(v) for v in ast.literal_eval(node.value)]
    raise AssertionError(f"no {name} assignment found in {path}")


def test_the_model_input_layer_matches_what_the_service_sends():
    training = _literal_list(REPO / "ml" / "gnn" / "model.py", "FEATURE_COLUMNS")
    assert training == list(SERVING_COLUMNS), (
        "ml/gnn/model.py and app/services/preprocessing.py disagree about the feature columns. "
        "A model trained on one and served the other reads the wrong value in every slot."
    )


def test_the_generator_emits_exactly_those_columns_in_order():
    generator = REPO / "ml" / "data" / "generate_synthetic_runs.py"
    if not generator.exists():
        pytest.skip("generator not present")

    # The generator keeps its own literal copy (it must stay stdlib-only), inside self_check.
    expected = _literal_list_in_function(generator, "self_check", "expected")
    assert expected == list(SERVING_COLUMNS), (
        "the training data generator emits different columns than the service sends"
    )


def _literal_list_in_function(path: Path, function: str, name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == function:
            for inner in ast.walk(node):
                if isinstance(inner, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id == name for t in inner.targets
                ):
                    return [str(v) for v in ast.literal_eval(inner.value)]
    raise AssertionError(f"no {name} in {function}() of {path}")


def test_the_offline_scorer_weights_one_value_per_column():
    """app/scoring.py's linear model is indexed positionally against the same list."""
    from app.scoring import WEIGHTS

    assert len(WEIGHTS) == len(SERVING_COLUMNS), (
        f"scoring.WEIGHTS has {len(WEIGHTS)} entries for {len(SERVING_COLUMNS)} feature columns"
    )
