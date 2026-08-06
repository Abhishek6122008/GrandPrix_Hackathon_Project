import { useEffect, useState } from 'react';
import VenueMap from './VenueMap.jsx';
import RerouteOverlay from './RerouteOverlay.jsx';
import { CROWD_SPRITE, GRID, TILE_FOR_TYPE, assetsReady, sprites, tiles } from '../../assets/pixel-art/manifest.js';

/**
 * Pixel-art reskin of VenueMap. Same props, same data.
 *
 * Presentation only: if the generated assets are not present it renders the plain marker
 * map instead, so the density / GNN / reroute flow never depends on artwork existing.
 */
export default function PixelVenueMap({ venue, state, reroutePath = [], onSelectNode }) {
  const [frame, setFrame] = useState(0);

  // Walk cycle runs off wall-clock time, independent of simulation ticks.
  useEffect(() => {
    if (!assetsReady) return undefined;
    const id = setInterval(() => setFrame((f) => (f + 1) % CROWD_SPRITE.framesPerCycle), 180);
    return () => clearInterval(id);
  }, []);

  if (!assetsReady) return <VenueMap venue={venue} state={state} reroutePath={reroutePath} onSelectNode={onSelectNode} />;
  if (!venue) return <div className="panel">No venue loaded.</div>;

  const byId = Object.fromEntries(venue.nodes.map((n) => [n.id, n]));
  const stateById = Object.fromEntries((state?.nodes ?? []).map((n) => [n.nodeId, n]));

  return (
    <div className="panel">
      <svg
        viewBox="0 0 620 420"
        width="100%"
        role="img"
        aria-label="Venue density map"
        style={{ imageRendering: 'pixelated' }}
      >
        {venue.edges.map((e, i) => {
          const a = byId[e.from];
          const b = byId[e.to];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line)" strokeWidth="3" />;
        })}

        {venue.nodes.map((node) => (
          <image
            key={node.id}
            href={tiles[TILE_FOR_TYPE[node.type]] ?? tiles.walkway}
            x={node.x - GRID / 2}
            y={node.y - GRID / 2}
            width={GRID}
            height={GRID}
            onClick={() => onSelectNode?.(node.id)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        <RerouteOverlay path={reroutePath} nodes={venue.nodes} />

        {venue.nodes.map((node) => (
          <CrowdCluster key={node.id} node={node} nodeState={stateById[node.id]} frame={frame} />
        ))}
      </svg>
    </div>
  );
}

/**
 * Crowd sprites for one zone. Count comes from live occupancy and the scatter is derived
 * from the node id, so positions are stable across ticks instead of jittering — nothing here
 * is hardcoded per venue.
 */
function CrowdCluster({ node, nodeState, frame }) {
  if (!nodeState || nodeState.occupancy <= 0) return null;

  const { frameWidth, frameHeight, directions, variants } = CROWD_SPRITE;
  const sheet = sprites[nodeState.status === 'OK' ? variants.calm : variants.dense] ?? sprites[variants.calm];
  if (!sheet) return null;

  // One sprite per 10% of capacity, capped — a readable crowd, not 300 overlapping people.
  const count = Math.min(12, Math.ceil(nodeState.density * 10));

  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const seed = hash(`${node.id}-${i}`);
        const offsetX = ((seed % 100) / 100 - 0.5) * GRID;
        const offsetY = (((seed >> 7) % 100) / 100 - 0.5) * GRID;
        const direction = (seed >> 3) % directions.length;

        return (
          <svg
            key={i}
            x={node.x + offsetX - frameWidth / 2}
            y={node.y + offsetY - frameHeight / 2}
            width={frameWidth}
            height={frameHeight}
            viewBox={`${frame * frameWidth} ${direction * frameHeight} ${frameWidth} ${frameHeight}`}
          >
            <image href={sheet} />
          </svg>
        );
      })}
    </g>
  );
}

/** Cheap deterministic hash so a given node id always scatters the same way. */
function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
