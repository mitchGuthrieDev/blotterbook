# Synced workspaces — architecture (A132 / F58–F63)

**Design record, 2026-07-06.** Turns backlog **A132** from a stubbed toggle into a real feature and
defines the architecture for the `cloud`-tier promise the product has carried since the accounts work
(F53–F55): **multi-device, end-to-end-encrypted, named workspaces.** Supersedes the "we don't build
sync" punt in [`vault-storage-assessment.md`](vault-storage-assessment.md) — synced workspaces is the
first feature where we *do* build transport, so this doc is where that transport is specified.

Owner decisions locked for this design (2026-07-06):

- **Encryption posture: E2E, zero-knowledge.** The server stores ciphertext only; it can never read a
  user's trades. This *strengthens* the S25 moat ("we literally cannot read your data") rather than
  retiring it.
- **Sync model: record-level delta + tombstones.** Not whole-snapshot LWW.
- **Workspaces: multiple, named, switchable.** Not one dataset per account.
- **Recovery: a downloaded escrow recovery key.** At workspace creation the user downloads a one-time
  recovery key; it is the guaranteed root of trust. (See *Key management* — this replaces
  passphrase-as-root; a passphrase is optional convenience only.)

## The moat, stated precisely

Today: *no trade data ever leaves the browser* (S25). Synced workspaces is, by construction, the first
egress of trade data — so the guarantee is **refined, not dropped**:

> Trade data leaves the browser **only** for a `cloud`-tier user who has **opted a workspace into
> sync**, and **only as ciphertext we cannot decrypt.** Compute stays 100% local on every tier; the
> server is a dumb encrypted-blob store. `local`-tier and un-synced workspaces are unchanged —
> nothing leaves.

Everything below is in service of keeping that sentence true.

## What we reuse (this is less greenfield than it looks)

- **`StoreLike` is the only persistence contract** (`src/lib/core/store.ts` / `types.ts`). `CloudStore`
  implements the same ~30 methods; `Entitlements.storeFor(tier)` selects it. No app/screen code changes.
- **The data model is already sync-shaped:**
  - **Trades are a grow-only set keyed by a content hash** (`tradeId` = FNV of `time|symbol|side|pnl`).
    Two devices importing overlapping CSVs converge to the identical set with **no conflict** — the
    union merge in `addTrades` is already commutative and even enriches duplicates field-by-field.
  - **Journal + trade-meta carry `updated` timestamps** → per-record last-writer-wins is a natural fit.
  - **`exportAll`/`importAll` already define a checksummed wire envelope**, and `importAll` is a
    **hardened trust boundary** (S15/S17/S20/A154 sanitizers). Anything arriving from the server flows
    through the exact same gate as a backup restore — no new trust surface.
- **Identity + billing plumbing is live:** passkey sessions, `/api/me` returning `{ tier }`, the
  signature-verified Stripe webhook provisioning subscriptions. `me.ts` simply never *grants* a
  non-local tier yet. **R2** is already the named blob store in the plan.

The genuinely new work: **(a)** tombstones in the local store, **(b)** the workspace dimension,
**(c)** cloud-entitlement wiring, **(d)** the E2E crypto layer, **(e)** `/api/sync`, **(f)** `CloudStore`.

## Topology: write-behind, IndexedDB stays primary

IndexedDB remains the working store on **every** browser and tier. `CloudStore` *wraps* the local
`Store`:

- **Reads** hit IndexedDB (offline-first; compute never touches the network — moat).
- **Writes** go to IndexedDB, then enqueue a debounced, encrypted **push**.
- **On load / focus**, a **pull** since the last cursor merges remote changes through `importAll`.

This is what the vault assessment already recommended for the folder case, and it keeps
Safari/Firefox/mobile on the **identical code path** — they just have the write-behind pointed at the
cloud. Cloud-primary (server as source of truth) was rejected: it breaks offline and drags compute
toward the network.

## Key management (the crux)

Because F55 lets a user enroll **multiple passkeys** and WebAuthn PRF yields a *different* secret per
credential, we cannot derive "the workspace key" from a passkey directly. We use **envelope
encryption** (the password-manager pattern):

```
per-workspace random DEK  (Data Encryption Key — actually encrypts every record; AES-GCM)
    │  wrapped (encrypted) once per unlock method, producing opaque "wrapped-DEK" blobs:
    ├─ KEK from each enrolled PASSKEY   (WebAuthn PRF extension → HKDF → AES-KW)   ← per-device unlock
    ├─ KEK from an optional PASSPHRASE  (Argon2id/PBKDF2 → AES-KW)                 ← convenience / no-PRF browsers
    └─ KEK from the ESCROW RECOVERY KEY (random 256-bit, shown/downloaded ONCE)    ← guaranteed root of trust
```

- The **DEK never leaves the client in the clear.** The server stores only the wrapped-DEK blobs
  (ciphertext of a key it can't unwrap) plus the encrypted records.
- **Adding a passkey** re-wraps the DEK for the new credential's KEK — which requires an already-unlocked
  device *or* the passphrase *or* the recovery key present. This is why F55's email re-enrollment can
  restore *login* but not *decryption*: the server has no key to hand back.
- **Escrow recovery key (owner decision):** generated at workspace creation, rendered once for the user
  to **download/print**, and used to wrap the DEK. It is **never persisted client-side after the
  download** and never sent to the server in the clear. Losing every passkey **and** the passphrase is
  survivable *iff* the user kept this key. If all three are lost, the cloud ciphertext is
  unrecoverable — **but the local IndexedDB copy still exists.** This trade-off is inherent to
  zero-knowledge and must be surfaced plainly in the setup UI.
- **No-PRF browsers** (Safari/Firefox today) use the passphrase KEK to unlock; the passkey is still the
  login credential, the passphrase is the decryption credential there.

## The server's role (deliberately dumb)

Since the server can't read plaintext, it **cannot merge** — it is an ordered encrypted-blob store:

```
sync_records(workspace_id, blinded_id, type, ciphertext, updated, deleted, seq)
sync_wrapped_keys(workspace_id, method, key_id, wrapped_dek)   -- method ∈ passkey|passphrase|recovery
sync_workspaces(workspace_id, owner_user_id, created_at)        -- names live ENCRYPTED in a record, not here
```

- **Merge is 100% client-side.** A device pulls "everything since `seq N`", decrypts, and runs the
  **existing** merge semantics locally (trade union / journal LWW / meta LWW).
- **`blinded_id = HMAC(workspaceKey, tradeId)`**, never the raw content hash. `tradeId` is a hash *of
  trade data*; exposing it would let anyone with the ciphertext store confirm a guessed trade by
  hashing it. Blinding preserves idempotent upsert/dedup (same trade → same blinded id) while leaking
  nothing to the server.
- **Monotonic `seq` per workspace** gives cheap incremental pull.
- `/api/sync/*` **fails closed** (503) without R2 / `ACCOUNTS_DB`, is **session-gated**, and is
  **Origin-checked** on mutations — the same posture as every other `functions/` route.
- **R2** holds the record ciphertext blobs; **D1** holds the change-index (`seq`, `blinded_id`,
  `updated`, `deleted`) and the wrapped keys. Metadata visible to us: workspace ids, record counts,
  timestamps, sizes. Never: symbols, P&L, notes, screenshots, tags, dates.

## Merge & tombstones

The good news holds — trades are a **content-hash union** (conflict-free), journal/trade-meta are
**LWW by `updated`**. The one thing the model lacks is **deletes**: today a delete is mere *absence*,
indistinguishable from "not synced yet," and worse, re-importing a CSV would **resurrect** a deleted
trade. So:

- Every mutating path in `store.ts` records a **tombstone** `{ blinded_id, deleted:true, updated }`.
- `addTrades` consults tombstones to **suppress resurrection** (a re-import of a file whose trade the
  user deleted stays deleted unless the tombstone is older than the incoming `updated`).
- Tombstones sync like any other record and are the delete half of LWW.

This is the **only** change to the *existing* local store, it is **moat-neutral** (no crypto, no
server), and it can land first and independently.

## The workspace dimension

"Multiple named workspaces" adds a `workspaceId` dimension:

- **One IndexedDB database per workspace** (`blotterbook:<wsid>`), not key-prefixing — cleaner
  isolation, and "switch workspace" = "open a different DB." `store.ts`'s `open()`/`DB_NAME` already
  switches on `staging`, so this generalizes that seam.
- **Active workspace id** lives in `Store.local` (the sync, pre-paint localStorage seam) so boot opens
  the correct DB before first render.
- A **workspace registry** (`[{ id, name, createdAt }]`) also lives in `Store.local` for the switcher;
  when synced, workspace **names travel encrypted** (as a record), never in `sync_workspaces`.
- **Entitlement split (keeps the free tier graceful):** a *workspace* (a named local dataset) is
  available to **everyone** on `local`; **syncing** a workspace is the **`cloud`** feature. Free users
  get multiple local workspaces; the subscription unlocks multi-device + durable cloud copy.

## Entitlement wiring

- `me.ts` grants `{ tier:'cloud', cloudSync:true }` when the user has an **active subscription**
  (extend the existing donation/subscription bookkeeping; today it returns `local` unconditionally).
- `Entitlements.current()` (scaffold, currently unloaded) starts calling `/api/me`; `storeFor('cloud')`
  returns `CloudStore`, `storeFor('local')` returns `Store`. `App.svelte` already resolves and
  prop-drills one `Store` — it resolves it through `Entitlements` instead of importing `Store` directly.

## Build sequence

Steps 1–2 touch only the local store + UI — **no moat implications, shippable before any crypto/server
exists.** Steps 4–6 concentrate the E2E work.

1. **F58 — Tombstones + `updated` audit** in `store.ts` (delete-log; suppress-resurrection). Local-only.
2. **F59 — Named local workspaces:** per-workspace IndexedDB + registry + active-workspace seam.
   **A132** (rescoped) is the switcher UI + persisted preference riding on this — still local-only here.
3. **F60 — Cloud entitlement flip:** `me.ts` + wire `Entitlements.current()/storeFor()`.
4. **F61 — E2E crypto layer:** envelope encryption, PRF/passphrase/escrow-recovery KEKs, wrapped-DEK
   handling, `blinded_id`, the setup + recovery-key-download UI.
5. **F62 — `/api/sync`** over R2 + a D1 change-index (encrypted-blob store, `seq` cursor, session-gated,
   fail-closed).
6. **F63 — `CloudStore` write-behind** wrapping `Store`, selected by `storeFor('cloud')`; push/pull +
   client-side merge. Promote staging→prod via the normal CH16 path.

## Fit with the guardrails

- **S25 / moat:** refined, not broken — see *The moat, stated precisely*. Compute stays local; egress is
  cloud-tier, opt-in, ciphertext-only.
- **A4 (Store seam):** honored — `CloudStore` is a `StoreLike`; no component touches `indexedDB` or the
  network directly.
- **Trust boundary:** every pulled record decrypts then flows through the existing `importAll`-class
  sanitizers (S15/S17/S20/A154) — same gate as a backup restore.
- **CSP / functions posture:** `/api/sync/*` fails closed without bindings, session + Origin gated,
  constant-time where it compares secrets — identical to F53–F55.
- **Demo:** `DemoStore` (in-memory) is never a `cloud` store and never syncs — demo persistence stays
  impossible by construction.

## Not doing (and why)

- **Server-side merge / server-visible plaintext** — would break zero-knowledge; rejected by owner.
- **Whole-snapshot LWW** — a stale device's push clobbers another device's offline edits; rejected.
- **Cloud-primary store** — breaks offline and pulls compute toward the network; rejected.
- **Passphrase-as-sole-root** — replaced by the downloaded escrow recovery key (owner decision); a
  passphrase remains optional convenience / the no-PRF unlock path.
