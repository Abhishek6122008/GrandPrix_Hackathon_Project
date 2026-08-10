# Layout Studio — developer handoff

Spec for `frontend/src/LayoutStudio.jsx`, the human-verification screen between
`POST /layout/parse` and the crowd simulation.

> The `design:design-handoff` skill was listed in this environment but isn't mounted on
> disk, so this follows its documented section structure (layout, tokens, props,
> states, responsive, edge cases, animation) written by hand rather than generated.

---

## 1. Purpose and the one rule

One wrong VLM interpretation must not reach the simulation. Every path through this
screen ends at an explicit operator action; nothing auto-advances. **"Start simulation"
stays disabled until `PUT /layout/{id}/confirm` returns `ready: true`.**

---

## 2. Design tokens

Scoped to `.ls-root` so the component can drop into the existing app without leaking.

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#05070B` | page |
| `--panel` | `#0B1018` | toolbar (at 92% alpha) |
| `--card` | `#111826` | side panel cards, buttons |
| `--line` | `#1E2A3D` | hairline borders |
| `--line2` | `#2A3852` | interactive borders, dashed drop zone |
| `--ink` | `#EEF2F8` | primary text |
| `--dim` | `#8A97AC` | body copy |
| `--dim2` | `#5B6880` | labels, metadata |
| `--red` | `#E10600` | GATE nodes, errors, primary gradient start |
| `--orange` | `#FF6A00` | active tool, focus ring, gradient end |
| `--amber` | `#FFB020` | CONCESSION nodes, warnings |
| `--green` | `#00C853` | EXIT nodes, success |
| `--blue` | `#4D8DF0` | WALKWAY nodes, edge cores |

Node fill colour is semantic, not decorative — it matches `VenueNode.Type` and the same
mapping is used in the live map. Don't recolour one without the other.

**Type scale**

| Role | Family | Size / weight |
|---|---|---|
| Page title | Big Shoulders Display | 2.2rem / 800, uppercase |
| Card heading | Big Shoulders Display | 0.85rem / 700, uppercase, 0.06em |
| Field label | Rajdhani | 10px / 600, 0.14em |
| Body | Inter | 0.82–0.92rem / 400, 1.5–1.6 line-height |
| Coordinates, counts, IDs | JetBrains Mono | 10–11px |

Radii: `16px` map + drop zone, `14px` cards, `11px` buttons, `9px` inputs, `8px` tool
buttons. Deliberately not uniform — size tracks surface hierarchy.

---

## 3. Layout

**Upload state** — single column, `max-width: 640px`, centred.

**Verify state** — `grid-template-columns: 1fr 20rem`, gap `1.25rem`,
`align-items: start`, `max-width: 1400px`.

- **Left**: SVG map, `viewBox = metadata.canvas`. Node `x`/`y` map 1:1 to viewBox units,
  so the uploaded plan underlays at the same scale with no transform maths. Keep it that
  way — introducing a scale factor here is how coordinate drift starts.
- **Right**: stacked cards, gap `0.9rem` — Checks → Repairs (collapsible) → Node
  inspector → Confirm.
- **Toolbar**: absolutely positioned inside the map, `top/left: 0.75rem`, `z-index: 2`,
  `backdrop-filter: blur(8px)`.

---

## 4. Component API

```ts
<LayoutStudio onConfirmed={(venue: VenueGraph) => void} />
```

| Prop | Type | Required | Notes |
|---|---|---|---|
| `onConfirmed` | `(venue) => void` | no | Fires only after the server returns `ready: true`. Hand the venue to `POST /venues` on Spring. |

Config: `VITE_AI_SERVICE_URL`, default `http://localhost:8000`.

**Internal state worth knowing about**

| State | Purpose |
|---|---|
| `result` | Full `ParseResponse`. Null → upload view. |
| `venue` | Working copy, mutated by edits. Never write back into `result`. |
| `tool` | `select` \| `add-node` \| `connect` \| `delete` |
| `confirmState` | Server verdict. **Reset to `null` on every edit** — a stale "ready" after a node move is the dangerous bug here. |

---

## 5. Interaction states

**Tools**

| Tool | Click empty canvas | Click node | Cursor |
|---|---|---|---|
| Select | deselect | select + drag | `grab` |
| Add node | new WALKWAY, capacity 400 | select | `crosshair` |
| Connect | — | 1st sets origin, 2nd creates edge | `pointer` |
| Delete | — | removes node + its edges | `not-allowed` |

Connect is two-step with a live hint ("Click the second node"). Clicking the origin
twice cancels. Duplicate edges are silently ignored, not errored — the operator's intent
is already satisfied.

**Node visual states**

| State | Treatment |
|---|---|
| Default | filled circle, `r` 11 (15 for GATE/EXIT), 3px `#05070B` stroke |
| Selected | white ring at `r + 9` |
| Connect origin | orange ring at `r + 9` |
| Orphan (degree 0) | red dashed ring at `r + 5` — always visible, no hover needed |

GATE and EXIT are drawn larger because they're the two the operator must verify.

**Buttons**: hover `translateY(-1px)` + border lighten; primary also `brightness(1.1)`.
Disabled `opacity: .45`, `cursor: not-allowed`. Focus ring is 3px `rgba(255,106,0,.14)`
plus an orange border.

---

## 6. Responsive

| Breakpoint | Behaviour |
|---|---|
| ≥ 1040px | Two columns as specified |
| < 1040px | Single column; map first, panel below at full width |

The SVG is fluid (`width: 100%; height: auto`), so the map never needs a media query.
`touch-action: none` on the SVG is required — without it, mobile drag pans the page
instead of moving the node.

---

## 7. Edge cases

| Case | Handling |
|---|---|
| Non-image file | Rejected client-side before upload with a specific message |
| >12MB | Server 413; message states actual and allowed size |
| AI service down | `Failed to fetch` is rewritten to name the URL and port |
| VLM unavailable | `metadata.degraded` → amber banner telling the operator to check every gate and exit |
| Unparseable plan | Sparse-graph warning; the map still renders so they can build it manually |
| Zero nodes | Confirm disabled |
| Isolated node | Red dashed ring + server auto-reconnect, reported in Repairs |
| Errors after confirm | `ready: false`, red block, simulation stays locked |
| Edit after a good confirm | `confirmState` cleared; must re-confirm |
| Expired `layout_id` | 404 explains layouts are in-memory and cleared on restart |
| Node dragged off-canvas | Clamped to `[0, canvas.width/height]` |

---

## 8. Animation

| Element | Spec |
|---|---|
| Spinner | 1s linear infinite |
| Collapsible | `grid-template-rows: 0fr → 1fr`, 300ms `cubic-bezier(.16,1,.3,1)` |
| Chevron | 300ms rotate 180° |
| Button hover | 150–200ms transform + border |
| Tool switch | 150ms background/colour |

The `0fr → 1fr` grid trick animates to auto height without measuring. Don't replace it
with a `max-height` hack.

All of it is disabled under `prefers-reduced-motion: reduce`, including button transforms.

---

## 9. Accessibility

- Drop zone is `role="button"`, `tabIndex={0}`, responds to Enter and Space.
- Tool buttons carry `aria-label` and `aria-pressed`.
- Collapsible carries `aria-expanded`.
- SVG is `role="img"` with a describing `aria-label`.
- Orphan and issue states are conveyed by shape and text, never colour alone.

**Known gap:** the map is pointer-only — nodes can't be selected or moved by keyboard.
For an operator tool that gates a safety simulation, that should be closed before
production. Suggested: make nodes focusable, arrow keys nudge by 1 (10 with Shift),
Enter selects, Delete removes.
