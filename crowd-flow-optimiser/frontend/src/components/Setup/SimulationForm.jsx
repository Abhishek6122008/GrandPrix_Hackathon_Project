import { useState } from 'react';

export default function SimulationForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({ crowdSize: 4000, ticks: 60, arrivalRate: 120, rerouteEnabled: true });

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) });

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(form);
      }}
    >
      <label>
        Crowd size
        <input type="number" min="1" value={form.crowdSize} onChange={set('crowdSize')} />
      </label>
      <label>
        Ticks to simulate
        <input type="number" min="1" value={form.ticks} onChange={set('ticks')} />
      </label>
      <label>
        Arrivals per tick
        <input type="number" min="1" value={form.arrivalRate} onChange={set('arrivalRate')} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={form.rerouteEnabled}
          onChange={set('rerouteEnabled')}
        />
        Apply reroute suggestions
      </label>
      <button type="submit" disabled={disabled}>
        Run simulation
      </button>
    </form>
  );
}
