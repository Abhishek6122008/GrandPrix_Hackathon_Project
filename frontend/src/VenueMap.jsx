/**
 * The venue map: zones, heat, crowd figures and routes, drawn as SVG.
 *
 * The single biggest piece of the UI and the one every portal renders, which is why it is the
 * first thing that earned its own file. Everything here is either the map or a helper that only
 * the map uses — the geometry, the heat ramp, the sprite chooser and the id hash that keeps a
 * given person looking the same between frames.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TRAFFIC_BANDS } from './crowdRouting.js';
import {
  DoorOpen, Plus as PlusIcon, Minus as MinusIcon, Locate, Droplets, Coffee,
} from 'lucide-react';

export const POI_ICON = { water: Droplets, wc: DoorOpen, cafe: Coffee };

/** Backend Session.Status -> the wording and colour used across the portals. */
const HALL_STYLE = {
  GATE: { fill: "rgba(225,6,0,0.16)", stroke: "rgba(225,6,0,0.5)" },
  WALKWAY: { fill: "rgba(77,141,240,0.12)", stroke: "rgba(77,141,240,0.4)" },
  SEATING: { fill: "rgba(255,255,255,0.05)", stroke: "rgba(120,140,175,0.35)" },
  CONCESSION: { fill: "rgba(255,176,32,0.13)", stroke: "rgba(255,176,32,0.42)" },
  EXIT: { fill: "rgba(0,200,83,0.14)", stroke: "rgba(0,200,83,0.45)" },
};

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const centroid = (pts) => {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
};

export const densityColor = (d) =>
  d > 0.85 ? "var(--cf-red)" : d > 0.7 ? "var(--cf-orange)" : d > 0.5 ? "var(--cf-amber)" : "var(--cf-green)";

/**
 * The heatmap ramp, as literal rgb rather than CSS variables.
 *
 * SVG gradient stops cannot read `var(--cf-red)` reliably across browsers, so these repeat the
 * palette's values. Same four thresholds as `densityColor` above, and the two must agree — the
 * blob under a zone and the percentage printed on it are describing the same number.
 */
const HEAT_TIERS = [
  { id: "cf-heat-low", rgb: "rgb(0,200,83)", max: 0.5 },
  { id: "cf-heat-mid", rgb: "rgb(255,176,32)", max: 0.7 },
  { id: "cf-heat-high", rgb: "rgb(255,106,0)", max: 0.85 },
  { id: "cf-heat-crit", rgb: "rgb(225,6,0)", max: Infinity },
];

const heatTier = (d) => HEAT_TIERS.find((tier) => d <= tier.max) ?? HEAT_TIERS[HEAT_TIERS.length - 1];

/**
 * Pixel art per zone type, generated with PixelLab and served from `public/sprites`.
 *
 * WALKWAY and the concourse deliberately have none: they are the spaces *between* the things
 * worth drawing, and a prop in the middle of a corridor reads as an obstruction that the
 * simulation does not actually model.
 */
const ZONE_SPRITE = {
  GATE: "/sprites/gate-entrance.png",
  EXIT: "/sprites/exit-gateway.png",
  SEATING: "/sprites/seating-block.png",
  CONCESSION: "/sprites/concession-food.png",
};

/** Merch and food are both CONCESSION to the backend; the name is the only thing separating them. */
const spriteFor = (hall) =>
  hall.type === "CONCESSION" && /merch/i.test(`${hall.id} ${hall.name}`)
    ? "/sprites/concession-merch.png"
    : ZONE_SPRITE[hall.type] ?? null;

/**
 * Zoom at which agents become sprites instead of dots.
 *
 * ponytail: a flat threshold, not a size curve. Below it a 48px sprite would render into about
 * five screen pixels — unreadable, and 600 <image> nodes redrawn five times a second for the
 * privilege. Dots are both faster and clearer when zoomed out, so the map simply uses the one
 * that works at the current scale.
 */
/**
 * The crowd scale: how many people one drawn figure stands for. Fixed, for the whole run.
 *
 * It used to switch from 1:1 to 1:20 as a venue filled past a threshold, which meant every
 * figure on screen changed meaning mid-run — the crowd appeared to collapse at the moment the
 * venue got busiest, which is precisely when an operator is reading the map hardest. A constant
 * ratio costs a little fidelity in an empty venue and keeps the map honest all the way through.
 */
const CROWD_UNIT = 10;

/**
 * Absolute ceiling on drawn figures, for events far past the threshold.
 *
 * Matched to StateBroadcaster's own `max-people-in-frame` cap, because the server never sends
 * more than that many positions anyway — asking for more would only be asking for agents that
 * are not in the frame. At 1:20 that ceiling is reached around 12,000 people, past which the
 * ratio has to rise to stay drawable; the legend reports whatever it actually worked out to,
 * so the number on screen stays true even when it is no longer 20.
 */
const CROWD_FIGURES_HARD_MAX = 600;

/**
 * Stable 16-bit hash of an agent id, used to decide which agents are drawn as figures.
 *
 * Any cheap avalanche would do; this is FNV-1a's mixing step. What matters is that the same id
 * always lands on the same number, so an agent's membership never depends on how many other
 * agents happen to exist that frame.
 */
function hashId(id) {
  let hash = 0x811c9dc5;
  const text = String(id);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Crops out of `floor-tileset.png` (128px sheet, 32px cells), by their position on the sheet.
 *
 * `size` is how large one tile is drawn in map units. 6 puts roughly 17 tiles across a 100-unit
 * venue — small enough to read as texture, large enough that the pixel grid is still visible
 * rather than dissolving into noise.
 */
const FLOOR_TILES = [
  { id: "cf-floor-concrete", x: 64, y: 32, size: 6 },  // wang_0  — all-lower, dark concourse
  { id: "cf-floor-paved", x: 0, y: 96, size: 6 },      // wang_15 — all-upper, paved walkway
];

/**
 * Blob opacity for a zone's density.
 *
 * The gamma is the point. A straight `base + d` ramp put a 6%-full zone at 0.17 opacity, which
 * is invisible on a dark map — so a quiet venue rendered as an unreadable black plan and the
 * heat layer only appeared once things were already going wrong. `d ** 0.55` lifts the bottom
 * of the range without touching the top, so low densities are legible and a critical zone still
 * reads as clearly worse than a busy one.
 */
const heatOpacity = (d) => 0.18 + Math.min(1, Math.max(0, d)) ** 0.55 * 0.72;

/* ============================================================================
   Crowd positions arrive from the backend, not from here.

   The simulation integrates every agent under a social force model on the server
   and broadcasts sampled positions ~5 times a second over the session WebSocket;
   src/useCrowdFlow.js receives them and src/venueAdapter.js projects them into
   this map's coordinate box. The client draws dots, it does not invent them.
   ========================================================================== */

/* ============================================================================
   VenueMap — the Google-Maps-style canvas. Pan, zoom, halls as polygons,
   corridors as road casings, POI pins, live dots, blue "you" puck, and an
   optional directions polyline.
   ========================================================================== */

export function VenueMap({
  venue, people = [], crowdTotal = 0, me = null, route = null, showDensity = true,
  showPeople = true, showPois = true, showSprites = true,
  underlay = null, underlayOpacity = 0.25,
  height = 460, onSelectHall = null, selectedHall = null,
  /**
   * A `planRoute` result. Draws the walking route as per-hop coloured segments —
   * red through a jam, blue through clear ground — the way a traffic layer does.
   * `route` (a bare point list) is still honoured for callers that only have one.
   */
  trafficRoute = null,
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const wrapRef = useRef(null);

  // Width/height of the panel, so the viewBox below can match its shape. Tracked rather than
  // read once: the panel reflows with the sidebar at narrow widths, and a stale aspect would
  // stretch the venue until something else forced a re-render.
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clampZoom = (z) => Math.max(0.7, Math.min(3.2, z));

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    // User-space units per pixel. Both axes share one figure because the viewBox is kept at
    // the container's aspect. Dividing by zoom is what makes the map track the cursor exactly
    // rather than sliding faster the further you have zoomed in.
    const scale = rect && rect.height > 0 ? frame.h / zoom / rect.height : 0.2;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.sx) * scale,
      y: drag.current.py + (e.clientY - drag.current.sy) * scale,
    });
  };
  const onPointerUp = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const recenter = () => { setPan({ x: 0, y: 0 }); setZoom(1); };

  /**
   * The default view: the venue's own bounding box, grown to the panel's shape.
   *
   * The adapter projects a venue into a square 0-100 space preserving its real proportions, so
   * a wide arena occupies a wide, short band of that square and leaves the rest empty. Framing
   * the whole square therefore spent most of the panel on nothing — a 620x270 layout rendered
   * into roughly a seventh of the available pixels. Framing the venue instead fills the panel
   * whatever shape the venue is.
   *
   * Growing the *shorter* side to reach the panel's aspect is what keeps this from distorting:
   * the frame only ever gets bigger than the venue, never squashed to fit.
   */
  const frame = useMemo(() => {
    const points = venue.outline?.length ? venue.outline : [[0, 0], [100, 100]];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // Breathing room for what hangs off the venue: labels under edge zones, and the
    // entrance/exit badges pushed outward with three chevrons trailing behind them. At 4 the
    // badges on the outermost gates were sliced in half by the panel edge.
    const padding = 15;
    const width = Math.max(maxX - minX + padding * 2, 1);
    const height = Math.max(maxY - minY + padding * 2, 1);

    const boxWidth = Math.max(width, height * aspect);
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: boxWidth,
      h: boxWidth / aspect,
    };
  }, [venue.outline, aspect]);

  /**
   * The venue's own centre, used to push entrance/exit badges outward.
   *
   * Taken from the halls rather than from `frame`, which is grown to the panel's aspect — a
   * frame centre would sit off the venue on a wide layout and throw every badge to one side.
   */
  const venueCentre = useMemo(() => {
    const halls = venue.halls ?? [];
    if (!halls.length) return [50, 50];
    return [
      halls.reduce((sum, h) => sum + h.center[0], 0) / halls.length,
      halls.reduce((sum, h) => sum + h.center[1], 0) / halls.length,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id]);

  /**
   * Mask geometry, which depends only on the venue.
   *
   * Keyed on `venue.id`, deliberately, not on `venue.halls`. `applyFrame` returns a fresh
   * halls *array* every frame — the hall objects are spread to carry new density — so a
   * dependency on it invalidates five times a second and rebuilds this whole mask to describe
   * a building that has not moved. The polygons themselves are reused by reference and never
   * change once a layout is loaded, so the venue's identity is the honest dependency.
   */
  const walkableMask = useMemo(() => (
    <>
      <rect x="-400" y="-400" width="900" height="900" fill="black" />
      {venue.corridors.map((c, i) => (
        <line key={`m-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
          stroke="white" strokeWidth="4.2" strokeLinecap="round" />
      ))}
      {venue.halls.map((h) => (
        <polygon key={`m-${h.id}`} points={h.pts.map((p) => p.join(",")).join(" ")} fill="white" />
      ))}
    </>
  ), [venue.corridors, venue.halls]);

  /**
   * The crowd, thinned to a readable number of figures, and what one figure is worth.
   *
   * `people` is already a server-side sample — StateBroadcaster sends every nth agent, capped
   * at 600 — so this is a second thinning on top of that, and the ratio has to be worked out
   * against `crowdTotal` (everyone actually inside) rather than against the sample, or the
   * figure count would claim to be the crowd.
   *
   * Every nth again rather than the first n: a prefix would empty out whichever part of the
   * venue happened to sort last, and the shape of the crowd is the entire point of the map.
   */
  const crowd = useMemo(() => {
    // Chosen by a hash of each agent's id, not by position in the array.
    //
    // Selecting every nth *index* is what made figures teleport: as agents enter and leave,
    // `people.length` moves, the stride moves with it, and the entire set of chosen indices
    // changes at once — every figure on screen jumps to an unrelated agent's position in a
    // single frame. Worst at the end of a run, when the crowd drains fastest.
    //
    // Hashing the id instead means an agent's membership depends only on that agent. Changing
    // the ratio admits or drops a few figures at the margin; everyone already on screen stays
    // exactly where they were, and moves the way the simulation moved them.
    const total = Math.max(crowdTotal, people.length);

    // `people` is already a server-side sample capped at 600, so on a large event the target is
    // drawn from that sample rather than from every agent. Both selections hash the same ids,
    // so an agent the server keeps is an agent this can keep too.
    const wanted = Math.min(Math.ceil(total / CROWD_UNIT), people.length, CROWD_FIGURES_HARD_MAX);

    // The `wanted` agents with the lowest id hash. Exact count — a probability cutoff landed
    // near the target but not on it, so a 1,000-person event drew 58 figures and the legend
    // had to admit "1 ≈ 17" when the whole point was 20. Membership is just as stable: an
    // agent stays in for as long as fewer than `wanted` agents with lower hashes exist, so
    // the set changes at the margin rather than all at once.
    const figures = wanted >= people.length
      ? people
      : [...people].sort((a, b) => hashId(a.id) - hashId(b.id)).slice(0, wanted);
    return {
      figures,
      // Rounded to something an operator can hold in their head: "1 ≈ 20 people", not 1 ≈ 17.4.
      each: figures.length ? Math.max(1, Math.round(total / figures.length)) : 1,
    };
  }, [people, crowdTotal]);

  /** The venue's real extent in map space, grown a little so floor art reaches past the halls. */
  const venueBounds = useMemo(() => {
    const halls = venue.halls ?? [];
    if (!halls.length) return { x: 0, y: 0, w: 100, h: 100 };
    const minX = Math.min(...halls.map((h) => h.center[0] - h.radius));
    const maxX = Math.max(...halls.map((h) => h.center[0] + h.radius));
    const minY = Math.min(...halls.map((h) => h.center[1] - h.radius));
    const maxY = Math.max(...halls.map((h) => h.center[1] + h.radius));
    const bleed = 3;
    return {
      x: minX - bleed, y: minY - bleed,
      w: maxX - minX + bleed * 2, h: maxY - minY + bleed * 2,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id]);

  /** POI ids whose zone already draws a sprite, so the marker would only cover the art. */
  const poisHiddenBySprites = useMemo(() => {
    if (!showSprites) return new Set();
    return new Set(
      (venue.halls ?? []).filter(spriteFor).map((hall) => `poi-${hall.id}`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id, showSprites]);

  const vbW = frame.w / zoom;
  const vbH = frame.h / zoom;
  const cx = frame.cx - pan.x, cy = frame.cy - pan.y;
  const viewBox = `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`;
  const outlinePath = venue.outline.map((p) => p.join(",")).join(" ");

  return (
    <div ref={wrapRef} className="relative rounded-2xl overflow-hidden cf-card-solid" style={{ height }}>
      <svg
        viewBox={viewBox} className="w-full h-full cf-map-grab touch-none"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        role="img" aria-label={`Live map of ${venue.name}`}
      >
        <defs>
          <pattern id="cf-map-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(120,150,200,0.07)" strokeWidth="0.25" />
          </pattern>
          <clipPath id="cf-venue-clip"><polygon points={outlinePath} /></clipPath>
          <radialGradient id="cf-me-halo">
            <stop offset="0%" stopColor="rgba(77,141,240,0.45)" />
            <stop offset="100%" stopColor="rgba(77,141,240,0)" />
          </radialGradient>

          {/* Heat blobs. One gradient per density tier, each fading to fully transparent so
              neighbouring zones bleed into one another instead of ending at a hard polygon
              edge — crowding does not stop at a room boundary, and the map should not either. */}
          {HEAT_TIERS.map((tier) => (
            <radialGradient key={tier.id} id={tier.id}>
              <stop offset="0%" stopColor={tier.rgb} stopOpacity="0.95" />
              <stop offset="45%" stopColor={tier.rgb} stopOpacity="0.45" />
              <stop offset="100%" stopColor={tier.rgb} stopOpacity="0" />
            </radialGradient>
          ))}
          {/* Crowd figures as one reusable symbol each.
              A <use> is a single DOM node; the <g> of disc + sprite + marker it replaces was
              three, times ~120 figures, rebuilt five times a second. That was the largest part
              of the render cost, and none of the three ever differ between figures. */}
          <symbol id="cf-figure" overflow="visible">
            <circle cx="0" cy="0" r="1.6" fill="rgba(150,190,255,0.16)" />
            <image href="/sprites/people/attendee-blue-south.png"
              x="-1.15" y="-1.9" width="2.3" height="2.3" style={{ imageRendering: "pixelated" }} />
          </symbol>
          <symbol id="cf-figure-hot" overflow="visible">
            <circle cx="0" cy="0" r="1.6" fill="rgba(255,106,0,0.32)" />
            <image href="/sprites/people/attendee-blue-south.png"
              x="-1.15" y="-1.9" width="2.3" height="2.3" style={{ imageRendering: "pixelated" }} />
            <circle cx="0" cy="-2.2" r="0.45" fill="var(--cf-orange)" />
          </symbol>

          {/* Floor texture, cropped straight out of the Wang sheet.
              A nested <svg> with a viewBox is the crop: it maps one 32px cell of the 128px
              sheet onto the pattern's own box, so no tile has to be sliced out to its own file.
              ponytail: one solid tile tiled flat, not full corner-based autotiling. Autotiling
              buys seam-correct transitions between two terrains; this map has one floor and
              octagonal zones that never share a tile edge, so it would buy nothing here. */}
          {FLOOR_TILES.map((tile) => (
            <pattern key={tile.id} id={tile.id} width={tile.size} height={tile.size}
              patternUnits="userSpaceOnUse">
              <svg viewBox={`${tile.x} ${tile.y} 32 32`} width={tile.size} height={tile.size}>
                <image href="/sprites/floor-tileset.png" x="0" y="0" width="128" height="128"
                  style={{ imageRendering: "pixelated" }} />
              </svg>
            </pattern>
          ))}

          {/* Where a person can legitimately be: inside a zone, or in a corridor between two.
              Used as a mask on the crowd layer.

              The venue outline cannot do this job — it is a convex hull, so on any venue that
              is not roughly circular it spans wide empty pockets the simulation never routes
              anyone through. Agents rendered against that hull appeared to stand in the void
              outside the building. A mask rather than a clipPath because clipPaths ignore
              stroke, and the corridors only exist as stroked lines. */}
          <mask id="cf-walkable">{walkableMask}</mask>

          {/* Arrowhead for the flow markers. */}
          <marker id="cf-flow-head" viewBox="0 0 8 8" refX="6" refY="4"
            markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--cf-blue-hi)" />
          </marker>
        </defs>

        {/* Base. Sized well past the 0-100 projection space so the ground still covers the
            frame when a wide venue or a zoomed-out view widens the viewBox past it. */}
        <rect x="-400" y="-400" width="900" height="900" fill="#070B12" />
        <rect x="-400" y="-400" width="900" height="900" fill="url(#cf-map-grid)" />

        {/* venue landmass — tinted base first, then the floor texture over it, so the tiles
            sit on the map's own colour instead of replacing it with the tileset's grey */}
        <polygon points={outlinePath} fill="#0D1524" stroke="var(--cf-line2)" strokeWidth="0.5" />
        {showSprites && (
          <polygon points={outlinePath} fill="url(#cf-floor-concrete)" opacity="0.5"
            stroke="var(--cf-line2)" strokeWidth="0.5" />
        )}

        {/* Floor art, fitted to the venue's own bounding box rather than the whole 0-100
            projection square.
            The square is padded — the adapter insets the layout by 12% a side — so drawing
            here at 0,0,100,100 with `slice` cropped the ends off a wide image and pushed what
            survived out of register with the zones. `meet` inside the real bounds keeps the
            whole picture and lines its gates up with the gate nodes. */}
        {underlay && (
          <image href={underlay}
            x={venueBounds.x} y={venueBounds.y}
            width={venueBounds.w} height={venueBounds.h}
            preserveAspectRatio="xMidYMid meet" opacity={underlayOpacity}
            clipPath="url(#cf-venue-clip)" style={{ imageRendering: "pixelated" }} />
        )}

        {/* Corridors — casing then fill, the way map roads are drawn. These are also exactly
            what the crowd mask allows, so what you see is where people can be. */}
        <g clipPath="url(#cf-venue-clip)">
          {venue.corridors.map((c, i) => (
            <line key={`c-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
              stroke="#16233A" strokeWidth="3.6" strokeLinecap="round" />
          ))}
          {venue.corridors.map((c, i) => (
            <line key={`cf-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
              stroke="#22334F" strokeWidth="2.2" strokeLinecap="round" />
          ))}
        </g>

        {/* Heat. Drawn over the corridors and under the halls, so a zone's own label and
            percentage stay readable on top of its blob.

            `screen` blending is what makes two adjacent busy zones read as one hot region
            rather than two discs with a visible seam — the same reason a real heatmap adds
            light rather than painting over it.

            No blur filter here any more. An SVG feGaussianBlur re-runs on every repaint — five
            times a second over the whole heat layer — and it was buying nothing: the gradients
            already fade to fully transparent, which is the same softness by construction and
            free. */}
        {showDensity && (
          <g clipPath="url(#cf-venue-clip)"
            style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
            {venue.halls.map((h) => (
              <circle key={`heat-${h.id}`} cx={h.center[0]} cy={h.center[1]}
                // 2.1 -> 1.5. Area goes as the square, so this is roughly half the pixels, and
                // these are the most expensive pixels on the map: `screen` blending composites
                // every one of them against what is underneath, on every frame. The gradients
                // still fade to nothing, so the blobs read the same, just tighter to the zone
                // they describe.
                r={h.radius * 1.5} fill={`url(#${heatTier(h.density).id})`}
                opacity={heatOpacity(h.density)} />
            ))}
          </g>
        )}

        {/* halls */}
        {venue.halls.map((h) => {
          const style = HALL_STYLE[h.type] || HALL_STYLE.SEATING;
          const [hx, hy] = centroid(h.pts);
          const isSel = selectedHall === h.id;
          const sprite = showSprites ? spriteFor(h) : null;
          return (
            <g key={h.id} onClick={() => onSelectHall?.(h.id)} style={{ cursor: onSelectHall ? "pointer" : "default" }}>
              {/* With the heat layer on, the blob already carries the colour — filling the
                  polygon again on top of it stacks two washes of the same hue and turns a busy
                  zone into a flat slab. The polygon keeps only its edge, so you can still see
                  where one zone ends and the next begins. */}
              {/* Paved floor inside the zone, so a hall reads as a room rather than a hole in
                  the concourse. Under the density tint, which is kept faint because the heat
                  blob already carries the colour. */}
              {showSprites && (
                <polygon points={h.pts.map((p) => p.join(",")).join(" ")}
                  fill="url(#cf-floor-paved)" opacity="0.55" />
              )}
              <polygon points={h.pts.map((p) => p.join(",")).join(" ")}
                fill={showDensity ? densityColor(h.density) : style.fill}
                fillOpacity={showDensity ? 0.06 : 1}
                stroke={isSel ? "var(--cf-orange)" : style.stroke}
                strokeWidth={isSel ? 0.8 : 0.4} />

              {/* Pixel art for the zone, centred on it and scaled to its radius, so a bigger
                  hall gets a bigger prop without a second size table to keep in step.
                  `pixelated` is the whole point — the browser's default smoothing turns 96px
                  art into mush the moment it is drawn at any size but its own. */}
              {sprite && (
                <image href={sprite}
                  x={hx - h.radius * 1.1} y={hy - h.radius * 1.15}
                  width={h.radius * 2.2} height={h.radius * 2.2}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ imageRendering: "pixelated", pointerEvents: "none" }} />
              )}
              {/* Outlined text. A busy zone is exactly where the label matters most and also
                  exactly where hundreds of agent dots are drawn, so without a knockout the
                  name of the zone you are trying to read disappears into the crowd. */}
              {/* Label below the zone, not across its middle.
                  Centred text ran straight over the sprite, and on neighbouring zones the two
                  names overprinted each other — "LOWER STAND" and "EAST CONCOURSE" arrived as
                  one unreadable line. Hanging both off the bottom edge puts them in the gap
                  between zones, where there is room, and leaves the artwork clear. */}
              <text x={hx} y={hy + h.radius + 2.2} textAnchor="middle" fill="rgba(238,242,248,0.92)"
                stroke="#070B12" strokeWidth={0.7} paintOrder="stroke"
                style={{ fontSize: 1.9, fontFamily: "Rajdhani, sans-serif", fontWeight: 600, letterSpacing: "0.08em", pointerEvents: "none" }}>
                {h.name.toUpperCase()}
              </text>
              {showDensity && (
                <text x={hx} y={hy + h.radius + 4.4} textAnchor="middle" fill={densityColor(h.density)}
                  stroke="#070B12" strokeWidth={0.7} paintOrder="stroke"
                  style={{ fontSize: 1.8, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, pointerEvents: "none" }}>
                  {Math.round(h.density * 100)}%
                </text>
              )}
            </g>
          );
        })}

        {/* Critical zones, ringed and pulsing.
            The heat blob already colours them, but colour alone loses on a map with
            several busy areas — an expanding ring is the one thing on a static plan that
            catches an eye that is looking somewhere else. Only for zones actually past
            the critical line, so it never becomes ambient decoration.
            `cf-ping` is the existing keyframe, and it is already disabled under
            prefers-reduced-motion along with everything else. */}
        {showDensity && venue.halls
          .filter((h) => (h.density ?? 0) > 0.85)
          .map((h) => (
            <g key={`crit-${h.id}`} style={{ pointerEvents: "none" }}>
              <circle cx={h.center[0]} cy={h.center[1]} r={h.radius} fill="none"
                stroke="var(--cf-red)" strokeWidth="0.5" opacity="0.9" />
              <circle cx={h.center[0]} cy={h.center[1]} r={h.radius} fill="none"
                stroke="var(--cf-red)" strokeWidth="0.4" className="cf-ping"
                style={{ transformOrigin: `${h.center[0]}px ${h.center[1]}px` }} />
            </g>
          ))}

        {/* Entrance and exit signage.

            Pushed radially outward from the venue's own centre so a badge never lands on top
            of the zone it labels, and the chevrons point the way people actually travel:
            inward at a gate, outward at an exit. */}
        {venue.halls
          .filter((h) => h.type === "GATE" || h.type === "EXIT")
          .map((h) => {
            const isExit = h.type === "EXIT";
            const [vx, vy] = venueCentre;
            const dx = h.center[0] - vx;
            const dy = h.center[1] - vy;
            // A zone sitting exactly on the centroid has no outward direction; push it right
            // rather than dividing by zero and collapsing the badge onto the hall.
            const length = Math.hypot(dx, dy) || 1;
            const ux = dx / length;
            const uy = dy / length;
            const bx = h.center[0] + ux * (h.radius + 5);
            const by = h.center[1] + uy * (h.radius + 5);
            const colour = isExit ? "var(--cf-violet)" : "var(--cf-green)";
            const label = isExit ? "EXIT" : "ENTRANCE";
            const width = label.length * 1.15 + 2;
            // Chevrons travel with the crowd: away from the venue at an exit, into it at a gate.
            const sign = isExit ? 1 : -1;
            return (
              <g key={`sign-${h.id}`} style={{ pointerEvents: "none" }}>
                <rect x={bx - width / 2} y={by - 1.9} width={width} height={3.8} rx="0.9"
                  fill="#0B1018" stroke={colour} strokeWidth="0.35" opacity="0.95" />
                <text x={bx} y={by + 0.7} textAnchor="middle" fill={colour}
                  style={{ fontSize: 1.7, fontFamily: "Rajdhani, sans-serif", fontWeight: 700, letterSpacing: "0.14em" }}>
                  {label}
                </text>
                {[0, 1, 2].map((i) => (
                  <path key={i}
                    d={`M ${bx + ux * (width / 2 + 1.4 + i * 1.5) - uy * 0.9} ${by + uy * (width / 2 + 1.4 + i * 1.5) + ux * 0.9}
                        L ${bx + ux * (width / 2 + 2.2 + i * 1.5)} ${by + uy * (width / 2 + 2.2 + i * 1.5)}
                        L ${bx + ux * (width / 2 + 1.4 + i * 1.5) + uy * 0.9} ${by + uy * (width / 2 + 1.4 + i * 1.5) - ux * 0.9}`}
                    fill="none" stroke={colour} strokeWidth="0.45" strokeLinecap="round"
                    opacity={0.35 + i * 0.22}
                    transform={sign < 0 ? `rotate(180 ${bx} ${by})` : undefined} />
                ))}
              </g>
            );
          })}

        {/* Directions.
            Casing first as one continuous dark stroke, then each hop drawn over it in
            its own traffic colour. Two passes rather than one stroke per segment with
            its own casing, because per-segment casings overlap at every junction and
            leave a dark notch through the middle of the line. */}
        {trafficRoute?.segments?.length > 0 ? (
          <g style={{ pointerEvents: "none" }}>
            <polyline
              points={trafficRoute.points.map((p) => p.join(",")).join(" ")}
              fill="none" stroke="#05070B" strokeWidth="3.4"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
            {trafficRoute.segments.map((seg) => (
              <line key={seg.id} x1={seg.from[0]} y1={seg.from[1]}
                x2={seg.to[0]} y2={seg.to[1]}
                stroke={seg.band.color} strokeWidth="1.9"
                strokeLinecap="round" />
            ))}
            {/* Flow direction, over the colour rather than replacing it: the dashes
                say which way to walk, the colour underneath says how bad it is. */}
            <polyline
              points={trafficRoute.points.map((p) => p.join(",")).join(" ")}
              fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55"
              strokeLinecap="round" strokeLinejoin="round" className="cf-flow" />
            <circle
              cx={trafficRoute.points[trafficRoute.points.length - 1][0]}
              cy={trafficRoute.points[trafficRoute.points.length - 1][1]}
              r="1.8" fill="var(--cf-violet)" stroke="#05070B" strokeWidth="0.5" />
          </g>
        ) : route && route.length > 1 && (
          <>
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="#0A2A5E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="var(--cf-blue-hi)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="cf-flow" />
            <circle cx={route[route.length - 1][0]} cy={route[route.length - 1][1]} r="1.6"
              fill="var(--cf-green)" stroke="#05070B" strokeWidth="0.5" />
          </>
        )}

        {/* The crowd, as figures rather than one dot per agent. */}
        {/* pointerEvents off for the whole layer. Nothing here is clickable, but without it the
            browser hit-tests every figure on every mouse move — and because each <use> expands
            the symbol into its own shadow tree, that is several hundred elements tested per
            move. It made panning the map cost far more than drawing it. */}
        {showPeople && (
          <g mask="url(#cf-walkable)" style={{ pointerEvents: "none" }}
            shapeRendering="optimizeSpeed">
            {/* ponytail: one south-facing sprite for everyone. PersonState carries no heading,
                so choosing among the eight rotations would mean tracking each agent's previous
                position across frames — real bookkeeping for a detail nobody can resolve at
                this size. Wire the other seven in if headings ever ship. */}
            {crowd.figures.map((p) => (
              <use key={p.id} href={p.hot ? "#cf-figure-hot" : "#cf-figure"} x={p.x} y={p.y} />
            ))}
          </g>
        )}

        {/* POIs.
            Skipped wherever a sprite already stands: every POI is derived from a CONCESSION
            zone, and those now draw a food stall or a merch kiosk. The marker was landing on
            top of the artwork and hiding it — the blue dots that covered both stalls. */}
        {showPois && venue.pois.filter((poi) => !poisHiddenBySprites.has(poi.id)).map((poi) => (
          <g key={poi.id}>
            <circle cx={poi.x} cy={poi.y} r="1.5" fill="#0B1018" stroke="var(--cf-blue-hi)" strokeWidth="0.4" />
            <circle cx={poi.x} cy={poi.y} r="0.55" fill="var(--cf-blue-hi)" />
          </g>
        ))}

        {/* you */}
        {me && (
          <g>
            <circle cx={me.x} cy={me.y} r={me.accuracy} fill="url(#cf-me-halo)" />
            <circle cx={me.x} cy={me.y} r="1.9" fill="rgba(77,141,240,0.35)" className="cf-ping"
              style={{ transformOrigin: `${me.x}px ${me.y}px` }} />
            <circle cx={me.x} cy={me.y} r="1.5" fill="var(--cf-blue-hi)" stroke="#fff" strokeWidth="0.5" />
          </g>
        )}
      </svg>

      {/* map controls */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        {[
          { icon: PlusIcon, label: "Zoom in", fn: () => setZoom((z) => clampZoom(z + 0.35)) },
          { icon: MinusIcon, label: "Zoom out", fn: () => setZoom((z) => clampZoom(z - 0.35)) },
          { icon: Locate, label: "Recenter", fn: recenter },
        ].map(({ icon: Icon, label, fn }) => (
          <button key={label} onClick={fn} aria-label={label}
            className="cf-focus w-9 h-9 rounded-lg cf-card-solid flex items-center justify-center hover:cf-card-hi transition-colors">
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Density key. Without it the colours are decoration — this is what makes them a scale.
          Hidden with the heat layer itself, so it never explains something that is not on screen. */}
      {showDensity && (
        <div className="absolute left-3 top-3 cf-card-solid rounded-lg px-3 py-2.5 pointer-events-none">
          <div className="cf-accent text-[9px] cf-dim2 mb-1.5">DENSITY</div>
          <div className="h-1.5 w-32 rounded-full"
            style={{ background: "linear-gradient(90deg, rgb(0,200,83) 0%, rgb(255,176,32) 45%, rgb(255,106,0) 72%, rgb(225,6,0) 100%)" }} />
          <div className="flex justify-between cf-mono text-[9px] cf-dim2 mt-1">
            <span>LOW</span><span>CRITICAL</span>
          </div>
          <div className="flex items-center gap-3 mt-2.5">
            <span className="flex items-center gap-1 cf-mono text-[9px] cf-dim2">
              <span className="w-2 h-2 rounded-sm" style={{ background: "var(--cf-green)" }} />ENTRY
            </span>
            <span className="flex items-center gap-1 cf-mono text-[9px] cf-dim2">
              <span className="w-2 h-2 rounded-sm" style={{ background: "var(--cf-violet)" }} />EXIT
            </span>
          </div>
          {/* Route colours, shown only when a route is on screen. The density ramp above
              and this are two different scales — one paints zones, one paints the line
              you walk — so labelling them separately stops the line being read as
              another heat blob. */}
          {trafficRoute?.segments?.length > 0 && (
            <div className="mt-2.5 pt-2 flex flex-col gap-1"
              style={{ borderTop: "1px solid var(--cf-line)" }}>
              <div className="cf-accent text-[9px] cf-dim2">YOUR ROUTE</div>
              {TRAFFIC_BANDS.map((band) => (
                <span key={band.id} className="flex items-center gap-1.5 cf-mono text-[9px] cf-dim2">
                  <span className="w-3 h-[3px] rounded-full" style={{ background: band.color }} />
                  {band.label}
                </span>
              ))}
            </div>
          )}

          {/* The ratio, stated rather than implied. A map that draws 140 figures for 2,000
              people is lying unless it says so. */}
          {showPeople && crowd.each > 1 && (
            <div className="flex items-center gap-1.5 cf-mono text-[9px] cf-dim2 mt-1.5 pt-1.5"
              style={{ borderTop: "1px solid var(--cf-line)" }}>
              <img src="/sprites/people/attendee-blue-south.png" alt="" width="10" height="10"
                style={{ imageRendering: "pixelated" }} />
              <span>1 FIGURE ≈ {crowd.each} PEOPLE</span>
            </div>
          )}
        </div>
      )}

      <div className="absolute left-3 bottom-3 cf-mono text-[10px] cf-dim2 flex items-center gap-2">
        <span className="px-2 py-1 rounded cf-card-solid">{venue.id}</span>
        <span className="px-2 py-1 rounded cf-card-solid">{(zoom * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ============================================================================
   Primitives
   ========================================================================== */

