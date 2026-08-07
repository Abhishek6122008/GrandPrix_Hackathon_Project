package com.crowdflow.dto;

import com.crowdflow.model.SimulationRun;

public record SimulationResponse(String id, String venueId, int crowdSize, int totalTicks, String status) {

    public static SimulationResponse of(SimulationRun run) {
        return new SimulationResponse(run.getId(), run.getVenueId(), run.getCrowdSize(),
                run.getTotalTicks(), run.getStatus().name());
    }
}
