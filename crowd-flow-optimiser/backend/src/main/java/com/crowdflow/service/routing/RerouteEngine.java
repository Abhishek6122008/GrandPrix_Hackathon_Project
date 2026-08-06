package com.crowdflow.service.routing;

import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueEdge;
import com.crowdflow.model.VenueNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Dijkstra over edge length from a congested node to the nearest node that still has
 * headroom. Returns the whole path so the UI can animate it, not just the destination.
 */
@Component
public class RerouteEngine {

    private final double targetThreshold;

    public RerouteEngine(@Value("${simulation.warning-threshold:0.70}") double targetThreshold) {
        this.targetThreshold = targetThreshold;
    }

    /**
     * @param occupancy live people-per-node; a node qualifies as a target when its density
     *                  is below the warning threshold
     */
    public ReroutePath findReroute(Venue venue, String fromNodeId, Map<String, Integer> occupancy) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        if (!nodesById.containsKey(fromNodeId)) {
            return ReroutePath.none(fromNodeId);
        }

        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Double> distance = new HashMap<>();
        Map<String, String> previous = new HashMap<>();
        PriorityQueue<String> queue = new PriorityQueue<>(
                Comparator.comparingDouble(id -> distance.getOrDefault(id, Double.POSITIVE_INFINITY)));

        distance.put(fromNodeId, 0.0);
        queue.add(fromNodeId);

        while (!queue.isEmpty()) {
            String node = queue.poll();
            double here = distance.getOrDefault(node, Double.POSITIVE_INFINITY);

            if (!node.equals(fromNodeId) && hasHeadroom(nodesById.get(node), occupancy)) {
                return new ReroutePath(fromNodeId, node, pathTo(previous, fromNodeId, node), round(here));
            }

            for (VenueEdge edge : adjacency.getOrDefault(node, List.of())) {
                double candidate = here + edge.length();
                if (candidate < distance.getOrDefault(edge.to(), Double.POSITIVE_INFINITY)) {
                    distance.put(edge.to(), candidate);
                    previous.put(edge.to(), node);
                    queue.add(edge.to()); // stale entries are harmless: the shorter one pops first
                }
            }
        }
        return ReroutePath.none(fromNodeId);
    }

    private boolean hasHeadroom(VenueNode node, Map<String, Integer> occupancy) {
        if (node == null) {
            return false;
        }
        return (double) occupancy.getOrDefault(node.id(), 0) / node.capacity() < targetThreshold;
    }

    private List<String> pathTo(Map<String, String> previous, String from, String to) {
        List<String> path = new ArrayList<>();
        for (String at = to; at != null; at = previous.get(at)) {
            path.add(at);
            if (at.equals(from)) {
                break;
            }
        }
        Collections.reverse(path);
        return path;
    }

    private double round(double value) {
        return Math.round(value * 10) / 10.0;
    }
}
