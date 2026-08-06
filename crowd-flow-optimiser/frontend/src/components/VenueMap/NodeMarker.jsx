const FILL = { OK: 'var(--ok)', WARNING: 'var(--warn)', CRITICAL: 'var(--crit)' };

export default function NodeMarker({ id, name, x = 0, y = 0, density = 0, status = 'OK', onSelect }) {
  return (
    <g transform={`translate(${x},${y})`} onClick={() => onSelect?.(id)} style={{ cursor: 'pointer' }}>
      <circle r={14 + density * 18} fill={FILL[status] ?? FILL.OK} opacity={0.25} />
      <circle r={12} fill={FILL[status] ?? FILL.OK} />
      <text y={-22} textAnchor="middle" fontSize="11" fill="var(--text)">
        {name ?? id}
      </text>
      <text y={4} textAnchor="middle" fontSize="10" fill="#0f1115" fontWeight="600">
        {Math.round(density * 100)}
      </text>
    </g>
  );
}
