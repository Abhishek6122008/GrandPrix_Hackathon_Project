import { useEffect, useRef, useState } from 'react';

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8080';

/**
 * Subscribes to /simulations/{id}/stream and keeps the latest tick payload.
 * Returns { state, connected, error } — state is the last SimulationState frame.
 */
export function useSimulationSocket(simulationId) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!simulationId) return undefined;

    const socket = new WebSocket(`${WS_BASE}/simulations/${simulationId}/stream`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setError('WebSocket connection failed');
    socket.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data));
      } catch {
        setError('Malformed frame from server');
      }
    };

    return () => socket.close();
  }, [simulationId]);

  return { state, connected, error, socket: socketRef };
}

export default useSimulationSocket;
