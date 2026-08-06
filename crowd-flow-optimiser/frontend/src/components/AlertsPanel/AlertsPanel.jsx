import AlertCard from './AlertCard.jsx';

export default function AlertsPanel({ alerts = [], onSelectNode }) {
  return (
    <section>
      <h2 style={{ fontSize: 14, color: 'var(--muted)' }}>Alerts ({alerts.length})</h2>
      {alerts.length === 0 && <div className="panel">No bottlenecks detected yet.</div>}
      {alerts.map((a) => (
        <AlertCard key={a.id} {...a} onSelect={onSelectNode} />
      ))}
    </section>
  );
}
