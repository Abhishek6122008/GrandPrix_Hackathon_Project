/**
 * The attendee portal: where you are, where to go, and how busy it is on the way.
 *
 * The route is planned client-side from the live density on the session socket — see
 * crowdRouting.js for why that half of the routing lives in the browser rather than the server.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { api } from './api.js';
import { useCrowdFlow } from './useCrowdFlow.js';
import { planRoute, trafficBand } from './crowdRouting.js';
import { normaliseCode, codeError, resolveSessionForCode } from './venueCode.js';
import {
  LogOut, AlertTriangle, ShieldCheck, Check, MapPin, Map, Route, Navigation,
} from 'lucide-react';
import { PortalShell, zoneName } from './PortalShell.jsx';
import { POI_ICON, VenueMap } from './VenueMap.jsx';
import { ConnectionPill, ErrorNote, Reveal } from './primitives.jsx';
import { useSessionList } from './useSessionList.js';

export function WalkerApp({ session, navigate, signOut, onSession }) {
  const [entered, setEntered] = useState("");
  const [joinError, setJoinError] = useState("");
  const { sessions } = useSessionList(8000);

  /*
   * No venue directory here, deliberately.
   *
   * This screen used to list every venue the backend had stored so a code could be picked
   * rather than typed. That is a convenience the walker portal is not allowed to offer: the
   * access model this product publishes says an attendee never sees other clients' venues,
   * and the list showed all of them by name to anyone who signed up. The entrance signage is
   * the only thing that should hand out a code.
   */
  const flow = useCrowdFlow();
  const { venue, rawVenue, frame, info, connected } = flow;

  // Where the attendee says they are. The backend has no per-person GPS — it simulates a crowd,
  // it does not track your phone — so this is zone-level and self-declared, and the UI says so
  // rather than drawing a false 3-metre accuracy circle.
  const [atNodeId, setAtNodeId] = useState(null);
  const [destinationId, setDestinationId] = useState(null);

  /**
   * This device's attendee id, generated once and kept.
   *
   * Opaque and attached to no account — the venue only ever learns "some attendee is in this
   * zone". Persisted so a refresh does not leave the previous id ageing out in the venue,
   * counting somebody who is not there.
   */
  const [walkerId] = useState(() => {
    const existing = localStorage.getItem("cf-walker-id");
    if (existing) return existing;
    const created = `w-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("cf-walker-id", created);
    return created;
  });

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

  /**
   * Tells the venue which zone we are in, so the operator's density includes us.
   *
   * The same endpoint the mobile app uses, with the self-declared form — a browser has no GPS
   * worth trusting at zone granularity, and this is exactly what the phone falls back to when
   * permission is denied. One code path, so a web attendee and a phone attendee are the same
   * kind of thing in the same count.
   *
   * Re-sent on a timer as well as on change: the backend expires an attendee after
   * `session.walker-ttl-ms` (30s), so a tab left open on one zone has to keep saying so or it
   * silently stops counting.
   */
  useEffect(() => {
    if (!flow.sessionId || !atNodeId) return undefined;
    let cancelled = false;

    // Failure here must not cost the attendee their map. They still see the venue and their own
    // position; the only thing lost is the operator seeing them, and there is nothing useful an
    // attendee could do about that.
    const report = () => api.placeWalker(flow.sessionId, walkerId, { nodeId: atNodeId }).catch(() => {});

    report();
    const timer = setInterval(() => { if (!cancelled) report(); }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [flow.sessionId, atNodeId, walkerId]);

  const here = venue?.halls.find((h) => h.id === atNodeId) ?? null;

  if (!venue) {
    return (
      /*
       * Two columns from lg, one below it.
       *
       * The attendee is on a phone in a queue, so the phone layout is the real one and the
       * form is sized for a thumb. But this also opens on a laptop, and a lone 28rem card in
       * the middle of a 1440px window reads as a page that failed to load rather than as a
       * focused one. The second column is not filler: it is the promise the removed venue
       * list was breaking, stated where someone is deciding whether to type their code in.
       */
      <div className="cf-page-in min-h-screen flex items-center px-5 sm:px-6 py-24 sm:py-32" data-portal="walker">
        <div className="w-full max-w-5xl mx-auto grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-10 lg:gap-16 items-center">
          <Reveal>
            <div className="cf-card rounded-2xl p-6 sm:p-8">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(77,141,240,0.16)" }}>
                <MapPin className="w-6 h-6 cf-blue-hi" strokeWidth={2} aria-hidden="true" />
              </span>
              <h1 className="cf-display font-black uppercase text-3xl sm:text-4xl tracking-tight mb-2">Check in</h1>
              <p id="cf-checkin-help" className="text-sm cf-dim leading-relaxed mb-7">
                Type the venue code from the signage at your entrance. The map loads live
                from the venue's own simulation, so what you see is what the operators see.
              </p>

              <label htmlFor="cf-venue-code" className="cf-accent text-[10px] cf-dim2 block mb-2">
                VENUE CODE
              </label>
              <input id="cf-venue-code"
                value={entered} onChange={(e) => setEntered(normaliseCode(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="WEMBLEY-01"
                /* The code is printed in caps on a sign, so the field never fights the person
                   copying it: no autocapitalise surprises, no autocorrect, no spellcheck
                   underline, and the on-screen keyboard opens on the character layout. */
                autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                aria-describedby={joinError ? "cf-checkin-error" : "cf-checkin-help"}
                aria-invalid={joinError ? true : undefined}
                className="cf-input cf-focus w-full rounded-xl px-4 py-4 text-lg cf-display font-bold tracking-[0.3em] text-center mb-4" />

              {/* role="alert" so a screen reader announces the failure instead of leaving the
                  person waiting on a check-in that silently did not happen. */}
              {joinError && (
                <p id="cf-checkin-error" role="alert" className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }}>
                  {joinError}
                </p>
              )}

              <button onClick={join} disabled={flow.busy}
                className="cf-focus cf-btn-primary rounded-xl px-5 py-4 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
                {flow.busy ? "Checking in…" : "Check in"}
              </button>

              <button onClick={() => { signOut(); navigate("/access"); }} className="cf-focus cf-btn-ghost cf-accent text-[11px] mt-6 w-full py-2">
                SIGN OUT
              </button>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="lg:pl-2">
              <span className="cf-accent text-[10px] cf-dim2 block mb-4">ONCE YOU ARE IN</span>
              <ul className="space-y-6">
                {[
                  [Map, "The venue map, live",
                    "Every zone shaded by how full it actually is right now — blue is clear, red is a crush."],
                  [Route, "A way out around the crowd",
                    "The route is planned around the congestion rather than straight through it, and it re-plans as the crowd moves."],
                  [ShieldCheck, "You are not being tracked",
                    "Your position is the zone you tell us you are in. No GPS, no trail, and no other attendee is ever shown to you."],
                ].map(([Icon, title, body]) => (
                  <li key={title} className="flex gap-4">
                    <span className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                      style={{ background: "rgba(77,141,240,0.12)" }}>
                      <Icon className="w-4.5 h-4.5 cf-blue-hi" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="cf-display font-bold uppercase text-sm tracking-wide block mb-1">{title}</span>
                      <span className="text-sm cf-dim leading-relaxed block">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
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
    <PortalShell role="walker" session={session} navigate={navigate} signOut={signOut} onSession={onSession}>
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
              {/* Leave the venue's count immediately rather than waiting out the TTL. Best
                  effort: if it fails, the attendee ages out in thirty seconds anyway. */}
              <button onClick={() => {
                if (flow.sessionId) api.removeWalker(flow.sessionId, walkerId).catch(() => {});
                flow.leave(); setAtNodeId(null); setDestinationId(null);
              }}
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
              Tap the zone you're standing in. The venue is told which zone that is — never a
              coordinate — so staff see how full each area is, not where you are. You are not
              named, nothing is linked to an account, and you stop counting about thirty seconds
              after you close this. Other attendees are never shown to you.
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
    ? { color: "var(--cf-red-text)", Icon: AlertTriangle,
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
