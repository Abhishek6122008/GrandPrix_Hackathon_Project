# ============================================================
# config.py
# Centralized configuration loaded from environment variables.
# ============================================================

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application-wide settings, read from environment variables."""

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Local model names (downloaded from HuggingFace Hub on first run, then cached)
    TINYBERT_MODEL_NAME: str = os.getenv(
        "TINYBERT_MODEL_NAME", "huawei-noah/TinyBERT_General_4L_312D"
    )
    LLM_MODEL_NAME: str = os.getenv(
        "LLM_MODEL_NAME", "google/flan-t5-small"
    )
    USE_LOCAL_LLM: bool = os.getenv("USE_LOCAL_LLM", "False").lower() in ("true", "1", "yes")

    # Directory where HuggingFace will cache downloaded model weights
    MODEL_CACHE_DIR: str = os.getenv("MODEL_CACHE_DIR", "./hf_cache")

    # AI thresholds
    HIGH_RISK_THRESHOLD: float = float(os.getenv("HIGH_RISK_THRESHOLD", "0.75"))
    MEDIUM_RISK_THRESHOLD: float = float(os.getenv("MEDIUM_RISK_THRESHOLD", "0.50"))

    # History
    MAX_HISTORY_SNAPSHOTS: int = int(os.getenv("MAX_HISTORY_SNAPSHOTS", "20"))

    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")


# Singleton instance used throughout the app
settings = Settings()
