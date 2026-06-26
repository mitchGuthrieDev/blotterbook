"use strict";
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
(function () {
  // The staging sandbox uses an isolated database so it never touches real data.
  const DB_NAME = (typeof document !== 'undefined' && document.body && document.body.dataset.mode === 'staging')
    ? 'blotterbookStaging' : 'tradingJournal';
  const DB_VERSION = 2;
  const TRADES = 'trades';
  const JOURNAL = 'journal';
  const META = 'meta';
  const TRADEMETA = 'trademeta';   // per-trade tags / note / screenshots, keyed by trade id

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

  const Store = {
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

    async saveJournal(date, text) {
      const store = await tx(JOURNAL, 'readwrite');
      const clean = (text || '').trim();
      if (clean) store.put({ date, text: clean, updated: Date.now() });
      else store.delete(date);
      return done(store);
    },

    async getJournal(date) {
      const store = await tx(JOURNAL, 'readonly');
      const rec = await reqP(store.get(date));
      return rec ? rec.text : '';
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
      const cleanSym = s => (window.Adapters && Adapters.rootSym) ? Adapters.rootSym(String(s || ''))
        : String(s || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '');
      const cleanTag = s => String(s == null ? '' : s).replace(/[<>&"']/g, '');
      if (Array.isArray(data.trades) && data.trades.length) {
        for (const t of data.trades) { if (t && t.root != null) t.root = cleanSym(t.root); }
        const r = await this.addTrades(data.trades);
        added = r.added; dup = r.duplicate;
      }
      if (Array.isArray(data.journal) && data.journal.length) {
        const store = await tx(JOURNAL, 'readwrite');
        for (const j of data.journal) {
          if (j && j.date && j.text) store.put({ date: j.date, text: j.text, updated: j.updated || Date.now() });
        }
        await done(store);
      }
      if (Array.isArray(data.meta) && data.meta.length) {
        const store = await tx(META, 'readwrite');
        for (const mm of data.meta) { if (mm && mm.key != null) store.put({ key: mm.key, value: mm.value }); }
        await done(store);
      }
      if (Array.isArray(data.trademeta) && data.trademeta.length) {
        const store = await tx(TRADEMETA, 'readwrite');
        for (const tm of data.trademeta) {
          if (tm && tm.id) store.put({ id: tm.id, tags: (tm.tags || []).map(cleanTag).filter(Boolean), note: tm.note || '', shots: tm.shots || [], updated: tm.updated || Date.now() });
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
    }
  };

  window.Store = Store;
})();
