package com.crowdflow.service.detection;

import com.crowdflow.dto.NodeState;
import com.crowdflow.dto.SimulationState;
import com.crowdflow.model.Alert;
import com.crowdflow.model.SimulationRun;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueNode;
import com.crowdflow.service.simulation.SimulationEngine;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Flags nodes that are over threshold, and says whether they are getting worse.
 * Trend is the slope of density across the last {@code simulation.trend-window} ticks —
 * a node sitting at 0.8 and falling is far less interesting than one at 0.72 and climbing.
 */
@Component
public class DensityDetector {

    private final double warningThreshold;
    private final double criticalThreshold;
    private final int trendWindow;

    public DensityDetector(@Value("${simulation.warning-threshold:0.70}") double warningThreshold,
                           @Value("${simulation.critical-threshold:0.85}") double criticalThreshold,
                           @Value("${simulation.trend-window:5}") int trendWindow) {
        this.warningThreshold = warningThreshold;
        this.criticalThreshold = criticalThreshold;
        this.trendWindow = trendWindow;
    }

    /** Alerts for the run's current tick. One per node that is at or above the warning threshold. */
    public List<Alert> detect(Venue venue, SimulationRun run) {
        int tick = run.getCurrentTick();
        Map<String, Double> now = SimulationEngine.densities(venue, run.occupancyAt(tick));

        List<Alert> alerts = new ArrayList<>();
        for (VenueNode node : venue.nodes()) {
            double density = now.getOrDefault(node.id(), 0.0);
            Alert.Severity severity = severityOf(density);
            if (severity == Alert.Severity.OK) {
                continue;
            }
            Alert.Trend trend = trendOf(venue, run, node.id());
            alerts.add(new Alert(
                    "alert-" + UUID.randomUUID().toString().substring(0, 8),
                    tick,
                    node.id(),
                    severity,
                    round(density),
                    trend,
                    "%s at %d%% capacity and %s".formatted(node.name(), Math.round(density * 100), verb(trend))));
        }
        return alerts;
    }

    /** The frame served by GET /state and pushed over the WebSocket. */
    public SimulationState stateOf(Venue venue, SimulationRun run, int tick) {
        Map<String, Integer> occupancy = run.occupancyAt(tick);
        List<NodeState> nodes = venue.nodes().stream()
                .map(node -> {
                    int people = occupancy.getOrDefault(node.id(), 0);
                    double density = (double) people / node.capacity();
                    return new NodeState(node.id(), people, node.capacity(), round(density), severityOf(density));
                })
                .toList();
        return new SimulationState(run.getId(), run.getVenueId(), tick, run.getTotalTicks(),
                run.getStatus().name(), nodes);
    }

    public Alert.Severity severityOf(double density) {
        if (density >= criticalThreshold) {
            return Alert.Severity.CRITICAL;
        }
        return density >= warningThreshold ? Alert.Severity.WARNING : Alert.Severity.OK;
    }

    /** Compares current density against the density {@code trendWindow} ticks ago. */
    public Alert.Trend trendOf(Venue venue, SimulationRun run, String nodeId) {
        int tick = run.getCurrentTick();
        int past = Math.max(0, tick - trendWindow);
        if (past == tick) {
            return Alert.Trend.FLAT;
        }
        double delta = densityAt(venue, run, nodeId, tick) - densityAt(venue, run, nodeId, past);
        if (delta > 0.03) {
            return Alert.Trend.RISING;
        }
        return delta < -0.03 ? Alert.Trend.FALLING : Alert.Trend.FLAT;
    }

    private double densityAt(Venue venue, SimulationRun run, String nodeId, int tick) {
        int capacity = venue.nodesById().get(nodeId).capacity();
        return (double) run.occupancyAt(tick).getOrDefault(nodeId, 0) / capacity;
    }

    private String verb(Alert.Trend trend) {
        return switch (trend) {
            case RISING -> "still filling";
            case FALLING -> "clearing";
            case FLAT -> "holding steady";
        };
    }

    private double round(double value) {
        return Math.round(value * 100) / 100.0;
    }
}
