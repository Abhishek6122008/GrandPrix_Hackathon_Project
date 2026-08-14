/**
 * The frame around every page: the marketing header, the in-portal bars, and the router.
 *
 * useHashRoute is the whole routing story — a hash listener and a piece of state. There is no
 * router dependency here and the app is small enough that adding one would be more code than
 * it removes.
 */

import React, { createElement, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Menu, X,
} from 'lucide-react';
import { ROLES } from './account.jsx';
import { LogoMark, Magnetic, ScrollProgress, Wordmark } from './primitives.jsx';

export function CoreHeaderBar({ title, eyebrow, userName, userStatus = "Active now", userImage,
                         userAvatar, onUserClick, accent, children, right }) {
  return (
    <div className="relative h-16 flex items-center justify-between gap-4 px-4 sm:px-6 overflow-hidden">
      <div className="cf-gridfade" aria-hidden="true" />

      <div className="relative z-10 flex items-center gap-3 min-w-0">
        {title}
      </div>

      {children}

      <div className="relative z-10 flex items-center gap-3 shrink-0">
        {right}
        {userName && createElement(
          onUserClick ? "button" : "div",
          {
            ...(onUserClick
              ? {
                  onClick: onUserClick,
                  "aria-label": `Profile — ${userName}`,
                  className: "cf-focus rounded-full flex items-center gap-3 shrink-0 transition-opacity duration-200 hover:opacity-80",
                }
              : { className: "flex items-center gap-3 shrink-0" }),
          },
          <div key="who" className="hidden sm:flex flex-col items-end leading-tight">
            <span className="cf-accent text-[10px] truncate max-w-[16ch]" style={{ color: "var(--cf-ink)" }}>{userName.toUpperCase()}</span>
            <span className="cf-accent text-[9px] cf-dim2 opacity-70 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent || "var(--cf-green)" }} />
              {userStatus.toUpperCase()}
            </span>
          </div>,
          /* One avatar, not two. A caller that has a real account passes its own — carrying the
             uploaded picture and the generated fallback — and it replaces this circle entirely
             rather than sitting beside it. */
          userAvatar
            ? <span key="avatar" className="shrink-0">{userAvatar}</span>
            : (
              <div key="avatar" className="size-9 rounded-full overflow-hidden p-0.5 shrink-0"
                style={{ border: `1px solid ${accent || "var(--cf-line2)"}`, background: "var(--cf-panel)" }}>
                {userImage
                  ? <img src={userImage} alt="" className="size-full rounded-full object-cover" />
                  : (
                    /* No profile behind this one — an initial on the role's own colour names the
                       account without inventing a face for it. */
                    <span className="size-full rounded-full flex items-center justify-center cf-display font-black text-xs"
                      style={{ background: `color-mix(in oklab, ${accent || "var(--cf-blue-hi)"} 22%, transparent)`, color: accent || "var(--cf-blue-hi)" }}>
                      {userName.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/**
 * The segmented filter strip. Horizontally scrollable with the scrollbar hidden, and a fade
 * on the right edge so a strip that overflows reads as continuing rather than as cut off.
 */
export function CoreStrip({ links, current, onChange, accent, transparent = false }) {
  return (
    <div className="relative group transition-colors duration-300"
      style={{
        borderTop: `1px solid ${transparent ? "transparent" : "var(--cf-line)"}`,
        background: "transparent",
      }}>
      <div className="cf-strip">
        {links.map((l) => {
          const active = current === l.href;
          return (
            <button key={l.href} type="button" onClick={() => onChange(l.href)}
              data-active={active} aria-current={active ? "page" : undefined}
              className="cf-strip-item cf-focus"
              style={active ? { color: accent || "var(--cf-orange)" } : undefined}>
              {l.name}
              {active && (
                <motion.span layoutId="cf-strip-underline" className="absolute left-0 right-0 bottom-0 h-0.5"
                  initial={false} transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  style={{ background: accent || "var(--cf-orange)" }} />
              )}
            </button>
          );
        })}
      </div>
      <div className="md:hidden absolute right-0 top-0 bottom-0 w-8 pointer-events-none"
        style={{ background: "linear-gradient(270deg, var(--cf-bg), transparent)" }} aria-hidden="true" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Bento tile visuals — supplied component's pattern, ported TSX → JS.

   The structure is kept: an asymmetric 6-column grid where each tile carries a small live
   animation above its label, instead of a static icon. The demos themselves are rewritten,
   because the originals showed a scaling "Aa", a CDN globe and a phone — none of which this
   product does. Each one below animates a mechanic the copy underneath actually claims, so
   the picture is evidence for the sentence rather than decoration beside it.

   All of them freeze under `prefers-reduced-motion`: they are decorative loops, and a
   permanently cycling animation is the thing that setting exists to stop.
   -------------------------------------------------------------------------- */

/**
 * Congestion spreading along the graph.
 *
 * A row of five zones. One goes critical, then its neighbours climb in sequence — the
 * propagation the model predicts, which a per-node threshold cannot see coming.
 */
const NAV = [
  { path: "/", label: "Home" },
  { path: "/how", label: "How it works" },
  { path: "/platform", label: "Platform" },
  { path: "/intelligence", label: "Intelligence" },
  { path: "/results", label: "Results" },
];

export function useHashRoute() {
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

export function Header({ route, navigate, session, signOut, inPortal = false }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [route]);
  const go = (e, p) => { e.preventDefault(); navigate(p); };

  const lifted = solid || open;

  /*
   * A portal draws its own chrome, so the site header stands down entirely.
   *
   * With the marketing routes gone from it this bar had nothing left but the logo — a 64px
   * strip of almost nothing, floating above the portal's own bar with a dead gap between the
   * two. Two bars where one is empty reads as a layout that broke rather than as a frame. The
   * logo moves into PortalShell's bar, which becomes the single piece of chrome.
   *
   * After every hook above, so the hook order stays identical on both paths.
   */
  if (inPortal) return null;

  return (
    // The blur is applied unconditionally and its *opacity* is what animates.
    // `backdrop-filter` is a discrete property: toggling it between "none" and a blur cannot
    // transition, so the old version snapped the whole bar on the first scroll tick — which
    // is what made the header lurch on the way down. Painting the background on a child that
    // fades keeps the change continuous.
    <header className="fixed top-0 left-0 right-0 z-50">
      <div aria-hidden="true" className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: lifted ? 1 : 0,
          background: "rgba(5,7,11,0.86)",
          backdropFilter: "blur(14px) saturate(120%)",
          WebkitBackdropFilter: "blur(14px) saturate(120%)",
          borderBottom: "1px solid var(--cf-line)",
        }} />
      <ScrollProgress />
      <div className="relative max-w-7xl mx-auto">
        <CoreHeaderBar
          accent="var(--cf-orange)"
          /* Only a real session produces an identity here. The source component always drew
             an avatar and "Active now"; on a public page that would tell a logged-out
             visitor they are signed in.
             Inside a portal the identity is suppressed entirely: PortalShell renders its own
             bar with the same account and sign-out directly below this one, and showing both
             put the same email and avatar on screen twice. */
          userName={inPortal ? undefined : session?.email}
          userStatus="Signed in"
          title={
            <a href="#/" onClick={(e) => go(e, "/")} className="group flex items-center gap-2.5 cf-focus rounded shrink-0">
              <span className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-105"
                style={{ transitionTimingFunction: "var(--cf-ease)" }}>
                <LogoMark size={30} />
              </span>
              {/* The source wordmark is italic and tight; this typeface is already condensed,
                  so tracking-tight on top of it closed the letterforms up. Normal tracking
                  and an explicit space keep "Crowd Flow Optimiser" legible at 16px. */}
              <span className="cf-display font-bold uppercase text-base leading-none italic whitespace-nowrap">
                Crowd Flow&nbsp;<span className="cf-dim font-normal not-italic">Optimiser</span>
              </span>
            </a>
          }
          right={
            <>
              {session ? (
                <div className="hidden lg:flex items-center gap-3">
                  <Magnetic strength={4}>
                    <a href={`#/app/${session.role}`} onClick={(e) => go(e, `/app/${session.role}`)}
                      className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2 cf-accent text-[11px] block">
                      MY PORTAL
                    </a>
                  </Magnetic>
                  <button onClick={signOut} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">SIGN OUT</button>
                </div>
              ) : (
                <div className="hidden lg:flex items-center gap-3">
                  <Magnetic strength={4}>
                    <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2 cf-accent text-[11px] block">
                      OPEN PORTAL
                    </a>
                  </Magnetic>
                </div>
              )}
              {/* The drawer only carries site routes, so inside a portal it has nothing to
                  open. Sign out lives in the portal's own bar. */}
              {!inPortal && (
                <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
                  className="lg:hidden cf-focus cf-btn-outline rounded-lg w-9 h-9 flex items-center justify-center">
                  {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              )}
            </>
          }
        />

        {/* Routes as a segmented strip rather than spaced links. Hidden on small screens,
            where the drawer below already carries the same destinations.

            Not rendered inside a portal at all. A portal is the application, not a page of the
            marketing site, and carrying the site's routes into it is what offered a signed-in
            attendee a lane to the other tiers' sign-in screens. The portal's own bar below
            already holds the account, its tabs and sign out. */}
        <div className={inPortal ? "hidden" : "hidden lg:block"}>
          {/* At rest the header is transparent over the hero, so the strip drops its own
              background and rules to match; they fade in together on scroll. */}
          <CoreStrip accent="var(--cf-orange)" current={route} transparent={!solid && !open}
            onChange={(href) => navigate(href)}
            links={NAV.map((r) => ({ name: r.label, href: r.path }))} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && !inPortal && (
          <motion.div key="cf-mobile-nav" className="lg:hidden border-t cf-hairline overflow-hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-6 py-4 flex flex-col gap-1">
              {NAV.map((r, i) => (
                <motion.a key={r.path} href={`#${r.path}`} onClick={(e) => go(e, r.path)}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i + 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="cf-accent text-sm py-2.5 cf-focus rounded flex items-center justify-between"
                  style={{ color: route === r.path ? "var(--cf-orange)" : "var(--cf-dim)" }}>
                  {r.label.toUpperCase()}
                  {route === r.path && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-orange)" }} />}
                </motion.a>
              ))}
              {session ? (
                <>
                  <a href={`#/app/${session.role}`} onClick={(e) => go(e, `/app/${session.role}`)}
                    className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2.5 cf-accent text-[11px] text-center mt-3">
                    MY PORTAL
                  </a>
                  <button onClick={signOut} className="cf-focus cf-btn-outline rounded-lg px-4 py-2.5 cf-accent text-[10px] mt-2">
                    SIGN OUT
                  </button>
                </>
              ) : (
                <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2.5 cf-accent text-[11px] text-center mt-3">
                  OPEN PORTAL
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ============================================================================
   Marketing pages
   ========================================================================== */

export function Footer({ navigate }) {
  return (
    <footer className="border-t cf-hairline relative" style={{ background: "rgba(5,7,11,0.6)" }}>
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid md:grid-cols-[2fr_1fr_1fr] gap-10 mb-10">
          <div>
            <Wordmark size={32} className="mb-4" />
            <p className="cf-dim text-sm leading-relaxed max-w-sm mb-5">
              Simulate the venue, predict the bottleneck, route around it — before the queue becomes a crush.
            </p>
            {/* The density ramp as a legend. It is the one piece of visual language a reader
                needs to interpret every map on the site, so it is worth restating at the end. */}
            <div className="flex items-center gap-2">
              <span className="cf-accent text-[10px] cf-dim2">CLEAR</span>
              <span className="h-1.5 w-28 rounded-full" style={{ background: "linear-gradient(90deg, var(--cf-green), var(--cf-amber), var(--cf-orange), var(--cf-red))" }} />
              <span className="cf-accent text-[10px] cf-dim2">CRUSH</span>
            </div>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PLATFORM</div>
            <div className="flex flex-col gap-2">
              {NAV.map((r) => (
                <a key={r.path} href={`#${r.path}`} onClick={(e) => { e.preventDefault(); navigate(r.path); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-all duration-300 hover:translate-x-1">{r.label}</a>
              ))}
            </div>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PORTALS</div>
            <div className="flex flex-col gap-2">
              {Object.values(ROLES).map((r) => (
                <a key={r.key} href={`#/login/${r.key}`} onClick={(e) => { e.preventDefault(); navigate(`/login/${r.key}`); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-all duration-300 hover:translate-x-1">{r.label}</a>
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

