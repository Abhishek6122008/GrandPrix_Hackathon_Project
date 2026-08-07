package com.crowdflow.controller;

import com.crowdflow.dto.Advisory;
import com.crowdflow.model.Alert;
import com.crowdflow.repository.SimulationRepository;
import java.util.Comparator;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/simulations/{id}")
public class AlertController {

    private final SimulationRepository simulations;

    public AlertController(SimulationRepository simulations) {
        this.simulations = simulations;
    }

    /** Bottleneck alerts raised so far, newest first. */
    @GetMapping("/alerts")
    public List<Alert> alerts(@PathVariable String id) {
        return simulations.getOrThrow(id).getAlerts().stream()
                .sorted(Comparator.comparingInt(Alert::tick).reversed())
                .toList();
    }

    /** Plain-language advisories generated for those alerts, newest first. */
    @GetMapping("/advisories")
    public List<Advisory> advisories(@PathVariable String id) {
        return simulations.getOrThrow(id).getAdvisories().stream()
                .sorted(Comparator.comparingInt(Advisory::tick).reversed())
                .toList();
    }
}
