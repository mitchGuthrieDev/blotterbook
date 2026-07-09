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
import { ARCHIVED } from '../../lib/archive.ts';
import { getIK } from './vault.svelte.ts';
import { createCloudStore } from './cloudstore.ts';
import {
  pushChanges,
  pullAndMerge,
  syncPlan,
  deriveWsKeys,
  parseWrappedDek,
  recordAad,
  type SyncTransport,
  type WireRecord,
  type WsKeys,
  type PullPage,
} from '../../lib/core/cloudsync-core.ts';
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
  /** A306: actionable, human copy for the current error (mapped from the status). */
  error: '',
  /** A306: the raw transport detail (e.g. "Push failed (413).") — shown as a title/tooltip so the code
   *  is still available for support without leaking into the primary copy. */
  errorDetail: '',
  /** A309(b): the active workspace's server copy is GONE (a 404 on push/pull) — sync was auto-disabled
   *  here + the cached key dropped. Distinct from a plain 'off' so a surface can explain + offer re-enable. */
  serverGone: false,
  /** A306: the active workspace is opted in but the subscription lapsed (a 402/403 on push/pull). Show a
   *  RENEW path (not the first-time Subscribe CTA). */
  needsSub: false,
  /** A306: the active workspace was set up + synced, then PAUSED (pauseCloudSync) — distinct from
   *  never-synced ('off'), so a surface can offer Resume instead of first-time Enable. */
  paused: false,
});

/** A279: the parity state the status pill renders for the ACTIVE workspace, derived from the reactive
 *  fields above. Surfaces call this inside a `$derived` so it re-settles automatically. Tier gating
 *  ('cloud tier required' / subscribe) is handled by the surface BEFORE the pill is shown. */
export type SyncPill = 'checking' | 'off' | 'paused' | 'needs-sub' | 'needs-key' | 'offline' | 'syncing' | 'pending' | 'synced' | 'error';
export function syncPillState(): SyncPill {
  if (cloudSync.needsSub) return 'needs-sub'; // A306: lapsed subscription on an enabled workspace
  if (!cloudSync.enabled) {
    if (cloudSync.tier === '') return 'checking'; // A306: neutral while /api/me is still probing
    return cloudSync.paused ? 'paused' : 'off'; // A306: paused ≠ never-synced
  }
  if (cloudSync.status === 'error') return 'error';
  if (cloudSync.status === 'syncing') return 'syncing';
  if (!cloudSync.unlocked) return 'needs-key';
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
const needsSubByWs = new Set<string>(); // A306: wsIds whose sync 402/403'd (lapsed subscription)
const detailByWs = new Map<string, string>(); // A306: wsId → raw transport detail for the error tooltip

function setPending(id: string, v: boolean): void {
  if (v) pendingByWs.set(id, true);
  else pendingByWs.delete(id);
  if (id === activeId()) cloudSync.pending = v;
}
function setError(id: string, msg: string, detail: string = ''): void {
  if (msg) errorByWs.set(id, msg);
  else errorByWs.delete(id);
  if (detail) detailByWs.set(id, detail);
  else detailByWs.delete(id);
  if (id === activeId()) {
    cloudSync.error = msg;
    cloudSync.errorDetail = detail;
  }
}
/** Mirror a workspace's transient status onto the reactive pill ONLY while it is the active one. */
function setStatus(id: string, s: SyncStatus): void {
  if (id === activeId()) cloudSync.status = s;
}
/** Drop every per-workspace flag for a workspace (opt-out / pause / erase). */
function clearWsState(id: string): void {
  pendingByWs.delete(id);
  errorByWs.delete(id);
  detailByWs.delete(id);
  runningByWs.delete(id);
  serverGoneByWs.delete(id);
  needsSubByWs.delete(id);
}

/** A306: map a transport status to actionable, human copy. The raw detail (with the code) is kept
 *  separately for the tooltip so support can still see it. */
function syncErrorCopy(status: number): string {
  switch (status) {
    case 401:
      return 'Your session expired — sign in again to keep syncing.';
    case 402:
    case 403:
      return 'Your cloud subscription is inactive — renew to keep syncing this workspace.';
    case 413:
      return 'This change is too large to sync — try removing large screenshots.';
    default:
      if (status >= 500) return 'The sync service is temporarily unavailable — it will retry automatically.';
      return 'Sync failed — it will retry automatically.';
  }
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

/** Route a run failure (A306/A309): a 404 on an enabled workspace → server-copy-gone; a 402/403 →
 *  needs-subscription (renew, not first-time Subscribe); everything else → actionable copy with the
 *  raw code kept in the detail. Never called when the run was aborted by a switch. */
function handleSyncError(id: string, e: unknown): void {
  const status = statusOf(e);
  const detail = messageOf(e);
  if (status === 404 && isEnabled(id)) {
    onServerCopyGone(id);
    return;
  }
  if ((status === 402 || status === 403) && isEnabled(id)) {
    needsSubByWs.add(id);
    setError(id, syncErrorCopy(status), detail);
    if (id === activeId()) cloudSync.needsSub = true;
    setStatus(id, 'error');
    return;
  }
  needsSubByWs.delete(id);
  setError(id, syncErrorCopy(status), detail);
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
/** A306: set when a workspace was set up + synced, then PAUSED — persisted so "Paused" survives a
 *  refresh and stays distinguishable from never-synced. */
const pausedKey = (id: string) => `bb:sync:${id}:paused`;
const isPaused = (id: string) => !!localStore?.local.get(pausedKey(id), false);

/** A298: the reserved meta key that carries a workspace's display NAME as a normal (encrypted) synced
 *  record, so another device can decrypt + show it in the "Available in your cloud" adopt list before
 *  it has the workspace's DB. Pushed on enable; read via a targeted blinded-id lookup. */
const WS_NAME_KEY = 'bb:ws:name';

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
  // ARCHIVE FREEZE (docs/archive-freeze.md): stay unconfigured — the controller never probes the tier,
  // never wires connectivity listeners, and issues zero /api/sync or /api/me traffic. App.svelte's boot
  // path already skips calling this when archived (belt-and-suspenders — this holds even if some other
  // caller is added later).
  if (ARCHIVED) return;
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
  localStore.local.remove(pausedKey(id)); // A306: a purge is a full teardown, not a pause
  localStore.local.remove(syncedAtKey(id));
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
  // A306: mirror paused / needsSub / errorDetail too.
  cloudSync.pending = pendingByWs.get(id) ?? false;
  cloudSync.error = errorByWs.get(id) ?? '';
  cloudSync.errorDetail = detailByWs.get(id) ?? '';
  cloudSync.serverGone = serverGoneByWs.has(id);
  cloudSync.needsSub = needsSubByWs.has(id);
  cloudSync.paused = !cloudSync.enabled && isPaused(id);
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
  needsSubByWs.delete(id); // A306: clear a prior lapsed-subscription flag
  localStore.local.set(pausedKey(id), false); // A306: enabling/resuming clears the paused marker
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
    localStore.local.set(pausedKey(id), false);
    localStore.local.set(pushedKey(id), -1); // full push next
    localStore.local.set(cursorKey(id), 0);
    // A298: stamp the workspace's display name as a synced (encrypted) meta record so a peer can show
    // it in the adopt list. LWW/idempotent — a no-op once it matches.
    if (localStore.activeWorkspace().id === id) await localStore.setMeta(WS_NAME_KEY, localStore.activeWorkspace().name);
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
      needsSubByWs.delete(id); // A306: a successful sync proves the subscription is active again
      if (id === activeId()) cloudSync.needsSub = false;
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
  localStore.local.set(pausedKey(id), true); // A306: remember it was paused (≠ never-synced) for Resume
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
      needsSubByWs.delete(id); // A306: a successful push proves the subscription is active again
      if (id === activeId()) cloudSync.needsSub = false;
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

/** Called when the SyncKeyPrompt reports the IK is in memory — converge the active workspace. */
export function onSyncUnlocked(): void {
  refreshSyncStatus();
  void syncActiveWorkspace({ full: true });
}

/* ── A298: multi-device adopt — surface cloud workspaces absent on THIS device + add them ─────────── */

export interface CloudWorkspace {
  id: string;
  name: string;
}

/** Read a workspace's display NAME from its synced records (the reserved WS_NAME_KEY meta record),
 *  given its keys — a targeted blinded-id lookup so we don't decrypt the whole workspace. Best-effort:
 *  returns '' when no name record exists yet (older enable, or none pushed). */
async function fetchWorkspaceName(
  id: string,
  keys: WsKeys,
  crypto: {
    blindId: typeof import('../../lib/core/crypto.ts').blindId;
    decryptRecord: typeof import('../../lib/core/crypto.ts').decryptRecord;
  }
): Promise<string> {
  const target = await crypto.blindId(keys.blindKey, `meta:${WS_NAME_KEY}`);
  const dec = new TextDecoder();
  let since = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = await transport.pull(id, since);
    const row = page.records.find(r => r.blinded_id === target && r.type === 'meta' && !r.deleted);
    if (row) {
      try {
        const aad = recordAad(id, row.type, row.blinded_id, row.updated, row.deleted);
        const obj = JSON.parse(dec.decode(await crypto.decryptRecord(keys.recordKey, JSON.parse(row.ciphertext), aad))) as {
          value?: unknown;
        };
        return typeof obj.value === 'string' ? obj.value : '';
      } catch {
        return '';
      }
    }
    since = page.nextSince;
    if (!page.more || !page.records.length) break;
  }
  return '';
}

/** A298: list the caller's CLOUD workspaces that are NOT yet on this device (and whose DEK we can
 *  unwrap — i.e. genuinely ours), with a decrypted display name. Needs the IK unlocked. Never throws;
 *  returns [] when locked / offline / on error. */
export async function listCloudWorkspaces(): Promise<CloudWorkspace[]> {
  if (!localStore || !cloudSync.configured) return [];
  const ik = getIK();
  if (!ik || !onLine()) return [];
  try {
    const localIds = new Set(localStore.listWorkspaces().map(w => w.id));
    const server = await transport.listWorkspaces();
    const absent = server.filter(w => w.workspace_id && w.wrapped_dek && !localIds.has(w.workspace_id));
    if (!absent.length) return [];
    const crypto = await import('../../lib/core/crypto.ts');
    const out: CloudWorkspace[] = [];
    for (const w of absent) {
      const blob = parseWrappedDek(w.wrapped_dek);
      if (!blob) continue;
      try {
        const bytes = await crypto.unwrapDekBytes(blob, ik); // proves this workspace is decryptable by our IK
        const keys = await deriveWsKeys(bytes);
        bytes.fill(0);
        const name = await fetchWorkspaceName(w.workspace_id, keys, crypto);
        out.push({ id: w.workspace_id, name: name || 'Synced workspace' });
      } catch {
        // wrong IK / corrupt blob → not ours to adopt; skip.
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** A298: adopt a cloud workspace onto THIS device — create a local registry entry keyed by the
 *  SERVER'S id + mark it enabled with fresh cursors, so a switch to it runs a full reconcile that
 *  unwraps the server DEK (ensureKeys) and pulls its data. The CALLER then switches to it (via
 *  dashboard.switchWorkspace, which honours the A251 barrier) and refreshes. Requires an unlocked IK. */
export function adoptCloudWorkspace(ws: CloudWorkspace): boolean {
  if (!localStore || !getIK()) return false;
  localStore.adoptWorkspace(ws.id, ws.name);
  localStore.local.set(enabledKey(ws.id), true);
  localStore.local.set(cursorKey(ws.id), 0);
  localStore.local.set(pushedKey(ws.id), -1);
  localStore.local.set(pausedKey(ws.id), false);
  return true;
}

/** A311(d): called by vault.lock() — abort any in-flight sync + neutralize a pending debounced push,
 *  and DROP the derived per-workspace keys, so nothing can sync against the now-locked account. Then
 *  re-settle the pill to 'locked'. */
export function onVaultLocked(): void {
  syncGeneration++; // abort any in-flight run captured under an earlier generation
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  dirtyDuringPush = false;
  sessions.clear();
  reconciled.clear();
  refreshSyncStatus();
}
