package com.crowdflow.controller;

import com.crowdflow.dto.CreateSimulationRequest;
import com.crowdflow.dto.SchedulePhase;
import com.crowdflow.dto.SimulationResponse;
import com.crowdflow.dto.SimulationState;
import com.crowdflow.model.ArrivalPhase;
import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.SimulationRun;
import com.crowdflow.model.Venue;
import com.crowdflow.repository.SimulationRepository;
import com.crowdflow.repository.VenueRepository;
import com.crowdflow.service.detection.DensityDetector;
import com.crowdflow.service.routing.RerouteEngine;
import com.crowdflow.service.simulation.SimulationEngine;
import jakarta.validation.Valid;
import java.util.List;
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
        List<ArrivalPhase> schedule = phasesOf(request);
        int ticks = request.eventSchedule() == null ? request.ticks() : request.eventSchedule().totalTicks();
        int arrivalRate = request.arrivalRate() == null ? 0 : request.arrivalRate();
        SimulationRun run = engine.create(venue, request.crowdSize(), ticks, arrivalRate,
                schedule, request.rerouteEnabled());

        if (request.rerouteEnabled()) {
            SimulationRun baseline = engine.create(venue, request.crowdSize(), ticks, arrivalRate,
                    schedule, false);
            baseline.setShadow(true);
            simulations.save(baseline);
            run.setBaselineRunId(baseline.getId());
        }
        return SimulationResponse.of(simulations.save(run));
    }

    private List<ArrivalPhase> phasesOf(CreateSimulationRequest request) {
        if (request.eventSchedule() == null) {
            if (request.ticks() == null || request.arrivalRate() == null) {
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Provide ticks and arrivalRate, or provide eventSchedule");
            }
            return List.of();
        }
        List<SchedulePhase> phases = request.eventSchedule().phases();
        for (int i = 0; i < phases.size(); i++) {
            SchedulePhase phase = phases.get(i);
            if (phase.endTick() <= phase.startTick()) {
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Each eventSchedule phase must end after it starts");
            }
            if (i > 0 && phase.startTick() < phases.get(i - 1).endTick()) {
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "eventSchedule phases must be ordered and non-overlapping");
            }
        }
        if (request.eventSchedule().totalTicks() > 2_000) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "eventSchedule may not exceed 2000 ticks");
        }
        return phases.stream().map(phase -> new ArrivalPhase(
                phase.startTick(), phase.endTick(), phase.arrivalRate())).toList();
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
