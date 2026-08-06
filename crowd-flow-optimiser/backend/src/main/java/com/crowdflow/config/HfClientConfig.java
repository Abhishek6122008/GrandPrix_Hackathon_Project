package com.crowdflow.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Hugging Face inference settings, bound from the {@code hf.*} block in application.yml.
 * Keep {@code mock-enabled: true} until both endpoints are live — every HF caller falls
 * back to a deterministic mock so the demo never depends on the network.
 */
@Configuration
@ConfigurationProperties(prefix = "hf")
public class HfClientConfig {

    private String token = "";
    private boolean mockEnabled = true;
    private String gnnEndpoint = "";
    private String advisoryEndpoint = "";
    private int timeoutMs = 4000;

    /** True when we should not attempt a real call: mock forced, or no token configured. */
    public boolean useMock() {
        return mockEnabled || token.isBlank();
    }

    @Bean
    public RestClient hfRestClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        return RestClient.builder()
                .requestFactory(factory)
                .defaultHeader("Authorization", "Bearer " + token)
                .build();
    }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }
    public boolean isMockEnabled() { return mockEnabled; }
    public void setMockEnabled(boolean mockEnabled) { this.mockEnabled = mockEnabled; }
    public String getGnnEndpoint() { return gnnEndpoint; }
    public void setGnnEndpoint(String gnnEndpoint) { this.gnnEndpoint = gnnEndpoint; }
    public String getAdvisoryEndpoint() { return advisoryEndpoint; }
    public void setAdvisoryEndpoint(String advisoryEndpoint) { this.advisoryEndpoint = advisoryEndpoint; }
    public int getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
}
