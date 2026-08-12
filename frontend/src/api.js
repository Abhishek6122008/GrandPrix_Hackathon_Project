/**
 * Every call this frontend makes to the Spring Boot backend.
 *
 * One module so the base URL, the error shape and the JSON handling are decided once. Nothing
 * else in the app calls `fetch` directly.
 *
 * The backend exposes two families and they are not interchangeable:
 *
 * - `/sessions` — agent simulation with individual people, a WebSocket stream and a baseline
 *   twin. This is what the live map and every portal use.
 * - `/simulations` — the older tick-by-tick flow model, kept for the summary comparison.
 *
 * See docs/api-contract.md.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

/** Thrown for any non-2xx. Carries the status so callers can tell 404 from 500. */
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (cause) {
    // fetch only rejects for transport failures, which in practice means the backend is not
    // running. Say that, rather than surfacing a bare "Failed to fetch".
    throw new ApiError(0, `Cannot reach the backend at ${BASE}. Is it running?`, cause);
  }

  if (!response.ok) {
    // Spring's error bodies carry a `message`; fall back to the status line when they do not.
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ?? body?.detail ?? `${options.method ?? 'GET'} ${path} → ${response.status}`,
      body,
    );
  }

  return response.status === 204 ? null : response.json();
}

const post = (path, body) =>
  request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  baseUrl: BASE,

  // --- sessions: the live agent simulation --------------------------------
  /** venue JSON + crowd settings -> SessionInfo. The venue travels inline. */
  createSession: (body) => post('/sessions', body),
  listSessions: () => request('/sessions'),
  getSession: (id) => request(`/sessions/${id}`),
  startSession: (id) => post(`/sessions/${id}/start`),
  pauseSession: (id) => post(`/sessions/${id}/pause`),
  stopSession: (id) => post(`/sessions/${id}/stop`),
  /** The same frame the WebSocket pushes — for a first paint before the socket opens. */
  getSessionState: (id) => request(`/sessions/${id}/state`),

  /**
   * Tells the venue which zone an attendee is standing in.
   *
   * The same endpoint the mobile app uses. The browser sends the self-declared form
   * (`{ nodeId }`) because a laptop has no useful GPS — but it is the same walker, counted the
   * same way, so an operator sees web attendees and phone attendees in one number.
   *
   * `walkerId` is opaque and generated on this device; there is no account behind it.
   */
  placeWalker: (sessionId, walkerId, fix) =>
    request(`/sessions/${sessionId}/walkers/${encodeURIComponent(walkerId)}`,
      { method: 'PUT', body: JSON.stringify(fix) }),
  removeWalker: (sessionId, walkerId) =>
    request(`/sessions/${sessionId}/walkers/${encodeURIComponent(walkerId)}`, { method: 'DELETE' }),
  /** Post-run stats including the baseline twin comparison. */
  getSessionSummary: (id) => request(`/sessions/${id}/summary`),

  // --- venues -------------------------------------------------------------
  createVenue: (venue) => post('/venues', venue),
  getVenue: (id) => request(`/venues/${id}`),
  /** Walking path from a zone to the nearest exit, over the venue's own edges. */
  getVenueRoute: (id, fromNodeId) =>
    request(`/venues/${id}/route?from=${encodeURIComponent(fromNodeId)}`),

  /**
   * Ties a venue's layout to real coordinates, so the mobile app can turn a GPS fix into a zone.
   *
   * Three anchors, because two cannot distinguish a rotation from its mirror image — and since
   * venue y runs downward while north runs up, the mirrored fit is the one a two-point solve
   * tends to pick. See docs/api-contract.md.
   */
  setGeoref: (id, anchors) =>
    request(`/venues/${id}/georef`, { method: 'PUT', body: JSON.stringify({ anchors }) }),
  /** 404 here means "this venue has no GPS", which is the ordinary case rather than an error. */
  getGeoref: (id) => request(`/venues/${id}/georef`),
  clearGeoref: (id) => request(`/venues/${id}/georef`, { method: 'DELETE' }),

  health: () => request('/health'),
};

export default api;
