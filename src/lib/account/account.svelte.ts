/* Client auth state for Accounts Phase 1 (F53) — passkey register/login/logout + session probe.
   Architecture: docs/accounts-architecture.md. The server side lives in functions/api/account/*
   (+ the extended /api/me); sessions are an HttpOnly __Host- cookie, so the client never sees a
   token — it just fetches same-origin with credentials and reads /api/me for the answer.

   @simplewebauthn/browser is loaded via a LAZY dynamic import inside the ceremony calls, so its
   chunk stays out of the /app boot payload (A96) — the passive session probe costs one fetch.

   GUARDRAIL (S25): accounts carry identity + entitlements only. Nothing about trades is ever
   sent — the only POST bodies here are an email and WebAuthn ceremony responses.

   Lives in src/lib/account/ (A328) because BOTH surfaces consume it — the app's Account screen and
   the standalone site /account.html (A293) — so the dependency arrows stay app→shared and
   site→shared (src/site must not import from src/app). Runes module: type-checked by svelte-check
   (tsconfig.svelte.json), excluded from plain tsc alongside src/lib/components. */

// type-only imports are erased at build time — they do NOT pull the chunk into boot
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export interface AccountUser {
  email: string;
  emailVerified: boolean;
  donated: boolean;
  donatedAt: number | null;
  donationTotalCents: number;
  createdAt: number;
}
export interface AccountPasskey {
  id: string;
  nickname: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  backedUp: boolean;
}
/** A333: billing summary from /api/me (no Stripe ids). NULL when the user has no subscription row —
 *  e.g. cloud via an admin comp — so the Cancel/Resume UI only ever shows for real subscribers. */
export interface AccountSubscription {
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}
interface MeResponse {
  // contract-only (legacy anonymous shape), not read by the app — A249
  tier?: string;
  cloudSync?: boolean;
  user?: AccountUser;
  passkeys?: AccountPasskey[];
  subscription?: AccountSubscription | null;
}

/** Single source for "is this a plausible email?" across the auth forms (A329). Deliberately
 *  loose — the server (and the verification email itself) is the real validator. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Short local date for account metadata rows (member-since, passkey added/last-used) — shared by
 *  the app Account screen and the site account dashboard (A329). */
export function fmtDate(ms: number | null): string {
  return ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Shared reactive account state — import and read anywhere; mutate only via the actions below. */
export const account = $state({
  /** /api/me has resolved at least once (gate skeletons on this). */
  loaded: false,
  /** a ceremony is in flight (disable the auth buttons). */
  busy: false,
  /** last actionable error message ('' = none). */
  error: '',
  /** A316: the last register attempt 409'd on a NEVER-VERIFIED holder — offer the reclaim flow. */
  reclaimable: false,
  /** false once the server says accounts aren't configured (503 — ACCOUNTS_DB unbound). */
  available: true,
  user: null as AccountUser | null,
  passkeys: [] as AccountPasskey[],
  /** storage tier from /api/me — 'cloud' once an active/grace subscription grants it, else 'local'.
   *  Gates the cloud-sync setup UI: only a 'cloud' user can set up keys / sync (F60/A253). */
  tier: 'local',
  /** A333: the caller's billing summary (null = no subscription row, e.g. admin-comped cloud). */
  subscription: null as AccountSubscription | null,
});

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include', // same-origin session cookie rides along
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; reclaimable?: boolean }) | null;
  if (res.status === 503) account.available = false;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`) as Error & { reclaimable?: boolean };
    if (data?.reclaimable) err.reclaimable = true; // A316: machine-readable 409 flavor for the UI
    throw err;
  }
  account.available = true;
  return data as T;
}

/* Lazy ceremony driver — the @simplewebauthn/browser chunk loads on first use, never at boot. */
async function webauthn() {
  return import('@simplewebauthn/browser');
}

function messageOf(e: unknown): string {
  if (e instanceof Error) {
    // The user closing the platform passkey sheet is not an error worth shouting about.
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return 'Passkey prompt was dismissed.';
    return e.message || 'Something went wrong.';
  }
  return 'Something went wrong.';
}

/** Passive session probe (GET /api/me) — safe to call at mount; never throws. */
export async function refreshSession(): Promise<void> {
  try {
    const me = await api<MeResponse>('/api/me');
    account.user = me.user ?? null;
    account.passkeys = me.passkeys ?? [];
    account.tier = me.tier === 'cloud' ? 'cloud' : 'local';
    account.subscription = me.subscription ?? null;
  } catch (_) {
    account.user = null;
    account.passkeys = [];
    account.tier = 'local';
    account.subscription = null;
  } finally {
    account.loaded = true;
  }
}

async function ceremony(run: () => Promise<void>): Promise<boolean> {
  if (account.busy) return false;
  account.busy = true;
  account.error = '';
  account.reclaimable = false;
  try {
    await run();
    await refreshSession();
    return true;
  } catch (e) {
    account.error = messageOf(e);
    if (e instanceof Error && (e as Error & { reclaimable?: boolean }).reclaimable) account.reclaimable = true;
    return false;
  } finally {
    account.busy = false;
  }
}

/* Register ceremony shared by "create account" (email body) and "add another passkey"
   (empty body — the server takes identity from the session cookie instead). */
function runRegistration(body: { email?: string }): Promise<boolean> {
  return ceremony(async () => {
    const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>('/api/account/register-options', body);
    const { startRegistration } = await webauthn();
    const response = await startRegistration({ optionsJSON: options });
    await api('/api/account/register-verify', { response });
  });
}

/** Create a new account: register ceremony seeded with the email; session starts on success. */
export function register(email: string): Promise<boolean> {
  return runRegistration({ email });
}

/** Enroll ANOTHER passkey on the signed-in account (identity comes from the session cookie). */
export function addPasskey(): Promise<boolean> {
  return runRegistration({});
}

/** Enroll another passkey WITH the WebAuthn PRF extension enabled (F61b cloud-sync unlock). PRF must
 *  be requested at credential CREATION — existing F53 passkeys weren't, so cloud-sync unlock needs a
 *  fresh PRF-capable passkey. This augment is purely CLIENT-SIDE: the register-options/register-verify
 *  endpoints are unchanged; we only add `extensions: { prf: {} }` to the creation options before
 *  handing them to the authenticator. */
export function registerPrfPasskey(): Promise<boolean> {
  return ceremony(async () => {
    const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>('/api/account/register-options', {});
    const { startRegistration } = await webauthn();
    // simplewebauthn's extension type predates WebAuthn L3's PRF; cast the augmented value in.
    const extensions = { ...options.extensions, prf: {} } as unknown as PublicKeyCredentialCreationOptionsJSON['extensions'];
    const response = await startRegistration({ optionsJSON: { ...options, extensions } });
    await api('/api/account/register-verify', { response });
  });
}

/** Remove one of the signed-in account's passkeys (A302 stolen-device remediation). Scoped to the
 *  caller server-side (deleteCredentialForUser); the server refuses to remove the LAST passkey (a
 *  400 the UI surfaces), so the caller must enroll a replacement first. Not a WebAuthn ceremony. */
export function deletePasskey(id: string): Promise<boolean> {
  return ceremony(async () => {
    await api('/api/account/passkey-delete', { id });
  });
}

/** Usernameless passkey login (discoverable credential — no email prompt). */
export function login(): Promise<boolean> {
  return ceremony(async () => {
    const { options } = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>('/api/account/login-options', {});
    const { startAuthentication } = await webauthn();
    const response = await startAuthentication({ optionsJSON: options });
    await api('/api/account/login-verify', { response });
  });
}

/** Revoke the server session + clear local state. */
export function logout(): Promise<boolean> {
  return ceremony(async () => {
    await api('/api/account/logout', {});
    account.user = null;
    account.passkeys = [];
    account.tier = 'local';
  });
}

/** Start a cloud-tier subscription checkout, then redirect to Stripe. The same-origin session cookie
 *  rides along, so /api/checkout stamps client_reference_id (and subscription metadata, #120) and the
 *  webhook links the subscription to THIS account — the reliable path to the 'cloud' tier.
 *  A278: this hosted-Checkout redirect is now the FALLBACK path (script/iframe-blocked clients);
 *  the primary path is the in-app Payment Element via createSubscription() below. */
export function subscribe(): Promise<boolean> {
  return ceremony(async () => {
    const { url } = await api<{ url?: string }>('/api/checkout', { plan: 'subscription' });
    if (typeof url === 'string' && url) window.location.href = url;
  });
}

/* ---- A278: in-app subscription (Payment Element) ------------------------------------------- */

export type CreateSubscriptionResult = { alreadySubscribed: true } | { clientSecret: string; publishableKey: string };

/** Create (or resume) the incomplete subscription server-side and return the Payment Element
 *  inputs. Throws with the server's message on failure (501 not-configured included — callers use
 *  that to fall back to hosted Checkout). Not a ceremony: the form owns its own busy state. */
export function createSubscription(): Promise<CreateSubscriptionResult> {
  return api<CreateSubscriptionResult>('/api/subscription/create', {});
}

/** Lazy Stripe.js loader (A278) — the npm package is a tiny stub that injects the real script from
 *  js.stripe.com at runtime, so nothing Stripe-sized ever sits in our bundle or on the boot path
 *  (same pattern as the lazy webauthn() import above). Returns null when the script can't load
 *  (blocked origin) — callers fall back to hosted Checkout. */
export async function stripeJs(publishableKey: string) {
  try {
    const { loadStripe } = await import('@stripe/stripe-js');
    return await loadStripe(publishableKey);
  } catch (_) {
    return null;
  }
}

/** A333: schedule the caller's subscription to end at period end (`resume: true` undoes it while
 *  still in-period). The tier keeps working until the paid period runs out — the endpoint flips
 *  only Stripe's cancel_at_period_end; the webhook remains the lifecycle writer. Resolves true on
 *  success (session refreshed so account.subscription reflects it); false with account.error set. */
export async function setCancelAtPeriodEnd(cancel: boolean): Promise<boolean> {
  if (account.busy) return false;
  account.busy = true;
  account.error = '';
  try {
    await api('/api/subscription/cancel', cancel ? {} : { resume: true });
    await refreshSession();
    return true;
  } catch (e) {
    account.error = messageOf(e);
    return false;
  } finally {
    account.busy = false;
  }
}

/** Poll /api/me until the webhook flips the tier to cloud (the webhook is the only tier writer —
 *  this just waits for it). Resolves true once cloud, false when attempts run out. */
export async function awaitCloudTier(attempts = 8, delayMs = 1500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await refreshSession();
    if (account.tier === 'cloud') return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

/* ---- A305: account deletion ----------------------------------------------------------------- */

/** Two-phase resumable deletion (A305): POST /api/account/delete until `{ done: true }` — each call
 *  clears a bounded page of synced ciphertext, so a large account takes several calls, and an
 *  interrupted run resumes by simply deleting again. Resolves true once fully deleted (session
 *  refreshed); false on failure with `account.error` set. */
export async function deleteAccount(maxCalls = 60): Promise<boolean> {
  if (account.busy) return false;
  account.busy = true;
  account.error = '';
  try {
    for (let i = 0; i < maxCalls; i++) {
      const data = await api<{ done?: boolean }>('/api/account/delete', {});
      if (data?.done) {
        await refreshSession();
        return true;
      }
    }
    account.error = 'Deletion is taking longer than expected — reload this page and delete again to continue where it left off.';
    return false;
  } catch (e) {
    account.error = messageOf(e);
    return false;
  } finally {
    account.busy = false;
  }
}

/* ---- F55: recovery email + verification --------------------------------------------------- */

/** Send the signed-in user an email-verification link. Returns true when the request succeeded
 *  (or the address was already verified). Not a WebAuthn ceremony — no passkey prompt. */
export async function emailVerifySend(): Promise<boolean> {
  if (account.busy) return false;
  account.busy = true;
  account.error = '';
  try {
    await api('/api/account/email-verify-send', {});
    return true;
  } catch (e) {
    account.error = messageOf(e);
    return false;
  } finally {
    account.busy = false;
  }
}

/** Request a passkey-recovery magic link for an email (logged-out "lost your passkey?" flow).
 *  Enumeration-safe by design: the server always answers generically, so this resolves true
 *  whenever the request was accepted — it never reveals whether the account exists. */
export async function recoverSend(email: string): Promise<boolean> {
  try {
    await api('/api/account/recover-send', { email: email.trim().toLowerCase() });
    return true;
  } catch (_) {
    // A 503 (email unavailable) is the only actionable failure; otherwise stay generic.
    return account.available;
  }
}

/** Complete recovery from a magic-link token: exchange it for fresh registration options, run the
 *  passkey ceremony, and enroll a new passkey (register-verify starts the session). */
export function completeRecovery(token: string): Promise<boolean> {
  return ceremony(async () => {
    const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>('/api/account/recover-verify', { token });
    const { startRegistration } = await webauthn();
    const response = await startRegistration({ optionsJSON: options });
    await api('/api/account/register-verify', { response });
  });
}

/* ---- A316: reclaim a squatted (never-verified) email --------------------------------------- */

/** Request a reclaim magic link for an email held by a never-verified account (offered after a
 *  register attempt sets `account.reclaimable`). Enumeration-safe like recoverSend: the server
 *  always answers generically, so this resolves true whenever the request was accepted. */
export async function reclaimSend(email: string): Promise<boolean> {
  try {
    await api('/api/account/reclaim-send', { email: email.trim().toLowerCase() });
    return true;
  } catch (_) {
    // A 503 (email unavailable) is the only actionable failure; otherwise stay generic.
    return account.available;
  }
}

/** Complete a reclaim from its magic-link token: the server frees the squatted email, pre-creates a
 *  fresh VERIFIED account, and returns registration options bound to it — then the standard passkey
 *  ceremony enrolls the first passkey (register-verify starts the session). */
export function completeReclaim(token: string): Promise<boolean> {
  return ceremony(async () => {
    const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>('/api/account/reclaim-confirm', { token });
    const { startRegistration } = await webauthn();
    const response = await startRegistration({ optionsJSON: options });
    await api('/api/account/register-verify', { response });
  });
}
