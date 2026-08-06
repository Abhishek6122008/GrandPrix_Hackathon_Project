import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VenueUpload from '../components/Setup/VenueUpload.jsx';
import SimulationForm from '../components/Setup/SimulationForm.jsx';
import VenueMap from '../components/VenueMap/VenueMap.jsx';
import { useSimulationApi } from '../hooks/useSimulationApi.js';
import { mockVenue } from '../mockData.js';

export default function SetupPage() {
  const api = useSimulationApi();
  const navigate = useNavigate();
  const [venue, setVenue] = useState(mockVenue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(form) {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createVenue(venue);
      const sim = await api.createSimulation({ venueId: saved.id, ...form });
      navigate(`/live/${sim.id}`);
    } catch (e) {
      // Backend not up yet — the live page still runs on mock data.
      setError(`${e.message} — continuing with mock data.`);
      navigate('/live');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
      <div>
        <VenueUpload onLoaded={setVenue} />
        <div style={{ height: 16 }} />
        <SimulationForm onSubmit={run} disabled={busy} />
        {error && <p style={{ color: 'var(--warn)', fontSize: 12 }}>{error}</p>}
      </div>
      <VenueMap venue={venue} />
    </div>
  );
}
