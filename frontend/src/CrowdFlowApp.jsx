/**
 * The application: mounts the stylesheet, holds the session, and routes.
 *
 * Everything that used to live here now lives beside it in src/ — this file's job is to decide
 * which screen is on, and to own the one piece of state that every screen needs.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { api } from './api.js';
import { AdminApp } from './AdminApp.jsx';
import { ClientApp } from './ClientApp.jsx';
import { WalkerApp } from './WalkerApp.jsx';
import { toSession } from './account.jsx';
import { STYLE } from './appStyle.js';
import { AccessPage, AlreadySignedIn, LoginPage } from './authPages.jsx';
import { Footer, Header, useHashRoute } from './chrome.jsx';
import { HomePage, HowItWorksPage, IntelligencePage, PlatformPage, ResultsPage } from './marketingPages.jsx';
import { MeshField } from './primitives.jsx';

export default function CrowdFlowApp() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState(null);

  // A token in localStorage outlives the page, so the app asks the backend who it belongs to
  // on boot. Without this, a refresh looked signed-out while every API call was still
  // authenticated — the two states would disagree until the next manual login.
  useEffect(() => {
    let alive = true;
    api.auth.me()
      .then((me) => {
        if (alive && me) setSession(toSession(me));
      })
      .catch(() => { /* signed out is the correct fallback */ });
    return () => { alive = false; };
  }, []);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [route]);

  const signIn = (s) => setSession(s);
  const signOut = () => { api.auth.signOut(); setSession(null); };

  /* Portal chrome, not site chrome. Also covers /login/* while a session exists, because that
     route then renders the "signed in as" guard — and offering the site's routes beside it
     would hand back the same lane to another tier's sign-in that the guard just closed. */
  const isPortal = route.startsWith("/app/") || (!!session && route.startsWith("/login/"));
  const loginMatch = route.match(/^\/login\/(walker|client|admin)$/);
  const appMatch = route.match(/^\/app\/(walker|client|admin)$/);

  /*
   * One session, one portal.
   *
   * These routes used to check only that *a* session existed, so a signed-in walker who typed
   * /app/admin got the operations console rendered around them. The backend refused every
   * request it made, so no data escaped — but the product's whole claim is that each portal
   * shows exactly what its job requires and nothing beyond it, and a console that draws itself
   * and then fails to fill in is a worse answer than not drawing.
   *
   * A mismatch is not treated as an error either. Landing on the wrong tier is almost always a
   * stale link or a shared URL, so the guard states which account is signed in and offers the
   * two things that actually help: go to your own portal, or sign out and use the other one.
   */
  let page;
  if (loginMatch) {
    const wanted = loginMatch[1];
    if (!session) {
      page = <LoginPage roleKey={wanted} navigate={navigate} signIn={signIn} />;
    } else if (session.role === wanted) {
      page = <AlreadySignedIn session={session} wanted={wanted} navigate={navigate} signOut={signOut} sameTier />;
    } else {
      page = <AlreadySignedIn session={session} wanted={wanted} navigate={navigate} signOut={signOut} />;
    }
  } else if (appMatch) {
    const role = appMatch[1];
    if (!session) {
      page = <LoginPage roleKey={role} navigate={navigate} signIn={signIn} />;
    } else if (session.role !== role) {
      page = <AlreadySignedIn session={session} wanted={role} navigate={navigate} signOut={signOut} />;
    } else if (role === "walker") {
      page = <WalkerApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    } else if (role === "client") {
      page = <ClientApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    } else {
      page = <AdminApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    }
  } else {
    switch (route) {
      case "/how": page = <HowItWorksPage navigate={navigate} />; break;
      case "/platform": page = <PlatformPage navigate={navigate} />; break;
      case "/intelligence": page = <IntelligencePage />; break;
      case "/results": page = <ResultsPage />; break;
      case "/access": page = <AccessPage navigate={navigate} />; break;
      default: page = <HomePage navigate={navigate} />;
    }
  }

  return (
    <div className="cf-root">
      <style>{STYLE}</style>
      <MeshField />
      <div className="relative" style={{ zIndex: 2 }}>
        <Header route={route} navigate={navigate} session={session} signOut={signOut} inPortal={isPortal} />
        {/* `mode="wait"` so the outgoing page finishes leaving before the next arrives.
            Cross-fading them instead put two full-height pages in the layout at once and
            the footer jumped as they swapped. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={route}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
            {page}
          </motion.main>
        </AnimatePresence>
        {!isPortal && <Footer navigate={navigate} />}
      </div>
    </div>
  );
}

