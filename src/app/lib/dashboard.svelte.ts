// Reactive dashboard state factory for the redesigned app shell (UI redesign, Phase 3 cutover).
// Boots the real engine (loadRefData → Store → restore/seed) and exposes the shared reactive data the
// redesign screens read — trades, filters, metrics (compute), cost (costModel), per-trade meta, setup,
// and the calendar cursor — plus the actions to mutate them. A .svelte.ts module so it can own runes.
// Drives the same pure-logic core (A29) as everything else; App.svelte owns one instance per boot.
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
  currentDrawdown,
  currentStreak,
  streakRecords,
} from '../../lib/core/core.ts';
import { Adapters } from '../../lib/core/adapters.ts';
import { cleanTags, fileId } from '../../lib/core/store.ts';
import { reconcileImport } from '../../lib/core/intake.ts';
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
import type { DashModuleData } from '../screens/Dashboard.svelte';

/**
 * Resolve values from the CSV files (F37 provenance) that contributed to a trade. Indexes `files`
 * by id and scans them IN `files`' OWN ORDER for the ones the trade references (`t.fileIds`),
 * collecting `pick(file)` results and skipping files `pick` doesn't resolve (e.g. no broker
 * override). Passing `files` pre-sorted (e.g. the newest-first `csvFiles`) lets a caller rely on
 * that order for a first-match pick — see `brokerFor` below. Replaces three ad hoc "index csvFiles
 * by id, then scan t.fileIds" idioms (A249) that each wanted something different back (a first
 * match, a some()-style membership check, or every distinct label) — each caller supplies its own
 * `pick` and reduces the result itself.
 */
export function resolveFromFiles<T>(t: Trade, files: CsvFileRec[], pick: (f: CsvFileRec) => T | undefined): T[] {
  if (!t.fileIds?.length) return [];
  const ids = new Set(t.fileIds);
  const out: T[] = [];
  for (const f of files) {
    if (!ids.has(f.id)) continue;
    const v = pick(f);
    if (v !== undefined) out.push(v);
  }
  return out;
}

export function createDashboard(store: StoreLike, opts: { seed: boolean; isDemo?: boolean }) {
  // Demo mounts the in-memory DemoStore (nothing persists by construction), but every write path is
  // ALSO isDemo-guarded here (A87 belt-and-suspenders) and the UI disables the controls — so demo can
  // never mutate, even if a real Store were passed by mistake.
  const isDemo = !!opts.isDemo;
  // A223: the big collections are $state.raw — they are REASSIGNMENT-ONLY (reloadAll/saveNote etc.
  // replace the whole reference; nothing pushes/sets in place — keep it that way), so compute()/
  // costModel()'s ~20 O(n) passes read plain objects instead of deep-reactivity proxies.
  let allTrades = $state.raw<Trade[]>([]);
  let csvFiles = $state.raw<CsvFileRec[]>([]); // F37: the imported-CSV library (metadata; texts stay in the Store)
  let loaded = $state(false);
  let error = $state('');
  let journalDates = $state.raw<Set<string>>(new Set());
  let journal = $state.raw<Map<string, { text: string; tags: string[]; shots: string[] }>>(new Map());
  let tradeMeta = $state.raw<Map<string, StoredTradeMeta>>(new Map());
  let savedFilters = $state<SavedFilter[]>([]);
  let setup = $state<AppSetup>({ broker: '', feed: '', stateAbbr: '', platform: 0 });
  let filters = $state<FilterState>({ scope: 'all', from: '', to: '', root: '', side: '', session: '', tag: '', dows: [], hours: [] });
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
      if (f.hours.length) {
        // A197: hour-of-day from the trade timestamp HH; no timestamp = excluded while active
        // (balance-history exports carry no time — the Analytics hour module states the coverage).
        const hh = (t.time || '').slice(11, 13);
        if (!/^\d\d$/.test(hh) || !f.hours.includes(+hh)) return false;
      }
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
    // A249: resolveFromFiles scans csvFiles in ITS order (newest-first) — [0] is the override of
    // the newest contributing file that has one, same as the hand-rolled loop this replaced.
    return (t: Trade) => resolveFromFiles(t, csvFiles, f => overridden.get(f.id))[0];
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

  // F39/A142: full-fidelity Dashboard batch-1 module data (Today · Drawdown Status · Streak Monitor)
  // off the scope-active Metrics — per-TRADE granularity that the Dashboard's series-only fallback
  // can't reach (exact per-day trade counts, trades-since-peak, per-trade streak records). App.svelte
  // forwards this as `moduleData={dash.dashModuleData}`; without the wire the Dashboard degrades to
  // its own day-level derivation of the same shape, so the modules render either way.
  const dashModuleData = $derived.by<DashModuleData>(() => {
    const m = metricsActive;
    const day = m.days.length ? m.days[m.days.length - 1] : null;
    let lastDay: DashModuleData['lastDay'] = null;
    if (day) {
      // A single day's trades can be large (fills exports) — fold, never Math.max(...spread) (A153).
      const bw = m.trades.reduce((a, t) => (t.date === day.date ? { best: Math.max(a.best, t.pnl), worst: Math.min(a.worst, t.pnl) } : a), {
        best: -Infinity,
        worst: Infinity,
      });
      lastDay = {
        date: day.date,
        net: day.pnl,
        trades: day.trades,
        wins: day.wins,
        winRate: day.trades ? (100 * day.wins) / day.trades : 0,
        best: day.trades ? bw.best : 0,
        worst: day.trades ? bw.worst : 0,
        capped: false,
      };
    }
    const cd = currentDrawdown(m.curve);
    const dayPnls = m.days.map(d => d.pnl);
    return {
      lastDay,
      avgDaily: m.avgDaily,
      avgTrades: m.avgTrades,
      winDayPct: m.winDayPct,
      activeDays: m.active,
      dd: {
        current: cd.dd,
        currentPct: cd.ddPct,
        sincePeak: cd.sincePeak,
        unit: 'trade',
        maxDD: m.maxDD,
        maxDDpct: m.maxDDpct,
        maxDDdur: m.maxDDdur,
        recovery: m.recovery,
        atHigh: cd.atHigh,
      },
      streak: {
        trade: { ...currentStreak(m.pnls), capped: false },
        day: currentStreak(dayPnls),
        rec: { maxWin: m.mcw, maxLoss: m.mcl, maxWinSum: m.maxWinStk, maxLossSum: m.maxLossStk },
        recUnit: 'trade',
        dayRec: streakRecords(dayPnls),
      },
    };
  });

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
    // A223: the five independent store reads run concurrently, and journalDates derives from the
    // journal read (store.journalDates() was a duplicate hit on the same object store).
    const [files, raw, journalRows, metaRows, sf] = await Promise.all([
      store.getFiles(),
      store.getAllTrades(),
      store.getAllJournal(),
      store.allTradeMeta(),
      store.getMeta('savedFilters'),
    ]);
    csvFiles = files;
    const excluded = new Set(csvFiles.filter(f => !f.included).map(f => f.id));
    allTrades = excluded.size ? raw.filter(t => !t.fileIds?.length || t.fileIds.some(id => !excluded.has(id))) : raw;
    journal = new Map(journalRows.map(j => [j.date, { text: j.text || '', tags: j.tags || [], shots: j.shots || [] }] as const));
    journalDates = new Set(journal.keys());
    tradeMeta = new Map(metaRows.map(m => [m.id, m] as const));
    savedFilters = (sf as SavedFilter[]) || [];
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
    // A201: no saved state yet → prefill from the visitor's coarse edge region. Fire-and-forget so
    // boot never blocks on it; skipped on demo (seeded with its own state).
    if (!isDemo && !setup.stateAbbr) void prefillStateFromGeo();
    const last = allTrades.length ? allTrades[allTrades.length - 1].date : null;
    calYear = last ? +last.slice(0, 4) : new Date().getFullYear();
    calMonth = last ? +last.slice(5, 7) - 1 : new Date().getMonth();
    loaded = true;
    // A151: the shared actions fire bus events for the ActivityTerminal (every emit is a no-op
    // with no subscriber; app:ready leads boot() — A195).
    emit('data:loaded', { count: allTrades.length });
  }

  // A201: convenience-only tax-state prefill from /api/geo (coarse edge region — no IP, no trade
  // data). In-memory only: it persists with the user's NEXT setup save, never by itself. Any
  // failure (offline, non-US, unknown region, dev server without functions) is silent.
  async function prefillStateFromGeo() {
    try {
      const res = await fetch('/api/geo');
      if (!res.ok) return;
      const geo = (await res.json()) as { country?: string | null; regionCode?: string | null };
      if (geo.country !== 'US' || !geo.regionCode) return;
      if (setup.stateAbbr) return; // the user picked one while the fetch was in flight
      if (STATES.some(s => s[0] === geo.regionCode)) setup = { ...setup, stateAbbr: geo.regionCode };
    } catch {
      // convenience only — never surface an error
    }
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
    filters.hours = [];
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
    for (const id of ids) {
      await store.deleteTrade(id);
      await store.deleteTradeMeta(id); // A216: tags/note/screenshots go with the trade
    }
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
  // Cross-export reconciliation classifiers (TV calc audit): scope authority to the SAME platform
  // family — 'tradingview' (balance history, closed/authoritative) vs 'tradingview-orders'
  // (fills/derived) share the family 'tradingview'. kindOf comes from the adapter registry.
  const ADAPTER_KIND = new Map(Adapters.list().map(a => [a.id, a.kind]));
  // A249: this splitter is adapter-registry-shaped (mirrors the platform id convention adapters.ts
  // defines) — left here rather than moved, per the R1 audit's optional call.
  const family = (platformId: string) => platformId.split('-')[0];
  function reconcileOpts(platformId: string, files: CsvFileRec[]) {
    const F = family(platformId);
    const authority = new Set(files.filter(f => family(f.platform) === F && ADAPTER_KIND.get(f.platform) === 'closed').map(f => f.id));
    const derived = new Set(files.filter(f => family(f.platform) === F && ADAPTER_KIND.get(f.platform) === 'fills').map(f => f.id));
    return {
      isAuthority: (t: Trade) => resolveFromFiles(t, files, f => authority.has(f.id) || undefined).length > 0,
      isDerivedPeer: (t: Trade) => resolveFromFiles(t, files, f => derived.has(f.id) || undefined).length > 0,
    };
  }
  /** Preview-time reconciliation count (sync — in-memory state) for the import sheet. */
  function previewReconcile(trades: Trade[], kind: string, platformId: string): number {
    return reconcileImport(allTrades, trades, kind, reconcileOpts(platformId, csvFiles)).conflicted;
  }

  // F37: import a parsed CSV WITH provenance — stores the file record + raw text alongside the
  // trades (every contributed trade carries the file's id), and records the overlap count.
  // Cross-export reconciliation (TV calc audit): a derived copy of a round trip the store already
  // holds authoritatively (or vice versa) is resolved instead of double-counting — see
  // reconcileImport in the intake module.
  async function importCsv(text: string, name: string, r: ParseResult) {
    if (isDemo || !r.ok || !r.trades?.length) return { added: 0, duplicate: 0, total: allTrades.length };
    const { rec, trades } = fileRecFor(text, name, r);
    const recon = reconcileImport(
      await store.getAllTrades(),
      trades,
      r.kind || '',
      reconcileOpts(r.platform || '', await store.getFiles())
    );
    for (const id of recon.evictIds) {
      await store.deleteTrade(id);
      await store.deleteTradeMeta(id); // A216 rule — meta goes with the evicted copy
    }
    const res = await store.addTrades(recon.add);
    await store.addFile({ ...rec, overlap: res.duplicate }, text);
    await reloadAll();
    emit('data:imported', { added: res.added, ...(recon.conflicted ? { reconciled: recon.conflicted } : {}) });
    return { ...res, reconciled: recon.conflicted };
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
    // Same cross-export reconciliation as importCsv — a re-import must not resurrect a derived
    // copy the authoritative record has since superseded.
    const recon = reconcileImport(
      await store.getAllTrades(),
      r.trades.map(t => ({ ...t, fileIds: [fid] })),
      r.kind || '',
      reconcileOpts(
        rec.platform || '',
        (await store.getFiles()).filter(f => f.id !== fid)
      )
    );
    for (const id of recon.evictIds) {
      await store.deleteTrade(id);
      await store.deleteTradeMeta(id);
    }
    const res = await store.addTrades(recon.add);
    await reloadAll();
    emit('data:imported', { added: res.added });
    return res;
  }
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
      hours: [...filters.hours],
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
    filters.hours = Array.isArray(f.hours) ? [...f.hours] : [];
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
    get dashModuleData() {
      return dashModuleData;
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
    previewReconcile,
    setFileIncluded,
    renameFile,
    setFileBroker,
    deleteFile,
    fileText,
    reimportFile,
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
