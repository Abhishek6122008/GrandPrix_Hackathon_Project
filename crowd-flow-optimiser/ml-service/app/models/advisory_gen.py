"""Loads and wraps the NLP advisory generator.

Self-hosted: a transformers text-generation pipeline is built once at startup and runs in
this process. No calls to the Hugging Face Inference API at request time.

Model id comes from CROWDFLOW_ADVISORY_MODEL. Keep it small — this runs on a laptop
during the demo, not a GPU box.
"""

from __future__ import annotations

import os

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"

# Kept in step with ml/advisory/prompt_templates.py — if these drift, the model sees a
# prompt it was never tuned on.
PROMPT = """You are a venue safety operator. In one sentence, tell staff what to do.
Zone: {node}
Occupancy: {occupancy_pct}% of capacity, {trend}
Suggested diversion: {diversion}
Advisory:"""


class AdvisoryModel:
    """Holds the loaded pipeline. `loaded` is False until `load()` succeeds."""

    def __init__(self) -> None:
        self.pipeline = None
        self.loaded = False
        self.error: str | None = None
        self.model_id = os.environ.get("CROWDFLOW_ADVISORY_MODEL", DEFAULT_MODEL)

    def load(self) -> None:
        """Called once from the FastAPI lifespan. Never raises — /health reports the failure."""
        try:
            from transformers import pipeline

            self.pipeline = pipeline("text-generation", model=self.model_id)
            self.loaded = True
        except Exception as exc:  # noqa: BLE001 — startup must not die on a missing model
            self.error = f"{type(exc).__name__}: {exc}"
            self.loaded = False

    def generate(self, node: str, density: float, trend: str, reroute_path: list[str]) -> str:
        """
        TODO: format PROMPT, run self.pipeline with max_new_tokens ~60, strip the prompt
        back off the generated text, and return the first sentence.
        """
        raise NotImplementedError("Advisory generation not implemented yet")

    @staticmethod
    def describe_diversion(reroute_path: list[str]) -> str:
        if not reroute_path:
            return "No clear alternative — hold intake at the gates."
        return f"Divert to {reroute_path[-1]}."


# Module-level singleton, populated by the lifespan handler in main.py.
advisory_model = AdvisoryModel()
