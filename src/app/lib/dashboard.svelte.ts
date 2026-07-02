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
import { cleanTags } from '../../lib/core/store.ts';
import { demoCSV } from '../../lib/core/sampledata.ts';
import type { Trade, FilterState, SavedFilter, SavedFilterDef, AppSetup, Setup, StoredTradeMeta, StoreLike } from '../../lib/core/types.ts';

export function createDashboard(store: StoreLike, opts: { seed: boolean; isDemo?: boolean }) {
  // Demo mounts the in-memory DemoStore (nothing persists by construction), but every write path is
  // ALSO isDemo-guarded here (A87 belt-and-suspenders) and the UI disables the controls — so demo can
  // never mutate, even if a real Store were passed by mistake.
  const isDemo = !!opts.isDemo;
  let allTrades = $state<Trade[]>([]);
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
  const costInputs = $derived({
    broker: setup.broker,
    platform: setup.platform,
    feedCost: setup.feed ? parseFloat(setup.feed.split('|')[1]) || 0 : 0,
    stateRate: STATES.find(s => s[0] === setup.stateAbbr)?.[1] ?? 0,
  });
  const cost = $derived(costModel(metricsActive, costInputs));
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');

  async function seedIfEmpty() {
    if ((await store.tradeCount()) > 0) return;
    const r = Adapters.parse(demoCSV(), 'tradingview');
    if (r.ok && r.trades && r.trades.length) {
      await store.addTrades(r.trades);
      await store.setMeta('setup', { broker: DEMO_BROKER, feed: DEMO_FEED, state: DEMO_STATE, platform: '35' });
    }
  }
  async function reloadAll() {
    allTrades = await store.getAllTrades();
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
      ...orig,
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
