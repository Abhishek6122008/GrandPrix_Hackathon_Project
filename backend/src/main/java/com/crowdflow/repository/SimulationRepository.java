package com.crowdflow.repository;

import com.crowdflow.model.SimulationRun;
import java.util.Collection;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public interface SimulationRepository {

    SimulationRun save(SimulationRun run);

    Optional<SimulationRun> findById(String id);

    Collection<SimulationRun> findAll();

    default SimulationRun getOrThrow(String id) {
        return findById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No simulation " + id));
    }
}
