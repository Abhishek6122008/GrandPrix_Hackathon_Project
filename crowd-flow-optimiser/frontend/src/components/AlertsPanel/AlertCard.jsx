export default function AlertCard({ id, tick, nodeId, severity = 'OK', density = 0, trend = 'FLAT', message, onSelect }) {
  return (
    <article
      className="panel"
      onClick={() => onSelect?.(nodeId)}
      style={{ cursor: 'pointer', marginBottom: 10 }}
      data-alert-id={id}
    >
      <div className={`status-${severity.toLowerCase()}`} style={{ fontSize: 12, fontWeight: 600 }}>
        {severity} · {nodeId} · t{tick}
      </div>
      <p style={{ margin: '6px 0 0' }}>{message}</p>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        {Math.round(density * 100)}% capacity · {trend.toLowerCase()}
      </div>
    </article>
  );
}
