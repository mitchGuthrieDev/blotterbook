// Reactive dashboard state factory for the redesigned app shell (UI redesign, Phase 3 cutover).
// Boots the real engine (loadRefData → Store → restore/seed) and exposes the shared reactive data the
// redesign screens read — trades, filters, metrics (compute), cost (costModel), per-trade meta, setup,
// and the calendar cursor — plus the actions to mutate them. A .svelte.ts module so it can own runes.
// The same pure-logic core (A29) the current App.svelte drives; this just packages it for the new shell.
import { loadRefData, compute, costModel, sessionOf, STATES, BROKERS, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../../lib/core/core.ts';
import { Adapters } from '../../lib/core/adapters.ts';
import { demoCSV } from '../../lib/core/sampledata.ts';
import type { Trade, FilterState, SavedFilter, AppSetup, Setup, StoredTradeMeta, StoreLike } from '../../lib/core/types.ts';

export function createDashboard(store: StoreLike, opts: { seed: boolean }) {
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
  const breakEvenMetrics = $derived(compute(allTrades));
  const roots = $derived([...new Set(allTrades.map(t => t.root).filter(Boolean))].sort());
  const tags = $derived([...new Set([...tradeMeta.values()].flatMap(m => m.tags || []))].sort());
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
    journal = new Map((await store.getAllJournal()).map(j => [j.date, { text: j.text || '', tags: j.tags || [], shots: j.shots || [] }] as const));
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m] as const));
    savedFilters = ((await store.getMeta('savedFilters')) as SavedFilter[]) || [];
  }
  async function boot() {
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
  async function saveTradeMeta(id: string, tags: string[], note: string) {
    const ex = tradeMeta.get(id);
    await store.saveTradeMeta(id, { tags, note, shots: ex?.shots ?? [] });
    await reloadAll();
  }
  async function deleteTrades(ids: string[]) {
    for (const id of ids) await store.deleteTrade(id);
    await reloadAll();
  }
  const noteFor = (date: string) => journal.get(date)?.text ?? '';
  async function saveNote(date: string, text: string) {
    const ex = journal.get(date);
    await store.saveJournal(date, { text, tags: ex?.tags ?? [], shots: ex?.shots ?? [] });
    const next = new Map(journal);
    if (text.trim()) {
      next.set(date, { text, tags: ex?.tags ?? [], shots: ex?.shots ?? [] });
      journalDates = new Set(journalDates).add(date);
    } else {
      next.delete(date);
      const jd = new Set(journalDates);
      jd.delete(date);
      journalDates = jd;
    }
    journal = next;
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
    get breakEvenMetrics() {
      return breakEvenMetrics;
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
    get tradeMeta() {
      return tradeMeta;
    },
    get journalDates() {
      return journalDates;
    },
    get journal() {
      return journal;
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
    boot,
    reloadAll,
    navMonth,
    jumpToLatest,
    setScope,
    clearFilters,
    tradeId,
    brokerName,
    tradesForDay,
    noteFor,
    saveNote,
    saveTradeMeta,
    deleteTrades,
    sessionOf,
  };
}

export type Dashboard = ReturnType<typeof createDashboard>;
