/* Client auth state for Accounts Phase 1 (F53) — passkey register/login/logout + session probe.
   Architecture: docs/accounts-architecture.md. The server side lives in functions/api/account/*
   (+ the extended /api/me); sessions are an HttpOnly __Host- cookie, so the client never sees a
   token — it just fetches same-origin with credentials and reads /api/me for the answer.

   @simplewebauthn/browser is loaded via a LAZY dynamic import inside the ceremony calls, so its
   chunk stays out of the /app boot payload (A96) — the passive session probe costs one fetch.

   GUARDRAIL (S25): accounts carry identity + entitlements only. Nothing about trades is ever
   sent — the only POST bodies here are an email and WebAuthn ceremony responses. */

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
interface MeResponse {
  // contract-only (legacy anonymous shape), not read by the app — A249
  tier?: string;
  cloudSync?: boolean;
  user?: AccountUser;
  passkeys?: AccountPasskey[];
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
  } catch (_) {
    account.user = null;
    account.passkeys = [];
    account.tier = 'local';
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
 *  webhook links the subscription to THIS account — the reliable path to the 'cloud' tier. */
export function subscribe(): Promise<boolean> {
  return ceremony(async () => {
    const { url } = await api<{ url?: string }>('/api/checkout', { plan: 'subscription' });
    if (typeof url === 'string' && url) window.location.href = url;
  });
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
