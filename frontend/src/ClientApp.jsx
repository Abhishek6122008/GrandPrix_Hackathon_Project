/**
 * The organiser portal: build a venue, run a session on it, and watch what happens.
 *
 * This is the screen the whole product is for. Everything else either feeds it or reads from it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { api } from './api.js';
import { useCrowdFlow } from './useCrowdFlow.js';
import sampleVenue from './sampleVenue.json';
import LayoutStudio from './LayoutStudio.jsx';
import { rankHazards, hazardWarning } from './crowdRouting.js';
import { normaliseCode, codeError, suggestCode } from './venueCode.js';
import {
  AlertTriangle, Cpu, Check, Upload, Smartphone,
} from 'lucide-react';
import { PortalShell } from './PortalShell.jsx';
import { VenueMap, densityColor } from './VenueMap.jsx';
import { ConnectionPill, CountUp, DensityBar, ErrorNote } from './primitives.jsx';

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
        {parseError && <p className="text-sm mt-3" style={{ color: "var(--cf-red-text)" }}>{parseError}</p>}

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
            ? <p className="text-sm mt-2" style={{ color: "var(--cf-red-text)" }}>{codeIssue}</p>
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
            style={{ background: "rgba(225,6,0,.16)", color: "var(--cf-red-text)" }}>
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

/**
 * Ties a venue's layout to real coordinates, so the mobile app can turn a GPS fix into a zone.
 *
 * Three anchors. Two would seem enough — a similarity has four degrees of freedom and two points
 * give four equations — but a rotation and its mirror image fit two points equally well, and
 * since venue y runs downward while north runs up, the mirrored one is usually what a two-point
 * solve picks. The result fits both anchors perfectly and sends people to the gate diagonally
 * opposite. The third anchor settles handedness from the data.
 *
 * Deliberately typed rather than walked: coordinates for three known gates can be read off any
 * map app in a minute, which unblocks the demo without anybody standing in the building. A
 * "stand here, tap" capture mode belongs in the phone app, later.
 */
function GeorefPanel({ venue }) {
  const zones = venue.halls;
  const [rows, setRows] = useState(() => [0, 1, 2].map((i) => ({
    // Gates and exits first: zone radius comes from capacity, so those are the smallest and the
    // easiest to stand in the middle of. Anchor placement error is the ceiling on the accuracy
    // of this whole feature.
    nodeId: (zones.filter((z) => z.type === "GATE" || z.type === "EXIT")[i] ?? zones[i])?.id ?? "",
    lat: "",
    lng: "",
  })));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getGeoref(venue.id)
      .then((georef) => { if (!cancelled) setResult(georef); })
      // 404 is the ordinary answer — most venues have no georeference and never will.
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [venue.id]);

  const setRow = (i, patch) =>
    setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const anchors = rows.map((row) => ({
        nodeId: row.nodeId,
        lat: Number(row.lat),
        lng: Number(row.lng),
      }));
      if (anchors.some((a) => !a.nodeId || !Number.isFinite(a.lat) || !Number.isFinite(a.lng))) {
        setError("Every anchor needs a zone and a numeric latitude and longitude.");
        return;
      }
      setResult(await api.setGeoref(venue.id, anchors));
    } catch (cause) {
      // The backend's messages name the measurement that failed and the value it needed, which
      // is far more useful than anything this form could work out for itself.
      setError(cause.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.clearGeoref(venue.id);
      setResult(null);
      setError(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-card rounded-2xl p-6">
      <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">
        GPS reference
      </div>
      <p className="text-sm cf-dim leading-relaxed mb-5">
        Stand in three zones and record the coordinates your phone reports, or read them off a map
        app. Attendees on the mobile app can then be placed automatically instead of tapping their
        zone. Without this the app still works — it just asks people where they are.
      </p>

      {result ? (
        <div className="cf-card-solid rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-4 h-4" style={{ color: "var(--cf-green)" }} strokeWidth={2.5} />
            <span className="text-sm font-semibold">This venue is georeferenced</span>
          </div>
          <div className="cf-mono text-[11px] cf-dim2">
            {result.scaleRatio?.toFixed(2)} layout units per metre · {result.shearDegrees?.toFixed(1)}° shear
          </div>
          {/* Reported, not enforced. A stylised layout genuinely has some shear, and the person
              who drew it is better placed than the server to judge how much is too much. */}
          {result.shearDegrees > 15 && (
            <div className="cf-mono text-[11px] mt-2" style={{ color: "var(--cf-amber)" }}>
              High shear — the fit may be absorbing anchor error. Check the three readings.
            </div>
          )}
          <button onClick={clear} disabled={busy}
            className="cf-focus cf-btn-outline rounded-lg px-3 py-1.5 cf-accent text-[10px] mt-3">
            REMOVE
          </button>
        </div>
      ) : (
        <div className="cf-mono text-[11px] cf-dim2 mb-5">
          NOT SET · the app will ask attendees to tap their zone
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_7rem] gap-2">
            <select value={row.nodeId} onChange={(e) => setRow(i, { nodeId: e.target.value })}
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm">
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
            <input value={row.lat} onChange={(e) => setRow(i, { lat: e.target.value })}
              placeholder="lat" inputMode="decimal"
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm cf-mono" />
            <input value={row.lng} onChange={(e) => setRow(i, { lng: e.target.value })}
              placeholder="lng" inputMode="decimal"
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm cf-mono" />
          </div>
        ))}
      </div>

      <p className="cf-mono text-[10px] cf-dim2 mt-3 leading-relaxed">
        USE GATES AND EXITS. A zone's radius comes from its capacity, so a gate is a few metres
        across and a large stand is tens — and how close to a zone's centre you stood is the limit
        on how accurate any of this can be.
      </p>

      <ErrorNote error={error} />

      <button onClick={save} disabled={busy}
        className="cf-focus cf-btn-primary rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide w-full mt-4 disabled:opacity-50">
        {busy ? "Saving…" : result ? "Replace anchors" : "Set anchors"}
      </button>
    </div>
  );
}

export function ClientApp({ session, navigate, signOut, onSession }) {
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
    <PortalShell role="client" session={session} navigate={navigate} signOut={signOut} onSession={onSession}
      tabs={["Live", "AI layout", "GPS"]} active={tab} setActive={setTab}>

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
              {/* Real attendees are counted apart from simulated agents, never folded in. An
                  operator looking at a busy zone has to be able to tell how much of it is people
                  with phones and how much is the model — they are not the same evidence. */}
              {(metrics?.realWalkers ?? 0) > 0 && (
                <div className="cf-mono text-[11px] mb-4 flex items-center gap-1.5"
                  style={{ color: "var(--cf-blue-hi)" }}>
                  <Smartphone className="w-3.5 h-3.5" strokeWidth={2} />
                  {metrics.realWalkers.toLocaleString()} REAL {metrics.realWalkers === 1 ? "ATTENDEE" : "ATTENDEES"} ON THE APP
                </div>
              )}
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
      {tab === "GPS" && !venue && (
        <div className="cf-card rounded-2xl px-6 py-14 text-center">
          <p className="text-sm cf-dim">Create a session on the Live tab to georeference its venue.</p>
        </div>
      )}

      {tab === "GPS" && venue && <GeorefPanel venue={venue} />}

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
