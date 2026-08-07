package com.crowdflow.service.session;

import com.crowdflow.client.FastApiClient;
import com.crowdflow.dto.CreateSessionRequest;
import com.crowdflow.dto.SessionSummary;
import com.crowdflow.model.Alert;
import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.Session;
import com.crowdflow.model.Venue;
import com.crowdflow.repository.SessionRepository;
import com.crowdflow.repository.VenueRepository;
import com.crowdflow.service.VenueValidator;
import com.crowdflow.service.broadcast.StateBroadcaster;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.routing.RerouteEngine;
import com.crowdflow.service.simulation.SimulationEngine;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Owns session lifecycle and the clock that drives every running session.
 *
 * <p>One scheduled tick, ~100 ms apart, does the whole pipeline for each RUNNING session:
 * step the agents, measure density, raise alerts, reroute anyone heading into a new jam,
 * hand the tick to the AI layer <em>if</em> it is worth a call, and broadcast.
 *
 * <p>The tick runs on a single scheduler thread, which is what lets {@link Session} keep its
 * agent list unsynchronised. If that ever changes, that comment on Session becomes a lie and
 * the agent list needs a lock.
 */
@Service
public class SessionManager {

    private static final Logger log = LoggerFactory.getLogger(SessionManager.class);

    private final SessionRepository sessions;
    private final VenueRepository venues;
    private final SimulationEngine engine;
    private final DensityDetector detector;
    private final RerouteEngine routeEngine;
    private final FastApiClient fastApiClient;
    private final StateBroadcaster broadcaster;

    private final int historyWindow;
    private final int broadcastEveryTicks;
    private final double criticalThreshold;
    private final long retainAfterFinishMs;

    /** Nodes already rerouted around, per session — so one jam does not re-plan every tick. */
    private final Map<String, Set<String>> reroutedNodes = new ConcurrentHashMap<>();

    public SessionManager(SessionRepository sessions, VenueRepository venues, SimulationEngine engine,
                          DensityDetector detector, RerouteEngine routeEngine,
                          FastApiClient fastApiClient, StateBroadcaster broadcaster,
                          @Value("${session.history-window:120}") int historyWindow,
                          @Value("${session.broadcast-every-ticks:2}") int broadcastEveryTicks,
                          @Value("${simulation.critical-threshold:0.85}") double criticalThreshold,
                          @Value("${session.retain-after-finish-ms:600000}") long retainAfterFinishMs) {
        this.sessions = sessions;
        this.venues = venues;
        this.engine = engine;
        this.detector = detector;
        this.routeEngine = routeEngine;
        this.fastApiClient = fastApiClient;
        this.broadcaster = broadcaster;
        this.historyWindow = historyWindow;
        this.broadcastEveryTicks = Math.max(1, broadcastEveryTicks);
        this.criticalThreshold = criticalThreshold;
        this.retainAfterFinishMs = retainAfterFinishMs;
    }

    // --- lifecycle --------------------------------------------------------

    /**
     * Creates a session from an uploaded venue. The venue is stored too, so the existing
     * {@code GET /venues/{id}} keeps working for whatever wants to draw the layout.
     */
    public Session create(CreateSessionRequest request) {
        // Validate before storing: a venue that fails the check must not be left behind in the
        // repository for a later GET /venues/{id} to find.
        VenueValidator.validate(request.venue());
        Venue venue = venues.save(request.venue());

        Session session = new Session(
                "sess-" + UUID.randomUUID().toString().substring(0, 8),
                venue,
                request.crowdSize(),
                request.arrivalRate(),
                request.maxTicksOrDefault(),
                request.tickSecondsOrDefault(),
                request.rerouteEnabledOrDefault());

        // With rerouting on, run a no-intervention twin in lockstep so the summary has a real
        // before/after rather than a guess. It shares the session's seed, so the only
        // difference between the two runs is the intervention itself.
        if (session.isRerouteEnabled()) {
            Session baseline = session.baselineTwin(session.getId() + "-baseline");
            sessions.save(baseline);
            session.setBaselineSessionId(baseline.getId());
        }

        // Publish an empty frame immediately so a viewer connecting before start sees the
        // venue rather than a blank map.
        Map<String, Double> densities = detector.densitiesOf(session);
        session.getDensityHistory().add(densities);
        broadcaster.broadcast(session, densities, detector.trendsOf(session, densities));
        return sessions.save(session);
    }

    /** Runs an action on a session and its baseline twin, when it has one. */
    private Session withTwin(Session session, java.util.function.Consumer<Session> action) {
        action.accept(session);
        if (session.getBaselineSessionId() != null) {
            sessions.findById(session.getBaselineSessionId()).ifPresent(action);
        }
        return session;
    }

    public Session start(String id) {
        Session session = sessions.getOrThrow(id);
        if (session.getStatus() == Session.Status.STOPPED || session.getStatus() == Session.Status.COMPLETED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Session " + id + " is " + session.getStatus() + " and cannot be restarted");
        }
        // The twin moves with its session, always. A baseline that ran for a different number
        // of ticks is not a baseline.
        return withTwin(session, s -> {
            if (s.getStatus() != Session.Status.COMPLETED) {
                s.setStatus(Session.Status.RUNNING);
            }
        });
    }

    public Session pause(String id) {
        return withTwin(sessions.getOrThrow(id), s -> {
            if (s.getStatus() == Session.Status.RUNNING) {
                s.setStatus(Session.Status.PAUSED);
            }
        });
    }

    /** Terminal: the run is over and its numbers are final. Viewers keep the last frame. */
    public Session stop(String id) {
        return withTwin(sessions.getOrThrow(id), s -> s.setStatus(Session.Status.STOPPED));
    }

    public Session get(String id) {
        return sessions.getOrThrow(id);
    }

    /** Live and recently finished sessions, newest first. Baseline twins are not listed. */
    public List<Session> list() {
        return sessions.findAll().stream()
                .filter(session -> !session.isShadow())
                .sorted(Comparator.comparing(Session::getId))
                .toList();
    }

    /** Post-run stats, with the before/after comparison when the session has a baseline twin. */
    public SessionSummary summary(String id) {
        Session session = sessions.getOrThrow(id);
        Session baseline = session.getBaselineSessionId() == null ? null
                : sessions.findById(session.getBaselineSessionId()).orElse(null);
        return SessionSummary.of(session, baseline);
    }

    public int viewerCount(String sessionId) {
        return broadcaster.viewerCount(sessionId);
    }

    // --- the clock --------------------------------------------------------

    /** One tick for every running session. Interval comes from {@code session.tick-interval-ms}. */
    @Scheduled(fixedDelayString = "${session.tick-interval-ms:100}")
    public void tick() {
        for (Session session : sessions.findAll()) {
            if (session.getStatus() != Session.Status.RUNNING) {
                continue;
            }
            try {
                advance(session);
            } catch (RuntimeException e) {
                // One broken session must not stop the clock for the others.
                log.error("Session {} failed at tick {}", session.getId(), session.getTick(), e);
                session.setStatus(Session.Status.STOPPED);
            }
        }
    }

    private void advance(Session session) {
        engine.step(session);

        Map<String, Double> densities = detector.densitiesOf(session);
        session.recordDensities(densities, criticalThreshold);
        appendHistory(session, densities);

        Map<String, Alert.Trend> trends = detector.trendsOf(session, densities);
        List<Alert> alerts = detector.detectSession(session, densities, trends);
        List<Alert> raised = recordNewAlerts(session, alerts, densities);

        if (session.isRerouteEnabled()) {
            rerouteAroundNewJams(session, raised, densities);
        }

        if (session.isFinished()) {
            session.setStatus(Session.Status.COMPLETED);
        }

        // A baseline twin exists only to produce comparable numbers. It is never analysed and
        // never broadcast — spending a Hugging Face call on a run nobody watches is waste, and
        // pushing its frames would make two runs fight over one viewer's map.
        if (session.isShadow()) {
            return;
        }

        if (detector.shouldAnalyse(session, densities)) {
            fastApiClient.analyseAsync(session, densities, trends,
                    detector.highRiskNodes(densities, session.getPredictedRisk()));
        }
        if (session.getTick() % broadcastEveryTicks == 0 || session.getStatus() != Session.Status.RUNNING) {
            broadcaster.broadcast(session, densities, trends);
        }
    }

    /**
     * Drops sessions that finished long enough ago that nobody is coming back for them.
     *
     * <p>Without this the process keeps every session it has ever run — each holding its full
     * agent list — until it dies. An afternoon of demoing is enough to notice.
     */
    @Scheduled(fixedDelayString = "${session.evict-interval-ms:60000}")
    public void evictFinishedSessions() {
        long cutoff = System.currentTimeMillis() - retainAfterFinishMs;
        for (Session session : List.copyOf(sessions.findAll())) {
            long finishedAt = session.getFinishedAtMillis();
            if (finishedAt == 0 || finishedAt > cutoff) {
                continue;
            }
            sessions.delete(session.getId());
            broadcaster.forget(session.getId());
            reroutedNodes.remove(session.getId());
            log.info("Evicted session {} ({} ticks, finished {}s ago)", session.getId(),
                    session.getTick(), (System.currentTimeMillis() - finishedAt) / 1000);
        }
    }

    /** Keeps the density window bounded — a long run must not grow without limit. */
    private void appendHistory(Session session, Map<String, Double> densities) {
        List<Map<String, Double>> history = session.getDensityHistory();
        history.add(densities);
        while (history.size() > historyWindow) {
            history.remove(0);
        }
    }

    /**
     * Records an alert only when a node's severity actually changes — otherwise the feed
     * floods at ten frames a second. A node that drops back to OK is forgotten, so the next
     * time it fills it alerts again rather than staying silent for the rest of the run.
     *
     * @return the alerts actually recorded this tick
     */
    private List<Alert> recordNewAlerts(Session session, List<Alert> alerts,
                                        Map<String, Double> densities) {
        List<Alert> raised = new ArrayList<>();
        for (Alert alert : alerts) {
            if (session.addAlertIfChanged(alert)) {
                raised.add(alert);
            }
        }
        densities.forEach((nodeId, density) -> {
            if (detector.severityOf(density) == Alert.Severity.OK) {
                session.clearSeverity(nodeId);
            }
        });
        return raised;
    }

    /**
     * When a node newly goes critical, divert everyone heading into it and record the
     * suggested path for the map.
     *
     * <p>A node is only acted on once <em>while it stays congested</em> — re-planning the same
     * jam every tick would thrash routes and burn the tick budget. Once it recovers to OK the
     * node is re-armed, because a zone that jams during entry and again during egress is two
     * separate incidents and both need diverting.
     */
    private void rerouteAroundNewJams(Session session, List<Alert> alerts,
                                      Map<String, Double> densities) {
        Set<String> handled = reroutedNodes.computeIfAbsent(session.getId(), k -> ConcurrentHashMap.newKeySet());
        handled.removeIf(nodeId ->
                detector.severityOf(densities.getOrDefault(nodeId, 0.0)) == Alert.Severity.OK);

        List<ReroutePath> applied = new ArrayList<>();
        for (Alert alert : alerts) {
            if (alert.severity() != Alert.Severity.CRITICAL || !handled.add(alert.nodeId())) {
                continue;
            }
            applied.addAll(routeEngine.rerouteAffected(session, alert.nodeId()));
        }
        if (!applied.isEmpty()) {
            session.addReroutes(applied);
            log.debug("session {} tick {}: {} diversions applied",
                    session.getId(), session.getTick(), applied.size());
        }
    }
}
