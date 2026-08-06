# ============================================================
# utils/cache.py
# In-memory stores for graphs and prediction history.
# These are module-level singletons — shared across requests.
# ============================================================

from collections import deque
from typing import Any

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


class GraphCache:
    """
    Stores NetworkX graph objects keyed by simulationId.
    Graph is built ONCE at /simulation/init and reused on every
    /simulation/analyze call.
    """

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}

    def set(self, simulation_id: str, graph: Any) -> None:
        """Store a graph for a given simulation."""
        self._store[simulation_id] = graph
        logger.info("GraphCache | stored graph for simulationId=%s", simulation_id)

    def get(self, simulation_id: str) -> Any | None:
        """Retrieve graph; returns None if not found."""
        return self._store.get(simulation_id)

    def delete(self, simulation_id: str) -> bool:
        """Remove graph; returns True if it existed."""
        existed = simulation_id in self._store
        self._store.pop(simulation_id, None)
        return existed

    def exists(self, simulation_id: str) -> bool:
        return simulation_id in self._store


class HistoryCache:
    """
    Maintains the last N node-feature snapshots per simulationId.
    Used by the GNN for trend analysis.
    """

    def __init__(self, max_snapshots: int = settings.MAX_HISTORY_SNAPSHOTS) -> None:
        self._max_snapshots = max_snapshots
        self._store: dict[str, deque] = {}

    def append(self, simulation_id: str, snapshot: Any) -> None:
        """Append a snapshot; automatically evicts the oldest if limit reached."""
        if simulation_id not in self._store:
            self._store[simulation_id] = deque(maxlen=self._max_snapshots)
        self._store[simulation_id].append(snapshot)
        logger.debug(
            "HistoryCache | simulationId=%s | snapshots=%d",
            simulation_id,
            len(self._store[simulation_id]),
        )

    def get(self, simulation_id: str) -> list[Any]:
        """Return history as a plain list; empty list if none exists."""
        return list(self._store.get(simulation_id, []))

    def delete(self, simulation_id: str) -> bool:
        existed = simulation_id in self._store
        self._store.pop(simulation_id, None)
        return existed


class PredictionCache:
    """
    Caches the latest prediction result per simulationId.
    Avoids re-running inference if node features have not changed.
    """

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}

    def set(self, simulation_id: str, result: Any) -> None:
        self._store[simulation_id] = result

    def get(self, simulation_id: str) -> Any | None:
        return self._store.get(simulation_id)

    def delete(self, simulation_id: str) -> bool:
        existed = simulation_id in self._store
        self._store.pop(simulation_id, None)
        return existed


# ---------------------------------------------------------------------------
# Module-level singletons — imported by services
# ---------------------------------------------------------------------------
graph_cache = GraphCache()
history_cache = HistoryCache()
prediction_cache = PredictionCache()
