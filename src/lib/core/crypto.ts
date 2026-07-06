/* Blotterbook · zero-knowledge E2E crypto core (F61a — synced workspaces, step 4a).
 *
 * The pure key/record cryptography for the cloud tier. Framework-agnostic, node-testable, NO UI
 * (F61b), NO transport (F62), NO store-wrapping (F63). The server MUST never see plaintext trade
 * data, a key, or a workspace name — everything it stores is one of the self-describing ciphertext
 * blobs in types.ts (WrappedIK / WrappedDek / EncryptedRecord).
 *
 * Envelope encryption with an ACCOUNT-LEVEL identity key (owner decision 2026-07-06 — the
 * password-manager pattern), so there is ONE recovery key per account and adding a workspace needs
 * no new key ceremony:
 *
 *   account IDENTITY KEY (IK)            random 256-bit AES-KW key — the account's root secret
 *     ├─ wrapped once per UNLOCK METHOD → WrappedIK blobs (server-stored, opaque):
 *     │    · passkey  : WebAuthn PRF output → HKDF-SHA256 → AES-KW KEK   (kekFromPrf)
 *     │    · passphrase: Argon2id(wasm)             → AES-KW KEK         (kekFromPassphrase)
 *     │    · recovery  : full-entropy 256-bit key → HKDF → AES-KW KEK    (kekFromRecoveryKey)
 *     └─ wraps each per-workspace DEK (AES-KW). The DEKs (AES-GCM) actually encrypt records.
 *
 * ── CryptoKey extractability model (minimize extractable key material) ─────────────────────────
 *   · KEKs (from PRF / passphrase / recovery)  : NON-extractable, usages wrapKey/unwrapKey only.
 *       Their raw bytes never leave Web Crypto — they only wrap/unwrap the IK.
 *   · IK  : extractable=true — REQUIRED because AES-KW `wrapKey` can only wrap an extractable key,
 *       and the IK must be wrappable under each method's KEK. We never call `exportKey` on it in the
 *       clear ourselves; the only export is via `wrapKey`, which emits ciphertext, not clear bytes.
 *   · DEK : `genWorkspaceDek()` mints it extractable=true (so `wrapDek` can wrap it once under the
 *       IK); `unwrapDek()` reconstitutes it NON-extractable (it is only ever used to encrypt/decrypt
 *       records thereafter — it never needs re-wrapping, since add-a-method re-wraps the IK, not DEKs).
 *   · Recovery key : returned ONCE as raw bytes from `genRecoveryKey()` for the UI (F61b) to
 *       render/download; this module never persists it. It is the single guaranteed root of trust.
 *
 * Unlock is session-scoped and IN-MEMORY ONLY — this module never persists the IK, a DEK, or the
 * recovery key (F61b enforces the session lifecycle). No top-level side effects and no eager import
 * of the wasm: `crypto.ts` is dynamically `import()`ed on the cloud-sync path only, so it stays out
 * of the /app boot bundle (hash-wasm's Argon2id wasm loads lazily inside kekFromPassphrase). */

import type { Argon2Params, Kek, KekDescriptor, WrappedIK, WrappedDek, EncryptedRecord } from './types.ts';

const subtle = globalThis.crypto.subtle;

/** Byte buffer backed by a plain ArrayBuffer — what Web Crypto's BufferSource params require (a
 *  bare `Uint8Array` widens to `Uint8Array<ArrayBufferLike>`, which includes SharedArrayBuffer and
 *  is rejected by crypto.subtle). Matches the repo convention (see xlsx.ts). */
type Bytes = Uint8Array<ArrayBuffer>;

/* ── Argon2id parameters (passphrase KEK) ──────────────────────────────────────────────────────
 * Memory-hard KDF (owner decision 2026-07-06 — NOT PBKDF2). Tuned for ~200–500 ms on a typical
 * device: 64 MiB / 3 passes / 1 lane measured ~370 ms in node on the dev machine, comfortably in
 * band and above OWASP's Argon2id interactive floor (m≥19 MiB, t≥2). Params travel inside each
 * passphrase WrappedIK, so raising them later never strands an already-enrolled blob. */
export const ARGON2_DEFAULTS: Argon2Params = {
  memKiB: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 1,
  hashLen: 32, // 256-bit KEK
};
/** Salt length (bytes) for the passphrase Argon2id KDF and the PRF HKDF. */
export const SALT_LEN = 16;
/** IV length (bytes) for AES-GCM record encryption — 96-bit, the AES-GCM standard nonce size. */
export const IV_LEN = 12;

/** HKDF `info` labels — domain separation so a KEK derived for one method/purpose can't collide
 *  with another even given identical input key material. */
const HKDF_INFO_PRF = 'blotterbook/e2e/ik-kek/prf/v1';
const HKDF_INFO_RECOVERY = 'blotterbook/e2e/ik-kek/recovery/v1';
/** Domain-separation label for the per-workspace BLINDING KEY derived from the DEK (F63). Fixed +
 *  distinct from every other HKDF label, so the HMAC blinding key can never collide with a KEK. */
const HKDF_INFO_BLIND = 'blotterbook/e2e/blind-key/v1';

const enc = new TextEncoder();

/* ── base64 <-> bytes (JSON-serializable blob fields; works in node + browsers) ─────────────── */

/** Encode bytes as standard base64 (for the JSON/serializable blob fields F62 ships). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Decode standard base64 back to bytes. */
export function base64ToBytes(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Lowercase hex (blinded ids — stable, URL-safe, opaque). */
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** Fresh cryptographically-random salt (Argon2id / HKDF). */
export function randomSalt(len: number = SALT_LEN): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(len));
}

/* ── Root key material ─────────────────────────────────────────────────────────────────────── */

/** Mint the account IDENTITY KEY: a random 256-bit AES-KW key that wraps every per-workspace DEK.
 *  Extractable so it can itself be wrapped (AES-KW) under each unlock method's KEK — see the
 *  extractability model at the top of this file. */
export function genIdentityKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey', 'unwrapKey']);
}

/** Mint a per-workspace DATA-ENCRYPTION KEY (AES-GCM). Extractable so `wrapDek` can wrap it once
 *  under the IK; after `unwrapDek` on other devices it is reconstituted non-extractable. */
export function genWorkspaceDek(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Mint the account ESCROW RECOVERY KEY: full-entropy 256-bit random bytes, the single guaranteed
 *  root of trust. Returned ONCE here for the UI (F61b) to render/download; never persisted by this
 *  module. Feed the same bytes to `kekFromRecoveryKey` to derive its KEK. */
export function genRecoveryKey(): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/* ── KEK derivation (one per unlock method) ────────────────────────────────────────────────────
 * Each returns a { key, descriptor }: `key` is a non-extractable AES-KW KEK; `descriptor` is the
 * self-describing metadata that gets embedded into the WrappedIK so a fresh device can rebuild the
 * same KEK (given the underlying secret) and unwrap the IK. */

async function hkdfKek(ikm: Bytes, salt: Bytes, info: string): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-KW', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

/** KEK from a WebAuthn PRF output (per-passkey secret). HKDF-SHA256 stretches/domain-separates the
 *  PRF bytes into an AES-KW KEK. A random salt is minted if none is supplied; the salt is stored in
 *  the descriptor (and hence the WrappedIK) so unlock reproduces the KEK. This module takes the PRF
 *  bytes as INPUT — it does not run the WebAuthn ceremony (that is F61b). */
export async function kekFromPrf(prfOutput: Bytes, salt: Bytes = randomSalt()): Promise<Kek> {
  const key = await hkdfKek(prfOutput, salt, HKDF_INFO_PRF);
  return { key, descriptor: { method: 'prf', hkdfSalt: bytesToBase64(salt) } };
}

/** KEK from a PASSPHRASE via Argon2id (memory-hard, wasm). The wasm loads lazily here (dynamic
 *  import) so it never touches the /app boot bundle. Params default to ARGON2_DEFAULTS and travel
 *  in the descriptor so a device can reproduce the KEK. */
export async function kekFromPassphrase(passphrase: string, salt: Bytes, params: Argon2Params = ARGON2_DEFAULTS): Promise<Kek> {
  const { argon2id } = await import('hash-wasm');
  const raw = await argon2id({
    password: passphrase,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memKiB,
    hashLength: params.hashLen,
    outputType: 'binary',
  });
  // Copy into a plain ArrayBuffer-backed view (hash-wasm's Uint8Array widens to ArrayBufferLike,
  // which crypto.subtle's BufferSource rejects).
  const key = await subtle.importKey('raw', new Uint8Array(raw), 'AES-KW', false, ['wrapKey', 'unwrapKey']);
  return { key, descriptor: { method: 'passphrase', argon2: { ...params, salt: bytesToBase64(salt) } } };
}

/** KEK from the full-entropy ESCROW RECOVERY KEY (256-bit). Already high-entropy, so a fixed-info
 *  HKDF (no salt needed) domain-separates it into an AES-KW KEK — deterministic: the same bytes
 *  always yield the same KEK. */
export async function kekFromRecoveryKey(bytes: Bytes): Promise<Kek> {
  const key = await hkdfKek(bytes, new Uint8Array(0), HKDF_INFO_RECOVERY);
  return { key, descriptor: { method: 'recovery' } };
}

/* ── IK wrap / unwrap (one WrappedIK per unlock method) ───────────────────────────────────────── */

/** Wrap the account IK (AES-KW) under a method's KEK into a self-describing WrappedIK blob. Adding a
 *  new unlock method = wrapping the SAME IK under a new KEK (an already-unlocked session provides the
 *  IK). */
export async function wrapIK(ik: CryptoKey, kek: Kek): Promise<WrappedIK> {
  const wrapped = await subtle.wrapKey('raw', ik, kek.key, 'AES-KW');
  const blob: WrappedIK = {
    v: 1,
    method: kek.descriptor.method,
    alg: 'AES-KW',
    wrapped: bytesToBase64(new Uint8Array(wrapped)),
  };
  if (kek.descriptor.method === 'prf') blob.hkdfSalt = kek.descriptor.hkdfSalt;
  else if (kek.descriptor.method === 'passphrase') blob.argon2 = kek.descriptor.argon2;
  return blob;
}

/** Unwrap a WrappedIK with its method's KEK, recovering the account IK. Throws (AES-KW integrity
 *  check) on the wrong KEK or a corrupted blob. The IK is reconstituted extractable so it can be
 *  re-wrapped for additional methods within the unlocked session. */
export function unwrapIK(blob: WrappedIK, kek: Kek): Promise<CryptoKey> {
  return subtle.unwrapKey('raw', base64ToBytes(blob.wrapped), kek.key, 'AES-KW', { name: 'AES-KW', length: 256 }, true, [
    'wrapKey',
    'unwrapKey',
  ]);
}

/** Read the KEK descriptor back out of a stored WrappedIK — F61b uses this to know which secret to
 *  prompt for and which salt/params to feed the matching `kekFrom*` before calling `unwrapIK`. */
export function descriptorOf(blob: WrappedIK): KekDescriptor {
  if (blob.method === 'prf') return { method: 'prf', hkdfSalt: blob.hkdfSalt ?? '' };
  if (blob.method === 'passphrase') {
    // argon2 is always present on a well-formed passphrase blob; fall back to defaults defensively.
    return { method: 'passphrase', argon2: blob.argon2 ?? { ...ARGON2_DEFAULTS, salt: '' } };
  }
  return { method: 'recovery' };
}

/* ── DEK wrap / unwrap (per workspace, under the IK) ──────────────────────────────────────────── */

/** Wrap a per-workspace DEK (AES-KW) under the account IK. */
export async function wrapDek(dek: CryptoKey, ik: CryptoKey): Promise<WrappedDek> {
  const wrapped = await subtle.wrapKey('raw', dek, ik, 'AES-KW');
  return { v: 1, alg: 'AES-KW', wrapped: bytesToBase64(new Uint8Array(wrapped)) };
}

/** Unwrap a workspace DEK with the account IK. Reconstituted NON-extractable — it is only ever used
 *  to encrypt/decrypt records after this, never re-wrapped. Throws on the wrong IK / corrupt blob. */
export function unwrapDek(blob: WrappedDek, ik: CryptoKey): Promise<CryptoKey> {
  return subtle.unwrapKey('raw', base64ToBytes(blob.wrapped), ik, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/* ── Per-workspace key material for the write-behind sync layer (F63) ──────────────────────────────
 * The DEK's raw bytes are the deterministic seed for BOTH the record-encryption key (the DEK itself)
 * and the per-workspace BLINDING KEY (`blindId`'s HMAC key). Deriving the blinding key from the DEK
 * — instead of minting a separate key — means it needs no extra server blob and is IDENTICAL on every
 * device that unwraps the same DEK, so `blindId(blindKey, id)` matches across devices (idempotent
 * upsert/dedup on the server). The bytes are handled briefly in memory and the caller zeroes them. */

/** Export a freshly-minted (extractable) DEK's raw bytes — device-A path, where `genWorkspaceDek`
 *  produced the key locally. Zero the result once the workspace keys are derived. */
export async function dekBytesOf(dek: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await subtle.exportKey('raw', dek)) as Bytes;
}

/** Unwrap a workspace DEK to its RAW bytes (device-B path — the DEK came from the server wrapped
 *  under the IK). Unwraps EXTRACTABLE only to export the seed; the caller re-imports a non-extractable
 *  record key via `importDek` and zeroes the bytes. Throws on the wrong IK / corrupt blob. */
export async function unwrapDekBytes(blob: WrappedDek, ik: CryptoKey): Promise<Bytes> {
  const key = await subtle.unwrapKey('raw', base64ToBytes(blob.wrapped), ik, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  return new Uint8Array(await subtle.exportKey('raw', key)) as Bytes;
}

/** Re-import raw DEK bytes as the NON-extractable AES-GCM record key used for `encryptRecord`/
 *  `decryptRecord` (minimizes runtime key exposure — the bytes are zeroed after this + `blindKeyFromDekBytes`). */
export function importDek(bytes: Bytes): Promise<CryptoKey> {
  return subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Derive the per-workspace HMAC-SHA256 BLINDING KEY from the DEK bytes via HKDF with a fixed label
 *  (no salt — the DEK is full-entropy). Deterministic: the same DEK ⇒ the same blinding key on every
 *  device, so `blindId` is stable cross-device. Non-extractable, sign-only. */
export async function blindKeyFromDekBytes(bytes: Bytes): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(HKDF_INFO_BLIND) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
}

/* ── Record encryption (AES-GCM, authenticated, fresh IV per record) ─────────────────────────── */

/** Encrypt a record with its workspace DEK. Fresh 96-bit random IV per record (never reused with a
 *  given DEK); the GCM tag authenticates the ciphertext. Accepts a string (UTF-8 encoded) or raw
 *  bytes; returns a serializable EncryptedRecord. */
export async function encryptRecord(dek: CryptoKey, plaintext: string | Bytes): Promise<EncryptedRecord> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const bytes = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes);
  return { v: 1, alg: 'AES-GCM', iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

/** Decrypt a record with its workspace DEK. THROWS if the ciphertext was tampered with (a flipped
 *  byte) or the wrong DEK is used — the GCM auth tag fails and Web Crypto rejects. Returns the raw
 *  plaintext bytes (callers TextDecode for JSON). */
export async function decryptRecord(dek: CryptoKey, rec: EncryptedRecord): Promise<Bytes> {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(rec.iv) }, dek, base64ToBytes(rec.ct));
  return new Uint8Array(pt);
}

/* ── Blinded record ids ───────────────────────────────────────────────────────────────────────
 * blinded_id = HMAC(workspaceKey, tradeId) — the server's change-index key. NEVER the raw content
 * hash: a trade's content hash is a hash OF trade data, so exposing it lets an attacker confirm a
 * guessed trade. The HMAC key is secret to clients holding the workspace key, so the server can
 * index/dedupe without learning anything about the trade. */

/** Deterministic blinded id for a record. `workspaceKey` is the per-workspace secret used only for
 *  blinding (a raw 32-byte key or a pre-imported HMAC CryptoKey). Same key + id ⇒ same id; different
 *  workspace keys ⇒ different ids; never equal to the raw tradeId. */
export async function blindId(workspaceKey: CryptoKey | Bytes, tradeId: string): Promise<string> {
  const key =
    workspaceKey instanceof Uint8Array
      ? await subtle.importKey('raw', workspaceKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      : workspaceKey;
  const mac = await subtle.sign('HMAC', key, enc.encode(tradeId));
  return bytesToHex(new Uint8Array(mac));
}
