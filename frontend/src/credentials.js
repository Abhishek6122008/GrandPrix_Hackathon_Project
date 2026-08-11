/**
 * What the sign-in form will accept, checked before anything is sent.
 *
 * This is a copy of the server's rules, and that is deliberate rather than duplication to be
 * refactored away. The backend has to enforce them because anything can POST to it; the
 * frontend has to know them because a person typing a password deserves to be told what is
 * wrong while they type, not after a round trip. The two must agree, so the rules here mirror
 * `PasswordPolicy.java` exactly and the tests below both files pin the same cases.
 *
 * The server stays the authority: a mismatch means the request is rejected with the server's
 * message, never that the check here quietly let something through.
 */

/** BCrypt ignores anything past 72 bytes, so a longer password is a promise nothing keeps. */
export const PASSWORD_MAX = 72;
export const PASSWORD_MIN = 8;

/**
 * Email shape, checked loosely on purpose.
 *
 * Only the mistakes that are certainly mistakes — no @, nothing before or after it, a space
 * in the middle, no dot in the domain. Full RFC 5322 is famously unmatchable by regex, and
 * every strict pattern in the wild rejects addresses that genuinely work. Since the reset
 * flow proves the address by sending mail to it, the only job here is to catch a typo before
 * the user waits on a request that cannot succeed.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailError(email) {
  const value = (email ?? '').trim();
  if (!value) return 'Enter an email address to continue.';
  if (!EMAIL.test(value)) return 'That does not look like an email address.';
  return null;
}

/**
 * The individual password rules, as a checklist.
 *
 * Returned as a list of `{ id, label, met }` rather than a single boolean so the form can
 * show all of them at once and tick them off live. Revealing one requirement per failed
 * attempt turns choosing a password into a guessing game.
 */
export function passwordChecks(password) {
  const value = password ?? '';
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, met: value.length >= PASSWORD_MIN },
    { id: 'letter', label: 'One letter', met: /\p{L}/u.test(value) },
    { id: 'number', label: 'One number', met: /\p{Nd}/u.test(value) },
  ];
}

/** Rules that only matter once broken, so they are messages rather than checklist items. */
export function passwordError(password) {
  const value = password ?? '';
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  // A space at either end survives the trip through JSON and BCrypt intact, so the password
  // works right up until the day it is typed without it, or pasted from somewhere that
  // trimmed it. Refused rather than silently stripped: stripping changes what someone
  // believes their password is.
  if (value !== value.trim()) return 'Remove the space at the start or end.';
  return null;
}

/** True when a password may be submitted — every check met and no violation. */
export function passwordAcceptable(password) {
  return passwordChecks(password).every((c) => c.met) && passwordError(password) === null;
}

/**
 * A coarse strength read, for the bar under the checklist.
 *
 * Length dominates because length is what actually costs an attacker time; variety adds a
 * little. This is feedback, not a gate — `passwordAcceptable` decides what is allowed, and a
 * long lowercase passphrase scoring "fair" is still perfectly fine to use.
 */
export function passwordStrength(password) {
  const value = password ?? '';
  if (!value) return { score: 0, label: '' };

  const variety = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u]
    .filter((re) => re.test(value)).length;

  let score = 0;
  if (value.length >= PASSWORD_MIN) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (variety >= 3) score += 1;

  score = Math.min(score, 4);
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}
