import { useState } from 'react';

// Reads a venue-layout JSON file and hands the parsed object up.
export default function VenueUpload({ onLoaded }) {
  const [error, setError] = useState(null);
  const [name, setName] = useState(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const venue = JSON.parse(await file.text());
      setName(venue.name ?? file.name);
      setError(null);
      onLoaded?.(venue);
    } catch {
      setError('Not valid venue-layout JSON.');
    }
  }

  return (
    <div className="panel">
      <label>
        Venue layout (JSON)
        <input type="file" accept="application/json" onChange={handleFile} />
      </label>
      {name && <p style={{ color: 'var(--ok)', margin: 0 }}>Loaded: {name}</p>}
      {error && <p style={{ color: 'var(--crit)', margin: 0 }}>{error}</p>}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Try <code>sample-data/venue-layout-sample.json</code>.
      </p>
    </div>
  );
}
