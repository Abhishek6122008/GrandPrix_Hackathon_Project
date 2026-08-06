package com.crowdflow.model;

import com.crowdflow.dto.Advisory;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Mutable state of one simulation run. Written by the tick scheduler, read by
 * controllers and the WebSocket broadcaster, so the collections are concurrent.
 */
public class SimulationRun {

    public enum Status { RUNNING, COMPLETED }

    private final String id;
    private final String venueId;
    private final int crowdSize;
    private final int totalTicks;
    private final int arrivalRate;
    private final boolean rerouteEnabled;

    /** nodeId -> people currently in that node. */
    private final Map<String, Integer> occupancy = new ConcurrentHashMap<>();
    /** occupancy snapshot per tick, index == tick. */
    private final List<Map<String, Integer>> history = new CopyOnWriteArrayList<>();
    private final List<Alert> alerts = new CopyOnWriteArrayList<>();
    private final List<Advisory> advisories = new CopyOnWriteArrayList<>();

    /** Last severity reported per node, so the alert feed only records changes. */
    private final Map<String, Alert.Severity> lastSeverity = new ConcurrentHashMap<>();

    private volatile int currentTick = 0;
    private volatile int pendingArrivals;
    private volatile int exited = 0;
    private volatile Status status = Status.RUNNING;

    /** Paired no-intervention run, ticked in lockstep, that the summary compares against. */
    private volatile String baselineRunId;
    /** True for that paired run itself — it is simulated but not alerted on. */
    private volatile boolean shadow;

    public SimulationRun(String id, String venueId, int crowdSize, int totalTicks,
                         int arrivalRate, boolean rerouteEnabled) {
        this.id = id;
        this.venueId = venueId;
        this.crowdSize = crowdSize;
        this.totalTicks = totalTicks;
        this.arrivalRate = arrivalRate;
        this.rerouteEnabled = rerouteEnabled;
        this.pendingArrivals = crowdSize;
    }

    public String getId() { return id; }
    public String getVenueId() { return venueId; }
    public int getCrowdSize() { return crowdSize; }
    public int getTotalTicks() { return totalTicks; }
    public int getArrivalRate() { return arrivalRate; }
    public boolean isRerouteEnabled() { return rerouteEnabled; }
    public Map<String, Integer> getOccupancy() { return occupancy; }
    public List<Map<String, Integer>> getHistory() { return history; }
    public List<Alert> getAlerts() { return alerts; }
    public List<Advisory> getAdvisories() { return advisories; }
    public int getCurrentTick() { return currentTick; }
    public int getPendingArrivals() { return pendingArrivals; }
    public int getExited() { return exited; }
    public Status getStatus() { return status; }
    public Map<String, Alert.Severity> getLastSeverity() { return lastSeverity; }
    public String getBaselineRunId() { return baselineRunId; }
    public boolean isShadow() { return shadow; }

    public void setCurrentTick(int tick) { this.currentTick = tick; }
    public void setStatus(Status status) { this.status = status; }
    public void setBaselineRunId(String baselineRunId) { this.baselineRunId = baselineRunId; }
    public void setShadow(boolean shadow) { this.shadow = shadow; }

    public int takeArrivals(int wanted) {
        int taken = Math.min(wanted, pendingArrivals);
        pendingArrivals -= taken;
        return taken;
    }

    public void recordExits(int people) { this.exited += people; }

    public boolean isFinished() {
        return currentTick >= totalTicks || (pendingArrivals == 0 && exited >= crowdSize);
    }

    /** Occupancy at a past tick, or the live snapshot when {@code tick} is out of range. */
    public Map<String, Integer> occupancyAt(int tick) {
        return tick >= 0 && tick < history.size() ? history.get(tick) : Map.copyOf(occupancy);
    }
}
