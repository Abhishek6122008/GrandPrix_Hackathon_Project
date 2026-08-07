/**
 * Turns the backend's venue **graph** into the polygon **map** the UI draws.
 *
 * The two models genuinely differ, and this is the seam between them:
 *
 * - The backend has nodes at (x, y) in arbitrary layout units, with a capacity and a type, and
 *   edges with a length and a width. It has no notion of a room's shape.
 * - `VenueMap` draws filled halls, corridor casings and an outline, all in a fixed 0–100 box.
 *
 * So a hall's polygon is *derived* from its node, using the same capacity→radius curve the
 * backend uses to place agents (`SimulationEngine.nodeRadius`). That is what keeps a person's
 * dot inside the hall it is reported to be in — if these two formulas drift apart, the crowd
 * renders outside the rooms.
 */

/** Mirror of SimulationEngine.nodeRadius. Keep in step, or agents drift out of their halls. */
export function nodeRadius(capacity) {
  return Math.max(10, Math.min(44, 8 + Math.sqrt(capacity) * 0.6));
}

/** Padding around the layout's bounding box, as a fraction of its longest side. */
const MARGIN = 0.12;

/**
 * Builds the projection from layout units into the map's 0–100 box.
 *
 * One uniform scale for both axes, deliberately: scaling x and y independently would stretch a
 * long thin venue into a square and make every corridor the wrong length relative to the
 * radius circles drawn on it.
 */
export function projectionFor(nodes) {
  if (!nodes?.length) {
    return { toMap: (x, y) => [x, y], scale: 1 };
  }

  const radii = nodes.map((n) => nodeRadius(n.capacity ?? 100));
  const minX = Math.min(...nodes.map((n, i) => n.x - radii[i]));
  const maxX = Math.max(...nodes.map((n, i) => n.x + radii[i]));
  const minY = Math.min(...nodes.map((n, i) => n.y - radii[i]));
  const maxY = Math.max(...nodes.map((n, i) => n.y + radii[i]));

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  const span = Math.max(width, height);

  const scale = (100 - 200 * MARGIN) / span;
  // Centre the shorter axis so the venue sits in the middle of the box rather than the corner.
  const offsetX = 100 * MARGIN + (span - width) * scale * 0.5;
  const offsetY = 100 * MARGIN + (span - height) * scale * 0.5;

  return {
    scale,
    toMap: (x, y) => [(x - minX) * scale + offsetX, (y - minY) * scale + offsetY],
  };
}

/** An octagon around a point — close enough to a room, and cheaper to read than a circle. */
function octagon(cx, cy, r) {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI / 4) * i + Math.PI / 8;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
}

/**
 * The venue outline: the convex hull of every hall polygon, nudged outward.
 *
 * A hull rather than a bounding box because the box on an L-shaped venue encloses a large
 * empty quadrant, and `VenueMap` uses the outline as a geofence — a walker standing in that
 * empty corner would read as "inside".
 */
function hull(points) {
  if (points.length < 3) return points;

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (source) => {
    const stack = [];
    for (const point of source) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], point) <= 0) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop(); // shared with the other half
    return stack;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/** Pushes hull points away from the centroid so the outline clears the halls it wraps. */
function inflate(points, amount) {
  if (!points.length) return points;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * amount, y + (dy / length) * amount];
  });
}

/**
 * Backend `Venue` -> the shape `VenueMap` expects.
 *
 * `halls` keep their backend node id, which is what lets a live frame's per-node density be
 * looked up straight onto the polygon without a second mapping table.
 */
export function toMapVenue(venue) {
  const nodes = venue?.nodes ?? [];
  const { toMap, scale } = projectionFor(nodes);

  const halls = nodes.map((node) => {
    const [cx, cy] = toMap(node.x, node.y);
    const r = nodeRadius(node.capacity ?? 100) * scale;
    return {
      id: node.id,
      name: node.name ?? node.id,
      type: node.type ?? 'WALKWAY',
      capacity: node.capacity ?? 0,
      pts: octagon(cx, cy, r),
      center: [cx, cy],
      radius: r,
      density: 0, // replaced per frame by applyFrame
    };
  });

  const byId = new Map(halls.map((hall) => [hall.id, hall]));
  const corridors = (venue?.edges ?? [])
    .map((edge) => {
      const from = byId.get(edge.from ?? edge.source);
      const to = byId.get(edge.to ?? edge.target);
      return from && to ? [from.center, to.center] : null;
    })
    .filter(Boolean);

  return {
    id: venue?.id ?? 'venue',
    name: venue?.name ?? 'Venue',
    city: venue?.city ?? '',
    capacity: nodes.reduce((sum, node) => sum + (node.capacity ?? 0), 0),
    outline: inflate(hull(halls.flatMap((hall) => hall.pts)), 3),
    halls,
    corridors,
    // The backend has no concept of facilities, so concessions stand in for them: they are the
    // zones an attendee would actually walk to. Better an honest subset than invented pins.
    pois: halls
      .filter((hall) => hall.type === 'CONCESSION')
      .map((hall) => ({ id: `poi-${hall.id}`, name: hall.name, x: hall.center[0], y: hall.center[1], kind: 'cafe' })),
    projection: { toMap, scale },
  };
}

/**
 * Folds one live frame's densities onto a map venue, returning a new object.
 *
 * Returns a fresh venue rather than mutating so React re-renders; the hall polygons themselves
 * are reused by reference because geometry never changes once the layout is uploaded.
 */
export function applyFrame(mapVenue, frame) {
  if (!mapVenue || !frame?.nodes) return mapVenue;

  const byId = new Map(frame.nodes.map((node) => [node.nodeId, node]));
  return {
    ...mapVenue,
    live: frame.metrics?.peopleInside ?? 0,
    halls: mapVenue.halls.map((hall) => {
      const live = byId.get(hall.id);
      return live
        ? {
            ...hall,
            density: live.density,
            occupancy: live.occupancy,
            status: live.status,
            trend: live.trend,
            risk: live.predictedRisk,
          }
        : hall;
    }),
  };
}

/** Live agent positions, projected into the map's coordinate box. */
export function projectPeople(mapVenue, people) {
  const toMap = mapVenue?.projection?.toMap;
  if (!toMap || !people?.length) return [];
  return people.map((person) => {
    const [x, y] = toMap(person.x, person.y);
    return { id: person.id, x, y, hot: person.rerouted, type: person.type };
  });
}

/**
 * A reroute path as map-space points, for drawing the diversion polyline.
 * Unknown node ids are dropped rather than defaulting to (0,0), which would draw a line to the
 * corner of the map and look like a bug in the router.
 */
export function projectPath(mapVenue, nodeIds) {
  if (!mapVenue || !nodeIds?.length) return null;
  const byId = new Map(mapVenue.halls.map((hall) => [hall.id, hall]));
  const points = nodeIds.map((id) => byId.get(id)?.center).filter(Boolean);
  return points.length >= 2 ? points : null;
}
