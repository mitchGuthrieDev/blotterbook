# Cloud-sync UX rework (A279)

_Design note — 2026-07-07. Live on prod + staging (opt-in, `cloud`-tier; the sync engine runs behind
`cloudSync.configured`, true on every non-demo surface — CH16, 2026-07-07). Demo never syncs. Reference
model: Obsidian Sync's status-pill + explicit sync._

## Problem

The pre-rework cloud-sync UX was **lock-centric** and never told the user whether their data was
actually in parity with the cloud:

- **WorkspaceSwitcher row** offered "Unlock to enable sync" / "Unlock to sync" / "Sync now" with a
  raw status label.
- **UnlockModal** was titled "Unlock cloud sync".
- **Account card** toggled "Locked → Unlock" ⇄ "Unlocked this session → Lock".

Three problems (from the A279 backlog item):

1. "Lock/Unlock" is vague — it doesn't convey sync state.
2. No explicit direction control (push my version up vs. pull the cloud down).
3. The **passkey vs. passphrase/recovery-key** relationship is never explained — users don't know
   which secret does what.

## Model

Two independent concepts, now named distinctly in-app:

| Concept | Secret | What it does | Where |
|---|---|---|---|
| **Sign in** | passkey (WebAuthn) | proves identity to the server | account/login flow |
| **Unlock encryption** | passphrase / recovery key (or a PRF passkey) | turns synced ciphertext back into plaintext **in the browser** | UnlockModal |

The server is zero-knowledge: it holds identity + ciphertext, never the encryption key. A PRF-capable
passkey can do **both** (sign in *and* unlock) — that dual role was the main source of confusion, so
it's called out explicitly.

### Parity pill (`SyncStatusPill.svelte`)

One shared component reads the reactive `cloudSync` rune via `syncPillState()` and renders the active
workspace's state. States are **locally derived** — no new server endpoint, no polling (the chosen
option): a `behind` cloud is auto-resolved by the existing focus/online/unlock pull, so the pill only
needs states the client already knows:

| State | Meaning | Tone |
|---|---|---|
| `off` | workspace not opted into sync | muted |
| `needs-unlock` | enabled, but the E2E key isn't in memory this session | chart-4 |
| `offline` | enabled + unlocked, no network | muted |
| `syncing` | a sync/push is in flight | muted (spinner) |
| `pending` | local edits not yet pushed (`cloudSync.pending`) | chart-4 |
| `synced` | in parity — "In sync · 2m ago" | chart-2 |
| `error` | last sync failed | destructive |

`cloudSync.pending` is set on every local write to an enabled workspace (even offline/locked, since the
edit is still owed to the cloud) and cleared when a push/sync completes.

### Direction controls (honest LWW)

The engine merges by last-writer-wins / content-hash. Rather than a destructive "force this device
wins" override (the rejected option — it can clobber another device's newer edits), the direction
controls run the **existing merge one direction** and the copy states the rule plainly: _"When two
devices differ, the newest edit of each record wins."_

- **Sync now** — full reconcile (pull then push). The everyday action.
- **Pull from cloud** — `runSync({ direction: 'pull' })` — pull + merge only.
- **Push to cloud** — `runSync({ direction: 'push', forceFullPush: true })` — re-upload every local
  record (watermark reset to -1), no pull. Still LWW per record.
- **Pause sync** — `pauseCloudSync()` — stop syncing this workspace without erasing its cloud copy
  (that's the separate A254 purge path); reversible via re-enable.

## Surfaces

- **WorkspaceSwitcher** (sidebar) stays minimal: the pill + a single **Sync now** (or "Unlock to
  sync" when the key is locked). Less obtrusive — the power actions moved off it.
- **Account → Cloud sync card** is the hub: the pill + Sync now + Pull/Push/Pause, the
  "How sign-in and encryption relate" explainer, and the encryption-key management (setup, passphrase,
  passkey, regenerate recovery key). The E2E **Lock/Unlock** of the key stays here (it's a real
  operation) but is now framed as "encryption," not "sync".

## Engine changes (`cloudsync.svelte.ts`)

- `cloudSync.pending` added; set on write, cleared on push/sync success.
- `syncPillState()` + `SyncPill` type — the shared pill derivation.
- `runSync` gained `direction: 'both' | 'pull' | 'push'` and `forceFullPush`; the default `'both'`
  path is behaviour-preserving.
- New exports: `pullFromCloud()`, `pushToCloud()`, `pauseCloudSync()`.

## What was explicitly NOT built

- **Server-side "behind" detection** — deferred (would need a cheap count-since-cursor endpoint +
  polling). The focus/online/unlock pull already keeps devices current.
- **A force "this device is the source of truth" override** — rejected as clobber-prone; the honest
  LWW push/pull covers the intent without a destructive path.
