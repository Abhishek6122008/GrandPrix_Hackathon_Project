package com.crowdflow.dto;

import com.crowdflow.model.Alert;

public record NodeState(String nodeId, int occupancy, int capacity, double density, Alert.Severity status) {
}
