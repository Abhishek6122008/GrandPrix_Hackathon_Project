/**
 * The app's stylesheet, as one string injected at mount.
 *
 * A string rather than a .css file because it is written against the design tokens declared in
 * the same block and read top to bottom as one document — splitting it per component would
 * scatter a cascade that is deliberately ordered. Vite would happily bundle a .css import; what
 * it cannot do is keep the ordering obvious to whoever edits it next.
 */

export const STYLE = `
  :root{
    --cf-bg:#05070B; --cf-panel:#0B1018; --cf-card:#111826; --cf-card-hi:#182234;
    --cf-line:#1E2A3D; --cf-line2:#2A3852;
    --cf-ink:#EEF2F8; --cf-dim:#A8A39F; --cf-dim2:#8D8884;
    --cf-red:#E10600;
  /* Brand red is a fill colour. On a dark ground it only reaches 4.06:1 as text, so red
     type uses this lifted tint (4.50:1) while every fill, gradient and glow keeps the brand. */
  --cf-red-text:#FF3B35; --cf-orange:#FF6A00; --cf-amber:#FFB020;
    --cf-blue:#1B4FA8; --cf-blue-lo:#0C1B33; --cf-blue-hi:#4D8DF0;
    --cf-green:#00C853;
    /* Entrance/exit signage. Green in, violet out — the pairing reads at a glance and does not
       collide with the density ramp, which owns green→amber→orange→red. */
    --cf-violet:#A855F7;

    /* Elevation ramp. Shadows are tuned dark and wide rather than black and tight: on a
       near-black ground a tight shadow is invisible, so lift has to come from spread. */
    --cf-shadow-sm:0 2px 8px -2px rgba(0,0,0,.6);
    --cf-shadow-md:0 18px 46px -22px rgba(0,0,0,.78);
    --cf-shadow-lg:0 40px 90px -40px rgba(0,0,0,.9);
    --cf-glow-ember:0 0 0 1px rgba(255,106,0,.22), 0 18px 50px -24px rgba(225,6,0,.55);

    /* One easing for everything that moves, so the whole UI decelerates with the same hand. */
    --cf-ease:cubic-bezier(0.16,1,0.3,1);
  }
  .cf-root{ background:var(--cf-bg); color:var(--cf-ink); font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif; position:relative; min-height:100vh; }
  .cf-display{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; }
  .cf-accent{ font-family:'Rajdhani','JetBrains Mono',sans-serif; font-weight:600; letter-spacing:0.16em; }
  .cf-mono{ font-family:'JetBrains Mono','SFMono-Regular',Menlo,monospace; }

  .cf-panel{ background:var(--cf-panel); }
  .cf-card{ background:
      linear-gradient(160deg, rgba(255,244,236,.05) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(30,26,24,.68), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09); border-top-color:rgba(255,240,230,.15);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.06);
    backdrop-filter:blur(18px) saturate(130%); transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
  .cf-card-solid{ background:var(--cf-card); border:1px solid var(--cf-line); }
  .cf-lift:hover{ transform:translateY(-3px); border-color:var(--cf-line2); box-shadow:0 18px 46px -22px rgba(0,0,0,0.75); }
  .cf-hairline{ border-color:var(--cf-line); }
  .cf-dim{ color:var(--cf-dim); } .cf-dim2{ color:var(--cf-dim2); }
  .cf-red{ color:var(--cf-red-text); } .cf-orange{ color:var(--cf-orange); }
  .cf-amber{ color:var(--cf-amber); } .cf-green{ color:var(--cf-green); }
  .cf-blue-hi{ color:var(--cf-blue-hi); }
  .cf-bg-red{ background:var(--cf-red); }

  /* Mesh gradient field — fixed, soft, slow. The "lovable-style" backdrop. */
  .cf-mesh{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
  .cf-mesh span{ position:absolute; border-radius:9999px; filter:blur(90px); opacity:.5; will-change:transform; }
  .cf-mesh .m1{ width:52vw; height:52vw; left:-12vw; top:-14vw; background:radial-gradient(circle, rgba(225,6,0,0.55), transparent 68%); animation:cf-drift1 26s ease-in-out infinite alternate; }
  .cf-mesh .m2{ width:46vw; height:46vw; right:-10vw; top:4vh; background:radial-gradient(circle, rgba(255,106,0,0.42), transparent 68%); animation:cf-drift2 32s ease-in-out infinite alternate; }
  .cf-mesh .m3{ width:60vw; height:60vw; left:10vw; top:38vh; background:radial-gradient(circle, rgba(27,79,168,0.55), transparent 70%); animation:cf-drift3 38s ease-in-out infinite alternate; }
  .cf-mesh .m4{ width:38vw; height:38vw; right:6vw; top:62vh; background:radial-gradient(circle, rgba(77,141,240,0.28), transparent 70%); animation:cf-drift1 30s ease-in-out infinite alternate-reverse; }
  /* Paper Shaders grain gradient. Sits directly above the CSS mesh and below the veil, so it
     replaces the mesh visually once it loads without either layer having to know about the
     other. Fades in because the shader chunk arrives after first paint and a hard swap of the
     whole page backdrop reads as a flash. */
  .cf-shader{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden;
    opacity:0; animation:cf-shader-in 1.2s var(--cf-ease) forwards; }
  @keyframes cf-shader-in{ to{ opacity:1; } }

  /* The veil that keeps body copy readable over the backdrop.
     Tuned against the shader, not the old CSS mesh: at the previous 0.55→0.94 ramp it was
     near-opaque black by mid-page and the gradient underneath simply could not be seen. It
     now stays light enough for the field to read through, and the pages that need the most
     protection get it from their own card surfaces instead. */
  .cf-mesh-veil{ position:fixed; inset:0; z-index:0; pointer-events:none;
    background:linear-gradient(180deg, rgba(5,7,11,0.46) 0%, rgba(5,7,11,0.62) 45%, rgba(5,7,11,0.74) 100%); }

  /* With the veil lightened, long-form text needs its own local protection so it never sits
     directly on a bright band of the gradient. Applied to page roots that are mostly prose. */
  .cf-readable{ position:relative; }
  .cf-readable::before{ content:''; position:absolute; inset:0; z-index:-1; pointer-events:none;
    background:radial-gradient(120% 60% at 50% 0%, rgba(5,7,11,.55), rgba(5,7,11,.82) 70%); }

  @keyframes cf-drift1{ from{ transform:translate3d(0,0,0) scale(1); } to{ transform:translate3d(6vw,7vh,0) scale(1.12); } }
  @keyframes cf-drift2{ from{ transform:translate3d(0,0,0) scale(1.05); } to{ transform:translate3d(-7vw,5vh,0) scale(.92); } }
  @keyframes cf-drift3{ from{ transform:translate3d(0,0,0) scale(.95); } to{ transform:translate3d(5vw,-8vh,0) scale(1.1); } }

  .cf-grain{ position:fixed; inset:0; z-index:1; pointer-events:none; opacity:.045; mix-blend-mode:overlay; }

  .cf-btn-primary{ background:linear-gradient(100deg, var(--cf-red), var(--cf-orange)); color:#fff; transition:filter .2s ease, transform .2s ease; box-shadow:0 8px 24px -12px rgba(225,6,0,.9); }
  .cf-btn-primary:hover{ filter:brightness(1.1); transform:translateY(-1px); }
  .cf-btn-outline{ border:1px solid var(--cf-line2); color:var(--cf-ink); background:rgba(17,24,38,0.5); transition:all .2s ease; }
  .cf-btn-outline:hover{ border-color:var(--cf-dim); background:var(--cf-card-hi); }
  .cf-btn-ghost{ color:var(--cf-dim); transition:color .2s ease; }
  .cf-btn-ghost:hover{ color:var(--cf-ink); }
  .cf-focus:focus-visible{ outline:2px solid var(--cf-orange); outline-offset:2px; }

  .cf-input{ background:rgba(5,7,11,0.6); border:1px solid var(--cf-line); color:var(--cf-ink); transition:border-color .2s ease, box-shadow .2s ease; }
  .cf-input:focus{ outline:none; border-color:var(--cf-orange); box-shadow:0 0 0 3px rgba(255,106,0,.14); }

  /* --- Portal identity ------------------------------------------------------
     The three portals are one product but not one job: an attendee stuck in a
     queue, an organiser running the event from a desk, and platform operations
     watching every venue at once. Marketing already gives each a colour; inside
     the portal that colour only reached a badge in the corner, so all three read
     as the same screen with different words on it.

     Declaring the accent once per portal and having the shared controls read it
     from a variable moves the whole surface instead: primary action, focus ring,
     field focus and rails all shift together. One mechanism, three rooms — and
     the focus ring now matches the portal a keyboard user is actually in. */
     --portal-accent is the identity: focus rings, field focus, rails. It stays vivid,
     because none of those carry text on top of them.

     --portal-cta is the lit end of the primary button's gradient, and it is a shade deeper
     on purpose. The button's label is white, and white on the vivid accent lands at
     2.9-3.5:1 — under AA on the one control the whole portal is pointing at. These values
     are the least darkening that clears 4.5:1, so the button stays the portal's colour and
     the label stays readable. Scoped to portals only: the marketing CTA is the brand's own
     racing orange and is not this file's call to dull. */
  [data-portal]{ --portal-accent:var(--cf-orange); --portal-accent-deep:var(--cf-red);
    --portal-cta:#C75300; --portal-glow:rgba(255,106,0,.85); --portal-ring:rgba(255,106,0,.16); }
  [data-portal="walker"]{ --portal-accent:var(--cf-blue-hi); --portal-accent-deep:var(--cf-blue);
    --portal-cta:#2271EC; --portal-glow:rgba(77,141,240,.85); --portal-ring:rgba(77,141,240,.20); }
  [data-portal="client"]{ --portal-accent:var(--cf-orange); --portal-accent-deep:var(--cf-red);
    --portal-cta:#C75300; --portal-glow:rgba(255,106,0,.85); --portal-ring:rgba(255,106,0,.16); }
  [data-portal="admin"]{ --portal-accent:var(--cf-red-text); --portal-accent-deep:#8E1512;
    --portal-cta:#EE0700; --portal-glow:rgba(255,59,53,.8); --portal-ring:rgba(255,59,53,.18); }

  [data-portal] .cf-btn-primary{
    background:linear-gradient(100deg, var(--portal-accent-deep), var(--portal-cta));
    box-shadow:0 8px 24px -12px var(--portal-glow); }
  [data-portal] .cf-focus:focus-visible{ outline-color:var(--portal-accent); }
  [data-portal] .cf-input:focus{ border-color:var(--portal-accent); box-shadow:0 0 0 3px var(--portal-ring); }
  .cf-input::placeholder{ color:var(--cf-dim2); }

  .cf-chip{ background:rgba(255,255,255,0.04); border:1px solid var(--cf-line); }

  @keyframes cf-marquee{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
  .cf-marquee-track{ animation:cf-marquee 30s linear infinite; }
  @keyframes cf-dash{ to{ stroke-dashoffset:-40; } }
  .cf-dash{ stroke-dasharray:6 6; animation:cf-dash 1.1s linear infinite; }
  @keyframes cf-flow{ to{ stroke-dashoffset:-24; } }
  .cf-flow{ stroke-dasharray:4 8; animation:cf-flow 1.4s linear infinite; }
  @keyframes cf-bounce{ 0%,100%{ transform:translateY(0); opacity:.6; } 50%{ transform:translateY(6px); opacity:1; } }
  .cf-bounce{ animation:cf-bounce 2s ease-in-out infinite; }
  @keyframes cf-ping{ 0%{ transform:scale(.5); opacity:.85; } 100%{ transform:scale(2.8); opacity:0; } }
  .cf-ping{ animation:cf-ping 2.4s cubic-bezier(0,0,.2,1) infinite; transform-origin:center; }
  @keyframes cf-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
  .cf-pulse{ animation:cf-pulse 1.8s ease-in-out infinite; }

  .cf-reveal{ opacity:0; transform:translateY(22px); transition:opacity .7s cubic-bezier(0.16,1,0.3,1), transform .7s cubic-bezier(0.16,1,0.3,1); }
  .cf-reveal.cf-in{ opacity:1; transform:translateY(0); }

  /* Page entrance is owned by the <AnimatePresence> around <main>, not by CSS.
     This rule used to run its own opacity+translateY keyframe on each page root; with
     both animating the same two properties on nested elements, a route change played
     the fade twice and the second one started before the first had finished, which read
     as a stutter. The class is left defined — it is still on every page root — so it
     stays a valid hook without competing for the same properties. */
  .cf-page-in{ animation:none; }

  .cf-nav-link{ position:relative; }
  .cf-nav-link::after{ content:''; position:absolute; left:0; right:0; bottom:-7px; height:2px; border-radius:2px;
    background:linear-gradient(90deg, var(--cf-red), var(--cf-orange)); transform:scaleX(0); transform-origin:left;
    transition:transform .3s cubic-bezier(0.16,1,0.3,1); }
  .cf-nav-link:hover::after, .cf-nav-link[data-active="true"]::after{ transform:scaleX(1); }

  .cf-map-grab{ cursor:grab; } .cf-map-grab:active{ cursor:grabbing; }

  /* ------------------------------------------------------------------ *
   * Spotlight surfaces
   *
   * The cursor position is written to --mx/--my as percentages by JS (see <Spotlight>),
   * and every layer below reads them. Keeping the values on the element as custom
   * properties means the pointer handler only ever touches style properties that are
   * composited — no React re-render per mousemove.
   * ------------------------------------------------------------------ */
  .cf-spot{ position:relative; isolation:isolate; }
  .cf-spot::before{
    content:''; position:absolute; inset:-1px; border-radius:inherit; z-index:0; pointer-events:none;
    opacity:0; transition:opacity .4s var(--cf-ease);
    background:radial-gradient(340px circle at var(--mx,50%) var(--my,50%),
      color-mix(in oklab, var(--cf-spot-color, var(--cf-orange)) 20%, transparent), transparent 62%);
  }
  .cf-spot:hover::before, .cf-spot:focus-within::before{ opacity:1; }
  .cf-spot > *{ position:relative; z-index:1; }

  /* The hairline that lights up on hover. A masked gradient border: the ::after paints a
     radial highlight and the mask punches out everything but a 1px rim. */
  .cf-spot-edge::after{
    content:''; position:absolute; inset:0; border-radius:inherit; z-index:0; pointer-events:none;
    padding:1px; opacity:0; transition:opacity .4s var(--cf-ease);
    background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),
      var(--cf-spot-color, var(--cf-orange)), transparent 60%);
    -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite:xor; mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite:exclude;
  }
  .cf-spot-edge:hover::after, .cf-spot-edge:focus-within::after{ opacity:.85; }

  /* Bento tiles: same card material, but lift is scale-free so tall and short tiles in the
     same grid rise by the same number of pixels and the row does not visually shear. */
  /* Opacity is deliberately high: these sit over the shader backdrop, and at the ~0.75 that
     suited the old CSS mesh a bright band of the gradient showed straight through and the
     card stopped reading as a surface at all. */
  /* Card material.
   *
   * Three things do the work here, and they are the pattern every dark-first product UI
   * (Linear, Vercel, and most current Awwwards dark sites) converges on:
   *
   *  1. a directional fill — lighter at the top-left, darker at the bottom-right — which
   *     implies a light source instead of reading as a flat swatch;
   *  2. a 1px edge that is brighter along the top than the bottom, so the card has an
   *     apparent thickness rather than a drawn outline;
   *  3. an inset top highlight, the specular line real glass catches at its lip.
   *
   * Depth comes from luminance, not from a drop shadow — a shadow on a near-black ground is
   * invisible anyway, which is why the old flat-fill-plus-outline version looked like a box.
   */
  .cf-bento{ position:relative; isolation:isolate; border-radius:1rem;
    background:
      linear-gradient(160deg, rgba(255,244,236,.055) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(34,29,27,.66), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09);
    border-top-color:rgba(255,240,230,.16);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.07), 0 10px 30px -18px rgba(0,0,0,.9);
    backdrop-filter:blur(18px) saturate(130%);
    transition:transform .35s var(--cf-ease), border-color .35s var(--cf-ease), box-shadow .35s var(--cf-ease); }
  .cf-bento:hover{ transform:translateY(-4px);
    border-color:rgba(255,224,206,.18); border-top-color:rgba(255,232,216,.28);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.12), var(--cf-shadow-lg); }

  /* Conic aurora used behind hero art and feature tiles. */
  @keyframes cf-spin{ to{ transform:rotate(1turn); } }
  .cf-aurora{ position:absolute; inset:-40%; pointer-events:none; opacity:.5; filter:blur(52px);
    background:conic-gradient(from 0deg, transparent 0deg, rgba(225,6,0,.5) 60deg,
      transparent 140deg, rgba(77,141,240,.45) 220deg, transparent 300deg, rgba(255,106,0,.5) 350deg, transparent 360deg);
    animation:cf-spin 22s linear infinite; }

  /* Ticker/edge fades — a marquee that hard-cuts at the container edge reads as clipped;
     fading it to the page ground makes it read as continuing past the viewport. The fade
     needs real width (15%) to land: at a few percent of a wide track the ramp is only a
     handful of pixels and still reads as a hard cut. */
  .cf-edge-fade{
    -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 15%, #000 85%, transparent 100%);
    mask-image:linear-gradient(90deg, transparent 0%, #000 15%, #000 85%, transparent 100%);
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-size:100% 100%; mask-size:100% 100%; }

  /* Sweep of light across a surface on hover — used on primary CTAs. */
  .cf-shine{ position:relative; overflow:hidden; }
  .cf-shine::after{ content:''; position:absolute; top:0; bottom:0; left:-60%; width:40%;
    background:linear-gradient(100deg, transparent, rgba(255,255,255,.28), transparent);
    /* Travels on transform, not on the 'left' property.
       Animating 'left' relayouts the button on every frame of the sweep, off the compositor
       and on the main thread — the same thread ticking the simulation and painting the live
       map. translateX runs on the compositor and cannot touch layout at all.
       450% because the sweep must cross 180% of the button while the element is 40% of it. */
    transform:translateX(0) skewX(-18deg); transition:transform .65s var(--cf-ease);
    will-change:transform; pointer-events:none; }
  .cf-shine:hover::after{ transform:translateX(450%) skewX(-18deg); }

  /* Scroll progress rail under the header. */
  .cf-progress{ position:fixed; top:0; left:0; height:2px; z-index:60; transform-origin:0 50%;
    background:linear-gradient(90deg, var(--cf-red), var(--cf-orange), var(--cf-blue-hi)); }

  /* Tubelight nav indicator: a bar above the active item plus stacked blurs for the bloom. */
  .cf-lamp{ position:absolute; left:50%; transform:translateX(-50%); top:-11px; width:26px; height:3px;
    border-radius:0 0 3px 3px; background:linear-gradient(90deg, var(--cf-red), var(--cf-orange)); }
  .cf-lamp span{ position:absolute; border-radius:9999px; background:rgba(255,106,0,.32); }
  .cf-lamp .l1{ inset:-9px -12px auto -12px; height:22px; filter:blur(11px); }
  .cf-lamp .l2{ inset:-5px -4px auto -4px; height:16px; filter:blur(7px); }

  /* ------------------------------------------------------------------ *
   * Core header treatment
   *
   * The diagonal grid-fade signature: a 32px rule grid masked to a radial ellipse anchored
   * at the top-left, so it is crisp at the wordmark and gone by the middle of the bar. The
   * source used --muted; here the lines are drawn in the app's own hairline colour.
   * ------------------------------------------------------------------ */
  .cf-gridfade{ position:absolute; inset:0; z-index:0; pointer-events:none;
    background-image:linear-gradient(to right, var(--cf-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--cf-line) 1px, transparent 1px);
    background-size:32px 32px;
    -webkit-mask-image:radial-gradient(ellipse 80% 80% at 0% 0%, #000 50%, transparent 90%);
    mask-image:radial-gradient(ellipse 80% 80% at 0% 0%, #000 50%, transparent 90%); }

  /* Filter strip. Hard-bordered cells rather than pills — the divider between items is what
     makes it read as a strip of segments instead of a row of buttons. */
  .cf-strip{ display:flex; flex:1; overflow-x:auto; scroll-behavior:smooth;
    scrollbar-width:none; -ms-overflow-style:none; }
  .cf-strip::-webkit-scrollbar{ display:none; }
  .cf-strip-item{ position:relative; display:flex; align-items:center; justify-content:center;
    flex-shrink:0; min-width:fit-content; cursor:pointer; white-space:nowrap;
    padding:0.75rem 1.75rem; font-size:0.65rem; font-weight:800; text-transform:uppercase;
    letter-spacing:0.16em; border-right:1px solid var(--cf-line); color:var(--cf-dim2);
    transition:background-color .25s var(--cf-ease), color .25s var(--cf-ease); }
  @media (min-width:768px){ .cf-strip-item{ font-size:0.72rem; } }
  /* No divider after the final segment — a trailing rule reads as a cell with nothing in it. */
  .cf-strip-item:last-child{ border-right:0; }
  .cf-strip-item:hover{ background:rgba(255,255,255,0.04); color:var(--cf-ink); }
  .cf-strip-item[data-active="true"]{ color:var(--cf-ink); background:rgba(255,255,255,0.05); }

  /* Role card: art bay on top, copy in the middle, action bar pinned to the floor. */
  .cf-rolecard{ position:relative; isolation:isolate; overflow:hidden; border-radius:1rem;
    background:
      linear-gradient(160deg, rgba(255,244,236,.055) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(34,29,27,.66), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09); border-top-color:rgba(255,240,230,.16);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.07), 0 10px 30px -18px rgba(0,0,0,.9);
    backdrop-filter:blur(18px) saturate(130%);
    transition:transform .35s var(--cf-ease), border-color .35s var(--cf-ease), box-shadow .35s var(--cf-ease); }
  .cf-rolecard:hover{ transform:translateY(-5px);
    border-color:rgba(255,224,206,.18); border-top-color:rgba(255,232,216,.30);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.12), var(--cf-shadow-lg); }

  .cf-rolecard-art{ position:relative; display:block; height:8.5rem; padding:1rem 1.25rem 0;
    border-bottom:1px solid rgba(255,238,228,.07); overflow:hidden; }
  /* Accent bleeds up from the floor of the bay, so colour arrives as light. */
  .cf-rolecard-glow{ position:absolute; inset:auto -20% -60% -20%; height:130%;
    background:radial-gradient(60% 100% at 50% 100%, color-mix(in oklab, var(--accent) 30%, transparent), transparent 72%);
    opacity:.5; transition:opacity .4s var(--cf-ease); pointer-events:none; }
  .cf-rolecard:hover .cf-rolecard-glow{ opacity:.85; }
  .cf-rolecard-art svg{ position:relative; z-index:1; }

  .cf-rolecard-index{ position:absolute; top:.35rem; right:.85rem; z-index:2;
    font-weight:900; font-size:2.75rem; line-height:1; letter-spacing:-.02em;
    color:transparent; -webkit-text-stroke:1px rgba(255,240,230,.16); user-select:none; }
  .cf-rolecard:hover .cf-rolecard-index{ -webkit-text-stroke-color:color-mix(in oklab, var(--accent) 45%, transparent); }

  .cf-rolecard-foot{ display:flex; align-items:center; justify-content:space-between;
    padding:.85rem 1.5rem; border-top:1px solid rgba(255,238,228,.07);
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 7%, transparent));
    transition:background .35s var(--cf-ease); }
  .cf-rolecard:hover .cf-rolecard-foot{
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 16%, transparent)); }

  /* Stat band. Shares the card material so it belongs to the same system, with 1px inner
     rules between cells rather than an opaque plate behind them. */
  .cf-statband{
    background:
      linear-gradient(160deg, rgba(255,244,236,.045) 0%, rgba(255,244,236,0) 45%),
      linear-gradient(168deg, rgba(30,26,24,.55), rgba(17,15,14,.66));
    border:1px solid rgba(255,238,228,.08); border-top-color:rgba(255,240,230,.14);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.06);
    backdrop-filter:blur(18px) saturate(130%); }
  .cf-statcell{ border-right:1px solid rgba(255,238,228,.07); }
  .cf-statcell:last-child{ border-right:0; }
  @media (max-width:767px){
    .cf-statcell:nth-child(2n){ border-right:0; }
    .cf-statcell:nth-child(-n+2){ border-bottom:1px solid rgba(255,238,228,.07); }
  }

  /* Section divider that fades out at both ends instead of butting into the gutter. */
  .cf-rule{ height:1px; border:0;
    background:linear-gradient(90deg, transparent, var(--cf-line2), transparent); }

  /* Numeric labels that should not reflow as digits change (counters, clocks). */
  .cf-tnum{ font-variant-numeric:tabular-nums; }

  @keyframes cf-float{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-9px); } }
  .cf-float{ animation:cf-float 6s ease-in-out infinite; }

  @keyframes cf-sweep{ 0%{ transform:translateX(-100%); } 100%{ transform:translateX(300%); } }
  .cf-sweep{ animation:cf-sweep 3.2s var(--cf-ease) infinite; }

  @media (prefers-reduced-motion: reduce){
    .cf-mesh span{ animation:none !important; }
    .cf-marquee-track,.cf-dash,.cf-flow,.cf-bounce,.cf-ping,.cf-pulse{ animation:none !important; }
    .cf-reveal{ opacity:1 !important; transform:none !important; transition:none !important; }
    .cf-aurora,.cf-float,.cf-sweep{ animation:none !important; }
    .cf-shader{ animation:none !important; opacity:1; }
    .cf-shine::after{ display:none; }
    .cf-bento:hover{ transform:none; }
  }
`;

/* ============================================================================
   Venue model + geometry
   ========================================================================== */

/**
 * Everything drawn on a map now comes from the backend — see src/venueAdapter.js, which turns
 * the venue *graph* the API serves into the polygons this file draws. There is deliberately no
 * fallback venue here: a map with invented crowd on it is worse than an empty state, because
 * nothing on screen tells you which one you are looking at.
 */

