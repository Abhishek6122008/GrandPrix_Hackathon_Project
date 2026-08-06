function Column({ title, data = {} }) {
  return (
    <div className="panel">
      <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>{title}</h3>
      <p style={{ fontSize: 26, margin: '0 0 4px' }}>{data.criticalNodeTicks ?? 0}</p>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>zone-ticks above critical</p>
      <p>Peak density: {Math.round((data.peakDensity ?? 0) * 100)}%</p>
      <p>Zones that went critical: {data.bottleneckCount ?? 0}</p>
      <p>Ticks to clear: {data.avgClearTicks ?? '—'}</p>
    </div>
  );
}

export default function SummaryReport({ summary }) {
  if (!summary) return <div className="panel">No summary yet — run a simulation first.</div>;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Column title="No intervention" data={summary.baseline} />
      <Column title="With rerouting" data={summary.optimised} />
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Recap</h3>
        <p style={{ margin: 0 }}>{summary.narrative}</p>
      </div>
    </div>
  );
}
