// Reactive dashboard state factory for the redesigned app shell (UI redesign, Phase 3 cutover).
// Boots the real engine (loadRefData → Store → restore/seed) and exposes the shared reactive data the
// redesign screens read — trades, filters, metrics (compute), cost (costModel), per-trade meta, setup,
// and the calendar cursor — plus the actions to mutate them. A .svelte.ts module so it can own runes.
// The same pure-logic core (A29) the current App.svelte drives; this just packages it for the new shell.
import {
  loadRefData,
  compute,
  costModel,
  sessionOf,
  emit,
  STATES,
  BROKERS,
  DEMO_BROKER,
  DEMO_FEED,
  DEMO_STATE,
} from '../../lib/core/core.ts';
import { Adapters } from '../../lib/core/adapters.ts';
import { cleanTags, fileId } from '../../lib/core/store.ts';
import { demoCSV } from '../../lib/core/sampledata.ts';
import type {
  Trade,
  FilterState,
  SavedFilter,
  SavedFilterDef,
  AppSetup,
  Setup,
  StoredTradeMeta,
  StoreLike,
  CsvFileRec,
  ParseResult,
} from '../../lib/core/types.ts';

/** Raw-CSV library budget (F37 owner decision): soft 50 MB cap, warn from 80%. */
export const FILE_BUDGET_BYTES = 50 * 1024 * 1024;

export function createDashboard(store: StoreLike, opts: { seed: boolean; isDemo?: boolean }) {
  // Demo mounts the in-memory DemoStore (nothing persists by construction), but every write path is
  // ALSO isDemo-guarded here (A87 belt-and-suspenders) and the UI disables the controls — so demo can
  // never mutate, even if a real Store were passed by mistake.
  const isDemo = !!opts.isDemo;
  let allTrades = $state<Trade[]>([]);
  let csvFiles = $state<CsvFileRec[]>([]); // F37: the imported-CSV library (metadata; texts stay in the Store)
  let loaded = $state(false);
  let error = $state('');
  let journalDates = $state<Set<string>>(new Set());
  let journal = $state<Map<string, { text: string; tags: string[]; shots: string[] }>>(new Map());
  let tradeMeta = $state<Map<string, StoredTradeMeta>>(new Map());
  let savedFilters = $state<SavedFilter[]>([]);
  let setup = $state<AppSetup>({ broker: '', feed: '', stateAbbr: '', platform: 0 });
  let filters = $state<FilterState>({ scope: 'all', from: '', to: '', root: '', side: '', session: '', tag: '', dows: [] });
  let calYear = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth());

  const inMonth = (t: Trade, y: number, m: number) => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  };
  function applyFilters(trades: Trade[], f: FilterState) {
    return trades.filter(t => {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.root && t.root !== f.root) return false;
      if (f.side && t.side !== f.side) return false;
      if (f.session && sessionOf(t) !== f.session) return false;
      if (f.tag) {
        const m = tradeMeta.get(store.tradeId(t));
        if (!m || !(m.tags || []).includes(f.tag)) return false;
      }
      if (f.dows.length && !f.dows.includes(new Date(t.date + 'T00:00:00').getDay())) return false;
      return true;
    });
  }

  const filtered = $derived(applyFilters(allTrades, filters));
  const metricsAll = $derived(compute(filtered));
  const metricsActive = $derived(filters.scope === 'month' ? compute(filtered.filter(t => inMonth(t, calYear, calMonth))) : metricsAll);
  const roots = $derived([...new Set(allTrades.map(t => t.root).filter(Boolean))].sort());
  const tags = $derived([...new Set([...tradeMeta.values()].flatMap(m => m.tags || []))].sort());
  // The day-journal (context) tag vocabulary — feeds the Calendar tag-input autocomplete (A167);
  // kept separate from the per-trade `tags` above per the R17 two-scope model.
  const journalTags = $derived([...new Set([...journal.values()].flatMap(j => j.tags || []))].sort());
  // A211: per-file broker overrides → a per-trade resolver. A trade's broker = the override of
  // its NEWEST-imported contributing file that has one (csvFiles is already newest-first), else
  // undefined → costModel falls back to the global setup broker. No overrides = no resolver, so
  // the common case costs nothing.
  const brokerFor = $derived.by(() => {
    const overridden = new Map(csvFiles.filter(f => f.broker).map(f => [f.id, f.broker as string]));
    if (!overridden.size) return undefined;
    return (t: Trade) => {
      if (!t.fileIds?.length) return undefined;
      for (const f of csvFiles) if (overridden.has(f.id) && t.fileIds.includes(f.id)) return overridden.get(f.id);
      return undefined;
    };
  });
  const costInputs = $derived({
    broker: setup.broker,
    platform: setup.platform,
    feedCost: setup.feed ? parseFloat(setup.feed.split('|')[1]) || 0 : 0,
    stateRate: STATES.find(s => s[0] === setup.stateAbbr)?.[1] ?? 0,
    brokerFor,
  });
  const cost = $derived(costModel(metricsActive, costInputs));
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');

  // F37: build the file record + provenance-stamped trades for a successful parse. `size`/`rows`
  // come from the raw text; overlap is patched in after addTrades reports duplicates.
  function fileRecFor(text: string, name: string, r: ParseResult): { rec: CsvFileRec; trades: Trade[] } {
    const fid = fileId(text);
    const trades = (r.trades || []).map(t => ({ ...t, fileIds: [fid] }));
    const rec: CsvFileRec = {
      id: fid,
      name,
      platform: r.platform || '',
      platformLabel: r.label || 'CSV',
      size: text.length,
      rows: Math.max(0, text.trim().split(/\r?\n/).length - 1),
      tradeCount: trades.length,
      overlap: 0,
      from: trades[0]?.date ?? '',
      to: trades[trades.length - 1]?.date ?? '',
      imported: new Date().toISOString(),
      included: true,
    };
    return { rec, trades };
  }

  async function seedIfEmpty() {
    if ((await store.tradeCount()) > 0) return;
    const text = demoCSV();
    const r = Adapters.parse(text, 'tradingview');
    if (r.ok && r.trades && r.trades.length) {
      // Seed through the same per-file path as a real import, so the CSV Library shows a real
      // sample-file row on demo/staging (in-memory on demo — never persists, by construction).
      const { rec, trades } = fileRecFor(text, 'sample-trades.csv', r);
      const res = await store.addTrades(trades);
      await store.addFile({ ...rec, overlap: res.duplicate }, text);
      await store.setMeta('setup', { broker: DEMO_BROKER, feed: DEMO_FEED, state: DEMO_STATE, platform: '35' });
    }
  }
  async function reloadAll() {
    // F37: the ACTIVE dataset excludes trades whose every contributing file is toggled off in the
    // CSV Library. No fileIds (pre-F37 import) = always included; an id with no surviving record
    // (defensive) counts as included rather than silently hiding data.
    csvFiles = await store.getFiles();
    const excluded = new Set(csvFiles.filter(f => !f.included).map(f => f.id));
    const raw = await store.getAllTrades();
    allTrades = excluded.size ? raw.filter(t => !t.fileIds?.length || t.fileIds.some(id => !excluded.has(id))) : raw;
    journalDates = await store.journalDates();
    journal = new Map(
      (await store.getAllJournal()).map(j => [j.date, { text: j.text || '', tags: j.tags || [], shots: j.shots || [] }] as const)
    );
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m] as const));
    savedFilters = ((await store.getMeta('savedFilters')) as SavedFilter[]) || [];
  }
  async function boot() {
    // A195: 'session initiated' (app:ready) leads the activity log — emitted BEFORE loadRefData,
    // which fires its own refdata:loaded (the replay buffer preserves emit order for the backfill).
    emit('app:ready');
    await loadRefData();
    if (!store.available()) throw new Error('Local storage is unavailable in this browser');
    await store.init();
    if (opts.seed) await seedIfEmpty();
    await reloadAll();
    const su = ((await store.getMeta('setup')) as Partial<Setup>) || {};
    setup = { broker: su.broker || '', feed: su.feed || '', stateAbbr: su.state || '', platform: Number(su.platform) || 0 };
    const last = allTrades.length ? allTrades[allTrades.length - 1].date : null;
    calYear = last ? +last.slice(0, 4) : new Date().getFullYear();
    calMonth = last ? +last.slice(5, 7) - 1 : new Date().getMonth();
    loaded = true;
    // A151: the shared actions fire bus events for the ActivityTerminal (every emit is a no-op
    // with no subscriber; app:ready leads boot() — A195).
    emit('data:loaded', { count: allTrades.length });
  }

  function navMonth(delta: number) {
    let m = calMonth + delta,
      y = calYear;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    calMonth = m;
    calYear = y;
  }
  function jumpToLatest() {
    const last = allTrades.length ? allTrades[allTrades.length - 1].date : null;
    if (last) {
      calYear = +last.slice(0, 4);
      calMonth = +last.slice(5, 7) - 1;
    }
  }
  function setCal(year: number, month: number) {
    calYear = year;
    calMonth = month;
  }
  function setScope(s: 'all' | 'month') {
    filters.scope = s;
  }
  function clearFilters() {
    filters.from = filters.to = filters.root = filters.side = filters.session = filters.tag = '';
    filters.dows = [];
  }
  const tradeId = (t: Trade) => store.tradeId(t);
  const brokerName = (id: string) => (BROKERS[id] && BROKERS[id].name) || id || '—';
  const tradesForDay = (date: string) => filtered.filter(t => t.date === date);
  // Persist per-trade metadata (tags + note) — imported trades are immutable (the id is a content
  // hash, no updateTrade), so the Trade Editor edits this metadata layer, not the core fields.
  async function saveTradeMeta(id: string, tags: string[], note: string, shots?: string[]) {
    if (isDemo) return;
    const ex = tradeMeta.get(id);
    await store.saveTradeMeta(id, { tags, note, shots: shots ?? ex?.shots ?? [] });
    await reloadAll();
    emit('note:saved');
  }
  async function deleteTrades(ids: string[]) {
    if (isDemo) return;
    for (const id of ids) await store.deleteTrade(id);
    await reloadAll();
    emit('trade:deleted', { count: ids.length });
  }
  // Edit a trade's core fields. The id is a content hash, so this rebuilds the trade from the original
  // (preserving the fields the editor doesn't expose) and delegates to store.updateTrade (delete-old +
  // add-new + migrate tags/note). entry/exit aren't in the model, so they're not editable upstream.
  async function editTradeCore(r: {
    id: string;
    date: string;
    time: string;
    symbol: string;
    side: string;
    qty: number;
    pnl: number;
    tags: string[];
    note: string;
    shots?: string[];
  }) {
    if (isDemo) return;
    const orig = allTrades.find(t => store.tradeId(t) === r.id);
    if (!orig) return;
    const hhmmss = /^\d\d:\d\d$/.test(r.time) ? `${r.time}:00` : r.time || '00:00:00';
    const next: Trade = {
      // snapshot, not spread — allTrades is deeply-reactive $state, so a spread would keep nested
      // arrays (fileIds, F37) as Svelte proxies, which IndexedDB's structured clone rejects.
      ...$state.snapshot(orig),
      date: r.date,
      time: `${r.date} ${hhmmss}`,
      // A154: force the editor's free-typed symbol through the same rootSym sanitizer every
      // other `root` write path (CSV import, backup restore) enforces; `symbol` keeps the
      // typed form for display/id fidelity.
      root: Adapters.rootSym(r.symbol),
      symbol: r.symbol,
      side: r.side === 'Short' ? 'short' : 'long',
      // A173: qty is a contract count — clamp to a positive integer at the persistence seam too
      // (a negative qty turns commissions into a credit in costModel).
      qty: Math.max(1, Math.round(Math.abs(Number(r.qty) || 1))),
      pnl: r.pnl,
      dup: 0,
    };
    await store.updateTrade(r.id, next, { tags: r.tags, note: r.note, shots: r.shots ?? [] });
    await reloadAll();
  }
  async function importTrades(trades: Trade[]) {
    if (isDemo) return { added: 0, duplicate: 0, total: allTrades.length };
    const res = await store.addTrades(trades);
    await reloadAll();
    emit('data:imported', { added: res.added });
    return res;
  }
  // F37: import a parsed CSV WITH provenance — stores the file record + raw text alongside the
  // trades (every contributed trade carries the file's id), and records the overlap count.
  async function importCsv(text: string, name: string, r: ParseResult) {
    if (isDemo || !r.ok || !r.trades?.length) return { added: 0, duplicate: 0, total: allTrades.length };
    const { rec, trades } = fileRecFor(text, name, r);
    const res = await store.addTrades(trades);
    await store.addFile({ ...rec, overlap: res.duplicate }, text);
    await reloadAll();
    emit('data:imported', { added: res.added });
    return res;
  }
  /* ---- F37 CSV Library file actions (all demo-guarded, all behind the Store seam) ---- */
  async function setFileIncluded(id: string, included: boolean) {
    if (isDemo) return;
    await store.updateFile(id, { included });
    await reloadAll();
  }
  async function renameFile(id: string, label: string) {
    if (isDemo) return;
    await store.updateFile(id, { label: label.trim() || undefined });
    await reloadAll();
  }
  // A211: set/clear a file's broker override ('' clears → global setup broker applies again).
  async function setFileBroker(id: string, broker: string) {
    if (isDemo) return;
    await store.updateFile(id, { broker: broker || undefined });
    await reloadAll();
  }
  async function deleteFile(id: string) {
    if (isDemo) return;
    const res = await store.deleteFile(id);
    await reloadAll();
    emit('trade:deleted', { count: res.removedTrades });
  }
  /** The stored raw text (download-original / re-import) — null when demo or missing. */
  async function fileText(id: string) {
    const t = await store.getFileText(id);
    return t ?? null;
  }
  // Re-parse the stored raw text and re-add its trades (restores rows deleted from the Blotter;
  // existing ones dedupe). Uses the recorded platform so detection can't drift from import time.
  async function reimportFile(id: string) {
    if (isDemo) return { added: 0, duplicate: 0 };
    const rec = csvFiles.find(f => f.id === id);
    const text = await store.getFileText(id);
    if (!rec || text == null) return { added: 0, duplicate: 0 };
    const r = Adapters.parse(text, rec.platform || undefined);
    if (!r.ok || !r.trades?.length) return { added: 0, duplicate: 0 };
    const fid = rec.id;
    const res = await store.addTrades(r.trades.map(t => ({ ...t, fileIds: [fid] })));
    await reloadAll();
    emit('data:imported', { added: res.added });
    return res;
  }
  const filesBytes = () => csvFiles.reduce((a, f) => a + (Number(f.size) || 0), 0);
  async function purgeAll() {
    if (isDemo) return;
    await store.purge();
    await reloadAll();
    emit('data:erased');
  }
  // Full-snapshot backup (read-only — safe on demo) and restore (guarded). The Store already owns the
  // export/import shapes + the restore trust-boundary sanitizer (store.importAll).
  async function exportBackup() {
    return store.exportAll();
  }
  async function importBackup(data: Record<string, unknown>) {
    if (isDemo) return { added: 0, dup: 0 };
    const res = await store.importAll(data);
    await reloadAll();
    emit('data:imported', { added: res.added });
    return res;
  }
  const noteFor = (date: string) => journal.get(date)?.text ?? '';
  const journalFor = (date: string) => journal.get(date) ?? { text: '', tags: [] as string[], shots: [] as string[] };
  async function saveNote(date: string, text: string, tags?: string[], shots?: string[]) {
    if (isDemo) return;
    const ex = journal.get(date);
    // A153: canonicalize BEFORE both persisting and caching, so the optimistic in-memory record
    // is byte-identical to what the Store writes (saveJournal applies cleanTags too) — a live
    // chip can't display a form that changes on reload, and the keep/delete decision below
    // agrees with the Store's.
    const rec = { text, tags: cleanTags(tags ?? ex?.tags ?? []), shots: shots ?? ex?.shots ?? [] };
    await store.saveJournal(date, rec);
    const next = new Map(journal);
    const jd = new Set(journalDates);
    if (text.trim() || rec.tags.length || rec.shots.length) {
      next.set(date, rec);
      jd.add(date);
    } else {
      next.delete(date);
      jd.delete(date);
    }
    journal = next;
    journalDates = jd;
    emit('note:saved', { date });
  }

  // Cost setup (broker/feed/state/platform). Updates reactively on every surface (so demo users can
  // explore cost sensitivity) but only PERSISTS off-demo — matching legacy App.svelte's setup effect.
  async function saveSetup(next: AppSetup) {
    setup = { ...next };
    if (isDemo) return;
    await store.setMeta('setup', { broker: next.broker, feed: next.feed, state: next.stateAbbr, platform: String(next.platform) });
  }

  // Saved filter views — vanilla-compatible {id,name,f} shape (f.symbol holds the root). Mutations are
  // demo-guarded; applyView is a pure state change (safe on demo).
  async function saveView(name: string) {
    if (isDemo) return;
    const f: SavedFilterDef = {
      from: filters.from,
      to: filters.to,
      symbol: filters.root,
      side: filters.side,
      session: filters.session,
      tag: filters.tag,
      dows: [...filters.dows],
    };
    const id = Date.now().toString(36) + savedFilters.length;
    const label = (name || '').trim() || `Filter ${savedFilters.length + 1}`;
    savedFilters = [...savedFilters, { id, name: label, f }];
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
    emit('filter:saved', { name: label }); // A188 — activity-log line
  }
  function applyView(sf: SavedFilter) {
    const f = sf.f || {};
    filters.from = f.from || '';
    filters.to = f.to || '';
    filters.root = f.symbol || '';
    filters.side = f.side || '';
    filters.session = f.session || '';
    filters.tag = f.tag || '';
    filters.dows = Array.isArray(f.dows) ? [...f.dows] : [];
    emit('filter:applied', { name: sf.name }); // A188
  }
  async function deleteView(id: string) {
    if (isDemo) return;
    savedFilters = savedFilters.filter(s => s.id !== id);
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
  }
  async function renameView(id: string, name: string) {
    if (isDemo) return;
    savedFilters = savedFilters.map(s => (s.id === id ? { ...s, name } : s));
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
  }

  return {
    get allTrades() {
      return allTrades;
    },
    get csvFiles() {
      return csvFiles;
    },
    get loaded() {
      return loaded;
    },
    get error() {
      return error;
    },
    set error(v: string) {
      error = v;
    },
    get filtered() {
      return filtered;
    },
    get metricsAll() {
      return metricsAll;
    },
    get metricsActive() {
      return metricsActive;
    },
    get cost() {
      return cost;
    },
    get costInputs() {
      return costInputs;
    },
    get roots() {
      return roots;
    },
    get tags() {
      return tags;
    },
    get journalTags() {
      return journalTags;
    },
    get tradeMeta() {
      return tradeMeta;
    },
    get journalDates() {
      return journalDates;
    },
    get savedFilters() {
      return savedFilters;
    },
    get setup() {
      return setup;
    },
    get filters() {
      return filters;
    },
    get calYear() {
      return calYear;
    },
    get calMonth() {
      return calMonth;
    },
    get dateRange() {
      return dateRange;
    },
    get isDemo() {
      return isDemo;
    },
    boot,
    navMonth,
    jumpToLatest,
    setCal,
    setScope,
    clearFilters,
    tradeId,
    brokerName,
    tradesForDay,
    noteFor,
    journalFor,
    saveNote,
    saveTradeMeta,
    deleteTrades,
    editTradeCore,
    importTrades,
    importCsv,
    setFileIncluded,
    renameFile,
    setFileBroker,
    deleteFile,
    fileText,
    reimportFile,
    filesBytes,
    purgeAll,
    exportBackup,
    importBackup,
    saveSetup,
    saveView,
    applyView,
    deleteView,
    renameView,
    sessionOf,
  };
}

export type Dashboard = ReturnType<typeof createDashboard>;
