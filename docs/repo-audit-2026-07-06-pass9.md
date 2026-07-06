# Repo audit — 2026-07-06 (R1 pass 9)

*Scope: the `claude/synced-workspaces-architecture` branch — the F58–F63 / A132 synced-workspaces
tier (end-to-end-encrypted cloud sync). The new surfaces: the client sync controller
(`src/app/lib/cloudsync.svelte.ts`), the pure merge core (`src/app/lib/cloudsync-core.ts`), the
`CloudStore` StoreLike wrapper (`src/app/lib/cloudstore.ts`), the vault / crypto
(`src/app/lib/vault.svelte.ts`, `src/lib/core/crypto.ts`), the tombstone + change-collection
additions to `src/lib/core/store.ts`, the `Entitlements.storeFor` seam
(`src/lib/core/entitlements.ts`), and the Worker sync API (`functions/api/sync/{push,pull,workspaces,wrapped-ik}.ts`
+ `functions/_lib/sync.ts` + `schema.sql`). Per the owner's standing instruction, extra security
attention on anything that crosses the wire. Read-only; every finding filed as a backlog item.
Baseline is green: `npm test` exits 0 (149 + 128 + 61 + 51 + 22 node assertions across the suites),
`npm run build` green, bundle 758.4 / 840.0 KiB with the crypto path lazily imported so it stays out
of the boot payload.*

## Verified clean

- **The moat holds — no trade-data egress.** Only opaque AES-GCM ciphertext, blinded record ids, and
  coarse timestamps/sequence numbers ever cross the wire. The Worker (`functions/api/sync/*`,
  `functions/_lib/sync.ts`) receives and stores encrypted blobs it cannot read; there is no
  server-side decrypt path and no plaintext trade field in any request body or D1 column. Cleartext
  compute stays local by construction.
- **Keys live in memory only; never persisted; zeroed after use.** The vault
  (`src/app/lib/vault.svelte.ts`) holds the derived identity key in a module-scoped variable, never
  writes it to IndexedDB/localStorage, and zero-fills the key material and the passphrase-derived
  bytes after wrapping/unwrapping. `crypto.ts` operations take `CryptoKey`s that are non-extractable
  where possible; nothing durable holds raw key bytes.
- **AES-GCM uses a fresh random IV per encryption**, HKDF provides **domain separation** (distinct
  `info` labels per derived subkey so the record key and the wrap key can never collide), and the
  passphrase KDF is **Argon2id, pinned with explicit params** (memory/iterations/parallelism) rather
  than defaulted.
- **Every `/api/sync/*` route is session-gated, Origin-checked, fail-closed, and owner-authorized.**
  Each mutating route resolves the session cookie first, runs `checkOrigin` (fail-closed on
  mismatch), 503s fail-closed when the D1 binding is absent, and scopes all reads/writes to the
  authenticated user's own workspaces. Cross-user probes return a **uniform 404** (no existence
  oracle). The Stripe webhook still verifies the signature over the **raw body first**, before any
  provisioning (unchanged from pass 8, guardrail S11).
- **CSP stays tight.** The only addition is a minimal `wasm-unsafe-eval` needed for the Argon2id WASM;
  `style-src 'self'` is unchanged and there is no new inline `style=""`.
- **F60 subscription lifecycle is correct and well-tested.** The Stripe subscription state machine
  (active / past_due / canceled / grace) resolves the cloud entitlement deterministically and is
  covered by the accounts suite.
- **Store seam (A4) honored; no merge/crypto re-implementation.** `CloudStore` is itself a `StoreLike`
  wrapping the local `Store` — no component or screen touches `indexedDB` or `fetch` directly. The
  merge logic lives once in `cloudsync-core.ts` and the crypto once in `crypto.ts` / `vault.svelte.ts`;
  nothing re-derives either.
- **Layering holds; runes-only, `any`-free, typecheck + lint clean.** The pure-logic core stays
  framework-agnostic; the sync controller is a `.svelte.ts` rune module prop-drilled per the house
  pattern. No `export let` / `$:` / `createEventDispatcher` / `svelte/store` writables; no `: any` /
  `as any` in the new code. `npm run typecheck`, `npm run lint`, `npm run format:check`, and the
  bundle-size gate are all green.

## Findings

### P1

- **A251 — Cross-workspace corruption when the active workspace is switched mid-sync.**
  `src/app/lib/cloudsync.svelte.ts` `runSync` (~248–287) captures a `workspaceId` + `keys` up front,
  then does multiple awaited push/pull round-trips through the **ambient** `Store` — whose active
  workspace can change via `switchWorkspace()` (`src/lib/core/store.ts` `setActiveWorkspace` ~921,
  reached from `src/app/lib/dashboard.svelte.ts:528`) between awaits, because `store.ts` keeps a
  single `dbp` DB-handle singleton (~144) that `setActiveWorkspace` re-points. Scenario: a sync for
  workspace A is in flight; the user switches to B; the in-flight `pullAndMerge` now writes A's
  decrypted records into B's IndexedDB, and the in-flight `pushChanges` uploads B's local rows under
  A's captured id + keys — silent bidirectional cross-workspace corruption. Untested (the node mock
  Store never exercises real switch semantics). Fix: snapshot + lock the active workspace for the
  duration of a `runSync` (abort/retry if it changed across an await), or block `switchWorkspace`
  while a sync is in flight, or thread a workspace-scoped store handle into `runSync` instead of
  reaching through the ambient singleton.

- **A252 — Clearing a note or trade-meta deletes the row WITHOUT a tombstone → the deletion never
  syncs and resurrects on the next reconcile.** `src/lib/core/store.ts` `saveJournal` empty branch
  (406–415, the `else store.delete(date)` at :413) and `saveTradeMeta` empty branch (486–496) issue a
  bare `store.delete` with no tombstone write — reached when a user clears the last text/tag/shot of a
  note (`dashboard.svelte.ts:553`) or empties a trade-meta record (`:344`). Because no tombstone is
  emitted, `collectChanges` reports nothing for the delete, the server keeps the stale row, and the
  next `since=0` reconcile re-upserts it locally — the cleared note/meta comes back. (The explicit
  `deleteJournal` / `deleteTradeMeta` paths DO tombstone, so this is specifically the clear-to-empty
  path.) Fix: route the empty branch through the same tombstoning delete used by
  `deleteJournal` / `deleteTradeMeta`, in the same transaction.

### P2

- **A253 — No server-side cloud-tier entitlement gate or storage quota on `/api/sync/*`.**
  `functions/api/sync/{push,pull,workspaces,wrapped-ik}.ts` (with the shared `upsertRecord` in
  `functions/_lib/sync.ts:141`) gate only on session + ownership + Origin. There is no
  `grantsCloud` / `subscriptionForUser` entitlement check and no per-user record/byte quota, so a
  free-tier session can push unbounded encrypted blobs — a paywall bypass and a storage-DoS / cost
  vector. Fix: add a server-side `grantsCloud` check on the mutating routes (push, wrapped-ik,
  workspace create) and enforce a per-user quota (record count + total bytes) in `upsertRecord`.

- **A254 — Synced-purge resurrection: `CloudStore.purge()` fires no notify and no controller resets
  cursors, so purged records re-download.** `src/app/lib/cloudstore.ts:124–126` clears local data +
  tombstones and pushes nothing; its comment claims the controller resets cursors on purge, but no
  purge / `data:erased` subscription exists in `cloudsync.svelte.ts` (130–142). The next `since=0`
  reconcile therefore re-downloads every record the user just purged. Fix: subscribe the controller to
  the erase event, reset `cursorKey` / `pushedKey` on purge, and decide explicitly whether purge
  should propagate deletes to the server or hard-block sync until re-enabled.

- **A255 — Trade tombstone suppression is unconditional while journal/trademeta/meta use LWW →
  cross-device non-convergence.** `src/lib/core/store.ts:223` (`suppressedByTombstone = !!tomb`)
  suppresses an incoming trade whenever ANY tombstone exists, but the merge core resolves the other
  stores by last-writer-wins (`cloudsync-core.ts:282`). Scenario: device A deletes trade T
  (tomb@100); device B, offline, enriches T (updated@200) and syncs; the server LWW replaces the
  delete with B's upsert; A pulls it but `addTrades` suppresses on the tomb@100 → A permanently lacks
  T while B has it — the two devices never converge. Fix: make trade merges LWW-consistent —
  `return !!tomb && tomb.updated >= (incoming.updated ?? 0)`. **Deliberate behavior change to call
  out:** this flips the current local "a delete always wins over a re-import" default to LWW, so a
  newer re-import can now resurrect a deleted trade. That is the required trade-off for convergence;
  the owner should sign off, and the F58 comment at store.ts:218–222 (which documents the flip as a
  one-liner) should be updated to reflect the decision.

- **A256 — Dead `storeFor` tier seam; store selection keys off the surface flag, not the resolved
  tier.** `src/lib/core/entitlements.ts:51–55` ignores its argument (`void tier; return Store`), and
  `App.svelte:95–96` hardcodes `storeFor('local')` then layers `CloudStore` via `wrapStore` gated on
  `isStaging`. The design intent (`storeFor('cloud') → CloudStore`) is unrealized, so a cloud-tier
  **prod** user would get no `CloudStore` at all. Fix: have `storeFor` return the wrapped `CloudStore`
  for `'cloud'`, and have `App` select on the resolved entitlement tier rather than `isStaging` — a
  natural part of the CH16 promotion of this feature.

- **A257 — `cloudSync.unlocked` / `status` left stale after unlocking from the Account screen.**
  `src/app/screens/Account.svelte:467` renders `<UnlockModal>` with NO `onunlocked` handler, whereas
  `WorkspaceSwitcher.svelte:271–277` wires `onunlocked={onSyncUnlocked}` + a refresh. Unlocking the
  vault from the Account screen therefore leaves `cloudSync.status` stuck at `'locked'` until some
  other event refreshes it. Fix: pass `onunlocked={() => onSyncUnlocked()}` on the Account-screen
  `UnlockModal` to match the switcher.

- **A258 — Coverage gap: no real-Store / real-server sync round-trip; the node mock diverges from the
  real Store and masked A251/A252/A255.** `scripts/test-cloudsync.mjs:150–199` uses a hand-mock Store
  that never exercises delete-on-empty or the real `addTrades` tombstone/enrich path, and
  `playwright.config.mjs` serves static `dist/` with no Functions — so the merge core is tested in
  isolation but the real persistence + real endpoint interactions never run. Fix: add a node
  integration test that runs `mergeRecords` / `pullAndMerge` against the REAL `Store` on
  `fake-indexeddb` (including the empty-clear delete path and `updateTrade` enrich), and/or a
  miniflare-backed e2e that does a genuine push→pull round-trip against the Worker.

### P3

- **A259 — Dead/contradictory "Synced workspaces — coming later" card + stale header comment
  (Account.svelte).** `src/app/screens/Account.svelte:470–482` still renders a legacy
  "coming later" card (and a stale header comment) even though synced workspaces now exist behind the
  vault — it contradicts the shipped feature and renders on all surfaces. Remove the dead card + fix
  the comment.

- **A260 — `importAll` drops `updated` for the `setup` / `savedFilters` meta rows → re-merge churn.**
  `src/lib/core/store.ts:764–765` restores these meta records without their `updated` timestamp, so
  every reconcile treats them as newly changed and re-pushes/re-pulls them. Fix: preserve `updated`
  through `importAll` for the meta rows.

- **A261 — Seq-assignment race hardening in `upsertRecord`.** `functions/_lib/sync.ts:101` assigns a
  record sequence with a non-atomic read-then-write, so two concurrent pushes can collide on a seq.
  Mitigated today because the client does a `since=0` full reconcile on session start, but a
  long-lived tab syncing incrementally can miss a colliding-seq record until a reload. Fix: assign the
  sequence atomically (`MAX(seq)+1` in the write, a per-workspace counter row, or a periodic full
  reconcile trigger).

- **A262 — Sync-client type-safety nits (batch).** Fold three small ones: (1) the method-string cast
  without a runtime guard at `src/app/lib/vault.svelte.ts:133`; (2) the `pull` return mistyped as
  `records: []` where it should be `PullPage` at `src/app/lib/cloudsync.svelte.ts:105`; (3) the
  duplicated `base64UrlToBytes` at `vault.svelte.ts:263–269` that should import the one in
  `src/lib/core/crypto.ts`. Add the guard, fix the type, dedupe the helper.

- **A263 — Poison-pill: one undecryptable record wedges the entire pull.** `cloudsync-core.ts:306–323`
  decrypts pulled records in a loop with no per-record isolation, so a single corrupt/undecryptable
  blob throws and aborts the whole `pullAndMerge` — sync stays broken until that record is gone. Fix:
  wrap per-record decrypt/merge in try/catch, skip + surface the bad record, and continue the batch.

- **A264 — Passphrase is offline-crackable if the wrapped IK leaks; no UI strength floor.** The
  `wrapped-ik.ts` GET returns the passphrase-wrapped identity key, and `crypto.ts:50` sets the
  Argon2id cost — an attacker who obtains the wrapped blob can grind the passphrase offline. Fix: add a
  client-side passphrase-strength floor (zxcvbn-style min) at set-time and/or raise the Argon2id
  params, and document the residual risk.

- **A265 — Unbounded `webhook_events` / tombstone growth (no TTL or compaction).** `schema.sql`
  accumulates `webhook_events` rows and per-record tombstones forever. Fix: add a TTL / periodic
  compaction (tombstones can be dropped once every device has reconciled past their seq; webhook
  events after the replay window).

- **A266 — Dunning grace window resets on each `invoice.payment_failed` retry.** `functions/api/me.ts:49`
  recomputes the grace deadline off the latest failure, so each Stripe retry restarts the 3-day
  window and can stretch the effective grace to the full retry span. Fix: clamp the grace to the
  first-failure timestamp (or document that the retry-span behavior is intended).

- **A267 — Doc-only: CSV-file deletion provenance divergence and functions-only version-bump gaps.**
  Two documentation items: (1) CSV file records are not synced and `fileIds` merge union-only, so
  deleting a CSV on one device leaves stale provenance on another — document the intended behavior in
  the data-flow / architecture docs. (2) `scripts/bump-version.mjs:97` classifies a functions-only
  change into neither version track, so a pure-Worker change bumps nothing — flag whether that is
  desired and document it.

- **A268 — Stale sync comments (batch).** Two comment fixes: the dead encrypted-workspace-name branch
  at `functions/api/sync/workspaces.ts:82–85` (the client never sends `name`, so the branch is
  unreachable — remove it or note it as reserved), and the stale `'passkey'` comment at
  `functions/_lib/sync.ts:60` where the actual wire value is `prf`.

## Disposition

Two P1s (both convergence/corruption bugs on the new sync path — A251 mid-sync workspace switch, A252
untombstoned clear-to-empty), six P2s (a server-side entitlement/quota gap, purge resurrection, a
trade-vs-LWW convergence mismatch, the dead `storeFor` seam, a stale Account-unlock status, and the
integration-test coverage gap that masked the P1s), and ten P3s. The crypto and egress posture is
sound — the findings are in the merge/lifecycle/entitlement wiring around it, not the cryptography.
Findings filed as new backlog items A251–A268. R1 stays open (recurring).
</content>
