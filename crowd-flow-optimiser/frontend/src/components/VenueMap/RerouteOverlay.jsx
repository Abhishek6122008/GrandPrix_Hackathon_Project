// Dashed animated path over the map for a suggested reroute.
export default function RerouteOverlay({ path = [], nodes = [] }) {
  if (path.length < 2) return null;

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const points = path.map((id) => byId[id]).filter(Boolean);
  if (points.length < 2) return null;

  const d = points.map((n, i) => `${i === 0 ? 'M' : 'L'} ${n.x} ${n.y}`).join(' ');

  return (
    <g>
      <path d={d} fill="none" stroke="var(--ok)" strokeWidth="3" strokeDasharray="8 6">
        <animate attributeName="stroke-dashoffset" from="28" to="0" dur="1s" repeatCount="indefinite" />
      </path>
    </g>
  );
}
