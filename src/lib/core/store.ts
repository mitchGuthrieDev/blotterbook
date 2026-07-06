'use strict';
import { Adapters } from './adapters.ts';
import { checkCsvText } from './intake.ts';
import type { Trade, Annotation, StoredJournal, StoredTradeMeta, StoreLike, CsvFileRec, Tombstone, Workspace } from './types.ts';
/* ============================================================
   Local persistence — IndexedDB

   This module exposes a single global `Store` object. Everything
   the app needs to read/write lives behind this interface:

       await Store.init()
       await Store.addTrades(trades)   -> { added, duplicate, total }
       await Store.getAllTrades()      -> trade[]   (sorted by time)
       await Store.tradeCount()        -> number
       await Store.saveJournal(date, text)
       await Store.getJournal(date)    -> string
       await Store.journalDates()      -> Set<'YYYY-MM-DD'>
       await Store.setMeta(key, value)
       await Store.getMeta(key)        -> value | undefined
       await Store.purge()             -> wipes all local data
       Store.tradeId(trade)            -> stable dedupe key

   --- Why an interface, not direct IndexedDB calls in the app? ---
   The app never touches `indexedDB` directly. A future cloud tier
   (Stripe subscription -> server-hosted storage) only has to ship a
   drop-in object with these same async methods; the app code does
   not change. Local (one-time payment) keeps this IndexedDB backend;
   subscription swaps in a CloudStore that talks to a Pages Function.
   See functions/README.md for the storage-tier plan.
   ============================================================ */
// The staging sandbox uses an isolated database so it never touches real data.
const IS_STAGING = typeof document !== 'undefined' && !!document.body && document.body.dataset.mode === 'staging';
// F59 named local workspaces: ONE IndexedDB database per workspace. The CONCRETE db name is resolved
// from the ACTIVE workspace at connection time (see open()), not a single const. The **Default**
// workspace keeps the LEGACY name (blotterbook / blotterbookStaging) so every existing user's data is
// used IN PLACE — no copy, no move — while new workspaces get a suffixed name (blotterbook:<wsid>).
// Staging stays isolated: its legacy name, db prefix AND registry keys are all namespaced.
const LEGACY_DB_NAME = IS_STAGING ? 'blotterbookStaging' : 'blotterbook';
const WS_DB_PREFIX = IS_STAGING ? 'blotterbookStaging:' : 'blotterbook:';
// The workspace registry + active-workspace pointer live in Store.local (sync localStorage) so boot
// resolves the DB name BEFORE first render. Staging-namespaced so the two surfaces never collide.
const WS_REGISTRY_KEY = IS_STAGING ? 'bb:staging:workspaces' : 'bb:workspaces';
const WS_ACTIVE_KEY = IS_STAGING ? 'bb:staging:activeWorkspace' : 'bb:activeWorkspace';
// The Default workspace's stable id (the legacy single-DB world = the one-workspace case of the model).
const DEFAULT_WS_ID = 'default';
const DB_VERSION = 4; // v4 (F58): + tombstones store (delete-log); v3 (F37): + files / filetext
const TRADES = 'trades';
const JOURNAL = 'journal';
const META = 'meta';
const TRADEMETA = 'trademeta'; // per-trade tags / note / screenshots, keyed by trade id
const FILES = 'files'; // imported-CSV metadata records (F37), keyed by content-hash id
const FILETEXT = 'filetext'; // raw CSV text per file, keyed by the same id — split from the
// metadata row so listing the library never loads megabytes of text
const TOMBSTONES = 'tombstones'; // F58 delete-log: { id, type, updated } keyed by the removed
// record's id — makes a delete distinguishable from "not synced yet" and blocks re-import resurrection

// Screenshots are inlined data: URIs rendered straight into an <img src>. Only well-formed base64
// image data URIs are allowed — this drops any `javascript:`/`data:text/html`/SVG payload before it
// can reach a render sink (S15/S18). Shared by importAll (restore) and the live capture path.
// Exported so the in-memory DemoStore (A31) reuses the EXACT screenshot allow-list (no drift).
export const SHOT_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
// Standalone validator (Store.validShot delegates) — shared with DemoStore.
export function validShot(s: unknown): boolean {
  return typeof s === 'string' && SHOT_RE.test(s);
}

// Canonical tag form — markup-stripped, trimmed, lowercased, deduped. The ONE definition used by
// EVERY tag write path: the live journal/trade-meta saves AND untrusted backup restore. Applying it
// on the live path (A130) means a live-entered tag and a restored one land in the identical form, so
// both match the lowercase tag filter/chips (was B29 — only restore canonicalized before). Exported
// so DemoStore reuses it verbatim (no drift), like tradeId/validShot.
export const cleanTag = (s: unknown): string =>
  String(s == null ? '' : s)
    .replace(/[<>&"']/g, '')
    .trim()
    .toLowerCase();
export const cleanTags = (a: unknown): string[] => [...new Set((Array.isArray(a) ? a : []).map(cleanTag).filter(Boolean))];
// The shape tradeId() produces (8 lowercase hex chars) — importAll rejects trademeta ids that
// couldn't have come from a real store (A154).
const TRADE_ID_RE = /^[0-9a-f]{8}$/;

/* ---- Store.local seam (sync localStorage; JSON-encoded, never throws) — module-level so the F59
   workspace registry can resolve the active DB before first paint, and Store.local delegates here. ---- */
function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function lsSet(key: string, val: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}
function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ---- F59 workspace registry (in Store.local) ----
   Seed-on-first-boot migration: if no registry exists yet, the existing single DB becomes a single
   "Default" workspace whose dbName is the LEGACY name — so today's data is used in place with ZERO
   movement. Idempotent: once the registry exists this early-returns. */
function ensureWorkspaces(): Workspace[] {
  const reg = lsGet<Workspace[]>(WS_REGISTRY_KEY, []);
  if (Array.isArray(reg) && reg.length) return reg;
  const def: Workspace = { id: DEFAULT_WS_ID, name: 'Default', dbName: LEGACY_DB_NAME, createdAt: Date.now() };
  lsSet(WS_REGISTRY_KEY, [def]);
  lsSet(WS_ACTIVE_KEY, def.id);
  return [def];
}
/** The active workspace entry — repairs a dangling active pointer (points at a removed id) to the first. */
function activeWorkspaceEntry(): Workspace {
  const reg = ensureWorkspaces();
  const activeId = lsGet<string>(WS_ACTIVE_KEY, '');
  const found = reg.find(w => w.id === activeId);
  if (found) return found;
  lsSet(WS_ACTIVE_KEY, reg[0].id);
  return reg[0];
}
/** Best-effort deletion of a per-workspace IndexedDB — a blocked/errored delete resolves rather than
 *  wedging the registry op (the registry entry is removed regardless; the DB is reclaimed later). */
function deleteDB(name: string): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

let dbp: Promise<IDBDatabase> | null = null; // cached open-promise (for the ACTIVE workspace's DB)

function open() {
  if (dbp) return dbp;
  // F59: the concrete DB name comes from the active workspace (Default → legacy name; others suffixed).
  const dbName = activeWorkspaceEntry().dbName;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRADES)) db.createObjectStore(TRADES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TRADEMETA)) db.createObjectStore(TRADEMETA, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILETEXT)) db.createObjectStore(FILETEXT, { keyPath: 'id' });
      // F58 (v4): the delete-log. A pre-v4 DB upgrades cleanly — no tombstones present means nothing
      // is suppressed, i.e. exactly today's behavior, until the user's next delete records one.
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
function done(t: IDBObjectStore): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    t.transaction.oncomplete = () => resolve();
    t.transaction.onerror = () => reject(t.transaction.error);
    t.transaction.onabort = () => reject(t.transaction.error);
  });
}
function reqP<T = unknown>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
// F58: drop a tombstone by id (own tx). Used by updateTrade — an editor re-add is an explicit
// user action, not an import, so it must not be suppressed by the delete it just logged.
function clearTombstone(id: string): Promise<void> {
  return tx(TOMBSTONES, 'readwrite').then(store => {
    store.delete(id);
    return done(store);
  });
}

/* Stable, order-independent dedupe key for a trade. Two CSV exports
   that overlap will produce identical ids for the shared rows, so a
   re-upload only inserts the genuinely new trades. */
// FNV-1a 32-bit — small, dependency-free, good enough for dedupe (shared by tradeId + fileId).
function fnv(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function tradeId(t: Trade): string {
  // Append the within-file ordinal ONLY for 2nd+ identical occurrences (A114), so unique trades keep
  // the exact pre-A114 key (no re-dedupe churn for existing local data) while genuinely-distinct
  // same-second/symbol/side/pnl trades — which used to collide and silently drop — stay apart.
  // NOTE fileIds/commission (F37/A208) and `updated` (F58) are deliberately NOT hashed — provenance,
  // real costs, and the LWW clock must never change a trade's identity, or re-imports would stop
  // deduping.
  return fnv(`${t.time}|${t.symbol}|${t.side}|${t.pnl}` + (t.dup ? `|${t.dup}` : ''));
}

// F58/A255: does an existing tombstone suppress re-inserting an incoming trade in addTrades? The ONE
// isolated place the import-resurrection policy lives. Policy: timestamp-LWW — a tombstone suppresses
// the re-insert ONLY when the delete is at least as recent as the incoming record's clock. So a
// stale/clockless re-import (a plain CSV row has no `updated` ⇒ 0) stays suppressed, but a record
// carrying a NEWER `updated` (e.g. a peer device that enriched the trade after the delete, arriving
// via the sync merge → importAll → addTrades) RESURRECTS it. This is the convergence-required
// behavior: it makes trade merges LWW-consistent with the journal/trademeta/meta stores
// (cloudsync-core's LWW gate), so two devices can't permanently diverge on a delete-vs-newer-edit
// race. (A255 deliberately flipped the old unconditional "delete always wins over re-import" default.)
export function suppressedByTombstone(tomb: Tombstone | undefined, incoming: Trade): boolean {
  return !!tomb && tomb.updated >= (incoming.updated ?? 0);
}

/** Content-hash id for an imported CSV (F37) — a re-upload of the byte-identical file dedupes. */
export function fileId(text: string): string {
  return fnv(`${text.length}|${text}`);
}

/** Key-correlated field copy for the duplicate-enrichment merge (A176) — a typed same-key
 *  assignment (`obj[key] = val`) that avoids widening either side to `any`/`Record`. Exported so
 *  DemoStore reuses it verbatim (no drift), like tradeId/validShot. */
export function setField<K extends keyof Trade>(obj: Trade, key: K, val: Trade[K]): void {
  obj[key] = val;
}

/* A236: export v3 folds the Store.local seam (dashboard tab/module layouts + workspace templates)
   into the backup so a restore rebuilds them. Only the `bb:…dash…` layout keys travel — `bb:flags`
   (a dev/test override) is deliberately excluded so a backup can't flip app behavior on restore.
   Shared with DemoStore's exportAll so the two envelopes can't drift. */
export const LOCAL_BACKUP_RE = /^bb:(staging:)?dash[A-Za-z0-9:_-]*$/;
/* A236: plain SHA-256 hex over the payload for corruption detection (R24 — NOT an account-hash lock;
   backups stay restorable logged-out). Web Crypto is present in browsers (secure context: the app is
   https/localhost) and in Node ≥19, so this runs in the app and the node suites alike. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* A153: one-shot canonicalization of tags persisted BEFORE A130 made cleanTags the single write
   form. Older live saves stored raw case/markup ('Scalp'), which no longer matches new writes,
   the lowercase tag filter/chips, or a saved filter's tag — so on first boot after the change we
   rewrite journal/trademeta rows (and the savedFilters meta) whose canonical form differs, then
   set a meta flag so this never runs again. Puts are issued inside the getAll onsuccess handler
   (no await between read and write — B6: an await lets the tx auto-commit mid-flight). */
const TAGS_MIGRATED = 'tagsCanonicalized';
async function migrateTags() {
  const metaRead = await tx(META, 'readonly');
  if (await reqP(metaRead.get(TAGS_MIGRATED))) return;
  const same = (a: string[], b: unknown) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  for (const name of [JOURNAL, TRADEMETA]) {
    const store = await tx(name, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const r = store.getAll();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        for (const row of r.result as Array<StoredJournal | StoredTradeMeta>) {
          const tags = cleanTags(row.tags);
          if (same(tags, row.tags)) continue;
          // A row left with no content at all (tags canonicalized away, no text/note/shots)
          // is deleted — matching what the live save paths do with an empty record.
          const text = 'date' in row ? row.text : row.note;
          if (!tags.length && !(text || '').trim() && !(row.shots || []).length) store.delete('date' in row ? row.date : row.id);
          else store.put({ ...row, tags });
        }
        resolve();
      };
    });
    await done(store);
  }
  const metaStore = await tx(META, 'readwrite');
  await new Promise<void>((resolve, reject) => {
    const r = metaStore.get('savedFilters');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const rec = r.result as { key: string; value?: Array<{ f?: { tag?: unknown } }> } | undefined;
      if (rec && Array.isArray(rec.value)) {
        for (const v of rec.value) if (v && v.f && v.f.tag != null) v.f.tag = cleanTag(v.f.tag);
        metaStore.put(rec);
      }
      metaStore.put({ key: TAGS_MIGRATED, value: true });
      resolve();
    };
  });
  await done(metaStore);
}

export const Store: StoreLike = {
  available() {
    return typeof indexedDB !== 'undefined';
  },

  async init() {
    ensureWorkspaces(); // F59: seed the registry (Default → legacy DB) so open() resolves the active DB
    await open();
    await migrateTags();
    return true;
  },

  tradeId,

  async addTrades(trades) {
    // Read existing records AND write all puts inside ONE readwrite transaction (B34). Splitting
    // the snapshot into a separate readonly tx (the prior shape) left a window where a
    // concurrent writer could make the dedupe check stale; doing both in one tx closes it.
    // The puts are issued synchronously inside getAll().onsuccess — NO await between the
    // read and the puts — so the transaction stays live to completion instead of
    // auto-committing mid-flight (B6: an await inside a tx lets it commit and the next put
    // throws TransactionInactiveError). The id map also dedupes rows repeated within a batch.
    // F37: a duplicate isn't a pure no-op anymore — when the incoming copy carries fileIds, they
    // MERGE into the existing record's provenance (the fileIds-array overlap decision), so a trade
    // present in two exports lists both files. And richer duplicates ENRICH: a platform can export
    // the same trade at different fidelity (TradingView balance history has exact P&L but no
    // qty/hold; its order history adds qty/entry/exit/holdMs/commission), so a duplicate fills in
    // fields the stored record LACKS — identity fields (time/symbol/side/pnl, the id inputs) are
    // never touched and existing values never overwritten, so import order doesn't matter.
    const ENRICH = ['qty', 'entryTime', 'exitTime', 'holdMs', 'commission', 'entryPrice', 'exitPrice'] as const;
    // F58: widen the tx to include TOMBSTONES so the dedupe read, the tombstone read, and ALL the
    // puts happen in ONE readwrite tx (B34). Both getAll()s are issued (the tombstone read nested
    // inside so the tx never idles), then every put is issued synchronously in the inner onsuccess —
    // NO await between the reads and the puts (B6), so the tx stays live to completion.
    const db = await open();
    const dbtx = db.transaction([TRADES, TOMBSTONES], 'readwrite');
    const store = dbtx.objectStore(TRADES);
    const tombStore = dbtx.objectStore(TOMBSTONES);
    let added = 0,
      duplicate = 0;
    await new Promise<void>((resolve, reject) => {
      const tr = tombStore.getAll();
      tr.onerror = () => reject(tr.error);
      tr.onsuccess = () => {
        const tombs = new Map<string, Tombstone>((tr.result as Tombstone[]).map(r => [r.id, r]));
        const kr = store.getAll();
        kr.onerror = () => reject(kr.error);
        kr.onsuccess = () => {
          const existing = new Map<string, Trade>((kr.result as Trade[]).map(r => [r.id as string, r]));
          for (const t of trades) {
            const id = tradeId(t);
            const prev = existing.get(id);
            if (prev) {
              duplicate++;
              let next: Trade | null = null;
              if (t.fileIds?.length) {
                const merged = [...new Set([...(prev.fileIds || []), ...t.fileIds])];
                if (merged.length !== (prev.fileIds || []).length) next = { ...prev, fileIds: merged };
              }
              for (const k of ENRICH)
                if (prev[k] == null && t[k] != null) {
                  next = next ?? { ...prev };
                  setField(next, k, t[k]);
                }
              if (next) {
                next.updated = Date.now(); // F58: LWW clock on the enrichment write
                existing.set(id, next);
                store.put(next);
              }
              continue;
            }
            // F58: a fresh insert is the only place resurrection can happen — an import re-adding a
            // trade the user deleted. Consult the delete-log via the single isolated predicate.
            if (suppressedByTombstone(tombs.get(id), t)) continue;
            // A154: computed id LAST so a crafted input object carrying its own `id` key (e.g. a
            // tampered backup) can never override the content hash the dedupe/meta paths rely on.
            // fileIds is copied to a plain array — a Svelte $state proxy would throw in the
            // structured clone (same rule as saveTradeMeta's .filter). F58: stamp the LWW clock.
            const rec = t.fileIds ? { ...t, fileIds: [...t.fileIds], id, updated: Date.now() } : { ...t, id, updated: Date.now() };
            existing.set(id, rec);
            store.put(rec);
            added++;
          }
          resolve();
        };
      };
    });
    await done(store);
    const total = await this.tradeCount();
    return { added, duplicate, total };
  },

  async getAllTrades() {
    const store = await tx(TRADES, 'readonly');
    const all = await reqP(store.getAll());
    all.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return all;
  },

  async tradeCount() {
    const store = await tx(TRADES, 'readonly');
    return reqP(store.count());
  },

  // F16: a day note is now a rich annotation { text, tags[], shots[] } (was text-only). Accepts a
  // bare string (legacy callers) or the record object; deletes the row when fully empty.
  async saveJournal(date, rec) {
    const r: Annotation = typeof rec === 'string' ? { text: rec } : rec || {};
    const text = (r.text || '').trim();
    const tags = cleanTags(r.tags); // A130: canonicalize live tags (same form as restore)
    const shots = Array.isArray(r.shots) ? r.shots.filter(s => this.validShot(s)) : [];
    // A252: clearing a note to empty is a DELETE, not a bare drop. Route the empty branch through the
    // SAME delete+tombstone tx as deleteJournal (JOURNAL + TOMBSTONES in ONE readwrite tx) so the
    // deletion is recorded in the delete-log and syncs — a bare store.delete(date) left no tombstone,
    // so collectChanges reported nothing and the next reconcile RESURRECTED the cleared note. B6/B34:
    // both ops are issued synchronously in one tx, no await between them.
    const db = await open();
    const t = db.transaction([JOURNAL, TOMBSTONES], 'readwrite');
    if (text || tags.length || shots.length) t.objectStore(JOURNAL).put({ date, text, tags, shots, updated: Date.now() });
    else {
      t.objectStore(JOURNAL).delete(date);
      t.objectStore(TOMBSTONES).put({ id: date, type: 'journal', updated: Date.now() });
    }
    return done(t.objectStore(JOURNAL));
  },

  // Always returns the normalized record shape so callers don't branch on legacy {date,text} rows.
  async getJournal(date) {
    const store = await tx(JOURNAL, 'readonly');
    const rec = await reqP(store.get(date));
    return { text: (rec && rec.text) || '', tags: (rec && rec.tags) || [], shots: (rec && rec.shots) || [] };
  },

  async journalDates() {
    const store = await tx(JOURNAL, 'readonly');
    const keys = await reqP(store.getAllKeys());
    return new Set(keys as string[]);
  },

  async deleteTrade(id) {
    // F58: delete + record a tombstone in ONE tx so the removal and its delete-log entry can't
    // diverge. The tombstone is what keeps a later re-import from resurrecting this trade.
    const db = await open();
    const t = db.transaction([TRADES, TOMBSTONES], 'readwrite');
    t.objectStore(TRADES).delete(id);
    t.objectStore(TOMBSTONES).put({ id, type: 'trade', updated: Date.now() });
    return done(t.objectStore(TRADES));
  },

  // Edit a trade's CORE fields. The id is a content hash (tradeId), so an edit is a delete-old +
  // add-new that migrates the per-trade metadata (tags/note/shots) to the new id. `meta` overrides the
  // tags/note (the editor may change them in the same save); shots carry over from the old record.
  // Returns the new id. Note: the new row goes through addTrades' dedupe (A114) — an edit whose fields
  // collide with an existing trade merges into it rather than duplicating.
  async updateTrade(oldId, next, meta) {
    const old = await this.getTradeMeta(oldId);
    await this.deleteTrade(oldId); // F58: tombstones the OLD id (a re-import of the pre-edit row stays deleted)
    await this.deleteTradeMeta(oldId);
    const id = tradeId(next);
    // F58: an editor re-add is an EXPLICIT user action, not an import — clear any tombstone for the
    // new id so addTrades doesn't suppress it. Covers the identity-preserving edit (only tags/note
    // changed → tradeId(next) === oldId, which deleteTrade just tombstoned).
    await clearTombstone(id);
    await this.addTrades([next]);
    await this.saveTradeMeta(id, { tags: meta?.tags ?? old.tags, note: meta?.note ?? old.note, shots: meta?.shots ?? old.shots });
    return { id };
  },

  async getAllJournal() {
    const store = await tx(JOURNAL, 'readonly');
    const all = await reqP<StoredJournal[]>(store.getAll());
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
    return all;
  },

  async deleteJournal(date) {
    // F58: delete + tombstone (keyed by the journal date) in one tx — the delete half of journal LWW.
    const db = await open();
    const t = db.transaction([JOURNAL, TOMBSTONES], 'readwrite');
    t.objectStore(JOURNAL).delete(date);
    t.objectStore(TOMBSTONES).put({ id: date, type: 'journal', updated: Date.now() });
    return done(t.objectStore(JOURNAL));
  },

  async getAllMeta() {
    const store = await tx(META, 'readonly');
    return reqP(store.getAll());
  },

  /* ---- per-trade metadata: { id, tags:[], note:'', shots:[dataURL], updated } ---- */
  async getTradeMeta(id) {
    const store = await tx(TRADEMETA, 'readonly');
    const rec = await reqP<StoredTradeMeta | undefined>(store.get(id));
    return rec || { id, tags: [], note: '', shots: [] };
  },
  async saveTradeMeta(id, m) {
    const tags = cleanTags(m.tags); // A130: canonicalize live tags (same form as restore)
    const note = (m.note || '').trim();
    // Enforce the screenshot allow-list here too (matches saveJournal — S15/S18); .filter also
    // yields a plain array, so a Svelte $state proxy can't reach IndexedDB's structured clone.
    const shots = (m.shots || []).filter(s => validShot(s));
    // A252: an empty clear is a DELETE — route it through the SAME delete+tombstone tx as
    // deleteTradeMeta (TRADEMETA + TOMBSTONES in ONE readwrite tx) so the removal is logged and syncs
    // instead of silently resurrecting on the next reconcile. B6/B34: both ops synchronous, one tx.
    const db = await open();
    const t = db.transaction([TRADEMETA, TOMBSTONES], 'readwrite');
    if (tags.length || note || shots.length) t.objectStore(TRADEMETA).put({ id, tags, note, shots, updated: Date.now() });
    else {
      t.objectStore(TRADEMETA).delete(id);
      t.objectStore(TOMBSTONES).put({ id, type: 'trademeta', updated: Date.now() });
    }
    return done(t.objectStore(TRADEMETA));
  },
  async deleteTradeMeta(id) {
    // F58: delete + tombstone in one tx — the delete half of per-trade-meta LWW.
    const db = await open();
    const t = db.transaction([TRADEMETA, TOMBSTONES], 'readwrite');
    t.objectStore(TRADEMETA).delete(id);
    t.objectStore(TOMBSTONES).put({ id, type: 'trademeta', updated: Date.now() });
    return done(t.objectStore(TRADEMETA));
  },
  async allTradeMeta() {
    const store = await tx(TRADEMETA, 'readonly');
    return reqP<StoredTradeMeta[]>(store.getAll());
  },

  /* ---- F58 delete-log: every removal path records a tombstone; the sync layer reads these ---- */
  async getTombstones() {
    const store = await tx(TOMBSTONES, 'readonly');
    return reqP<Tombstone[]>(store.getAll());
  },

  /* ---- F37 per-file CSV provenance: metadata in FILES, raw text in FILETEXT ---- */
  async getFiles() {
    const store = await tx(FILES, 'readonly');
    const all = await reqP<CsvFileRec[]>(store.getAll());
    all.sort((a, b) => (a.imported < b.imported ? 1 : a.imported > b.imported ? -1 : 0)); // newest first
    return all;
  },
  async addFile(rec, text) {
    // One tx over both stores so a metadata row can never exist without its text (or vice versa).
    const db = await open();
    const t = db.transaction([FILES, FILETEXT], 'readwrite');
    t.objectStore(FILES).put({ ...rec, id: rec.id, updated: Date.now() }); // F58: LWW clock
    t.objectStore(FILETEXT).put({ id: rec.id, text });
    return new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
  async updateFile(id, patch) {
    const store = await tx(FILES, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const r = store.get(id);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        // id stays the content hash — a patch can't re-key the record. F58: refresh the LWW clock.
        if (r.result) store.put({ ...r.result, ...patch, id, updated: Date.now() });
        resolve();
      };
    });
    return done(store);
  },
  async deleteFile(id) {
    // One readwrite tx over FILES + FILETEXT + TRADES + TRADEMETA: drop the record + raw text,
    // strip this id from every trade's provenance, and DELETE trades whose provenance becomes
    // empty — a trade another file also contributed survives (the fileIds-array overlap model).
    // Trades with NO fileIds (imported pre-F37) are untouched. A216: a removed trade's per-trade
    // meta (tags/note/screenshots — base64 can be large) goes with it instead of orphaning in
    // IndexedDB. All puts/deletes are issued synchronously inside getAll().onsuccess (B6 — no
    // await mid-tx).
    // F58: TOMBSTONES joins the tx so each trade this cascade removes records a delete-log entry
    // (same tx, all puts/deletes synchronous inside getAll().onsuccess — B6). A trade that merely
    // loses one file id (survives via another) is a survivor, not a delete, so it gets no tombstone.
    const db = await open();
    const t = db.transaction([FILES, FILETEXT, TRADES, TRADEMETA, TOMBSTONES], 'readwrite');
    t.objectStore(FILES).delete(id);
    t.objectStore(FILETEXT).delete(id);
    const tradeStore = t.objectStore(TRADES);
    const metaStore = t.objectStore(TRADEMETA);
    const tombStore = t.objectStore(TOMBSTONES);
    let removedTrades = 0;
    await new Promise<void>((resolve, reject) => {
      const r = tradeStore.getAll();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        for (const rec of r.result as Trade[]) {
          if (!rec.fileIds || !rec.fileIds.includes(id)) continue;
          const rest = rec.fileIds.filter(f => f !== id);
          if (rest.length) tradeStore.put({ ...rec, fileIds: rest, updated: Date.now() });
          else {
            tradeStore.delete(rec.id as string);
            metaStore.delete(rec.id as string);
            tombStore.put({ id: rec.id as string, type: 'trade', updated: Date.now() });
            removedTrades++;
          }
        }
        resolve();
      };
    });
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    return { removedTrades };
  },
  async getFileText(id) {
    const store = await tx(FILETEXT, 'readonly');
    const rec = await reqP<{ id: string; text: string } | undefined>(store.get(id));
    return rec ? rec.text : undefined;
  },
  async filesBytes() {
    const files = await this.getFiles();
    return files.reduce((a, f) => a + (Number(f.size) || 0), 0);
  },

  /* Full local snapshot — for the data manager's backup/export. F37: includes the CSV library
     (file records + raw texts) so a restore rebuilds provenance; a backup can grow to the raw-CSV
     budget (~50 MB) but stays a single self-contained file. */
  async exportAll() {
    const [trades, journal, meta, trademeta, files] = await Promise.all([
      this.getAllTrades(),
      this.getAllJournal(),
      this.getAllMeta(),
      this.allTradeMeta(),
      this.getFiles(),
    ]);
    const filetexts: Array<{ id: string; text: string }> = [];
    for (const f of files) {
      const text = await this.getFileText(f.id);
      if (text != null) filetexts.push({ id: f.id, text });
    }
    // A236: fold the Store.local layout keys (bb:…dash…) into the envelope so a restore rebuilds
    // dashboard tabs/modules/workspaces — previously silently absent from backups.
    const local: Record<string, unknown> = {};
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !LOCAL_BACKUP_RE.test(k)) continue;
        try {
          local[k] = JSON.parse(localStorage.getItem(k) as string);
        } catch {
          /* skip a non-JSON value */
        }
      }
    }
    // A236: version 3 (adds `local` + `checksum`). The checksum covers the whole payload MINUS
    // itself; on import we recompute over the received envelope with `checksum` removed (it is added
    // last, so the key order matches), and a mismatch flags corruption. v2 backups (no checksum)
    // still import.
    const payload = {
      app: 'blotterbook',
      version: 3,
      exportedAt: new Date().toISOString(),
      trades,
      journal,
      meta,
      trademeta,
      files,
      filetexts,
      local,
    };
    const checksum = await sha256Hex(JSON.stringify(payload));
    return { ...payload, checksum };
  },

  /* Merge a backup back in: trades de-dupe, notes & meta upsert. */
  async importAll(data) {
    let added = 0,
      dup = 0;
    // A236: v3 payload checksum — when present, verify SHA-256 over the envelope MINUS the checksum
    // field and REFUSE a corrupted/tampered file (surfaced to the user as a restore error). A v2
    // backup carries no checksum and imports unchanged.
    if (typeof data.checksum === 'string') {
      const { checksum, ...rest } = data;
      const calc = await sha256Hex(JSON.stringify(rest));
      if (calc !== checksum) throw new Error('Backup checksum mismatch — the file is corrupted or was modified.');
    }
    // Sanitize at the trust boundary: a backup file is untrusted input (unlike CSV
    // import, which routes symbols through rootSym()). Force `root` to the safe
    // charset and strip markup-significant chars from tags, so restored data can't
    // become a stored-XSS payload in any (current or future) render sink.
    // A26: `Adapters` is a static ESM import and rootSym is unconditionally exported, so the old
    // `Adapters && Adapters.rootSym ? … : <fallback>` guard was always truthy (dead fallback +
    // duplicated charset regex). Call rootSym directly — it's the stricter sanitizer.
    const cleanSym = (s: unknown) => Adapters.rootSym(String(s || ''));
    // Tags use the shared module-level cleanTags (lowercase + strip markup + dedupe) — the same
    // canonical form the live save paths now apply (A130), so restored tags match the tag filter/chips.
    // Restore is untrusted: keep ONLY well-formed base64 image data URIs (S15, SHOT_RE above).
    const cleanShots = (a: unknown) => (Array.isArray(a) ? a.filter(s => typeof s === 'string' && SHOT_RE.test(s)) : []);
    // S17: a restored `date` flows into innerHTML sinks (the data-manager trades/day-notes lists),
    // and the CSV path validates dates but addTrades/journal-restore did not. Require canonical
    // YYYY-MM-DD (and a finite pnl for trades) here so a crafted backup can't smuggle markup in.
    const validDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
    // A154: pin the remaining trade fields to the shapes the live paths produce, so a crafted
    // backup can't smuggle arbitrary strings into the export/id paths: `time` must be a canonical
    // timestamp (else it degrades to midnight of the row's date), `side` is allow-listed, and
    // `qty` is coerced to a positive number (else dropped, i.e. treated as 1 like the adapters).
    const validTime = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(s);
    if (Array.isArray(data.trades) && data.trades.length) {
      const clean = [];
      for (const t of data.trades) {
        if (!t || !validDate(t.date) || !Number.isFinite(+t.pnl)) continue;
        // B35: don't mutate the caller's backup object — push a sanitized COPY.
        const c = { ...t };
        if (c.root != null) c.root = cleanSym(c.root);
        if (!validTime(c.time)) c.time = `${c.date} 00:00:00`;
        if (c.side !== 'long' && c.side !== 'short') c.side = '';
        const q = Number(c.qty);
        if (c.qty == null || !Number.isFinite(q) || q <= 0) delete c.qty;
        else c.qty = q;
        // F37/A208: pin provenance + real-commission to their live shapes — fileIds must be
        // 8-hex hash ids, commission a finite non-negative $ cost.
        if (c.fileIds != null) {
          const ids = Array.isArray(c.fileIds) ? c.fileIds.filter((f: unknown) => typeof f === 'string' && TRADE_ID_RE.test(f)) : [];
          if (ids.length) c.fileIds = ids;
          else delete c.fileIds;
        }
        const cm = Number(c.commission);
        if (c.commission == null || !Number.isFinite(cm) || cm < 0) delete c.commission;
        else c.commission = cm;
        // F42/A236: pin per-fill prices to finite numbers (else drop) — like commission, they're
        // additive detail outside tradeId, so a crafted backup can't smuggle a non-number here.
        for (const k of ['entryPrice', 'exitPrice'] as const) {
          const v = Number(c[k]);
          if (c[k] == null || !Number.isFinite(v)) delete c[k];
          else c[k] = v;
        }
        clean.push(c);
      }
      const r = await this.addTrades(clean);
      added = r.added;
      dup = r.duplicate;
    }
    if (Array.isArray(data.journal) && data.journal.length) {
      const store = await tx(JOURNAL, 'readwrite');
      for (const j of data.journal) {
        if (!j || !validDate(j.date)) continue;
        const text = String(j.text || '').trim();
        const tags = cleanTags(j.tags); // F16: restore tags/shots too (B29: lowercased + deduped)
        const shots = cleanShots(j.shots);
        if (text || tags.length || shots.length) store.put({ date: j.date, text, tags, shots, updated: j.updated || Date.now() });
      }
      await done(store);
    }
    // S20: the meta store used to be restored verbatim — but savedFilters ids/names flow into
    // HTML attributes (data.js f_saved <option>, datamanager data-filter*), so a crafted backup
    // could break out of an attribute. Allow-list meta keys and validate the savedFilters shape
    // at the boundary (coerce id to a safe charset, strip markup from name, whitelist filter
    // fields); unknown keys are dropped.
    const FILTER_FIELDS = ['from', 'to', 'symbol', 'side', 'session', 'tag'];
    const cleanSavedFilters = (a: unknown) =>
      (Array.isArray(a) ? a : [])
        .map((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return null;
          const s = entry as Record<string, unknown>;
          const id = String(s.id == null ? '' : s.id)
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 32);
          if (!id) return null;
          const name = String(s.name == null ? '' : s.name)
            .replace(/[<>&"']/g, '')
            .trim()
            .slice(0, 80);
          const src: Record<string, unknown> = s.f && typeof s.f === 'object' ? (s.f as Record<string, unknown>) : {};
          const f: Record<string, unknown> = {};
          for (const k of FILTER_FIELDS)
            f[k] = String(src[k] == null ? '' : src[k])
              .replace(/[<>&"']/g, '')
              .slice(0, 64);
          f.dows = Array.isArray(src.dows) ? src.dows.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
          return { id, name, f };
        })
        .filter(Boolean);
    if (Array.isArray(data.meta) && data.meta.length) {
      const store = await tx(META, 'readwrite');
      for (const mm of data.meta) {
        if (!mm || mm.key == null) continue;
        // A260: preserve the payload's `updated` (the LWW clock) — a sync-merge meta record carries
        // one, and dropping it made every reconcile treat these rows as freshly changed and re-push/
        // re-pull them. A backup with no clock falls back to now (a one-time restore, not a sync churn).
        const updated = typeof mm.updated === 'number' ? mm.updated : Date.now();
        if (mm.key === 'savedFilters') store.put({ key: 'savedFilters', value: cleanSavedFilters(mm.value), updated });
        else if (mm.key === 'setup' && mm.value && typeof mm.value === 'object') store.put({ key: 'setup', value: mm.value, updated });
        // unknown meta keys are dropped (allow-list)
      }
      await done(store);
    }
    if (Array.isArray(data.trademeta) && data.trademeta.length) {
      const store = await tx(TRADEMETA, 'readwrite');
      for (const tm of data.trademeta) {
        // A154: only accept ids in the 8-hex tradeId form (anything else is an orphan a crafted
        // backup planted), and coerce note to a string so a non-string can't throw in .trim()
        // consumers later.
        if (tm && typeof tm.id === 'string' && TRADE_ID_RE.test(tm.id))
          store.put({
            id: tm.id,
            tags: cleanTags(tm.tags),
            note: String(tm.note ?? '').trim(),
            shots: cleanShots(tm.shots),
            updated: tm.updated || Date.now(),
          });
      }
      await done(store);
    }
    // F37: restore the CSV library. Untrusted boundary — ids must be the 8-hex hash form, each
    // text must pass the intake gate (binary sniff / row / size caps), and a metadata record is
    // only kept when its text came through (no orphan rows). Name/label are markup-stripped.
    if (Array.isArray(data.files) && data.files.length) {
      const cleanName = (s: unknown) =>
        String(s ?? '')
          .replace(/[<>&"']/g, '')
          .trim()
          .slice(0, 120);
      const texts = new Map<string, string>();
      for (const ft of Array.isArray(data.filetexts) ? data.filetexts : [])
        if (ft && typeof ft.id === 'string' && TRADE_ID_RE.test(ft.id) && typeof ft.text === 'string') texts.set(ft.id, ft.text);
      for (const f of data.files as Array<Record<string, unknown>>) {
        if (!f || typeof f.id !== 'string' || !TRADE_ID_RE.test(f.id)) continue;
        const text = texts.get(f.id);
        if (text == null || checkCsvText(text)) continue;
        const label = cleanName(f.label);
        const rec: CsvFileRec = {
          id: f.id,
          name: cleanName(f.name) || 'import.csv',
          ...(label ? { label } : {}),
          platform: String(f.platform || '')
            .replace(/[^a-z0-9]/gi, '')
            .slice(0, 32),
          platformLabel: cleanName(f.platformLabel),
          size: text.length, // recompute from the restored text, not the claimed size
          rows: Math.max(0, Math.round(Number(f.rows) || 0)),
          tradeCount: Math.max(0, Math.round(Number(f.tradeCount) || 0)),
          overlap: Math.max(0, Math.round(Number(f.overlap) || 0)),
          from: validDate(f.from) ? (f.from as string).slice(0, 10) : '',
          to: validDate(f.to) ? (f.to as string).slice(0, 10) : '',
          imported: typeof f.imported === 'string' ? f.imported.slice(0, 32) : new Date().toISOString(),
          included: f.included !== false,
          // A211: broker override — key charset only (rateFor falls back safely on unknown keys).
          ...(typeof f.broker === 'string' && /^[A-Z0-9_]{1,32}$/.test(f.broker) ? { broker: f.broker } : {}),
        };
        await this.addFile(rec, text);
      }
    }
    // A236: restore the Store.local layout payload (dashboard tabs/modules/workspaces). Untrusted
    // boundary — only bb:…dash… keys, only plain object/array values (the layout shapes), and a
    // size cap; values are re-serialized from the parsed JSON so no markup executes at this seam
    // (tab labels render through Svelte's auto-escaping when read back). Demo never reaches here —
    // DemoStore.importAll is a no-op — so this can't persist on the demo surface.
    if (data.local && typeof data.local === 'object' && !Array.isArray(data.local) && typeof localStorage !== 'undefined') {
      for (const [k, v] of Object.entries(data.local as Record<string, unknown>)) {
        if (!LOCAL_BACKUP_RE.test(k) || v == null || typeof v !== 'object') continue;
        try {
          const s = JSON.stringify(v);
          if (s.length <= 256 * 1024) localStorage.setItem(k, s);
        } catch {
          /* skip an unserializable value */
        }
      }
    }
    return { added, dup };
  },

  async setMeta(key, value) {
    const store = await tx(META, 'readwrite');
    store.put({ key, value, updated: Date.now() }); // F58: LWW clock on meta writes
    return done(store);
  },

  async getMeta(key) {
    const store = await tx(META, 'readonly');
    const rec = await reqP(store.get(key));
    return rec ? rec.value : undefined;
  },

  async purge() {
    // F58: TOMBSTONES is cleared too. A purge is a clean slate (full local reset), NOT a set of
    // deletions to propagate — so we drop the delete-log rather than leaving tombstones that would
    // suppress a fresh re-import.
    const db = await open();
    await Promise.all(
      [TRADES, JOURNAL, META, TRADEMETA, FILES, FILETEXT, TOMBSTONES].map(name => {
        const store = db.transaction(name, 'readwrite').objectStore(name);
        store.clear();
        return done(store);
      })
    );
    return true;
  },

  // S18: shared screenshot validator so the live capture path enforces the same data-URI
  // allow-list as restore (rejects SVG / javascript: / data:text payloads). Delegates to the
  // module-level validShot (also reused by DemoStore) so the rule has one definition.
  validShot,

  /* ---- F59 named local workspaces: per-workspace IndexedDB + a Store.local registry ----
     A "workspace" is a named local dataset backed by its own IndexedDB database. The registry +
     active-workspace pointer live in Store.local (sync, pre-paint). The Default workspace maps to the
     LEGACY db name so existing data is used in place; new workspaces get a fresh suffixed DB. Every
     query/mutation goes through Store.local; the only direct IndexedDB touches are deleteDatabase (on
     delete) and the normal open() (on switch). Switching a workspace = open a different DB. */
  activeWorkspace() {
    return activeWorkspaceEntry();
  },
  listWorkspaces() {
    return ensureWorkspaces();
  },
  createWorkspace(name) {
    const reg = ensureWorkspaces();
    const id = crypto.randomUUID();
    const clean = (name || '').trim().slice(0, 60) || 'Workspace';
    const ws: Workspace = { id, name: clean, dbName: WS_DB_PREFIX + id, createdAt: Date.now() };
    lsSet(WS_REGISTRY_KEY, [...reg, ws]);
    return ws;
  },
  renameWorkspace(id, name) {
    const reg = ensureWorkspaces();
    const clean = (name || '').trim().slice(0, 60);
    let updated: Workspace | undefined;
    const next = reg.map(w => (w.id === id && clean ? (updated = { ...w, name: clean }) : w));
    if (updated) lsSet(WS_REGISTRY_KEY, next);
    return updated;
  },
  async deleteWorkspace(id) {
    const reg = ensureWorkspaces();
    // Never leave the user with zero workspaces — refuse to delete the last one.
    if (reg.length <= 1) throw new Error('Cannot delete the last workspace.');
    const target = reg.find(w => w.id === id);
    if (!target) return activeWorkspaceEntry();
    lsSet(
      WS_REGISTRY_KEY,
      reg.filter(w => w.id !== id)
    );
    // Deleting the ACTIVE workspace: switch to another FIRST (closes+repoints the connection) so the
    // deleteDatabase below isn't blocked by our own open handle.
    if (lsGet<string>(WS_ACTIVE_KEY, '') === id) await this.setActiveWorkspace(activeWorkspaceEntry().id);
    await deleteDB(target.dbName); // drop the whole per-workspace IndexedDB (no-op if never opened)
    return activeWorkspaceEntry();
  },
  async setActiveWorkspace(id) {
    const reg = ensureWorkspaces();
    const target = reg.find(w => w.id === id);
    if (!target) return activeWorkspaceEntry(); // unknown id → no-op
    lsSet(WS_ACTIVE_KEY, id);
    // Reset the cached open-promise + close the current connection so the NEXT store call opens the
    // newly-active DB. migrateTags re-runs on the next init() (idempotent per-DB via its meta flag).
    const prev = dbp;
    dbp = null;
    if (prev) prev.then(db => db.close()).catch(() => {});
    return target;
  },

  // A13: the ONE synchronous persistence seam for small UI state (panel layout, workspace
  // templates) that must apply before paint, so it can't use the async IndexedDB path. Keeping
  // it here means no app/*.js touches localStorage directly — when the cloud tier lands, this is
  // the single place that mirrors layout state up. JSON-encodes values; never throws. F59: delegates
  // to the module-level ls* helpers the workspace registry also uses.
  local: {
    get(key, fallback) {
      return lsGet(key, fallback);
    },
    set(key, val) {
      return lsSet(key, val);
    },
    remove(key) {
      lsRemove(key);
    },
  },
};
