# Repo audit — 2026-07-07 (R1 pass 2 — auth / accounts / vault-sync / sync-UX / structure)

*A five-dimension deep audit run via five parallel read-only agents, each adversarially verifying every
finding against source before reporting: (1) authentication, (2) user management / account lifecycle,
(3) vault + cloud-sync architecture, (4) cloud-sync UX behaviour, (5) project structure / repo hygiene.
Findings were then cross-checked in synthesis (two items were independently reported by two agents,
raising confidence). This pass went DEEPER than the earlier route-enforcement audits
(docs/audit-a277-server-enforcement.md, docs/repo-audit-2026-07-07.md), which verified the perimeter is
sound — the perimeter still holds; the findings here are in ceremony correctness, sync data-model
semantics, subscription-lifecycle edge cases, and multi-device UX. Read-only; every finding filed as a
backlog item (A297–A314); R1 stays open (recurring). Baseline green before the pass (npm test + e2e).*

## Headline

The zero-knowledge perimeter, WebAuthn crypto, session-cookie posture, admin auth, seq atomicity, and
R2/D1 consistency are all **verified clean** (details at the bottom). The real exposure is in three
places: the **sync data model** (a trade-`updated` merge bug that echoes + can resurrect deletes; no
multi-device path for named workspaces; global-not-per-workspace UI state), the **account recovery
story** (unreachable behind the prod login gate; no way to revoke a stolen passkey), and the
**subscription lifecycle** (over-grants past the dunning grace; no webhook ordering guard). Four P1s.

## P1 — correctness / lockout (filed A297–A300)

- **A297 — Pulled trades are re-stamped with a fresh local `updated`, causing a guaranteed re-push echo
  + a delete-resurrection race.** `store.ts:407,394` stamp `updated = Date.now()` on merged trades,
  unlike journal/meta/trademeta which preserve the incoming clock (A260). Because `runSync` pulls then
  pushes, every reconcile re-uploads every trade it just pulled (N devices → each trade rewritten N×,
  needless R2/D1 churn), and a delete made while a peer is mid-pull can be dropped as stale and
  **resurrect on the deleting device**. Fix: preserve an incoming `updated` in `addTrades`; stamp
  `Date.now()` only for clockless CSV rows.
- **A298 — Named (non-Default) synced workspaces are unreachable on a second device (+ re-creating one
  mints a divergent duplicate DEK).** Only `DEFAULT_WS_ID='default'` is stable cross-device; created
  workspaces get a per-device `randomUUID()` (`store.ts:943`), and nothing turns a server-registered
  workspace into a local one. Device B sees no trace of workspace "Futures"; if the user recreates it +
  Enable sync, `enableCloudSync` finds no match and registers a **second** server workspace under a new
  DEK (`cloudsync.svelte.ts:319-335`). The advertised multi-device story only works for Default. Fix: an
  "adopt from cloud" flow (list server workspaces absent locally, register with the server's id).
- **A299 — Sync `status`/`pending`/`error` are global, not per-workspace, so the pill lies after a
  workspace switch — including a mid-sync switch that leaves a perpetual spinner with no escape.**
  `refreshSyncStatus` never resets `pending`/`error` and only upgrades `status` (`cloudsync.svelte.ts:278`).
  Also folds the A279 regression where `runSync` clears `pending` unconditionally even for `direction:'pull'`
  (`:406`) → "In sync" while local edits are un-pushed. Fix: scope pending/error per wsId; fully re-derive
  status on switch; `if (plan.push) pending=false`.
- **A300 — Passkey recovery is unreachable behind the prod login gate → permanent lockout.**
  `ACCOUNT_GATE` armed on prod (CH16) renders `LaunchGate` instead of the app; LaunchGate has no "lost
  passkey" path, and the emailed `?recover=` token is only handled by `Account.svelte`'s `onMount`, which
  never mounts behind the gate — the 15-min token just expires. A user who loses their passkey has no way
  back. Fix: add the recover-send form to LaunchGate and handle `?recover=` pre-gate.

## P2 — security / lifecycle / UX (filed A301–A309)

- **A301 — The 5-per-5-min rate limit is discarded on both email-sending endpoints** (`email-verify-send.ts:23`,
  `recover-send.ts:25` call `await rateLimited(...)` and drop the boolean) → unbounded recovery/verify
  email-bombing + Resend cost burn + unlimited live recovery tokens. `recover-verify.ts` has no limiter
  at all. *(Independently reported by the auth and user-mgmt agents.)* One-line fix per sibling routes.
- **A302 — No passkey/session revocation: recovery leaves the lost passkey + all sessions valid, and
  there's no credential-delete endpoint anywhere.** A stolen device is unrecoverable. Add session
  absolute-cap (today sessions slide forever). Fix: delete-credential endpoint + revoke-on-recovery +
  a 90-day absolute session cap. *(Independently reported by two agents.)*
- **A303 — Subscription entitlement lifecycle bugs.** (a) `grantsCloud` grants whenever `now <
  current_period_end` regardless of `status` (`accounts.ts:458`), so a `past_due`/`unpaid` user keeps
  cloud for the whole unpaid month (the dunning grace is dead); (b) the webhook has no out-of-order guard
  (`event.created` never compared) — a delayed `subscription.updated` after `subscription.deleted`
  resurrects a canceled sub permanently; (c) subscription-mode `checkout.session.completed` is credited
  as a donation (`webhook.ts:117`). Fix: status-gate the grace; compare `event.created`; skip donation
  crediting for `mode==='subscription'`.
- **A304 — Concurrent enable on one workspace overwrites the first device's wrapped DEK** (`workspaces.ts:83-95`
  unconditionally `UPDATE ... SET wrapped_dek`), stranding already-pushed ciphertext undecryptable. Fix:
  first-writer-wins register (INSERT-or-return-existing; client adopts on conflict; the IK never rotates,
  so there's no legitimate wrapped-DEK update).
- **A305 — No account-deletion path (GDPR posture) + a manual delete orphans rows and R2 blobs.**
  `donations.user_id`/`recovery_tokens.user_id` have no FK and `sync_records.workspace_id` is a
  comment-only reference; a D1 cascade can't clean R2 anyway. Fix: an authed `/api/account/delete` that
  pages `deleteWorkspacePage` per workspace then deletes the user; add the missing FKs.
- **A306 — Sync error/lifecycle UX shows raw status codes and dead-end states.** The pill renders literal
  "Push failed (413)."/"(401)."/"(403)." (`messageOf` passes `Error.message` through); a lapsed
  subscription 403s in the switcher while the Account card flips to the first-time "Subscribe" CTA (as if
  never synced); Pause is indistinguishable from never-synced with no Resume on the Account panel; a
  transient `/api/me` failure mislabels a paying user "cloud tier required". Fix: map 401/402/403/413/5xx
  to actionable copy at the transport; add enabled-but-not-entitled + paused pill states + a Resume
  control; neutral "checking…" while `tier===''`.
- **A307 — Workspace-switch barrier hole: `mergeRecords` is abort-blind, so an overlapping `runSync` can
  write workspace A's records into workspace B's DB.** `runSync` has no concurrency gate and overwrites
  `inFlight`; the last abort check is before `mergeRecords`, which then does many awaited writes against
  the active-DB singleton. Fix: thread `shouldAbort` into `mergeRecords` (re-check before the write
  phase) and chain `inFlight = inFlight.then(...)`.
- **A308 — Encrypted records carry no AAD, so index metadata (`deleted`/`updated`/`type`) is
  unauthenticated.** A server that can WRITE D1 (not just read the dump) can flip `deleted=1` + bump
  `updated` to force a fleet-wide delete, or replay a stale `updated` to skew LWW. Beyond the stated
  confidentiality threat model but a cheap standard fix. Fix: AAD = `workspaceId|type|blinded_id|updated|
  deleted`, or carry updated/deleted inside the authenticated plaintext and assert equality on pull.
- **A309 — Long-offline (>90d) device is stranded by tombstone compaction, and the erase-on-one-device
  path leaves other devices 404-looping.** After compaction a returning device neither re-pulls the
  tombstone nor re-pushes the trade (its watermark is past it) → permanent silent divergence (the doc's
  "re-adds on next push" is wrong). Separately, deleting a workspace shell leaves peers pushing/pulling
  into a 404 with an opaque error. Fix: reset the watermark to −1 when the offline gap exceeds the TTL;
  treat a 404 on an enabled workspace as "server copy gone" → auto-disable + notify + drop the cached key.

## P3 — hardening / polish / docs (filed A310–A314)

- **A310 — Auth hardening batch:** require UV on the PRF/cloud-enroll path (today `requireUserVerification:
  false` everywhere); handle unverified-email account squatting (a TTL purge or a proven-ownership
  reclaim — today it permanently blocks the real owner from signup AND recovery); wrap the check-then-
  insert register races (`ON CONFLICT`); note `destroySession` deletes by id without a secret check.
- **A311 — Sync UX/vault polish batch:** `fmtAgo` never ages (no reactive clock — add a ~30s tick);
  hoist the passkey-vs-passphrase explainer + pill out of the `vault.unlocked` branch so a locked user
  can see them; correct the "newest edit wins" copy for trades (they're content-hash *combined*, never
  overwritten); have `lock()` drop the derived per-workspace keys + abort in-flight sync (today lazy);
  zero the PRF secret + Argon2id output `Uint8Array`s after use.
- **A312 — A279 sync state-machine test coverage:** every `syncPillState()` transition, the `pending`
  lifecycle, `pauseCloudSync`, and the `cloud-pull`/`cloud-push`/`cloud-pause`/`cloud-sync-now` buttons
  have zero assertions; the rune controller isn't node-importable, so add e2e (drive the surfaces) or
  extract more pure helpers to node-test.
- **A313 — Docs drift sweep:** cloud sync is still called "staging-gated" in 8 passages
  (`functions/README.md:3,7,22`, `docs/architecture.md:64,592`, `docs/data-flow.md:18,152,182`); "the 9
  node suites" is really 17 (`CLAUDE.md:107,418`, `ci.yml:73`); `econ.svelte.ts`/`econ-events.json`/
  `build-econ-events.mjs` and `modlayout.ts` are undocumented; the `parts/` list names a ghost
  (`Definitions`, retired A242) and omits `InfoTip`/`StatCardRow`; the Account-surface claim + a stale
  `App.svelte:110` comment; three CI-load-bearing scripts (`check-deploy-contract`/`check-mermaid`/
  `build-econ-events`) undocumented.
- **A314 — Repo hygiene:** relocate the pure `cloudsync-core.ts` from `src/app/lib` to `src/lib/core`
  (it's framework-agnostic + node-tested across the boundary; would gain strict `tsc` coverage); move
  `phosphor-svelte` to devDependencies (only the dev styleguide imports it); un-export dead `versionsReady`
  + fix its `widgets.js` comment (file deleted in A33); refresh the stale pre-cutover header in
  `e2e/staging-redesign.spec.mjs`.

## Verified clean (recorded so future passes don't re-litigate)

- **WebAuthn + session crypto:** `__Host-` cookie (HttpOnly/Secure/SameSite=Lax/Path=/), 32-byte secret
  with only SHA-256 stored + constant-time compare + verify-before-slide; single-use TTL'd type-bound
  challenges; simplewebauthn verifies challenge/origin/rpIdHash, counter regression throws + persists;
  recovery tokens 16B id+32B secret, single-use, wrong-secret-doesn't-burn; admin Access-JWT pins RS256 +
  exp/iss/aud/JWKS + fail-closed; every mutating route Origin-checked + fail-closed. No session fixation.
- **Envelope crypto:** IK/KEK extractability minimal + zeroed unwrap windows; HKDF domain separation;
  Argon2id 64 MiB/t3/p1 with params-in-blob (no downgrade-extraction); fresh per-record IV; wrap-format
  versioned; recovery-key regen keeps IK stable so wrapped-DEKs never stale.
- **Server sync integrity:** `MAX(seq)+1` atomic under D1 single-writer; unique seqs → no pull-paging
  boundary loss; deterministic `ciphertext_ref` → no orphan blobs; delete paging exact; owner-scoped
  uniform 404s; cloud-tier write gate with the correct read/erase asymmetry for lapsed accounts; push cap
  client 12 = server 12 (A281); crash-between-push-and-watermark is a safe LWW re-drop.
- **Accounts lifecycle:** email trim+lower+UNIQUE; webhook signature-verified + event-id idempotent +
  `past_due_since` anchoring (A266) + swept ledger (A265); checkout linkage via client_reference_id/metadata;
  S25 holds (no trade data in D1). Demo never wraps the store.
- **Structure:** tsconfig union covers every `.ts`; ESLint covers the repo; vite entries match; CI runs a
  strict superset of `npm test` + a self-gating version-classification check; bundle 768/840 KiB.
- **Sync UX flows that ARE coherent:** first-time setup (no stranding), Default-workspace device-B adopt,
  "Sync now" semantics consistent across surfaces, enable-while-locked opens the unlock modal, the A251
  switch barrier is wired, the Account card's 6-branch state machine has no unreachable branch.
