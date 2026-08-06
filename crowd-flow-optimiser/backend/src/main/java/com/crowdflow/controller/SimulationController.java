package com.crowdflow.controller;

import com.crowdflow.dto.CreateSimulationRequest;
import com.crowdflow.dto.SimulationResponse;
import com.crowdflow.dto.SimulationState;
import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.SimulationRun;
import com.crowdflow.model.Venue;
import com.crowdflow.repository.SimulationRepository;
import com.crowdflow.repository.VenueRepository;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.routing.RerouteEngine;
import com.crowdflow.service.simulation.SimulationEngine;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SimulationController {

    private final SimulationRepository simulations;
    private final VenueRepository venues;
    private final SimulationEngine engine;
    private final DensityDetector detector;
    private final RerouteEngine rerouteEngine;

    public SimulationController(SimulationRepository simulations, VenueRepository venues,
                                SimulationEngine engine, DensityDetector detector,
                                RerouteEngine rerouteEngine) {
        this.simulations = simulations;
        this.venues = venues;
        this.engine = engine;
        this.detector = detector;
        this.rerouteEngine = rerouteEngine;
    }

    /**
     * Starts a run. The scheduler in SimulationSocketHandler ticks it from here on.
     * With rerouting enabled we also start a no-intervention twin so the summary has a
     * genuine before/after rather than a guess.
     */
    @PostMapping("/simulations")
    @ResponseStatus(HttpStatus.CREATED)
    public SimulationResponse create(@Valid @RequestBody CreateSimulationRequest request) {
        Venue venue = venues.getOrThrow(request.venueId());
        SimulationRun run = engine.create(venue, request.crowdSize(), request.ticks(),
                request.arrivalRate(), request.rerouteEnabled());

        if (request.rerouteEnabled()) {
            SimulationRun baseline = engine.create(venue, request.crowdSize(), request.ticks(),
                    request.arrivalRate(), false);
            baseline.setShadow(true);
            simulations.save(baseline);
            run.setBaselineRunId(baseline.getId());
        }
        return SimulationResponse.of(simulations.save(run));
    }

    /** Node densities at tick {@code t}; defaults to the live tick. */
    @GetMapping("/simulations/{id}/state")
    public SimulationState state(@PathVariable String id, @RequestParam(name = "t", required = false) Integer t) {
        SimulationRun run = simulations.getOrThrow(id);
        Venue venue = venues.getOrThrow(run.getVenueId());
        return detector.stateOf(venue, run, t == null ? run.getCurrentTick() : t);
    }

    /** Nearest under-capacity node to divert {@code nodeId} into, with the full path. */
    @GetMapping("/simulations/{id}/reroutes/{nodeId}")
    public ReroutePath reroute(@PathVariable String id, @PathVariable String nodeId) {
        SimulationRun run = simulations.getOrThrow(id);
        Venue venue = venues.getOrThrow(run.getVenueId());
        return rerouteEngine.findReroute(venue, nodeId, run.getOccupancy());
    }
}
