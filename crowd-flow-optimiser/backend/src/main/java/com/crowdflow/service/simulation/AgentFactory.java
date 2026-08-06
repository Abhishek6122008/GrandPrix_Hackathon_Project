package com.crowdflow.service.simulation;

import org.springframework.stereotype.Component;

/**
 * Builds the crowd mix for a run.
 *
 * <p>Today it returns aggregate speed factors only — the tick engine is flow-based, not
 * per-agent. The signatures below are the seam for individual agents once
 * {@link SocialForceModel} is real.
 */
@Component
public class AgentFactory {

    /** Share of the crowd arriving as families/groups; the rest are solo attendees. */
    public static final double FAMILY_SHARE = 0.35;

    /** Families move ~30% slower and cluster; solo attendees move at full speed. */
    private static final double FAMILY_SPEED = 0.7;
    private static final double SOLO_SPEED = 1.0;

    /**
     * Weighted average walking-speed multiplier for a crowd of this size.
     * Used by {@link SimulationEngine} to scale how many people clear a node per tick.
     */
    public double cohortSpeedFactor(int crowdSize) {
        return FAMILY_SHARE * FAMILY_SPEED + (1 - FAMILY_SHARE) * SOLO_SPEED;
    }

    /**
     * TODO(day 2): emit individual agents for the social force model.
     * Each agent needs: position, velocity, desired speed, goal node, group id.
     * Signature will be {@code List<Agent> createAgents(int count, VenueNode spawnNode)}.
     */
    public void createAgents(int count, String spawnNodeId) {
        throw new UnsupportedOperationException("Per-agent simulation not implemented — see SocialForceModel");
    }
}
