/**
 * Who the signed-in person is, and how they are drawn.
 *
 * The session shape, the display-name rules, the generated avatar and the profile editor. The
 * avatar hue is derived from the account id rather than stored, so it is stable across devices
 * and across sessions — a generated identity that changed each sign-in would be worse than none.
 */

import React, { createElement, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import {
  Radio, X, Upload, Building2, UserCog, Ticket,
} from 'lucide-react';

export function toSession(u) {
  return {
    id: u?.id ?? null,
    email: u?.email ?? "",
    role: (u?.role ?? "walker").toLowerCase(),
    displayName: u?.displayName ?? null,
    bio: u?.bio ?? null,
    avatar: u?.avatar ?? null,
  };
}

/** What to call someone: the name they chose, or the part of their address before the @. */
export function personName(session) {
  const name = session?.displayName?.trim();
  if (name) return name;
  const local = (session?.email ?? "").split("@")[0];
  return local || "Account";
}

/** One or two letters for the fallback avatar. "Ops Lead" → OL, "moazz" → MO. */
function initialsOf(session) {
  const source = personName(session).replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * A stable hue per account.
 *
 * Derived from the account id so the same person is the same colour on every device and after
 * every sign-in — a generated avatar that changed between sessions would be worse than none,
 * because the colour is the thing people actually recognise in a header. Hashed rather than
 * taken modulo directly so neighbouring ids do not come out as neighbouring colours.
 */
function avatarHue(seed) {
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/**
 * The account's picture, or a generated stand-in.
 *
 * Nobody uploads a photo before they need one, so the empty state has to look deliberate
 * rather than broken: initials on a colour the account owns. The uploaded image, when there is
 * one, is a data URI already carried on the session — no second request to draw a 36px circle.
 */
export function Avatar({ session, size = 36, className = "", ring = true }) {
  const hue = avatarHue(session?.id ?? session?.email);
  const style = {
    width: size, height: size,
    boxShadow: ring ? "inset 0 0 0 1px rgba(255,255,255,0.14)" : "none",
  };
  if (session?.avatar) {
    return (
      <img src={session.avatar} alt="" aria-hidden="true"
        className={`rounded-full object-cover shrink-0 ${className}`} style={style} />
    );
  }
  return (
    <span aria-hidden="true"
      className={`rounded-full shrink-0 flex items-center justify-center cf-display font-black ${className}`}
      style={{
        ...style,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        letterSpacing: "0.02em",
        color: `hsl(${hue} 80% 88%)`,
        background: `linear-gradient(140deg, hsl(${hue} 55% 26%), hsl(${hue} 62% 16%))`,
      }}>
      {initialsOf(session)}
    </span>
  );
}

export const ROLES = {
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
    key: "admin", label: "Admin", who: "Platform operations", color: "var(--cf-red-text)", Icon: UserCog,
    tagline: "Every venue. Every bottleneck.",
    blurb: "The operations console. Cross-venue monitoring, layout review, incident history, and the model's own accuracy over time — where predicted risk did and didn't match what happened.",
    can: ["All venues and layouts", "Cross-venue bottleneck monitoring", "Client account management", "Model accuracy and incident review"],
    cannot: ["Attendee personal data beyond anonymised position", "Anything without an audit-log entry"],
  },
};

/**
 * Portal chooser — supplied pricing-card pattern, ported TSX → JS.
 *
 * The structure is kept as-is: a badge and centred header, the headline value under it, a
 * divider, a checklist of what you get, and a CTA pinned to the bottom of the card so all
 * three buttons line up regardless of how much text sits above them. One card is `featured`
 * and carries the ring plus a "most popular" flag.
 *
 * Two things are re-pointed at this product. There is no billing here, so the price slot
 * carries the tagline — the line that actually distinguishes one portal from another. And
 * the pricing card lists only inclusions; a portal's *exclusions* are the security boundary
 * and the most important thing on the page, so the checklist keeps both, with the same
 * green-check / red-cross language used elsewhere in the app.
 */
async function shrinkImage(file, max = 256) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // Square-crop from the centre, so a portrait photo does not arrive squashed into a circle.
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap,
      (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close?.();
  }
}

/**
 * The account panel: who you are, and the three things you can change about it.
 *
 * Deliberately a panel over the portal rather than its own route. Editing a profile is a
 * detour from whatever the person came here to do — an organiser mid-session should not lose
 * the running venue to change their name — so it opens over the work and closes back onto it.
 */
export function ProfilePanel({ session, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(session.displayName ?? "");
  const [bio, setBio] = useState(session.bio ?? "");
  const [avatar, setAvatar] = useState(session.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const role = ROLES[session.role] ?? ROLES.walker;

  // Escape closes, and focus starts inside the panel rather than wherever the page left it.
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";           // so choosing the same file twice still fires
    if (!file) return;
    setError("");
    try {
      setAvatar(await shrinkImage(file));
    } catch {
      setError("That image could not be read. Try a PNG or JPEG.");
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.auth.updateProfile({
        displayName,
        bio,
        // Empty string clears it server-side; null would read as "leave alone".
        avatar: avatar ?? "",
      });
      onSaved(toSession(updated));
      setSaved(true);
      setTimeout(onClose, 700);
    } catch (err) {
      setError(err?.message ?? "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const preview = { ...session, displayName, avatar };

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <button aria-label="Close profile" onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="cf-profile-title"
        className="cf-card relative rounded-2xl w-full max-w-lg p-6 sm:p-8 my-auto">
        <div className="flex items-start justify-between gap-4 mb-7">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar session={preview} size={56} />
            <div className="min-w-0">
              <h2 id="cf-profile-title" className="cf-display font-black uppercase text-xl tracking-tight leading-none mb-1.5">
                Your profile
              </h2>
              <span className="cf-accent text-[10px] cf-dim2 block">
                {role.label.toUpperCase()} · <span className="cf-mono normal-case">{session.email}</span>
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="cf-focus cf-btn-outline rounded-lg w-9 h-9 flex items-center justify-center shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => fileRef.current?.click()}
            className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2.5 cf-accent text-[10px]">
            {avatar ? "CHANGE PICTURE" : "UPLOAD PICTURE"}
          </button>
          {avatar && (
            <button onClick={() => setAvatar(null)}
              className="cf-focus cf-btn-ghost cf-accent text-[10px]">REMOVE</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="sr-only" tabIndex={-1} />
        </div>

        <label htmlFor="cf-profile-name" className="cf-accent text-[10px] cf-dim2 block mb-2">DISPLAY NAME</label>
        <input id="cf-profile-name" value={displayName} maxLength={120}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={personName({ email: session.email })}
          className="cf-input cf-focus w-full rounded-xl px-4 py-3 text-sm mb-5" />

        <div className="flex items-baseline justify-between mb-2">
          <label htmlFor="cf-profile-bio" className="cf-accent text-[10px] cf-dim2">ABOUT YOU</label>
          <span className="cf-mono text-[10px] cf-dim2">{bio.length}/280</span>
        </div>
        <textarea id="cf-profile-bio" value={bio} maxLength={280} rows={3}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Ops lead, north stand. Radio channel 4."
          className="cf-input cf-focus w-full rounded-xl px-4 py-3 text-sm resize-none mb-2" />
        <p className="text-xs cf-dim2 leading-relaxed mb-6">
          Shown to you, and to the operators of venues you work with. Never to other attendees.
        </p>

        {error && <p role="alert" className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }}>{error}</p>}

        <button onClick={save} disabled={busy}
          className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
          {saved ? "Saved" : busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

