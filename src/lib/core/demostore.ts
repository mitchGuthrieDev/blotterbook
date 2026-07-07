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
import { tradeId, validShot, cleanTags, setField, LOCAL_BACKUP_RE, sha256Hex, suppressedByTombstone, tombstoneKey } from './store.ts';
import type { Annotation, Trade, StoredJournal, StoredTradeMeta, StoreLike, CsvFileRec, Tombstone, Workspace } from './types.ts';

// F59: demo is a SINGLE in-memory workspace and never persists — the workspace dimension is inert.
// One synthetic entry (no real IndexedDB name), and every workspace mutation is a safe no-op, so
// nothing ever reaches IndexedDB/localStorage (the "demo never persists" invariant holds by construction).
const DEMO_WORKSPACE: Workspace = { id: 'demo', name: 'Demo', dbName: 'demo', createdAt: 0 };

export function createDemoStore(): StoreLike {
  const trades = new Map<string, Trade>(); // id -> {id, ...trade}
  const journal = new Map<string, StoredJournal>(); // date -> {date,text,tags,shots,updated}
  const meta = new Map<string, { value: unknown; updated: number }>(); // key -> {value, updated} (F58 clock)
  const trademeta = new Map<string, StoredTradeMeta>(); // id -> {id,tags,note,shots,updated}
  const files = new Map<string, CsvFileRec>(); // F37 parity: id -> file record (metadata)
  const filetexts = new Map<string, string>(); // id -> raw CSV text
  const tombstones = new Map<string, Tombstone>(); // F58/A269 parity: `${type}:${id}` -> {id,type,updated} delete-log
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

    /* ---- F59 workspaces: demo is one in-memory workspace; every mutation is a non-persisting no-op ---- */
    activeWorkspace() {
      return DEMO_WORKSPACE;
    },
    listWorkspaces() {
      return [DEMO_WORKSPACE];
    },
    createWorkspace() {
      return DEMO_WORKSPACE; // no-op: demo can't add a workspace (nothing persists)
    },
    adoptWorkspace() {
      return DEMO_WORKSPACE; // no-op: demo never syncs, so there is nothing to adopt (A298)
    },
    renameWorkspace() {
      return DEMO_WORKSPACE; // no-op
    },
    async deleteWorkspace() {
      return DEMO_WORKSPACE; // no-op: the single demo workspace is never removed
    },
    async setActiveWorkspace() {
      return DEMO_WORKSPACE; // no-op: there is only one demo workspace
    },

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
          for (const k of ['qty', 'entryTime', 'exitTime', 'holdMs', 'commission', 'entryPrice', 'exitPrice'] as const)
            if (prev[k] == null && t[k] != null) {
              next = next ?? { ...prev };
              setField(next, k, t[k]);
            }
          if (next) {
            next.updated = Date.now(); // F58 parity: LWW clock on the enrichment write
            trades.set(id, next);
          }
          continue;
        }
        // F58/A269 parity: suppress resurrecting a trade the user deleted (same isolated predicate);
        // look up the TRADE tombstone via the composite key so a trademeta tombstone can't suppress it.
        if (suppressedByTombstone(tombstones.get(tombstoneKey('trade', id)), t)) continue;
        // A154 parity with Store.addTrades: computed id last, so an input `id` can't override it.
        trades.set(id, { ...t, id, updated: Date.now() }); // F58 parity: stamp the LWW clock
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
      tombstones.set(tombstoneKey('trade', id), { id, type: 'trade', updated: Date.now() }); // F58/A269 parity
    },
    async updateTrade(oldId, next, m) {
      const old = trademeta.get(oldId);
      trades.delete(oldId);
      tombstones.set(tombstoneKey('trade', oldId), { id: oldId, type: 'trade', updated: Date.now() }); // F58: tombstone the OLD id
      trademeta.delete(oldId);
      const id = tradeId(next);
      tombstones.delete(tombstoneKey('trade', id)); // F58: an editor re-add is explicit, not an import — don't suppress it
      if (!trades.has(id)) trades.set(id, { ...next, id, updated: Date.now() });
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
      else {
        // A252 parity: clearing to empty records a tombstone (so the delete syncs, no resurrection).
        journal.delete(date);
        tombstones.set(tombstoneKey('journal', date), { id: date, type: 'journal', updated: Date.now() });
      }
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
      tombstones.set(tombstoneKey('journal', date), { id: date, type: 'journal', updated: Date.now() }); // F58/A269 parity
    },

    async getAllMeta() {
      return [...meta.entries()].map(([key, { value, updated }]) => ({ key, value, updated }));
    },
    async setMeta(key, value) {
      meta.set(key, { value, updated: Date.now() }); // F58 parity: LWW clock on meta writes
    },
    async getMeta(key) {
      return meta.get(key)?.value;
    },

    async getTradeMeta(id) {
      return trademeta.get(id) || { id, tags: [], note: '', shots: [] };
    },
    async saveTradeMeta(id, m) {
      const tags = cleanTags(m.tags); // A130: parity with the real Store's canonical tag form
      const note = (m.note || '').trim();
      const shots = (m.shots || []).filter(validShot);
      if (tags.length || note || shots.length) trademeta.set(id, { id, tags, note, shots, updated: Date.now() });
      else {
        // A252 parity: an empty clear records a tombstone (so the delete syncs, no resurrection).
        trademeta.delete(id);
        tombstones.set(tombstoneKey('trademeta', id), { id, type: 'trademeta', updated: Date.now() });
      }
    },
    async deleteTradeMeta(id) {
      trademeta.delete(id);
      tombstones.set(tombstoneKey('trademeta', id), { id, type: 'trademeta', updated: Date.now() }); // F58/A269 parity
    },
    async allTradeMeta() {
      return [...trademeta.values()];
    },
    async getTombstones() {
      return [...tombstones.values()];
    },

    /* ---- F37 per-file CSV provenance (in-memory parity with Store) ---- */
    async getFiles() {
      return [...files.values()].sort((a, b) => (a.imported < b.imported ? 1 : a.imported > b.imported ? -1 : 0));
    },
    async addFile(rec, text) {
      files.set(rec.id, { ...rec, id: rec.id, updated: Date.now() }); // F58 parity: LWW clock
      filetexts.set(rec.id, text);
    },
    async updateFile(id, patch) {
      const prev = files.get(id);
      if (prev) files.set(id, { ...prev, ...patch, id, updated: Date.now() }); // F58 parity: LWW clock
    },
    async deleteFile(id) {
      files.delete(id);
      filetexts.delete(id);
      let removedTrades = 0;
      for (const [tid, rec] of trades) {
        if (!rec.fileIds || !rec.fileIds.includes(id)) continue;
        const rest = rec.fileIds.filter(f => f !== id);
        if (rest.length) trades.set(tid, { ...rec, fileIds: rest, updated: Date.now() });
        else {
          trades.delete(tid);
          trademeta.delete(tid); // A216: no orphaned meta
          tombstones.set(tombstoneKey('trade', tid), { id: tid, type: 'trade', updated: Date.now() }); // F58/A269 parity
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
      // A236 parity: export v3 with the Store.local layout keys + a payload checksum, from the
      // in-memory `mem` seam (demo persists nothing, so these live only for the session).
      const local: Record<string, unknown> = {};
      for (const [k, v] of mem) if (LOCAL_BACKUP_RE.test(k)) local[k] = v;
      const payload = {
        app: 'blotterbook',
        version: 3,
        exportedAt: new Date().toISOString(),
        trades: await this.getAllTrades(),
        journal: await this.getAllJournal(),
        meta: await this.getAllMeta(),
        trademeta: await this.allTradeMeta(),
        files: await this.getFiles(),
        filetexts: [...filetexts.entries()].map(([id, text]) => ({ id, text })),
        local,
      };
      const checksum = await sha256Hex(JSON.stringify(payload));
      return { ...payload, checksum };
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
      tombstones.clear(); // F58 parity: a purge is a clean slate, not deletions to propagate
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
