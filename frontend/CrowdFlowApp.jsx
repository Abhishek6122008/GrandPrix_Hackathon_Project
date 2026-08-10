import React, {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { api } from "./src/api.js";
import { useCrowdFlow } from "./src/useCrowdFlow.js";
import { toMapVenue } from "./src/venueAdapter.js";
import sampleVenue from "./src/sampleVenue.json";
import LayoutStudio from "./src/LayoutStudio.jsx";
import {
  TRAFFIC_BANDS, planRoute, rankHazards, hazardWarning, trafficBand,
} from "./src/crowdRouting.js";
import {
  normaliseCode, codeError, suggestCode, resolveSessionForCode,
} from "./src/venueCode.js";
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
    /* Entrance/exit signage. Green in, violet out — the pairing reads at a glance and does not
       collide with the density ramp, which owns green→amber→orange→red. */
    --cf-violet:#A855F7;
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

  @media (prefers-reduced-motion: reduce){
    .cf-mesh span{ animation:none !important; }
    .cf-marquee-track,.cf-dash,.cf-flow,.cf-bounce,.cf-ping,.cf-pulse{ animation:none !important; }
    .cf-reveal{ opacity:1 !important; transform:none !important; transition:none !important; }
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

/**
 * A number that counts to its new value instead of jumping.
 *
 * Used on the live metrics, where the value changes five times a second. The point is
 * not decoration: a figure that snaps between 1,840 and 1,920 is read as noise, while
 * one that travels is read as a direction — which is the thing an operator is actually
 * looking for. Short duration so it has always settled before the next frame lands.
 *
 * Falls straight through to the plain number under `prefers-reduced-motion`.
 */
function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 400 }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (reduced) { setShown(value); return undefined; }

    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return undefined;

    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // easeOutCubic: fast to start, settles gently — reads as arriving, not sliding.
      const eased = 1 - (1 - t) ** 3;
      setShown(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, reduced]);

  // Keep the start point honest when a re-render interrupts an animation in flight.
  useEffect(() => { if (reduced) fromRef.current = value; }, [value, reduced]);

  return <>{format(shown)}</>;
}

/**
 * A live value whose colour and width both track a 0–1 ratio.
 *
 * One component rather than a bar and a number wired up separately at each call site,
 * because the two must never disagree — a bar drawn from density and a percentage
 * printed from occupancy is exactly how a dashboard starts lying.
 */
function DensityBar({ density, height = 4, color }) {
  const reduced = usePrefersReducedMotion();
  const pct = Math.min(100, Math.max(0, (density ?? 0) * 100));
  return (
    <div className="rounded-full bg-white/5 overflow-hidden" style={{ height }}>
      <motion.div className="h-full rounded-full"
        initial={false}
        animate={{ width: `${pct}%`, background: color ?? trafficBand(density).color }}
        transition={reduced ? { duration: 0 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
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
    blurb: "Type the venue code from the signage at your entrance and the map loads with you on it. Routes are coloured by how crowded they actually are right now — blue is clear, red is a crush — and the way out you're shown goes around the jam, not through it.",
    can: ["A live map of the venue you checked into", "A route out that avoids the crowds", "Colour-coded congestion on every path", "Water points, restrooms, concessions"],
    cannot: ["Other attendees' identities or positions", "Venue analytics or capacity figures", "Anything outside the venue geofence"],
  },
  client: {
    key: "client", label: "Client", who: "Venue owners & organisers", color: "var(--cf-orange)", Icon: Building2,
    tagline: "Upload a floor plan. Get a live map.",
    blurb: "Drop in a flat 2D image of your venue and AI traces it into a working map — halls, corridors, gates, and the pathways between them. Set a venue code for your signage, then it's live: occupancy per zone, and warnings the moment an area starts becoming dangerous.",
    can: ["AI tracing of 2D floor plans into pathways", "A venue code attendees check in with", "Live occupancy and crowd-safety warnings", "Reroute advisories as zones fill"],
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

  /** Venues stored on the backend, whether or not anything is running on them. */
  const [storedVenues, setStoredVenues] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.listVenues()
      .then((list) => { if (!cancelled) setStoredVenues(list ?? []); })
      .catch(() => { /* older backend without GET /venues — live sessions still work */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Every venue an attendee could check into, live ones first.
   *
   * Merged by code rather than concatenated, so a venue that is both stored and running
   * appears once — marked live, which is the state that matters to someone standing in it.
   */
  const knownVenues = useMemo(() => {
    const byCode = new Map();
    for (const v of storedVenues) {
      const code = normaliseCode(v.id);
      if (code) byCode.set(code, { code, name: v.name ?? code, live: false });
    }
    for (const s of sessions) {
      const code = normaliseCode(s.venueId);
      if (!code) continue;
      byCode.set(code, { code, name: s.venueName ?? code, live: s.status === "RUNNING" });
    }
    return [...byCode.values()].sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
  }, [storedVenues, sessions]);
  const flow = useCrowdFlow();
  const { venue, rawVenue, frame, info, connected } = flow;

  // Where the attendee says they are. The backend has no per-person GPS — it simulates a crowd,
  // it does not track your phone — so this is zone-level and self-declared, and the UI says so
  // rather than drawing a false 3-metre accuracy circle.
  const [atNodeId, setAtNodeId] = useState(null);
  const [destinationId, setDestinationId] = useState(null);

  /**
   * Check in with the venue code from the signage, not a session id.
   *
   * The code resolves against the live session list rather than being sent to the
   * backend, because a venue code is a venue id and `GET /sessions` already reports
   * which session is running on which venue. Falling back to attaching the typed value
   * directly keeps a raw session id working for anyone reading one off the admin
   * console.
   */
  const join = async () => {
    const code = normaliseCode(entered);
    const invalid = codeError(code);
    if (invalid) { setJoinError(invalid); return; }

    setJoinError("");
    const match = resolveSessionForCode(sessions, code);

    try {
      if (match) {
        await flow.attach(match.sessionId);
        return;
      }
      // No live session on that code. The venue itself may still exist — it is stored on
      // disk and outlives any run — so show the map without live crowd rather than
      // telling someone standing in the building that their venue does not exist.
      await flow.attachVenue(code);
    } catch (cause) {
      setJoinError(
        cause.status === 404
          ? `No venue found with the code "${code}". Check the code on the signage at your entrance.`
          : cause.message,
      );
    }
  };

  // Default to a gate — where you would actually be when you walk in.
  useEffect(() => {
    if (venue && !atNodeId) {
      setAtNodeId((venue.halls.find((h) => h.type === "GATE") ?? venue.halls[0])?.id ?? null);
    }
  }, [venue, atNodeId]);

  /**
   * The route, recomputed against live density.
   *
   * Client-side rather than `GET /venues/{id}/route`: the server's route is by distance
   * only and cannot see the frame, so it happily routes through the jam. This runs the
   * same graph with a congestion penalty — see src/crowdRouting.js — and it re-plans as
   * the crowd moves, which is the entire point of showing an attendee a route at all.
   */
  const route = useMemo(
    () => planRoute(rawVenue, venue, atNodeId, frame,
      destinationId ? { toNodeId: destinationId } : {}),
    [rawVenue, venue, atNodeId, frame, destinationId],
  );

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
              <h1 className="cf-display font-black uppercase text-3xl tracking-tight mb-2">Check in</h1>
              <p className="text-sm cf-dim leading-relaxed mb-7">
                Type the venue code from the signage at your entrance. The map loads live
                from the venue's own simulation, so what you see is what the operators see.
              </p>
              <input value={entered} onChange={(e) => setEntered(normaliseCode(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="WEMBLEY-01"
                aria-label="Venue code"
                autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                className="cf-input cf-focus w-full rounded-xl px-4 py-4 text-lg cf-display font-bold tracking-[0.3em] text-center mb-4" />
              {joinError && <p className="text-sm mb-4" style={{ color: "var(--cf-red)" }}>{joinError}</p>}
              <button onClick={join} disabled={flow.busy}
                className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
                {flow.busy ? "Checking in…" : "Check in"}
              </button>

              {/* Known venues, by code. Live ones first and marked as such, but the stored
                  ones are listed too — a venue between runs is still a venue you can look
                  at, and hiding it makes a printed code look broken. */}
              {knownVenues.length > 0 && (
                <>
                  <div className="cf-accent text-[10px] cf-dim2 mt-6 mb-2">VENUES</div>
                  <div className="flex flex-wrap gap-2">
                    {knownVenues.map((v) => (
                      <button key={v.code} onClick={() => setEntered(v.code)}
                        className="cf-focus cf-chip rounded-lg px-3 py-2 text-left transition-colors hover:border-white/20">
                        <span className="cf-display font-bold text-[11px] tracking-wider block">
                          {v.code}
                        </span>
                        <span className="cf-mono text-[9px] flex items-center gap-1"
                          style={{ color: v.live ? "var(--cf-green)" : "var(--cf-dim2)" }}>
                          {v.live && (
                            <span className="w-1.5 h-1.5 rounded-full cf-pulse"
                              style={{ background: "var(--cf-green)" }} />
                          )}
                          {v.live ? "LIVE" : v.name}
                        </span>
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

  return (
    <PortalShell role="walker" session={session} navigate={navigate} signOut={signOut}>
      <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
        <div>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
              <div className="cf-mono text-[11px] cf-dim2">
                CODE {normaliseCode(info?.venueId ?? venue.id)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionPill connected={connected} status={info?.status} />
              <button onClick={() => { flow.leave(); setAtNodeId(null); setDestinationId(null); }}
                className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                CHANGE VENUE
              </button>
            </div>
          </div>

          {/* The banner an attendee actually needs: is the way I am being sent clear? */}
          <RouteBanner route={route} venue={venue} />

          {/* Density on, crowd dots off: an attendee should see that a zone is busy without
              being shown where every other individual is standing. */}
          <VenueMap venue={venue} people={[]} me={me} trafficRoute={route}
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

          {/* Turn-by-turn, coloured by what each leg is like to walk. */}
          <RouteSteps route={route} venue={venue} />

          <div className="cf-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="cf-accent text-[10px] cf-dim2">EXITS</span>
              {destinationId && (
                <button onClick={() => setDestinationId(null)}
                  className="cf-focus cf-btn-ghost cf-mono text-[9px]">CLEAR</button>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {exits.map((h) => {
                const band = trafficBand(h.density);
                const chosen = destinationId === h.id
                  || (!destinationId && route?.destination === h.id);
                return (
                  <button key={h.id}
                    onClick={() => setDestinationId(h.id === destinationId ? null : h.id)}
                    className="cf-focus flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={chosen
                      ? { background: "rgba(255,255,255,0.05)", border: `1px solid ${band.color}` }
                      : { border: "1px solid transparent" }}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <LogOut className="w-3.5 h-3.5 shrink-0" style={{ color: band.color }} />
                      <span className="text-sm truncate">{h.name}</span>
                    </span>
                    <span className="cf-mono text-[10px] shrink-0" style={{ color: band.color }}>
                      {band.label}
                    </span>
                  </button>
                );
              })}
              {!exits.length && <p className="text-sm cf-dim">This venue has no marked exit.</p>}
            </div>
            {exits.length > 0 && (
              <p className="cf-mono text-[9px] cf-dim2 mt-2.5">TAP AN EXIT TO ROUTE THERE</p>
            )}
          </div>

          {venue.pois.length > 0 && (
            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">FACILITIES</div>
              <div className="flex flex-col gap-2">
                {venue.pois.map((p) => {
                  const Icon = POI_ICON[p.kind] ?? MapPin;
                  return (
                    <button key={p.id} onClick={() => setDestinationId(p.id.replace(/^poi-/, ""))}
                      className="cf-focus flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                      <Icon className="w-3.5 h-3.5 cf-blue-hi shrink-0" />
                      <span className="text-sm">{p.name}</span>
                    </button>
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

/**
 * The one-line verdict on the route an attendee is being shown.
 *
 * Sits above the map rather than in the sidebar because on a phone the sidebar is below
 * the fold, and "the route you are about to walk runs through a crush" is not something
 * to make anyone scroll for.
 */
export function RouteBanner({ route, venue }) {
  const reduced = useReducedMotion();
  if (!route) return null;

  const destination = zoneName(venue, route.destination);
  const minutes = Math.max(1, Math.round(route.etaSeconds / 60));

  const tone = route.noClearRoute
    ? { color: "var(--cf-red)", Icon: AlertTriangle,
        title: "Every route out is congested right now",
        body: `The clearest way to ${destination} still passes through heavy crowd. Move calmly and follow steward instructions.` }
    : route.detoured
      ? { color: "var(--cf-amber)", Icon: Navigation,
          title: `Routed around the crowd to ${destination}`,
          body: `${route.avoided ? `${zoneName(venue, route.avoided)} is congested, so this route goes around it. ` : ""}About ${route.detourCost}m further, and it keeps moving.` }
      : { color: "var(--cf-blue-hi)", Icon: Navigation,
          title: `Clear route to ${destination}`,
          body: `${route.distance}m, roughly ${minutes} minute${minutes === 1 ? "" : "s"} at walking pace.` };

  return (
    <motion.div
      key={`${route.destination}-${route.noClearRoute}-${route.detoured}`}
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="cf-card rounded-xl px-4 py-3.5 mb-4 flex items-start gap-3"
      style={{ borderColor: `color-mix(in oklab, ${tone.color} 45%, transparent)` }}>
      <tone.Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: tone.color }} strokeWidth={2} />
      <div className="min-w-0">
        <div className="cf-display font-bold uppercase text-sm tracking-wide"
          style={{ color: tone.color }}>{tone.title}</div>
        <p className="text-sm cf-dim leading-relaxed mt-0.5">{tone.body}</p>
      </div>
    </motion.div>
  );
}

/**
 * Turn-by-turn legs, each carrying the colour of the zone it enters.
 *
 * Named zones rather than "in 40m turn left": the venue graph has no bearings, so a
 * direction here would be invented. Zone names are what the signage says anyway.
 */
export function RouteSteps({ route, venue }) {
  const reduced = useReducedMotion();
  if (!route?.segments?.length) return null;

  return (
    <div className="cf-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="cf-accent text-[10px] cf-dim2">YOUR WAY OUT</span>
        <span className="cf-mono text-[10px]" style={{ color: route.band.color }}>
          {route.distance}m
        </span>
      </div>
      <div className="flex flex-col">
        {route.path.map((nodeId, i) => {
          const segment = route.segments[i - 1];
          const band = segment?.band;
          const last = i === route.path.length - 1;
          return (
            <motion.div key={nodeId}
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: reduced ? 0 : i * 0.05 }}
              className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                  style={{
                    background: i === 0 ? "var(--cf-blue-hi)" : last ? "var(--cf-violet)" : band?.color,
                    boxShadow: i === 0 ? "0 0 0 3px rgba(77,141,240,.2)" : undefined,
                  }} />
                {!last && (
                  <span className="w-0.5 flex-1 my-1 rounded-full"
                    style={{ background: route.segments[i]?.band.color ?? "var(--cf-line)" }} />
                )}
              </div>
              <div className={`min-w-0 ${last ? "" : "pb-3"}`}>
                <div className="text-sm font-semibold truncate">{zoneName(venue, nodeId)}</div>
                <div className="cf-mono text-[9px] cf-dim2">
                  {i === 0 ? "YOU ARE HERE" : last ? "DESTINATION" : band?.label}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Client portal ---- */

/**
 * Session setup: upload a venue layout and open a run on it.
 *
 * The venue travels inline in POST /sessions, so there is no separate upload step — the file
 * you drop is the graph the simulation runs on.
 */
function SessionSetup({ onCreate, busy, error, initialVenue = null, onNeedsTracing = null }) {
  const [venueJson, setVenueJson] = useState(initialVenue ?? sampleVenue);
  const [fileName, setFileName] = useState(
    initialVenue ? `${initialVenue.name ?? "Traced venue"} (AI-traced)` : "venue-layout-sample.json",
  );
  const [parseError, setParseError] = useState(null);

  /**
   * The venue code — what goes on the signage and what attendees type to check in.
   *
   * It becomes the venue's `id`, which is client-supplied on `POST /venues` and carried
   * on every SessionInfo, so no new backend field is needed for this to work end to end.
   */
  const [code, setCode] = useState(() =>
    normaliseCode(initialVenue?.id ?? "") || suggestCode(initialVenue?.name ?? sampleVenue.name));
  const [codeTouched, setCodeTouched] = useState(false);

  const [settings, setSettings] = useState({
    // 6000 ticks ≈ 10 minutes of wall clock: the backend runs one tick every 100ms.
    //
    // The old 1200 ended a run after two minutes, and because a finished session stops
    // broadcasting, the map simply froze — which reads as "the live simulation is
    // broken" rather than "the run you asked for is over". Ten minutes outlasts any
    // demo; STOP is there when it should end sooner.
    crowdSize: 2500, arrivalRate: 25, maxTicks: 6000, rerouteEnabled: true,
  });
  const fileRef = useRef(null);

  // A traced layout arriving from Layout Studio replaces whatever was loaded, and
  // re-suggests a code from its name — unless the operator has already typed one, which
  // is theirs to keep.
  useEffect(() => {
    if (!initialVenue) return;
    setVenueJson(initialVenue);
    setFileName(`${initialVenue.name ?? "Traced venue"} (AI-traced)`);
    setParseError(null);
    if (!codeTouched) setCode(suggestCode(initialVenue.name));
  }, [initialVenue]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeIssue = codeError(code);

  const readVenue = (file) => {
    if (!file) return;

    // An image is a floor plan, not a graph. It has to go through the tracer, which
    // lives on the AI layout tab — so hand it over rather than failing with a JSON
    // parse error that tells the operator nothing about what to do next.
    if (file.type.startsWith("image/")) {
      setParseError(null);
      onNeedsTracing?.(file);
      return;
    }

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
        if (!codeTouched) setCode(suggestCode(parsed.name));
      } catch (cause) {
        setParseError(`${file.name} is not a usable venue layout — ${cause.message}`);
      }
    };
    reader.readAsText(file);
  };

  /** Stamps the code onto the venue as its id, then opens the session on it. */
  const create = () => {
    if (codeIssue) return;
    onCreate({ ...venueJson, id: normaliseCode(code) }, settings);
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
          Drop a picture of your floor plan and it gets traced into a map. The sample arena
          is loaded and ready if you just want to see a crowd run.
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
          {/* Images first in the accept list, because a floor plan is what most people
              arrive with. A venue JSON is still accepted — it is what the tracer
              produces, so a layout traced once can be reused without re-tracing it. */}
          <input ref={fileRef} type="file"
            accept="image/png,image/jpeg,image/webp,application/json,.json"
            className="hidden"
            onChange={(e) => readVenue(e.target.files?.[0])} />
        </div>
        <p className="text-xs cf-dim2 mt-2.5">
          PNG, JPG or WEBP floor plan — or a venue JSON you traced earlier.
        </p>
        {parseError && <p className="text-sm mt-3" style={{ color: "var(--cf-red)" }}>{parseError}</p>}

        {/* The venue code. Deliberately on the layout side of the form rather than with
            the crowd settings: it identifies the building, and it outlives any one run. */}
        <div className="mt-6">
          <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Venue code</div>
          <p className="text-sm cf-dim leading-relaxed mb-4">
            Put this on your entrance signage. Attendees type it to check in and see the
            live map of your venue — it stays the same across every session you run here.
          </p>
          <input
            value={code}
            onChange={(e) => { setCode(normaliseCode(e.target.value)); setCodeTouched(true); }}
            aria-label="Venue code"
            aria-invalid={!!codeIssue}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="WEMBLEY-01"
            className="cf-input cf-focus w-full rounded-xl px-4 py-4 text-lg cf-display font-bold tracking-[0.3em] text-center" />
          {codeIssue
            ? <p className="text-sm mt-2" style={{ color: "var(--cf-red)" }}>{codeIssue}</p>
            : (
              <p className="cf-mono text-[10px] cf-dim2 mt-2">
                ATTENDEES CHECK IN WITH <span style={{ color: "var(--cf-orange)" }}>{normaliseCode(code)}</span>
              </p>
            )}
        </div>
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
          {field(
            // Ticks are the backend's unit but minutes are what an operator is
            // deciding, so show both rather than making them do the arithmetic.
            `RUN LENGTH · ~${Math.max(1, Math.round(settings.maxTicks / 600))} MIN`,
            "maxTicks", 1, 60000,
          )}
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
          onClick={create} disabled={busy || !!codeIssue}
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
      <div className="cf-mono text-sm mb-2">
        TICK {info?.tick ?? 0} / {info?.maxTicks ?? 0}
      </div>

      {/* Progress, because "TICK 1180 / 1200" does not read as "about to end".
          A run that finishes stops broadcasting and the map stops moving, so the one
          thing this panel has to convey is how much time is left. */}
      <div className="mb-4">
        <DensityBar height={3}
          density={(info?.tick ?? 0) / Math.max(1, info?.maxTicks ?? 1)}
          color={terminal ? "var(--cf-dim2)" : "var(--cf-blue-hi)"} />
      </div>

      {/* A finished run is the single most confusing state in the app: everything
          simply stops, with nothing on screen saying why. Say it plainly, and offer
          the way forward rather than leaving three disabled buttons. */}
      {terminal && (
        <div className="rounded-lg px-3 py-2.5 mb-3"
          style={{ background: "rgba(77,141,240,0.1)", border: "1px solid rgba(77,141,240,0.3)" }}>
          <div className="cf-mono text-[10px] mb-1" style={{ color: "var(--cf-blue-hi)" }}>
            {status === "COMPLETED" ? "RUN FINISHED" : "RUN STOPPED"}
          </div>
          <p className="text-xs cf-dim leading-relaxed">
            {status === "COMPLETED"
              ? `Reached tick ${info?.maxTicks ?? 0}, so the crowd has stopped moving. Start a new session to run again — raise MAX TICKS for a longer run.`
              : "You stopped this run. Start a new session to run again."}
          </p>
        </div>
      )}

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

/**
 * The operator's safety panel: which zones are dangerous, and what to do about each.
 *
 * Distinct from the admin Incidents feed, which is a *log* — every alert the backend has
 * raised, newest first, including ones that have since resolved. This is the opposite: a
 * live picture of what is wrong right now, ranked, with the one at the top being the one
 * to act on. A log is for the review afterwards; this is for the next thirty seconds.
 *
 * Capped at four. An operator scanning a phone during an incident reads the top of a
 * list, not the bottom, and a panel that lists every zone above 50% buries the crush
 * under the queues.
 */
export function HazardAlerts({ hazards }) {
  const reduced = useReducedMotion();
  const top = (hazards ?? []).slice(0, 4);

  const critical = top.filter((h) => hazardWarning(h).severity === "CRITICAL").length;

  return (
    <div className="cf-card rounded-2xl p-5"
      style={critical ? { borderColor: "rgba(225,6,0,.5)" } : {}}>
      <div className="flex items-center justify-between mb-4">
        <span className="flex items-center gap-2">
          <AlertTriangle className={`w-3.5 h-3.5 ${critical ? "cf-red cf-pulse" : "cf-dim2"}`} strokeWidth={2} />
          <span className={`cf-accent text-[10px] ${critical ? "cf-red" : "cf-dim2"}`}>
            CROWD SAFETY
          </span>
        </span>
        {critical > 0 && (
          <span className="cf-mono text-[9px] px-2 py-0.5 rounded"
            style={{ background: "rgba(225,6,0,.16)", color: "var(--cf-red)" }}>
            {critical} CRITICAL
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {top.map((hazard) => {
          const warning = hazardWarning(hazard);
          const colour = warning.severity === "CRITICAL" ? "var(--cf-red)"
            : warning.severity === "WARNING" ? "var(--cf-amber)" : "var(--cf-dim)";
          return (
            <motion.div key={hazard.hall.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden">
              <div className="flex gap-2.5 pb-3.5 mb-3.5 border-b cf-hairline last:border-b-0">
                <span className="w-1 rounded-full shrink-0" style={{ background: colour }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="cf-mono text-[9px]" style={{ color: colour }}>
                      {warning.severity}
                    </span>
                    <span className="cf-mono text-[9px] cf-dim2">
                      {Math.round(hazard.density * 100)}%
                      {hazard.rising && " ↑"}
                    </span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">{warning.title}</div>
                  <p className="text-xs cf-dim leading-relaxed mt-1">{warning.body}</p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!top.length && (
        <p className="text-sm cf-dim leading-relaxed">
          Every zone is below the warning line. Alerts appear here the moment one starts
          filling faster than it can clear.
        </p>
      )}
    </div>
  );
}

function ClientApp({ session, navigate, signOut }) {
  const [tab, setTab] = useState("Live");
  /** A venue graph the AI traced out of a floor plan, waiting to be turned into a run. */
  const [tracedVenue, setTracedVenue] = useState(null);

  /** A floor plan dropped on the Live tab, handed to Layout Studio to trace. */
  const [planToTrace, setPlanToTrace] = useState(null);

  const flow = useCrowdFlow();
  const { venue, people, frame, info, metrics, advisory, aiStatus, reroutePath, connected, busy, error } = flow;

  /** Zones worth an operator's attention, worst first. Recomputed per frame. */
  const hazards = useMemo(
    () => rankHazards(venue?.halls, frame?.predictedRisk),
    [venue?.halls, frame?.predictedRisk],
  );

  return (
    <PortalShell role="client" session={session} navigate={navigate} signOut={signOut}
      tabs={["Live", "AI layout"]} active={tab} setActive={setTab}>

      {tab === "Live" && !venue && (
        <SessionSetup onCreate={flow.create} busy={busy} error={error}
          initialVenue={tracedVenue}
          onNeedsTracing={(file) => { setPlanToTrace(file); setTab("AI layout"); }} />
      )}

      {tab === "Live" && venue && (
        <div className="grid lg:grid-cols-[1fr_19rem] gap-6">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
                {/* The code, given the prominence it needs: this is the string that has
                    to end up on the signage, and an operator should be able to read it
                    off this screen without hunting. */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="cf-accent text-[9px] cf-dim2">CHECK-IN CODE</span>
                  <span className="cf-display font-bold text-sm tracking-[0.25em] px-2 py-0.5 rounded"
                    style={{ background: "rgba(255,106,0,0.14)", color: "var(--cf-orange)" }}>
                    {normaliseCode(info?.venueId ?? venue.id)}
                  </span>
                </div>
              </div>
              <button onClick={flow.leave} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                NEW SESSION
              </button>
            </div>
            {/* No `route` here. The diversion polyline drew a single line from an entrance
                clean across to an exit, which read as a route every agent was taking rather
                than as one advisory path — and it appeared at the end of a run, when the last
                reroute happened to be the longest. The rerouted agents already carry an orange
                marker, which says the same thing without drawing a road that is not there. */}
            <VenueMap venue={venue} people={people} crowdTotal={metrics?.peopleInside ?? 0}
              me={null} height={520}
              // Schematic, not the generated floor art.
              //
              // The art looked better in isolation but could not keep its promise: its painted
              // walls and the venue graph are two different things that only approximately
              // agree, so agents legitimately placed by the simulation still landed on drawn
              // void. Here the zones and corridors on screen *are* the walkable mask, so a
              // figure outside them is impossible rather than merely unlikely.
              />
            <p className="cf-mono text-[10px] cf-dim2 mt-2">
              {(metrics?.peopleInside ?? 0).toLocaleString()} inside · drawn as crowd figures,
              positions sampled server-side
              {reroutePath && " · orange-tagged figures are being diverted"}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <SessionControls info={info} busy={busy} connected={connected}
              onStart={flow.start} onPause={flow.pause} onStop={flow.stop} />

            {/* Safety warnings, above the metrics: an operator scanning this column needs
                "the north concourse is about to become dangerous" before they need a
                headcount. */}
            <HazardAlerts hazards={hazards} />

            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-4">INSIDE NOW</div>
              <div className="cf-display font-black text-4xl mb-1 tabular-nums">
                <CountUp value={metrics?.peopleInside ?? 0} />
              </div>
              <div className="cf-mono text-[11px] cf-dim2 mb-4">
                OF {venue.capacity.toLocaleString()} CAPACITY · {metrics?.exited ?? 0} LEFT
              </div>
              <DensityBar height={8}
                density={(metrics?.peopleInside ?? 0) / Math.max(1, venue.capacity)}
                color="linear-gradient(90deg, var(--cf-orange), var(--cf-red))" />
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
                      <span className="cf-mono text-[11px] shrink-0 tabular-nums" style={{ color: densityColor(h.density) }}>
                        <CountUp value={(h.density ?? 0) * 100} format={(n) => `${Math.round(n)}%`} />
                      </span>
                    </div>
                    <DensityBar density={h.density} color={densityColor(h.density)} />
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

      {/* AI tracing. Its own tab rather than a step inside session setup, because a plan
          is traced once for a building and then reused for every run on it. */}
      {tab === "AI layout" && (
        <div>
          <div className="cf-card rounded-2xl p-6 mb-6 flex items-start gap-4">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,106,0,0.16)" }}>
              <Cpu className="w-5 h-5 cf-orange" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="cf-display font-bold uppercase text-base tracking-wide mb-1.5">
                Turn a floor plan into a walkable map
              </div>
              <p className="text-sm cf-dim leading-relaxed">
                Upload a 2D plan of your venue and a vision model reads it — halls, gates,
                exits — while computer vision traces the walkable space into the pathways
                the simulation actually routes people along. Check what it found, fix
                anything it got wrong, then run a session on it.
              </p>
              {tracedVenue && (
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <span className="cf-mono text-[11px] cf-green flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {tracedVenue.nodes?.length ?? 0} zones · {tracedVenue.edges?.length ?? 0} pathways ready
                  </span>
                  <button onClick={() => { flow.leave(); setTab("Live"); }}
                    className="cf-focus cf-btn-primary rounded-lg px-4 py-2 cf-accent text-[10px]">
                    USE IT FOR A SESSION
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Confirmed graphs land here. LayoutStudio only fires this once the *server*
              has re-validated the operator's edits, so a graph reaching this callback has
              already been checked for a gate that cannot reach an exit. */}
          <LayoutStudio initialFile={planToTrace}
            onConfirmed={(v) => { setTracedVenue(v); }} />
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
  const reduced = useReducedMotion();
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
              { v: totals.venues, l: "ACTIVE VENUES", f: (n) => Math.round(n) },
              { v: totals.inside, l: "PEOPLE INSIDE" },
              { v: totals.critical, l: "ZONES CRITICAL", c: totals.critical ? "var(--cf-red)" : undefined, f: (n) => Math.round(n) },
              { v: totals.peakRisk, l: "PEAK PREDICTED RISK", c: "var(--cf-orange)", f: (n) => n.toFixed(2) },
            ].map((s, i) => (
              <motion.div key={s.l} className="cf-card rounded-2xl p-6"
                initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : i * 0.06, ease: [0.16, 1, 0.3, 1] }}>
                <div className="cf-display font-black text-3xl mb-1 tabular-nums" style={{ color: s.c || "var(--cf-ink)" }}>
                  <CountUp value={s.v} format={s.f} />
                </div>
                <div className="cf-accent text-[10px] cf-dim2">{s.l}</div>
              </motion.div>
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
                {/* `popLayout` so an arriving alert slides the rest down rather than
                    shoving them — on a feed that updates mid-incident, a list that jumps
                    is a list an operator loses their place in. */}
                <AnimatePresence initial={false} mode="popLayout">
                  {incidents.map((inc) => (
                    <motion.div key={inc.id} layout className="flex gap-3"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                        style={{ background: (STATUS_META[inc.severity] ?? STATUS_META.OK).c }} />
                      <div className="min-w-0">
                        <div className="cf-mono text-[10px] cf-dim2 mb-0.5">
                          TICK {inc.tick} · {Math.round(inc.density * 100)}%
                        </div>
                        <div className="text-sm leading-snug">{zoneName(venue, inc.nodeId)}</div>
                        <div className="text-xs cf-dim leading-snug mt-0.5">{inc.message}</div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
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
  const reduced = useReducedMotion();

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
        {/* `mode="wait"` so the outgoing page finishes leaving before the next arrives.
            Cross-fading them instead put two full-height pages in the layout at once and
            the footer jumped as they swapped. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={route}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
            {page}
          </motion.main>
        </AnimatePresence>
        {!isPortal && <Footer navigate={navigate} />}
      </div>
    </div>
  );
}
