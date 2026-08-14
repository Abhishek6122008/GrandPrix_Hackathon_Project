/**
 * Polls GET /sessions.
 *
 * Lives on its own because four unrelated screens want the same list — the showcase strip, the
 * results page, the walker portal and the admin console — and each of them polling its own copy
 * was how one page's refresh interval quietly became four requests a second.
 */

import { useEffect, useState } from 'react';
import { api } from './api.js';

export function useSessionList(intervalMs = 4000) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await api.listSessions();
        if (!cancelled) { setSessions(list); setError(null); }
      } catch (cause) {
        if (!cancelled) setError(cause.message);
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [intervalMs]);

  return { sessions, error };
}

