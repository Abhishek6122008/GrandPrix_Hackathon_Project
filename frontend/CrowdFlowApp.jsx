import React, {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { api } from "./src/api.js";
import { useCrowdFlow } from "./src/useCrowdFlow.js";
import { toMapVenue } from "./src/venueAdapter.js";
import sampleVenue from "./src/sampleVenue.json";
import {
  DoorOpen, Footprints, UtensilsCrossed, Armchair, LogOut, TrendingUp,
  TrendingDown, Minus, Flag, Radio, Zap, AlertTriangle, ChevronLeft,
  ChevronRight, ChevronDown, MoveRight, Menu, X, Users, Activity, Cpu,
  Network, Gauge, Layers, ShieldCheck, Boxes, GitBranch, Check, Plus,
  MapPin, Navigation, Crosshair, Upload, Building2, UserCog, Ticket,
  Plus as PlusIcon, Minus as MinusIcon, Locate, Search, Bell, Trash2,
  Eye, Lock, Mail, ArrowRight, Wifi, WifiOff, Droplets, Coffee,
} from "lucide-react";

/* ============================================================================
   GradientShimmer — supplied component, ported TSX → JS, logic unchanged.
   ========================================================================== */

export const gradientPresets = {
  sunrise: [
    { color: "#B6D3EF", position: 0 }, { color: "#CAD1D7", position: 0.153 },
    { color: "#D7CFC8", position: 0.252 }, { color: "#E1CDB9", position: 0.341 },
    { color: "#EAC6A5", position: 0.424 }, { color: "#EDB185", position: 0.505 },
    { color: "#EF9B62", position: 0.586 }, { color: "#F18F60", position: 0.669 },
    { color: "#F48D7A", position: 0.758 }, { color: "#F78A94", position: 0.857 },
    { color: "#F888A0", position: 1 },
  ],
  ember: [
    { color: "#FFD9A0", position: 0 }, { color: "#FFAE4D", position: 0.28 },
    { color: "#FF6A00", position: 0.55 }, { color: "#E10600", position: 0.8 },
    { color: "#8E1B4A", position: 1 },
  ],
  bay: [
    { color: "#DBE3D0", position: 0 }, { color: "#8DB8A7", position: 0.23 },
    { color: "#2D8E9A", position: 0.42 }, { color: "#076492", position: 0.59 },
    { color: "#154288", position: 0.79 }, { color: "#262C81", position: 1 },
  ],
};

export const easingPresets = {
  smooth: "cubic-bezier(0.45, 0, 0.55, 1)",
  gentle: "cubic-bezier(0.76, 0, 0.24, 1)",
  snappy: "cubic-bezier(0.3, 0, 0.2, 1)",
};

const BAND_CORE_RATIO = 0.44;

export function buildBandGradient(stops, angle) {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0]?.color ?? "white";
  const last = sorted[sorted.length - 1]?.color ?? "white";
  const core = sorted.map((s) => {
    const f = (s.position - 0.5) * 2 * BAND_CORE_RATIO;
    return `${s.color} calc(50% + var(--gs-spread-mid) * ${f.toFixed(4)})`;
  }).join(", ");
  return [
    `linear-gradient(${angle}deg`,
    `var(--gs-base) calc(50% - var(--gs-spread))`,
    `color-mix(in oklab, var(--gs-base) 42%, ${first}) calc(50% - var(--gs-spread-mid))`,
    core,
    `color-mix(in oklab, var(--gs-base) 42%, ${last}) calc(50% + var(--gs-spread-mid))`,
    `var(--gs-base) calc(50% + var(--gs-spread)))`,
  ].join(", ");
}

const supportsClip = () => typeof window === "undefined" ? true :
  typeof window.CSS?.supports === "function" &&
  (window.CSS.supports("background-clip", "text") || window.CSS.supports("-webkit-background-clip", "text"));

const reducedNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function observeShimmerActive(el, { pauseOnScroll, pauseWhenOffscreen }, onChange) {
  if (typeof window === "undefined") return () => {};
  let inViewport = !pauseWhenOffscreen || typeof IntersectionObserver === "undefined";
  let pageVisible = typeof document === "undefined" ? true : !document.hidden;
  let notScrolling = true;
  const compute = () => onChange(inViewport && pageVisible && notScrolling);
  let io;
  if (pauseWhenOffscreen && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((es) => {
      const e = es[es.length - 1]; if (!e) return;
      inViewport = e.isIntersecting; compute();
    }, { rootMargin: "160px" });
    io.observe(el);
  }
  const onVis = () => { pageVisible = !document.hidden; compute(); };
  document.addEventListener("visibilitychange", onVis);
  let timer;
  const onScroll = () => {
    notScrolling = false; compute();
    clearTimeout(timer);
    timer = setTimeout(() => { notScrolling = true; compute(); }, 120);
  };
  if (pauseOnScroll) window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  compute();
  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    if (pauseOnScroll) window.removeEventListener("scroll", onScroll, { capture: true });
    clearTimeout(timer);
  };
}

const MAX_SPREAD_PX = 48, SPREAD_MID_RATIO = 0.72, BASE_FONT_PX = 14;

export function GradientShimmer({
  children, gradient, easing = "smooth", duration = 1.45, spread = 3, angle = 105,
  pauseBetween = 1000, baseColor = "currentColor", pauseOnScroll = true,
  pauseWhenOffscreen = true, respectReducedMotion = true, as = "span", className, style, ...rest
}) {
  const ref = useRef(null);
  const stops = useMemo(() => (typeof gradient === "string" ? gradientPresets[gradient] ?? gradientPresets.sunrise : gradient ?? gradientPresets.sunrise), [gradient]);
  const backgroundImage = useMemo(() => buildBandGradient(stops, angle), [stops, angle]);
  const easingValue = easingPresets[easing] ?? easingPresets.smooth;
  const initialSpread = Math.min(children.length * spread, MAX_SPREAD_PX);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width || 96;
      const fs = Number.parseFloat(getComputedStyle(el).fontSize) || BASE_FONT_PX;
      const scale = fs / BASE_FONT_PX;
      const spreadPx = Math.min(children.length * spread * scale, MAX_SPREAD_PX * scale);
      const layerW = Math.max(1, w + spreadPx * 2);
      el.style.setProperty("--gs-spread", `${spreadPx}px`);
      el.style.setProperty("--gs-spread-mid", `${spreadPx * SPREAD_MID_RATIO}px`);
      el.style.backgroundSize = `${layerW}px 100%`;
      return { start: -spreadPx - layerW / 2, end: w + spreadPx - layerW / 2, durationMs: duration * 1000 };
    };
    if (!supportsClip()) {
      el.style.removeProperty("background-image");
      el.style.removeProperty("-webkit-text-fill-color");
      return;
    }
    measure();
    if (respectReducedMotion && reducedNow()) return;
    if (typeof el.animate !== "function") return;

    let anim = null, timer, active = true, cancelled = false;
    const run = () => {
      if (cancelled) return;
      const { start, end, durationMs } = measure();
      const next = el.animate(
        [{ backgroundPosition: `${start}px center` }, { backgroundPosition: `${end}px center` }],
        { duration: durationMs, easing: easingValue, fill: "forwards" });
      if (!active) next.pause();
      anim?.cancel(); anim = next;
      next.onfinish = () => { timer = setTimeout(run, Math.max(0, pauseBetween)); };
    };
    const stop = observeShimmerActive(el, { pauseOnScroll, pauseWhenOffscreen }, (n) => {
      active = n; if (anim) { if (active) anim.play(); else anim.pause(); }
    });
    run();
    return () => { cancelled = true; anim?.cancel(); clearTimeout(timer); stop(); };
  }, [children, spread, duration, easingValue, pauseBetween, pauseOnScroll, pauseWhenOffscreen, respectReducedMotion]);

  return createElement(as, {
    ...rest, ref, className,
    style: {
      position: "relative", display: "inline-block", backgroundImage,
      backgroundRepeat: "no-repeat", backgroundSize: "100% 100%",
      backgroundColor: "var(--gs-base)", WebkitBackgroundClip: "text",
      backgroundClip: "text", WebkitTextFillColor: "transparent",
      "--gs-base": baseColor, "--gs-spread": `${initialSpread}px`,
      "--gs-spread-mid": `${initialSpread * SPREAD_MID_RATIO}px`, ...style,
    },
  }, children);
}

/* ============================================================================
   Design tokens — red / orange / deep blue on near-black, with the soft
   mesh-gradient field the modern SaaS sites use.
   ========================================================================== */

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700;800;900&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  :root{
    --cf-bg:#05070B; --cf-panel:#0B1018; --cf-card:#111826; --cf-card-hi:#182234;
    --cf-line:#1E2A3D; --cf-line2:#2A3852;
    --cf-ink:#EEF2F8; --cf-dim:#8A97AC; --cf-dim2:#5B6880;
    --cf-red:#E10600; --cf-orange:#FF6A00; --cf-amber:#FFB020;
    --cf-blue:#1B4FA8; --cf-blue-lo:#0C1B33; --cf-blue-hi:#4D8DF0;
    --cf-green:#00C853;
  }
  .cf-root{ background:var(--cf-bg); color:var(--cf-ink); font-family:'Inter',system-ui,sans-serif; position:relative; min-height:100vh; }
  .cf-display{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; }
  .cf-accent{ font-family:'Rajdhani','JetBrains Mono',sans-serif; font-weight:600; letter-spacing:0.16em; }
  .cf-mono{ font-family:'JetBrains Mono','SFMono-Regular',Menlo,monospace; }

  .cf-panel{ background:var(--cf-panel); }
  .cf-card{ background:rgba(17,24,38,0.72); border:1px solid var(--cf-line); backdrop-filter:blur(10px); transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
  .cf-card-solid{ background:var(--cf-card); border:1px solid var(--cf-line); }
  .cf-lift:hover{ transform:translateY(-3px); border-color:var(--cf-line2); box-shadow:0 18px 46px -22px rgba(0,0,0,0.75); }
  .cf-hairline{ border-color:var(--cf-line); }
  .cf-dim{ color:var(--cf-dim); } .cf-dim2{ color:var(--cf-dim2); }
  .cf-red{ color:var(--cf-red); } .cf-orange{ color:var(--cf-orange); }
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
  .cf-mesh-veil{ position:fixed; inset:0; z-index:0; pointer-events:none;
    background:linear-gradient(180deg, rgba(5,7,11,0.55) 0%, rgba(5,7,11,0.82) 45%, rgba(5,7,11,0.94) 100%); }

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
  @keyframes cf-page-in{ from{ opacity:0; transform:translateY(14px); } to{ opacity:1; transform:translateY(0); } }
  .cf-page-in{ animation:cf-page-in .45s cubic-bezier(0.16,1,0.3,1) both; }

  .cf-nav-link{ position:relative; }
  .cf-nav-link::after{ content:''; position:absolute; left:0; right:0; bottom:-7px; height:2px; border-radius:2px;
    background:linear-gradient(90deg, var(--cf-red), var(--cf-orange)); transform:scaleX(0); transform-origin:left;
    transition:transform .3s cubic-bezier(0.16,1,0.3,1); }
  .cf-nav-link:hover::after, .cf-nav-link[data-active="true"]::after{ transform:scaleX(1); }

  .cf-map-grab{ cursor:grab; } .cf-map-grab:active{ cursor:grabbing; }

  @media (prefers-reduced-motion: reduce){
    .cf-mesh span{ animation:none !important; }
    .cf-marquee-track,.cf-dash,.cf-flow,.cf-bounce,.cf-ping,.cf-pulse{ animation:none !important; }
    .cf-reveal{ opacity:1 !important; transform:none !important; transition:none !important; }
    .cf-page-in{ animation:none !important; }
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

const POI_ICON = { water: Droplets, wc: DoorOpen, cafe: Coffee };

/** Backend Session.Status -> the wording and colour used across the portals. */
const SESSION_STATUS_META = {
  RUNNING: { c: "var(--cf-green)", l: "LIVE" },
  PAUSED: { c: "var(--cf-amber)", l: "PAUSED" },
  CREATED: { c: "var(--cf-dim)", l: "READY" },
  STOPPED: { c: "var(--cf-dim2)", l: "STOPPED" },
  COMPLETED: { c: "var(--cf-blue-hi)", l: "COMPLETE" },
};

/** A small live/offline pill. Every portal shows one, so the socket state is never a mystery. */
function ConnectionPill({ connected, status }) {
  const meta = SESSION_STATUS_META[status] ?? SESSION_STATUS_META.CREATED;
  return (
    <span className="inline-flex items-center gap-1.5 cf-mono text-[10px] px-2 py-1 rounded cf-chip">
      {connected ? (
        <Wifi className="w-3 h-3" style={{ color: meta.c }} />
      ) : (
        <WifiOff className="w-3 h-3 cf-dim2" />
      )}
      <span style={{ color: connected ? meta.c : "var(--cf-dim2)" }}>
        {connected ? meta.l : "OFFLINE"}
      </span>
    </span>
  );
}

/** Shown wherever a portal needs a session and does not have one yet. */
function NeedsSession({ title, lede, children }) {
  return (
    <div className="cf-card rounded-2xl p-8 max-w-lg">
      <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(77,141,240,0.16)" }}>
        <Radio className="w-6 h-6 cf-blue-hi" strokeWidth={2} />
      </span>
      <h2 className="cf-display font-black uppercase text-2xl tracking-tight mb-2">{title}</h2>
      <p className="text-sm cf-dim leading-relaxed mb-6">{lede}</p>
      {children}
    </div>
  );
}

/** Surfaces an API/socket failure without pretending the data is fine. */
function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="cf-card rounded-xl px-4 py-3 flex items-start gap-2.5" style={{ borderColor: "rgba(225,6,0,.4)" }}>
      <AlertTriangle className="w-4 h-4 cf-red shrink-0 mt-0.5" strokeWidth={2} />
      <p className="text-sm cf-dim leading-relaxed">{error}</p>
    </div>
  );
}

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

const densityColor = (d) =>
  d > 0.85 ? "var(--cf-red)" : d > 0.7 ? "var(--cf-orange)" : d > 0.5 ? "var(--cf-amber)" : "var(--cf-green)";

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

function VenueMap({
  venue, people = [], me = null, route = null, showDensity = true,
  showPeople = true, showPois = true, underlay = null, underlayOpacity = 0.25,
  height = 460, onSelectHall = null, selectedHall = null,
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const wrapRef = useRef(null);

  const clampZoom = (z) => Math.max(0.7, Math.min(3.2, z));

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const scale = rect ? 100 / rect.width : 0.2;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.sx) * scale,
      y: drag.current.py + (e.clientY - drag.current.sy) * scale,
    });
  };
  const onPointerUp = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const recenter = () => { setPan({ x: 0, y: 0 }); setZoom(1); };

  const vb = 100 / zoom;
  const cx = 50 - pan.x, cy = 50 - pan.y;
  const viewBox = `${cx - vb / 2} ${cy - vb / 2} ${vb} ${vb}`;
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
        </defs>

        {/* base */}
        <rect x="-50" y="-50" width="200" height="200" fill="#070B12" />
        <rect x="-50" y="-50" width="200" height="200" fill="url(#cf-map-grid)" />

        {/* venue landmass */}
        <polygon points={outlinePath} fill="#0D1524" stroke="var(--cf-line2)" strokeWidth="0.5" />

        {underlay && (
          <image href={underlay} x="0" y="0" width="100" height="100"
            preserveAspectRatio="xMidYMid slice" opacity={underlayOpacity} clipPath="url(#cf-venue-clip)" />
        )}

        {/* corridors — casing then fill, the way map roads are drawn */}
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

        {/* halls */}
        {venue.halls.map((h) => {
          const style = HALL_STYLE[h.type] || HALL_STYLE.SEATING;
          const [hx, hy] = centroid(h.pts);
          const isSel = selectedHall === h.id;
          return (
            <g key={h.id} onClick={() => onSelectHall?.(h.id)} style={{ cursor: onSelectHall ? "pointer" : "default" }}>
              <polygon points={h.pts.map((p) => p.join(",")).join(" ")}
                fill={showDensity ? densityColor(h.density) : style.fill}
                fillOpacity={showDensity ? 0.16 + h.density * 0.3 : 1}
                stroke={isSel ? "var(--cf-orange)" : style.stroke}
                strokeWidth={isSel ? 0.8 : 0.4} />
              <text x={hx} y={hy} textAnchor="middle" fill="rgba(238,242,248,0.72)"
                style={{ fontSize: 2.1, fontFamily: "Rajdhani, sans-serif", fontWeight: 600, letterSpacing: "0.08em", pointerEvents: "none" }}>
                {h.name.toUpperCase()}
              </text>
              {showDensity && (
                <text x={hx} y={hy + 3} textAnchor="middle" fill={densityColor(h.density)}
                  style={{ fontSize: 1.9, fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}>
                  {Math.round(h.density * 100)}%
                </text>
              )}
            </g>
          );
        })}

        {/* directions polyline — casing + core, Google-style */}
        {route && route.length > 1 && (
          <>
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="#0A2A5E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="var(--cf-blue-hi)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="cf-flow" />
            <circle cx={route[route.length - 1][0]} cy={route[route.length - 1][1]} r="1.6"
              fill="var(--cf-green)" stroke="#05070B" strokeWidth="0.5" />
          </>
        )}

        {/* crowd dots */}
        {showPeople && (
          <g clipPath="url(#cf-venue-clip)">
            {people.map((p) => (
              <circle key={p.id} cx={p.x} cy={p.y} r="0.55"
                fill={p.hot ? "var(--cf-orange)" : "rgba(190,210,240,0.75)"} opacity="0.9" />
            ))}
          </g>
        )}

        {/* POIs */}
        {showPois && venue.pois.map((poi) => (
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

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(mq.matches);
    const on = (e) => setR(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return r;
}

function Reveal({ children, delay = 0 }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: "0px 0px -50px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`cf-reveal ${inView ? "cf-in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

function MeshField() {
  return (
    <>
      <div className="cf-mesh" aria-hidden="true">
        <span className="m1" /><span className="m2" /><span className="m3" /><span className="m4" />
      </div>
      <div className="cf-mesh-veil" aria-hidden="true" />
      <svg className="cf-grain" aria-hidden="true">
        <filter id="cf-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#cf-noise)" />
      </svg>
    </>
  );
}

function Eyebrow({ children }) {
  return (
    <div className="inline-flex items-center gap-2 cf-accent text-[11px] cf-chip rounded-full px-3 py-1 cf-dim">
      {children}
    </div>
  );
}

function SectionHeading({ eyebrow, title, lede, center = false }) {
  return (
    <div className={`max-w-2xl mb-12 ${center ? "mx-auto text-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="cf-display font-black uppercase text-3xl sm:text-4xl tracking-tight mt-4 mb-3">{title}</h2>
      <p className="cf-dim text-base leading-relaxed">{lede}</p>
    </div>
  );
}

function PageHeader({ eyebrow, title, lede }) {
  return (
    <section className="relative border-b cf-hairline">
      <div className="relative max-w-7xl mx-auto px-6 pt-32 pb-16">
        <Reveal>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="cf-display font-black uppercase tracking-tight mt-5 mb-5" style={{ fontSize: "clamp(2.5rem, 5.5vw, 4rem)", lineHeight: 1.02 }}>
            <GradientShimmer gradient="ember">{title}</GradientShimmer>
          </h1>
          <p className="cf-dim text-lg leading-relaxed max-w-2xl">{lede}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================================
   Router
   ========================================================================== */

const NAV = [
  { path: "/", label: "Home" },
  { path: "/platform", label: "Platform" },
  { path: "/intelligence", label: "Intelligence" },
  { path: "/results", label: "Results" },
  { path: "/access", label: "Portals" },
];

function useHashRoute() {
  const read = () => {
    if (typeof window === "undefined") return "/";
    const h = window.location.hash.replace(/^#/, "");
    return h && h.startsWith("/") ? h : "/";
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const navigate = useCallback((p) => {
    if (typeof window !== "undefined") window.location.hash = p;
    setRoute(p);
  }, []);
  return [route, navigate];
}

/* ============================================================================
   Header
   ========================================================================== */

function Header({ route, navigate, session, signOut }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [route]);
  const go = (e, p) => { e.preventDefault(); navigate(p); };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: solid || open ? "rgba(5,7,11,0.86)" : "transparent",
        borderBottom: `1px solid ${solid || open ? "var(--cf-line)" : "transparent"}`,
        backdropFilter: solid || open ? "blur(14px) saturate(140%)" : "none",
      }}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <a href="#/" onClick={(e) => go(e, "/")} className="flex items-center gap-2.5 cf-focus rounded shrink-0">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--cf-red), var(--cf-orange))" }}>
            <Flag className="w-4 h-4 text-white" strokeWidth={2.5} />
          </span>
          <span className="cf-display font-bold uppercase tracking-wide text-base leading-none">
            Crowd Flow<span className="cf-dim font-normal"> Optimiser</span>
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV.map((r) => (
            <a key={r.path} href={`#${r.path}`} onClick={(e) => go(e, r.path)} data-active={route === r.path}
              className="cf-nav-link cf-accent text-[12px] cf-focus rounded"
              style={{ color: route === r.path ? "var(--cf-ink)" : "var(--cf-dim)" }}>
              {r.label.toUpperCase()}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-3 shrink-0">
          {session ? (
            <>
              <span className="cf-mono text-[11px] cf-dim2">{session.email}</span>
              <button onClick={signOut} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[11px]">SIGN OUT</button>
            </>
          ) : (
            <>
              <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-ghost cf-accent text-[11px]">SIGN IN</a>
              <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary rounded-lg px-4 py-2 cf-accent text-[11px]">
                OPEN PORTAL
              </a>
            </>
          )}
        </div>

        <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
          className="lg:hidden cf-focus cf-btn-outline rounded-lg w-9 h-9 flex items-center justify-center">
          {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t cf-hairline px-6 py-4 flex flex-col gap-1">
          {NAV.map((r) => (
            <a key={r.path} href={`#${r.path}`} onClick={(e) => go(e, r.path)} className="cf-accent text-sm py-2.5 cf-focus rounded"
              style={{ color: route === r.path ? "var(--cf-orange)" : "var(--cf-dim)" }}>
              {r.label.toUpperCase()}
            </a>
          ))}
          <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary rounded-lg px-4 py-2.5 cf-accent text-[11px] text-center mt-3">
            OPEN PORTAL
          </a>
        </div>
      )}
    </header>
  );
}

/* ============================================================================
   Marketing pages
   ========================================================================== */

function WordCarousel({ words, interval = 2500 }) {
  const [cur, setCur] = useState(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setCur((p) => (p + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [interval, words.length, reduced]);
  return (
    <span className="relative inline-flex w-full justify-center overflow-hidden align-bottom" style={{ height: "1.15em" }}>
      &nbsp;
      {words.map((w, i) => (
        <span key={w} className="absolute" style={{
          transform: reduced ? "none" : `translateY(${i === cur ? "0" : i < cur ? "-120%" : "120%"})`,
          opacity: i === cur ? 1 : 0,
          transition: reduced ? "none" : "transform .6s cubic-bezier(0.34,1.15,0.4,1), opacity .5s ease",
        }}>
          <GradientShimmer gradient="ember">{w}</GradientShimmer>
        </span>
      ))}
    </span>
  );
}

/**
 * The map shown on the marketing pages.
 *
 * If a session is running on the backend, it shows that session, live. If not, it shows the
 * sample arena as a still layout with no crowd on it. What it never does is animate invented
 * people — a landing page implying live data it does not have is the one lie a monitoring
 * product cannot afford.
 */
function useShowcase() {
  const { sessions } = useSessionList(10000);
  const flow = useCrowdFlow();

  const running = sessions.find((s) => s.status === "RUNNING") ?? sessions[0];

  useEffect(() => {
    if (running && !flow.sessionId) flow.attach(running.sessionId).catch(() => {});
  }, [running?.sessionId, flow.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = useMemo(() => toMapVenue(sampleVenue), []);

  return flow.venue
    ? { venue: flow.venue, people: flow.people, live: true }
    : { venue: fallback, people: [], live: false };
}

/** Small caption under a showcase map, so nobody has to guess whether it is real. */
function ShowcaseNote({ live }) {
  return (
    <p className="cf-mono text-[10px] cf-dim2 mt-3 text-center">
      {live
        ? "LIVE — streaming from a running session"
        : "SAMPLE LAYOUT — no session running; start one from the client portal"}
    </p>
  );
}

function HomePage({ navigate }) {
  const { venue, people, live } = useShowcase();
  return (
    <div className="cf-page-in">
      <section className="relative px-6 pt-32 pb-20">
        <div className="max-w-7xl mx-auto text-center">
          <Reveal>
            <a href="#/access" onClick={(e) => { e.preventDefault(); navigate("/access"); }}
              className="cf-focus cf-accent inline-flex items-center gap-3 text-[11px] cf-chip rounded-full pl-4 pr-3 py-2 mb-10 cf-dim">
              THREE PORTALS · ONE LIVE MAP <MoveRight className="w-3.5 h-3.5" />
            </a>
            <h1 className="cf-display font-black uppercase tracking-tight max-w-4xl mx-auto" style={{ fontSize: "clamp(2.5rem, 6.5vw, 5rem)", lineHeight: 1 }}>
              <span className="block"><GradientShimmer gradient="ember">Know where the crowd</GradientShimmer></span>
              <span className="block"><GradientShimmer gradient="ember">is going to break —</GradientShimmer></span>
              <WordCarousel words={["live.", "predictive.", "measurable.", "on every phone."]} />
            </h1>
            <p className="mt-8 max-w-xl mx-auto leading-relaxed cf-dim" style={{ fontSize: "clamp(1rem, 1.4vw, 1.15rem)" }}>
              Attendees see themselves on the venue map. Organisers see every zone filling in real time.
              We see the whole network — and the bottleneck forming three ticks before it does.
            </p>
            <div className="mt-10 flex flex-wrap gap-3 justify-center">
              <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                Open a portal
              </button>
              <button onClick={() => navigate("/platform")} className="cf-focus cf-btn-outline rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                See the platform
              </button>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="mt-16 max-w-5xl mx-auto">
              <VenueMap venue={venue} people={people} me={null} height={440} />
              <ShowcaseNote live={live} />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 border-t cf-hairline">
        <Reveal><SectionHeading eyebrow="WHO IT'S FOR" title="Three views of the same venue" lede="Same live data, three very different jobs — and each portal only ever shows what that role should see." center /></Reveal>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { Icon: Ticket, role: "Walker", t: "Attendees", d: "Enter a venue ID, see yourself on the map, find the nearest clear exit or water point.", to: "/login/walker", c: "var(--cf-blue-hi)" },
            { Icon: Building2, role: "Client", t: "Organisers", d: "Upload your floor plan, manage halls and capacity, watch occupancy fill zone by zone.", to: "/login/client", c: "var(--cf-orange)" },
            { Icon: UserCog, role: "Admin", t: "Operations", d: "Every venue, every layout, every bottleneck — cross-venue monitoring and analysis.", to: "/login/admin", c: "var(--cf-red)" },
          ].map(({ Icon, role, t, d, to, c }, i) => (
            <Reveal key={role} delay={i * 80}>
              <button onClick={() => navigate(to)} className="cf-focus cf-card cf-lift rounded-2xl p-7 text-left w-full h-full">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center mb-5" style={{ background: `color-mix(in oklab, ${c} 18%, transparent)` }}>
                  <Icon className="w-5 h-5" style={{ color: c }} strokeWidth={2} />
                </span>
                <div className="cf-accent text-[10px] cf-dim2 mb-1">{role.toUpperCase()} PORTAL</div>
                <div className="cf-display font-bold uppercase text-xl tracking-wide mb-2">{t}</div>
                <p className="text-sm cf-dim leading-relaxed mb-4">{d}</p>
                <span className="inline-flex items-center gap-1.5 cf-accent text-[11px]" style={{ color: c }}>
                  ENTER <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="cf-panel border-y cf-hairline">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-2xl overflow-hidden" style={{ background: "var(--cf-line)" }}>
              {[
                { v: "2,500", l: "AGENTS PER RUN" }, { v: "~100ms", l: "TICK INTERVAL" },
                { v: "28%", l: "LESS TIME CRITICAL", c: "var(--cf-green)" }, { v: "0", l: "DATABASES REQUIRED" },
              ].map((s) => (
                <div key={s.l} className="px-6 py-8" style={{ background: "var(--cf-card)" }}>
                  <div className="cf-display font-black text-3xl mb-1" style={{ color: s.c || "var(--cf-ink)" }}>{s.v}</div>
                  <div className="cf-accent text-[11px] cf-dim2">{s.l}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function PlatformPage({ navigate }) {
  const { venue, people, live } = useShowcase();
  const [sel, setSel] = useState(null);
  const hall = venue.halls.find((h) => h.id === sel);

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="PLATFORM" title="The live board"
        lede="Every zone ranked by what's about to happen, on a map that behaves like the one already in everyone's pocket." />

      <section className="max-w-7xl mx-auto px-6 py-16 border-b cf-hairline">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="cf-display font-bold uppercase text-lg tracking-wide">{venue.name}</span>
          <span className="cf-mono text-[11px] cf-dim2">{venue.id}</span>
          <ShowcaseNote live={live} />
        </div>
        <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
          <VenueMap venue={venue} people={people} me={null} height={520} onSelectHall={setSel} selectedHall={sel} />
          <div className="flex flex-col gap-4">
            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">SELECTED ZONE</div>
              {hall ? (
                <>
                  <div className="cf-display font-bold uppercase text-lg tracking-wide mb-1">{hall.name}</div>
                  <div className="cf-mono text-[11px] cf-dim2 mb-4">{hall.type}</div>
                  <div className="h-2 rounded-full cf-panel overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{ width: `${hall.density * 100}%`, background: densityColor(hall.density) }} />
                  </div>
                  <div className="flex justify-between cf-mono text-xs">
                    <span className="cf-dim2">OCCUPANCY</span>
                    <span style={{ color: densityColor(hall.density) }}>{Math.round(hall.density * 100)}%</span>
                  </div>
                </>
              ) : (
                <p className="text-sm cf-dim leading-relaxed">Tap any zone on the map to inspect its live occupancy and status.</p>
              )}
            </div>
            <div className="cf-card rounded-2xl p-5 flex-1">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">LIVE COUNTS</div>
              <div className="flex flex-col gap-3">
                {[["Inside venue", people.length * 20], ["Capacity", venue.capacity], ["Zones flagged", venue.halls.filter((h) => h.density > 0.7).length]].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between">
                    <span className="text-sm cf-dim">{l}</span>
                    <span className="cf-mono text-sm font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="LIVE TIMING TOWER" title="Ranked by predicted risk"
          lede="Position comes from the congestion-propagation model, so a quiet zone about to be hit by an overrunning neighbour climbs the board before it fills." /></Reveal>
        <Reveal delay={100}><TimingTower zones={venue.halls} /></Reveal>
      </section>
    </div>
  );
}

const ZONE_ICON = { GATE: DoorOpen, WALKWAY: Footprints, CONCESSION: UtensilsCrossed, SEATING: Armchair, EXIT: LogOut };
const STATUS_META = { CRITICAL: { c: "var(--cf-red)", l: "CRITICAL" }, WARNING: { c: "var(--cf-amber)", l: "CAUTION" }, OK: { c: "var(--cf-green)", l: "CLEAR" } };
const TREND_META = { RISING: { I: TrendingUp, c: "var(--cf-red)" }, FALLING: { I: TrendingDown, c: "var(--cf-green)" }, FLAT: { I: Minus, c: "var(--cf-dim)" } };

/**
 * The zone table, ordered worst first — the "timing tower" of the venue.
 *
 * Rows are the `nodes` array off a live frame, so occupancy, status, trend and AI risk are all
 * the server's numbers. Sorted by density here rather than on the server because the server's
 * order is the venue file's order, which is meaningful for the map and useless for a leaderboard.
 */
function TimingTower({ zones = [] }) {
  const ranked = useMemo(
    () => [...zones].sort((a, b) => b.density - a.density),
    [zones],
  );

  if (!ranked.length) {
    return (
      <div className="cf-card rounded-2xl px-6 py-10 text-center">
        <p className="text-sm cf-dim">No zone data yet — start a session to populate the tower.</p>
      </div>
    );
  }

  return (
    <div className="cf-card rounded-2xl overflow-hidden">
      <div className="hidden sm:grid grid-cols-[3rem_1fr_9rem_7rem_9rem] gap-4 px-6 py-3 border-b cf-hairline cf-accent text-[11px] cf-dim2">
        <span>POS</span><span>ZONE</span><span>OCCUPANCY</span><span>TREND</span><span>AI RISK</span>
      </div>
      {ranked.map((z, i) => {
        const Icon = ZONE_ICON[z.type] ?? Armchair;
        const s = STATUS_META[z.status] ?? STATUS_META.OK;
        const t = TREND_META[z.trend] ?? TREND_META.FLAT;
        const TI = t.I;
        return (
          <div key={z.id} className="grid grid-cols-[2.5rem_1fr] sm:grid-cols-[3rem_1fr_9rem_7rem_9rem] gap-4 items-center px-6 py-4 border-b cf-hairline last:border-b-0 hover:bg-white/[0.02] transition-colors">
            <div className="cf-mono font-bold cf-dim2">P{i + 1}</div>
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg cf-chip flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{z.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.c }} />
                  <span className="text-[11px] cf-mono" style={{ color: s.c }}>{s.l}</span>
                </div>
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                {/* Capped at 100%: an overfull zone reports density > 1 and would otherwise
                    overflow its own track rather than reading as "full". */}
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, z.density * 100)}%`, background: s.c }} />
              </div>
              <span className="cf-mono text-xs w-10 text-right">{Math.round(z.density * 100)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TI className="w-3.5 h-3.5" style={{ color: t.c }} strokeWidth={2.5} />
              <span className="cf-mono text-xs" style={{ color: t.c }}>{z.trend ?? "FLAT"}</span>
            </div>
            <div><span className="cf-mono text-xs px-2 py-1 rounded" style={{ color: "var(--cf-blue-hi)", border: "1px solid rgba(77,141,240,.3)", background: "rgba(77,141,240,.08)" }}>AI {(z.risk ?? 0).toFixed(2)}</span></div>
          </div>
        );
      })}
    </div>
  );
}

function IntelligencePage() {
  const pipeline = [
    { Icon: Boxes, t: "Input validation", d: "Reject malformed graphs before they reach a model." },
    { Icon: Layers, t: "Preprocessing", d: "Density, trend and history folded into per-node features." },
    { Icon: Network, t: "Graph features", d: "Adjacency built from the venue's own walkway edges." },
    { Icon: Cpu, t: "Model call", d: "Hosted inference for risk scores, then for advisory text." },
    { Icon: GitBranch, t: "Postprocess", d: "Scores mapped back onto node IDs the frontend knows." },
    { Icon: ShieldCheck, t: "Fallback check", d: "If anything is missing, hand off to the deterministic mock." },
  ];
  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="INTELLIGENCE" title="Two calls a threshold can't make"
        lede="Simulation and routing are classic algorithms on purpose. The models earn their place doing what per-node rules can't: seeing a neighbour push crowd into you, and turning a density vector into an instruction." />
      <section className="max-w-7xl mx-auto px-6 py-20 border-b cf-hairline">
        <div className="grid md:grid-cols-2 gap-6">
          {[
            { Icon: Zap, t: "Congestion-Propagation GNN", m: "Graph neural net · message passing", b: "Predicts risk at neighbouring zones a few ticks ahead, not just the one crossing a threshold now.", ql: "PREDICTED · HORIZON 30 TICKS", q: "Gate A push spreading to North Concourse. Risk climbing, three ticks out." },
            { Icon: Radio, t: "Advisory Generator", m: "Text generation · density + trend → instruction", b: "Operators read sentences, not density vectors. This turns raw numbers into the line a marshal can act on.", ql: "GENERATED ADVISORY · GATE A", q: "Hold intake and stage arrivals away from Gate A; it is filling faster than it drains." },
          ].map(({ Icon, t, m, b, ql, q }, i) => (
            <Reveal key={t} delay={i * 80}>
              <div className="cf-card cf-lift rounded-2xl p-7 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-5">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(77,141,240,0.14)" }}>
                    <Icon className="w-5 h-5 cf-blue-hi" strokeWidth={2} />
                  </span>
                  <div>
                    <div className="cf-display font-bold uppercase text-sm tracking-wide">{t}</div>
                    <div className="cf-mono text-[11px] cf-dim2">{m}</div>
                  </div>
                </div>
                <p className="cf-dim text-sm leading-relaxed mb-6">{b}</p>
                <div className="mt-auto border-l-2 pl-4 py-1" style={{ borderColor: "var(--cf-orange)" }}>
                  <div className="cf-mono text-[10px] tracking-widest cf-dim2 mb-1">{ql}</div>
                  <p className="text-sm italic leading-relaxed">&ldquo;{q}&rdquo;</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="THE /ANALYZE PIPELINE" title="Six steps between a graph and a sentence" lede="One endpoint does the whole job. Spring sends board state; FastAPI returns risk scores and the line to read out." /></Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipeline.map(({ Icon, t, d }, i) => (
            <Reveal key={t} delay={i * 60}>
              <div className="cf-card cf-lift rounded-xl p-6 h-full">
                <div className="flex items-center justify-between mb-4">
                  <Icon className="w-4 h-4 cf-orange" strokeWidth={2} />
                  <span className="cf-mono text-[10px] cf-dim2">0{i + 1}</span>
                </div>
                <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1.5">{t}</div>
                <p className="text-sm cf-dim leading-relaxed">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResultsPage() {
  const [open, setOpen] = useState(0);
  const { sessions } = useSessionList(10000);
  const [summary, setSummary] = useState(null);

  // The most advanced session is the interesting one to report on — a run that has barely
  // started has nothing to compare yet.
  const target = useMemo(
    () => [...sessions].sort((a, b) => b.tick - a.tick)[0],
    [sessions],
  );

  useEffect(() => {
    if (!target) { setSummary(null); return; }
    let cancelled = false;
    api.getSessionSummary(target.sessionId)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [target?.sessionId, target?.tick]);

  const faqs = [
    { q: "Why did the bottleneck count go up?", a: "Because the crowd got spread across more zones instead of crushed into fewer. Counting zones rewards concentration, which is the wrong incentive. Critical node-ticks — total time any zone spent above the danger line — tracks real risk." },
    { q: "Is the baseline a real run or an estimate?", a: "A real run. A hidden baseline session executes in lockstep with the same venue graph, crowd size and random seed, with rerouting off. Only the intervention differs." },
    { q: "What is a node-tick?", a: "One zone spending one tick above the critical threshold. It measures exposure, not incidents." },
  ];

  const laps = summary
    ? [
        { l: "Lap 1 · No strategy", c: "var(--cf-red)", d: summary.baseline },
        { l: "Lap 2 · With strategy", c: "var(--cf-green)", d: summary.optimised },
      ]
    : [];

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="RESULTS" title="Same crowd, two laps"
        lede="A hidden baseline runs in lockstep with rerouting switched off, on the same venue, crowd and seed. Paired simulation output, not an estimate." />
      <section className="max-w-7xl mx-auto px-6 py-20 border-b cf-hairline">
        {!summary && (
          <div className="cf-card rounded-2xl px-6 py-14 text-center">
            <p className="text-sm cf-dim">
              No completed run to report on yet. Start a session with rerouting on from the
              client portal, and its before/after lands here.
            </p>
          </div>
        )}

        {summary && (
          <>
            <div className="flex flex-wrap items-baseline gap-3 mb-6">
              <span className="cf-display font-bold uppercase text-lg tracking-wide">{summary.venueName}</span>
              <span className="cf-mono text-[11px] cf-dim2">
                {summary.sessionId} · {summary.ticks} ticks · {summary.status}
              </span>
            </div>
            {!summary.comparisonAvailable && (
              <p className="text-sm cf-dim mb-6">
                This run had rerouting off, so both columns are the same numbers — there was no
                intervention to compare against.
              </p>
            )}
          </>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {laps.map(({ l, c, d }, i) => (
            <Reveal key={l} delay={i * 80}>
              <div className="cf-card cf-lift rounded-2xl p-7">
                <div className="cf-display font-bold uppercase text-sm tracking-wide mb-6" style={{ color: c }}>{l}</div>
                <div className="cf-accent text-[11px] cf-dim2 mb-1">CRITICAL NODE-TICKS</div>
                <div className="cf-mono text-4xl font-bold" style={{ color: c }}>{d.criticalNodeTicks}</div>
                <div className="grid grid-cols-3 gap-4 pt-5 mt-5 border-t cf-hairline">
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">PEAK</div><div className="cf-mono font-semibold">{Math.round(d.peakDensity * 100)}%</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">ZONES</div><div className="cf-mono font-semibold">{d.bottleneckCount}</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">EXITED</div><div className="cf-mono font-semibold">{d.exited}</div></div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {summary && (
          <p className="text-sm cf-dim leading-relaxed max-w-3xl mt-8">{summary.narrative}</p>
        )}
      </section>
      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="READING THE NUMBERS" title="The questions that come up first" lede="Mostly about why one metric moved the wrong way — which turns out to be the interesting part." /></Reveal>
        <div className="max-w-3xl">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <div className="border-b cf-hairline">
                <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}
                  className="cf-focus w-full flex items-center justify-between gap-6 py-5 text-left">
                  <span className="cf-display font-bold uppercase text-base tracking-wide">{f.q}</span>
                  <ChevronDown className="w-4 h-4 cf-dim shrink-0 transition-transform duration-300" style={{ transform: open === i ? "rotate(180deg)" : "none" }} />
                </button>
                <div style={{ display: "grid", gridTemplateRows: open === i ? "1fr" : "0fr", transition: "grid-template-rows .35s cubic-bezier(0.16,1,0.3,1)" }}>
                  <div style={{ overflow: "hidden" }}><p className="text-sm cf-dim leading-relaxed pb-5 max-w-2xl">{f.a}</p></div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   Access page — the entry point that explains each role
   ========================================================================== */

const ROLES = {
  walker: {
    key: "walker", label: "Walker", who: "Attendees & visitors", color: "var(--cf-blue-hi)", Icon: Ticket,
    tagline: "Find yourself. Find the way out.",
    blurb: "Enter the venue ID printed on your ticket and the map loads with you on it. You'll see the exits, water points and restrooms — and which route is actually clear right now.",
    can: ["See your own live position inside the venue", "Nearest clear exit, with walking route", "Water points, restrooms, concessions", "Crowding warnings on your route"],
    cannot: ["Other attendees' identities or positions", "Venue analytics or capacity figures", "Anything outside the venue geofence"],
  },
  client: {
    key: "client", label: "Client", who: "Venue owners & organisers", color: "var(--cf-orange)", Icon: Building2,
    tagline: "Upload a floor plan. Get a live map.",
    blurb: "Drop in a flat 2D image of your venue and we trace it into a working map — halls, corridors, gates. From there it's live: occupancy per zone, capacity limits you set, alerts when a zone starts filling.",
    can: ["Upload and trace 2D floor plans", "Define halls, capacities and gates", "Live occupancy per zone", "Alerts and reroute advisories"],
    cannot: ["Individual attendee identities", "Other clients' venues or data", "Platform-wide analytics"],
  },
  admin: {
    key: "admin", label: "Admin", who: "Platform operations", color: "var(--cf-red)", Icon: UserCog,
    tagline: "Every venue. Every bottleneck.",
    blurb: "The operations console. Cross-venue monitoring, layout review, incident history, and the model's own accuracy over time — where predicted risk did and didn't match what happened.",
    can: ["All venues and layouts", "Cross-venue bottleneck monitoring", "Client account management", "Model accuracy and incident review"],
    cannot: ["Attendee personal data beyond anonymised position", "Anything without an audit-log entry"],
  },
};

function AccessPage({ navigate }) {
  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="PORTALS" title="Pick your way in"
        lede="One platform, three portals. Each sees exactly what its job requires and nothing beyond it — the boundaries below are the actual access model, not a marketing summary." />

      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid lg:grid-cols-3 gap-6">
          {Object.values(ROLES).map((r, i) => (
            <Reveal key={r.key} delay={i * 90}>
              <div className="cf-card cf-lift rounded-2xl p-7 h-full flex flex-col">
                <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: `color-mix(in oklab, ${r.color} 18%, transparent)` }}>
                  <r.Icon className="w-6 h-6" style={{ color: r.color }} strokeWidth={2} />
                </span>
                <div className="cf-accent text-[10px] cf-dim2 mb-1.5">{r.who.toUpperCase()}</div>
                <div className="cf-display font-black uppercase text-2xl tracking-tight mb-2">{r.label}</div>
                <p className="cf-display font-bold uppercase text-sm tracking-wide mb-4" style={{ color: r.color }}>{r.tagline}</p>
                <p className="text-sm cf-dim leading-relaxed mb-6">{r.blurb}</p>

                <div className="mb-5">
                  <div className="cf-accent text-[10px] cf-dim2 mb-2.5">CAN SEE</div>
                  <div className="flex flex-col gap-2">
                    {r.can.map((c) => (
                      <div key={c} className="flex items-start gap-2 text-sm cf-dim">
                        <Check className="w-3.5 h-3.5 cf-green shrink-0 mt-0.5" strokeWidth={2.5} />{c}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mb-7">
                  <div className="cf-accent text-[10px] cf-dim2 mb-2.5">NEVER SEES</div>
                  <div className="flex flex-col gap-2">
                    {r.cannot.map((c) => (
                      <div key={c} className="flex items-start gap-2 text-sm cf-dim2">
                        <X className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--cf-red)" }} strokeWidth={2.5} />{c}
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={() => navigate(`/login/${r.key}`)}
                  className="cf-focus mt-auto rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide w-full transition-all"
                  style={{ background: `color-mix(in oklab, ${r.color} 16%, transparent)`, border: `1px solid ${r.color}`, color: r.color }}>
                  Sign in as {r.label}
                </button>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24">
        <Reveal>
          <div className="cf-card rounded-2xl p-7 flex items-start gap-4">
            <ShieldCheck className="w-5 h-5 cf-green shrink-0 mt-0.5" strokeWidth={2} />
            <div>
              <div className="cf-display font-bold uppercase text-base tracking-wide mb-2">Position data never leaves the geofence</div>
              <p className="text-sm cf-dim leading-relaxed max-w-3xl">
                A device only contributes a dot while it is inside the venue polygon. Step outside and the point stops
                being rendered and stops being counted — there is no tracking of where anyone goes before or after.
                Walkers see only themselves; organisers and admins see anonymous density, never identities.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

/* ============================================================================
   Login
   ========================================================================== */

function LoginPage({ roleKey, navigate, signIn }) {
  const role = ROLES[roleKey] ?? ROLES.walker;
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = () => {
    if (!email.trim() || !pw.trim()) { setErr("Enter an email and password to continue."); return; }
    setErr(""); setBusy(true);
    setTimeout(() => {
      setBusy(false);
      signIn({ role: role.key, email: email.trim() });
      navigate(`/app/${role.key}`);
    }, 700);
  };

  return (
    <div className="cf-page-in min-h-screen flex items-center justify-center px-6 py-32">
      <div className="w-full max-w-md">
        <Reveal>
          <button onClick={() => navigate("/access")} className="cf-focus cf-btn-ghost cf-accent text-[11px] inline-flex items-center gap-2 mb-8">
            <ChevronLeft className="w-3.5 h-3.5" /> ALL PORTALS
          </button>

          <div className="cf-card rounded-2xl p-8">
            <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: `color-mix(in oklab, ${role.color} 18%, transparent)` }}>
              <role.Icon className="w-6 h-6" style={{ color: role.color }} strokeWidth={2} />
            </span>
            <div className="cf-accent text-[10px] cf-dim2 mb-1.5">{role.who.toUpperCase()}</div>
            <h1 className="cf-display font-black uppercase text-3xl tracking-tight mb-2">
              <GradientShimmer gradient="ember">{`${role.label} sign in`}</GradientShimmer>
            </h1>
            <p className="text-sm cf-dim leading-relaxed mb-8">{role.tagline}</p>

            <div className="flex flex-col gap-4">
              <label className="block">
                <span className="cf-accent text-[10px] cf-dim2 block mb-2">EMAIL</span>
                <div className="relative">
                  <Mail className="w-4 h-4 cf-dim2 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder={`you@${role.key === "walker" ? "example.com" : role.key === "client" ? "yourvenue.com" : "crowdflow.io"}`}
                    className="cf-input cf-focus w-full rounded-xl pl-10 pr-4 py-3 text-sm" />
                </div>
              </label>

              <label className="block">
                <span className="cf-accent text-[10px] cf-dim2 block mb-2">PASSWORD</span>
                <div className="relative">
                  <Lock className="w-4 h-4 cf-dim2 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder="••••••••" className="cf-input cf-focus w-full rounded-xl pl-10 pr-4 py-3 text-sm" />
                </div>
              </label>

              {err && <p className="text-sm" style={{ color: "var(--cf-red)" }}>{err}</p>}

              <button onClick={submit} disabled={busy}
                className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-60">
                {busy ? "Signing in…" : `Enter ${role.label} portal`}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t cf-hairline">
              <p className="text-xs cf-dim2 leading-relaxed">
                Prototype auth — no credentials are checked or stored, and nothing is sent anywhere.
                Any email and password will open the portal so you can see the interface.
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            {Object.values(ROLES).filter((r) => r.key !== role.key).map((r) => (
              <button key={r.key} onClick={() => navigate(`/login/${r.key}`)}
                className="cf-focus cf-card rounded-xl px-4 py-3 flex-1 text-left hover:cf-lift transition-all">
                <div className="cf-accent text-[10px] cf-dim2 mb-0.5">SWITCH TO</div>
                <div className="cf-display font-bold uppercase text-sm" style={{ color: r.color }}>{r.label}</div>
              </button>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/* ============================================================================
   App shell for portals
   ========================================================================== */

function PortalShell({ role, session, navigate, signOut, tabs, active, setActive, children }) {
  const r = ROLES[role];
  return (
    <div className="cf-page-in pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in oklab, ${r.color} 18%, transparent)` }}>
              <r.Icon className="w-5 h-5" style={{ color: r.color }} strokeWidth={2} />
            </span>
            <div>
              <div className="cf-accent text-[10px] cf-dim2">{r.who.toUpperCase()}</div>
              <h1 className="cf-display font-black uppercase text-2xl tracking-tight leading-none">{r.label} portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="cf-mono text-[11px] cf-dim2 hidden sm:inline">{session?.email}</span>
            <button onClick={() => { signOut(); navigate("/access"); }} className="cf-focus cf-btn-outline rounded-lg px-4 py-2 cf-accent text-[11px]">
              SIGN OUT
            </button>
          </div>
        </div>

        {tabs && (
          <div className="flex gap-1 mb-8 p-1 rounded-xl cf-card w-fit overflow-x-auto">
            {tabs.map((t) => (
              <button key={t} onClick={() => setActive(t)}
                className="cf-focus cf-accent text-[11px] rounded-lg px-4 py-2.5 whitespace-nowrap transition-all"
                style={active === t
                  ? { background: `color-mix(in oklab, ${r.color} 18%, transparent)`, color: r.color }
                  : { color: "var(--cf-dim2)" }}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

/* ---- Walker portal ---- */

function WalkerApp({ session, navigate, signOut }) {
  const [entered, setEntered] = useState("");
  const [joinError, setJoinError] = useState("");
  const { sessions } = useSessionList(8000);
  const flow = useCrowdFlow();
  const { venue, info, connected } = flow;

  // Where the attendee says they are. The backend has no per-person GPS — it simulates a crowd,
  // it does not track your phone — so this is zone-level and self-declared, and the UI says so
  // rather than drawing a false 3-metre accuracy circle.
  const [atNodeId, setAtNodeId] = useState(null);
  const [routePath, setRoutePath] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);

  const join = async () => {
    const id = entered.trim();
    if (!id) { setJoinError("Enter the session ID shown on venue signage."); return; }
    try {
      setJoinError("");
      await flow.attach(id);
    } catch (cause) {
      setJoinError(cause.status === 404 ? `No session found with ID "${id}".` : cause.message);
    }
  };

  // Default to a gate — where you would actually be when you walk in.
  useEffect(() => {
    if (venue && !atNodeId) {
      setAtNodeId((venue.halls.find((h) => h.type === "GATE") ?? venue.halls[0])?.id ?? null);
    }
  }, [venue, atNodeId]);

  /**
   * The way out, from the server's own Dijkstra over the venue graph — not a straight line.
   * Re-asked whenever the attendee moves zone; the layout cannot change mid-session, so this
   * does not need to follow the tick.
   */
  useEffect(() => {
    if (!venue || !atNodeId) { setRoutePath(null); return; }
    let cancelled = false;

    api.getVenueRoute(venue.id, atNodeId)
      .then((path) => {
        if (cancelled) return;
        setRouteInfo(path);
        const byId = new Map(venue.halls.map((h) => [h.id, h]));
        const points = (path.path ?? []).map((id) => byId.get(id)?.center).filter(Boolean);
        setRoutePath(points.length >= 2 ? points : null);
      })
      .catch(() => { if (!cancelled) { setRoutePath(null); setRouteInfo(null); } });

    return () => { cancelled = true; };
  }, [venue, atNodeId]);

  const here = venue?.halls.find((h) => h.id === atNodeId) ?? null;

  if (!venue) {
    return (
      <div className="cf-page-in min-h-screen flex items-center justify-center px-6 py-32">
        <div className="w-full max-w-md">
          <Reveal>
            <div className="cf-card rounded-2xl p-8">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(77,141,240,0.16)" }}>
                <MapPin className="w-6 h-6 cf-blue-hi" strokeWidth={2} />
              </span>
              <h1 className="cf-display font-black uppercase text-3xl tracking-tight mb-2">Enter session ID</h1>
              <p className="text-sm cf-dim leading-relaxed mb-7">
                It's on signage at every entrance. The map loads live from the venue's own
                simulation, so what you see is what the operators see.
              </p>
              <input value={entered} onChange={(e) => setEntered(e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="sess-1a2b3c4d"
                aria-label="Session ID"
                className="cf-input cf-focus w-full rounded-xl px-4 py-3.5 text-base cf-mono tracking-widest text-center mb-4" />
              {joinError && <p className="text-sm mb-4" style={{ color: "var(--cf-red)" }}>{joinError}</p>}
              <button onClick={join} disabled={flow.busy}
                className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
                {flow.busy ? "Loading…" : "Load my map"}
              </button>

              {sessions.length > 0 && (
                <>
                  <div className="cf-accent text-[10px] cf-dim2 mt-6 mb-2">RUNNING NOW</div>
                  <div className="flex flex-wrap gap-2">
                    {sessions.map((s) => (
                      <button key={s.sessionId} onClick={() => setEntered(s.sessionId)}
                        className="cf-focus cf-chip rounded-lg px-3 py-1.5 cf-mono text-[10px] cf-dim2">
                        {s.sessionId}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button onClick={() => { signOut(); navigate("/access"); }} className="cf-focus cf-btn-ghost cf-accent text-[11px] mt-6 w-full">
                SIGN OUT
              </button>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  const exits = venue.halls.filter((h) => h.type === "EXIT");
  // "You" is the centre of the zone you told us you are in — no invented precision.
  const me = here ? { x: here.center[0], y: here.center[1], accuracy: here.radius } : null;
  const destinationName = routeInfo?.toNodeId ? zoneName(venue, routeInfo.toNodeId) : null;

  return (
    <PortalShell role="walker" session={session} navigate={navigate} signOut={signOut}>
      <div className="grid lg:grid-cols-[1fr_19rem] gap-6">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
              <div className="cf-mono text-[11px] cf-dim2">{info?.sessionId}</div>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionPill connected={connected} status={info?.status} />
              <button onClick={() => { flow.leave(); setAtNodeId(null); setRoutePath(null); }}
                className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                CHANGE VENUE
              </button>
            </div>
          </div>
          {/* Density on, crowd dots off: an attendee should see that a zone is busy without
              being shown where every other individual is standing. */}
          <VenueMap venue={venue} people={[]} me={me} route={routePath}
            showDensity showPeople={false} height={520}
            onSelectHall={setAtNodeId} selectedHall={atNodeId} />
          <div className="cf-card rounded-xl px-5 py-4 mt-4 flex items-start gap-3">
            <MapPin className="w-4 h-4 cf-blue-hi shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-sm cf-dim leading-relaxed">
              Tap the zone you're standing in to set your position — the venue tracks crowd
              density, not individual phones, so your location is zone-level and stays on this
              device. Other attendees are never shown to you.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="cf-card rounded-2xl p-5">
            <div className="cf-accent text-[10px] cf-dim2 mb-3">YOU ARE IN</div>
            <div className="flex items-center gap-3 mb-2">
              <span className="relative flex w-3 h-3">
                <span className="absolute inline-flex h-full w-full rounded-full cf-ping" style={{ background: "var(--cf-blue-hi)", opacity: .5 }} />
                <span className="relative inline-flex rounded-full w-3 h-3" style={{ background: "var(--cf-blue-hi)" }} />
              </span>
              <span className="text-sm font-semibold">{here?.name ?? "—"}</span>
            </div>
            <div className="cf-mono text-[11px] cf-dim2">ZONE-LEVEL · TAP THE MAP TO CHANGE</div>
          </div>

          {destinationName && (
            <div className="cf-card rounded-2xl p-5" style={{ borderColor: "rgba(77,141,240,.4)" }}>
              <div className="cf-accent text-[10px] cf-dim2 mb-3">YOUR WAY OUT</div>
              <div className="flex items-center gap-2 mb-2">
                <Navigation className="w-4 h-4 cf-blue-hi shrink-0" strokeWidth={2} />
                <span className="text-sm font-semibold">{destinationName}</span>
              </div>
              <div className="cf-mono text-[11px] cf-dim2">
                {routeInfo.path.length - 1} zones · {routeInfo.cost} m
              </div>
            </div>
          )}

          <div className="cf-card rounded-2xl p-5">
            <div className="cf-accent text-[10px] cf-dim2 mb-3">EXITS</div>
            <div className="flex flex-col gap-2">
              {exits.map((h) => {
                const busy = h.density > 0.7;
                return (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <LogOut className="w-3.5 h-3.5 shrink-0" style={{ color: busy ? "var(--cf-red)" : "var(--cf-green)" }} />
                      <span className="text-sm truncate">{h.name}</span>
                    </span>
                    <span className="cf-mono text-[10px] shrink-0" style={{ color: busy ? "var(--cf-red)" : "var(--cf-green)" }}>
                      {busy ? "BUSY" : "CLEAR"}
                    </span>
                  </div>
                );
              })}
              {!exits.length && <p className="text-sm cf-dim">This venue has no marked exit.</p>}
            </div>
          </div>

          {venue.pois.length > 0 && (
            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">FACILITIES</div>
              <div className="flex flex-col gap-2">
                {venue.pois.map((p) => {
                  const Icon = POI_ICON[p.kind] ?? MapPin;
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
                      <Icon className="w-3.5 h-3.5 cf-blue-hi shrink-0" />
                      <span className="text-sm">{p.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <ErrorNote error={flow.error} />
        </div>
      </div>
    </PortalShell>
  );
}

/* ---- Client portal ---- */

/**
 * Session setup: upload a venue layout and open a run on it.
 *
 * The venue travels inline in POST /sessions, so there is no separate upload step — the file
 * you drop is the graph the simulation runs on.
 */
function SessionSetup({ onCreate, busy, error }) {
  const [venueJson, setVenueJson] = useState(sampleVenue);
  const [fileName, setFileName] = useState("venue-layout-sample.json");
  const [parseError, setParseError] = useState(null);
  const [settings, setSettings] = useState({
    crowdSize: 2500, arrivalRate: 25, maxTicks: 1200, rerouteEnabled: true,
  });
  const fileRef = useRef(null);

  const readVenue = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error("A venue needs a `nodes` array and an `edges` array.");
        }
        setVenueJson(parsed);
        setFileName(file.name);
        setParseError(null);
      } catch (cause) {
        setParseError(`${file.name} is not a usable venue layout — ${cause.message}`);
      }
    };
    reader.readAsText(file);
  };

  const field = (label, key, min, max) => (
    <label className="flex flex-col gap-1.5">
      <span className="cf-accent text-[10px] cf-dim2">{label}</span>
      <input
        type="number" min={min} max={max} value={settings[key]}
        onChange={(e) => setSettings((s) => ({ ...s, [key]: Number(e.target.value) }))}
        className="cf-input cf-focus rounded-lg px-3 py-2 cf-mono text-sm" />
    </label>
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Venue layout</div>
        <p className="text-sm cf-dim leading-relaxed mb-5">
          A JSON graph of zones and the walkways between them. The sample arena is loaded and
          ready — drop your own to replace it.
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); readVenue(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className="cf-focus rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center px-6 py-10 cursor-pointer transition-all"
          style={{ borderColor: "var(--cf-line2)" }}>
          <Upload className="w-6 h-6 cf-dim2 mb-3" strokeWidth={1.6} />
          <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1">{fileName}</div>
          <p className="text-xs cf-dim2">
            {venueJson.nodes.length} zones · {venueJson.edges.length} walkways · click to replace
          </p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => readVenue(e.target.files?.[0])} />
        </div>
        {parseError && <p className="text-sm mt-3" style={{ color: "var(--cf-red)" }}>{parseError}</p>}
      </div>

      <div>
        <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Crowd</div>
        <p className="text-sm cf-dim leading-relaxed mb-5">
          How many people arrive, and how fast. With rerouting on, a hidden baseline run
          executes alongside on the same seed so the summary has a real before and after.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-5">
          {field("CROWD SIZE", "crowdSize", 1, 10000)}
          {field("ARRIVALS / TICK", "arrivalRate", 1, 2000)}
          {field("MAX TICKS", "maxTicks", 1, 20000)}
          <label className="flex flex-col gap-1.5">
            <span className="cf-accent text-[10px] cf-dim2">REROUTING</span>
            <button
              onClick={() => setSettings((s) => ({ ...s, rerouteEnabled: !s.rerouteEnabled }))}
              aria-pressed={settings.rerouteEnabled}
              className="cf-focus cf-btn-outline rounded-lg px-3 py-2 cf-mono text-sm text-left"
              style={settings.rerouteEnabled ? { color: "var(--cf-green)", borderColor: "var(--cf-green)" } : {}}>
              {settings.rerouteEnabled ? "ON" : "OFF"}
            </button>
          </label>
        </div>

        <button
          onClick={() => onCreate(venueJson, settings)} disabled={busy}
          className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
          {busy ? "Creating…" : "Create session"}
        </button>
        <div className="mt-4"><ErrorNote error={error} /></div>
      </div>
    </div>
  );
}

/** Start / pause / stop, plus the tick clock. Disabled states follow the session's status. */
function SessionControls({ info, busy, onStart, onPause, onStop, connected }) {
  const status = info?.status ?? "CREATED";
  const terminal = status === "STOPPED" || status === "COMPLETED";
  return (
    <div className="cf-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="cf-accent text-[10px] cf-dim2">SESSION</span>
        <ConnectionPill connected={connected} status={status} />
      </div>
      <div className="cf-mono text-[11px] cf-dim2 mb-1">{info?.sessionId}</div>
      <div className="cf-mono text-sm mb-4">
        TICK {info?.tick ?? 0} / {info?.maxTicks ?? 0}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={onStart} disabled={busy || terminal || status === "RUNNING"}
          className="cf-focus cf-btn-primary rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">START</button>
        <button onClick={onPause} disabled={busy || status !== "RUNNING"}
          className="cf-focus cf-btn-outline rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">PAUSE</button>
        <button onClick={onStop} disabled={busy || terminal}
          className="cf-focus cf-btn-outline rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">STOP</button>
      </div>
    </div>
  );
}

function ClientApp({ session, navigate, signOut }) {
  const [tab, setTab] = useState("Live");
  const [upload, setUpload] = useState(null);
  const [traced, setTraced] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const flow = useCrowdFlow();
  const { venue, people, info, metrics, advisory, aiStatus, reroutePath, connected, busy, error } = flow;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { setUpload(reader.result); setTraced(false); };
    reader.readAsDataURL(file);
  };

  return (
    <PortalShell role="client" session={session} navigate={navigate} signOut={signOut}
      tabs={["Live", "Floor plans", "Halls"]} active={tab} setActive={setTab}>

      {tab === "Live" && !venue && (
        <SessionSetup onCreate={flow.create} busy={busy} error={error} />
      )}

      {tab === "Live" && venue && (
        <div className="grid lg:grid-cols-[1fr_19rem] gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
                <div className="cf-mono text-[11px] cf-dim2">{venue.id}</div>
              </div>
              <button onClick={flow.leave} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                NEW SESSION
              </button>
            </div>
            <VenueMap venue={venue} people={people} me={null} route={reroutePath} height={520}
              underlay={traced ? upload : null} />
            <p className="cf-mono text-[10px] cf-dim2 mt-2">
              {people.length} of {metrics?.peopleInside ?? 0} agents drawn · positions sampled server-side
              {reroutePath && " · orange line is the active diversion"}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <SessionControls info={info} busy={busy} connected={connected}
              onStart={flow.start} onPause={flow.pause} onStop={flow.stop} />

            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-4">INSIDE NOW</div>
              <div className="cf-display font-black text-4xl mb-1">
                {(metrics?.peopleInside ?? 0).toLocaleString()}
              </div>
              <div className="cf-mono text-[11px] cf-dim2 mb-4">
                OF {venue.capacity.toLocaleString()} CAPACITY · {metrics?.exited ?? 0} LEFT
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${Math.min(100, ((metrics?.peopleInside ?? 0) / Math.max(1, venue.capacity)) * 100)}%`,
                  background: "linear-gradient(90deg, var(--cf-orange), var(--cf-red))",
                }} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t cf-hairline">
                <div>
                  <div className="text-[10px] cf-mono cf-dim2 mb-0.5">PEAK DENSITY</div>
                  <div className="cf-mono font-semibold">{Math.round((metrics?.peakDensity ?? 0) * 100)}%</div>
                </div>
                <div>
                  <div className="text-[10px] cf-mono cf-dim2 mb-0.5">CRITICAL TICKS</div>
                  <div className="cf-mono font-semibold">{metrics?.criticalNodeTicks ?? 0}</div>
                </div>
              </div>
            </div>

            <div className="cf-card rounded-2xl p-5 flex-1">
              <div className="cf-accent text-[10px] cf-dim2 mb-4">ZONE STATUS</div>
              <div className="flex flex-col gap-3">
                {venue.halls.map((h) => (
                  <div key={h.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm truncate pr-2">{h.name}</span>
                      <span className="cf-mono text-[11px] shrink-0" style={{ color: densityColor(h.density) }}>{Math.round(h.density * 100)}%</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, h.density * 100)}%`, background: densityColor(h.density) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="cf-card rounded-2xl p-5" style={advisory ? { borderColor: "rgba(225,6,0,.35)" } : {}}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-3.5 h-3.5 ${advisory ? "cf-red" : "cf-dim2"}`} />
                <span className={`cf-accent text-[10px] ${advisory ? "cf-red" : "cf-dim2"}`}>ADVISORY</span>
              </div>
              <p className="text-sm cf-dim leading-relaxed">
                {advisory ?? "No advisory yet — the AI layer is called once density moves enough to be worth asking about."}
              </p>
              {aiStatus && <div className="cf-mono text-[10px] cf-dim2 mt-3">AI · {aiStatus}</div>}
            </div>

            <ErrorNote error={error} />
          </div>
        </div>
      )}

      {tab === "Floor plans" && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Upload your floor plan</div>
            <p className="text-sm cf-dim leading-relaxed mb-5">
              Any flat 2D image works — a PDF export, a photo of a printed plan, an architect's PNG.
              It becomes the underlay your zones are traced onto.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              className="cf-focus rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center px-6 py-14 cursor-pointer transition-all"
              style={{ borderColor: dragOver ? "var(--cf-orange)" : "var(--cf-line2)", background: dragOver ? "rgba(255,106,0,0.06)" : "transparent" }}>
              <Upload className="w-7 h-7 cf-dim2 mb-4" strokeWidth={1.6} />
              <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1.5">
                {upload ? "Replace floor plan" : "Drop an image or click to browse"}
              </div>
              <p className="text-xs cf-dim2">PNG, JPG or WEBP · processed in your browser, never uploaded</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>

            {upload && (
              <div className="mt-5 flex flex-col gap-4">
                <div className="rounded-xl overflow-hidden border cf-hairline">
                  <img src={upload} alt="Uploaded floor plan preview" className="w-full max-h-64 object-contain" style={{ background: "#070B12" }} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setTraced(true)} disabled={traced}
                    className="cf-focus cf-btn-primary rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide flex-1 disabled:opacity-50">
                    {traced ? "Traced ✓" : "Trace into map"}
                  </button>
                  <button onClick={() => { setUpload(null); setTraced(false); }} aria-label="Remove floor plan"
                    className="cf-focus cf-btn-outline rounded-xl px-4 flex items-center justify-center">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Generated map</div>
            <p className="text-sm cf-dim leading-relaxed mb-5">
              Zones, corridors and gates laid over your plan. Drag to pan, pinch or use the controls to zoom.
            </p>
            {venue ? (
              <>
                <VenueMap venue={venue} people={[]} me={null} height={420} underlay={traced ? upload : null} underlayOpacity={0.35} showPeople={false} />
                {!upload && (
                  <p className="text-xs cf-dim2 mt-3 leading-relaxed">
                    Showing the layout from the live session. Upload a plan to see it underlaid here.
                  </p>
                )}
              </>
            ) : (
              <div className="cf-card rounded-2xl px-6 py-14 text-center">
                <p className="text-sm cf-dim">Create a session on the Live tab to see its layout here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "Halls" && !venue && (
        <div className="cf-card rounded-2xl px-6 py-14 text-center">
          <p className="text-sm cf-dim">Create a session on the Live tab to list its zones.</p>
        </div>
      )}

      {tab === "Halls" && venue && (
        <div className="cf-card rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_10rem] gap-4 px-6 py-3 border-b cf-hairline cf-accent text-[11px] cf-dim2">
            <span>HALL</span><span>TYPE</span><span>OCCUPANCY</span><span>STATUS</span>
          </div>
          {venue.halls.map((h) => {
            const Icon = ZONE_ICON[h.type] ?? Armchair;
            return (
              <div key={h.id} className="grid sm:grid-cols-[1fr_8rem_8rem_10rem] gap-4 items-center px-6 py-4 border-b cf-hairline last:border-b-0 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg cf-chip flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{h.name}</div>
                    <div className="cf-mono text-[10px] cf-dim2">
                      {h.occupancy ?? 0} / {h.capacity}
                    </div>
                  </div>
                </div>
                <span className="cf-mono text-xs cf-dim2">{h.type}</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, h.density * 100)}%`, background: densityColor(h.density) }} />
                  </div>
                  <span className="cf-mono text-xs">{Math.round(h.density * 100)}%</span>
                </div>
                {/* The server has already banded this; showing its label rather than
                    re-deriving one keeps the table agreeing with the map and the alert feed. */}
                <span className="cf-mono text-[11px]" style={{ color: (STATUS_META[h.status] ?? STATUS_META.OK).c }}>
                  {(STATUS_META[h.status] ?? STATUS_META.OK).l}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PortalShell>
  );
}

/* ---- Admin portal ---- */

/**
 * Polls GET /sessions. Every session on the backend, newest first — baseline twins excluded
 * server-side, since a shadow run is an implementation detail and not something to operate.
 *
 * ponytail: a 4s poll, not a socket. The session list changes only when somebody creates or
 * stops a run; opening a second WebSocket to learn that would cost more than it saves. The
 * live numbers inside a session still arrive on its own stream.
 */
function useSessionList(intervalMs = 4000) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await api.listSessions();
        if (!cancelled) { setSessions(list); setError(null); }
      } catch (cause) {
        if (!cancelled) setError(cause.message);
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [intervalMs]);

  return { sessions, error };
}

function AdminApp({ session, navigate, signOut }) {
  const [tab, setTab] = useState("Overview");
  const { sessions, error: listError } = useSessionList();
  const flow = useCrowdFlow();
  const { venue, people, frame, alerts, connected, info } = flow;

  // Follow the first running session by default, so the overview is populated on arrival
  // rather than requiring a click to show anything at all.
  useEffect(() => {
    if (flow.sessionId || !sessions.length) return;
    const target = sessions.find((s) => s.status === "RUNNING") ?? sessions[0];
    flow.attach(target.sessionId).catch(() => {});
  }, [sessions, flow.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => ({
    venues: new Set(sessions.map((s) => s.venueId)).size,
    inside: sessions.reduce((sum, s) => sum + (s.peopleInside ?? 0), 0),
    critical: (frame?.nodes ?? []).filter((n) => n.status === "CRITICAL").length,
    peakRisk: Math.max(0, ...Object.values(frame?.predictedRisk ?? {})),
  }), [sessions, frame]);

  /** Alerts newest first, which is the only order a live feed makes sense in. */
  const incidents = useMemo(() => [...alerts].reverse(), [alerts]);

  return (
    <PortalShell role="admin" session={session} navigate={navigate} signOut={signOut}
      tabs={["Overview", "Venues", "Incidents"]} active={tab} setActive={setTab}>

      {tab === "Overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { v: totals.venues, l: "ACTIVE VENUES" },
              { v: totals.inside.toLocaleString(), l: "PEOPLE INSIDE" },
              { v: totals.critical, l: "ZONES CRITICAL", c: totals.critical ? "var(--cf-red)" : undefined },
              { v: totals.peakRisk.toFixed(2), l: "PEAK PREDICTED RISK", c: "var(--cf-orange)" },
            ].map((s) => (
              <div key={s.l} className="cf-card rounded-2xl p-6">
                <div className="cf-display font-black text-3xl mb-1" style={{ color: s.c || "var(--cf-ink)" }}>{s.v}</div>
                <div className="cf-accent text-[10px] cf-dim2">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="mb-4"><ErrorNote error={listError ?? flow.error} /></div>
          <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {sessions.map((s) => (
                  <button key={s.sessionId} onClick={() => flow.attach(s.sessionId)}
                    className="cf-focus cf-accent text-[11px] rounded-lg px-4 py-2 transition-colors"
                    style={s.sessionId === flow.sessionId
                      ? { background: "color-mix(in oklab, var(--cf-red) 18%, transparent)", color: "var(--cf-red)", border: "1px solid var(--cf-red)" }
                      : { border: "1px solid var(--cf-line)", color: "var(--cf-dim)" }}>
                    {s.venueName} · {s.status}
                  </button>
                ))}
                {!sessions.length && (
                  <span className="text-sm cf-dim">No sessions running. Open the client portal to create one.</span>
                )}
                {flow.sessionId && <ConnectionPill connected={connected} status={info?.status} />}
              </div>
              {venue ? (
                <VenueMap venue={venue} people={people} me={null} height={480} />
              ) : (
                <div className="cf-card rounded-2xl px-6 py-20 text-center">
                  <p className="text-sm cf-dim">Select a session to watch its map.</p>
                </div>
              )}
            </div>
            <div className="cf-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="w-3.5 h-3.5 cf-orange" />
                <span className="cf-accent text-[10px] cf-dim2">LIVE FEED</span>
              </div>
              <div className="flex flex-col gap-4">
                {incidents.map((inc) => (
                  <div key={inc.id} className="flex gap-3">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                      style={{ background: (STATUS_META[inc.severity] ?? STATUS_META.OK).c }} />
                    <div className="min-w-0">
                      <div className="cf-mono text-[10px] cf-dim2 mb-0.5">
                        TICK {inc.tick} · {Math.round(inc.density * 100)}%
                      </div>
                      <div className="text-sm leading-snug">{zoneName(venue, inc.nodeId)}</div>
                      <div className="text-xs cf-dim leading-snug mt-0.5">{inc.message}</div>
                    </div>
                  </div>
                ))}
                {!incidents.length && (
                  <p className="text-sm cf-dim">Nothing raised yet. Alerts appear as zones cross the warning line.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "Venues" && (
        <div className="cf-card rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_9rem_8rem_8rem_8rem] gap-4 px-6 py-3 border-b cf-hairline cf-accent text-[11px] cf-dim2">
            <span>VENUE</span><span>SESSION</span><span>CROWD</span><span>INSIDE</span><span>STATUS</span>
          </div>
          {sessions.map((s) => {
            const meta = SESSION_STATUS_META[s.status] ?? SESSION_STATUS_META.CREATED;
            return (
              <div key={s.sessionId} className="grid sm:grid-cols-[1fr_9rem_8rem_8rem_8rem] gap-4 items-center px-6 py-4 border-b cf-hairline last:border-b-0 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg cf-chip flex items-center justify-center shrink-0"><Building2 className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{s.venueName}</div>
                    <div className="cf-mono text-[10px] cf-dim2">
                      tick {s.tick} / {s.maxTicks} · {s.viewers} watching
                    </div>
                  </div>
                </div>
                <span className="cf-mono text-xs cf-dim2 truncate">{s.sessionId}</span>
                <span className="cf-mono text-xs">{s.crowdSize.toLocaleString()}</span>
                <span className="cf-mono text-xs">{(s.peopleInside ?? 0).toLocaleString()}</span>
                <span className="cf-mono text-[11px]" style={{ color: meta.c }}>{meta.l}</span>
              </div>
            );
          })}
          {!sessions.length && (
            <div className="px-6 py-14 text-center"><p className="text-sm cf-dim">No sessions yet.</p></div>
          )}
        </div>
      )}

      {tab === "Incidents" && (
        <div className="cf-card rounded-2xl overflow-hidden">
          {incidents.map((inc) => {
            const meta = STATUS_META[inc.severity] ?? STATUS_META.OK;
            return (
              <div key={inc.id} className="flex items-start gap-4 px-6 py-5 border-b cf-hairline last:border-b-0">
                <span className="cf-mono text-xs cf-dim2 shrink-0 w-12">t{inc.tick}</span>
                <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: meta.c }} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">
                    {zoneName(venue, inc.nodeId)}
                    <span className="cf-dim2 cf-mono text-[11px] ml-2">{Math.round(inc.density * 100)}% · {inc.trend}</span>
                  </div>
                  <div className="text-sm cf-dim mt-0.5">{inc.message}</div>
                </div>
                <span className="cf-mono text-[10px] shrink-0" style={{ color: meta.c }}>{meta.l}</span>
              </div>
            );
          })}
          {!incidents.length && (
            <div className="px-6 py-14 text-center">
              <p className="text-sm cf-dim">No incidents on this session.</p>
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}

/** Alerts carry a node id; the readable name lives on the venue. Falls back to the id. */
function zoneName(venue, nodeId) {
  return venue?.halls.find((h) => h.id === nodeId)?.name ?? nodeId;
}

/* ============================================================================
   Footer
   ========================================================================== */

function Footer({ navigate }) {
  return (
    <footer className="border-t cf-hairline relative" style={{ background: "rgba(5,7,11,0.6)" }}>
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid md:grid-cols-[2fr_1fr_1fr] gap-10 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--cf-red), var(--cf-orange))" }}>
                <Flag className="w-4 h-4 text-white" strokeWidth={2.5} />
              </span>
              <span className="cf-display font-bold uppercase tracking-wide text-base">Crowd Flow Optimiser</span>
            </div>
            <p className="cf-dim text-sm leading-relaxed max-w-sm">
              Simulate the venue, predict the bottleneck, route around it — before the queue becomes a crush.
            </p>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PLATFORM</div>
            <div className="flex flex-col gap-2">
              {NAV.map((r) => (
                <a key={r.path} href={`#${r.path}`} onClick={(e) => { e.preventDefault(); navigate(r.path); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-colors">{r.label}</a>
              ))}
            </div>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PORTALS</div>
            <div className="flex flex-col gap-2">
              {Object.values(ROLES).map((r) => (
                <a key={r.key} href={`#/login/${r.key}`} onClick={(e) => { e.preventDefault(); navigate(`/login/${r.key}`); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-colors">{r.label}</a>
              ))}
            </div>
          </div>
        </div>
        <p className="cf-dim2 text-xs cf-mono border-t cf-hairline pt-8">
          BUILT FOR GEEK ROOM AI RACE MONTH · GRANDPRIX — PROBLEM STATEMENT #3
        </p>
      </div>
    </footer>
  );
}

/* ============================================================================
   App
   ========================================================================== */

export default function CrowdFlowApp() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [route]);

  const signIn = (s) => setSession(s);
  const signOut = () => setSession(null);

  const isPortal = route.startsWith("/app/");
  const loginMatch = route.match(/^\/login\/(walker|client|admin)$/);
  const appMatch = route.match(/^\/app\/(walker|client|admin)$/);

  let page;
  if (loginMatch) {
    page = <LoginPage roleKey={loginMatch[1]} navigate={navigate} signIn={signIn} />;
  } else if (appMatch) {
    const role = appMatch[1];
    if (!session) {
      page = <LoginPage roleKey={role} navigate={navigate} signIn={signIn} />;
    } else if (role === "walker") {
      page = <WalkerApp session={session} navigate={navigate} signOut={signOut} />;
    } else if (role === "client") {
      page = <ClientApp session={session} navigate={navigate} signOut={signOut} />;
    } else {
      page = <AdminApp session={session} navigate={navigate} signOut={signOut} />;
    }
  } else {
    switch (route) {
      case "/platform": page = <PlatformPage navigate={navigate} />; break;
      case "/intelligence": page = <IntelligencePage />; break;
      case "/results": page = <ResultsPage />; break;
      case "/access": page = <AccessPage navigate={navigate} />; break;
      default: page = <HomePage navigate={navigate} />;
    }
  }

  return (
    <div className="cf-root">
      <style>{STYLE}</style>
      <MeshField />
      <div className="relative" style={{ zIndex: 2 }}>
        <Header route={route} navigate={navigate} session={session} signOut={signOut} />
        <main key={route}>{page}</main>
        {!isPortal && <Footer navigate={navigate} />}
      </div>
    </div>
  );
}
