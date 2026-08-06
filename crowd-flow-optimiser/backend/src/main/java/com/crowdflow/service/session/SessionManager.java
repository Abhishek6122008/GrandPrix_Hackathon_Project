package com.crowdflow.service.session;

import com.crowdflow.client.FastApiClient;
import com.crowdflow.dto.CreateSessionRequest;
import com.crowdflow.model.Alert;
import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.Session;
import com.crowdflow.model.Venue;
import com.crowdflow.repository.SessionRepository;
import com.crowdflow.repository.VenueRepository;
import com.crowdflow.service.broadcast.StateBroadcaster;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.routing.RerouteEngine;
import com.crowdflow.service.simulation.SimulationEngine;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
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

    /** Nodes already rerouted around, per session — so one jam does not re-plan every tick. */
    private final Map<String, Set<String>> reroutedNodes = new ConcurrentHashMap<>();

    public SessionManager(SessionRepository sessions, VenueRepository venues, SimulationEngine engine,
                          DensityDetector detector, RerouteEngine routeEngine,
                          FastApiClient fastApiClient, StateBroadcaster broadcaster,
                          @Value("${session.history-window:120}") int historyWindow,
                          @Value("${session.broadcast-every-ticks:2}") int broadcastEveryTicks,
                          @Value("${simulation.critical-threshold:0.85}") double criticalThreshold) {
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
    }

    // --- lifecycle --------------------------------------------------------

    /**
     * Creates a session from an uploaded venue. The venue is stored too, so the existing
     * {@code GET /venues/{id}} keeps working for whatever wants to draw the layout.
     */
    public Session create(CreateSessionRequest request) {
        Venue venue = venues.save(request.venue());
        validate(venue);

        Session session = new Session(
                "sess-" + UUID.randomUUID().toString().substring(0, 8),
                venue,
                request.crowdSize(),
                request.arrivalRate(),
                request.maxTicksOrDefault(),
                request.tickSecondsOrDefault(),
                request.rerouteEnabledOrDefault());

        // Publish an empty frame immediately so a viewer connecting before start sees the
        // venue rather than a blank map.
        Map<String, Double> densities = detector.densitiesOf(session);
        session.getDensityHistory().add(densities);
        broadcaster.broadcast(session, densities, detector.trendsOf(session, densities));
        return sessions.save(session);
    }

    /** Rejects layouts the simulation cannot do anything sensible with. */
    private void validate(Venue venue) {
        if (venue.nodes().stream().noneMatch(node -> node.isEntry())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Venue has no GATE node — nobody can enter");
        }
        Set<String> ids = new HashSet<>(venue.nodesById().keySet());
        if (ids.size() != venue.nodes().size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Venue has duplicate node ids");
        }
        venue.edges().forEach(edge -> {
            if (!ids.contains(edge.from()) || !ids.contains(edge.to())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Edge %s -> %s references a node that does not exist".formatted(edge.from(), edge.to()));
            }
        });
        // No EXIT is legal on purpose: it is a scenario worth simulating, and the detector
        // will light the whole venue up, which is exactly the right answer.
    }

    public Session start(String id) {
        Session session = sessions.getOrThrow(id);
        if (session.getStatus() == Session.Status.STOPPED || session.getStatus() == Session.Status.COMPLETED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Session " + id + " is " + session.getStatus() + " and cannot be restarted");
        }
        session.setStatus(Session.Status.RUNNING);
        return session;
    }

    public Session pause(String id) {
        Session session = sessions.getOrThrow(id);
        if (session.getStatus() == Session.Status.RUNNING) {
            session.setStatus(Session.Status.PAUSED);
        }
        return session;
    }

    /** Terminal: the run is over and its numbers are final. Viewers keep the last frame. */
    public Session stop(String id) {
        Session session = sessions.getOrThrow(id);
        session.setStatus(Session.Status.STOPPED);
        return session;
    }

    public Session get(String id) {
        return sessions.getOrThrow(id);
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
        recordNewAlerts(session, alerts);

        if (session.isRerouteEnabled()) {
            rerouteAroundNewJams(session, alerts);
        }

        if (detector.shouldAnalyse(session, densities)) {
            fastApiClient.analyseAsync(session, densities, trends,
                    detector.highRiskNodes(densities, session.getPredictedRisk()));
        }

        if (session.isFinished()) {
            session.setStatus(Session.Status.COMPLETED);
        }
        if (session.getTick() % broadcastEveryTicks == 0 || session.getStatus() != Session.Status.RUNNING) {
            broadcaster.broadcast(session, densities, trends);
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

    /** Only records an alert when a node's severity actually changes — otherwise it floods. */
    private void recordNewAlerts(Session session, List<Alert> alerts) {
        Set<String> alerting = new LinkedHashSet<>();
        for (Alert alert : alerts) {
            alerting.add(alert.nodeId());
            if (session.getAlerts().stream()
                    .filter(existing -> existing.nodeId().equals(alert.nodeId()))
                    .reduce((first, second) -> second)
                    .map(latest -> latest.severity() == alert.severity())
                    .orElse(false)) {
                continue;
            }
            session.getAlerts().add(alert);
        }
    }

    /**
     * When a node newly goes critical, divert everyone heading into it and record the
     * suggested path for the map. Each node is only acted on once per session — re-planning
     * the same jam every tick would thrash routes and burn the tick budget.
     */
    private void rerouteAroundNewJams(Session session, List<Alert> alerts) {
        Set<String> handled = reroutedNodes.computeIfAbsent(session.getId(), k -> ConcurrentHashMap.newKeySet());
        List<ReroutePath> applied = new ArrayList<>();

        for (Alert alert : alerts) {
            if (alert.severity() != Alert.Severity.CRITICAL || !handled.add(alert.nodeId())) {
                continue;
            }
            applied.addAll(routeEngine.rerouteAffected(session, alert.nodeId()));
        }
        if (!applied.isEmpty()) {
            session.getReroutes().addAll(applied);
            log.debug("session {} tick {}: {} diversions applied",
                    session.getId(), session.getTick(), applied.size());
        }
    }
}
