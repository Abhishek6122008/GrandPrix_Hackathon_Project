/**
 * The one hook every portal uses: owns a session's lifecycle and its live frame, and hands
 * back everything already in map coordinates.
 *
 * Deliberately holds no mock data. When there is no session, `venue` is null and the callers
 * render their empty state — a map showing invented crowd would be worse than no map, because
 * nothing on screen would say which one you were looking at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useLiveSession } from './useLiveSession.js';
import { applyFrame, projectPath, projectPeople, toMapVenue } from './venueAdapter.js';

export function useCrowdFlow() {
  const [sessionId, setSessionId] = useState(null);
  const [info, setInfo] = useState(null);
  const [venue, setVenue] = useState(null); // raw backend venue, kept for re-adaptation
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { state: frame, connected, error: socketError } = useLiveSession(sessionId);

  // Geometry is derived once per venue, not per frame: the polygons never move, and rebuilding
  // a convex hull five times a second for a layout that cannot change is pure waste.
  const baseMapVenue = useMemo(() => (venue ? toMapVenue(venue) : null), [venue]);

  const mapVenue = useMemo(
    () => (baseMapVenue && frame ? applyFrame(baseMapVenue, frame) : baseMapVenue),
    [baseMapVenue, frame],
  );

  const people = useMemo(
    () => projectPeople(baseMapVenue, frame?.people),
    [baseMapVenue, frame?.people],
  );

  /** The most recent diversion the router applied, as map points — null when there is none. */
  const reroutePath = useMemo(() => {
    const latest = frame?.reroutes?.[frame.reroutes.length - 1];
    return latest ? projectPath(baseMapVenue, latest.path) : null;
  }, [baseMapVenue, frame?.reroutes]);

  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(cause.message ?? String(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Uploads a venue and opens a session on it. Does not start the clock — `start` does that. */
  const create = useCallback(
    (venueJson, settings = {}) =>
      run(async () => {
        const created = await api.createSession({
          venue: venueJson,
          crowdSize: settings.crowdSize ?? 2500,
          arrivalRate: settings.arrivalRate ?? 25,
          maxTicks: settings.maxTicks ?? 1200,
          tickSeconds: settings.tickSeconds ?? 1.0,
          rerouteEnabled: settings.rerouteEnabled ?? true,
        });
        setVenue(venueJson);
        setInfo(created);
        setSessionId(created.sessionId);
        return created;
      }),
    [run],
  );

  /** Attaches to a session someone else created — how the admin portal opens a running venue. */
  const attach = useCallback(
    (id) =>
      run(async () => {
        const existing = await api.getSession(id);
        const venueJson = await api.getVenue(existing.venueId);
        setVenue(venueJson);
        setInfo(existing);
        setSessionId(id);
        return existing;
      }),
    [run],
  );

  const control = useCallback(
    (verb) =>
      run(async () => {
        const call = { start: api.startSession, pause: api.pauseSession, stop: api.stopSession }[verb];
        const updated = await call(sessionId);
        setInfo(updated);
        return updated;
      }),
    [run, sessionId],
  );

  const start = useCallback(() => control('start'), [control]);
  const pause = useCallback(() => control('pause'), [control]);
  const stop = useCallback(() => control('stop'), [control]);

  const leave = useCallback(() => {
    setSessionId(null);
    setInfo(null);
    setVenue(null);
    setError(null);
  }, []);

  // Keep the header's status/tick honest while the clock runs. The frame carries status too,
  // but a paused session stops broadcasting, so without this the badge would freeze on RUNNING.
  useEffect(() => {
    if (!frame || !info) return;
    if (frame.status !== info.status || frame.tick !== info.tick) {
      setInfo((previous) => ({ ...previous, status: frame.status, tick: frame.tick }));
    }
  }, [frame?.status, frame?.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sessionId,
    info,
    venue: mapVenue,
    rawVenue: venue,
    frame,
    people,
    reroutePath,
    alerts: frame?.alerts ?? [],
    advisory: frame?.advisory ?? null,
    aiStatus: frame?.aiStatus ?? info?.aiStatus ?? null,
    metrics: frame?.metrics ?? null,
    connected,
    busy,
    error: error ?? socketError,
    create,
    attach,
    start,
    pause,
    stop,
    leave,
  };
}

export default useCrowdFlow;
