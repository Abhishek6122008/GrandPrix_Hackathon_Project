package com.crowdflow.model;

import com.crowdflow.dto.SessionState;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * One live simulation session: a venue, the crowd walking through it, and everything the
 * detector, route engine and AI layer have said about it so far.
 *
 * <p>Threading contract, because it is the thing most likely to bite:
 * <ul>
 *   <li>{@link #people} and {@link #densityHistory} are touched <em>only</em> by the tick
 *       thread. They are plain collections on purpose — a CopyOnWriteArrayList of a few
 *       thousand agents mutated ten times a second would copy the backing array to death.</li>
 *   <li>Everything a controller or a WebSocket thread reads goes through
 *       {@link #latestState}, a volatile immutable snapshot the tick thread publishes.</li>
 *   <li>{@link #alerts}, {@link #advisories} and {@link #reroutes} are append-mostly feeds
 *       read by controllers, so those stay concurrent.</li>
 * </ul>
 */
public class Session {

    public enum Status { CREATED, RUNNING, PAUSED, STOPPED, COMPLETED }

    private final String id;
    private final Venue venue;
    private final int crowdSize;
    private final int arrivalRate;
    private final int maxTicks;
    private final double tickSeconds;
    private final boolean rerouteEnabled;
    private final long createdAtMillis = System.currentTimeMillis();

    // --- tick-thread only -------------------------------------------------
    private final List<Person> people = new ArrayList<>();
    /** Rolling density snapshots, oldest first. Bounded — see SessionManager.historyWindow. */
    private final List<Map<String, Double>> densityHistory = new ArrayList<>();
    private int spawned;
    private int exited;
    /** Running safety totals, accumulated every tick so they survive broadcast decimation. */
    private volatile double peakDensity;
    private volatile int criticalNodeTicks;

    // --- shared -----------------------------------------------------------
    private final List<Alert> alerts = new CopyOnWriteArrayList<>();
    private final List<String> advisories = new CopyOnWriteArrayList<>();
    private final List<ReroutePath> reroutes = new CopyOnWriteArrayList<>();

    /** Latest per-node risk from the AI layer; empty until the first successful analyse. */
    private volatile Map<String, Double> predictedRisk = Map.of();
    private volatile String latestAdvisory;
    /** Why the AI layer last came back short, if it did. Surfaced so the demo can be honest. */
    private volatile String aiStatus = "not-yet-called";

    /** Guards against stacking analyse calls when one is already in flight. */
    private final AtomicBoolean analyseInFlight = new AtomicBoolean(false);
    /** Density snapshot the last analyse call was made on, for the change threshold. */
    private volatile Map<String, Double> lastAnalysedDensity = Map.of();
    private volatile int lastAnalysedTick = Integer.MIN_VALUE;

    private volatile Status status = Status.CREATED;
    private volatile int tick;
    private volatile SessionState latestState;

    public Session(String id, Venue venue, int crowdSize, int arrivalRate, int maxTicks,
                   double tickSeconds, boolean rerouteEnabled) {
        this.id = id;
        this.venue = venue;
        this.crowdSize = crowdSize;
        this.arrivalRate = arrivalRate;
        this.maxTicks = maxTicks;
        this.tickSeconds = tickSeconds;
        this.rerouteEnabled = rerouteEnabled;
    }

    /** People currently in the venue, grouped by the node they are counted against. */
    public Map<String, Integer> occupancy() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        venue.nodes().forEach(node -> counts.put(node.id(), 0));
        for (Person person : people) {
            counts.merge(person.getCurrentNodeId(), 1, Integer::sum);
        }
        return counts;
    }

    public boolean isFinished() {
        return tick >= maxTicks || (spawned >= crowdSize && people.isEmpty() && tick > 0);
    }

    public String getId() { return id; }
    public Venue getVenue() { return venue; }
    public int getCrowdSize() { return crowdSize; }
    public int getArrivalRate() { return arrivalRate; }
    public int getMaxTicks() { return maxTicks; }
    public double getTickSeconds() { return tickSeconds; }
    public boolean isRerouteEnabled() { return rerouteEnabled; }
    public long getCreatedAtMillis() { return createdAtMillis; }
    public List<Person> getPeople() { return people; }
    public List<Map<String, Double>> getDensityHistory() { return densityHistory; }
    public int getSpawned() { return spawned; }
    public int getExited() { return exited; }
    public List<Alert> getAlerts() { return alerts; }
    public List<String> getAdvisories() { return advisories; }
    public List<ReroutePath> getReroutes() { return reroutes; }
    public Map<String, Double> getPredictedRisk() { return predictedRisk; }
    public String getLatestAdvisory() { return latestAdvisory; }
    public String getAiStatus() { return aiStatus; }
    public AtomicBoolean getAnalyseInFlight() { return analyseInFlight; }
    public Map<String, Double> getLastAnalysedDensity() { return lastAnalysedDensity; }
    public int getLastAnalysedTick() { return lastAnalysedTick; }
    public Status getStatus() { return status; }
    public int getTick() { return tick; }
    public SessionState getLatestState() { return latestState; }

    public void setStatus(Status status) { this.status = status; }
    public void setTick(int tick) { this.tick = tick; }
    public void setLatestState(SessionState state) { this.latestState = state; }
    public void setPredictedRisk(Map<String, Double> risk) { this.predictedRisk = risk; }
    public void setLatestAdvisory(String advisory) { this.latestAdvisory = advisory; }
    public void setAiStatus(String aiStatus) { this.aiStatus = aiStatus; }
    public void setLastAnalysed(Map<String, Double> density, int tick) {
        this.lastAnalysedDensity = density;
        this.lastAnalysedTick = tick;
    }

    public void recordSpawned(int count) { this.spawned += count; }
    public void recordExited(int count) { this.exited += count; }

    public double getPeakDensity() { return peakDensity; }
    public int getCriticalNodeTicks() { return criticalNodeTicks; }

    /** Folds one tick's densities into the running safety totals. */
    public void recordDensities(Map<String, Double> densities, double criticalThreshold) {
        for (double density : densities.values()) {
            if (density > peakDensity) {
                peakDensity = density;
            }
            if (density >= criticalThreshold) {
                criticalNodeTicks++;
            }
        }
    }

    /** How many more people may still enter, given the crowd size the organiser asked for. */
    public int remainingToSpawn() { return Math.max(0, crowdSize - spawned); }
}
