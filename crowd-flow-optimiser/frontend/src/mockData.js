// Mock payloads so every screen renders before the backend is wired in.
// Shapes mirror docs/api-contract.md exactly — swap for real responses, nothing else changes.

export const mockVenue = {
  id: 'venue-sample',
  name: 'Grandprix Arena — North Wing',
  nodes: [
    { id: 'gate-a', name: 'Gate A', type: 'GATE', capacity: 320, x: 60, y: 120 },
    { id: 'gate-b', name: 'Gate B', type: 'GATE', capacity: 320, x: 60, y: 300 },
    { id: 'walk-1', name: 'North Walkway', type: 'WALKWAY', capacity: 500, x: 220, y: 210 },
    { id: 'food-1', name: 'Concession 1', type: 'CONCESSION', capacity: 180, x: 380, y: 110 },
    { id: 'walk-2', name: 'South Walkway', type: 'WALKWAY', capacity: 500, x: 380, y: 320 },
    { id: 'exit-1', name: 'Exit East', type: 'EXIT', capacity: 400, x: 540, y: 210 },
  ],
  edges: [
    { from: 'gate-a', to: 'walk-1', length: 25, width: 6, bidirectional: true },
    { from: 'gate-b', to: 'walk-1', length: 30, width: 6, bidirectional: true },
    { from: 'walk-1', to: 'food-1', length: 20, width: 4, bidirectional: true },
    { from: 'walk-1', to: 'walk-2', length: 35, width: 8, bidirectional: true },
    { from: 'food-1', to: 'exit-1', length: 28, width: 5, bidirectional: true },
    { from: 'walk-2', to: 'exit-1', length: 22, width: 8, bidirectional: true },
  ],
};

export const mockState = {
  simulationId: 'sim-mock',
  tick: 12,
  nodes: [
    { nodeId: 'gate-a', occupancy: 290, capacity: 320, density: 0.91, status: 'CRITICAL' },
    { nodeId: 'gate-b', occupancy: 180, capacity: 320, density: 0.56, status: 'OK' },
    { nodeId: 'walk-1', occupancy: 380, capacity: 500, density: 0.76, status: 'WARNING' },
    { nodeId: 'food-1', occupancy: 60, capacity: 180, density: 0.33, status: 'OK' },
    { nodeId: 'walk-2', occupancy: 120, capacity: 500, density: 0.24, status: 'OK' },
    { nodeId: 'exit-1', occupancy: 40, capacity: 400, density: 0.1, status: 'OK' },
  ],
};

export const mockAlerts = [
  {
    id: 'alert-1',
    tick: 12,
    nodeId: 'gate-a',
    severity: 'CRITICAL',
    density: 0.91,
    trend: 'RISING',
    message: 'Gate A at 91% capacity and climbing — hold intake, divert to Gate B.',
  },
  {
    id: 'alert-2',
    tick: 10,
    nodeId: 'walk-1',
    severity: 'WARNING',
    density: 0.76,
    trend: 'RISING',
    message: 'North Walkway filling from both gates.',
  },
];

export const mockReroute = {
  fromNodeId: 'gate-a',
  toNodeId: 'walk-2',
  path: ['gate-a', 'walk-1', 'walk-2'],
  cost: 60,
};

export const mockSummary = {
  simulationId: 'sim-mock',
  ticks: 50,
  peakDensity: 0.85,
  bottleneckCount: 0,
  baseline: { peakDensity: 1.0, bottleneckCount: 2, criticalNodeTicks: 51, avgClearTicks: 50 },
  optimised: { peakDensity: 0.85, bottleneckCount: 0, criticalNodeTicks: 0, avgClearTicks: 50 },
  narrative:
    'Rerouting cut time spent above the critical threshold by 100% (51 → 0 zone-ticks), peaking at 85% instead of 100%.',
};

export const mockAdvisories = [
  { tick: 12, nodeId: 'gate-a', text: 'Gate A is congested. Send new arrivals to Gate B for the next 3 minutes.' },
];
