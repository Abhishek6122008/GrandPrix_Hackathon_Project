// Single place that maps venue data -> pixel art. Nothing else hardcodes a filename.
//
// Assets are discovered at build time with import.meta.glob, so this module resolves to an
// empty set until the PNGs exist. That is deliberate: PixelVenueMap checks `assetsReady`
// and falls back to the plain marker map, keeping the reskin non-load-bearing.

export const GRID = 32; // px per tile, at 1x. Every tile must be exactly this square.

const tileUrls = import.meta.glob('./tiles/*.png', { eager: true, query: '?url', import: 'default' });
const spriteUrls = import.meta.glob('./sprites/*.png', { eager: true, query: '?url', import: 'default' });

const byBasename = (modules) =>
  Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop().replace('.png', ''), url])
  );

export const tiles = byBasename(tileUrls);
export const sprites = byBasename(spriteUrls);

/** VenueNode.type -> tile basename. Keep in step with VenueNode.Type in the backend. */
export const TILE_FOR_TYPE = {
  GATE: 'gate',
  WALKWAY: 'walkway',
  CONCESSION: 'concession',
  SEATING: 'seating',
  EXIT: 'exit',
};

export const WALL_TILE = 'wall';

/**
 * Crowd agent sheet. Frames are laid out left-to-right per row, one row per direction.
 * `calm` and `dense` are the same sheet in two tints, picked from DensityDetector status.
 */
export const CROWD_SPRITE = {
  frameWidth: 16,
  frameHeight: 16,
  framesPerCycle: 4,
  directions: ['south', 'west', 'east', 'north'], // row order in the sheet
  variants: { calm: 'crowd-calm', dense: 'crowd-dense' },
};

/** True once the tileset covers every node type we can render. */
export const assetsReady =
  Object.values(TILE_FOR_TYPE).every((name) => tiles[name]) && Boolean(sprites[CROWD_SPRITE.variants.calm]);
