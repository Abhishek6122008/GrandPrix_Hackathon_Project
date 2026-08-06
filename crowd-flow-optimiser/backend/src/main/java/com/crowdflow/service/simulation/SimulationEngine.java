package com.crowdflow.service.simulation;

import com.crowdflow.model.SimulationRun;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueEdge;
import com.crowdflow.model.VenueNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tick-based crowd flow over the venue graph.
 *
 * <p>Each tick: exits drain, everyone else advances toward the nearest exit as far as
 * downstream capacity and edge throughput allow, then new arrivals enter at the gates.
 * People who cannot move stay put — that is what makes a node's density climb, which is
 * exactly the bottleneck the detector is looking for.
 */
@Service
public class SimulationEngine {

    private final AgentFactory agentFactory;
    private final SocialForceModel socialForceModel;
    private final double criticalThreshold;

    /** Hop distance to the nearest exit, per venue. Layouts are immutable once uploaded. */
    private final Map<String, Map<String, Integer>> hopCache = new ConcurrentHashMap<>();

    public SimulationEngine(AgentFactory agentFactory, SocialForceModel socialForceModel,
                            @Value("${simulation.critical-threshold:0.85}") double criticalThreshold) {
        this.agentFactory = agentFactory;
        this.socialForceModel = socialForceModel;
        this.criticalThreshold = criticalThreshold;
    }

    public SimulationRun create(Venue venue, int crowdSize, int ticks, int arrivalRate, boolean rerouteEnabled) {
        SimulationRun run = new SimulationRun("sim-" + UUID.randomUUID().toString().substring(0, 8),
                venue.id(), crowdSize, ticks, arrivalRate, rerouteEnabled);
        venue.nodes().forEach(n -> run.getOccupancy().put(n.id(), 0));
        run.getHistory().add(Map.copyOf(run.getOccupancy())); // tick 0 = empty venue
        return run;
    }

    /**
     * Advances the run by exactly one tick and returns the resulting density
     * (occupancy / capacity) per node.
     */
    public Map<String, Double> advanceTick(Venue venue, SimulationRun run) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Integer> hops = hopCache.computeIfAbsent(venue.id(), k -> hopsToExit(venue));

        Map<String, Integer> current = new HashMap<>(run.getOccupancy());
        Map<String, Integer> next = new HashMap<>(current);

        // 1. Exits drain fully — those people have left the venue.
        for (VenueNode node : venue.nodes()) {
            if (!node.isExit()) {
                continue;
            }
            int leaving = current.getOrDefault(node.id(), 0);
            if (leaving > 0) {
                next.merge(node.id(), -leaving, Integer::sum);
                run.recordExits(leaving);
            }
        }

        // 2. Move people exit-ward, closest-to-exit first so freed space is reusable this tick.
        double speed = agentFactory.cohortSpeedFactor(run.getCrowdSize());
        List<VenueNode> order = new ArrayList<>(venue.nodes().stream().filter(n -> !n.isExit()).toList());
        order.sort(Comparator.comparingInt(n -> hops.getOrDefault(n.id(), Integer.MAX_VALUE)));

        for (VenueNode node : order) {
            int here = current.getOrDefault(node.id(), 0);
            if (here == 0) {
                continue;
            }
            int movers = (int) Math.round(here * mobility(node) * speed);

            for (VenueEdge edge : downstream(adjacency, hops, nodesById, next, node.id(), run.isRerouteEnabled())) {
                if (movers <= 0) {
                    break;
                }
                VenueNode target = nodesById.get(edge.to());
                if (target == null) {
                    continue;
                }
                int spare = target.capacity() - next.getOrDefault(target.id(), 0);
                // Congestion slows you down entering a crowded space — it does not paralyse the
                // one you are leaving. A packed gate still empties at the corridor's rate.
                double targetDensity = (double) next.getOrDefault(target.id(), 0) / target.capacity();
                int throughput = (int) Math.round(
                        edge.throughputPerTick() * socialForceModel.congestionSlowdown(targetDensity));
                int moved = Math.min(movers, Math.min(spare, throughput));
                if (moved <= 0) {
                    continue;
                }
                next.merge(node.id(), -moved, Integer::sum);
                next.merge(target.id(), moved, Integer::sum);
                movers -= moved;
            }
        }

        // 3. New arrivals queue in at the gates, split evenly, capped by gate headroom.
        List<VenueNode> gates = venue.nodes().stream().filter(VenueNode::isEntry).toList();
        if (!gates.isEmpty()) {
            int perGate = Math.max(1, run.getArrivalRate() / gates.size());
            for (VenueNode gate : gates) {
                int inGate = next.getOrDefault(gate.id(), 0);
                // With rerouting on we act on our own advice: intake is held so the gate
                // never crosses critical — people wait outside instead of crushing inside.
                // -1 keeps the gate strictly below critical rather than landing exactly on it.
                int ceiling = run.isRerouteEnabled()
                        ? (int) Math.ceil(gate.capacity() * criticalThreshold) - 1
                        : gate.capacity();
                int arriving = run.takeArrivals(Math.max(0, Math.min(perGate, ceiling - inGate)));
                if (arriving > 0) {
                    next.merge(gate.id(), arriving, Integer::sum);
                }
            }
        }

        run.getOccupancy().putAll(next);
        run.setCurrentTick(run.getCurrentTick() + 1);
        run.getHistory().add(Map.copyOf(next)); // history index == tick
        if (run.isFinished()) {
            run.setStatus(SimulationRun.Status.COMPLETED);
        }
        return densities(venue, next);
    }

    public static Map<String, Double> densities(Venue venue, Map<String, Integer> occupancy) {
        Map<String, Double> result = new LinkedHashMap<>();
        for (VenueNode node : venue.nodes()) {
            result.put(node.id(), (double) occupancy.getOrDefault(node.id(), 0) / node.capacity());
        }
        return result;
    }

    /** Share of a node's occupants that try to move on each tick, before congestion effects. */
    private double mobility(VenueNode node) {
        return switch (node.type()) {
            case WALKWAY -> 0.80;
            case GATE -> 0.70;
            case CONCESSION -> 0.25; // people linger to buy
            case SEATING -> 0.10;
            case EXIT -> 1.0;
        };
    }

    /**
     * Where a node's occupants may move, best first.
     *
     * <p>Without rerouting, only edges leading strictly closer to an exit — people head for
     * the exit and queue when it is full. With rerouting, lateral moves (same hop count) are
     * allowed too, so a crowd can spill around a blocked node. Backward moves are never
     * allowed either way: sending people back toward the gate is not a reroute, it is a crush.
     */
    private List<VenueEdge> downstream(Map<String, List<VenueEdge>> adjacency, Map<String, Integer> hops,
                                       Map<String, VenueNode> nodesById, Map<String, Integer> occupancy,
                                       String nodeId, boolean rerouteEnabled) {
        int here = hops.getOrDefault(nodeId, Integer.MAX_VALUE);
        List<VenueEdge> candidates = new ArrayList<>();
        for (VenueEdge edge : adjacency.getOrDefault(nodeId, List.of())) {
            int there = hops.getOrDefault(edge.to(), Integer.MAX_VALUE);
            if (there < here || (rerouteEnabled && there == here)) {
                candidates.add(edge);
            }
        }
        // Closest to an exit first; among equals, whichever has the most room left — otherwise
        // a 90-person kiosk soaks up crowd the 900-person stand next door could have absorbed.
        candidates.sort(Comparator
                .comparingInt((VenueEdge e) -> hops.getOrDefault(e.to(), Integer.MAX_VALUE))
                .thenComparing(Comparator.comparingInt(
                        (VenueEdge e) -> spare(nodesById, occupancy, e.to())).reversed()));
        return candidates;
    }

    private int spare(Map<String, VenueNode> nodesById, Map<String, Integer> occupancy, String nodeId) {
        VenueNode node = nodesById.get(nodeId);
        return node == null ? 0 : node.capacity() - occupancy.getOrDefault(nodeId, 0);
    }

    /** BFS backwards from every exit. Unreachable nodes get Integer.MAX_VALUE. */
    private Map<String, Integer> hopsToExit(Venue venue) {
        Map<String, List<String>> incoming = new HashMap<>();
        for (VenueEdge edge : venue.edges()) {
            incoming.computeIfAbsent(edge.to(), k -> new ArrayList<>()).add(edge.from());
            if (edge.bidirectional()) {
                incoming.computeIfAbsent(edge.from(), k -> new ArrayList<>()).add(edge.to());
            }
        }

        Map<String, Integer> hops = new HashMap<>();
        Deque<String> queue = new ArrayDeque<>();
        for (VenueNode node : venue.nodes()) {
            if (node.isExit()) {
                hops.put(node.id(), 0);
                queue.add(node.id());
            }
        }
        while (!queue.isEmpty()) {
            String node = queue.poll();
            for (String previous : incoming.getOrDefault(node, List.of())) {
                if (hops.putIfAbsent(previous, hops.get(node) + 1) == null) {
                    queue.add(previous);
                }
            }
        }
        venue.nodes().forEach(n -> hops.putIfAbsent(n.id(), Integer.MAX_VALUE));
        return hops;
    }
}
