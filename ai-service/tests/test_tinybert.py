"""Checks for the TinyBERT risk path, without downloading TinyBERT.

The encoder is stubbed. What is worth checking is not that transformers works — it does — but
the two things this port changed and could get wrong: that a zone's risk depends only on that
zone, and that the same crowd state always renders the same sentence.

The batch-independence check is the one that matters. The original scored the embedding term as
``norm / max(norm across the batch)``, so adding a calm zone to the venue silently moved every
other zone's risk and a one-node graph always maxed the term. This asserts that is gone.

    .venv/Scripts/python -m pytest tests/test_tinybert.py -q
"""

from __future__ import annotations

import pytest

from app.tinybert_local import TinyBertRisk, _describe_node

torch = pytest.importorskip("torch")

# (density, trend, capacity_norm, degree_norm, neighbour_max_density, density_delta)
CALM = [0.10, 0.0, 0.5, 0.6, 0.15, 0.00]
BUSY = [0.88, 1.0, 0.5, 0.2, 0.80, 0.30]
MIXED = [0.45, -1.0, 0.5, 0.4, 0.50, -0.10]


class _FakeEncoder:
    """Stands in for tokenizer + model: one hidden vector per input, scaled by text length."""

    def __call__(self, texts=None, **kwargs):
        if texts is not None:  # tokenizer call
            lengths = [len(text) for text in texts]
            return {
                "input_ids": torch.ones(len(texts), 4, dtype=torch.long),
                "attention_mask": torch.ones(len(texts), 4, dtype=torch.long),
                "_lengths": lengths,
            }
        # model call — kwargs are what the tokenizer returned
        lengths = kwargs["_lengths"]
        hidden = torch.stack([torch.full((4, 8), length / 100.0) for length in lengths])
        return type("Output", (), {"last_hidden_state": hidden})()


def _model() -> TinyBertRisk:
    model = TinyBertRisk()
    encoder = _FakeEncoder()
    model.tokenizer = encoder
    model.model = encoder
    model.ready = True
    return model


def test_risk_of_a_zone_does_not_depend_on_the_rest_of_the_batch():
    model = _model()

    together = model.predict(["calm", "busy", "mixed"], [CALM, BUSY, MIXED])
    alone = model.predict(["busy"], [BUSY])

    assert together["busy"] == pytest.approx(alone["busy"])


def test_busier_zones_score_higher_and_stay_in_range():
    risk = _model().predict(["calm", "busy"], [CALM, BUSY])

    assert risk["busy"] > risk["calm"]
    assert all(0.0 <= value <= 1.0 for value in risk.values())


def test_the_same_state_always_renders_the_same_sentence():
    assert _describe_node(BUSY) == _describe_node(list(BUSY))
    assert _describe_node(CALM) != _describe_node(BUSY)


def test_a_wrong_width_row_is_rejected_rather_than_scored():
    with pytest.raises(ValueError, match="wrong width"):
        _model().predict(["a"], [[0.5, 0.0, 0.5]])


def test_predict_before_load_says_so():
    with pytest.raises(RuntimeError, match="not loaded"):
        TinyBertRisk().predict(["a"], [CALM])
