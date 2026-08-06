package com.crowdflow.service.detection;

import com.crowdflow.config.HfClientConfig;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueEdge;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Calls the Hugging Face-hosted congestion-propagation GNN: given the current density of
 * every node, predict the risk each node carries a few ticks ahead.
 *
 * <p>Falls back to a one-hop diffusion mock whenever {@code hf.mock-enabled} is set or the
 * call fails, so local dev and the demo never block on the model being up.
 */
@Component
public class GnnRiskClient {

    private static final Logger log = LoggerFactory.getLogger(GnnRiskClient.class);

    private final RestClient restClient;
    private final HfClientConfig config;

    public GnnRiskClient(RestClient hfRestClient, HfClientConfig config) {
        this.restClient = hfRestClient;
        this.config = config;
    }

    /** nodeId -> predicted risk in [0,1] for the next few ticks. */
    @SuppressWarnings("unchecked")
    public Map<String, Double> predictRisk(Venue venue, Map<String, Double> densities) {
        if (config.useMock()) {
            return mockRisk(venue, densities);
        }
        try {
            Map<String, Object> response = restClient.post()
                    .uri(config.getGnnEndpoint())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("inputs", payload(venue, densities)))
                    .retrieve()
                    .body(Map.class);

            Object risks = response == null ? null : response.get("risk");
            if (risks instanceof Map<?, ?> map) {
                Map<String, Double> result = new LinkedHashMap<>();
                map.forEach((k, v) -> result.put(String.valueOf(k), ((Number) v).doubleValue()));
                return result;
            }
            log.warn("GNN endpoint returned an unexpected shape, using mock risk");
        } catch (RuntimeException e) {
            log.warn("GNN inference failed ({}), using mock risk", e.getMessage());
        }
        return mockRisk(venue, densities);
    }

    /** Node features + edge index, the shape the exported PyG model expects. See ml/gnn/model.py. */
    private Map<String, Object> payload(Venue venue, Map<String, Double> densities) {
        List<String> nodeIds = venue.nodes().stream().map(n -> n.id()).toList();
        Map<String, Integer> index = new HashMap<>();
        for (int i = 0; i < nodeIds.size(); i++) {
            index.put(nodeIds.get(i), i);
        }
        List<List<Integer>> edgeIndex = new ArrayList<>();
        for (VenueEdge edge : venue.edges()) {
            edgeIndex.add(List.of(index.get(edge.from()), index.get(edge.to())));
            if (edge.bidirectional()) {
                edgeIndex.add(List.of(index.get(edge.to()), index.get(edge.from())));
            }
        }
        return Map.of(
                "node_ids", nodeIds,
                "density", nodeIds.stream().map(id -> densities.getOrDefault(id, 0.0)).toList(),
                "capacity", venue.nodes().stream().map(n -> n.capacity()).toList(),
                "edge_index", edgeIndex);
    }

    /**
     * Mock: risk is mostly a node's own density plus a share of its worst neighbour's —
     * the same intuition the GNN should learn, just without the learning.
     */
    private Map<String, Double> mockRisk(Venue venue, Map<String, Double> densities) {
        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Double> risk = new LinkedHashMap<>();
        venue.nodes().forEach(node -> {
            double own = densities.getOrDefault(node.id(), 0.0);
            double worstNeighbour = adjacency.getOrDefault(node.id(), List.of()).stream()
                    .mapToDouble(e -> densities.getOrDefault(e.to(), 0.0))
                    .max()
                    .orElse(0.0);
            risk.put(node.id(), Math.min(1.0, 0.65 * own + 0.35 * worstNeighbour));
        });
        return risk;
    }
}
