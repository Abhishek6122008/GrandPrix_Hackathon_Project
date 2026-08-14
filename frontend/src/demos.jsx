/**
 * The animated explainers on the marketing pages, and the role previews on the access screen.
 *
 * Each one is a self-contained loop that illustrates a single claim — propagation, rerouting,
 * the baseline comparison — with no live data behind it. They are deliberately separate from
 * the pages that host them: a page is a layout, and these are the illustrations it arranges.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useCrowdFlow } from './useCrowdFlow.js';
import { toMapVenue } from './venueAdapter.js';
import sampleVenue from './sampleVenue.json';
import { GradientShimmer } from './GradientShimmer.jsx';
import { densityColor } from './VenueMap.jsx';
import { ROLES } from './account.jsx';
import { usePrefersReducedMotion } from './primitives.jsx';
import { useSessionList } from './useSessionList.js';

export function DemoPropagation() {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 900);
    return () => clearInterval(t);
  }, [reduced]);

  // Distance from the origin zone decides how hot each bar is, so the wave reads as
  // travelling outward rather than as five independent blinks.
  const heat = (i) => {
    const d = Math.abs(i - 2);
    const reach = step - d;
    return reach <= 0 ? 0 : Math.min(1, reach / 2);
  };

  return (
    // A fixed-height track keeps the bars vertically centred in the tile: percentage heights
    // need a definite box to resolve against, and the flex parent alone does not give them one.
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <div className="flex items-end justify-center gap-2 h-24">
        {[0, 1, 2, 3, 4].map((i) => {
          const h = heat(i);
          return (
            <motion.div key={i} className="w-7 rounded-md"
              animate={{ height: `${26 + h * 70}px`, backgroundColor: densityColor(h * 0.95) }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              style={{ height: "26px", background: densityColor(0) }} />
          );
        })}
      </div>
    </div>
  );
}

/**
 * A route bending around a jam.
 *
 * The straight path through the middle turns red; the drawn line takes the long way round.
 * Two stroked paths on one viewBox, cross-fading, so the detour reads as a decision.
 */
export function DemoRoute() {
  const reduced = usePrefersReducedMotion();
  const [detour, setDetour] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setDetour((d) => !d), 2400);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 160 80" className="w-full max-w-[190px] h-full">
        <line x1="12" y1="40" x2="148" y2="40" stroke="var(--cf-line2)" strokeWidth="2" strokeDasharray="3 4" />
        <motion.circle cx="80" cy="40" r="9"
          animate={{ fill: detour ? "var(--cf-red)" : "var(--cf-line2)", opacity: detour ? 0.9 : 0.45 }}
          transition={{ duration: 0.5 }} />
        <motion.path
          d={detour ? "M12 40 Q 50 40 62 22 Q 80 6 98 22 Q 110 40 148 40" : "M12 40 L148 40"}
          fill="none" stroke="var(--cf-blue-hi)" strokeWidth="2.5" strokeLinecap="round"
          animate={{ d: detour ? "M12 40 Q 50 40 62 22 Q 80 6 98 22 Q 110 40 148 40" : "M12 40 L148 40" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
        <circle cx="12" cy="40" r="4" fill="var(--cf-green)" />
        <circle cx="148" cy="40" r="4" fill="var(--cf-violet)" />
      </svg>
    </div>
  );
}

/**
 * The paired baseline.
 *
 * Two bars — the run without rerouting against the run with it — counting to their values,
 * which is the entire claim of the results page in one picture.
 */
export function DemoBaseline() {
  const reduced = usePrefersReducedMotion();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (reduced) return;
    // Asymmetric on purpose: a long rest at the real value, then a brief snap back to 100%
    // to replay the drop. An even flip would leave the "no difference" frame on screen half
    // the time.
    let t;
    const cycle = () => {
      setOn(true);
      t = setTimeout(() => { setOn(false); t = setTimeout(cycle, 2600); }, 380);
    };
    t = setTimeout(cycle, 2600);
    return () => clearTimeout(t);
  }, [reduced]);

  // The baseline is the constant to compare against, so it stays pinned at 100%.
  //
  // The optimised bar rests at its real value and only springs back to 100% for the instant
  // the loop replays. An earlier version split the cycle evenly between 72% and 100%, which
  // meant half of every loop showed two identical bars — a state that says the intervention
  // did nothing, i.e. the opposite of the claim, and reads as a broken chart when a
  // screenshot happens to land on it.
  const rows = [
    { l: "NO STRATEGY", pct: 100, c: "var(--cf-red)" },
    { l: "WITH STRATEGY", pct: on ? 100 : 72, c: "var(--cf-green)" },
  ];

  return (
    <div className="h-full flex flex-col justify-center gap-4 w-full" aria-hidden="true">
      {rows.map((r) => (
        <div key={r.l}>
          <div className="flex justify-between mb-1.5">
            <span className="cf-accent text-[9px] cf-dim2">{r.l}</span>
            <span className="cf-mono text-[10px] cf-tnum" style={{ color: r.c }}>{r.pct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div className="h-full rounded-full"
              initial={false}
              animate={{ width: `${r.pct}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              style={{ background: r.c }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Live tick counter — the ~100ms cadence, stated as a number that keeps moving. */
export function DemoTick() {
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(1284);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2" aria-hidden="true">
      <div className="cf-display font-black text-4xl cf-tnum" style={{ color: "var(--cf-ink)" }}>
        {tick.toLocaleString()}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="relative flex w-1.5 h-1.5">
          {!reduced && <span className="cf-ping absolute inline-flex w-full h-full rounded-full" style={{ background: "var(--cf-green)" }} />}
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-green)" }} />
        </span>
        <span className="cf-accent text-[9px] cf-dim2">TICKS SIMULATED</span>
      </div>
    </div>
  );
}

/**
 * In-memory sessions: the venue graph itself, with nodes lighting in sequence and no store
 * behind them. Deliberately abstract — the claim is about what is *absent*, so the picture
 * shows the graph standing alone rather than inventing a database icon to cross out.
 */
export function DemoGraph() {
  const reduced = usePrefersReducedMotion();
  const [lit, setLit] = useState(reduced ? 5 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLit((n) => (n + 1) % 7), 700);
    return () => clearInterval(t);
  }, [reduced]);

  const nodes = [
    { x: 22, y: 46 }, { x: 60, y: 20 }, { x: 60, y: 68 },
    { x: 104, y: 34 }, { x: 104, y: 72 }, { x: 142, y: 48 },
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [1, 2]];

  return (
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 164 92" className="w-full max-w-[200px] h-full">
        {edges.map(([a, b], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
            stroke="var(--cf-line2)" strokeWidth="1.5" />
        ))}
        {nodes.map((n, i) => (
          <motion.circle key={i} cx={n.x} cy={n.y} r="6"
            animate={{
              fill: i < lit ? "var(--cf-orange)" : "var(--cf-panel)",
              opacity: i < lit ? 1 : 0.6,
            }}
            transition={{ duration: 0.4 }}
            stroke="var(--cf-line2)" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

/** The three role portals, cycling — the same data, three different views. */
export function DemoPortals() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const roles = Object.values(ROLES);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setActive((a) => (a + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex items-center justify-center gap-3" aria-hidden="true">
      {roles.map((r, i) => (
        <motion.div key={r.key} className="w-12 h-12 rounded-xl flex items-center justify-center"
          animate={{
            scale: active === i ? 1.12 : 1,
            backgroundColor: active === i
              ? `color-mix(in oklab, ${r.color} 24%, transparent)`
              : "rgba(255,255,255,0.04)",
          }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <r.Icon className="w-5 h-5" strokeWidth={2}
            style={{ color: active === i ? r.color : "var(--cf-dim2)" }} />
        </motion.div>
      ))}
    </div>
  );
}

/** A bento tile: spotlight surface + the shared tile material, with an optional accent. */
export function WordCarousel({ words, interval = 2500 }) {
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
          transition: reduced ? "none" : "transform .6s var(--cf-ease), opacity .5s ease",
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
export function useShowcase() {
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
export function ShowcaseNote({ live }) {
  return (
    <p className="cf-mono text-[10px] cf-dim2 mt-3 text-center">
      {live
        ? "LIVE — streaming from a running session"
        : "SAMPLE LAYOUT — no session running; start one from the client portal"}
    </p>
  );
}

/* ----------------------------------------------------------------------------
   Role card previews.

   One small piece of art per portal, drawn from the same venue vocabulary the app itself
   uses — zones, walkways, a route, a density ramp. The point is that the card shows what the
   role actually sees rather than putting a generic icon above a paragraph.

   All three are static SVG: they sit three-up above the fold on the home page, and three
   more animation loops there would cost more than they add. Motion on this section comes
   from the hover state instead.
   -------------------------------------------------------------------------- */

/** Walker: one dot on the map, and the way out. */
export function RolePreviewWalker({ color }) {
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      <g stroke="var(--cf-line2)" strokeWidth="1.5" fill="none" opacity=".55">
        <path d="M18 74 H70 V34 H128 V74 H182" />
        <path d="M70 74 V96" /><path d="M128 34 V14" />
      </g>
      {/* The route the walker is given, drawn over the plan in the accent. */}
      <path d="M28 88 Q 52 88 70 74 T 128 34 Q 150 26 172 26" fill="none"
        stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 6" />
      <circle cx="172" cy="26" r="4.5" fill="var(--cf-violet)" />
      <g>
        <circle cx="28" cy="88" r="9" fill={color} opacity=".18" />
        <circle cx="28" cy="88" r="4" fill={color} />
      </g>
    </svg>
  );
}

/** Client: zones filling, on the density ramp. */
export function RolePreviewClient({ color }) {
  const zones = [
    { x: 14, w: 52, d: 0.24 }, { x: 72, w: 44, d: 0.58 },
    { x: 122, w: 38, d: 0.9 }, { x: 166, w: 22, d: 0.36 },
  ];
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      {/* Walkways behind the zones, so the fill reads as rooms on a plan. */}
      <g stroke="var(--cf-line2)" strokeWidth="1.5" opacity=".5">
        <line x1="10" y1="52" x2="190" y2="52" />
        <line x1="68" y1="16" x2="68" y2="92" />
        <line x1="118" y1="16" x2="118" y2="92" />
      </g>
      {zones.map((z, i) => {
        const h = 16 + z.d * 44;
        return (
          <g key={i}>
            <rect x={z.x} y={88 - h} width={z.w} height={h} rx="2"
              fill={densityColor(z.d)} opacity={0.22 + z.d * 0.42} />
            <rect x={z.x} y={88 - h} width={z.w} height="2" fill={densityColor(z.d)} />
          </g>
        );
      })}
      <line x1="10" y1="90" x2="190" y2="90" stroke="var(--cf-line2)" strokeWidth="1.5" />
    </svg>
  );
}

/** Admin: many venues at once, one of them flagged. */
export function RolePreviewAdmin({ color }) {
  // Deliberately calm apart from one: the admin view is about spotting the exception, and a
  // grid where every tile is lit says the opposite.
  const cells = [
    [0, 0, 0.10], [1, 0, 0.16], [2, 0, 0.08], [3, 0, 0.13],
    [0, 1, 0.18], [1, 1, 0.94], [2, 1, 0.12], [3, 1, 0.30],
    [0, 2, 0.11], [1, 2, 0.20], [2, 2, 0.44], [3, 2, 0.09],
  ];
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      {cells.map(([cx, cy, d], i) => {
        const x = 24 + cx * 40, y = 16 + cy * 28;
        const flagged = d > 0.85;
        return (
          <g key={i}>
            <rect x={x} y={y} width="30" height="20" rx="3"
              fill={flagged ? densityColor(d) : "var(--cf-line2)"}
              opacity={flagged ? 0.9 : 0.3 + d * 0.5} />
            {flagged && (
              <rect x={x - 2.5} y={y - 2.5} width="35" height="25" rx="5"
                fill="none" stroke={color} strokeWidth="1.5" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

