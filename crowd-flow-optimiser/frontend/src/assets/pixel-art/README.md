# Pixel art assets

Generated with the **PixelLab MCP server**. Empty until generation runs — the app falls
back to the plain marker map until then, by design.

Drop files here exactly as named below; `manifest.js` discovers them automatically and
nothing else needs changing.

## Tileset — `tiles/`, 32×32 px each, top-down

| File | Node type | Notes |
|---|---|---|
| `gate.png` | `GATE` | Entrance/turnstile, reads as a way *in* |
| `walkway.png` | `WALKWAY` | Neutral paved floor, tiles seamlessly |
| `concession.png` | `CONCESSION` | Counter/stall with an awning |
| `seating.png` | `SEATING` | Rows of stand seating |
| `exit.png` | `EXIT` | Clearly distinct from `gate` — different colour, reads as a way *out* |
| `wall.png` | — | Barrier, drawn between unconnected zones |

One consistent palette and light direction across all six, or the map looks assembled from
different games.

## Crowd agent — `sprites/`

| File | Purpose |
|---|---|
| `crowd-calm.png` | Walk-cycle sheet, normal tint |
| `crowd-dense.png` | Same sheet, warmer/redder tint for `WARNING`/`CRITICAL` zones |

Sheet layout, as declared in `manifest.js`:

- 16×16 px frames
- 4 frames per walk cycle, left to right
- 4 rows, one per direction, in this order: **south, west, east, north**
- Total sheet: 64×64 px

If PixelLab returns 8 directions, keep the same row-major convention and update
`CROWD_SPRITE.directions` — the renderer reads the manifest, not hardcoded indices.

## Regenerating

The PixelLab MCP server is registered for this project (`claude mcp list` → `pixellab`).
MCP tools bind at session start, so a session that predates registration cannot see them —
restart Claude Code before asking for generation.
