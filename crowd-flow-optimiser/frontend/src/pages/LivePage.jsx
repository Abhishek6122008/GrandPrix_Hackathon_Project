import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
// Falls back to the plain marker map until the pixel-art assets are generated.
import PixelVenueMap from '../components/VenueMap/PixelVenueMap.jsx';
import AlertsPanel from '../components/AlertsPanel/AlertsPanel.jsx';
import DensityGauge from '../components/shared/DensityGauge.jsx';
import Timeline from '../components/shared/Timeline.jsx';
import { useSimulationApi } from '../hooks/useSimulationApi.js';
import { useSimulationSocket } from '../hooks/useSimulationSocket.js';
import { mockAlerts, mockReroute, mockState, mockVenue } from '../mockData.js';

export default function LivePage() {
  const { simulationId } = useParams();
  const api = useSimulationApi();
  const { state: liveState, connected } = useSimulationSocket(simulationId);

  const [venue, setVenue] = useState(mockVenue);
  const [state, setState] = useState(mockState);
  const [alerts, setAlerts] = useState(mockAlerts);
  const [reroute, setReroute] = useState(null);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (liveState) setState(liveState);
  }, [liveState]);

  useEffect(() => {
    if (!simulationId) return;
    api.getAlerts(simulationId).then(setAlerts).catch(() => {});
  }, [api, simulationId, state.tick]);

  async function selectNode(nodeId) {
    if (!simulationId) return setReroute(mockReroute);
    try {
      setReroute(await api.getReroute(simulationId, nodeId));
    } catch {
      setReroute(null);
    }
  }

  async function seek(t) {
    setPlaying(false);
    if (!simulationId) return;
    try {
      setState(await api.getState(simulationId, t));
    } catch {
      /* keep last frame */
    }
  }

  // First frame also tells us which venue to draw.
  useEffect(() => {
    if (!simulationId) return;
    api
      .getState(simulationId)
      .then((s) => {
        setState(s);
        return s.venueId && api.getVenue(s.venueId).then(setVenue);
      })
      .catch(() => {});
  }, [api, simulationId]);

  return (
    <div className="grid grid-live">
      <div>
        <PixelVenueMap venue={venue} state={state} reroutePath={reroute?.path ?? []} onSelectNode={selectNode} />
        <div style={{ height: 16 }} />
        <Timeline
          tick={state.tick ?? 0}
          totalTicks={state.totalTicks ?? state.tick ?? 0}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSeek={seek}
        />
      </div>
      <div>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {simulationId ? `run ${simulationId} · ${connected ? 'live' : 'disconnected'}` : 'mock data (no run started)'}
          </div>
          {(state.nodes ?? []).map((n) => (
            <DensityGauge key={n.nodeId} label={n.nodeId} density={n.density} status={n.status} />
          ))}
        </div>
        <AlertsPanel alerts={alerts} onSelectNode={selectNode} />
        <div style={{ height: 16 }} />
        <Link to={simulationId ? `/summary/${simulationId}` : '/summary'}>
          <button>End run → summary</button>
        </Link>
      </div>
    </div>
  );
}
