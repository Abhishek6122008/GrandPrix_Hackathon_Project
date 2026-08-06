# ============================================================
# models/gnn_model.py
#
# TinyBERT-based crowd-risk predictor.
#
# Architecture (local inference):
#   - Loads huawei-noah/TinyBERT_General_4L_312D locally via
#     HuggingFace `transformers` (downloaded once, cached to disk).
#   - Converts node feature dicts into natural-language descriptions.
#   - Mean-pools TinyBERT token embeddings to produce a 312-dim
#     sentence vector per node.
#   - A lightweight analytical scoring head maps the embedding
#     + raw features to a [0, 1] risk score for each node.
#
# Model specs:
#   - 4 transformer layers, 312-dim hidden, ~14M parameters
#   - ~55 MB on disk, runs on CPU in <100ms per inference batch
#   - No API key, no network call after first download
# ============================================================

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

# Number of raw features per node (must match NodeFeature schema)
NODE_FEATURE_DIM = 8  # population, capacity, density, entryRate, exitRate,
#                       averageSpeed, neighborDensity, queueLength


@dataclass
class GNNPrediction:
    """Prediction output for a single node."""

    node_id: int
    risk_score: float      # [0, 1]
    confidence: float      # [0, 1]
    predicted_in_seconds: int


def _score_embeddings(embeddings: np.ndarray, raw_features: np.ndarray) -> np.ndarray:
    """
    Lightweight analytical scoring head.

    Maps (embedding, raw_features) → risk score in [0, 1] using a simple
    weighted combination. This avoids the need for a trained neural network
    while still producing sensible, data-driven scores.

    Args:
        embeddings:   Shape (N, emb_dim) — mean-pooled TinyBERT token embeddings
        raw_features: Shape (N, NODE_FEATURE_DIM) — normalised raw values

    Returns:
        risk_scores: Shape (N,) — values in [0, 1]
    """
    # Reduce embedding to a scalar signal via L2 norm (higher norm = more unusual state)
    emb_norm = np.linalg.norm(embeddings, axis=-1)                   # (N,)
    emb_signal = emb_norm / (np.max(emb_norm) + 1e-8)               # normalise to [0, 1]

    # Weighted sum of raw features that most predict crowd risk:
    #   density (idx 1) and neighbor_density (idx 5) weighted highest
    feature_weights = np.array([0.10, 0.25, 0.10, 0.05, 0.05, 0.20, 0.15, 0.10])
    raw_signal = raw_features @ feature_weights                       # (N,)

    # Blend embedding signal (30%) with raw feature signal (70%)
    combined = 0.30 * emb_signal + 0.70 * raw_signal
    return np.clip(combined, 0.0, 1.0)


class GNNModel:
    """
    Crowd-risk predictor using locally-loaded TinyBERT embeddings.

    Public API
    ----------
    load()          — download (first run) and load TinyBERT into memory.
    predict(nodes)  — return per-node GNNPrediction list.
    """

    def __init__(self) -> None:
        self._ready: bool = False
        self._tokenizer: AutoTokenizer | None = None
        self._model: AutoModel | None = None

    def load(self) -> None:
        """
        Load TinyBERT from the local HuggingFace cache (downloads on first run).
        Called ONCE at startup.
        """
        model_name = settings.TINYBERT_MODEL_NAME
        cache_dir = settings.MODEL_CACHE_DIR

        logger.info("GNNModel | loading TinyBERT: %s (cache: %s)", model_name, cache_dir)
        t0 = time.perf_counter()

        self._tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            cache_dir=cache_dir,
        )
        self._model = AutoModel.from_pretrained(
            model_name,
            cache_dir=cache_dir,
        )
        self._model.eval()  # inference mode — disables dropout

        elapsed = time.perf_counter() - t0
        self._ready = True
        logger.info("GNNModel | TinyBERT ready in %.2fs", elapsed)

    def _build_feature_text(self, node_features: dict) -> str:
        """
        Converts a node feature dict into a natural-language description.
        Fed to TinyBERT to produce a semantic embedding.
        """
        return (
            f"Node with density {node_features['density']:.2f}, "
            f"population {node_features['population']} of capacity {node_features['capacity']}, "
            f"entry rate {node_features['entryRate']:.1f} and exit rate {node_features['exitRate']:.1f}, "
            f"average speed {node_features['averageSpeed']:.2f} m/s, "
            f"neighbor density {node_features['neighborDensity']:.2f}, "
            f"queue length {node_features['queueLength']}."
        )

    def _extract_raw_features(self, node_features: dict) -> np.ndarray:
        """Extract normalised raw feature vector (shape: [NODE_FEATURE_DIM,])."""
        return np.array(
            [
                node_features["population"] / max(node_features["capacity"], 1),
                node_features["density"],
                node_features["entryRate"] / 20.0,   # normalise by assumed max
                node_features["exitRate"] / 20.0,
                node_features["averageSpeed"] / 5.0,  # normalise by assumed max
                node_features["neighborDensity"],
                node_features["queueLength"] / 50.0,  # normalise by assumed max
                float(node_features["entryRate"] > node_features["exitRate"]),  # net-inflow flag
            ],
            dtype=np.float32,
        )

    def _get_embeddings(self, texts: list[str]) -> np.ndarray:
        """
        Run TinyBERT locally on a batch of text descriptions.

        Mean-pools the last hidden state over all non-padding tokens
        to produce one 312-dim embedding vector per input.

        Returns:
            embeddings: Shape (N, 312) as numpy float32 array.
        """
        encoded = self._tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors="pt",
        )

        with torch.no_grad():
            outputs = self._model(**encoded)

        # last_hidden_state: (N, seq_len, hidden_dim)
        hidden = outputs.last_hidden_state                          # (N, T, 312)
        attention_mask = encoded["attention_mask"]                  # (N, T)

        # Mean-pool over non-padding tokens
        mask_expanded = attention_mask.unsqueeze(-1).float()        # (N, T, 1)
        sum_hidden = (hidden * mask_expanded).sum(dim=1)            # (N, 312)
        count = mask_expanded.sum(dim=1).clamp(min=1e-9)            # (N, 1)
        embeddings = (sum_hidden / count).numpy().astype(np.float32)  # (N, 312)

        return embeddings

    def predict(
        self,
        node_features_list: list[dict],
        history: list[list[dict]],
    ) -> list[GNNPrediction]:
        """
        Run inference for all nodes using local TinyBERT.

        Args:
            node_features_list: Current snapshot — list of NodeFeature dicts.
            history:            Past N snapshots — used for trend boosting.

        Returns:
            List of GNNPrediction, one per node.
        """
        if not self._ready:
            raise RuntimeError("GNNModel.load() must be called before predict().")

        t0 = time.perf_counter()

        # --- Build text descriptions and get TinyBERT embeddings ---
        texts = [self._build_feature_text(nf) for nf in node_features_list]
        embeddings = self._get_embeddings(texts)                    # (N, 312)

        # --- Build raw feature matrix ---
        raw_np = np.stack(
            [self._extract_raw_features(nf) for nf in node_features_list]
        )                                                            # (N, NODE_FEATURE_DIM)

        # --- Score nodes ---
        risk_scores = _score_embeddings(embeddings, raw_np)         # (N,)

        # --- Trend analysis: boost risk if density has been rising ---
        trend_boosts = self._compute_trend_boosts(node_features_list, history)

        predictions: list[GNNPrediction] = []
        for i, nf in enumerate(node_features_list):
            base_risk = float(risk_scores[i])
            boosted_risk = min(1.0, base_risk + trend_boosts[i])
            confidence = self._compute_confidence(nf["nodeId"], history, boosted_risk)
            predicted_seconds = self._estimate_time_to_congestion(nf, boosted_risk)

            predictions.append(
                GNNPrediction(
                    node_id=nf["nodeId"],
                    risk_score=round(boosted_risk, 4),
                    confidence=round(confidence, 4),
                    predicted_in_seconds=predicted_seconds,
                )
            )

        elapsed = time.perf_counter() - t0
        logger.info(
            "GNNModel | TinyBERT inference for %d nodes in %.3fs",
            len(node_features_list),
            elapsed,
        )
        return predictions

    # ------------------------------------------------------------------
    # Internal helpers (scoring logic unchanged)
    # ------------------------------------------------------------------

    def _compute_trend_boosts(
        self,
        current_features: list[dict],
        history: list[list[dict]],
    ) -> list[float]:
        """
        Compare current density to historical average density per node.
        Returns a positive boost (0–0.2) if density is increasing.
        """
        boosts = []
        for nf in current_features:
            nid = nf["nodeId"]
            past_densities = []
            for snapshot in history[-5:]:  # use only last 5 snapshots
                for past_nf in snapshot:
                    if past_nf.get("nodeId") == nid:
                        past_densities.append(past_nf.get("density", 0.0))
                        break

            if past_densities:
                avg_past = np.mean(past_densities)
                trend = nf["density"] - avg_past
                boost = float(np.clip(trend * 0.4, 0.0, 0.2))
            else:
                boost = 0.0
            boosts.append(boost)
        return boosts

    def _compute_confidence(
        self,
        node_id: int,
        history: list[list[dict]],
        current_risk: float,
    ) -> float:
        """
        Confidence is higher when there is consistent history.
        Without history, confidence is moderate (0.5).
        """
        if len(history) < 3:
            return 0.50

        past_densities = []
        for snapshot in history:
            for nf in snapshot:
                if nf.get("nodeId") == node_id:
                    past_densities.append(nf.get("density", 0.0))
                    break

        if not past_densities:
            return 0.50

        std = float(np.std(past_densities))
        # Low variance → high confidence; high variance → lower confidence
        confidence = float(np.clip(1.0 - std * 2.0, 0.40, 0.95))
        return confidence

    def _estimate_time_to_congestion(self, nf: dict, risk_score: float) -> int:
        """
        Heuristic: estimate seconds until node becomes critically full.
        Returns 0 if already at risk, otherwise a positive integer.
        """
        remaining_capacity = max(0, nf["capacity"] - nf["population"])
        net_inflow = max(0.0, nf["entryRate"] - nf["exitRate"])

        if net_inflow <= 0 or risk_score < 0.3:
            return 60  # not converging; use a safe default

        seconds = int(remaining_capacity / net_inflow)
        # Clamp to sensible bounds
        return max(0, min(seconds, 120))
