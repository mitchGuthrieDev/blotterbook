'use strict';
/* Blotterbook · DemoStore (A31) — an in-memory implementation of the Store interface (A4) for the
   DEMO surface. It backs every read/write with plain Maps/arrays and touches NEITHER IndexedDB NOR
   localStorage, so the HARD "demo never persists" invariant holds by construction: anything written
   is lost on reload, and nothing can leak to disk. The Svelte app picks Store vs DemoStore at boot
   by PAGE_MODE, so the view code is identical across surfaces — exactly the swap the Store seam was
   designed for. Demo also disables data-writing controls in the UI (A33); the in-memory writes here
   are a belt-and-suspenders fallback.

   The dedupe key (tradeId) and the screenshot allow-list (validShot) are imported VERBATIM from
   store.js (A29) so they can never drift from the real backend. Backup restore (importAll) is a
   no-op in demo (restore is disabled), avoiding any duplication of store.js's sanitization. */
import { tradeId, validShot, cleanTags, setField } from './store.ts';
import type { Annotation, Trade, StoredJournal, StoredTradeMeta, StoreLike, CsvFileRec } from './types.ts';

export function createDemoStore(): StoreLike {
  const trades = new Map<string, Trade>(); // id -> {id, ...trade}
  const journal = new Map<string, StoredJournal>(); // date -> {date,text,tags,shots,updated}
  const meta = new Map<string, unknown>(); // key -> value
  const trademeta = new Map<string, StoredTradeMeta>(); // id -> {id,tags,note,shots,updated}
  const files = new Map<string, CsvFileRec>(); // F37 parity: id -> file record (metadata)
  const filetexts = new Map<string, string>(); // id -> raw CSV text
  const mem = new Map<string, unknown>(); // in-memory stand-in for Store.local (no localStorage)

  const sortByTime = (arr: Trade[]) => arr.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  return {
    available() {
      return true;
    },
    async init() {
      return true;
    },
    tradeId,
    validShot,

    async addTrades(list) {
      let added = 0,
        duplicate = 0;
      for (const t of list) {
        const id = tradeId(t);
        const prev = trades.get(id);
        if (prev) {
          duplicate++;
          // F37 parity: merge incoming provenance into the existing record's fileIds array, and
          // let a richer duplicate ENRICH missing fields (same rule as Store.addTrades — never
          // overwrite, identity fields untouched).
          let next: Trade | null = null;
          if (t.fileIds?.length) {
            const merged = [...new Set([...(prev.fileIds || []), ...t.fileIds])];
            if (merged.length !== (prev.fileIds || []).length) next = { ...prev, fileIds: merged };
          }
          for (const k of ['qty', 'entryTime', 'exitTime', 'holdMs', 'commission'] as const)
            if (prev[k] == null && t[k] != null) {
              next = next ?? { ...prev };
              setField(next, k, t[k]);
            }
          if (next) trades.set(id, next);
          continue;
        }
        // A154 parity with Store.addTrades: computed id last, so an input `id` can't override it.
        trades.set(id, { ...t, id });
        added++;
      }
      return { added, duplicate, total: trades.size };
    },
    async getAllTrades() {
      return sortByTime([...trades.values()]);
    },
    async tradeCount() {
      return trades.size;
    },
    async deleteTrade(id) {
      trades.delete(id);
    },
    async updateTrade(oldId, next, m) {
      const old = trademeta.get(oldId);
      trades.delete(oldId);
      trademeta.delete(oldId);
      const id = tradeId(next);
      if (!trades.has(id)) trades.set(id, { ...next, id });
      const tags = cleanTags(m?.tags ?? old?.tags ?? []);
      const note = (m?.note ?? old?.note ?? '').trim();
      const shots = m?.shots ?? old?.shots ?? [];
      if (tags.length || note || shots.length) trademeta.set(id, { id, tags, note, shots, updated: Date.now() });
      return { id };
    },

    async saveJournal(date, rec) {
      const r: Annotation = typeof rec === 'string' ? { text: rec } : rec || {};
      const text = (r.text || '').trim();
      const tags = cleanTags(r.tags); // A130: parity with the real Store's canonical tag form
      const shots = Array.isArray(r.shots) ? r.shots.filter(validShot) : [];
      if (text || tags.length || shots.length) journal.set(date, { date, text, tags, shots, updated: Date.now() });
      else journal.delete(date);
    },
    async getJournal(date) {
      const rec = journal.get(date);
      return { text: (rec && rec.text) || '', tags: (rec && rec.tags) || [], shots: (rec && rec.shots) || [] };
    },
    async journalDates() {
      return new Set(journal.keys());
    },
    async getAllJournal() {
      return [...journal.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },
    async deleteJournal(date) {
      journal.delete(date);
    },

    async getAllMeta() {
      return [...meta.entries()].map(([key, value]) => ({ key, value }));
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
    async getMeta(key) {
      return meta.get(key);
    },

    async getTradeMeta(id) {
      return trademeta.get(id) || { id, tags: [], note: '', shots: [] };
    },
    async saveTradeMeta(id, m) {
      const tags = cleanTags(m.tags); // A130: parity with the real Store's canonical tag form
      const note = (m.note || '').trim();
      const shots = (m.shots || []).filter(validShot);
      if (tags.length || note || shots.length) trademeta.set(id, { id, tags, note, shots, updated: Date.now() });
      else trademeta.delete(id);
    },
    async deleteTradeMeta(id) {
      trademeta.delete(id);
    },
    async allTradeMeta() {
      return [...trademeta.values()];
    },

    /* ---- F37 per-file CSV provenance (in-memory parity with Store) ---- */
    async getFiles() {
      return [...files.values()].sort((a, b) => (a.imported < b.imported ? 1 : a.imported > b.imported ? -1 : 0));
    },
    async addFile(rec, text) {
      files.set(rec.id, { ...rec, id: rec.id });
      filetexts.set(rec.id, text);
    },
    async updateFile(id, patch) {
      const prev = files.get(id);
      if (prev) files.set(id, { ...prev, ...patch, id });
    },
    async deleteFile(id) {
      files.delete(id);
      filetexts.delete(id);
      let removedTrades = 0;
      for (const [tid, rec] of trades) {
        if (!rec.fileIds || !rec.fileIds.includes(id)) continue;
        const rest = rec.fileIds.filter(f => f !== id);
        if (rest.length) trades.set(tid, { ...rec, fileIds: rest });
        else {
          trades.delete(tid);
          removedTrades++;
        }
      }
      return { removedTrades };
    },
    async getFileText(id) {
      return filetexts.get(id);
    },
    async filesBytes() {
      return [...files.values()].reduce((a, f) => a + (Number(f.size) || 0), 0);
    },

    async exportAll() {
      return {
        app: 'blotterbook',
        version: 2,
        exportedAt: new Date().toISOString(),
        trades: await this.getAllTrades(),
        journal: await this.getAllJournal(),
        meta: await this.getAllMeta(),
        trademeta: await this.allTradeMeta(),
        files: await this.getFiles(),
        filetexts: [...filetexts.entries()].map(([id, text]) => ({ id, text })),
      };
    },
    // Restore is disabled on the demo surface; no-op (avoids duplicating store.js's sanitization).
    async importAll() {
      return { added: 0, dup: 0 };
    },

    async purge() {
      trades.clear();
      journal.clear();
      meta.clear();
      trademeta.clear();
      files.clear();
      filetexts.clear();
      return true;
    },

    // In-memory stand-in for Store.local — demo UI prefs don't persist either.
    local: {
      get(key, fallback) {
        return mem.has(key) ? mem.get(key) : fallback;
      },
      set(key, val) {
        mem.set(key, val);
        return true;
      },
      remove(key) {
        mem.delete(key);
      },
    },
  };
}
