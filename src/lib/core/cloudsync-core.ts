/* Blotterbook · cloud-sync CORE (F63 — synced workspaces, step 6). The PURE (rune-free, DOM-free,
 * node-testable) engine under the reactive controller in cloudsync.svelte.ts:
 *
 *   · deriveWsKeys()  — the per-workspace record key + blinding key from the DEK bytes (F61a crypto).
 *   · pushChanges()   — WRITE-BEHIND: scan the local Store for records changed since a watermark,
 *                       encrypt each (F61a) + blind its id, chunk to F62's ≤15/batch cap, push.
 *   · pullAndMerge()  — page the F62 change-index from a cursor, decrypt, and MERGE through the
 *                       EXISTING trust boundary: trades union (addTrades) / journal·trademeta·meta
 *                       LWW by `updated` / deletes via F58 tombstones — the same gate as a backup
 *                       restore (store.importAll + the store's delete methods).
 *
 * MOAT (S25): the only thing that crosses `transport` is an opaque AES-GCM ciphertext blob + a
 * blinded (HMAC) id + a timestamp. No symbol, P&L, note, tag, screenshot, or workspace name is ever
 * serialized in the clear here. `crypto.ts` (and its Argon2 wasm) is DYNAMICALLY imported so it stays
 * out of the /app boot bundle (A96). Framework-agnostic: the transport + Store are injected, so this
 * runs identically in the browser (real fetch + IndexedDB Store) and in the node integration test
 * (a mock transport + an in-memory Store). */

import type { StoreLike, Trade, StoredJournal, StoredTradeMeta, Tombstone, WrappedDek } from './types.ts';

/* ── the F62 transport contract (injected) ─────────────────────────────────────────────────────── */

/** One encrypted change pushed to the server — opaque ciphertext + blinded id + LWW clock (S25). */
export interface WireRecord {
  blinded_id: string;
  type: string;
  ciphertext: string;
  updated: number;
  deleted?: boolean;
}

/** One row returned from GET /api/sync/pull (the change-index row + its ciphertext blob). */
export interface PulledRecord {
  blinded_id: string;
  seq: number;
  type: string;
  updated: number;
  deleted: boolean;
  ciphertext: string;
}

export interface PullPage {
  records: PulledRecord[];
  nextSince: number;
  more: boolean;
}

/** The subset of /api/sync/* the core drives. The browser controller backs this with `fetch`; the
 *  node test backs it with the real Pages Functions over a mock D1/R2 — the identical contract. */
export interface SyncTransport {
  listWorkspaces(): Promise<Array<{ workspace_id: string; wrapped_dek: string | null }>>;
  /** Register the workspace's wrapped DEK. A304: first-writer-wins server-side — the response returns
   *  the EFFECTIVE wrapped DEK (the existing one if a concurrent device already registered, else the
   *  one just stored). The caller adopts it when it differs from what it sent. */
  registerWorkspace(workspaceId: string, wrappedDek: string): Promise<string>;
  /** Push one ≤15-record batch (the caller chunks to the cap). */
  push(workspaceId: string, records: WireRecord[]): Promise<void>;
  pull(workspaceId: string, since: number): Promise<PullPage>;
  /** A254: erase a workspace's server copy (records + ciphertext blobs). The server deletes one bounded
   *  page per call, so `done: false` means more pages remain and the caller should call again. */
  deleteWorkspace(workspaceId: string): Promise<{ done: boolean }>;
}

/** The per-workspace keys held in memory for a sync session (never persisted). */
export interface WsKeys {
  /** AES-GCM record key (non-extractable) — encrypts/decrypts every record's plaintext. */
  recordKey: CryptoKey;
  /** HMAC blinding key — `blindId(blindKey, `${type}:${id}`)`; identical across devices. */
  blindKey: CryptoKey;
}

/** A279 sync direction → which halves of a reconcile run, and whether the push re-uploads everything.
 *  Pure + node-testable (the controller in cloudsync.svelte.ts is a `.svelte.ts` rune module that can't
 *  be imported into the node suites), so the direction contract that pullFromCloud/pushToCloud/Sync-now
 *  depend on is locked here (A284). 'both' = incremental reconcile; 'pull' = pull+merge only, never
 *  advancing the pushed-watermark; 'push' = re-upload every local record (watermark -1), no pull. */
export interface SyncPlan {
  pull: boolean;
  push: boolean;
  forceFullPush: boolean;
}
export function syncPlan(direction: 'both' | 'pull' | 'push'): SyncPlan {
  return { pull: direction !== 'push', push: direction !== 'pull', forceFullPush: direction === 'push' };
}

/** F62's per-batch record cap — batches over this get a 413, so the client chunks. MUST match the
 *  server cap in functions/_lib/sync.ts (MAX_PUSH_RECORDS = 12, lowered under A253 to stay within the
 *  Cloudflare 50-subrequest budget). A281: was 15 here and drifted above the server's 12, so the first
 *  full push after a 13+-record import 413'd with no re-chunk → the push errored. Keep these in lockstep. */
export const MAX_PUSH_RECORDS = 12;

const dec = new TextDecoder();

/* ── lazy crypto core (keeps crypto.ts + the Argon2 wasm out of the /app boot bundle, A96) ──────── */
function cryptoCore() {
  return import('./crypto.ts');
}

/** Derive the record key + blinding key from a workspace DEK's raw bytes. The caller zeroes `bytes`. */
export async function deriveWsKeys(bytes: Uint8Array<ArrayBuffer>): Promise<WsKeys> {
  const { importDek, blindKeyFromDekBytes } = await cryptoCore();
  const [recordKey, blindKey] = await Promise.all([importDek(bytes), blindKeyFromDekBytes(bytes)]);
  return { recordKey, blindKey };
}

/* ── the wire "type" for a record (opaque server label; also the blinding-input namespace) ───────
 * A trade and its per-trade metadata share the SAME key (the trade id — trademeta is keyed by it),
 * so the blinding input is namespaced by type (`${type}:${id}`): trade:abc ≠ trademeta:abc, and a
 * record's tombstone reuses the record's own type ⇒ same blinded id ⇒ the delete LWW-overwrites the
 * upsert on the server.
 *
 * The CSV LIBRARY (files) is deliberately NOT synced (F63): the raw texts are large, and `addFile`
 * re-stamps `updated` on every import (so it can't converge to a fixed point the way content-hash
 * trades do — a synced file would ping-pong its clock). Trades still carry their `fileIds`; a device
 * that lacks the file records just treats those trades as always-included (dashboard.reloadAll).
 * DELETING a CSV file still propagates: its cascade produces TRADE tombstones, which sync. */
const WIRE_TYPES = new Set(['trade', 'journal', 'trademeta', 'meta']);
type WireType = 'trade' | 'journal' | 'trademeta' | 'meta';

interface Change {
  type: WireType;
  /** The real record key (trade id / journal date / meta key / file id) — never sent in the clear. */
  key: string;
  updated: number;
  deleted: boolean;
  /** The record's plaintext JSON (encrypted before it leaves the browser). */
  plain: string;
}

/** Read every syncable record from the local Store and keep the ones changed since `sinceWatermark`
 *  (pass a NEGATIVE value for a full push — includes records predating F58 whose `updated` is 0). The
 *  bound is INCLUSIVE (`>=`) so a record written in the SAME millisecond as the last push cutoff can
 *  never be permanently skipped; the at-boundary re-push is a harmless server-side LWW no-op. */
export async function collectChanges(store: StoreLike, sinceWatermark: number): Promise<Change[]> {
  const [trades, journal, trademeta, meta, tombstones] = await Promise.all([
    store.getAllTrades(),
    store.getAllJournal(),
    store.allTradeMeta(),
    store.getAllMeta(),
    store.getTombstones(),
  ]);
  const out: Change[] = [];
  const keep = (u: number) => u >= sinceWatermark;

  for (const t of trades as Trade[]) {
    const u = t.updated ?? 0;
    if (keep(u) && t.id) out.push({ type: 'trade', key: t.id, updated: u, deleted: false, plain: JSON.stringify(t) });
  }
  for (const j of journal as StoredJournal[]) {
    const u = j.updated ?? 0;
    if (keep(u)) out.push({ type: 'journal', key: j.date, updated: u, deleted: false, plain: JSON.stringify(j) });
  }
  for (const m of trademeta as StoredTradeMeta[]) {
    const u = m.updated ?? 0;
    if (keep(u)) out.push({ type: 'trademeta', key: m.id, updated: u, deleted: false, plain: JSON.stringify(m) });
  }
  for (const mm of meta as Array<{ key: string; value: unknown; updated?: number }>) {
    const u = mm.updated ?? 0;
    if (keep(u))
      out.push({
        type: 'meta',
        key: mm.key,
        updated: u,
        deleted: false,
        plain: JSON.stringify({ key: mm.key, value: mm.value, updated: u }),
      });
  }
  for (const tb of tombstones as Tombstone[]) {
    if (keep(tb.updated) && WIRE_TYPES.has(tb.type)) {
      out.push({
        type: tb.type as WireType,
        key: tb.id,
        updated: tb.updated,
        deleted: true,
        plain: JSON.stringify({ id: tb.id, updated: tb.updated }),
      });
    }
  }
  return out;
}

/** A308 — the canonical GCM AAD that binds a v2 record's index metadata to its ciphertext. It must be
 *  BYTE-IDENTICAL on push (from the Change) and pull (from the wire row) or GCM auth fails, so it is a
 *  fixed field order with a stable `deleted` encoding. Authenticated, not secret: the server already
 *  sees every field here — binding them just stops a WRITE-capable server forging `deleted`/`updated`/
 *  `type` (which would force a fleet delete or skew LWW) without the tag failing. */
export function recordAad(workspaceId: string, type: string, blindedId: string, updated: number, deleted: boolean): string {
  return `${workspaceId}|${type}|${blindedId}|${updated}|${deleted ? 1 : 0}`;
}

/** Encrypt + blind one change into a WireRecord (opaque ciphertext + blinded id only — S25). A308:
 *  writes a v2 envelope binding this row's index metadata as AAD. */
async function toWire(
  keys: WsKeys,
  c: Change,
  workspaceId: string,
  enc2: {
    encryptRecord: typeof import('./crypto.ts').encryptRecord;
    blindId: typeof import('./crypto.ts').blindId;
  }
): Promise<WireRecord> {
  const blinded_id = await enc2.blindId(keys.blindKey, `${c.type}:${c.key}`);
  const aad = recordAad(workspaceId, c.type, blinded_id, c.updated, c.deleted);
  const rec = await enc2.encryptRecord(keys.recordKey, c.plain, aad);
  return { blinded_id, type: c.type, ciphertext: JSON.stringify(rec), updated: c.updated, deleted: c.deleted || undefined };
}

/**
 * WRITE-BEHIND push. Scans the local Store for records changed since `watermark`, encrypts + blinds
 * them, and pushes in ≤15-record chunks. Returns the NEW watermark: a cutoff captured BEFORE the
 * scan, so any write that lands mid-push keeps `updated > watermark` and is caught next cycle
 * (nothing is skipped). Pass `watermark < 0` for the initial full push (every record incl. legacy).
 *
 * A251: `shouldAbort` is checked BEFORE the store read and before each push batch. If it fires — the
 * active workspace changed out from under this op, or a switch is pending — the push bails and returns
 * the watermark UNCHANGED (never advancing it, never reading one workspace's records under another's
 * identity). Any batch already sent is a harmless server-side LWW no-op re-sent next cycle.
 */
export async function pushChanges(
  store: StoreLike,
  keys: WsKeys,
  transport: SyncTransport,
  workspaceId: string,
  watermark: number,
  shouldAbort: () => boolean = () => false
): Promise<number> {
  const cutoff = Date.now();
  if (shouldAbort()) return watermark; // don't even read the store if the workspace changed
  const changes = await collectChanges(store, watermark);
  if (!changes.length) return Math.max(watermark, cutoff);
  if (shouldAbort()) return watermark; // re-check after the async read, before anything is pushed
  const { encryptRecord, blindId } = await cryptoCore();
  const wire = await Promise.all(changes.map(c => toWire(keys, c, workspaceId, { encryptRecord, blindId })));
  for (let i = 0; i < wire.length; i += MAX_PUSH_RECORDS) {
    if (shouldAbort()) return watermark; // a switch landed mid-push — stop, leave the watermark unadvanced
    await transport.push(workspaceId, wire.slice(i, i + MAX_PUSH_RECORDS));
  }
  return Math.max(watermark, cutoff);
}

/* ── merge (pull side) — reuses the existing store trust boundary ──────────────────────────────── */

interface Resolved {
  type: WireType;
  key: string;
  updated: number;
  deleted: boolean;
  obj: Record<string, unknown>;
}

/** Real record key out of a decrypted payload (trade/trademeta id, journal/meta own key). */
function realKey(type: WireType, obj: Record<string, unknown>): string {
  if (type === 'meta') return String(obj.key ?? '');
  // trade / trademeta carry `.id`; journal carries `.date`; a tombstone payload carries `.id`.
  return String(obj.id ?? obj.date ?? '');
}

/**
 * Decrypt + MERGE a set of pulled records into the local Store. 100% client-side (the server holds
 * no key). Intra-batch conflicts resolve last-writer-wins by `updated`; then each record is gated
 * against local state and applied through the EXISTING semantics:
 *   · trades  → store.importAll → addTrades (content-hash union; F58 tombstones suppress resurrection)
 *   · journal / trademeta / meta / file → store.importAll ONLY when strictly newer than local (LWW)
 *   · deletes → the store's delete methods (which write a local tombstone), gated + idempotent so a
 *               remote delete never ping-pongs (skip when already absent AND already tombstoned).
 *
 * A307: `shouldAbort` is re-checked AFTER the (async) decrypt/resolve pass and BEFORE the write phase.
 * pullAndMerge's last barrier check runs before this call, but the decrypt loop awaits, so a workspace
 * switch can land in that window; without this re-check the merge would write one workspace's records
 * into another's now-active DB. On abort it writes NOTHING and returns `false`, so pullAndMerge leaves
 * the cursor UNADVANCED and the next reconcile re-reads it. Returns `true` when the merge completed
 * (whether or not any record actually landed).
 */
export async function mergeRecords(
  store: StoreLike,
  keys: WsKeys,
  records: PulledRecord[],
  workspaceId: string = '',
  shouldAbort: () => boolean = () => false
): Promise<boolean> {
  if (!records.length) return true;
  const { decryptRecord } = await cryptoCore();

  // Resolve to the latest record per (type:key) by `updated` (LWW within the batch).
  // A263 (poison-pill resilience): decrypt each record in its OWN try/catch. A single corrupt or
  // undecryptable blob (a flipped byte, a bad JSON envelope, the wrong key) is skipped + counted — it
  // must NOT throw and wedge the whole pull; the rest of the batch still merges and the cursor still
  // advances, so one bad record can't permanently break sync.
  const latest = new Map<string, Resolved>();
  let skipped = 0;
  for (const r of records) {
    if (!WIRE_TYPES.has(r.type)) continue; // ignore an unknown/legacy record type defensively
    let obj: Record<string, unknown>;
    try {
      // A308: rebuild the AAD from the wire row. A v2 record's GCM tag was bound to
      // `workspaceId|type|blinded_id|updated|deleted`; a forged field makes decrypt throw → skipped
      // (A263). A v1 record ignores the AAD (no additionalData), so legacy ciphertext still decrypts.
      const aad = recordAad(workspaceId, r.type, r.blinded_id, r.updated, r.deleted);
      obj = JSON.parse(dec.decode(await decryptRecord(keys.recordKey, JSON.parse(r.ciphertext), aad))) as Record<string, unknown>;
    } catch {
      skipped++;
      continue;
    }
    const type = r.type as WireType;
    const key = realKey(type, obj);
    if (!key) continue;
    const id = `${type}:${key}`;
    const prev = latest.get(id);
    if (!prev || r.updated >= prev.updated) latest.set(id, { type, key, updated: r.updated, deleted: r.deleted, obj });
  }
  if (skipped) console.warn(`cloudsync: skipped ${skipped} undecryptable record(s) during merge`);

  // A307: the decrypt/resolve loop above awaited — re-check the switch barrier BEFORE reading or
  // writing the store, so a switch that landed mid-decrypt can't merge into the wrong workspace's DB.
  if (shouldAbort()) return false;

  // Snapshot local `updated` per record + the local tombstones, for the LWW gate.
  const [trades, journal, trademeta, meta, tombs] = await Promise.all([
    store.getAllTrades(),
    store.getAllJournal(),
    store.allTradeMeta(),
    store.getAllMeta(),
    store.getTombstones(),
  ]);
  const localU: Record<WireType, Map<string, number>> = {
    trade: new Map((trades as Trade[]).map(t => [t.id as string, t.updated ?? 0])),
    journal: new Map((journal as StoredJournal[]).map(j => [j.date, j.updated ?? 0])),
    trademeta: new Map((trademeta as StoredTradeMeta[]).map(m => [m.id, m.updated ?? 0])),
    meta: new Map((meta as Array<{ key: string; updated?: number }>).map(m => [m.key, m.updated ?? 0])),
  };
  const localTomb = new Map((tombs as Tombstone[]).map(t => [`${t.type}:${t.id}`, t.updated]));

  const deletes: Resolved[] = [];
  const payload: {
    trades: Trade[];
    journal: StoredJournal[];
    trademeta: StoredTradeMeta[];
    meta: Array<{ key: string; value: unknown; updated: number }>;
  } = { trades: [], journal: [], trademeta: [], meta: [] };

  for (const r of latest.values()) {
    const localVal = localU[r.type].get(r.key);
    const tombVal = localTomb.get(`${r.type}:${r.key}`);
    if (r.deleted) {
      // Idempotent: already absent AND already tombstoned ⇒ the delete is fully applied; skip so the
      // store's delete methods don't re-stamp a fresh tombstone (which would ping-pong forever).
      if (localVal === undefined && tombVal !== undefined) continue;
      // LWW: a strictly-newer local edit keeps the record (the delete is stale).
      if (localVal !== undefined && r.updated < localVal) continue;
      deletes.push(r);
      continue;
    }
    if (r.type === 'trade') {
      // Union merge — addTrades dedupes by content hash and suppresses tombstoned re-adds itself.
      payload.trades.push(r.obj as unknown as Trade);
      continue;
    }
    // journal / trademeta / meta: strict LWW + don't resurrect over a newer local delete.
    if (tombVal !== undefined && tombVal >= r.updated) continue;
    if (localVal !== undefined && r.updated <= localVal) continue;
    if (r.type === 'journal') payload.journal.push(r.obj as unknown as StoredJournal);
    else if (r.type === 'trademeta') payload.trademeta.push(r.obj as unknown as StoredTradeMeta);
    else if (r.type === 'meta') payload.meta.push({ key: String(r.obj.key), value: r.obj.value, updated: r.updated });
  }

  // A307: the local snapshot above awaited too — final barrier check immediately before the first
  // store mutation, so nothing is written into a workspace that was switched away mid-merge.
  if (shouldAbort()) return false;

  // Apply deletes first (independent keys from the upserts), then the upserts through importAll —
  // the same hardened trust boundary a backup restore flows through (S15/S17/S20/A154).
  for (const d of deletes) {
    if (d.type === 'trade') await store.deleteTrade(d.key);
    else if (d.type === 'journal') await store.deleteJournal(d.key);
    else if (d.type === 'trademeta') await store.deleteTradeMeta(d.key);
  }
  const hasUpserts = payload.trades.length || payload.journal.length || payload.trademeta.length || payload.meta.length;
  if (hasUpserts) await store.importAll(payload as unknown as Record<string, unknown>);
  return true;
}

/**
 * Pull from a cursor and merge every page. Returns the advanced cursor + how many records merged.
 * Pass `since = 0` for a FULL reconcile (reads the whole change-index) — this closes F62's
 * concurrent-push seq race: a full read can never skip a colliding seq the way an incremental
 * `since = cursor` pull could. Steady-state uses the persisted cursor.
 */
export async function pullAndMerge(
  store: StoreLike,
  keys: WsKeys,
  transport: SyncTransport,
  workspaceId: string,
  since: number,
  shouldAbort: () => boolean = () => false
): Promise<{ cursor: number; merged: number }> {
  let cursor = since;
  const all: PulledRecord[] = [];
  // Page until caught up (bounded loop — the server caps each page + always advances nextSince).
  // A251: if the active workspace changes mid-pull (a switch is pending), bail with the cursor
  // UNADVANCED (`since`) and merge NOTHING — so one workspace's records can never be written into
  // another's local Store, and the next reconcile re-reads from the persisted (unmoved) cursor.
  for (let guard = 0; guard < 10000; guard++) {
    if (shouldAbort()) return { cursor: since, merged: 0 };
    const page = await transport.pull(workspaceId, cursor);
    all.push(...page.records);
    cursor = page.nextSince;
    if (!page.more || !page.records.length) break;
  }
  if (shouldAbort()) return { cursor: since, merged: 0 }; // bail before writing the merge into the store
  // A307: mergeRecords re-checks the barrier before its own write phase; if it aborted (a switch
  // landed during decrypt/snapshot), it wrote nothing → leave the cursor UNADVANCED for a re-read.
  const merged = await mergeRecords(store, keys, all, workspaceId, shouldAbort);
  if (!merged) return { cursor: since, merged: 0 };
  return { cursor, merged: all.length };
}

/** Parse a stored wrapped-DEK JSON string into the F61a blob shape (or null when malformed). */
export function parseWrappedDek(json: string | null): WrappedDek | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as WrappedDek;
  } catch {
    return null;
  }
}
