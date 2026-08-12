package com.crowdflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.crowdflow.dto.SessionInfo;
import com.crowdflow.dto.WalkerPlacement;
import com.crowdflow.model.Session;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueEdge;
import com.crowdflow.model.VenueNode;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.session.SessionManager;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;

/**
 * Real attendees reported from a phone, and the line between what they affect and what they
 * must not.
 *
 * <p>The important test here is
 * {@link #realAttendeesRaiseLiveDensityButNeverTheBaselineNumbers()}. Everything else in this
 * feature could be rebuilt from the docs; that invariant is the one a future refactor could
 * quietly invert, turning the demo's headline claim inside out without anything failing.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        // Off, so the sessions here hold still while the assertions run.
        "session.tick-interval-ms=100000",
        "ml-service.mock-enabled=true",
})
class WalkerIngestTest {

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private SessionManager sessions;

    @Autowired
    private DensityDetector detector;

    private static final Venue VENUE = new Venue("venue-walker-test", "Walker Test Venue",
            List.of(
                    new VenueNode("gate", "Gate", VenueNode.Type.GATE, 120, 40, 100),
                    new VenueNode("walk", "Walkway", VenueNode.Type.WALKWAY, 60, 200, 100),
                    new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 300, 360, 100)),
            List.of(
                    new VenueEdge("gate", "walk", 20, 4, true),
                    new VenueEdge("walk", "exit", 20, 4, true)));

    private String createSession() {
        ResponseEntity<SessionInfo> created = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 100, "arrivalRate", 5,
                        "maxTicks", 4000, "tickSeconds", 1.0, "rerouteEnabled", true),
                SessionInfo.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return created.getBody().sessionId();
    }

    private ResponseEntity<WalkerPlacement> put(String sessionId, String walkerId, Object body) {
        return rest.exchange("/sessions/" + sessionId + "/walkers/" + walkerId,
                HttpMethod.PUT, new HttpEntity<>(body), WalkerPlacement.class);
    }

    // ------------------------------------------------------------------ the invariant

    /**
     * The whole reason walkers are kept out of {@code Session.occupancy()}.
     *
     * <p>{@code recordDensities} accumulates {@code peakDensity} and {@code criticalNodeTicks},
     * and {@code SessionSummary} compares those against the baseline twin. The twin has no real
     * attendees and never can have. If a phone standing in a gate reached those totals it would
     * land on the optimised side of the comparison only, and the summary would report that
     * rerouting had made the venue <em>worse</em> — the exact opposite of what the run proved.
     */
    @Test
    void realAttendeesRaiseLiveDensityButNeverTheBaselineNumbers() {
        String id = createSession();
        Session session = sessions.get(id);

        double peakBefore = session.getPeakDensity();
        int criticalBefore = session.getCriticalNodeTicks();
        Map<String, Integer> simulatedBefore = session.occupancy();

        for (int i = 0; i < 30; i++) {
            assertThat(put(id, "w-" + i, Map.of("nodeId", "walk")).getStatusCode())
                    .isEqualTo(HttpStatus.OK);
        }

        // The display sees them: 30 people in a zone that holds 60 is half full.
        assertThat(session.liveOccupancy().get("walk")).isEqualTo(30);
        assertThat(detector.liveDensitiesOf(session).get("walk")).isEqualTo(0.5);

        // The comparison does not, in any of the three places it could leak through.
        assertThat(session.occupancy()).isEqualTo(simulatedBefore);
        assertThat(detector.densitiesOf(session).get("walk")).isEqualTo(0.0);
        assertThat(session.getPeakDensity()).isEqualTo(peakBefore);
        assertThat(session.getCriticalNodeTicks()).isEqualTo(criticalBefore);
    }

    /** Attendees are counted, never enumerated — the frame must not carry them as people. */
    @Test
    void attendeesAreCountedButNeverListedAmongThePeopleOnTheMap() {
        String id = createSession();
        Session session = sessions.get(id);
        put(id, "w-1", Map.of("nodeId", "gate"));

        assertThat(session.walkerCount()).isEqualTo(1);
        assertThat(session.getPeople()).noneMatch(person -> person.getId().equals("w-1"));
    }

    // ------------------------------------------------------------------ placement

    @Test
    void aTappedZoneIsAcceptedWithoutAGeoreference() {
        String id = createSession();
        ResponseEntity<WalkerPlacement> response = put(id, "w-1", Map.of("nodeId", "gate"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().state()).isEqualTo(WalkerPlacement.State.MANUAL);
        assertThat(response.getBody().nodeId()).isEqualTo("gate");
        assertThat(response.getBody().expiresInSeconds()).isPositive();
    }

    /**
     * A GPS fix against a venue nobody has georeferenced is a 409, not a 400 or a silent drop.
     *
     * <p>The client can fix it two ways and the message names both, because the phone's own
     * fallback — send the zone instead — is the one it can do without an organiser.
     */
    @Test
    void aGpsFixAgainstAnUngeoreferencedVenueSaysWhatToSendInstead() {
        String id = createSession();
        ResponseEntity<String> response = rest.exchange("/sessions/" + id + "/walkers/w-1",
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("lat", 12.97, "lng", 77.59, "accuracyMetres", 8.0)),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).contains("not georeferenced").contains("nodeId");
    }

    @Test
    void abodyThatIsNeitherAFixNorAZoneIsRejected() {
        String id = createSession();
        ResponseEntity<String> response = rest.exchange("/sessions/" + id + "/walkers/w-1",
                HttpMethod.PUT, new HttpEntity<>(Map.of()), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void aZoneTheVenueDoesNotHaveIsRejected() {
        String id = createSession();
        ResponseEntity<String> response = rest.exchange("/sessions/" + id + "/walkers/w-1",
                HttpMethod.PUT, new HttpEntity<>(Map.of("nodeId", "no-such-zone")), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    /**
     * Twins are not writable. They are hidden from {@code GET /sessions} for the same reason —
     * a baseline that anybody can add people to is not a baseline.
     */
    @Test
    void aBaselineTwinRefusesAttendees() {
        String id = createSession();
        ResponseEntity<String> response = rest.exchange(
                "/sessions/" + id + "-baseline/walkers/w-1",
                HttpMethod.PUT, new HttpEntity<>(Map.of("nodeId", "gate")), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void leavingRemovesTheAttendeeImmediately() {
        String id = createSession();
        Session session = sessions.get(id);
        put(id, "w-1", Map.of("nodeId", "gate"));
        assertThat(session.walkerCount()).isEqualTo(1);

        rest.delete("/sessions/" + id + "/walkers/w-1");

        assertThat(session.walkerCount()).isZero();
        assertThat(session.liveOccupancy()).isEqualTo(session.occupancy());
    }

    /** Re-reporting is an update, not a second person — which is what makes PUT the right verb. */
    @Test
    void reportingTwiceMovesTheSameAttendeeRatherThanAddingAnother() {
        String id = createSession();
        Session session = sessions.get(id);

        put(id, "w-1", Map.of("nodeId", "gate"));
        put(id, "w-1", Map.of("nodeId", "walk"));

        assertThat(session.walkerCount()).isEqualTo(1);
        assertThat(session.liveOccupancy().get("gate")).isZero();
        assertThat(session.liveOccupancy().get("walk")).isEqualTo(1);
    }
}
