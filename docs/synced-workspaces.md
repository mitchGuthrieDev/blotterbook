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
- **Recovery: one downloaded escrow recovery key per ACCOUNT.** An account-level identity key wraps
  every per-workspace key; the user downloads a single recovery key at cloud-sync setup and it is the
  guaranteed root of trust. (See *Key management* — this replaces passphrase-as-root; a passphrase is
  optional convenience only.)
- **Subscription lapse: period-end + grace.** Cancel keeps sync to period end; a failed payment gets a
  dunning grace window. (See *Entitlement wiring*.)

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
credential, we cannot derive keys from a passkey directly. We use **envelope encryption** with an
**account-level identity key** (owner decision, 2026-07-06 — the password-manager pattern), so there is
**one** recovery key for the whole account and adding a workspace needs no new key ceremony:

```
account IDENTITY KEY (IK)   (random 256-bit — the account's root secret; never leaves the client in clear)
    │  wrapped once per UNLOCK METHOD → opaque "wrapped-IK" blobs, stored server-side:
    ├─ KEK from each enrolled PASSKEY    (WebAuthn PRF ext → HKDF → AES-KW)   ← per-device unlock
    ├─ KEK from an optional PASSPHRASE   (Argon2id[wasm] → AES-KW)            ← no-PRF browsers / convenience
    └─ KEK from the ESCROW RECOVERY KEY  (random 256-bit, downloaded ONCE)    ← the single guaranteed root
    │
    └─►  IK wraps each per-workspace DEK  (AES-KW).  The DEKs (AES-GCM) actually encrypt records.
```

- **Neither the IK nor any DEK leaves the client in the clear.** The server stores only the wrapped-IK
  blobs (one per unlock method) + the IK-wrapped per-workspace DEKs + the encrypted records — all
  ciphertext of keys it can't unwrap.
- **One recovery key per account.** Generated at cloud-sync setup, rendered **once** for the user to
  download/print, used to wrap the IK. **Never persisted client-side after download**, never sent to the
  server in the clear. Adding a workspace only mints a new DEK and wraps it under the existing IK — no
  new recovery artifact. Losing every passkey **and** the passphrase is survivable *iff* the user kept
  this one key; if all three are lost the cloud ciphertext is unrecoverable — **but the local IndexedDB
  copy still exists.** This trade-off is inherent to zero-knowledge and must be surfaced plainly in the
  setup UI.
- **Adding a passkey** re-wraps the **IK** (not each DEK) for the new credential's KEK — which requires
  an already-unlocked device *or* the passphrase *or* the recovery key present. This is why F55's email
  re-enrollment restores *login* but not *decryption*: the server has no key to hand back.
- **Unlock is once per session.** WebAuthn PRF only emits its secret during an auth ceremony (a user
  gesture), so we unlock the IK **once per session** (one passkey tap or passphrase), hold the IK + the
  active workspace's DEK **in memory only**, and never persist them. Every subsequent push/pull encrypts
  with the in-memory DEK — no re-tap per sync.
- **No-PRF browsers** (Safari/Firefox today) unlock the IK via the **passphrase** KEK; the passkey is
  still the login credential, the passphrase is the decryption credential there.
- **Compat — existing F53 passkeys can't do PRF.** PRF must be requested at *credential creation*, and
  passkeys already enrolled were not. So on first cloud-sync setup a user either enrolls a **new**
  PRF-capable passkey or relies on the passphrase path; the setup flow must detect PRF support
  (`getClientCapabilities` / a probe) and guide accordingly rather than assuming it.

## The server's role (deliberately dumb)

Since the server can't read plaintext, it **cannot merge** — it is an ordered encrypted-blob store:

```
sync_records(workspace_id, blinded_id, seq, type, ciphertext_ref, updated, deleted)  -- ciphertext_ref → the R2 object; D1 is the index
sync_wrapped_ik(user_id, method, key_id, wrapped_ik, updated)  -- account IK wrapped per unlock method (method value: prf|passphrase|recovery)
sync_workspace_keys(workspace_id, owner_user_id, wrapped_dek, updated)  -- per-workspace DEK wrapped under the account IK
sync_workspaces(workspace_id, owner_user_id, created_at)        -- names live ENCRYPTED in a record, not here
```

*(As built: the record ciphertext lives in R2 (`SYNC_BUCKET`), keyed `records/<workspace_id>/<blinded_id>`;
the D1 `sync_records` row carries `ciphertext_ref` pointing at it plus the `seq`/`updated`/`deleted` index.
The wrapped-IK `method` value for a passkey is **`prf`** — the WebAuthn PRF path — not the literal string
`passkey`; `passphrase` and `recovery` are the other two.)*

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

- Every mutating path in `store.ts` records a **tombstone** `{ id, type, deleted:true, updated }`.
- `addTrades` consults tombstones to **suppress resurrection**. **Default policy (open, easily flipped):
  a tombstone always wins over a CSV re-import** — you deleted it, re-importing the same file won't
  bring it back; only an explicit user re-add does. The alternative (timestamp-LWW: resurrect if the
  incoming `updated` is newer than the tombstone) is a one-line change; F58 isolates the decision behind
  a single predicate.
- Tombstones sync like any other record and are the delete half of LWW.
- **Clock-skew caveat:** LWW keys on the wall-clock `updated`, so a device with a fast clock can win a
  same-record conflict. For a *single user's* devices this is acceptable — trades are content-hash-immune
  (union, never conflict), and only concurrent edits to the *same* journal/meta record on two devices
  conflict, which is rare. If it bites, the upgrade path is a hybrid logical clock; we do not need it now.

This is the **only** change to the *existing* local store, it is **moat-neutral** (no crypto, no
server), and it can land first and independently.

## The workspace dimension

"Multiple named workspaces" adds a `workspaceId` dimension:

- **One IndexedDB database per workspace** (`blotterbook:<wsid>`), not key-prefixing — cleaner
  isolation, and "switch workspace" = "open a different DB." `store.ts`'s `open()`/`DB_NAME` already
  switches on `staging`, so this generalizes that seam.
- **Active workspace id** lives in `Store.local` (the sync, pre-paint localStorage seam) so boot opens
  the correct DB before first render.
- **Migration of today's data (F59):** the existing `blotterbook` DB every current user already has
  becomes a **"Default" workspace** automatically on first boot after F59 — seed the registry with one
  entry pointing at the current DB (keep its name so no rename/copy is needed), set it active. No data
  moves; the single-DB world is just the one-workspace case of the new model.
- A **workspace registry** (`[{ id, name, createdAt }]`) also lives in `Store.local` for the switcher;
  when synced, workspace **names travel encrypted** (as a record), never in `sync_workspaces`.
- **Entitlement split (keeps the free tier graceful):** a *workspace* (a named local dataset) is
  available to **everyone** on `local`; **syncing** a workspace is the **`cloud`** feature. Free users
  get multiple local workspaces; the subscription unlocks multi-device + durable cloud copy.

## Entitlement wiring

- `me.ts` grants `{ tier:'cloud', cloudSync:true }` when the user has an **active subscription**
  (extend the existing donation/subscription bookkeeping; today it returns `local` unconditionally).
- **Lapse policy (owner decision, 2026-07-06): period-end + grace.** A cancellation keeps `cloud` until
  the paid period ends; a failed payment gets a dunning grace window before cutoff. This means the
  webhook (F54 handles `checkout.session.completed` only) must also handle
  `customer.subscription.updated` / `customer.subscription.deleted` / `invoice.payment_failed` and
  persist a subscription row with `status` + `current_period_end`; `me.ts` grants `cloud` while
  `status ∈ {active, past_due-within-grace}` or `now < current_period_end`. This grows F60 from a
  one-line flip into real subscription-lifecycle handling — scope it as **medium**, not small.
  On cutoff, the tier drops to `local`; **local IndexedDB data always remains** (only sync stops).
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
4. **F61 — E2E crypto layer**, split for reviewability: **F61a** — the crypto core (`crypto.ts`: IK
   gen, AES-KW wrap/unwrap per method, HKDF-from-PRF, **Argon2id-wasm** passphrase KDF, `blinded_id`
   HMAC) — pure + node-tested in isolation; **F61b** — the setup/unlock UI (recovery-key download,
   passphrase entry, PRF probe + enroll-a-PRF-passkey guidance, unlock modal) in the
   Account screen. Passphrase KDF = **Argon2id via wasm** (owner decision 2026-07-06): memory-hard,
   ~30–50 KiB against the ~125 KiB bundle headroom; the full-entropy escrow key stays the real root.
5. **F62 — `/api/sync`** over R2 + a D1 change-index (encrypted-blob store, `seq` cursor, session-gated,
   fail-closed).
6. **F63 — `CloudStore` write-behind** wrapping `Store`, selected by `storeFor('cloud')`; push/pull +
   client-side merge. Promote staging→prod via the normal CH16 path.

### F63 as built (2026-07-06; CH16 prod promote 2026-07-07)

Landed on staging 2026-07-06 and promoted to prod via CH16 on 2026-07-07 (opt-in, `cloud`-tier only;
demo never syncs). NB: the store-wrap was already non-demo (A256) — the CH16 promote was a GA
declaration + doc/comment alignment, not a gate flip. Key decisions:

- **Layering.** `src/app/lib/cloudsync-core.ts` is the pure (rune-free, node-testable) engine
  (`collectChanges`/`pushChanges`/`pullAndMerge`/`mergeRecords`); `cloudstore.ts` is the `StoreLike`
  wrapper (reads delegate, writes delegate + fire `onWrite`); `cloudsync.svelte.ts` is the reactive
  controller (status, debounce, enable, the fetch transport). `crypto.ts` (and its Argon2 wasm) is
  **dynamically imported** on every path, so it stays out of the /app boot bundle (A96). App.svelte
  wraps the Store in a `CloudStore` on **every non-demo surface** (A256; inert until a cloud-tier user
  opts a workspace in + unlocks); **demo** never constructs one → never syncs.
- **Blinding key derivation.** `blindId`'s per-workspace HMAC key is derived from the **DEK bytes**
  via HKDF-SHA256 with the fixed label `blotterbook/e2e/blind-key/v1` (`crypto.blindKeyFromDekBytes`),
  and the record key is the DEK re-imported non-extractable (`crypto.importDek`). Both come from the
  same DEK seed, so every device that unwraps the same DEK produces **identical** blinded ids
  (idempotent server-side upsert/dedup) — no extra server blob. Blinding input is namespaced
  `` `${type}:${id}` `` so a trade and its trade-meta (which share a key) don't collide.
- **Merge.** Pull does a **full `since=0` reconcile** on connect/unlock/focus (closes F62's
  concurrent-push seq race — a full read can't skip a colliding seq an incremental `since=cursor`
  pull would), then steady-state incremental from the persisted cursor. Records decrypt client-side
  and flow through the **existing** trust boundary: trades via `importAll`→`addTrades` (content-hash
  union; F58 tombstones suppress resurrection), journal/trade-meta/meta **LWW by `updated`**, deletes
  applied via the store's delete methods (which write local tombstones). The remote-delete apply is
  **idempotent** (skip when already absent AND already tombstoned) so a delete can't ping-pong.
- **Write-behind.** Each local write bumps a debounced (1.5 s) incremental push that scans records
  with `updated >= watermark` (inclusive, so a same-ms write is never permanently skipped; the
  boundary re-push is a server LWW no-op). Cursor + pushed-watermark + the per-workspace enabled flag
  persist via the `Store.local` seam — **never a key** (keys live in memory only, dropped on lock).
- **Not synced: the CSV library (files).** `addFile` re-stamps `updated` on every import, so a synced
  file record can't converge to a fixed point the way content-hash trades do. Trades still carry
  their `fileIds`; a device lacking the file records just treats those trades as always-included.
  Deleting a file still propagates (its cascade emits **trade** tombstones, which sync).
  **Intentional consequence (A267):** because file records themselves don't sync, per-file
  *provenance / include-exclude state can DIVERGE across devices* — a file present (or excluded) on
  device A may be absent on device B. This is by design and harmless to the numbers: the **trades**
  (and their tombstones) sync, so every device computes identical metrics regardless of which file
  records it happens to hold.
- **Pauses gracefully.** Locked (`getIK()` null) or offline ⇒ sync pauses; a local write never blocks
  and never throws. The `WorkspaceSwitcher` affordance surfaces not-synced / synced (last pull) /
  syncing / offline / locked / error, an **Enable sync** action (cloud tier + unlocked only; local
  tier shows an inert "cloud tier required" hint), and re-prompts unlock via F61b's `UnlockModal`.
- **Tests.** `scripts/test-cloudsync.mjs` (node, in `test:unit`) proves convergence with the real
  crypto + the real F62 functions over a mock D1/R2 + two in-memory stores: A→B propagation, offline
  reconcile, delete-via-tombstone (no resurrection), the seq race survived by the full reconcile, and
  that **only ciphertext + blinded ids** cross the boundary.

## Fit with the guardrails

- **S25 / moat:** refined, not broken — see *The moat, stated precisely*. Compute stays local; egress is
  cloud-tier, opt-in, ciphertext-only.
- **A4 (Store seam):** honored — `CloudStore` is a `StoreLike`; no component touches `indexedDB` or the
  network directly.
- **Trust boundary:** every pulled record decrypts then flows through the existing `importAll`-class
  sanitizers (S15/S17/S20/A154) — same gate as a backup restore.
- **CSP / functions posture:** `/api/sync/*` fails closed without bindings, session + Origin gated,
  constant-time where it compares secrets — identical to F53–F55. **One CSP change (owner-approved
  2026-07-06):** `script-src` gains **`'wasm-unsafe-eval'`** so the Argon2id **wasm** can compile —
  this is wasm-specific and does **not** re-enable inline/eval JavaScript (`'unsafe-inline'`/
  `'unsafe-eval'` stay absent). `style-src 'self'` and the rest of the hardened header are unchanged.
- **Demo:** `DemoStore` (in-memory) is never a `cloud` store and never syncs — demo persistence stays
  impossible by construction.

## Not doing (and why)

- **Server-side merge / server-visible plaintext** — would break zero-knowledge; rejected by owner.
- **Whole-snapshot LWW** — a stale device's push clobbers another device's offline edits; rejected.
- **Cloud-primary store** — breaks offline and pulls compute toward the network; rejected.
- **Passphrase-as-sole-root** — replaced by the downloaded escrow recovery key (owner decision); a
  passphrase remains optional convenience / the no-PRF unlock path. Its strength floor (A264) is a
  length + basic-variety check (12+ chars, 2+ character classes) — deliberately not a zxcvbn
  dependency, and it does not touch the Argon2id cost (which would change every unlock's timing).
- **Version-bumping the sync backend on its own** — a change touching only `functions/**` (the
  `/api/sync/*` edge layer) bumps **neither** version track: `scripts/bump-version.mjs`'s
  `classifySurfaces` treats `functions/` as no-bump (it's the pinned edge layer, not a browser-served
  surface). This is intentional (A267) — the shipped client bundle is what versions track; a
  server-only change rides along with whatever client change ships next.
