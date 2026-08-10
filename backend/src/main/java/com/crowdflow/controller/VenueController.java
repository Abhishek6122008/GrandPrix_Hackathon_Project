package com.crowdflow.controller;

import com.crowdflow.model.ReroutePath;
import com.crowdflow.model.Venue;
import com.crowdflow.repository.FileVenueRepository;
import com.crowdflow.repository.VenueRepository;
import java.util.List;
import com.crowdflow.service.VenueValidator;
import com.crowdflow.service.routing.RerouteEngine;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/venues")
public class VenueController {

    private final VenueRepository venues;
    private final RerouteEngine routeEngine;

    public VenueController(VenueRepository venues, RerouteEngine routeEngine) {
        this.venues = venues;
        this.routeEngine = routeEngine;
    }

    /** Uploads a venue layout. An id is generated when the payload omits one. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Venue create(@Valid @RequestBody Venue venue) {
        VenueValidator.validate(venue);
        return venues.save(venue);
    }

    @GetMapping("/{id}")
    public Venue get(@PathVariable String id) {
        return venues.getOrThrow(id);
    }

    /**
     * {@code GET /venues} — every stored venue.
     *
     * <p>Exists so an attendee's venue code resolves even when no session is running on it.
     * Previously the walker portal could only find a venue through {@code GET /sessions}, so a
     * code printed on signage stopped working the moment the operator stopped the run — the
     * building was still there, but the app said the code was unknown. A venue outlives any
     * one session, and this endpoint is what makes the code outlive it too.
     */
    @GetMapping
    public List<Venue> list() {
        return venues instanceof FileVenueRepository store ? store.findAll() : List.of();
    }

    /**
     * {@code GET /venues/{id}/route?from={nodeId}} — the walking path from a zone to the
     * nearest EXIT, by distance over the venue's own edges.
     *
     * <p>Exists for the attendee-facing map, which needs to draw a real way out rather than a
     * straight line through the walls. Runs the same Dijkstra the simulation uses to route its
     * agents, so what an attendee is shown is what the crowd is actually doing.
     *
     * <p>Static: it does not consider live congestion, because a venue can be looked at with
     * no session running. Diversions around a jam arrive on the session stream instead.
     */
    @GetMapping("/{id}/route")
    public ReroutePath route(@PathVariable String id, @RequestParam String from) {
        Venue venue = venues.getOrThrow(id);
        if (!venue.nodesById().containsKey(from)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Venue %s has no node '%s'".formatted(id, from));
        }
        return routeEngine.nearestExit(venue, from);
    }
}
