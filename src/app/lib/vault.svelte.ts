/* Blotterbook · in-memory cloud-sync KEY SESSION (F61b — synced workspaces, step 4b).
 *
 * Orchestrates the USER-FACING crypto flows on top of F61a's pure `crypto.ts` core: cloud-sync
 * SETUP (mint the account IK + the one escrow recovery key), once-per-session UNLOCK (rebuild a
 * KEK and unwrap the IK), and ADD-A-METHOD re-wrapping. It exposes the unlocked account IDENTITY
 * KEY (IK) that F63's CloudStore will consume; it does NOT do per-workspace DEK registration or
 * record push/pull (that is F63).
 *
 * ┌─ SECURITY INVARIANT (the whole point of this module) ──────────────────────────────────────┐
 * │ The unlocked IK, the escrow recovery key, and every KEK live IN MEMORY ONLY. This module    │
 * │ NEVER writes a key / IK / DEK / recovery key to localStorage, IndexedDB, the Store, or any   │
 * │ other persistence — by construction: the only key material here is the module-scoped `ik`    │
 * │ variable and the transient `pending` setup material, neither of which is ever handed to a    │
 * │ storage API. The ONLY thing that reaches the network is an OPAQUE wrapped-IK blob (ciphertext │
 * │ of the IK under a KEK the server cannot rebuild) via F62's PUT /api/sync/wrapped-ik. `lock()` │
 * │ and logout clear `ik`; a refresh drops it naturally (re-unlock required). Grep this file: the │
 * │ substrings `localStorage`, `indexedDB`, and `Store` do not appear on any key-writing path.   │
 * └────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `crypto.ts` (and the Argon2id wasm it lazy-loads) is DYNAMICALLY imported on the cloud-sync path
 * only, so it stays out of the /app boot bundle (A96). Prod + staging (not demo): the Account screen
 * mounts these flows for any logged-in user; demo never syncs or encrypts. */

import type { WrappedIK } from '../../lib/core/types.ts';

/* ── the unlocked account IK — MEMORY ONLY, never persisted ────────────────────────────────────
 * A module-scoped variable, not $state and not a Store field: it is the single in-memory home of
 * the unlocked key. Cleared by lock()/logout, gone on refresh. */
let ik: CryptoKey | null = null;

/* Transient SETUP material (IK + raw recovery-key bytes) held only between beginSetup() and
 * finishSetup()/cancelSetup(), so the UI can render the recovery key once. Memory only; zeroed and
 * dropped the moment setup finishes or is abandoned. */
let pending: { ik: CryptoKey; recoveryKey: Uint8Array<ArrayBuffer> } | null = null;

/** Metadata for one enrolled unlock method (from GET /api/sync/wrapped-ik) — never any key bytes. */
export interface UnlockMethodMeta {
  method: WrappedIK['method']; // 'prf' | 'passphrase' | 'recovery'
  keyId: string;
}

/** Shared reactive cloud-sync key-session state — read anywhere, mutate only via the actions here. */
export const vault = $state({
  /** the server has probed at least once (gate UI on this). */
  loaded: false,
  /** an unlock/setup ceremony is in flight (disable controls). */
  busy: false,
  /** last actionable error ('' = none). */
  error: '',
  /** true once at least one wrapped-IK exists server-side (cloud-sync has been set up). */
  setUp: false,
  /** the IK is unlocked in memory for this session. Mirrors `ik !== null`. */
  unlocked: false,
  /** the enrolled unlock methods (for the unlock modal's method picker). */
  methods: [] as UnlockMethodMeta[],
});

/* ── A264: passphrase strength floor ────────────────────────────────────────────────────────────
 * The optional passphrase is a CONVENIENCE / no-PRF unlock path — the downloaded escrow recovery key
 * is the strong root of trust (owner decision; see docs/synced-workspaces.md "Not doing"). But a weak
 * passphrase still widens the attack surface on the wrapped-IK blob, so require a meaningful minimum:
 * 12+ characters with at least two character classes. This is a deliberate length + basic-variety
 * check, NOT a heavy zxcvbn dependency, and it does NOT raise the Argon2id cost (which would change
 * every unlock's timing). */
export const MIN_PASSPHRASE = 12;
export function passphraseStrong(p: string): boolean {
  const s = p.trim();
  if (s.length < MIN_PASSPHRASE) return false;
  let classes = 0;
  if (/[a-z]/.test(s)) classes++;
  if (/[A-Z]/.test(s)) classes++;
  if (/[0-9]/.test(s)) classes++;
  if (/[^a-zA-Z0-9]/.test(s)) classes++;
  return classes >= 2;
}

/* ── fixed PRF evaluation input ────────────────────────────────────────────────────────────────
 * WebAuthn PRF derives a per-credential secret from (credential, input). We feed a FIXED,
 * domain-separated input so the same passkey deterministically yields the same PRF output every
 * unlock; per-enrollment uniqueness comes from the random HKDF salt stored in the WrappedIK
 * descriptor (crypto.ts kekFromPrf). */
const PRF_EVAL_INPUT = new TextEncoder().encode('blotterbook/e2e/prf-eval/v1');

/* ── lazy crypto core (keeps crypto.ts + the Argon2 wasm out of the boot bundle) ──────────────── */
function crypto() {
  return import('../../lib/core/crypto.ts');
}

/* ── F62 transport: the opaque wrapped-IK blob store (session-gated, ciphertext only) ─────────── */

interface WrappedIkRow {
  method: string;
  key_id: string;
  wrapped_ik: string; // JSON of a WrappedIK — opaque to the server
  updated: number;
}

async function fetchWrappedIks(): Promise<WrappedIkRow[]> {
  const res = await fetch('/api/sync/wrapped-ik', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Could not load your cloud-sync keys (${res.status}).`);
  const data = (await res.json().catch(() => null)) as { wrappedIks?: WrappedIkRow[] } | null;
  return data?.wrappedIks ?? [];
}

/** PUT one method's wrapped-IK blob (add or rotate). `blob` is ciphertext of the IK under the
 *  method's KEK — the server can never unwrap it. */
async function putWrappedIk(blob: WrappedIK, keyId: string): Promise<void> {
  const res = await fetch('/api/sync/wrapped-ik', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ method: blob.method, key_id: keyId, wrapped_ik: JSON.stringify(blob) }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `Could not save your cloud-sync key (${res.status}).`);
  }
}

function messageOf(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return 'Passkey prompt was dismissed.';
    return e.message || 'Something went wrong.';
  }
  return 'Something went wrong.';
}

async function guard(run: () => Promise<void>): Promise<boolean> {
  if (vault.busy) return false;
  vault.busy = true;
  vault.error = '';
  try {
    await run();
    return true;
  } catch (e) {
    vault.error = messageOf(e);
    return false;
  } finally {
    vault.busy = false;
  }
}

/* ── session lifecycle ─────────────────────────────────────────────────────────────────────────*/

/** Runtime-guard a wire `method` string against the WrappedIK method set (A262) — the value comes off
 *  the network, so validate rather than blind-cast, and drop any row with an unrecognized method. */
const UNLOCK_METHODS: ReadonlySet<string> = new Set<WrappedIK['method']>(['prf', 'passphrase', 'recovery']);
function isUnlockMethod(m: unknown): m is WrappedIK['method'] {
  return typeof m === 'string' && UNLOCK_METHODS.has(m);
}

/** Probe cloud-sync setup state (which unlock methods exist). Safe to call at mount; never throws. */
export async function refreshVault(): Promise<void> {
  try {
    const rows = await fetchWrappedIks();
    vault.methods = rows.reduce<UnlockMethodMeta[]>((acc, r) => {
      // The type guard narrows r.method, so no cast is needed and an unknown method is dropped (A262).
      if (isUnlockMethod(r.method)) acc.push({ method: r.method, keyId: r.key_id });
      return acc;
    }, []);
    vault.setUp = vault.methods.length > 0;
  } catch (_) {
    vault.methods = [];
    vault.setUp = false;
  } finally {
    vault.loaded = true;
    vault.unlocked = ik !== null;
  }
}

/** The unlocked account IK, or null when locked. F63's CloudStore reads this. MEMORY ONLY. */
export function getIK(): CryptoKey | null {
  return ik;
}

/** Clear the in-memory key session (logout / explicit lock). No storage is touched — there is none
 *  to clear; the key only ever lived in memory. A refresh has the same effect for free. */
export function lock(): void {
  ik = null;
  cancelSetup();
  vault.unlocked = false;
  vault.error = '';
}

/* ── SETUP (mint IK + the one escrow recovery key) ─────────────────────────────────────────────*/

/** Encode the raw recovery-key bytes as base64 for the user to copy/download (and paste back at
 *  unlock). This is the ONLY time the recovery key is materialized outside Web Crypto. */
function encodeRecoveryKey(bytes: Uint8Array): Promise<string> {
  return crypto().then(({ bytesToBase64 }) => bytesToBase64(bytes));
}

/** Begin cloud-sync setup: mint the account IK + the escrow recovery key, hold them in transient
 *  memory, and return the recovery key (base64) for the UI to render ONCE. Nothing is persisted or
 *  sent yet — finishSetup() does that after the user confirms they saved the key. */
export async function beginSetup(): Promise<string | null> {
  let out: string | null = null;
  await guard(async () => {
    const { genIdentityKey, genRecoveryKey } = await crypto();
    const newIk = await genIdentityKey();
    const recoveryKey = genRecoveryKey();
    pending = { ik: newIk, recoveryKey };
    out = await encodeRecoveryKey(recoveryKey);
  });
  return out;
}

/** Abandon an in-progress setup: zero + drop the transient recovery-key bytes and the pending IK. */
export function cancelSetup(): void {
  if (pending) pending.recoveryKey.fill(0);
  pending = null;
}

/** Finish setup: wrap the pending IK under the recovery KEK (always) and, if a passphrase is given,
 *  the passphrase KEK, PUT each opaque blob, then promote the IK to the live in-memory session.
 *  The transient recovery-key bytes are zeroed and dropped — never stored. Requires a prior
 *  beginSetup(). */
export async function finishSetup(opts: { passphrase?: string } = {}): Promise<boolean> {
  return guard(async () => {
    if (!pending) throw new Error('Setup was not started.');
    const { kekFromRecoveryKey, kekFromPassphrase, wrapIK, randomSalt } = await crypto();

    // Recovery KEK — the single guaranteed root of trust (always enrolled).
    const recoveryKek = await kekFromRecoveryKey(pending.recoveryKey);
    await putWrappedIk(await wrapIK(pending.ik, recoveryKek), 'recovery');

    // Optional passphrase KEK (Argon2id) — convenience / no-PRF unlock path.
    const pass = opts.passphrase?.trim();
    if (pass) {
      const passKek = await kekFromPassphrase(pass, randomSalt());
      await putWrappedIk(await wrapIK(pending.ik, passKek), 'passphrase');
    }

    // Promote to the live in-memory session, then zero + drop all transient material.
    ik = pending.ik;
    pending.recoveryKey.fill(0);
    pending = null;
    vault.unlocked = true;
    await refreshVault();
  });
}

/* ── PRF probe + WebAuthn PRF ceremony (client-driven; NO server change — see F61b) ────────────*/

/** Detect WebAuthn PRF support. Prefers the standard getClientCapabilities() probe (static on
 *  PublicKeyCredential); returns false when it is unavailable or reports no PRF (the caller then
 *  guides the user to the passphrase path). Never assumes PRF. */
export async function prfSupported(): Promise<boolean> {
  try {
    const ctor = globalThis.PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    };
    if (typeof ctor?.getClientCapabilities === 'function') {
      const caps = await ctor.getClientCapabilities();
      return caps?.extensionPrf === true;
    }
  } catch (_) {
    /* fall through — treat as unsupported */
  }
  return false;
}

function bufferSourceToBytes(src: BufferSource): Uint8Array<ArrayBuffer> {
  const ab = src instanceof ArrayBuffer ? src : src.buffer;
  return new Uint8Array(ab as ArrayBuffer) as Uint8Array<ArrayBuffer>;
}

/** Run a local WebAuthn assertion requesting the PRF extension, returning the per-credential PRF
 *  secret + the credential id. Client-side only: no server round-trip — the PRF secret never leaves
 *  the browser; it only derives the KEK that unwraps the IK. Throws if PRF yields no output. */
async function evalPrf(allowCredentialId?: string): Promise<{ prf: Uint8Array<ArrayBuffer>; credentialId: string }> {
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const allowCredentials: PublicKeyCredentialDescriptor[] = allowCredentialId
    ? [{ type: 'public-key', id: base64UrlToBytes(allowCredentialId) }]
    : [];
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      userVerification: 'preferred',
      allowCredentials,
      extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey assertion was cancelled.');
  const first = cred.getClientExtensionResults().prf?.results?.first;
  if (!first) throw new Error('This passkey does not support PRF — set a passphrase instead.');
  return { prf: bufferSourceToBytes(first), credentialId: cred.id };
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ── UNLOCK (once per session; rebuild the KEK, unwrap the IK into memory) ─────────────────────*/

async function loadBlob(method: WrappedIK['method'], keyId?: string): Promise<WrappedIK | null> {
  const rows = await fetchWrappedIks();
  const row = rows.find(r => r.method === method && (keyId === undefined || r.key_id === keyId));
  if (!row) return null;
  return JSON.parse(row.wrapped_ik) as WrappedIK;
}

/** Unlock the IK with the escrow recovery key (base64, as downloaded at setup). */
export function unlockWithRecoveryKey(recoveryB64: string): Promise<boolean> {
  return guard(async () => {
    const { base64ToBytes, kekFromRecoveryKey, unwrapIK } = await crypto();
    const blob = await loadBlob('recovery');
    if (!blob) throw new Error('No recovery key is enrolled for this account.');
    const bytes = base64ToBytes(recoveryB64.trim());
    const kek = await kekFromRecoveryKey(bytes);
    ik = await unwrapIK(blob, kek);
    bytes.fill(0);
    vault.unlocked = true;
  });
}

/** Unlock the IK with the account passphrase (Argon2id KEK). */
export function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  return guard(async () => {
    const { base64ToBytes, kekFromPassphrase, unwrapIK, descriptorOf } = await crypto();
    const blob = await loadBlob('passphrase');
    if (!blob) throw new Error('No passphrase is set for this account.');
    const desc = descriptorOf(blob);
    if (desc.method !== 'passphrase') throw new Error('Malformed passphrase key.');
    const kek = await kekFromPassphrase(passphrase, base64ToBytes(desc.argon2.salt), desc.argon2);
    ik = await unwrapIK(blob, kek);
    vault.unlocked = true;
  });
}

/** Unlock the IK with a PRF-capable passkey (tap → PRF secret → HKDF KEK → unwrap). */
export function unlockWithPasskey(): Promise<boolean> {
  return guard(async () => {
    const { kekFromPrf, unwrapIK, descriptorOf, base64ToBytes } = await crypto();
    const { prf, credentialId } = await evalPrf();
    const blob = await loadBlob('prf', credentialId);
    if (!blob) throw new Error('This passkey is not enrolled for cloud-sync unlock — set it up first.');
    const desc = descriptorOf(blob);
    if (desc.method !== 'prf') throw new Error('Malformed passkey key.');
    const kek = await kekFromPrf(prf, base64ToBytes(desc.hkdfSalt));
    ik = await unwrapIK(blob, kek);
    vault.unlocked = true;
  });
}

/* ── ADD-A-METHOD (re-wrap the SAME unlocked IK under a new KEK) ───────────────────────────────*/

function requireUnlocked(): CryptoKey {
  if (!ik) throw new Error('Unlock cloud sync first.');
  return ik;
}

/** Set or change the account passphrase — re-wraps the unlocked IK under a fresh Argon2id KEK. */
export function setPassphrase(passphrase: string): Promise<boolean> {
  return guard(async () => {
    const key = requireUnlocked();
    const pass = passphrase.trim();
    if (!pass) throw new Error('Enter a passphrase.');
    const { kekFromPassphrase, wrapIK, randomSalt } = await crypto();
    const kek = await kekFromPassphrase(pass, randomSalt());
    await putWrappedIk(await wrapIK(key, kek), 'passphrase');
    await refreshVault();
  });
}

/** Regenerate the escrow recovery key — mints fresh bytes, re-wraps the unlocked IK, returns the new
 *  key (base64) for the UI to render/download ONCE. The old recovery key stops working. */
export async function regenerateRecoveryKey(): Promise<string | null> {
  let out: string | null = null;
  await guard(async () => {
    const key = requireUnlocked();
    const { genRecoveryKey, kekFromRecoveryKey, wrapIK, bytesToBase64 } = await crypto();
    const bytes = genRecoveryKey();
    const kek = await kekFromRecoveryKey(bytes);
    await putWrappedIk(await wrapIK(key, kek), 'recovery');
    out = bytesToBase64(bytes);
    bytes.fill(0);
    await refreshVault();
  });
  return out;
}

/** Enroll a NEW PRF-capable passkey for cloud-sync unlock: register a PRF passkey (client-augmented
 *  ceremony — no server change), obtain its PRF secret via an assertion, then re-wrap the unlocked
 *  IK under its HKDF KEK. Requires an already-unlocked session. */
export function addPasskeyMethod(registerPrfPasskey: () => Promise<boolean>): Promise<boolean> {
  return guard(async () => {
    const key = requireUnlocked();
    const ok = await registerPrfPasskey();
    if (!ok) throw new Error('Could not enroll the passkey.');
    const { prf, credentialId } = await evalPrf();
    const { kekFromPrf, wrapIK } = await crypto();
    const kek = await kekFromPrf(prf);
    await putWrappedIk(await wrapIK(key, kek), credentialId);
    await refreshVault();
  });
}
