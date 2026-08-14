/**
 * The frame every signed-in portal renders inside: identity, navigation, and the profile panel.
 *
 * One shell for all three roles, with the tabs passed in, because the walker, client and admin
 * consoles differ in what they show and not in how they are framed.
 */

import React, { useState } from 'react';
import { Avatar, ProfilePanel, ROLES, personName } from './account.jsx';
import { CoreHeaderBar, CoreStrip } from './chrome.jsx';
import { LogoMark } from './primitives.jsx';

export function PortalShell({ role, session, navigate, signOut, onSession, tabs, active, setActive, children }) {
  const r = ROLES[role];
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="cf-page-in pb-20" data-portal={role}>
      {/* The portal chrome, and now the only chrome: the site header stands down inside a
          portal, so this bar carries the mark as well as the role identity, the account and
          sign out. Full-bleed rather than inset in the content column, so it reads as the
          frame around the portal rather than as the first card inside it.

          Sticky rather than fixed: it stays with you down a long session list without the
          content needing to reserve a gap for it, which is what left the dead band above. */}
      <div className="border-b sticky top-0 z-40"
        style={{ borderColor: "var(--cf-line)", background: "rgba(11,16,24,0.88)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-7xl mx-auto">
          <CoreHeaderBar
            accent={r.color}
            userName={personName(session)}
            userStatus={session?.bio || "Active now"}
            title={
              <>
                {/* The mark, and the only way back to the public site from inside a portal.
                    Sign out is the other exit, and it is next to the account where it belongs. */}
                <a href="#/" onClick={(e) => { e.preventDefault(); navigate("/"); }}
                  aria-label="Crowd Flow Optimiser — back to site"
                  className="cf-focus rounded shrink-0 hidden sm:flex items-center pr-3 mr-1 border-r"
                  style={{ borderColor: "var(--cf-line)" }}>
                  <LogoMark size={26} />
                </a>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in oklab, ${r.color} 18%, transparent)` }}>
                  <r.Icon className="w-4.5 h-4.5" style={{ color: r.color }} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="cf-accent text-[9px] cf-dim2 block leading-none mb-1">{r.who.toUpperCase()}</span>
                  <h1 className="cf-display font-black uppercase text-lg sm:text-xl tracking-tight leading-none italic">
                    {r.label} portal
                  </h1>
                </span>
              </>
            }
            /* The account block is the control. A portal shows one person's identity all day,
               so the picture opens the profile rather than sitting next to something that does. */
            userAvatar={<Avatar session={session} size={36} />}
            onUserClick={() => setProfileOpen(true)}
            right={
              <button onClick={() => { signOut(); navigate("/access"); }}
                className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                SIGN OUT
              </button>
            }
          />
        </div>

        {tabs && (
          <div className="max-w-7xl mx-auto">
            <CoreStrip accent={r.color} current={active} onChange={setActive}
              links={tabs.map((t) => ({ name: t, href: t }))} />
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-8">
        {children}
      </div>

      {profileOpen && (
        <ProfilePanel session={session} onClose={() => setProfileOpen(false)}
          onSaved={(updated) => onSession?.(updated)} />
      )}
    </div>
  );
}

/* ---- Walker portal ---- */

export function zoneName(venue, nodeId) {
  return venue?.halls.find((h) => h.id === nodeId)?.name ?? nodeId;
}

/* ============================================================================
   Footer
   ========================================================================== */

