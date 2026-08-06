export default function DensityGauge({ label, density = 0, status = 'OK' }) {
  const pct = Math.min(100, Math.round(density * 100));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>{label}</span>
        <span className={`status-${status.toLowerCase()}`}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: '#10131a', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 3,
            background: `var(--${status === 'CRITICAL' ? 'crit' : status === 'WARNING' ? 'warn' : 'ok'})`,
            transform: `scaleX(${pct / 100})`,
            transformOrigin: 'left',
            transition: 'transform 200ms linear',
          }}
        />
      </div>
    </div>
  );
}
