/**
 * The public pages: home, how it works, the platform tour, the model page and the results.
 *
 * These read live data where they can — the showcase strip and the results page both poll real
 * sessions — because a marketing page showing invented numbers next to a product that measures
 * real ones is the wrong first impression to make.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import {
  Armchair, Radio, Zap, ChevronDown, MoveRight, Users, Activity, Cpu, Network, Layers, ShieldCheck,
  Boxes, GitBranch, Navigation, Upload, ArrowRight,
} from 'lucide-react';
import { GradientShimmer } from './GradientShimmer.jsx';
import { VenueMap, densityColor } from './VenueMap.jsx';
import { DemoBaseline, DemoGraph, DemoPortals, DemoPropagation, DemoRoute, DemoTick, RolePreviewAdmin, RolePreviewClient, RolePreviewWalker, ShowcaseNote, WordCarousel, useShowcase } from './demos.jsx';
import { Bento, ConnectionPill, CountOnView, Magnetic, PageHeader, Reveal, STATUS_META, SectionHeading, Spotlight, TREND_META, Ticker, ZONE_ICON } from './primitives.jsx';
import { useSessionList } from './useSessionList.js';

export function HomePage({ navigate }) {
  const { venue, people, live } = useShowcase();
  return (
    <div className="cf-page-in">
      <section className="relative px-6 pt-28 lg:pt-36 pb-16 overflow-hidden">
        {/* Slow conic wash behind the headline only. Clipped by the section so it never
            bleeds into the cards below, and sat under the mesh veil so it reads as depth
            rather than a second competing background. */}
        <div className="absolute inset-x-0 top-0 h-[70vh] pointer-events-none opacity-70" aria-hidden="true"
          style={{ maskImage: "radial-gradient(70% 60% at 50% 30%, #000, transparent)", WebkitMaskImage: "radial-gradient(70% 60% at 50% 30%, #000, transparent)" }}>
          <div className="cf-aurora" />
        </div>

        <div className="max-w-7xl mx-auto text-center relative">
          <Reveal>
            <a href="#/access" onClick={(e) => { e.preventDefault(); navigate("/access"); }}
              className="cf-focus cf-accent group inline-flex items-center gap-3 text-[11px] cf-chip rounded-full pl-4 pr-3 py-2 mb-10 cf-dim hover:border-(--cf-line2) transition-colors">
              <span className="relative flex w-1.5 h-1.5">
                <span className="cf-ping absolute inline-flex w-full h-full rounded-full" style={{ background: "var(--cf-orange)" }} />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-orange)" }} />
              </span>
              THREE PORTALS · ONE LIVE MAP
              <MoveRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <h1 className="cf-display font-black uppercase tracking-tight max-w-4xl mx-auto" style={{ fontSize: "clamp(2.5rem, 6.5vw, 5rem)", lineHeight: 1 }}>
              <span className="block"><GradientShimmer gradient="ember">Know where the crowd</GradientShimmer></span>
              <span className="block"><GradientShimmer gradient="ember">is going to break —</GradientShimmer></span>
              <WordCarousel words={["live.", "predictive.", "measurable.", "on every phone."]} />
            </h1>
            <p className="mt-6 max-w-xl mx-auto leading-relaxed cf-dim" style={{ fontSize: "clamp(1rem, 1.4vw, 1.15rem)" }}>
              Attendees see themselves on the venue map. Organisers see every zone filling in real time.
              We see the whole network — and the bottleneck forming three ticks before it does.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Magnetic>
                <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  Open a portal
                </button>
              </Magnetic>
              <Magnetic>
                <button onClick={() => navigate("/platform")} className="cf-focus cf-btn-outline rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  See the platform
                </button>
              </Magnetic>
            </div>
          </Reveal>

          <Reveal delay={140}>
            {/* The map is the product, so it gets treated as the hero image: raised on its own
                plinth with an ember glow under it, and a caption bar that names what is on
                screen. The glow is behind the frame, never over the map itself — tinting live
                density data would make the colours lie. */}
            <div className="mt-12 max-w-5xl mx-auto relative">
              <div className="absolute -inset-x-8 -bottom-6 h-24 pointer-events-none opacity-60" aria-hidden="true"
                style={{ background: "radial-gradient(60% 100% at 50% 100%, rgba(225,6,0,.45), transparent 70%)", filter: "blur(28px)" }} />
              <div className="relative rounded-3xl p-2 cf-card-solid" style={{ boxShadow: "var(--cf-shadow-lg)" }}>
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    {["var(--cf-red)", "var(--cf-amber)", "var(--cf-green)"].map((c) => (
                      <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.55 }} />
                    ))}
                  </div>
                  <span className="cf-mono text-[10px] cf-dim2 tracking-widest">{venue.name?.toUpperCase() ?? "VENUE"}</span>
                  <ConnectionPill connected={live} status={live ? "RUNNING" : "CREATED"} />
                </div>
                <div className="rounded-2xl overflow-hidden">
                  <VenueMap venue={venue} people={people} me={null} height={440} />
                </div>
              </div>
              <ShowcaseNote live={live} />
            </div>
          </Reveal>
        </div>

        <Reveal delay={220}>
          <div className="mt-16 max-w-5xl mx-auto">
            <Ticker items={[
              "PREDICTIVE CONGESTION MODEL", "2,500 AGENTS PER RUN", "~100MS TICK",
              "GRAPH-AWARE REROUTING", "PAIRED BASELINE SIMULATION", "THREE ROLE PORTALS",
              "LIVE WEBSOCKET STREAM", "NO DATABASE REQUIRED",
            ]} />
          </div>
        </Reveal>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 border-t cf-hairline">
        <Reveal><SectionHeading eyebrow="WHO IT'S FOR" title="Three views of the same venue" lede="Same live data, three very different jobs — and each portal only ever shows what that role should see." center /></Reveal>

        {/* Role cards.
         *
         * These used to be an icon tile above four stacked lines of text — the same shape as
         * every other feature card on the internet, and nothing in them said what this
         * product is. Each card now *shows* its role instead of only describing it: the
         * walker gets a single dot with a route out, the client gets zones filling, the admin
         * gets a grid of venues. The art is the same venue graph the app draws, so the card
         * previews the thing you get by clicking it.
         *
         * The oversized index numeral and the full-bleed footer bar give the three a
         * deliberate reading order and a real click target, rather than a text link.
         */}
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { n: "01", Preview: RolePreviewWalker, role: "Walker", t: "Attendees", d: "See yourself on the venue map and get the nearest clear way out.", to: "/login/walker", c: "var(--cf-blue-hi)" },
            { n: "02", Preview: RolePreviewClient, role: "Client", t: "Organisers", d: "Upload a floor plan and watch occupancy fill zone by zone.", to: "/login/client", c: "var(--cf-orange)" },
            { n: "03", Preview: RolePreviewAdmin, role: "Admin", t: "Operations", d: "Every venue, every layout, every bottleneck, on one board.", to: "/login/admin", c: "var(--cf-red-text)" },
          ].map(({ n, Preview, role, t, d, to, c }, i) => (
            <Reveal key={role} delay={i * 80} className="h-full">
              <Spotlight as="button" color={c} onClick={() => navigate(to)}
                className="cf-focus cf-rolecard group w-full h-full text-left flex flex-col">

                {/* Live art. Sits in its own bay with the accent bleeding up from the floor,
                    so the colour arrives as light rather than as a filled swatch. */}
                <span className="cf-rolecard-art" style={{ "--accent": c }}>
                  <span className="cf-rolecard-glow" aria-hidden="true" />
                  <Preview color={c} />
                  <span aria-hidden="true" className="cf-rolecard-index cf-display">{n}</span>
                </span>

                <span className="flex-1 flex flex-col px-6 pt-5 pb-6">
                  <span className="cf-accent text-[10px] cf-dim2 mb-1.5 block">{role.toUpperCase()} PORTAL</span>
                  <span className="cf-display font-black uppercase text-2xl tracking-tight leading-none mb-2.5 block">{t}</span>
                  <span className="text-sm cf-dim leading-relaxed block">{d}</span>
                </span>

                <span className="cf-rolecard-foot" style={{ "--accent": c }}>
                  <span className="cf-accent text-[11px]" style={{ color: c }}>ENTER PORTAL</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1.5" style={{ color: c }} />
                </span>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Capability bento. Asymmetric on purpose: the prediction claim is the one that
          differentiates the product, so it gets the wide tile and the others read as
          supporting evidence rather than a flat list of equals. */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t cf-hairline">
        <Reveal><SectionHeading eyebrow="WHAT IT DOES" title="Built to see it coming"
          lede="A threshold tells you a zone is full. The point of this system is to tell you which zone is about to be." center /></Reveal>

        {/* Six columns on desktop so tiles can be 2- or 3-wide and the row rhythm changes down
            the grid. Each tile is a live demo above its label: the animation is the evidence
            for the claim, not decoration beside it. */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 md:auto-rows-[13rem]">
          {[
            {
              d: 0, span: "md:col-span-2 md:row-span-2", color: "var(--cf-orange)", Demo: DemoPropagation,
              Icon: Radio, t: "Predicts, not reports",
              p: "Congestion propagates along the venue's own walkway graph, so a quiet zone about to be hit by an overrunning neighbour is flagged before it fills — not once it already has.",
            },
            {
              d: 80, span: "md:col-span-2", color: "var(--cf-blue-hi)", Demo: DemoRoute,
              Icon: Navigation, t: "Routes around it",
              p: "Paths weighted by live congestion — around the jam, not through it.",
            },
            {
              d: 160, span: "md:col-span-2 md:row-span-2", color: "var(--cf-green)", Demo: DemoBaseline,
              Icon: ShieldCheck, t: "Proves it worked",
              p: "A hidden baseline runs the same crowd and seed with rerouting off, so the before/after is measured, not estimated.",
            },
            {
              d: 240, span: "md:col-span-2", color: "var(--cf-amber)", Demo: DemoTick,
              Icon: Activity, t: "Runs in real time",
              p: "Thousands of agents, roughly ten ticks a second.",
            },
            {
              d: 320, span: "md:col-span-3", color: "var(--cf-blue-hi)", Demo: DemoPortals,
              Icon: Users, t: "Three views, one venue",
              p: "Attendees, organisers and operations each see exactly what their job needs — and nothing beyond it.",
            },
            {
              d: 400, span: "md:col-span-3", color: "var(--cf-orange)", Demo: DemoGraph,
              Icon: Layers, t: "No database required",
              p: "Sessions run in memory against the venue graph, so there is nothing to provision before a demo.",
            },
          ].map(({ d, span, color, Demo, Icon, t, p }) => (
            <Reveal key={t} delay={d} className={span}>
              <Bento color={color} className="p-6 h-full flex flex-col">
                <div className="flex-1 min-h-0"><Demo /></div>
                <div className="mt-4">
                  <div className="cf-display font-bold uppercase text-lg tracking-wide mb-1.5 flex items-center gap-2">
                    <Icon className="w-4 h-4 shrink-0" style={{ color }} strokeWidth={2} />
                    {t}
                  </div>
                  <p className="text-sm cf-dim leading-relaxed">{p}</p>
                </div>
              </Bento>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative">
        {/* Fades to nothing at both ends instead of butting into a hard edge. */}
        <span aria-hidden="true" className="block max-w-7xl mx-auto cf-rule" />
        <div className="max-w-7xl mx-auto px-6 py-16 relative">
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl overflow-hidden cf-statband">
              {[
                { to: 2500, suffix: "", l: "AGENTS PER RUN" },
                { to: 100, prefix: "~", suffix: "ms", l: "TICK INTERVAL" },
                { to: 28, suffix: "%", l: "LESS TIME CRITICAL", c: "var(--cf-green)" },
                { to: 0, suffix: "", l: "DATABASES REQUIRED" },
              ].map((s) => (
                <Spotlight key={s.l} className="px-6 py-8 cf-statcell">
                  <div className="cf-display font-black text-3xl mb-1 cf-tnum" style={{ color: s.c || "var(--cf-ink)" }}>
                    <CountOnView value={s.to} prefix={s.prefix} suffix={s.suffix} />
                  </div>
                  <div className="cf-accent text-[11px] cf-dim2">{s.l}</div>
                </Spotlight>
              ))}
            </div>
          </Reveal>
        </div>
        <span aria-hidden="true" className="block max-w-7xl mx-auto cf-rule" />
      </section>

      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <Reveal>
          <h2 className="cf-display font-black uppercase tracking-tight mb-5" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", lineHeight: 1.05 }}>
            <GradientShimmer gradient="ember">Open a portal and watch a venue fill</GradientShimmer>
          </h2>
          <p className="cf-dim max-w-xl mx-auto leading-relaxed mb-8">
            Three roles, one live map. Start a session from the client portal and the whole
            system — map, timing tower, before/after — comes alive against it.
          </p>
          <Magnetic>
            <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-8 py-4 cf-display font-bold uppercase text-sm tracking-wide">
              Choose your portal
            </button>
          </Magnetic>
        </Reveal>
      </section>
    </div>
  );
}

/**
 * How it works — the end-to-end story.
 *
 * The other marketing pages each cover one slice (the board, the models, the numbers). Nothing
 * previously walked a reader from "I have a floor plan" to "a marshal is reading an instruction",
 * which is the question every first-time visitor actually arrives with.
 */
export function HowItWorksPage({ navigate }) {
  const steps = [
    { n: "01", Icon: Upload, c: "var(--cf-orange)", t: "Upload the floor plan",
      d: "A flat 2D image is all that is needed. No CAD, no survey, no site visit.",
      note: "CLIENT PORTAL · ONE IMAGE" },
    { n: "02", Icon: Network, c: "var(--cf-orange)", t: "AI traces it into a graph",
      d: "Halls, corridors, gates and the walkable edges between them become a routable network — the structure everything downstream reasons over.",
      note: "AUTOMATED TRACING · EDITABLE" },
    { n: "03", Icon: Users, c: "var(--cf-blue-hi)", t: "Attendees check in",
      d: "A venue code on your signage puts each device on the map. Only anonymous position inside the geofence is ever used.",
      note: "WALKER PORTAL · VENUE CODE" },
    { n: "04", Icon: Cpu, c: "var(--cf-blue-hi)", t: "The model looks ahead",
      d: "Density, trend and history propagate across the graph, so risk is predicted at a zone's neighbours before that zone itself is full.",
      note: "CONGESTION-PROPAGATION GNN" },
    { n: "05", Icon: Navigation, c: "var(--cf-amber)", t: "Routes bend around the jam",
      d: "Paths are weighted by live congestion, so the way out an attendee is shown goes around the crush rather than into it.",
      note: "PER-ATTENDEE REROUTING" },
    { n: "06", Icon: Radio, c: "var(--cf-red)", t: "Operators get a sentence",
      d: "Density vectors become the actual line a marshal can act on — hold intake here, stage arrivals there.",
      note: "GENERATED ADVISORY" },
  ];

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="HOW IT WORKS" title="Floor plan to instruction"
        lede="Six steps from a flat image of your venue to a sentence a marshal can act on — and the point at which each one stops being a guess." />

      <section className="max-w-5xl mx-auto px-6 py-20">
        {/* A vertical spine with the steps hung off it. The rail is drawn behind the markers
            and stops short at the last one, so the sequence reads as finite rather than
            continuing off the bottom of the page. */}
        <div className="relative">
          <span aria-hidden="true" className="absolute left-[19px] top-3 bottom-14 w-px hidden sm:block"
            style={{ background: "linear-gradient(180deg, var(--cf-orange), var(--cf-blue-hi), var(--cf-red), transparent)", opacity: 0.45 }} />

          <div className="flex flex-col gap-4">
            {steps.map(({ n, Icon, c, t, d, note }, i) => (
              <Reveal key={n} delay={i * 70}>
                <div className="flex gap-5 items-start">
                  <span className="relative z-10 w-10 h-10 rounded-full shrink-0 hidden sm:flex items-center justify-center cf-card-solid"
                    style={{ borderColor: c }}>
                    <Icon className="w-4 h-4" style={{ color: c }} strokeWidth={2} />
                  </span>
                  <Spotlight color={c} className="cf-bento rounded-2xl p-6 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="cf-mono text-[11px]" style={{ color: c }}>{n}</span>
                      <span className="cf-display font-bold uppercase text-lg tracking-wide">{t}</span>
                    </div>
                    <p className="text-sm cf-dim leading-relaxed mb-3">{d}</p>
                    <span className="cf-accent text-[10px] cf-dim2">{note}</span>
                  </Spotlight>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24">
        <Reveal>
          <Spotlight className="cf-bento rounded-2xl p-8 text-center">
            <div className="cf-display font-black uppercase text-2xl tracking-tight mb-3">
              <GradientShimmer gradient="ember">See it running</GradientShimmer>
            </div>
            <p className="cf-dim text-sm leading-relaxed max-w-xl mx-auto mb-7">
              Start a session from the client portal and every surface on this site — the live board,
              the timing tower, the before/after — starts reporting against it.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Magnetic>
                <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  Open a portal
                </button>
              </Magnetic>
              <Magnetic>
                <button onClick={() => navigate("/platform")} className="cf-focus cf-btn-outline rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  See the live board
                </button>
              </Magnetic>
            </div>
          </Spotlight>
        </Reveal>
      </section>
    </div>
  );
}

export function PlatformPage({ navigate }) {
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
          <div className="rounded-2xl overflow-hidden" style={{ boxShadow: "var(--cf-shadow-md)" }}>
            <VenueMap venue={venue} people={people} me={null} height={520} onSelectHall={setSel} selectedHall={sel} />
          </div>
          <div className="flex flex-col gap-4">
            <Spotlight className="cf-bento rounded-2xl p-5">
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
            </Spotlight>
            <Spotlight className="cf-bento rounded-2xl p-5 flex-1">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">LIVE COUNTS</div>
              <div className="flex flex-col gap-3">
                {[["Inside venue", people.length * 20], ["Capacity", venue.capacity], ["Zones flagged", venue.halls.filter((h) => h.density > 0.7).length]].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between py-1 border-b cf-hairline last:border-0">
                    <span className="text-sm cf-dim">{l}</span>
                    <span className="cf-mono text-sm font-semibold cf-tnum">{v}</span>
                  </div>
                ))}
              </div>
            </Spotlight>
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

export function IntelligencePage() {
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
              <Spotlight color="var(--cf-blue-hi)" className="cf-bento rounded-2xl p-7 h-full flex flex-col">
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
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="THE /ANALYZE PIPELINE" title="Six steps between a graph and a sentence" lede="One endpoint does the whole job. Spring sends board state; FastAPI returns risk scores and the line to read out." /></Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipeline.map(({ Icon, t, d }, i) => (
            <Reveal key={t} delay={i * 60}>
              {/* The step number is drawn oversized and low-contrast behind the content so the
                  sequence is readable at a glance without a numeral competing with the title. */}
              <Spotlight className="cf-bento rounded-xl p-6 h-full relative overflow-hidden">
                <span aria-hidden="true" className="cf-display font-black absolute -top-3 right-2 leading-none select-none"
                  style={{ fontSize: "5rem", color: "var(--cf-line)", opacity: 0.55 }}>
                  {i + 1}
                </span>
                <Icon className="w-4 h-4 cf-orange mb-4" strokeWidth={2} />
                <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1.5">{t}</div>
                <p className="text-sm cf-dim leading-relaxed">{d}</p>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ResultsPage() {
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
              <Spotlight color={c} className="cf-bento rounded-2xl p-7 h-full">
                <div className="flex items-center gap-2.5 mb-6">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                  <div className="cf-display font-bold uppercase text-sm tracking-wide" style={{ color: c }}>{l}</div>
                </div>
                <div className="cf-accent text-[11px] cf-dim2 mb-1">CRITICAL NODE-TICKS</div>
                <div className="cf-mono text-4xl font-bold cf-tnum" style={{ color: c }}>{d.criticalNodeTicks}</div>
                <div className="grid grid-cols-3 gap-4 pt-5 mt-5 border-t cf-hairline">
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">PEAK</div><div className="cf-mono font-semibold cf-tnum">{Math.round(d.peakDensity * 100)}%</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">ZONES</div><div className="cf-mono font-semibold cf-tnum">{d.bottleneckCount}</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">EXITED</div><div className="cf-mono font-semibold cf-tnum">{d.exited}</div></div>
                </div>
              </Spotlight>
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
              <div className="border-b cf-hairline group">
                <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}
                  className="cf-focus w-full flex items-center justify-between gap-6 py-5 text-left">
                  <span className="cf-display font-bold uppercase text-base tracking-wide transition-colors duration-300"
                    style={{ color: open === i ? "var(--cf-orange)" : undefined }}>{f.q}</span>
                  <span className="w-7 h-7 rounded-full cf-chip flex items-center justify-center shrink-0 transition-colors duration-300">
                    <ChevronDown className="w-4 h-4 cf-dim transition-transform duration-300" style={{ transform: open === i ? "rotate(180deg)" : "none" }} />
                  </span>
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

/* ============================================================================
   Account identity
   ========================================================================== */

/**
 * The account as the UI reads it, mapped in exactly one place.
 *
 * `/auth/me` and the register/login responses return the same shape, and both used to be
 * unpacked inline with slightly different fields — which is how the header ended up able to
 * show an email but not a name. Everything that builds a session now goes through here.
 */
