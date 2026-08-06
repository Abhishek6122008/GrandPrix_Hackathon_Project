package com.crowdflow.service.simulation;

import org.springframework.stereotype.Component;

/**
 * Helbing–Molnár social force model.
 *
 * <p>Only the aggregate effect is implemented: crowds walk slower as density rises
 * (the fundamental diagram). The per-agent force terms are stubbed below — implementing
 * them replaces {@link #congestionSlowdown} with a real integration step, and
 * {@link SimulationEngine} keeps calling the same seam.
 */
@Component
public class SocialForceModel {

    /** Density at which movement effectively stops (people per unit of capacity). */
    private static final double JAM_DENSITY = 1.0;

    /**
     * Speed multiplier in [0.05, 1.0] for walking *into* a space at the given density —
     * the denser the destination, the slower you get through. Linear falloff, a reasonable
     * stand-in for the real fundamental diagram.
     */
    public double congestionSlowdown(double density) {
        double clamped = Math.max(0.0, Math.min(JAM_DENSITY, density));
        return Math.max(0.05, 1.0 - clamped * 0.9);
    }

    /**
     * TODO(day 2/3): driving force pulling an agent toward its goal at desired speed.
     * f_desired = (v_desired * e_goal - v_current) / relaxationTime
     */
    public double[] drivingForce(double[] position, double[] velocity, double[] goal, double desiredSpeed) {
        throw new UnsupportedOperationException("TODO: driving force term");
    }

    /**
     * TODO(day 2/3): repulsive force between two agents.
     * f_social = A * exp((r_ij - d_ij) / B) * n_ij, plus the body/friction terms on contact.
     */
    public double[] agentRepulsion(double[] positionA, double[] positionB, double radiusSum) {
        throw new UnsupportedOperationException("TODO: agent-agent repulsion term");
    }

    /**
     * TODO(day 2/3): repulsive force from walls and obstacles, same exponential form
     * as {@link #agentRepulsion} but using perpendicular distance to the wall segment.
     */
    public double[] wallRepulsion(double[] position, double[] wallStart, double[] wallEnd) {
        throw new UnsupportedOperationException("TODO: wall repulsion term");
    }
}
