import NodeMarker from './NodeMarker.jsx';
import RerouteOverlay from './RerouteOverlay.jsx';

/**
 * venue: { nodes: [{id,name,x,y,capacity}], edges: [{from,to}] }
 * state: { nodes: [{nodeId, density, status}] }
 */
export default function VenueMap({ venue, state, reroutePath = [], onSelectNode }) {
  if (!venue) return <div className="panel">No venue loaded.</div>;

  const byId = Object.fromEntries(venue.nodes.map((n) => [n.id, n]));
  const stateById = Object.fromEntries((state?.nodes ?? []).map((n) => [n.nodeId, n]));

  return (
    <div className="panel">
      <svg viewBox="0 0 620 420" width="100%" role="img" aria-label="Venue density map">
        {venue.edges.map((e, i) => {
          const a = byId[e.from];
          const b = byId[e.to];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line)" strokeWidth="3" />;
        })}

        <RerouteOverlay path={reroutePath} nodes={venue.nodes} />

        {venue.nodes.map((n) => (
          <NodeMarker
            key={n.id}
            id={n.id}
            name={n.name}
            x={n.x}
            y={n.y}
            density={stateById[n.id]?.density ?? 0}
            status={stateById[n.id]?.status ?? 'OK'}
            onSelect={onSelectNode}
          />
        ))}
      </svg>
    </div>
  );
}
