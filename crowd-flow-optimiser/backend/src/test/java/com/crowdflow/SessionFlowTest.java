package com.crowdflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.crowdflow.dto.SessionInfo;
import com.crowdflow.dto.SessionState;
import com.crowdflow.model.Alert;
import com.crowdflow.model.Person;
import com.crowdflow.model.Session;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueEdge;
import com.crowdflow.model.VenueNode;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.simulation.SocialForceModel;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.WebSocketContainer;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * The end-to-end flow, as one test: upload a venue, start a session, let the tick loop run,
 * and check that a WebSocket client actually receives people, densities, alerts and metrics.
 *
 * <p>{@code ml-service.mock-enabled=true} keeps the AI layer out of it deliberately — this is
 * the check that the simulation and broadcast work <em>without</em> Hugging Face, which is
 * the fallback the whole design leans on. The AI path has its own checks in
 * ml-service/tests/test_analyze.py.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        "ml-service.mock-enabled=true",
        "session.tick-interval-ms=20",   // run the clock fast so the test is not slow
        "session.broadcast-every-ticks=1",
        "logging.level.com.crowdflow=INFO"
})
class SessionFlowTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** gate -> walkway -> exit, with a deliberately undersized walkway so it jams. */
    private static final Venue VENUE = new Venue("venue-session-test", "Session Test Venue",
            List.of(
                    new VenueNode("gate", "Gate", VenueNode.Type.GATE, 120, 40, 100),
                    new VenueNode("walk", "Walkway", VenueNode.Type.WALKWAY, 60, 200, 100),
                    new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 300, 360, 100)),
            List.of(
                    new VenueEdge("gate", "walk", 20, 4, true),
                    new VenueEdge("walk", "exit", 20, 4, true)));

    @Test
    void fullFlowFromUploadToLiveBroadcast() throws Exception {
        // 1-2. Upload the venue and create the session.
        ResponseEntity<SessionInfo> created = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 600, "arrivalRate", 12,
                        "maxTicks", 4000, "tickSeconds", 1.0, "rerouteEnabled", true),
                SessionInfo.class);

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        SessionInfo info = created.getBody();
        assertThat(info).isNotNull();
        assertThat(info.status()).isEqualTo("CREATED");
        String id = info.sessionId();

        // 3. Connect a viewer before starting, so we see the run from tick 0.
        List<SessionState> frames = new CopyOnWriteArrayList<>();
        WebSocketSession socket = connect(id, frames);

        // 4. Start.
        assertThat(rest.postForEntity("/sessions/{id}/start", null, SessionInfo.class, id)
                .getStatusCode()).isEqualTo(HttpStatus.OK);

        // 5-6. The tick loop runs, people spawn and walk, the undersized walkway backs up.
        awaitUntil(Duration.ofSeconds(25), () -> {
            assertThat(frames).isNotEmpty();
            SessionState latest = frames.get(frames.size() - 1);
            assertThat(latest.people()).as("agents are on the map").isNotEmpty();
            assertThat(latest.metrics().spawned()).as("gates admitted people").isPositive();
            assertThat(latest.nodes()).anyMatch(node -> node.density() > 0);
        });

        // 7. The jam is detected and reported.
        awaitUntil(Duration.ofSeconds(30), () ->
                assertThat(frames.get(frames.size() - 1).nodes())
                        .as("the undersized walkway should go over threshold")
                        .anyMatch(node -> node.status() != Alert.Severity.OK));

        // 8. People reach the exit and leave — the simulation drains, it does not just fill.
        awaitUntil(Duration.ofSeconds(30), () ->
                assertThat(frames.get(frames.size() - 1).metrics().exited()).isPositive());

        SessionState frame = frames.get(frames.size() - 1);
        assertThat(frame.sessionId()).isEqualTo(id);
        assertThat(frame.tick()).isPositive();
        assertThat(frame.simulationSeconds()).isPositive();
        assertThat(frame.metrics().viewers()).isEqualTo(1);
        assertThat(frame.aiStatus()).contains("mock-enabled"); // AI deliberately off here
        // Every agent in the frame carries a position and the node it is counted against.
        assertThat(frame.people()).allSatisfy(person -> {
            assertThat(person.nodeId()).isNotBlank();
            assertThat(person.type()).isIn("SOLO", "FAMILY");
        });

        // 9. Pause holds the clock; stop is terminal.
        rest.postForEntity("/sessions/{id}/pause", null, SessionInfo.class, id);
        int tickAtPause = rest.getForObject("/sessions/{id}", SessionInfo.class, id).tick();
        Thread.sleep(400); // several tick intervals at 20ms
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id).tick())
                .as("a paused session does not advance").isEqualTo(tickAtPause);

        rest.postForEntity("/sessions/{id}/start", null, SessionInfo.class, id);
        rest.postForEntity("/sessions/{id}/stop", null, SessionInfo.class, id);
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id).status()).isEqualTo("STOPPED");

        socket.close();
    }

    @Test
    void rejectsAVenueWithNoGate() {
        Venue gateless = new Venue("no-gate", "No Gate",
                List.of(new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 100, 0, 0)),
                List.of(new VenueEdge("exit", "exit", 1, 1, false)));

        ResponseEntity<String> response = rest.postForEntity("/sessions",
                Map.of("venue", gateless, "crowdSize", 10, "arrivalRate", 1), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("GATE");
    }

    @Test
    void unknownSessionIs404() {
        assertThat(rest.getForEntity("/sessions/nope", String.class).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    private WebSocketSession connect(String sessionId, List<SessionState> sink) throws Exception {
        // Client-side buffer has to match the server's for the same reason: a busy venue's
        // frame is tens of kilobytes and the 8 KB default closes the connection rather than
        // truncating. A viewer that silently disconnects once the crowd arrives is the exact
        // failure this test exists to catch.
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        container.setDefaultMaxTextMessageBufferSize(512 * 1024);

        return new StandardWebSocketClient(container)
                .execute(new TextWebSocketHandler() {
                    @Override
                    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
                        sink.add(objectMapper.readValue(message.getPayload(), SessionState.class));
                    }
                }, new WebSocketHttpHeaders(),
                        URI.create("ws://localhost:" + port + "/sessions/" + sessionId + "/stream"))
                .get();
    }

    // ---------------------------------------------------------------- unit-level checks

    @Test
    void socialForceDrivesTowardTheGoalAndPushesAgentsApart() {
        SocialForceModel forces = new SocialForceModel();

        // Standing still at the origin, goal due east: acceleration is due east.
        double[] driving = forces.drivingForce(new double[] {0, 0}, new double[] {0, 0},
                new double[] {10, 0}, 3.0);
        assertThat(driving[0]).isPositive();
        assertThat(driving[1]).isZero();

        // Two agents on top of each other repel harder than two a body-width apart.
        double near = magnitude(forces.agentRepulsion(new double[] {0, 0}, new double[] {1, 0}, 4));
        double far = magnitude(forces.agentRepulsion(new double[] {0, 0}, new double[] {12, 0}, 4));
        assertThat(near).isGreaterThan(far);

        // Repulsion points away from the other agent, never toward it.
        double[] push = forces.agentRepulsion(new double[] {0, 0}, new double[] {2, 0}, 4);
        assertThat(push[0]).isNegative();

        // A wall pushes perpendicular, and harder the closer you are.
        double[] wallStart = {0, 0};
        double[] wallEnd = {10, 0};
        assertThat(magnitude(forces.wallRepulsion(new double[] {5, 1}, wallStart, wallEnd)))
                .isGreaterThan(magnitude(forces.wallRepulsion(new double[] {5, 9}, wallStart, wallEnd)));
    }

    /**
     * The gate that stops the AI layer being called ten times a second. Getting this wrong is
     * invisible locally and very visible in a Hugging Face bill.
     */
    @Test
    void analyseIsGatedOnRealChangeAndAMinimumInterval() {
        DensityDetector detector = new DensityDetector(0.70, 0.85, 5, 0.10, 20);
        Session session = new Session("sess-gate", VENUE, 100, 10, 500, 1.0, true);

        Map<String, Double> quiet = Map.of("gate", 0.10, "walk", 0.10, "exit", 0.0);
        session.setTick(30);
        assertThat(detector.shouldAnalyse(session, quiet)).as("first look, crowd present").isTrue();

        session.setLastAnalysed(quiet, 30);
        session.setTick(35);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.90, "walk", 0.10, "exit", 0.0)))
                .as("under the minimum interval, however dramatic the change").isFalse();

        session.setTick(60);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.12, "walk", 0.11, "exit", 0.0)))
                .as("interval elapsed but nothing moved").isFalse();

        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.25, "walk", 0.10, "exit", 0.0)))
                .as("a 0.15 jump is worth a call").isTrue();

        session.setLastAnalysed(Map.of("gate", 0.68, "walk", 0.10, "exit", 0.0), 60);
        session.setTick(90);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.72, "walk", 0.10, "exit", 0.0)))
                .as("0.68 -> 0.72 is small but crosses into WARNING").isTrue();
    }

    @Test
    void occupancyCountsEveryAgentAgainstExactlyOneNode() {
        Session session = new Session("sess-count", VENUE, 100, 10, 500, 1.0, true);
        session.getPeople().add(new Person("p1", Person.Type.SOLO, 3, 2, 40, 100, "gate"));
        session.getPeople().add(new Person("p2", Person.Type.FAMILY, 2, 2, 42, 101, "gate"));
        session.getPeople().add(new Person("p3", Person.Type.SOLO, 3, 2, 200, 100, "walk"));

        Map<String, Integer> occupancy = session.occupancy();

        assertThat(occupancy).containsEntry("gate", 2).containsEntry("walk", 1).containsEntry("exit", 0);
        assertThat(occupancy.values().stream().mapToInt(Integer::intValue).sum())
                .isEqualTo(session.getPeople().size());
    }

    private double magnitude(double[] vector) {
        return Math.hypot(vector[0], vector[1]);
    }

    /**
     * Retries an assertion until it passes or the deadline expires, then rethrows the last
     * failure. ponytail: this is the whole of what Awaitility would give us here, so it is
     * not worth a dependency. Reach for Awaitility if the waiting gets more interesting than
     * "poll until true".
     */
    private static void awaitUntil(Duration timeout, Runnable assertion) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        AssertionError last = null;
        while (System.nanoTime() < deadline) {
            try {
                assertion.run();
                return;
            } catch (AssertionError e) {
                last = e;
                Thread.sleep(100);
            }
        }
        if (last != null) {
            throw last;
        }
        assertion.run();
    }
}
