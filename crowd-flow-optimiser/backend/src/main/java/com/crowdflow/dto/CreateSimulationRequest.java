package com.crowdflow.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record CreateSimulationRequest(
        @NotBlank String venueId,
        @Min(1) @Max(500_000) int crowdSize,
        @Min(1) @Max(2_000) int ticks,
        @Min(1) int arrivalRate,
        boolean rerouteEnabled) {
}
