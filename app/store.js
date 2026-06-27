"use strict";
import { Adapters } from './adapters.js';
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
const DB_NAME = (typeof document !== 'undefined' && document.body && document.body.dataset.mode === 'staging')
  ? 'blotterbookStaging' : 'blotterbook';
const DB_VERSION = 2;
const TRADES = 'trades';
const JOURNAL = 'journal';
const META = 'meta';
const TRADEMETA = 'trademeta';   // per-trade tags / note / screenshots, keyed by trade id

// Screenshots are inlined data: URIs rendered straight into an <img src>. Only well-formed base64
// image data URIs are allowed — this drops any `javascript:`/`data:text/html`/SVG payload before it
// can reach a render sink (S15/S18). Shared by importAll (restore) and the live capture path.
const SHOT_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

let dbp = null; // cached open-promise

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRADES)) db.createObjectStore(TRADES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TRADEMETA)) db.createObjectStore(TRADEMETA, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
function done(t) {
  return new Promise((resolve, reject) => {
    t.transaction.oncomplete = () => resolve();
    t.transaction.onerror = () => reject(t.transaction.error);
    t.transaction.onabort = () => reject(t.transaction.error);
  });
}
function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/* Stable, order-independent dedupe key for a trade. Two CSV exports
   that overlap will produce identical ids for the shared rows, so a
   re-upload only inserts the genuinely new trades. */
function tradeId(t) {
  const raw = `${t.time}|${t.symbol}|${t.side}|${t.pnl}`;
  // FNV-1a 32-bit — small, dependency-free, good enough for dedupe.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const Store = {
  available() { return typeof indexedDB !== 'undefined'; },

  async init() { await open(); return true; },

  tradeId,

  async addTrades(trades) {
    // Read every existing id up front (one request), then issue all puts in a single
    // synchronous loop. The previous version awaited a get() per trade inside one
    // readwrite transaction; on a large import the transaction would auto-commit while a
    // get() promise was still settling, throwing TransactionInactiveError on the next put
    // (B6). With no awaits between puts the transaction stays live to completion. The id
    // Set also dedupes rows repeated within the same batch.
    const ro = await tx(TRADES, 'readonly');
    const existing = new Set(await reqP(ro.getAllKeys()));
    let added = 0, duplicate = 0;
    const store = await tx(TRADES, 'readwrite');
    for (const t of trades) {
      const id = tradeId(t);
      if (existing.has(id)) { duplicate++; continue; }
      existing.add(id);
      store.put({ id, ...t });
      added++;
    }
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
    const r = (typeof rec === 'string') ? { text: rec } : (rec || {});
    const text = (r.text || '').trim();
    const tags = Array.isArray(r.tags) ? r.tags.filter(Boolean) : [];
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
    return new Set(keys);
  },

  async deleteTrade(id) {
    const store = await tx(TRADES, 'readwrite');
    store.delete(id);
    return done(store);
  },

  async getAllJournal() {
    const store = await tx(JOURNAL, 'readonly');
    const all = await reqP(store.getAll());
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
    const rec = await reqP(store.get(id));
    return rec || { id, tags: [], note: '', shots: [] };
  },
  async saveTradeMeta(id, m) {
    const store = await tx(TRADEMETA, 'readwrite');
    const tags = (m.tags || []).filter(Boolean);
    const note = (m.note || '').trim();
    const shots = m.shots || [];
    if (tags.length || note || shots.length) store.put({ id, tags, note, shots, updated: Date.now() });
    else store.delete(id);   // empty → remove the record
    return done(store);
  },
  async deleteTradeMeta(id) {
    const store = await tx(TRADEMETA, 'readwrite');
    store.delete(id);
    return done(store);
  },
  async allTradeMeta() {
    const store = await tx(TRADEMETA, 'readonly');
    return reqP(store.getAll());
  },

  /* Full local snapshot — for the data manager's backup/export. */
  async exportAll() {
    const [trades, journal, meta, trademeta] = await Promise.all([
      this.getAllTrades(), this.getAllJournal(), this.getAllMeta(), this.allTradeMeta()
    ]);
    return { app: 'blotterbook', version: 2, exportedAt: new Date().toISOString(), trades, journal, meta, trademeta };
  },

  /* Merge a backup back in: trades de-dupe, notes & meta upsert. */
  async importAll(data) {
    let added = 0, dup = 0;
    // Sanitize at the trust boundary: a backup file is untrusted input (unlike CSV
    // import, which routes symbols through rootSym()). Force `root` to the safe
    // charset and strip markup-significant chars from tags, so restored data can't
    // become a stored-XSS payload in any (current or future) render sink.
    const cleanSym = s => (Adapters && Adapters.rootSym) ? Adapters.rootSym(String(s || ''))
      : String(s || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '');
    // B29: lowercase to match the live editors' canonical form (annCapture lowercases + dedupes),
    // so restored tags match the tag filter/chips. cleanTags also dedupes, like the live path.
    const cleanTag = s => String(s == null ? '' : s).replace(/[<>&"']/g, '').trim().toLowerCase();
    const cleanTags = a => [...new Set((Array.isArray(a) ? a : []).map(cleanTag).filter(Boolean))];
    // Restore is untrusted: keep ONLY well-formed base64 image data URIs (S15, SHOT_RE above).
    const cleanShots = a => (Array.isArray(a) ? a.filter(s => typeof s === 'string' && SHOT_RE.test(s)) : []);
    // S17: a restored `date` flows into innerHTML sinks (the data-manager trades/day-notes lists),
    // and the CSV path validates dates but addTrades/journal-restore did not. Require canonical
    // YYYY-MM-DD (and a finite pnl for trades) here so a crafted backup can't smuggle markup in.
    const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
    if (Array.isArray(data.trades) && data.trades.length) {
      const clean = [];
      for (const t of data.trades) {
        if (!t || !validDate(t.date) || !Number.isFinite(+t.pnl)) continue;
        if (t.root != null) t.root = cleanSym(t.root);
        clean.push(t);
      }
      const r = await this.addTrades(clean);
      added = r.added; dup = r.duplicate;
    }
    if (Array.isArray(data.journal) && data.journal.length) {
      const store = await tx(JOURNAL, 'readwrite');
      for (const j of data.journal) {
        if (!j || !validDate(j.date)) continue;
        const text = String(j.text || '').trim();
        const tags = cleanTags(j.tags);   // F16: restore tags/shots too (B29: lowercased + deduped)
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
    const cleanSavedFilters = a => (Array.isArray(a) ? a : []).map(s => {
      if (!s || typeof s !== 'object') return null;
      const id = String(s.id == null ? '' : s.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
      if (!id) return null;
      const name = String(s.name == null ? '' : s.name).replace(/[<>&"']/g, '').trim().slice(0, 80);
      const src = (s.f && typeof s.f === 'object') ? s.f : {};
      const f = {};
      for (const k of FILTER_FIELDS) f[k] = String(src[k] == null ? '' : src[k]).replace(/[<>&"']/g, '').slice(0, 64);
      f.dows = Array.isArray(src.dows) ? src.dows.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
      return { id, name, f };
    }).filter(Boolean);
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
        if (tm && tm.id) store.put({ id: tm.id, tags: cleanTags(tm.tags), note: tm.note || '', shots: cleanShots(tm.shots), updated: tm.updated || Date.now() });
      }
      await done(store);
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
    await Promise.all([TRADES, JOURNAL, META, TRADEMETA].map(name => {
      const store = db.transaction(name, 'readwrite').objectStore(name);
      store.clear();
      return done(store);
    }));
    return true;
  },

  // S18: shared screenshot validator so the live capture path enforces the same data-URI
  // allow-list as restore (rejects SVG / javascript: / data:text payloads).
  validShot(s) { return typeof s === 'string' && SHOT_RE.test(s); },

  // A13: the ONE synchronous persistence seam for small UI state (panel layout, workspace
  // templates) that must apply before paint, so it can't use the async IndexedDB path. Keeping
  // it here means no app/*.js touches localStorage directly — when the cloud tier lands, this is
  // the single place that mirrors layout state up. JSON-encodes values; never throws.
  local: {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (_) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { } }
  }
};
