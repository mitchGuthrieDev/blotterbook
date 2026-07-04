'use strict';
import { Adapters } from './adapters.ts';
import { checkCsvText } from './intake.ts';
import type { Trade, Annotation, StoredJournal, StoredTradeMeta, StoreLike, CsvFileRec } from './types.ts';
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
const DB_NAME =
  typeof document !== 'undefined' && document.body && document.body.dataset.mode === 'staging' ? 'blotterbookStaging' : 'blotterbook';
const DB_VERSION = 3; // v3 (F37): + files / filetext stores for per-file CSV provenance
const TRADES = 'trades';
const JOURNAL = 'journal';
const META = 'meta';
const TRADEMETA = 'trademeta'; // per-trade tags / note / screenshots, keyed by trade id
const FILES = 'files'; // imported-CSV metadata records (F37), keyed by content-hash id
const FILETEXT = 'filetext'; // raw CSV text per file, keyed by the same id — split from the
// metadata row so listing the library never loads megabytes of text

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

let dbp: Promise<IDBDatabase> | null = null; // cached open-promise

function open() {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRADES)) db.createObjectStore(TRADES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TRADEMETA)) db.createObjectStore(TRADEMETA, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILETEXT)) db.createObjectStore(FILETEXT, { keyPath: 'id' });
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
  // NOTE fileIds/commission (F37/A208) are deliberately NOT hashed — provenance and real costs
  // must never change a trade's identity, or re-imports would stop deduping.
  return fnv(`${t.time}|${t.symbol}|${t.side}|${t.pnl}` + (t.dup ? `|${t.dup}` : ''));
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
    const ENRICH = ['qty', 'entryTime', 'exitTime', 'holdMs', 'commission'] as const;
    const store = await tx(TRADES, 'readwrite');
    let added = 0,
      duplicate = 0;
    await new Promise<void>((resolve, reject) => {
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
              existing.set(id, next);
              store.put(next);
            }
            continue;
          }
          // A154: computed id LAST so a crafted input object carrying its own `id` key (e.g. a
          // tampered backup) can never override the content hash the dedupe/meta paths rely on.
          // fileIds is copied to a plain array — a Svelte $state proxy would throw in the
          // structured clone (same rule as saveTradeMeta's .filter).
          const rec = t.fileIds ? { ...t, fileIds: [...t.fileIds], id } : { ...t, id };
          existing.set(id, rec);
          store.put(rec);
          added++;
        }
        resolve();
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
    const store = await tx(JOURNAL, 'readwrite');
    const r: Annotation = typeof rec === 'string' ? { text: rec } : rec || {};
    const text = (r.text || '').trim();
    const tags = cleanTags(r.tags); // A130: canonicalize live tags (same form as restore)
    const shots = Array.isArray(r.shots) ? r.shots.filter(s => this.validShot(s)) : [];
    if (text || tags.length || shots.length) store.put({ date, text, tags, shots, updated: Date.now() });
    else store.delete(date);
    return done(store);
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
    const store = await tx(TRADES, 'readwrite');
    store.delete(id);
    return done(store);
  },

  // Edit a trade's CORE fields. The id is a content hash (tradeId), so an edit is a delete-old +
  // add-new that migrates the per-trade metadata (tags/note/shots) to the new id. `meta` overrides the
  // tags/note (the editor may change them in the same save); shots carry over from the old record.
  // Returns the new id. Note: the new row goes through addTrades' dedupe (A114) — an edit whose fields
  // collide with an existing trade merges into it rather than duplicating.
  async updateTrade(oldId, next, meta) {
    const old = await this.getTradeMeta(oldId);
    await this.deleteTrade(oldId);
    await this.deleteTradeMeta(oldId);
    await this.addTrades([next]);
    const id = tradeId(next);
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
    const store = await tx(JOURNAL, 'readwrite');
    store.delete(date);
    return done(store);
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
    const store = await tx(TRADEMETA, 'readwrite');
    const tags = cleanTags(m.tags); // A130: canonicalize live tags (same form as restore)
    const note = (m.note || '').trim();
    // Enforce the screenshot allow-list here too (matches saveJournal — S15/S18); .filter also
    // yields a plain array, so a Svelte $state proxy can't reach IndexedDB's structured clone.
    const shots = (m.shots || []).filter(s => validShot(s));
    if (tags.length || note || shots.length) store.put({ id, tags, note, shots, updated: Date.now() });
    else store.delete(id); // empty → remove the record
    return done(store);
  },
  async deleteTradeMeta(id) {
    const store = await tx(TRADEMETA, 'readwrite');
    store.delete(id);
    return done(store);
  },
  async allTradeMeta() {
    const store = await tx(TRADEMETA, 'readonly');
    return reqP<StoredTradeMeta[]>(store.getAll());
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
    t.objectStore(FILES).put({ ...rec, id: rec.id });
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
        // id stays the content hash — a patch can't re-key the record.
        if (r.result) store.put({ ...r.result, ...patch, id });
        resolve();
      };
    });
    return done(store);
  },
  async deleteFile(id) {
    // One readwrite tx over FILES + FILETEXT + TRADES: drop the record + raw text, strip this id
    // from every trade's provenance, and DELETE trades whose provenance becomes empty — a trade
    // another file also contributed survives (the fileIds-array overlap model). Trades with NO
    // fileIds (imported pre-F37) are untouched. All puts/deletes are issued synchronously inside
    // getAll().onsuccess (B6 — no await mid-tx).
    const db = await open();
    const t = db.transaction([FILES, FILETEXT, TRADES], 'readwrite');
    t.objectStore(FILES).delete(id);
    t.objectStore(FILETEXT).delete(id);
    const tradeStore = t.objectStore(TRADES);
    let removedTrades = 0;
    await new Promise<void>((resolve, reject) => {
      const r = tradeStore.getAll();
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        for (const rec of r.result as Trade[]) {
          if (!rec.fileIds || !rec.fileIds.includes(id)) continue;
          const rest = rec.fileIds.filter(f => f !== id);
          if (rest.length) tradeStore.put({ ...rec, fileIds: rest });
          else {
            tradeStore.delete(rec.id as string);
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
    return { app: 'blotterbook', version: 2, exportedAt: new Date().toISOString(), trades, journal, meta, trademeta, files, filetexts };
  },

  /* Merge a backup back in: trades de-dupe, notes & meta upsert. */
  async importAll(data) {
    let added = 0,
      dup = 0;
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
        if (mm.key === 'savedFilters') store.put({ key: 'savedFilters', value: cleanSavedFilters(mm.value) });
        else if (mm.key === 'setup' && mm.value && typeof mm.value === 'object') store.put({ key: 'setup', value: mm.value });
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
    return { added, dup };
  },

  async setMeta(key, value) {
    const store = await tx(META, 'readwrite');
    store.put({ key, value });
    return done(store);
  },

  async getMeta(key) {
    const store = await tx(META, 'readonly');
    const rec = await reqP(store.get(key));
    return rec ? rec.value : undefined;
  },

  async purge() {
    const db = await open();
    await Promise.all(
      [TRADES, JOURNAL, META, TRADEMETA, FILES, FILETEXT].map(name => {
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

  // A13: the ONE synchronous persistence seam for small UI state (panel layout, workspace
  // templates) that must apply before paint, so it can't use the async IndexedDB path. Keeping
  // it here means no app/*.js touches localStorage directly — when the cloud tier lands, this is
  // the single place that mirrors layout state up. JSON-encodes values; never throws.
  local: {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (_) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    },
  },
};
