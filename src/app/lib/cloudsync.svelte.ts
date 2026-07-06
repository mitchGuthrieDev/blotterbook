/* Blotterbook · cloud-sync CONTROLLER (F63 — synced workspaces, step 6). The reactive ($state) glue
 * over the pure engine in cloudsync-core.ts. Owns:
 *   · the per-active-workspace SYNC STATUS the WorkspaceSwitcher affordance renders,
 *   · the DEBOUNCED write-behind push (scheduled by the CloudStore's onWrite),
 *   · the FULL-reconcile-then-incremental pull on enable / unlock / focus / reconnect,
 *   · the per-workspace opt-in (mint+register a DEK, or adopt the server's) and the in-memory
 *     per-workspace keys (derived from the DEK; never persisted — only the cursor + enabled flag are).
 *
 * STAGING-GATED + CLOUD-TIER + OPT-IN by construction: App.svelte only wraps the Store in a CloudStore
 * and calls configureCloudSync() on the staging surface; enabling sync needs `tier === 'cloud'` and an
 * UNLOCKED account IK (F61b); demo never wraps the Store, so it never syncs. When the IK is locked or
 * the browser is offline, sync PAUSES gracefully — a local write never blocks and never throws.
 *
 * MOAT (S25): reads always hit the local Store (offline-first — the network is never on the read
 * path); the only egress is opaque ciphertext + blinded ids + timestamps (cloudsync-core). */

import type { StoreLike } from '../../lib/core/types.ts';
import { Entitlements, type Tier } from '../../lib/core/entitlements.ts';
import { getIK } from './vault.svelte.ts';
import { createCloudStore } from './cloudstore.ts';
import {
  pushChanges,
  pullAndMerge,
  deriveWsKeys,
  parseWrappedDek,
  type SyncTransport,
  type WireRecord,
  type WsKeys,
  type PullPage,
} from './cloudsync-core.ts';
import { onEvent } from '../../lib/core/core.ts';

type SyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'locked' | 'error';

/** Shared reactive sync state for the ACTIVE workspace — read anywhere, mutate only via the actions. */
export const cloudSync = $state({
  /** configureCloudSync() has run (staging only) — gate the affordance on this. */
  configured: false,
  /** entitlement tier from /api/me ('' until probed). Enabling sync needs 'cloud'. */
  tier: '' as '' | Tier,
  /** the active workspace's id + name (mirrors Store.activeWorkspace). */
  wsId: '',
  wsName: '',
  /** the active workspace is opted into sync. */
  enabled: false,
  /** the account IK is unlocked in memory (mirrors vault). */
  unlocked: false,
  online: true,
  status: 'off' as SyncStatus,
  /** epoch ms of the last successful pull-merge (0 = never this session). */
  lastPull: 0,
  /** an enable/sync op is in flight. */
  busy: false,
  error: '',
});

const DEBOUNCE_MS = 1500;

/* ── module refs + in-memory per-workspace key sessions (never persisted) ──────────────────────── */
let localStore: StoreLike | null = null;
let dashRef: { reload(): Promise<void> } | null = null;
const sessions = new Map<string, WsKeys>(); // wsId → { recordKey, blindKey } — dropped on lock
const reconciled = new Set<string>(); // wsIds that have had their FULL since=0 reconcile this session

/* ── A251: workspace-switch barrier — a switch must NEVER read/write one workspace's records under
 * another's identity. TWO layers: (a) `cancelActiveSync()` (awaited by dashboard.switchWorkspace /
 * removeWorkspace BEFORE `store.setActiveWorkspace`) aborts + awaits the in-flight op so the active
 * workspace only flips once no sync is in flight; (b) every runSync/runPush captures the sync
 * `generation` + its workspace id and re-checks it (via `shouldAbort` threaded into pushChanges/
 * pullAndMerge) before each store read/write batch, aborting with the cursor/watermark UNADVANCED if
 * it changed. Bumping `syncGeneration` aborts any run started before the bump; `inFlight` is the
 * promise a switch awaits. No deadlock: aborts land between network round-trips, so `inFlight`
 * settles promptly. */
let syncGeneration = 0;
let inFlight: Promise<void> = Promise.resolve();

/** Cancel + await any in-flight sync / debounced push for the current workspace. The dashboard awaits
 *  this BEFORE flipping the active workspace (A251). Never throws. */
export async function cancelActiveSync(): Promise<void> {
  syncGeneration++; // abort any run captured under an earlier generation
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  dirtyDuringPush = false;
  try {
    await inFlight;
  } catch {
    /* an aborted/failed in-flight run must never reject into the switch path */
  }
}

/* ── Store.local persistence (cursor + enabled flag only — NEVER a key; F63 uses the seam, not IDB) */
const enabledKey = (id: string) => `bb:sync:${id}:on`;
const cursorKey = (id: string) => `bb:sync:${id}:cursor`;
const pushedKey = (id: string) => `bb:sync:${id}:pushed`;

const onLine = () => typeof navigator === 'undefined' || navigator.onLine;
const activeId = () => (localStore ? localStore.activeWorkspace().id : '');
const isEnabled = (id: string) => !!localStore?.local.get(enabledKey(id), false);
const messageOf = (e: unknown) => (e instanceof Error ? e.message || 'Sync failed.' : 'Sync failed.');

/* ── the F62 transport (real fetch; session-cookie carried) ────────────────────────────────────── */
const transport: SyncTransport = {
  async listWorkspaces() {
    const res = await fetch('/api/sync/workspaces', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Could not list synced workspaces (${res.status}).`);
    const data = (await res.json()) as { workspaces?: Array<{ workspace_id: string; wrapped_dek: string | null }> };
    return data.workspaces ?? [];
  },
  async registerWorkspace(workspaceId, wrappedDek) {
    const res = await fetch('/api/sync/workspaces', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, wrapped_dek: wrappedDek }),
    });
    if (!res.ok) throw new Error(`Could not enable sync for this workspace (${res.status}).`);
  },
  async push(workspaceId, records: WireRecord[]) {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, records }),
    });
    if (!res.ok) throw new Error(`Push failed (${res.status}).`);
  },
  async pull(workspaceId, since) {
    const res = await fetch(`/api/sync/pull?workspace_id=${encodeURIComponent(workspaceId)}&since=${since}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Pull failed (${res.status}).`);
    return (await res.json()) as PullPage;
  },
};

/* ── CloudStore wiring (called at App.svelte module init, staging only) ────────────────────────── */

/** Wrap the local Store so writes schedule a debounced push. Called ONLY on staging; demo/prod use
 *  the plain Store and never reach this. */
export function wrapStore(local: StoreLike): StoreLike {
  localStore = local;
  return createCloudStore(local, onLocalWrite);
}

/** Configure the controller after boot (staging only): probe the tier, wire connectivity/focus
 *  listeners, and settle the active workspace's status. Never throws. */
export function configureCloudSync(opts: { localStore: StoreLike; dash: { reload(): Promise<void> } }): void {
  localStore = opts.localStore;
  dashRef = opts.dash;
  cloudSync.configured = true;
  void Entitlements.current()
    .then(e => {
      cloudSync.tier = e.tier;
      refreshSyncStatus();
    })
    .catch(() => {});
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      cloudSync.online = true;
      void syncActiveWorkspace({ full: true }); // reconnect → a full reconcile closes the seq race
    });
    window.addEventListener('offline', () => {
      cloudSync.online = false;
      refreshSyncStatus();
    });
    window.addEventListener('focus', () => void syncActiveWorkspace());
  }
  // A254: a local "erase all data" (purge) of the active workspace must DISABLE its sync + reset its
  // cursor/watermark, or the next since=0 reconcile re-downloads everything the user just purged.
  onEvent('data:erased', () => onErased());
  refreshSyncStatus();
}

/** A254: after a local purge of the active workspace, stop it re-downloading on the next reconcile —
 *  DISABLE sync for it and reset its cursor + pushed-watermark. This is the safe client-side stop;
 *  propagating the erase to the server as record deletions (so OTHER devices also drop the data) is a
 *  filed follow-up, out of `src/` scope here. */
function onErased(): void {
  if (!localStore) return;
  syncGeneration++; // abort any in-flight run + neutralize a pending debounced push for this workspace
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  dirtyDuringPush = false;
  const id = localStore.activeWorkspace().id;
  localStore.local.set(enabledKey(id), false); // opt-out: no reconcile until the user re-enables
  localStore.local.remove(cursorKey(id));
  localStore.local.remove(pushedKey(id));
  sessions.delete(id);
  reconciled.delete(id);
  refreshSyncStatus();
}

/* ── status ────────────────────────────────────────────────────────────────────────────────────── */

/** Recompute the active workspace's status. When enabled + online + unlocked but no key session is
 *  loaded yet, kick a full reconcile (the on-unlock / on-switch entry point). */
export function refreshSyncStatus(): void {
  if (!cloudSync.configured || !localStore) return;
  const ws = localStore.activeWorkspace();
  cloudSync.wsId = ws.id;
  cloudSync.wsName = ws.name;
  cloudSync.online = onLine();
  cloudSync.unlocked = getIK() !== null;
  cloudSync.enabled = isEnabled(ws.id);
  if (!cloudSync.enabled) {
    cloudSync.status = 'off';
    return;
  }
  if (!cloudSync.online) {
    cloudSync.status = 'offline';
    return;
  }
  if (!getIK()) {
    // Locked: drop any derived keys so a write can't sync while the account is locked.
    if (sessions.size) sessions.clear();
    reconciled.clear();
    cloudSync.status = 'locked';
    return;
  }
  if (!sessions.has(ws.id)) {
    void syncActiveWorkspace({ full: true });
  } else if (cloudSync.status === 'off' || cloudSync.status === 'locked' || cloudSync.status === 'offline') {
    cloudSync.status = 'synced';
  }
}

/* ── key session (derive per-workspace keys from the DEK; needs the unlocked IK) ────────────────── */
async function ensureKeys(id: string): Promise<WsKeys | null> {
  const cached = sessions.get(id);
  if (cached) return cached;
  const ik = getIK();
  if (!ik) return null; // locked
  const list = await transport.listWorkspaces();
  const entry = list.find(w => w.workspace_id === id);
  const blob = parseWrappedDek(entry?.wrapped_dek ?? null);
  if (!blob) return null; // registered on no device yet
  const { unwrapDekBytes } = await import('../../lib/core/crypto.ts');
  const bytes = await unwrapDekBytes(blob, ik);
  const keys = await deriveWsKeys(bytes);
  bytes.fill(0);
  sessions.set(id, keys);
  return keys;
}

/* ── enable a workspace (opt-in): mint+register a DEK, or adopt the server's (another device) ────── */

/** Turn sync ON for the active workspace. Requires cloud tier + an unlocked IK (else it flips status
 *  to 'locked' so the caller can prompt unlock). Registers the per-workspace DEK (wrapped under the
 *  IK) and runs the first full reconcile + push. */
export async function enableCloudSync(): Promise<boolean> {
  if (cloudSync.busy || !localStore) return false;
  const id = activeId();
  cloudSync.busy = true;
  cloudSync.error = '';
  try {
    if (cloudSync.tier !== 'cloud') throw new Error('Cloud tier required to sync.');
    const ik = getIK();
    if (!ik) {
      cloudSync.status = 'locked';
      return false; // caller opens the unlock modal
    }
    const crypto = await import('../../lib/core/crypto.ts');
    const list = await transport.listWorkspaces();
    const entry = list.find(w => w.workspace_id === id);
    const existingBlob = parseWrappedDek(entry?.wrapped_dek ?? null);
    let keys: WsKeys;
    if (existingBlob) {
      // Another device already registered this workspace — adopt its DEK.
      const bytes = await crypto.unwrapDekBytes(existingBlob, ik);
      keys = await deriveWsKeys(bytes);
      bytes.fill(0);
    } else {
      const dek = await crypto.genWorkspaceDek();
      const bytes = await crypto.dekBytesOf(dek);
      const wrapped = await crypto.wrapDek(dek, ik);
      await transport.registerWorkspace(id, JSON.stringify(wrapped));
      keys = await deriveWsKeys(bytes);
      bytes.fill(0);
    }
    sessions.set(id, keys);
    localStore.local.set(enabledKey(id), true);
    localStore.local.set(pushedKey(id), -1); // full push next
    localStore.local.set(cursorKey(id), 0);
    await runSync({ full: true, id });
    return true;
  } catch (e) {
    cloudSync.error = messageOf(e);
    cloudSync.status = 'error';
    return false;
  } finally {
    cloudSync.busy = false;
    refreshSyncStatus();
  }
}

/* ── sync (pull-then-push) ─────────────────────────────────────────────────────────────────────── */
async function runSync(opts: { full?: boolean; id?: string }): Promise<void> {
  const id = opts.id ?? activeId();
  if (!localStore || !isEnabled(id)) return;
  // A251: capture the sync generation + workspace id up front. `aborted()` is true once a switch is
  // pending (generation bumped) OR the active workspace no longer matches — it gates every store
  // batch (threaded into pullAndMerge/pushChanges) and every persistence step below.
  const gen = syncGeneration;
  const store = localStore;
  const aborted = () => syncGeneration !== gen || store.activeWorkspace().id !== id;
  const run = (async () => {
    if (!getIK()) {
      if (sessions.has(id)) sessions.clear();
      if (id === activeId()) cloudSync.status = 'locked';
      return;
    }
    if (!onLine()) {
      if (id === activeId()) cloudSync.status = 'offline';
      return;
    }
    const keys = await ensureKeys(id);
    if (!keys) {
      if (id === activeId()) cloudSync.status = getIK() ? 'off' : 'locked';
      return;
    }
    if (aborted()) return;
    if (id === activeId()) cloudSync.status = 'syncing';
    try {
      // PULL first — a full since=0 reconcile closes F62's concurrent-push seq race; steady-state is
      // incremental from the persisted cursor.
      const since = opts.full ? 0 : Number(store.local.get(cursorKey(id), 0)) || 0;
      const { cursor, merged } = await pullAndMerge(store, keys, transport, id, since, aborted);
      if (aborted()) return; // a switch landed — leave the cursor unadvanced
      store.local.set(cursorKey(id), cursor);
      // PUSH write-behind. The watermark is -1 until the first push completes (so a freshly-enabled
      // workspace uploads everything), then the last cutoff — always incremental, independent of `full`.
      const watermark = Number(store.local.get(pushedKey(id), -1));
      const newWatermark = await pushChanges(store, keys, transport, id, watermark, aborted);
      if (aborted()) return; // a switch landed mid-push — leave the watermark unadvanced
      store.local.set(pushedKey(id), newWatermark);
      reconciled.add(id);
      cloudSync.lastPull = Date.now();
      if (merged && dashRef && id === activeId()) await dashRef.reload();
      if (id === activeId()) cloudSync.status = 'synced';
    } catch (e) {
      if (!aborted() && id === activeId()) {
        cloudSync.error = messageOf(e);
        cloudSync.status = 'error';
      }
    }
  })();
  inFlight = run.catch(() => {});
  await run;
}

/** Explicit sync of the active workspace (full reconcile on the first run of a session, or when
 *  `full` is forced — enable/unlock/reconnect; incremental otherwise). Never throws. */
export async function syncActiveWorkspace(opts: { full?: boolean } = {}): Promise<void> {
  if (!cloudSync.configured || !localStore) return;
  const id = activeId();
  if (!isEnabled(id)) return;
  const full = opts.full ?? !reconciled.has(id);
  await runSync({ full, id });
}

/* ── write-behind (debounced push scheduled by the CloudStore) ─────────────────────────────────── */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let dirtyDuringPush = false;

function canSyncActive(): boolean {
  return cloudSync.configured && onLine() && getIK() !== null && isEnabled(activeId()) && sessions.has(activeId());
}

/** Called by the CloudStore after every local write. Debounces an incremental push; a no-op unless
 *  the active workspace is enabled + unlocked + online (so demo/paused writes never touch the net). */
function onLocalWrite(): void {
  if (!canSyncActive()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void runPush(), DEBOUNCE_MS);
}

async function runPush(): Promise<void> {
  pushTimer = null;
  if (pushing) {
    dirtyDuringPush = true;
    return;
  }
  if (!canSyncActive() || !localStore) {
    refreshSyncStatus();
    return;
  }
  const id = activeId();
  const keys = sessions.get(id);
  if (!keys) return;
  // A251: same generation/workspace guard as runSync — a switch mid-push must not push this
  // workspace's rows under another id, nor advance the wrong watermark.
  const gen = syncGeneration;
  const store = localStore;
  const aborted = () => syncGeneration !== gen || store.activeWorkspace().id !== id;
  pushing = true;
  cloudSync.status = 'syncing';
  const run = (async () => {
    try {
      const watermark = Number(store.local.get(pushedKey(id), -1));
      const newWatermark = await pushChanges(store, keys, transport, id, watermark, aborted);
      if (aborted()) return;
      store.local.set(pushedKey(id), newWatermark);
      cloudSync.lastPull = cloudSync.lastPull || 0;
      cloudSync.status = 'synced';
    } catch (e) {
      if (!aborted()) {
        cloudSync.error = messageOf(e);
        cloudSync.status = 'error';
      }
    }
  })();
  inFlight = run.catch(() => {});
  try {
    await run;
  } finally {
    pushing = false;
    if (dirtyDuringPush) {
      dirtyDuringPush = false;
      onLocalWrite();
    }
  }
}

/** Called when the UnlockModal reports the IK is unlocked — converge the active workspace. */
export function onSyncUnlocked(): void {
  refreshSyncStatus();
  void syncActiveWorkspace({ full: true });
}
