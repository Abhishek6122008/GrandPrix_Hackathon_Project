/**
 * GradientShimmer — supplied component, ported TSX → JS, logic unchanged.
 *
 * Kept whole and kept separate: it arrived as one piece of third-party work and the least
 * confusing thing to do with it is leave it recognisable, so a future port back to the
 * original can diff against it.
 */

import { createElement, useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';

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

