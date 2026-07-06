/* Blotterbook · CloudStore (F63 — synced workspaces, step 6). A `StoreLike` (A4) that WRAPS the
 * local Store to add write-behind cloud sync WITHOUT any screen/dashboard change — every consumer
 * still depends only on the interface.
 *
 *   · READS delegate straight to the wrapped local Store (offline-first; the network is NEVER on the
 *     read path — compute stays 100% local, the S25 moat).
 *   · WRITES delegate to the local Store, then fire `onWrite()` so the controller can enqueue a
 *     DEBOUNCED encrypted push of what changed. The write itself never blocks on the network and
 *     never throws into the UI if sync is paused.
 *
 * Selection: created for a cloud-tier session on the staging surface (App.svelte); it is a pure
 * pass-through until a workspace is actually opted into sync (the controller's `onWrite` no-ops when
 * sync is off/locked/offline). DemoStore is NEVER wrapped — demo never syncs, by construction. */

import type { StoreLike, Trade, Annotation, TradeMeta, CsvFileRec, Workspace } from '../../lib/core/types.ts';

/**
 * Wrap a local `StoreLike` so every data-mutating method also notifies `onWrite`. `onWrite` must be
 * cheap and never throw — it schedules a debounced push; the actual encrypt/upload happens off the
 * write path. Reads, workspace ops, and the `local` seam pass straight through.
 */
export function createCloudStore(local: StoreLike, onWrite: () => void): StoreLike {
  // Fire-and-forget the write notification AFTER the local write resolves, so a push only ever sees
  // durably-written records. Guarded so a controller bug can't surface as a failed store write.
  const notify = () => {
    try {
      onWrite();
    } catch {
      /* sync scheduling must never break a local write */
    }
  };

  return {
    // ── passthrough: capabilities, ids, workspaces, the sync localStorage seam ──────────────────
    available: () => local.available(),
    init: () => local.init(),
    tradeId: t => local.tradeId(t),
    validShot: s => local.validShot(s),
    activeWorkspace: () => local.activeWorkspace(),
    listWorkspaces: () => local.listWorkspaces(),
    createWorkspace: (name: string): Workspace => local.createWorkspace(name),
    renameWorkspace: (id: string, name: string) => local.renameWorkspace(id, name),
    deleteWorkspace: (id: string) => local.deleteWorkspace(id),
    setActiveWorkspace: (id: string) => local.setActiveWorkspace(id),
    local: local.local,

    // ── reads: straight delegation (offline-first; network never on the read path) ──────────────
    getAllTrades: () => local.getAllTrades(),
    tradeCount: () => local.tradeCount(),
    getJournal: (date: string) => local.getJournal(date),
    journalDates: () => local.journalDates(),
    getAllJournal: () => local.getAllJournal(),
    getAllMeta: () => local.getAllMeta(),
    getTradeMeta: (id: string) => local.getTradeMeta(id),
    allTradeMeta: () => local.allTradeMeta(),
    getTombstones: () => local.getTombstones(),
    getFiles: () => local.getFiles(),
    getFileText: (id: string) => local.getFileText(id),
    filesBytes: () => local.filesBytes(),
    getMeta: (key: string) => local.getMeta(key),
    exportAll: () => local.exportAll(),

    // ── writes: delegate, then schedule a debounced encrypted push of the changed records ───────
    async addTrades(trades: Trade[]) {
      const r = await local.addTrades(trades);
      notify();
      return r;
    },
    async deleteTrade(id: string) {
      const r = await local.deleteTrade(id);
      notify();
      return r;
    },
    async updateTrade(oldId: string, next: Trade, meta?: { tags?: string[]; note?: string; shots?: string[] }) {
      const r = await local.updateTrade(oldId, next, meta);
      notify();
      return r;
    },
    async saveJournal(date: string, rec: string | Annotation) {
      const r = await local.saveJournal(date, rec);
      notify();
      return r;
    },
    async deleteJournal(date: string) {
      const r = await local.deleteJournal(date);
      notify();
      return r;
    },
    async saveTradeMeta(id: string, m: TradeMeta) {
      const r = await local.saveTradeMeta(id, m);
      notify();
      return r;
    },
    async deleteTradeMeta(id: string) {
      const r = await local.deleteTradeMeta(id);
      notify();
      return r;
    },
    async addFile(rec: CsvFileRec, text: string) {
      const r = await local.addFile(rec, text);
      notify();
      return r;
    },
    async updateFile(id: string, patch: Partial<CsvFileRec>) {
      const r = await local.updateFile(id, patch);
      notify();
      return r;
    },
    async deleteFile(id: string) {
      const r = await local.deleteFile(id);
      notify();
      return r;
    },
    async setMeta(key: string, value: unknown) {
      const r = await local.setMeta(key, value);
      notify();
      return r;
    },
    async importAll(data: Record<string, unknown>) {
      const r = await local.importAll(data);
      notify();
      return r;
    },
    // A purge is a local clean slate (it clears tombstones too — nothing to propagate), so it fires
    // NO push. A254: the controller subscribes to the `data:erased` bus event (emitted by
    // dashboard.purgeAll right after this resolves) and there DISABLES sync + resets the workspace's
    // cursor/pushed-watermark — so the next reconcile can't re-download the purged records.
    purge: () => local.purge(),
  };
}
