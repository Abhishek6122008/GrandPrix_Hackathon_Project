/**
 * The doors: the portal chooser, the sign-in form and what happens when you are already in.
 *
 * The password rules shown here mirror the server's, and deliberately so — see credentials.js
 * for why that duplication is the point rather than something to refactor away.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from './api.js';
import { emailError, passwordChecks, passwordError, passwordAcceptable, passwordStrength } from './credentials.js';
import {
  ShieldCheck, Check, Lock, ArrowRight, CircleCheck, CircleX,
} from 'lucide-react';
import { GradientShimmer } from './GradientShimmer.jsx';
import { ROLES, toSession } from './account.jsx';
import { CanvasRevealEffect, PageHeader, Reveal, Spotlight, usePrefersReducedMotion } from './primitives.jsx';

export function AccessPage({ navigate }) {
  // Client is featured: it is the only role that can create a session, so it is the one a
  // first-time visitor almost always wants.
  const plans = Object.values(ROLES).map((r) => ({ ...r, featured: r.key === "client" }));

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="PORTALS" title="Pick your way in"
        lede="One platform, three portals. Each sees exactly what its job requires and nothing beyond it — the boundaries below are the actual access model, not a marketing summary." />

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan, i) => (
            <Reveal key={plan.key} delay={i * 90} className="h-full">
              <Spotlight
                color={plan.color}
                aria-label={`${plan.label} portal`}
                className={`cf-bento group rounded-2xl p-6 h-full flex flex-col text-left ${plan.featured ? "min-[900px]:-translate-y-2" : ""}`}
                style={plan.featured
                  ? { borderColor: plan.color, boxShadow: `0 0 0 1px color-mix(in oklab, ${plan.color} 22%, transparent), var(--cf-shadow-lg)` }
                  : undefined}>

                {/* Header block — badge, then the tagline in the slot a price would occupy. */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 flex-wrap justify-center">
                    <span className="cf-accent text-[10px] rounded-full px-2.5 py-1"
                      style={plan.featured
                        // Dark ink on the bright chip, not white. White on the featured accent
                        // reaches 2.87:1 — this is 7.02:1, and dark-on-bright is what a solid
                        // accent chip wants anyway. Holds while the featured plan is the
                        // orange one; a dark accent would need the inverse.
                        ? { background: plan.color, color: "var(--cf-bg)" }
                        : { background: "rgba(255,255,255,0.06)", color: "var(--cf-dim)", border: "1px solid var(--cf-line)" }}>
                      {plan.label.toUpperCase()}
                    </span>
                    {plan.featured && (
                      <span className="cf-accent text-[10px] rounded-full px-2.5 py-1"
                        style={{ background: `color-mix(in oklab, ${plan.color} 16%, transparent)`, color: plan.color }}>
                        MOST USED
                      </span>
                    )}
                  </div>

                  <span className="mt-5 mb-4 w-12 h-12 rounded-xl mx-auto flex items-center justify-center transition-transform duration-500 group-hover:scale-110"
                    style={{ background: `color-mix(in oklab, ${plan.color} 18%, transparent)`, transitionTimingFunction: "var(--cf-ease)" }}>
                    <plan.Icon className="w-6 h-6" style={{ color: plan.color }} strokeWidth={2} />
                  </span>

                  {/* The role name is the anchor, matching the source where the plan title
                      leads and the price sits under it as the accent. Reversing that put a
                      long coloured tagline above the name and the card stopped announcing
                      which portal it was. */}
                  <h3 className="cf-display font-black uppercase text-2xl tracking-tight leading-none mb-2">
                    {plan.label}
                  </h3>
                  <p className="cf-display font-bold uppercase text-sm tracking-wide leading-snug mb-2"
                    style={{ color: plan.color }}>
                    {plan.tagline}
                  </p>
                  <p className="cf-accent text-[10px] cf-dim2">{plan.who.toUpperCase()}</p>
                </div>

                <div className="my-5 border-t cf-hairline" />

                <p className="text-sm cf-dim leading-relaxed mb-5">{plan.blurb}</p>

                <div className="cf-accent text-[10px] cf-dim2 mb-2.5">CAN SEE</div>
                <ul className="flex flex-col gap-2.5 mb-5">
                  {plan.can.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-sm cf-dim">
                      <CircleCheck className="w-4 h-4 cf-green shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>

                <div className="cf-accent text-[10px] cf-dim2 mb-2.5">NEVER SEES</div>
                <ul className="flex flex-col gap-2.5">
                  {plan.cannot.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-sm cf-dim2">
                      <CircleX className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--cf-red-text)" }} strokeWidth={2} aria-hidden="true" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>

                {/* mt-auto keeps every CTA on the same baseline however long the lists run. */}
                <div className="mt-auto pt-6">
                  <button onClick={() => navigate(`/login/${plan.key}`)}
                    className="cf-focus cf-shine rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide w-full transition-all"
                    style={plan.featured
                      ? { background: `linear-gradient(100deg, ${plan.color}, color-mix(in oklab, ${plan.color} 62%, var(--cf-orange)))`, color: "#fff" }
                      : { background: `color-mix(in oklab, ${plan.color} 14%, transparent)`, border: `1px solid ${plan.color}`, color: plan.color }}>
                    Sign in as {plan.label}
                  </button>
                </div>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <Reveal>
          <div className="cf-card rounded-2xl p-7 flex items-start gap-4">
            <ShieldCheck className="w-5 h-5 cf-green shrink-0 mt-0.5" strokeWidth={2} />
            <div>
              <div className="cf-display font-bold uppercase text-base tracking-wide mb-2">Position data never leaves the geofence</div>
              <p className="text-sm cf-dim leading-relaxed max-w-3xl">
                A device only contributes a dot while it is inside the venue polygon. Step outside and the point stops
                being rendered and stops being counted — there is no tracking of where anyone goes before or after.
                Walkers see only themselves; organisers and admins see anonymous density, never identities.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

/* ============================================================================
   Login
   ========================================================================== */

/**
 * Sign-in flow.
 *
 * Follows the supplied component's shape: a full-screen, centred flow over an animated
 * background, with the form entering in staged steps and a confirmation beat before the
 * redirect rather than an instant jump.
 *
 * The original drives its background with Three.js + React Three Fiber — about 25MB of
 * dependency for one screen's backdrop. This app already ships a WebGL shader engine
 * (@paper-design/shaders-react, ~430KB) doing exactly that job site-wide, so the backdrop
 * here is the existing <MeshField>, intensified locally. Same effect, no second WebGL stack.
 */
/**
 * The password rules, shown while they are being met rather than after they are broken.
 *
 * Every rule is on screen from the first keystroke, ticking off live. The alternative — an
 * error after submitting — makes choosing a password a guessing game where each attempt
 * reveals one more requirement, and it is the same amount of markup either way.
 *
 * The bar underneath is advisory and deliberately separate from the checklist: the checklist
 * is what the form enforces, the bar is only a hint that longer is better. A passphrase that
 * reads "Fair" is still perfectly acceptable to submit.
 */
function PasswordRequirements({ password, accent, show }) {
  const checks = passwordChecks(password);
  const strength = passwordStrength(password);
  const problem = passwordError(password);

  if (!show) return null;

  return (
    <div className="mb-4 text-left">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mb-3">
        {checks.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: c.met ? "var(--cf-green, #4ade80)" : "var(--cf-dim2)" }}>
            <span aria-hidden="true"
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-all"
              style={c.met
                ? { background: "color-mix(in oklab, var(--cf-green, #4ade80) 22%, transparent)" }
                : { border: "1px solid var(--cf-line2)" }}>
              {c.met && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
            </span>
            {c.label}
          </span>
        ))}
      </div>

      <div className="flex gap-1 mb-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-0.5 flex-1 rounded-full transition-all duration-300"
            style={{
              background: i <= strength.score
                ? (strength.score >= 3 ? "var(--cf-green, #4ade80)" : accent)
                : "var(--cf-line)",
            }} />
        ))}
      </div>
      {/* One live region for both, so a screen reader hears the strength change and any
          violation from the same place instead of two competing announcements. */}
      <p className="text-[10px] cf-accent text-center" aria-live="polite"
        style={{ color: problem ? "var(--cf-red)" : "var(--cf-dim2)" }}>
        {problem ?? (strength.label ? strength.label.toUpperCase() : " ")}
      </p>
    </div>
  );
}

export function LoginPage({ roleKey, navigate, signIn }) {
  const role = ROLES[roleKey] ?? ROLES.walker;
  const reduced = usePrefersReducedMotion();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email → code → (reset) → success
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Registration and sign-in share one screen, and the choice is made on the first panel
  // rather than the second. It decides what the whole flow is, so asking for it after the
  // email — and after the heading has already committed to one of them — meant people typed a
  // password into a form that turned out to be doing the other thing.
  const [wantsNewAccount, setWantsNewAccount] = useState(false);

  // The admin portal is sign-in only. The console is granted per address by the platform
  // team, so a sign-up form there could only ever collect a password and then refuse it.
  const allowsSignUp = role.key !== "admin";

  // Derived rather than just hidden. Switching portals from the chips below re-renders this
  // component in place instead of remounting it, so a "create account" chosen on the client
  // door would otherwise still be set on arriving at the admin one — with the control that
  // set it no longer on screen to unset it.
  const isNewAccount = allowsSignUp && wantsNewAccount;
  const [err, setErr] = useState("");
  // Password recovery. `resetCode` is what the user types back; `issuedCode` is the one the
  // backend handed over directly, which only happens where there is no mail server to send
  // it through — see api.auth.forgotPassword.
  const [resetCode, setResetCode] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const passwordRef = useRef(null);
  const resetCodeRef = useRef(null);
  const finishing = useRef(false);
  // Flipped on one frame after mount so the staged entrance has an initial state to leave.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const timers = useRef([]);

  // The two dot-matrix layers. The forward reveal runs from mount; when the code completes
  // the reverse layer is switched on first and the forward one removed a frame later, so the
  // grid appears to collapse back out rather than cutting to a second animation.
  const [forwardCanvas, setForwardCanvas] = useState(true);
  const [reverseCanvas, setReverseCanvas] = useState(false);

  // Every timeout is tracked so an unmount mid-flow cannot land setState on a dead component
  // or fire a navigate after the user has already left the page.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (step !== "code" && step !== "reset") return;
    const target = () => (step === "reset" ? resetCodeRef.current : passwordRef.current);
    const t = setTimeout(() => target()?.focus(), reduced ? 0 : 420);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [step, reduced]);

  const submitEmail = (e) => {
    e?.preventDefault?.();
    // Caught here rather than at the backend: a typo in the address cannot succeed, and
    // finding that out after typing a password on the next panel wastes the whole attempt.
    const problem = emailError(email);
    if (problem) { setErr(problem); return; }
    setErr("");
    setStep("code");
  };

  /** Turns any failure from the auth endpoints into one line a person can act on. */
  const explain = (e, fallback) => (
    e?.status === 409 ? "That email is already registered — switch to Sign in."
      : e?.status === 401 ? "Email or password is incorrect."
        // 403 is the admin gate and the disabled-account case. Both carry a message written
        // for a reader, so pass it through rather than replacing it with a generic one.
        : e?.status === 403 ? (e?.message ?? "This portal is not open to that account.")
          : e?.status === 0 ? "Cannot reach the server. Is the backend running?"
            : e?.message ?? fallback
  );

  /**
   * The shared tail of every successful authentication — register, sign in, or reset.
   *
   * The reveal-out is deliberately started only once the backend has accepted the
   * credentials. Running it optimistically looked better but meant a failed login played a
   * triumphant "you are in" sequence before dumping the user back to an error.
   */
  const celebrate = (res) => {
    finishing.current = true;
    setBusy(false);

    // The account's own role wins over whichever portal door was used to get here. The two
    // now agree for walker and client — signing in at either door moves the account there —
    // so in practice this only diverges for an admin, who lands in the operations console
    // whichever entrance they came through.
    const actualRole = (res.user?.role ?? role.key).toLowerCase();

    setReverseCanvas(true);
    timers.current.push(setTimeout(() => setForwardCanvas(false), 60));
    timers.current.push(setTimeout(() => setReverseCanvas(false), reduced ? 150 : 1150));
    timers.current.push(setTimeout(() => setStep("success"), reduced ? 200 : 1200));
    timers.current.push(setTimeout(() => {
      signIn(res.user ? { ...toSession(res.user), role: actualRole }
                      : { role: actualRole, email: email.trim() });
      navigate(`/app/${actualRole}`);
    }, reduced ? 600 : 3400));
  };

  const finish = async () => {
    if (finishing.current || busy) return;
    if (isNewAccount) {
      const problem = passwordError(password);
      if (problem) { setErr(problem); return; }
      if (!passwordAcceptable(password)) { setErr("Your password does not meet the requirements yet."); return; }
    } else if (!password) {
      setErr("Enter your password.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      celebrate(isNewAccount
        ? await api.auth.register({ email: email.trim(), password, role: role.key })
        : await api.auth.login({ email: email.trim(), password, portal: role.key }));
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not sign you in."));
    }
  };

  /**
   * Ask for a reset code and move to the panel that redeems it.
   *
   * This always advances, even for an address with no account. The backend answers
   * identically either way so that this cannot be used to discover which emails are
   * registered, and a screen that advanced only for real accounts would hand back exactly
   * the answer the endpoint is careful not to give.
   */
  const requestReset = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.auth.forgotPassword({ email: email.trim() });
      setIssuedCode(res?.code ?? "");
      setResetCode(res?.code ?? "");
      setPassword("");
      setBusy(false);
      setStep("reset");
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not start a password reset."));
    }
  };

  const submitReset = async () => {
    if (finishing.current || busy) return;
    if (!resetCode.trim()) { setErr("Enter the reset code."); return; }
    const problem = passwordError(password);
    if (problem) { setErr(problem); return; }
    if (!passwordAcceptable(password)) { setErr("Your new password does not meet the requirements yet."); return; }

    setBusy(true);
    setErr("");
    try {
      celebrate(await api.auth.resetPassword({
        email: email.trim(), code: resetCode.trim(), password,
      }));
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not reset that password."));
    }
  };

  // Setting a password is gated on the policy; using an existing one is not. An account
  // created before a rule existed is still a valid account, and refusing to let it sign in
  // would lock people out of exactly the accounts they need to get in to fix.
  const canSubmitPassword = isNewAccount ? passwordAcceptable(password) : password.length > 0;
  const canSubmitReset = passwordAcceptable(password) && resetCode.trim().length > 0;

  const backToEmail = () => {
    finishing.current = false;
    setStep("email");
    setPassword("");
    setResetCode("");
    setIssuedCode("");
    setErr("");
    setReverseCanvas(false);
    setForwardCanvas(true);
  };

  // Staged entrance, done in CSS rather than through Motion.
  //
  // This used to return fresh `initial`/`animate` objects from inside the render. Motion
  // treats each of those as a new animation target, and because the sign-in re-renders while
  // it runs (the shader canvas mounts, `step` changes, AnimatePresence swaps children), some
  // elements had their entrance restarted and then never finished — they were left stranded
  // at the initial `opacity: 0`, so parts of the form were simply invisible on screen while
  // still being present and "visible" to any DOM check.
  //
  // A CSS transition driven by one boolean cannot strand: the end state is a plain class, so
  // however many times this re-renders, the element still settles at opacity 1.
  const stage = (i) => (reduced ? {} : {
    style: {
      opacity: entered ? 1 : 0,
      transform: entered ? "none" : "translateY(14px)",
      transition: `opacity .5s var(--cf-ease) ${0.06 * i}s, transform .5s var(--cf-ease) ${0.06 * i}s`,
    },
  });

  const slide = (dir) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: dir * 60 }, animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -60 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } });

  // The dot grid is drawn in the role's own colour rather than the source's white, so each
  // portal's sign-in is identifiable before a word is read.
  const dotRGB = useMemo(() => ({
    walker: [77, 141, 240], client: [255, 106, 0], admin: [225, 6, 0],
  }[role.key] ?? [255, 106, 0]), [role.key]);

  return (
    <div className="cf-page-in min-h-screen flex flex-col items-center justify-center px-6 py-28 relative">
      {/* The reveal. Mounted behind everything and masked to a vignette so the dots read as
          depth at the edges and never compete with the form in the middle. */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {forwardCanvas && (
          <CanvasRevealEffect colors={[dotRGB, [255, 255, 255]]} dotSize={6} speed={3} />
        )}
        {reverseCanvas && (
          <CanvasRevealEffect colors={[dotRGB, [255, 255, 255]]} dotSize={6} speed={4} reverse />
        )}
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(circle at center, rgba(5,7,11,.92) 0%, rgba(5,7,11,.55) 45%, rgba(5,7,11,.92) 100%)" }} />
      </div>

      <div className="w-full max-w-md relative z-10">
        <AnimatePresence mode="wait">
          {step === "email" && (
            <motion.div key="email" {...slide(-1)} className="text-center">
              <div {...stage(0)} className="flex justify-center mb-6">
                <span className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: `color-mix(in oklab, ${role.color} 18%, transparent)` }}>
                  <role.Icon className="w-7 h-7" style={{ color: role.color }} strokeWidth={2} />
                </span>
              </div>

              <div {...stage(1)}>
                <div className="cf-accent text-[10px] cf-dim2 mb-2">{role.who.toUpperCase()}</div>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)" }}>
                  <GradientShimmer gradient="ember">{`${role.label} portal`}</GradientShimmer>
                </h1>
                <p className="text-base cf-dim font-light mb-6">{role.tagline}</p>
              </div>

              {/* The sign-in / create-account choice, made before anything is typed.
                  A segmented control at the top rather than a link under the password field:
                  it is the one decision that changes what every input below it means, so it
                  belongs where it is read first and stays visible while the form is filled.

                  Absent on the admin door rather than present-and-refused: offering a control
                  whose only outcome is a 403 wastes a password on a door that was never open. */}
              {allowsSignUp && (
                <div {...stage(2)} className="flex gap-1 p-1 rounded-full mb-4 mx-auto max-w-xs"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line)", backdropFilter: "blur(4px)" }}>
                  {[["Sign in", false], ["Create account", true]].map(([label, wantsNew]) => (
                    <button key={label} type="button" aria-pressed={isNewAccount === wantsNew}
                      onClick={() => { setWantsNewAccount(wantsNew); setErr(""); }}
                      className="cf-focus flex-1 rounded-full py-2 cf-display font-bold uppercase text-[11px] tracking-wide transition-all"
                      style={isNewAccount === wantsNew
                        ? { background: `color-mix(in oklab, ${role.color} 26%, transparent)`, color: "var(--cf-ink)", boxShadow: "inset 0 1px 0 rgba(255,246,240,.09)" }
                        : { background: "transparent", color: "var(--cf-dim2)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {!allowsSignUp && (
                <p {...stage(2)} className="cf-accent text-[10px] cf-dim2 mb-4">
                  SIGN IN ONLY — ACCESS IS GRANTED BY THE PLATFORM TEAM
                </p>
              )}

              {/* noValidate hands the check to emailError rather than to the browser.
                  Chrome's own type=email rule blocks submit before onSubmit ever runs, so a
                  malformed address produced a native tooltip in the browser's styling and our
                  own message never appeared — and its rule is looser anyway, accepting
                  "someone@example" with no dot in the domain. One validator, one message. */}
              <form {...stage(3)} onSubmit={submitEmail} className="mb-4" noValidate>
                <div className="relative">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={`you@${role.key === "walker" ? "example.com" : role.key === "client" ? "yourvenue.com" : "crowdflow.io"}`}
                    aria-label="Email address"
                    className="cf-focus w-full rounded-full py-3.5 pl-5 pr-14 text-sm text-center transition-colors"
                    style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
                  <button type="submit" aria-label="Continue"
                    className="cf-focus absolute right-2 top-2 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
                    style={{ background: `color-mix(in oklab, ${role.color} 26%, transparent)`, color: "var(--cf-ink)" }}>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                {err && <p className="text-sm mt-3" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}
              </form>

              <div {...stage(4)} className="flex items-center gap-4 my-6">
                <span className="h-px flex-1" style={{ background: "var(--cf-line)" }} />
                <span className="cf-accent text-[10px] cf-dim2">OR PICK ANOTHER PORTAL</span>
                <span className="h-px flex-1" style={{ background: "var(--cf-line)" }} />
              </div>

              <div {...stage(5)} className="flex gap-2">
                {Object.values(ROLES).filter((r) => r.key !== role.key).map((r) => (
                  <button key={r.key} onClick={() => navigate(`/login/${r.key}`)}
                    className="cf-focus cf-chip rounded-full px-4 py-2.5 flex-1 transition-colors hover:border-(--cf-line2)">
                    <span className="cf-display font-bold uppercase text-xs" style={{ color: r.color }}>{r.label}</span>
                  </button>
                ))}
              </div>

              <p {...stage(6)} className="text-xs cf-dim2 leading-relaxed mt-10">
                {/* Says something the notice above it does not, rather than repeating it. */}
                {allowsSignUp
                  ? "One account covers both the walker and the client portal — the same credentials open either door, and signing in at one moves you there."
                  : "If your address has not been granted the console, use the walker or client portal instead — those are self-service and share one account."}
              </p>
            </motion.div>
          )}

          {step === "code" && (
            <motion.div key="code" {...slide(1)} className="text-center">
              <div {...stage(0)}>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(1.9rem, 4.5vw, 2.5rem)" }}>
                  <GradientShimmer gradient="ember">{isNewAccount ? "Choose a password" : "Enter your password"}</GradientShimmer>
                </h1>
                <p className="text-sm cf-dim font-light mb-1">
                  {isNewAccount
                    // The requirements are listed under the field now, so repeating one of
                    // them here only made the two disagree as the rules changed.
                    ? "Choose something you do not use elsewhere. This creates your account."
                    : `Signing in to your existing account, at the ${role.label.toLowerCase()} door.`}
                </p>
                <p className="cf-mono text-[11px] cf-dim2 mb-8">{email}</p>
              </div>

              <div {...stage(1)} className="relative mb-4">
                <Lock className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmitPassword) finish(); }}
                  placeholder="••••••••"
                  autoComplete={isNewAccount ? "new-password" : "current-password"}
                  aria-label="Password"
                  className="cf-focus w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <PasswordRequirements password={password} accent={role.color} show={isNewAccount} />

              {err && <p className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}

              <div {...stage(2)} className="flex gap-3">
                <button onClick={backToEmail} disabled={busy}
                  className="cf-focus cf-btn-outline rounded-full px-6 py-3 cf-display font-bold uppercase text-xs tracking-wide disabled:opacity-50">
                  Back
                </button>
                <button onClick={() => finish()}
                  disabled={!canSubmitPassword || busy}
                  className="cf-focus flex-1 rounded-full py-3 cf-display font-bold uppercase text-xs tracking-wide transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={canSubmitPassword && !busy
                    ? { background: `linear-gradient(100deg, ${role.color}, color-mix(in oklab, ${role.color} 62%, var(--cf-orange)))`, color: "#fff" }
                    : { background: "rgba(255,255,255,0.04)", color: "var(--cf-dim2)", border: "1px solid var(--cf-line)" }}>
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white animate-spin" aria-hidden="true" />}
                  {busy ? "Checking…" : isNewAccount ? "Create account" : "Sign in"}
                </button>
              </div>

              {/* Only offered when signing in. During registration there is no account
                  behind the address yet, so a reset could only ever report nothing found. */}
              {!isNewAccount && (
                <button onClick={requestReset} disabled={busy}
                  className="cf-focus cf-btn-ghost cf-accent text-[10px] mt-6 disabled:opacity-50">
                  FORGOT PASSWORD?
                </button>
              )}
            </motion.div>
          )}

          {step === "reset" && (
            <motion.div key="reset" {...slide(1)} className="text-center">
              <div {...stage(0)}>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(1.9rem, 4.5vw, 2.5rem)" }}>
                  <GradientShimmer gradient="ember">Reset your password</GradientShimmer>
                </h1>
                <p className="text-sm cf-dim font-light mb-1">
                  Enter the code, then choose a new password.
                </p>
                <p className="cf-mono text-[11px] cf-dim2 mb-6">{email}</p>
              </div>

              {/* Where the code came from, said plainly.
                  A screen that claims to have sent an email it did not send is worse than one
                  that admits the code is on screen. The wording stays general — "not set up
                  yet" covers both no mail account and a missing app password — because this
                  is a user-facing panel, not a configuration report. Once delivery works the
                  backend withholds the code and this branch stops rendering. */}
              <div {...stage(1)} className="rounded-2xl px-4 py-3 mb-5 text-left cf-bento">
                <div className="cf-accent text-[10px] cf-dim2 mb-1.5">
                  {issuedCode ? "EMAIL NOT SET UP YET — CODE SHOWN HERE" : "CHECK YOUR INBOX"}
                </div>
                <p className="text-xs cf-dim leading-relaxed">
                  {issuedCode
                    ? "Email delivery is not configured, so the code is filled in below instead. Once it is, the code is emailed and never shown on this screen. It expires in 30 minutes and can be used once."
                    : "If that address has an account, a reset code is on its way. It expires in 30 minutes and can be used once."}
                </p>
              </div>

              <div {...stage(2)} className="relative mb-3">
                <ShieldCheck className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  ref={resetCodeRef}
                  type="text"
                  value={resetCode}
                  onChange={(e) => { setResetCode(e.target.value.toUpperCase()); setErr(""); }}
                  placeholder="RESET CODE"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={12}
                  aria-label="Reset code"
                  className="cf-focus cf-mono w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center uppercase tracking-[0.3em] transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <div {...stage(3)} className="relative mb-4">
                <Lock className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmitReset) submitReset(); }}
                  placeholder="New password"
                  autoComplete="new-password"
                  aria-label="New password"
                  className="cf-focus w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <PasswordRequirements password={password} accent={role.color} show />

              {err && <p className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}

              <div {...stage(4)} className="flex gap-3">
                <button onClick={backToEmail} disabled={busy}
                  className="cf-focus cf-btn-outline rounded-full px-6 py-3 cf-display font-bold uppercase text-xs tracking-wide disabled:opacity-50">
                  Back
                </button>
                <button onClick={() => submitReset()}
                  disabled={!canSubmitReset || busy}
                  className="cf-focus flex-1 rounded-full py-3 cf-display font-bold uppercase text-xs tracking-wide transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={canSubmitReset && !busy
                    ? { background: `linear-gradient(100deg, ${role.color}, color-mix(in oklab, ${role.color} 62%, var(--cf-orange)))`, color: "#fff" }
                    : { background: "rgba(255,255,255,0.04)", color: "var(--cf-dim2)", border: "1px solid var(--cf-line)" }}>
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white animate-spin" aria-hidden="true" />}
                  {busy ? "Saving…" : "Set new password"}
                </button>
              </div>

              <button onClick={requestReset} disabled={busy}
                className="cf-focus cf-btn-ghost cf-accent text-[10px] mt-6 disabled:opacity-50">
                SEND A NEW CODE
              </button>
            </motion.div>
          )}

          {step === "success" && (
            <motion.div key="success" className="text-center"
              initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
              <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)" }}>
                <GradientShimmer gradient="ember">You&rsquo;re in</GradientShimmer>
              </h1>
              <p className="text-base cf-dim font-light">Opening the {role.label.toLowerCase()} portal…</p>

              <motion.div className="py-10"
                initial={reduced ? false : { scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: reduced ? 0 : 0.2 }}>
                <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: `linear-gradient(140deg, ${role.color}, color-mix(in oklab, ${role.color} 55%, var(--cf-orange)))` }}>
                  <Check className="w-8 h-8 text-white" strokeWidth={3} />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============================================================================
   App shell for portals
   ========================================================================== */

/**
 * The guard for "signed in here, asking for there".
 *
 * Two cases arrive at this component. Asking for the portal you are already in is not a
 * decision worth a screen, so it just forwards. Asking for a different tier is: the honest
 * answer is that this account cannot open that door, and the useful answer is the two ways
 * forward. Deliberately not phrased as an error — a stale bookmark or a link a colleague
 * pasted is the ordinary way to land here, and the person has done nothing wrong.
 */
export function AlreadySignedIn({ session, wanted, navigate, signOut, sameTier = false }) {
  const mine = ROLES[session.role];
  const theirs = ROLES[wanted];

  useEffect(() => {
    if (sameTier) navigate(`/app/${session.role}`);
  }, [sameTier, session.role, navigate]);
  if (sameTier) return null;

  return (
    <div className="cf-page-in min-h-screen flex items-center px-5 sm:px-6 py-24 sm:py-32" data-portal={session.role}>
      <div className="w-full max-w-lg mx-auto">
        <Reveal>
          <div className="cf-card rounded-2xl p-6 sm:p-8">
            <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
              style={{ background: `color-mix(in oklab, ${mine.color} 16%, transparent)` }}>
              <mine.Icon className="w-6 h-6" style={{ color: mine.color }} strokeWidth={2} aria-hidden="true" />
            </span>

            <h1 className="cf-display font-black uppercase text-3xl tracking-tight mb-3">
              You are signed in as {mine.label.toLowerCase()}
            </h1>
            <p className="text-sm cf-dim leading-relaxed mb-2">
              This account is <span className="cf-mono text-xs cf-ink">{session.email}</span>, and it
              opens the {mine.label.toLowerCase()} portal.
            </p>
            <p className="text-sm cf-dim leading-relaxed mb-7">
              The {theirs.label.toLowerCase()} portal is a different account. One session signs in
              to one portal, so switching means signing out of this one first.
            </p>

            <button onClick={() => navigate(`/app/${session.role}`)}
              className="cf-focus cf-btn-primary rounded-xl px-5 py-4 cf-display font-bold uppercase text-sm tracking-wide w-full">
              Go to my {mine.label.toLowerCase()} portal
            </button>
            <button onClick={() => { signOut(); navigate(`/login/${wanted}`); }}
              className="cf-focus cf-btn-outline rounded-xl px-5 py-3.5 cf-accent text-[11px] w-full mt-3">
              SIGN OUT AND USE {theirs.label.toUpperCase()}
            </button>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * Shrink a chosen picture before it ever leaves the browser.
 *
 * A photo straight off a phone is several megabytes, and the account column holds far less
 * than that — so without this the only feedback a person gets for using their own camera roll
 * is a rejection. 256px is well past what a 40px circle can show even on a 3x screen, and JPEG
 * at 0.86 keeps a face recognisable inside a few tens of kilobytes.
 */
