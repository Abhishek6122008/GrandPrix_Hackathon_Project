const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${path} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// One function per backend endpoint — see docs/api-contract.md.
export const api = {
  createVenue: (venue) => request('/venues', { method: 'POST', body: JSON.stringify(venue) }),
  getVenue: (venueId) => request(`/venues/${venueId}`),
  createSimulation: (body) => request('/simulations', { method: 'POST', body: JSON.stringify(body) }),
  getState: (simId, t) => request(`/simulations/${simId}/state${t == null ? '' : `?t=${t}`}`),
  getAlerts: (simId) => request(`/simulations/${simId}/alerts`),
  getReroute: (simId, nodeId) => request(`/simulations/${simId}/reroutes/${nodeId}`),
  getAdvisories: (simId) => request(`/simulations/${simId}/advisories`),
  getSummary: (simId) => request(`/simulations/${simId}/summary`),
};

export function useSimulationApi() {
  return api;
}
