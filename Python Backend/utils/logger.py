# ============================================================
# utils/logger.py
# Configures a centralized application logger.
# ============================================================

import logging
import sys
from config import settings


def get_logger(name: str) -> logging.Logger:
    """
    Returns a named logger configured with the application log level.

    Args:
        name: Usually __name__ of the calling module.

    Returns:
        Configured Logger instance.
    """
    logger = logging.getLogger(name)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
    logger.propagate = False  # prevent duplicate logs from root logger
    return logger
