# ============================================================
# models/llm_model.py
#
# LLM wrapper for generating human-readable crowd-safety alerts.
#
# Model used:  google/flan-t5-small  (instruction-tuned seq2seq)
#
# Runs fully locally via HuggingFace `transformers` — no API key,
# no network call after the one-time model download (~80 MB).
# The model is downloaded to MODEL_CACHE_DIR on first startup.
#
# Swapping to a larger model requires only changing LLM_MODEL_NAME
# in .env (e.g., "google/flan-t5-base" or "google/flan-t5-large").
# ============================================================

from __future__ import annotations

import time

from transformers import AutoTokenizer, T5ForConditionalGeneration

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


class LLMModel:
    """
    LLM wrapper for crowd alert generation using local Flan-T5-Small.

    Public API
    ----------
    load()              — download (first run) and load Flan-T5-Small into memory.
    generate_alert()    — produce a natural-language advisory string.
    """

    def __init__(self) -> None:
        self._ready: bool = False
        self._tokenizer: AutoTokenizer | None = None
        self._model: T5ForConditionalGeneration | None = None

    def load(self) -> None:
        """
        Load Flan-T5-Small from the local HuggingFace cache (downloads on first run).
        Called ONCE at startup.
        """
        if not settings.USE_LOCAL_LLM:
            logger.info("LLMModel | Local LLM is disabled (USE_LOCAL_LLM=False). Skipping Flan-T5 loading.")
            self._ready = True
            return

        model_name = settings.LLM_MODEL_NAME
        cache_dir = settings.MODEL_CACHE_DIR

        logger.info("LLMModel | loading Flan-T5-Small: %s (cache: %s)", model_name, cache_dir)
        t0 = time.perf_counter()

        self._tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            cache_dir=cache_dir,
        )
        self._model = T5ForConditionalGeneration.from_pretrained(
            model_name,
            cache_dir=cache_dir,
        )
        self._model.eval()  # inference mode — disables dropout

        elapsed = time.perf_counter() - t0
        self._ready = True
        logger.info("LLMModel | Flan-T5-Small ready in %.2fs", elapsed)

    def generate_alert(
        self,
        node_name: str,
        severity: str,
        risk_score: float,
        predicted_in_seconds: int,
        recommended_route: str,
    ) -> str:
        """
        Generate a human-readable safety advisory using local Flan-T5-Small.

        Args:
            node_name:              Name of the crowd node (e.g. 'Hall A').
            severity:               Risk level string ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').
            risk_score:             Numeric risk in [0, 1].
            predicted_in_seconds:   Time until projected congestion.
            recommended_route:      Suggested alternate area.

        Returns:
            A concise advisory sentence string.
        """
        if not self._ready:
            raise RuntimeError("LLMModel.load() must be called before generate_alert().")

        prompt = self._build_prompt(
            node_name, severity, risk_score, predicted_in_seconds, recommended_route
        )

        t0 = time.perf_counter()
        advisory = self._call_model(prompt)
        elapsed = time.perf_counter() - t0

        if not advisory:
            advisory = (
                f"Crowd warning: {node_name} has {severity.lower()} risk. "
                f"Consider redirecting crowd to {recommended_route}."
            )

        logger.debug("LLMModel | generated advisory in %.3fs: %s", elapsed, advisory)
        return advisory

    def _call_model(self, prompt: str) -> str:
        """
        Run local Flan-T5 inference on the given prompt.

        Returns the generated text string.
        """
        import torch

        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=256,
        )

        with torch.no_grad():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=30,
                do_sample=False,      # deterministic output for consistency
                num_beams=1,          # greedy decoding for speed on CPU
            )

        generated = self._tokenizer.decode(
            output_ids[0],
            skip_special_tokens=True,
        ).strip()

        return generated

    def _build_prompt(
        self,
        node_name: str,
        severity: str,
        risk_score: float,
        predicted_in_seconds: int,
        recommended_route: str,
    ) -> str:
        """
        Constructs the instruction prompt for the LLM.

        Flan-T5 responds well to explicit, instruction-style prompts.
        """
        if severity in ("CRITICAL", "HIGH"):
            return f"Write a short safety alert: {node_name} has critical crowd congestion risk, please route to {recommended_route} immediately."
        else:
            return f"Write a short safety alert: {node_name} has high crowd risk, consider routing to {recommended_route}."
