/* Blotterbook · cloud-sync CONTROLLER (F63 — synced workspaces, step 6). The reactive ($state) glue
 * over the pure engine in cloudsync-core.ts. Owns:
 *   · the per-active-workspace SYNC STATUS the WorkspaceSwitcher affordance renders,
 *   · the DEBOUNCED write-behind push (scheduled by the CloudStore's onWrite),
 *   · the FULL-reconcile-then-incremental pull on enable / unlock / focus / reconnect,
 *   · the per-workspace opt-in (mint+register a DEK, or adopt the server's) and the in-memory
 *     per-workspace keys (derived from the DEK; never persisted — only the cursor + enabled flag are).
 *
 * CLOUD-TIER + OPT-IN by construction (live on prod + staging — CH16, 2026-07-07): App.svelte wraps the
 * Store in a CloudStore and calls configureCloudSync() on every NON-DEMO surface; enabling sync needs `tier === 'cloud'` and an
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
  syncPlan,
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
  /** configureCloudSync() has run (every non-demo surface — prod + staging) — gate the affordance on this. */
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
  /** local edits made since the last successful push (A279 parity pill: "Pending upload"). Set on
   *  every local write to an enabled workspace, cleared when a push/sync completes — so the pill can
   *  say the cloud is behind this device even while offline/locked. */
  pending: false,
  /** epoch ms of the last successful pull-merge (0 = never this session). */
  lastPull: 0,
  /** an enable/sync op is in flight. */
  busy: false,
  error: '',
  /** A309(b): the active workspace's server copy is GONE (a 404 on push/pull) — sync was auto-disabled
   *  here + the cached key dropped. Distinct from a plain 'off' so a surface can explain + offer re-enable. */
  serverGone: false,
});

/** A279: the parity state the status pill renders for the ACTIVE workspace, derived from the reactive
 *  fields above. Surfaces call this inside a `$derived` so it re-settles automatically. Tier gating
 *  ('cloud tier required' / subscribe) is handled by the surface BEFORE the pill is shown. */
export type SyncPill = 'off' | 'needs-unlock' | 'offline' | 'syncing' | 'pending' | 'synced' | 'error';
export function syncPillState(): SyncPill {
  if (!cloudSync.enabled) return 'off';
  if (cloudSync.status === 'error') return 'error';
  if (cloudSync.status === 'syncing') return 'syncing';
  if (!cloudSync.unlocked) return 'needs-unlock';
  if (!cloudSync.online) return 'offline';
  if (cloudSync.pending) return 'pending';
  return 'synced';
}

const DEBOUNCE_MS = 1500;

/* ── module refs + in-memory per-workspace key sessions (never persisted) ──────────────────────── */
let localStore: StoreLike | null = null;
let dashRef: { reload(): Promise<void> } | null = null;
const sessions = new Map<string, WsKeys>(); // wsId → { recordKey, blindKey } — dropped on lock
const reconciled = new Set<string>(); // wsIds that have had their FULL since=0 reconcile this session

/* ── A299: PER-WORKSPACE sync state — pending/error/in-flight are scoped by workspace id (like
 * `sessions`), so a workspace switch can't carry the previous workspace's flags. `cloudSync.pending/
 * error/status` are the MIRROR of whichever workspace is active — refreshSyncStatus re-projects the
 * active id's maps onto them. A background run for a NON-active workspace updates only its map entry
 * (not the mirror), and `runningByWs` — cleared when EVERY run settles, even on abort — lets a
 * re-derive show 'syncing' only while a run is genuinely in flight (no stranded spinner after a
 * mid-sync switch). */
const pendingByWs = new Map<string, boolean>(); // wsId → local edits owed to the cloud (un-pushed)
const errorByWs = new Map<string, string>(); // wsId → last actionable sync error ('' = none)
const runningByWs = new Set<string>(); // wsIds with a sync/push run in flight right now
const serverGoneByWs = new Set<string>(); // A309(b): wsIds whose server copy 404'd → auto-disabled here

function setPending(id: string, v: boolean): void {
  if (v) pendingByWs.set(id, true);
  else pendingByWs.delete(id);
  if (id === activeId()) cloudSync.pending = v;
}
function setError(id: string, msg: string): void {
  if (msg) errorByWs.set(id, msg);
  else errorByWs.delete(id);
  if (id === activeId()) cloudSync.error = msg;
}
/** Mirror a workspace's transient status onto the reactive pill ONLY while it is the active one. */
function setStatus(id: string, s: SyncStatus): void {
  if (id === activeId()) cloudSync.status = s;
}
/** Drop every per-workspace flag for a workspace (opt-out / pause / erase). */
function clearWsState(id: string): void {
  pendingByWs.delete(id);
  errorByWs.delete(id);
  runningByWs.delete(id);
  serverGoneByWs.delete(id);
}

/** A309(b): a 404 on an enabled workspace means its server copy was erased elsewhere. Auto-disable
 *  sync for it HERE, drop the cached key + cursors, and flag `serverGone` with a clear message so a
 *  surface can offer re-enable — instead of looping 404s behind an opaque "Pull failed (404)." */
function onServerCopyGone(id: string): void {
  if (!localStore) return;
  localStore.local.set(enabledKey(id), false);
  localStore.local.remove(cursorKey(id));
  localStore.local.remove(pushedKey(id));
  localStore.local.remove(syncedAtKey(id));
  sessions.delete(id);
  reconciled.delete(id);
  pendingByWs.delete(id);
  runningByWs.delete(id);
  serverGoneByWs.add(id);
  errorByWs.set(id, 'This workspace’s cloud copy was removed. Sync is off for it on this device — re-enable to sync again.');
  refreshSyncStatus();
}

/** Route a run failure: a 404 on an enabled workspace → server-copy-gone; anything else → surface the
 *  error on the pill. Never called when the run was aborted by a switch. */
function handleSyncError(id: string, e: unknown): void {
  if (statusOf(e) === 404 && isEnabled(id)) {
    onServerCopyGone(id);
    return;
  }
  setError(id, messageOf(e));
  setStatus(id, 'error');
}

/** A309(a): if this workspace has been offline longer than the server's tombstone TTL, its
 *  watermark/cursor may sit past compacted records — reset to a FULL re-push + re-pull so it converges
 *  instead of silently diverging. Called at the start of each run. */
function resetIfStaleGap(store: StoreLike, id: string): void {
  const last = Number(store.local.get(syncedAtKey(id), 0)) || 0;
  if (last && Date.now() - last > TOMBSTONE_TTL_MS) {
    store.local.set(pushedKey(id), -1); // re-push everything
    store.local.set(cursorKey(id), 0); // re-pull the whole change-index
    reconciled.delete(id);
  }
}

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
/** A309(a): epoch ms of the LAST successful sync of a workspace — persisted so a long-offline gap is
 *  detectable across refreshes. */
const syncedAtKey = (id: string) => `bb:sync:${id}:at`;

/** A309(a): the server compacts delete tombstones after 90 days. A device offline longer than that
 *  has a watermark/cursor sitting PAST compacted records, so a normal incremental sync silently
 *  diverges — force a full re-push + re-pull instead. Matches the server's tombstone TTL. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const onLine = () => typeof navigator === 'undefined' || navigator.onLine;
const activeId = () => (localStore ? localStore.activeWorkspace().id : '');
const isEnabled = (id: string) => !!localStore?.local.get(enabledKey(id), false);
const messageOf = (e: unknown) => (e instanceof Error ? e.message || 'Sync failed.' : 'Sync failed.');

/** A309(b)/A306: an HTTP failure from the F62 transport, carrying the raw status so the controller can
 *  branch (404 → server copy gone; 401/402/403/413/5xx → actionable copy). */
export class SyncHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
  }
}
const statusOf = (e: unknown): number => (e instanceof SyncHttpError ? e.status : 0);

/* ── the F62 transport (real fetch; session-cookie carried) ────────────────────────────────────── */
const transport: SyncTransport = {
  async listWorkspaces() {
    const res = await fetch('/api/sync/workspaces', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new SyncHttpError(res.status, `Could not list synced workspaces (${res.status}).`);
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
    if (!res.ok) throw new SyncHttpError(res.status, `Could not enable sync for this workspace (${res.status}).`);
    // A304: the server never overwrites an existing wrapped DEK — it returns the EFFECTIVE one. Return
    // it so enableCloudSync can adopt the winner's DEK on a concurrent enable (fall back to ours if an
    // older server build doesn't echo it yet).
    const data = (await res.json().catch(() => null)) as { wrapped_dek?: string | null } | null;
    return data?.wrapped_dek ?? wrappedDek;
  },
  async push(workspaceId, records: WireRecord[]) {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, records }),
    });
    if (!res.ok) throw new SyncHttpError(res.status, `Push failed (${res.status}).`);
  },
  async pull(workspaceId, since) {
    const res = await fetch(`/api/sync/pull?workspace_id=${encodeURIComponent(workspaceId)}&since=${since}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new SyncHttpError(res.status, `Pull failed (${res.status}).`);
    return (await res.json()) as PullPage;
  },
  async deleteWorkspace(workspaceId) {
    const res = await fetch('/api/sync/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    if (!res.ok) throw new SyncHttpError(res.status, `Could not erase the synced copy (${res.status}).`);
    return (await res.json()) as { done: boolean };
  },
};

/** A254: cap the server-erase paging loop. DELETE_PAGE is 500 server-side, so this covers a workspace
 *  of up to 500·ERASE_MAX_PAGES records — far past MAX_RECORDS_PER_WORKSPACE — before giving up. */
const ERASE_MAX_PAGES = 200;

/* ── CloudStore wiring (called at App.svelte module init, staging only) ────────────────────────── */

/** Wrap the local Store so writes schedule a debounced push. Called on every non-demo surface (app +
 *  staging); demo mounts the in-memory DemoStore and is never wrapped, so it never syncs. Inert until a
 *  cloud-tier user opts a workspace in + unlocks. */
export function wrapStore(local: StoreLike): StoreLike {
  localStore = local;
  return createCloudStore(local, onLocalWrite);
}

/** Configure the controller after boot (every non-demo surface — prod + staging): probe the tier, wire
 *  connectivity/focus listeners, and settle the active workspace's status. Never throws. */
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
 *  DISABLE sync for it and reset its cursor + pushed-watermark — AND propagate the erase to the server
 *  so the cloud ciphertext is deleted too (else the orphaned E2E blobs linger server-side). The local
 *  opt-out is the guaranteed stop for THIS device; the server erase is best-effort (it needs a live
 *  session + network) and safely retries on the next purge if it can't reach the server now. */
function onErased(): void {
  if (!localStore) return;
  syncGeneration++; // abort any in-flight run + neutralize a pending debounced push for this workspace
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  dirtyDuringPush = false;
  const id = localStore.activeWorkspace().id;
  const wasEnabled = isEnabled(id); // only a workspace that was actually syncing has a server copy
  localStore.local.set(enabledKey(id), false); // opt-out: no reconcile until the user re-enables
  localStore.local.remove(cursorKey(id));
  localStore.local.remove(pushedKey(id));
  sessions.delete(id);
  reconciled.delete(id);
  clearWsState(id); // A299: drop this workspace's pending/error/in-flight flags
  refreshSyncStatus();
  if (wasEnabled) void eraseServerCopy(id);
}

/** A254: page through the server erase until the workspace's records + blobs are gone. Best-effort —
 *  a failure (offline / lapsed session) leaves the cloud copy for the next purge attempt while the
 *  local opt-out above already protects this device from re-downloading it. */
async function eraseServerCopy(id: string): Promise<void> {
  try {
    for (let i = 0; i < ERASE_MAX_PAGES; i++) {
      const { done } = await transport.deleteWorkspace(id);
      if (done) break;
    }
  } catch {
    /* best-effort — retried on the next erase */
  }
}

/* ── status ────────────────────────────────────────────────────────────────────────────────────── */

/** Recompute the ACTIVE workspace's status and re-project its per-workspace pending/error onto the
 *  reactive mirror. A299: this FULLY re-derives — a stale `syncing` or `error` from a previous (now
 *  inactive, possibly aborted) workspace can never leak onto the pill, because pending/error are read
 *  from the active id's maps and `syncing` is shown only while `runningByWs` holds an in-flight run.
 *  When enabled + online + unlocked but no key session is loaded yet, kick a full reconcile (the
 *  on-unlock / on-switch entry point). */
export function refreshSyncStatus(): void {
  if (!cloudSync.configured || !localStore) return;
  const ws = localStore.activeWorkspace();
  const id = ws.id;
  cloudSync.wsId = id;
  cloudSync.wsName = ws.name;
  cloudSync.online = onLine();
  cloudSync.unlocked = getIK() !== null;
  cloudSync.enabled = isEnabled(id);
  // A299: mirror the ACTIVE workspace's per-workspace flags (a switch must not carry the previous
  // workspace's pending/error). A309(b): serverGone survives the auto-disable so the message stays up.
  cloudSync.pending = pendingByWs.get(id) ?? false;
  cloudSync.error = errorByWs.get(id) ?? '';
  cloudSync.serverGone = serverGoneByWs.has(id);
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
  // Enabled + online + unlocked. Re-derive from scratch (no "upgrade only"): a live error sticks, an
  // in-flight run is 'syncing', otherwise a loaded key session is 'synced'. No key session yet ⇒ kick
  // the reconcile (which itself flips to 'syncing').
  if (errorByWs.get(id)) cloudSync.status = 'error';
  else if (runningByWs.has(id)) cloudSync.status = 'syncing';
  else if (sessions.has(id)) cloudSync.status = 'synced';
  else {
    cloudSync.status = 'syncing';
    void syncActiveWorkspace({ full: true }); // no key session yet (fresh switch/unlock) → reconcile
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
  setError(id, '');
  serverGoneByWs.delete(id); // A309(b): re-enabling clears a prior "server copy gone" flag
  try {
    if (cloudSync.tier !== 'cloud') throw new Error('Cloud tier required to sync.');
    const ik = getIK();
    if (!ik) {
      setStatus(id, 'locked');
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
      const wrapped = JSON.stringify(await crypto.wrapDek(dek, ik));
      const effective = await transport.registerWorkspace(id, wrapped);
      const adoptBlob = parseWrappedDek(effective);
      if (effective !== wrapped && adoptBlob) {
        // A304: a concurrent enable already registered a DIFFERENT wrapped DEK (first-writer-wins on
        // the server). ADOPT it — unwrap → derive keys from the winner's DEK — so we never strand
        // ciphertext the peer pushed under its key.
        bytes.fill(0);
        const adoptBytes = await crypto.unwrapDekBytes(adoptBlob, ik);
        keys = await deriveWsKeys(adoptBytes);
        adoptBytes.fill(0);
      } else {
        keys = await deriveWsKeys(bytes);
        bytes.fill(0);
      }
    }
    sessions.set(id, keys);
    localStore.local.set(enabledKey(id), true);
    localStore.local.set(pushedKey(id), -1); // full push next
    localStore.local.set(cursorKey(id), 0);
    await runSync({ full: true, id });
    return true;
  } catch (e) {
    setError(id, messageOf(e));
    setStatus(id, 'error');
    return false;
  } finally {
    cloudSync.busy = false;
    refreshSyncStatus();
  }
}

/* ── sync (pull-then-push; A279 adds one-directional variants) ─────────────────────────────────────
   `direction` drives what the run does: 'both' (default reconcile — pull then push), 'pull' (pull +
   merge only — the A279 "Pull from cloud" action), or 'push' (push only — the "Push to cloud" action).
   Either direction still merges by LWW/content-hash under the hood; the one-directional variants are a
   legibility/control affordance (the newest edit of each record wins regardless of who initiated). */
async function runSync(opts: { full?: boolean; id?: string; direction?: 'both' | 'pull' | 'push' }): Promise<void> {
  const id = opts.id ?? activeId();
  const plan = syncPlan(opts.direction ?? 'both'); // A284: pure direction contract (pull/push/forceFullPush)
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
      setStatus(id, 'locked');
      return;
    }
    if (!onLine()) {
      setStatus(id, 'offline');
      return;
    }
    const keys = await ensureKeys(id);
    if (!keys) {
      setStatus(id, getIK() ? 'off' : 'locked');
      return;
    }
    if (aborted()) return;
    runningByWs.add(id); // A299: mark this workspace's run in flight (cleared in finally, even on abort)
    setStatus(id, 'syncing');
    try {
      resetIfStaleGap(store, id); // A309(a): a >90d-offline gap forces a full re-push + re-pull
      let merged = 0; // record count from the pull (truthy → a merge landed → reload the dashboard)
      if (plan.pull) {
        // PULL — a full since=0 reconcile closes F62's concurrent-push seq race; steady-state is
        // incremental from the persisted cursor.
        const since = opts.full ? 0 : Number(store.local.get(cursorKey(id), 0)) || 0;
        const res = await pullAndMerge(store, keys, transport, id, since, aborted);
        if (aborted()) return; // a switch landed — leave the cursor unadvanced
        store.local.set(cursorKey(id), res.cursor);
        merged = res.merged;
      }
      if (plan.push) {
        // PUSH write-behind. The watermark is -1 until the first push completes (so a freshly-enabled
        // workspace uploads everything), then the last cutoff. `plan.forceFullPush` (direction 'push')
        // re-uploads everything (the "Push to cloud" action) without discarding remote — LWW still applies.
        const watermark = plan.forceFullPush ? -1 : Number(store.local.get(pushedKey(id), -1));
        const newWatermark = await pushChanges(store, keys, transport, id, watermark, aborted);
        if (aborted()) return; // a switch landed mid-push — leave the watermark unadvanced
        store.local.set(pushedKey(id), newWatermark);
      }
      reconciled.add(id);
      cloudSync.lastPull = Date.now();
      store.local.set(syncedAtKey(id), Date.now()); // A309(a): record a successful sync for the offline-gap check
      // A299: only a run that actually PUSHED clears "pending upload" — a pull-only run leaves local
      // edits still owed to the cloud (the A279 regression: this used to clear pending unconditionally).
      if (plan.push) setPending(id, false);
      setError(id, ''); // a successful run clears the last error
      if (merged && dashRef && id === activeId()) await dashRef.reload();
      setStatus(id, 'synced');
    } catch (e) {
      if (!aborted()) handleSyncError(id, e); // A309(b): a 404 auto-disables; else surface the error
    } finally {
      runningByWs.delete(id);
    }
  })();
  // A307: CHAIN, don't overwrite — two runs can overlap (a `focus` and an `online` both fire), and a
  // bare `inFlight = run` would let cancelActiveSync await only the LAST, leaving the earlier run
  // writing after the switch flipped. allSettled awaits BOTH (run never rejects — its IIFE swallows).
  inFlight = Promise.allSettled([inFlight, run]).then(() => {});
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

/** A279 "Pull from cloud" — pull the cloud copy down and merge it into local (no push). LWW: the
 *  newest edit of each record wins, so this never blindly overwrites newer local edits. */
export async function pullFromCloud(): Promise<void> {
  if (!cloudSync.configured || !localStore) return;
  const id = activeId();
  if (!isEnabled(id)) return;
  await runSync({ full: true, id, direction: 'pull' });
}

/** A279 "Push to cloud" — re-upload every local record (no pull). LWW: a record the cloud has a newer
 *  edit of is still kept newest-wins; this is the legible "send my version up" control, not a wipe. */
export async function pushToCloud(): Promise<void> {
  if (!cloudSync.configured || !localStore) return;
  const id = activeId();
  if (!isEnabled(id)) return;
  await runSync({ full: true, id, direction: 'push' });
}

/** A279 "Pause sync" — stop syncing the active workspace WITHOUT erasing its cloud copy (that's the
 *  separate A254 purge path). Reversible: re-enable adopts the same server DEK. Local data untouched. */
export function pauseCloudSync(): void {
  if (!localStore) return;
  const id = activeId();
  syncGeneration++; // abort any in-flight run for this workspace
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  localStore.local.set(enabledKey(id), false);
  sessions.delete(id);
  reconciled.delete(id);
  clearWsState(id); // A299: drop this workspace's pending/error/in-flight flags
  refreshSyncStatus();
}

/* ── write-behind (debounced push scheduled by the CloudStore) ─────────────────────────────────── */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let dirtyDuringPush = false;

function canSyncActive(): boolean {
  return cloudSync.configured && onLine() && getIK() !== null && isEnabled(activeId()) && sessions.has(activeId());
}

/** Called by the CloudStore after every local write. Debounces an incremental push; the push itself is
 *  a no-op unless the active workspace is enabled + unlocked + online (so demo/paused writes never
 *  touch the net). A279: mark the workspace "pending upload" for the parity pill even when it can't
 *  push right now (offline / locked) — the edit is real and still owed to the cloud. */
function onLocalWrite(): void {
  if (localStore && isEnabled(activeId())) setPending(activeId(), true);
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
  runningByWs.add(id);
  setStatus(id, 'syncing');
  const run = (async () => {
    try {
      resetIfStaleGap(store, id); // A309(a): a >90d-offline gap forces a full re-push
      const watermark = Number(store.local.get(pushedKey(id), -1));
      const newWatermark = await pushChanges(store, keys, transport, id, watermark, aborted);
      if (aborted()) return;
      store.local.set(pushedKey(id), newWatermark);
      store.local.set(syncedAtKey(id), Date.now()); // A309(a): record the successful push
      cloudSync.lastPull = cloudSync.lastPull || 0;
      setPending(id, false); // the debounced write-behind push reached the server
      setError(id, '');
      setStatus(id, 'synced');
    } catch (e) {
      if (!aborted()) handleSyncError(id, e); // A309(b): a 404 auto-disables; else surface the error
    } finally {
      runningByWs.delete(id);
    }
  })();
  inFlight = Promise.allSettled([inFlight, run]).then(() => {}); // A307: chain so cancelActiveSync awaits every overlapping run
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
