#!/usr/bin/env node
/* F61a — zero-knowledge E2E crypto core (src/lib/core/crypto.ts). This is the most
   security-sensitive unit in the synced-workspaces initiative, so the suite is exhaustive:

     - IK wrap/unwrap round-trip per UNLOCK METHOD (prf / passphrase / recovery) recovers the
       byte-identical account identity key;
     - DEK-under-IK wrap/unwrap round-trip, and the unwrapped DEK faithfully encrypts→decrypts;
     - record encrypt→decrypt fidelity + TAMPER REJECTION (flipped ciphertext byte / wrong DEK both
       make decryptRecord throw — the AES-GCM auth tag);
     - the MULTI-METHOD invariant: the SAME IK wrapped under a second method's KEK unwraps to the
       same IK (adding a passkey/passphrase never mints a new IK);
     - blinded-id determinism, cross-workspace divergence, and never-equals-the-raw-tradeId;
     - Argon2id determinism + a pinned known-answer regression vector.

   Runs on Node built-ins only (Web Crypto is globalThis.crypto in node ≥19; hash-wasm runs in
   node). Imports the native-TS core directly (node strips types). */
import assert from 'node:assert/strict';

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  pass++;
};

const {
  genIdentityKey,
  genWorkspaceDek,
  genRecoveryKey,
  kekFromPrf,
  kekFromPassphrase,
  kekFromRecoveryKey,
  wrapIK,
  unwrapIK,
  descriptorOf,
  wrapDek,
  unwrapDek,
  encryptRecord,
  decryptRecord,
  blindId,
  randomSalt,
  ARGON2_DEFAULTS,
  SALT_LEN,
  IV_LEN,
} = await import('../src/lib/core/crypto.ts');

const subtle = globalThis.crypto.subtle;
const td = new TextDecoder();
const hex = buf => Buffer.from(buf).toString('hex');
/** Export an (extractable) IK's raw bytes as hex — TEST-ONLY, to assert byte-identical recovery. */
const rawHex = async key => hex(await subtle.exportKey('raw', key));

console.log('F61a — E2E crypto core (account IK envelope encryption + Argon2id)');

// ── IK wrap/unwrap round-trip per UNLOCK METHOD recovers the identical IK ──────────────────────
{
  const ik = await genIdentityKey();
  const ikHex = await rawHex(ik);

  // passkey PRF path — HKDF over the PRF output; salt is minted + embedded in the blob.
  {
    const prf = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const kek = await kekFromPrf(prf);
    const blob = await wrapIK(ik, kek);
    ok(
      'prf WrappedIK is self-describing (method + hkdfSalt + base64 wrapped)',
      blob.method === 'prf' && typeof blob.hkdfSalt === 'string' && typeof blob.wrapped === 'string'
    );
    // A fresh device rebuilds the KEK from the blob's stored salt + the same PRF secret.
    const d = descriptorOf(blob);
    const kek2 = await kekFromPrf(prf, base64(d.hkdfSalt));
    const ik2 = await unwrapIK(blob, kek2);
    ok('prf: unwrapped IK is byte-identical to the original', (await rawHex(ik2)) === ikHex);
  }

  // passphrase path — Argon2id KEK; params + salt embedded so unlock reproduces them.
  {
    const salt = randomSalt();
    const kek = await kekFromPassphrase('correct horse battery staple', salt);
    const blob = await wrapIK(ik, kek);
    ok(
      'passphrase WrappedIK carries argon2 params + salt',
      blob.method === 'passphrase' && !!blob.argon2 && typeof blob.argon2.salt === 'string'
    );
    const d = descriptorOf(blob);
    const kek2 = await kekFromPassphrase('correct horse battery staple', base64(d.argon2.salt), d.argon2);
    const ik2 = await unwrapIK(blob, kek2);
    ok('passphrase: unwrapped IK is byte-identical to the original', (await rawHex(ik2)) === ikHex);

    // A wrong passphrase yields a wrong KEK → AES-KW integrity check rejects.
    const bad = await kekFromPassphrase('wrong passphrase', base64(d.argon2.salt), d.argon2);
    let threw = false;
    try {
      await unwrapIK(blob, bad);
    } catch {
      threw = true;
    }
    ok('passphrase: a wrong passphrase cannot unwrap the IK (AES-KW rejects)', threw);
  }

  // escrow recovery-key path — full-entropy 256-bit key, deterministic HKDF KEK.
  {
    const rk = genRecoveryKey();
    ok('genRecoveryKey returns 32 raw bytes (256-bit)', rk instanceof Uint8Array && rk.length === 32);
    const kek = await kekFromRecoveryKey(rk);
    const blob = await wrapIK(ik, kek);
    ok(
      'recovery WrappedIK needs no stored salt (full-entropy key)',
      blob.method === 'recovery' && blob.hkdfSalt === undefined && blob.argon2 === undefined
    );
    const kek2 = await kekFromRecoveryKey(rk); // deterministic from the same bytes
    const ik2 = await unwrapIK(blob, kek2);
    ok('recovery: unwrapped IK is byte-identical to the original', (await rawHex(ik2)) === ikHex);
  }
}

// ── MULTI-METHOD invariant: the SAME IK wrapped under a new KEK still unwraps to the same IK ────
{
  const ik = await genIdentityKey();
  const ikHex = await rawHex(ik);

  const rk = genRecoveryKey();
  const recBlob = await wrapIK(ik, await kekFromRecoveryKey(rk));

  // "Add a passphrase method" — re-wrap the SAME IK (no new IK minted).
  const salt = randomSalt();
  const passBlob = await wrapIK(ik, await kekFromPassphrase('unlock-me', salt));

  const viaRecovery = await unwrapIK(recBlob, await kekFromRecoveryKey(rk));
  const viaPass = await unwrapIK(passBlob, await kekFromPassphrase('unlock-me', salt));
  ok('adding a method: both blobs unwrap to the identical IK', (await rawHex(viaRecovery)) === ikHex && (await rawHex(viaPass)) === ikHex);
  ok('the two WrappedIK blobs differ (distinct KEKs) yet carry the same secret', recBlob.wrapped !== passBlob.wrapped);
}

// ── DEK-under-IK wrap/unwrap; the unwrapped DEK faithfully round-trips a record ─────────────────
{
  const ik = await genIdentityKey();
  const dek = await genWorkspaceDek();
  const wrapped = await wrapDek(dek, ik);
  ok('WrappedDek is a v1 AES-KW base64 blob', wrapped.v === 1 && wrapped.alg === 'AES-KW' && typeof wrapped.wrapped === 'string');

  // Encrypt with the ORIGINAL dek, decrypt with the UNWRAPPED dek → proves the DEK survived wrap.
  const dek2 = await unwrapDek(wrapped, ik);
  const rec = await encryptRecord(dek, JSON.stringify({ symbol: 'MES', pnl: 42.5, note: 'secret' }));
  const back = JSON.parse(td.decode(await decryptRecord(dek2, rec)));
  ok(
    'DEK survives wrap/unwrap under the IK (record decrypts faithfully)',
    back.symbol === 'MES' && back.pnl === 42.5 && back.note === 'secret'
  );

  // The unwrapped DEK must be non-extractable (minimize runtime key exposure).
  let exportThrew = false;
  try {
    await subtle.exportKey('raw', dek2);
  } catch {
    exportThrew = true;
  }
  ok('unwrapDek yields a NON-extractable runtime DEK', exportThrew);

  // A different IK cannot unwrap the DEK.
  let wrongIkThrew = false;
  try {
    await unwrapDek(wrapped, await genIdentityKey());
  } catch {
    wrongIkThrew = true;
  }
  ok('a wrong IK cannot unwrap the DEK', wrongIkThrew);
}

// ── Record encryption: fidelity, random IV, and TAMPER REJECTION ───────────────────────────────
{
  const dek = await genWorkspaceDek();
  const plaintext = 'the quick brown fox — P&L 1234.56 — 🦊';
  const rec = await encryptRecord(dek, plaintext);
  ok(
    'EncryptedRecord is a v1 AES-GCM blob with a base64 IV',
    rec.v === 1 && rec.alg === 'AES-GCM' && typeof rec.iv === 'string' && typeof rec.ct === 'string'
  );
  ok('IV is 12 bytes (96-bit AES-GCM nonce)', base64(rec.iv).length === IV_LEN);
  ok('record decrypts back to the exact plaintext', td.decode(await decryptRecord(dek, rec)) === plaintext);

  // Fresh IV per record — two encryptions of the same plaintext differ.
  const rec2 = await encryptRecord(dek, plaintext);
  ok('each record gets a fresh random IV (ciphertext + IV differ)', rec2.iv !== rec.iv && rec2.ct !== rec.ct);

  // Tamper: flip one ciphertext byte → GCM auth tag fails → throw.
  {
    const bytes = base64(rec.ct);
    bytes[0] ^= 0x01;
    const tampered = { ...rec, ct: toBase64(bytes) };
    let threw = false;
    try {
      await decryptRecord(dek, tampered);
    } catch {
      threw = true;
    }
    ok('a flipped ciphertext byte is REJECTED (GCM auth tag)', threw);
  }

  // Wrong DEK → auth fails → throw.
  {
    let threw = false;
    try {
      await decryptRecord(await genWorkspaceDek(), rec);
    } catch {
      threw = true;
    }
    ok('the wrong DEK cannot decrypt the record', threw);
  }
}

// ── Blinded ids: deterministic, cross-workspace divergent, never the raw id ─────────────────────
{
  const wsA = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const wsB = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const id = 'MES 2026-07-06 09:31:00';

  const a1 = await blindId(wsA, id);
  const a2 = await blindId(wsA, id);
  ok('blindId is deterministic (same key + id ⇒ same blinded id)', a1 === a2);
  ok('blinded id is opaque hex, never the raw tradeId', /^[0-9a-f]{64}$/.test(a1) && a1 !== id && !a1.includes(id));

  const b1 = await blindId(wsB, id);
  ok('blinded id DIFFERS across workspace keys', a1 !== b1);

  const other = await blindId(wsA, id + 'x');
  ok('blinded id differs for a different tradeId under the same key', a1 !== other);

  // Accepts a pre-imported HMAC CryptoKey identically.
  const key = await subtle.importKey('raw', wsA, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  ok('blindId accepts a CryptoKey and matches the raw-bytes path', (await blindId(key, id)) === a1);
}

// ── Argon2id: determinism + a pinned known-answer regression vector ─────────────────────────────
{
  const { argon2id } = await import('hash-wasm');
  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) salt[i] = i + 1;
  const params = {
    password: 'blotterbook-kat',
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'binary',
  };
  const h1 = await argon2id(params);
  const h2 = await argon2id(params);
  ok('Argon2id is deterministic for fixed password+salt+params', hex(h1) === hex(h2));
  // Pinned regression vector (hash-wasm 4.12.0; m=64MiB t=3 p=1, 32B out). Catches an accidental
  // lib/param change that would silently strand every already-enrolled passphrase blob.
  const KAT = '913a97b1024399d8272fb9bc25770347465a12def6b4f38c5ca4a3828939e638';
  ok('Argon2id matches the pinned known-answer vector', hex(h1) === KAT);
  ok(
    'ARGON2_DEFAULTS match the tuned constants (64 MiB / t3 / p1 / 32B / 16B salt)',
    ARGON2_DEFAULTS.memKiB === 65536 &&
      ARGON2_DEFAULTS.iterations === 3 &&
      ARGON2_DEFAULTS.parallelism === 1 &&
      ARGON2_DEFAULTS.hashLen === 32 &&
      SALT_LEN === 16
  );
}

console.log(`\n${pass} assertions passed.`);

// base64 helpers (mirror crypto.ts, kept local to avoid importing internals into the test).
function base64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
