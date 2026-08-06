# ============================================================
# services/graph_service.py
#
# Responsible for ALL graph operations:
#   - Building a NetworkX graph from init payload
#   - Updating node attributes with fresh features
#   - Providing graph metadata to other services
# ============================================================

from __future__ import annotations

import networkx as nx

from schemas.simulation import InitRequest, NodeFeature
from utils.cache import graph_cache
from utils.logger import get_logger

logger = get_logger(__name__)


class GraphService:
    """
    Manages the lifecycle of NetworkX graphs per simulation.
    """

    def build_and_store(self, request: InitRequest) -> None:
        """
        Create a directed graph from the init payload and store it in cache.

        The graph is built ONCE per simulation and updated in-place on every
        /simulation/analyze call — never rebuilt from scratch.

        Args:
            request: Validated InitRequest from Spring Boot.
        """
        graph = nx.DiGraph()

        # Add nodes with static metadata
        for node in request.nodes:
            graph.add_node(
                node.id,
                name=node.name,
                capacity=node.capacity,
                area=node.area,
                # Dynamic features initialised to zero — filled at analyze time
                population=0,
                density=0.0,
                entryRate=0.0,
                exitRate=0.0,
                averageSpeed=0.0,
                neighborDensity=0.0,
                queueLength=0,
            )

        # Add directed edges
        for edge in request.edges:
            if len(edge) >= 2:
                src, dst = edge[0], edge[1]
                if graph.has_node(src) and graph.has_node(dst):
                    graph.add_edge(src, dst)
                else:
                    logger.warning(
                        "GraphService | skipping edge [%d, %d] — node not found", src, dst
                    )

        graph_cache.set(request.simulationId, graph)
        logger.info(
            "GraphService | built graph for simulationId=%s | nodes=%d, edges=%d",
            request.simulationId,
            graph.number_of_nodes(),
            graph.number_of_edges(),
        )

    def update_features(
        self, simulation_id: str, node_features: list[NodeFeature]
    ) -> nx.DiGraph:
        """
        Update dynamic attributes on existing graph nodes.

        Args:
            simulation_id: Identifies the graph in cache.
            node_features: Fresh readings from Spring Boot.

        Returns:
            Updated graph object.

        Raises:
            KeyError: If simulation_id is not found in cache.
        """
        graph: nx.DiGraph | None = graph_cache.get(simulation_id)
        if graph is None:
            raise KeyError(f"No graph found for simulationId={simulation_id}")

        for nf in node_features:
            if not graph.has_node(nf.nodeId):
                logger.warning(
                    "GraphService | nodeId=%d not in graph (simulationId=%s) — skipping",
                    nf.nodeId,
                    simulation_id,
                )
                continue

            graph.nodes[nf.nodeId].update(
                {
                    "population": nf.population,
                    "capacity": nf.capacity,
                    "density": nf.density,
                    "entryRate": nf.entryRate,
                    "exitRate": nf.exitRate,
                    "averageSpeed": nf.averageSpeed,
                    "neighborDensity": nf.neighborDensity,
                    "queueLength": nf.queueLength,
                }
            )

        logger.debug(
            "GraphService | updated features for %d nodes (simulationId=%s)",
            len(node_features),
            simulation_id,
        )
        return graph

    def get_node_name(self, simulation_id: str, node_id: int) -> str:
        """Return the human-readable name of a node, or a default string."""
        graph: nx.DiGraph | None = graph_cache.get(simulation_id)
        if graph is None or not graph.has_node(node_id):
            return f"Area-{node_id}"
        return graph.nodes[node_id].get("name", f"Area-{node_id}")

    def get_neighbor_names(self, simulation_id: str, node_id: int) -> list[str]:
        """
        Returns names of neighboring (successor) nodes —
        used as candidate recommended routes.
        """
        graph: nx.DiGraph | None = graph_cache.get(simulation_id)
        if graph is None or not graph.has_node(node_id):
            return []
        neighbors = list(graph.successors(node_id))
        return [graph.nodes[n].get("name", f"Area-{n}") for n in neighbors]

    def exists(self, simulation_id: str) -> bool:
        """Returns True if the simulation graph has been initialized."""
        return graph_cache.exists(simulation_id)

    def remove(self, simulation_id: str) -> None:
        """Delete graph from cache (called on simulation end)."""
        graph_cache.delete(simulation_id)
        logger.info("GraphService | removed graph for simulationId=%s", simulation_id)


# Module-level singleton used via FastAPI DI
graph_service = GraphService()
