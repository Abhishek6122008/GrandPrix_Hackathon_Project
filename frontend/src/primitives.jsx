/**
 * The small pieces everything else is built from: motion wrappers, layout shells, and the
 * shared meta tables that decide what a status or a trend looks like.
 *
 * The rule for what belongs here is that it knows nothing about crowds. A component in this
 * file can be dropped on the marketing site or inside the admin console without either one
 * having to explain itself, and the meta tables are here rather than beside their screens
 * because a zone drawn amber on the map and printed amber in a table have to agree.
 */

import React, { createElement, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { trafficBand } from './crowdRouting.js';
import {
  DoorOpen, Footprints, UtensilsCrossed, Armchair, LogOut, TrendingUp, TrendingDown, Minus,
  Radio, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react';
import { GradientShimmer } from './GradientShimmer.jsx';

export const SESSION_STATUS_META = {
  RUNNING: { c: "var(--cf-green)", l: "LIVE" },
  PAUSED: { c: "var(--cf-amber)", l: "PAUSED" },
  CREATED: { c: "var(--cf-dim)", l: "READY" },
  STOPPED: { c: "var(--cf-dim2)", l: "STOPPED" },
  COMPLETED: { c: "var(--cf-blue-hi)", l: "COMPLETE" },
};

/** A small live/offline pill. Every portal shows one, so the socket state is never a mystery. */
export function ConnectionPill({ connected, status }) {
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
export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="cf-card rounded-xl px-4 py-3 flex items-start gap-2.5" style={{ borderColor: "rgba(225,6,0,.4)" }}>
      <AlertTriangle className="w-4 h-4 cf-red shrink-0 mt-0.5" strokeWidth={2} />
      <p className="text-sm cf-dim leading-relaxed">{error}</p>
    </div>
  );
}

export function usePrefersReducedMotion() {
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

/**
 * Scroll-reveal wrapper.
 *
 * `className` matters when a Reveal is a direct grid child: this element, not the content
 * inside it, is what the grid lays out, so column/row spans have to land here.
 */
export function Reveal({ children, delay = 0, className = "" }) {
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
  return <div ref={ref} className={`cf-reveal ${inView ? "cf-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/**
 * The page backdrop.
 *
 * A Paper Shaders grain gradient (WebGL) drifting behind the whole site, with the original
 * CSS mesh kept underneath it as the fallback. The shader is loaded lazily and mounted only
 * in the browser, for three reasons that all have to hold at once:
 *
 *  - the render smoke test runs this file through react-dom/server against a hand-written DOM
 *    shim with no canvas and no WebGL, so a shader mounting during render would break it;
 *  - the shader bundle is ~430KB and nothing above the fold needs it to paint, so keeping it
 *    out of the main chunk is what stops the backdrop delaying first contentful paint;
 *  - a machine with WebGL disabled or blocked must still get a backdrop rather than a void.
 *
 * Under `prefers-reduced-motion` the shader is never loaded at all — it is a continuously
 * animating full-viewport surface, which is exactly what that setting is asking us not to run.
 * The CSS mesh underneath is already static in that mode, so the page keeps its depth.
 */
export function MeshField() {
  const reduced = usePrefersReducedMotion();
  const [Shader, setShader] = useState(null);

  useEffect(() => {
    // A cheap capability probe: importing the shader bundle on a machine that cannot run it
    // would be pure download cost for a canvas that never paints.
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) return;
    } catch { return; }

    let alive = true;
    import("@paper-design/shaders-react")
      .then((m) => { if (alive && m?.GrainGradient) setShader(() => m.GrainGradient); })
      .catch(() => { /* stay on the CSS mesh */ });
    return () => { alive = false; };
  }, []);

  return (
    <>
      {/* Fallback / underlay. Always rendered: it is what shows before the shader chunk
          arrives, and what remains if WebGL is unavailable or reduced-motion is set. Once
          the shader is up the mesh fades out — two full-viewport colour fields stacked on
          each other muddy both, and the shader is the better of the two. */}
      <div className="cf-mesh" aria-hidden="true"
        style={{ opacity: Shader ? 0 : 1, transition: "opacity 1.2s var(--cf-ease)" }}>
        <span className="m1" /><span className="m2" /><span className="m3" /><span className="m4" />
      </div>

      {Shader && (
        <div className="cf-shader" aria-hidden="true">
          <Shader
            style={{ width: "100%", height: "100%" }}
            colorBack="#05070B"
            /* The brand ramp: deep blue for the calm ground, then the ember pair, so the
               field reads as the density scale the product is built on rather than as
               arbitrary decoration. Brightened well past the token colours on purpose —
               these are seen through the veil above, which knocks them back. */
            colors={["#1B4FA8", "#4D8DF0", "#E10600", "#FF6A00"]}
            shape="corners"
            softness={0.62}
            intensity={0.55}
            noise={0.32}
            /* Reduced motion freezes the field rather than removing it. Windows in particular
               reports `reduce` whenever "show animations" is off, which is a common default —
               dropping the backdrop entirely there cost those users the whole design for a
               setting that only ever asked us to stop moving things. speed:0 renders one
               static frame, which is exactly what the preference is asking for. */
            speed={reduced ? 0 : 0.9}
          />
        </div>
      )}

      {/* The veil sits above both layers. At full strength the shader would compete with the
          UI for attention and wreck contrast on body copy; this is what keeps it a backdrop. */}
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
 * The product mark.
 *
 * Three swept channels narrowing into a gate, coloured with the density ramp the rest of the
 * app uses — clear blue on top, warming through orange, jammed red at the bottom — with the
 * apex dot standing for the bottleneck being predicted. Inline rather than an <img> so the
 * strokes can inherit currentColor when it is placed on a coloured surface, and so it costs
 * no extra request. `public/favicon.svg` is the same drawing, tuned for 16px.
 */
export function LogoMark({ size = 32, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cf-logo-ember" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cf-red)" />
          <stop offset="1" stopColor="var(--cf-orange)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="var(--cf-panel)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" fill="none"
        stroke="url(#cf-logo-ember)" strokeOpacity="0.55" strokeWidth="1.5" />
      <g fill="none" strokeWidth="9" strokeLinecap="round">
        <path d="M13 17 H35" stroke="var(--cf-blue-hi)" />
        <path d="M13 32 H44" stroke="var(--cf-orange)" />
        <path d="M13 47 H29" stroke="var(--cf-red)" />
      </g>
      <circle cx="50" cy="32" r="5.5" fill="var(--cf-ink)" />
    </svg>
  );
}

/** Wordmark + mark, so the header and footer cannot drift apart. */
export function Wordmark({ size = 32, className = "" }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="cf-display font-bold uppercase tracking-wide text-base leading-none">
        Crowd Flow<span className="cf-dim font-normal"> Optimiser</span>
      </span>
    </span>
  );
}

/**
 * Cursor-following spotlight on a surface.
 *
 * Writes the pointer position to --mx/--my as percentages and lets CSS do the painting, so
 * a mousemove never triggers a React render — at 60Hz over a grid of these, setState would
 * be the single most expensive thing on the page. Pointer events are ignored on coarse
 * pointers, where there is no cursor to follow and the listener would only cost battery.
 */
export function Spotlight({ as: Tag = "div", color, className = "", style, children, ...rest }) {
  const ref = useRef(null);

  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  return (
    <Tag
      ref={ref}
      onPointerMove={(e) => { if (e.pointerType !== "touch") onMove(e); }}
      className={`cf-spot cf-spot-edge ${className}`}
      style={color ? { ...style, "--cf-spot-color": color } : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Thin reading-progress rail pinned under the header. */
export function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    // Written straight to the node on scroll for the same reason as <Spotlight>: this fires
    // on every frame of a scroll and must not go through React.
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return <div ref={ref} className="cf-progress w-full" style={{ transform: "scaleX(0)" }} aria-hidden="true" />;
}

/**
 * A button that leans toward the cursor.
 *
 * Capped at a few pixels — enough to feel responsive, small enough that the button never
 * slides out from under the pointer that is chasing it.
 */
export function Magnetic({ children, strength = 6, className = "", ...rest }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();

  const onMove = (e) => {
    const el = ref.current;
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = "translate(0,0)"; };

  return (
    <span ref={ref} onPointerMove={onMove} onPointerLeave={reset}
      className={`inline-block will-change-transform ${className}`}
      style={{ transition: "transform .35s var(--cf-ease)" }} {...rest}>
      {children}
    </span>
  );
}

/** Seamless marquee. The track is duplicated so the -50% keyframe lands on an identical frame. */
export function Ticker({ items, className = "" }) {
  return (
    <div className={`overflow-hidden cf-edge-fade ${className}`} aria-hidden="true">
      <div className="cf-marquee-track flex w-max items-center gap-10">
        {[0, 1].map((copy) => (
          <React.Fragment key={copy}>
            {items.map((t, i) => (
              <span key={`${copy}-${i}`} className="flex items-center gap-10 shrink-0">
                <span className="cf-accent text-[11px] cf-dim2 whitespace-nowrap">{t}</span>
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--cf-line2)" }} />
              </span>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * A headline figure that counts up the first time it is scrolled into view.
 *
 * Distinct from <CountUp>, which tracks a value that keeps changing on a live feed. This one
 * animates once, from zero, as a reveal — so it is driven by an IntersectionObserver rather
 * than by prop changes, and it deliberately never replays on scroll-back.
 */
export function CountOnView({ value, prefix = "", suffix = "", duration = 1400 }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(value); return; }

    let raf = 0, start = 0;
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return;
      io.disconnect();
      const step = (t) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / duration);
        // Same deceleration curve as --cf-ease, so the number settles like everything else.
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });

    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration, reduced]);

  return <span ref={ref}>{prefix}{Math.round(shown).toLocaleString()}{suffix}</span>;
}

/* ----------------------------------------------------------------------------
   Dot-matrix reveal — supplied component's shader, ported to this project's WebGL engine.

   The GLSL below is the author's fragment shader essentially unchanged: the same dot grid,
   the same `random`/PHI hash, the same intro timing that fans out from the centre and outro
   timing that collapses in from the edges via `u_reverse`.

   What changed is the engine underneath it. The original mounts the shader through
   @react-three/fiber, which pulls in Three.js — about 25MB for one screen's backdrop. This
   app already ships @paper-design/shaders-react (~430KB), whose <ShaderMount> takes an
   arbitrary fragment shader and supplies u_time/u_resolution on the same GLSL 3.00 ES
   target. Two edits were needed to retarget it:

     - the R3F version declares `in vec2 fragCoord` from its own vertex shader; here the
       built-in gl_FragCoord is used instead, so no custom vertex stage is required;
     - uniforms are passed as plain values rather than the {value,type} descriptors that
       version hand-marshals into THREE.Vector3 objects.
   -------------------------------------------------------------------------- */

const DOT_MATRIX_FRAGMENT = `#version 300 es
precision mediump float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform float u_reverse;
uniform float u_speed;

out vec4 fragColor;

float PHI = 1.61803398874989484820459;
float random(vec2 xy) {
  return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
  vec2 st = gl_FragCoord.xy;
  st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
  st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

  float opacity = step(0.0, st.x);
  opacity *= step(0.0, st.y);

  vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

  float frequency = 5.0;
  float show_offset = random(st2);
  float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
  opacity *= u_opacities[int(rand * 10.0)];
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

  vec3 color = u_colors[int(show_offset * 6.0)];

  vec2 center_grid = u_resolution / 2.0 / u_total_size;
  float dist_from_center = distance(center_grid, st2);

  float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);
  float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
  float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

  float t = u_time * u_speed;
  if (u_reverse > 0.5) {
    opacity *= 1.0 - step(timing_offset_outro, t);
    opacity *= clamp((step(timing_offset_outro + 0.1, t)) * 1.25, 1.0, 1.25);
  } else {
    opacity *= step(timing_offset_intro, t);
    opacity *= clamp((1.0 - step(timing_offset_intro + 0.1, t)) * 1.25, 1.0, 1.25);
  }

  fragColor = vec4(color, opacity);
  fragColor.rgb *= fragColor.a;
}`;

/**
 * The dot grid itself. Lazy-loads the shader engine for the same reasons <MeshField> does:
 * it must not run during the server-render smoke test, and the bundle should not block paint.
 * If WebGL is unavailable the component simply renders nothing — it is pure decoration, and
 * the sign-in panel above it stands on its own.
 */
export function CanvasRevealEffect({ colors = [[255, 255, 255]], dotSize = 6, speed = 3, reverse = false, opacity = 1 }) {
  const [Mount, setMount] = useState(null);

  useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
    } catch { return; }
    let alive = true;
    import("@paper-design/shaders-react")
      .then((m) => { if (alive && m?.ShaderMount) setMount(() => m.ShaderMount); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The author's DotMatrix widens 1–3 supplied colours into the 6 the shader indexes into.
  const uniforms = useMemo(() => {
    const c = colors.length >= 3
      ? [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]]
      : colors.length === 2
        ? [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]]
        : Array(6).fill(colors[0]);
    return {
      u_colors: c.map(([r, g, b]) => [r / 255, g / 255, b / 255]),
      u_opacities: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
      u_total_size: 20,
      u_dot_size: dotSize,
      u_reverse: reverse ? 1 : 0,
      u_speed: speed * 0.1,
    };
  }, [colors, dotSize, reverse, speed]);

  if (!Mount) return null;
  return (
    <div className="absolute inset-0" style={{ opacity }} aria-hidden="true">
      <Mount fragmentShader={DOT_MATRIX_FRAGMENT} uniforms={uniforms}
        style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Core header — supplied component, ported TSX → JS.

   Two changes from the source, both forced by this codebase rather than taste:

   - the shadcn semantic tokens it was written against (--muted, --primary, --accent,
     bg-background) do not exist here, so every colour is re-pointed at the --cf-* palette;
   - the avatar is optional. The original always renders a face and the words "Active Now",
     which on a marketing page would tell a logged-out visitor they are signed in.
   -------------------------------------------------------------------------- */

/**
 * The bar itself: a title on the left, an optional signed-in identity on the right, and the
 * diagonal grid-fade behind both. `children` is the slot the marketing header fills with its
 * nav, so both surfaces share one chrome.
 */
/**
 * `userAvatar` replaces the built-in circle, and `onUserClick` makes the whole identity block
 * the control that opens the account. Both optional: the public header still uses the plain
 * initial below, because signed-out and marketing pages have no profile to open.
 */
export function Bento({ color, className = "", children, ...rest }) {
  return (
    <Spotlight color={color} className={`cf-bento rounded-2xl ${className}`} {...rest}>
      {children}
    </Spotlight>
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
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 400 }) {
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
export function DensityBar({ density, height = 4, color }) {
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

export function SectionHeading({ eyebrow, title, lede, center = false }) {
  return (
    <div className={`max-w-2xl mb-12 ${center ? "mx-auto text-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="cf-display font-black uppercase text-3xl sm:text-4xl tracking-tight mt-4 mb-3">{title}</h2>
      <p className="cf-dim text-base leading-relaxed">{lede}</p>
    </div>
  );
}

export function PageHeader({ eyebrow, title, lede }) {
  return (
    <section className="relative border-b cf-hairline">
      {/* Top padding clears the fixed header, which is a 64px bar plus the ~48px route strip
          on large screens and just the bar below that. */}
      <div className="relative max-w-7xl mx-auto px-6 pt-32 lg:pt-40 pb-16">
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

export const ZONE_ICON = { GATE: DoorOpen, WALKWAY: Footprints, CONCESSION: UtensilsCrossed, SEATING: Armchair, EXIT: LogOut };
export const STATUS_META = { CRITICAL: { c: "var(--cf-red)", l: "CRITICAL" }, WARNING: { c: "var(--cf-amber)", l: "CAUTION" }, OK: { c: "var(--cf-green)", l: "CLEAR" } };
export const TREND_META = { RISING: { I: TrendingUp, c: "var(--cf-red)" }, FALLING: { I: TrendingDown, c: "var(--cf-green)" }, FLAT: { I: Minus, c: "var(--cf-dim)" } };

/**
 * The zone table, ordered worst first — the "timing tower" of the venue.
 *
 * Rows are the `nodes` array off a live frame, so occupancy, status, trend and AI risk are all
 * the server's numbers. Sorted by density here rather than on the server because the server's
 * order is the venue file's order, which is meaningful for the map and useless for a leaderboard.
 */
