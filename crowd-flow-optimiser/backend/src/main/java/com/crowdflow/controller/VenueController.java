package com.crowdflow.controller;

import com.crowdflow.model.Venue;
import com.crowdflow.repository.VenueRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/venues")
public class VenueController {

    private final VenueRepository venues;

    public VenueController(VenueRepository venues) {
        this.venues = venues;
    }

    /** Uploads a venue layout. An id is generated when the payload omits one. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Venue create(@Valid @RequestBody Venue venue) {
        return venues.save(venue);
    }

    @GetMapping("/{id}")
    public Venue get(@PathVariable String id) {
        return venues.getOrThrow(id);
    }
}
