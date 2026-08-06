package com.crowdflow.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Points at the self-hosted FastAPI ml-service, bound from the {@code ml-service.*} block
 * in application.yml. Replaces the earlier Hugging Face Inference API client — the models
 * now run in a local process, so there is no token and no external call at inference time.
 *
 * <p>{@code mock-enabled: true} forces the deterministic mocks without the service running.
 */
@Configuration
@ConfigurationProperties(prefix = "ml-service")
public class MlServiceConfig {

    private String baseUrl = "http://localhost:8000";
    private String riskPath = "/predict/risk";
    private String advisoryPath = "/generate/advisory";
    private String healthPath = "/health";
    private boolean mockEnabled = false;
    private int timeoutMs = 4000;

    public String riskUrl() {
        return baseUrl + riskPath;
    }

    public String advisoryUrl() {
        return baseUrl + advisoryPath;
    }

    public String healthUrl() {
        return baseUrl + healthPath;
    }

    @Bean
    public RestClient mlServiceRestClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        return RestClient.builder().requestFactory(factory).build();
    }

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public String getRiskPath() { return riskPath; }
    public void setRiskPath(String riskPath) { this.riskPath = riskPath; }
    public String getAdvisoryPath() { return advisoryPath; }
    public void setAdvisoryPath(String advisoryPath) { this.advisoryPath = advisoryPath; }
    public String getHealthPath() { return healthPath; }
    public void setHealthPath(String healthPath) { this.healthPath = healthPath; }
    public boolean isMockEnabled() { return mockEnabled; }
    public void setMockEnabled(boolean mockEnabled) { this.mockEnabled = mockEnabled; }
    public int getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
}
