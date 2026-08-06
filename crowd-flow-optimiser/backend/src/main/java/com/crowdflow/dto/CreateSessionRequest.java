package com.crowdflow.dto;

import com.crowdflow.model.Venue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * Body of {@code POST /sessions}: the venue layout itself plus how the crowd should arrive.
 * The venue travels inline rather than by id so an organiser can go from a layout file to a
 * running session in one call.
 *
 * @param tickSeconds simulated seconds one tick represents; only affects the clock shown to
 *                    viewers, not the physics
 */
public record CreateSessionRequest(
        @NotNull @Valid Venue venue,
        @Min(1) @Max(20_000) int crowdSize,
        @Min(1) @Max(2_000) int arrivalRate,
        @Min(1) @Max(20_000) Integer maxTicks,
        Double tickSeconds,
        Boolean rerouteEnabled) {

    public int maxTicksOrDefault() {
        return maxTicks == null ? 1_200 : maxTicks;
    }

    public double tickSecondsOrDefault() {
        return tickSeconds == null ? 1.0 : tickSeconds;
    }

    public boolean rerouteEnabledOrDefault() {
        return rerouteEnabled == null || rerouteEnabled;
    }
}
