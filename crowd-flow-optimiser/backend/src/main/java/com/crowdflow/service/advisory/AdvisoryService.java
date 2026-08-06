package com.crowdflow.service.advisory;

import com.crowdflow.config.HfClientConfig;
import com.crowdflow.dto.Advisory;
import com.crowdflow.model.Alert;
import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.Venue;
import com.crowdflow.model.VenueNode;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Turns an alert plus its suggested reroute into one plain-language line an operator can act on,
 * via a Hugging Face text-generation endpoint.
 *
 * <p>The prompt below mirrors ml/advisory/prompt_templates.py — keep the two in step.
 * Falls back to a template when {@code hf.mock-enabled} is set or the call fails.
 */
@Service
public class AdvisoryService {

    private static final Logger log = LoggerFactory.getLogger(AdvisoryService.class);

    private static final String PROMPT = """
            You are a venue safety operator. In one sentence, tell staff what to do.
            Zone: %s (%s)
            Occupancy: %d%% of capacity, %s
            Suggested diversion: %s
            Advisory:""";

    private final RestClient restClient;
    private final HfClientConfig config;

    public AdvisoryService(RestClient hfRestClient, HfClientConfig config) {
        this.restClient = hfRestClient;
        this.config = config;
    }

    public Advisory generate(Venue venue, Alert alert, ReroutePath reroute) {
        VenueNode node = venue.nodesById().get(alert.nodeId());
        String name = node == null ? alert.nodeId() : node.name();
        String zoneType = node == null ? "zone" : node.type().name().toLowerCase();
        String diversion = describeDiversion(venue, reroute);

        if (config.useMock()) {
            return new Advisory(alert.tick(), alert.nodeId(), template(name, alert, diversion));
        }

        String prompt = PROMPT.formatted(name, zoneType, Math.round(alert.density() * 100),
                alert.trend().name().toLowerCase(), diversion);
        try {
            List<?> response = restClient.post()
                    .uri(config.getAdvisoryEndpoint())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("inputs", prompt, "parameters", Map.of("max_new_tokens", 60)))
                    .retrieve()
                    .body(List.class);

            if (response != null && !response.isEmpty()
                    && response.get(0) instanceof Map<?, ?> first
                    && first.get("generated_text") instanceof String text) {
                return new Advisory(alert.tick(), alert.nodeId(), text.replace(prompt, "").trim());
            }
            log.warn("Advisory endpoint returned an unexpected shape, using template");
        } catch (RuntimeException e) {
            log.warn("Advisory generation failed ({}), using template", e.getMessage());
        }
        return new Advisory(alert.tick(), alert.nodeId(), template(name, alert, diversion));
    }

    private String template(String name, Alert alert, String diversion) {
        String urgency = alert.severity() == Alert.Severity.CRITICAL ? "Act now:" : "Heads up:";
        String movement = switch (alert.trend()) {
            case RISING -> "and still filling";
            case FALLING -> "but clearing";
            case FLAT -> "and holding";
        };
        return "%s %s is at %d%% capacity %s. %s".formatted(
                urgency, name, Math.round(alert.density() * 100), movement, diversion);
    }

    private String describeDiversion(Venue venue, ReroutePath reroute) {
        if (reroute == null || reroute.toNodeId() == null) {
            return "No clear alternative — hold intake at the gates.";
        }
        VenueNode target = venue.nodesById().get(reroute.toNodeId());
        return "Divert to %s.".formatted(target == null ? reroute.toNodeId() : target.name());
    }
}
