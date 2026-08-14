/**
 * The operations console: every session on the platform, not just your own.
 *
 * Reachable only by an address on auth.admin-emails — see AdminAllowlist on the backend, which
 * is what actually enforces that.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useCrowdFlow } from './useCrowdFlow.js';
import {
  Building2, Bell,
} from 'lucide-react';
import { PortalShell, zoneName } from './PortalShell.jsx';
import { VenueMap } from './VenueMap.jsx';
import { ConnectionPill, CountUp, ErrorNote, SESSION_STATUS_META, STATUS_META } from './primitives.jsx';
import { useSessionList } from './useSessionList.js';

export function AdminApp({ session, navigate, signOut, onSession }) {
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
    <PortalShell role="admin" session={session} navigate={navigate} signOut={signOut} onSession={onSession}
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
                      ? { background: "color-mix(in oklab, var(--cf-red) 18%, transparent)", color: "var(--cf-red-text)", border: "1px solid var(--cf-red)" }
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
