<script lang="ts">
  // App root: the journal SPA mounted on ALL three surfaces (app/demo/staging.html) since the A33
  // cutover. Boots by REUSING the pure-logic core verbatim (A29): loadRefData + a Store + Adapters +
  // compute(). The persistence backend is chosen by PAGE_MODE and provided to the children via
  // context('bb:store'), so the same components work on every surface:
  //   app      → real IndexedDB Store (blotterbook DB), no seed (real user data; landing flow is A32)
  //   demo     → in-memory DemoStore (never persists), seeded
  //   staging  → real IndexedDB Store (isolated blotterbookStaging DB), seeded
  // Staging-only chrome (the "Staging" badge / proving-ground meta) is gated on `isStaging`; demo
  // never persists (DemoStore) and every write path is additionally `isDemo`-guarded (A87).
  import { onMount, setContext } from 'svelte';
  import { loadRefData, compute, costModel, emit, sessionOf, PAGE_MODE, STATES, BROKERS, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../lib/core.ts';
  import { Store } from '../lib/store.ts';
  import { createDemoStore } from '../lib/demostore.ts';
  import { Adapters } from '../lib/adapters.ts';
  import { demoCSV } from '../lib/sampledata.ts';
  import { APP_FLAGS, loadFlags, type AppFlags } from './lib/flags.ts';
  import type { Trade, FilterState, SavedFilter, SavedFilterDef, AppSetup, PanelBundle, Setup, StoredTradeMeta } from '../lib/types.ts';

  // Pick the backend by mode and share it with every child (they read getContext('bb:store')).
  const isDemo = PAGE_MODE === 'demo';
  const isStaging = PAGE_MODE === 'staging';
  const store = isDemo ? createDemoStore() : Store;
  const SEEDED = isStaging || isDemo;
  setContext('bb:store', store);
  // A85: the topbar meta tagline is per-surface — only staging shows the "proving ground" copy, and
  // only staging shows the "Staging" badge. Prod app shows just the date range; demo flags the sample.
  const metaLead = isStaging ? 'Svelte 5 proving ground · isolated local data' : isDemo ? 'Interactive demo · sample data' : '';
  // A108: the dashboard panels (perf/cal/blotter/cost/adv/defs/term) are wired through the MODULE
  // registry (./lib/modules.ts) and rendered dynamically — App no longer imports them individually.
  import { MODULES, MODULE_BY_KEY, type DashCtx } from './lib/modules.ts';
  import Overview from './components/Overview.svelte';
  import FilterBar from './components/FilterBar.svelte';
  // JournalEditor + DayTrades are the calendar module's `extra` snippet content (rendered by App).
  import JournalEditor from './components/JournalEditor.svelte';
  import DayTrades from './components/DayTrades.svelte';
  import ManageData from './components/ManageData.svelte';
  // Definitions also renders as the F27 staging FOOTER (separate from its registry panel entry).
  import Definitions from './components/Definitions.svelte';
  import StatCardModal from './components/StatCardModal.svelte';
  import ExportReport from './components/ExportReport.svelte';
  import WorkspaceBar from './components/WorkspaceBar.svelte';
  import Landing from './components/Landing.svelte';
  import * as Popover from '$ui/popover';
  import * as DropdownMenu from '$ui/dropdown-menu';

  let allTrades = $state<Trade[]>([]);
  let loaded = $state(false);
  let status = $state('Loading…');
  let error = $state('');
  let manageOpen = $state(false);
  let landingMsg = $state('');
  let importWarning = $state(''); // A113: dismissible banner when an import estimated PnL at $1/point
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine); // A38 session pill
  let cardModalKey = $state<string | null>(null); // A35 stat-card detail modal
  let exportOpen = $state(false); // A34 performance-report export
  // A89: admin-managed feature flags, fetched at boot (falls back to APP_FLAGS defaults offline).
  let flags = $state<AppFlags>({ ...APP_FLAGS });

  // Day-notes journal: the selected calendar day + the set of dates carrying a saved note.
  let selectedDate = $state<string | null>(null);
  let journalDates = $state<Set<string>>(new Set());
  // Per-trade metadata (id -> {tags,note,...}) for the tag filter + manage-data table.
  let tradeMeta = $state<Map<string, StoredTradeMeta>>(new Map());
  // Saved filter views ([{id,name,f}]), persisted to Store meta in the vanilla-compatible shape.
  let savedFilters = $state<SavedFilter[]>([]);
  // Cost setup (broker/feed/state/platform), lifted here (A32) so BOTH the cost panel and the
  // curve overlays share it. Persisted to the 'setup' meta.
  let setup = $state<AppSetup>({ broker: '', feed: '', stateAbbr: '', platform: 0 });

  // Panel system (A36 — parity with vanilla ui.js/widgets.js). The dashboard's reorderable,
  // collapsible panels; order + collapsed map persist through the Store.local seam under a
  // staging-namespaced key (so staging layout never leaks into prod/demo). Workspace templates
  // snapshot {order, collapsed} under WS_KEY.
  // A108: DEFAULT_ORDER / MODULE_LABELS / GRID_KEYS are all DERIVED from the module registry now — a
  // single source of truth (./lib/modules.ts) instead of three hand-synced structures. The registry's
  // array order is the default order; per-module `gate` does the surface filtering (e.g. F27 keeps
  // 'defs' off staging — it's a footer there); `grid` flags the F26 parallel-grid members.
  const SURFACE = { isStaging, isDemo };
  // F23 (CH16): Trade Blotter sits directly below the Trading Calendar by default on every surface
  // (non-mutating on demo). F27 (staging): 'defs' is a page footer, gated out of the dashboard here.
  const DEFAULT_ORDER = MODULES.filter(m => m.gate(SURFACE)).map(m => m.key);
  // R12/A71: human labels for the module menus (the names otherwise live only inside each <Panel title>).
  const MODULE_LABELS: Record<string, string> = Object.fromEntries(MODULES.map(m => [m.key, m.label]));
  // F26 (staging): these modules render side-by-side in a reorderable grid instead of stacked full-width
  // rows (drag, or the module menu's Move left/right, reorders within the grid). Off on prod/demo.
  const GRID_KEYS = MODULES.filter(m => m.grid).map(m => m.key);
  const isGridKey = (k: string | null): boolean => !!k && isStaging && GRID_KEYS.includes(k);
  // F24 (staging): the donate button opens this Stripe page in a separate popup window so the user is
  // never navigated away from the dashboard. PLACEHOLDER — swap in the real Stripe Payment Link once it
  // exists (see R15 / F18); kept as one constant so there's a single spot to update.
  const DONATE_URL = 'https://buy.stripe.com/test_PLACEHOLDER';
  const LS_SUFFIX = PAGE_MODE === 'staging' ? '_staging' : '';
  const LS_ORDER = 'tj_order' + LS_SUFFIX;
  const LS_COLLAPSE = 'tj_collapsed' + LS_SUFFIX;
  const LS_HIDDEN = 'tj_hidden' + LS_SUFFIX;
  const WS_KEY = 'tj_ws_templates' + LS_SUFFIX;
  const sanitizeOrder = (ord: unknown): string[] => {
    if (!Array.isArray(ord)) return [...DEFAULT_ORDER];
    const known = ord.filter(k => DEFAULT_ORDER.includes(k));
    return [...known, ...DEFAULT_ORDER.filter(k => !known.includes(k))];
  };
  // A100: guard the collapse/hidden flag-map reads from Store.local the same way sanitizeOrder guards
  // the order — corrupt or stale localStorage (a non-object, or keys for removed modules) must not
  // poison panel state. Keeps only known module keys, normalizing each truthy flag to 1.
  const sanitizeFlags = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (DEFAULT_ORDER.includes(k) && val) out[k] = 1;
    return out;
  };
  // A100: the workspace-template map read, guarded — a non-object payload yields no templates.
  const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  // Initialize synchronously from localStorage so the restored layout paints without a flash.
  let panelOrder = $state<string[]>(sanitizeOrder(store.local.get(LS_ORDER, null)));
  let collapsedPanels = $state<Record<string, number>>(sanitizeFlags(store.local.get(LS_COLLAPSE, {})));
  // R12 (staging): modules removed from the dashboard; re-spawned from the "Add module" menu.
  let hiddenPanels = $state<Record<string, number>>(sanitizeFlags(store.local.get(LS_HIDDEN, {})));
  let draggingKey = $state<string | null>(null);
  const visiblePanels = $derived(panelOrder.filter(k => !hiddenPanels[k]));
  const hiddenList = $derived(panelOrder.filter(k => hiddenPanels[k]));
  // F26 (staging): the dashboard render sequence. On prod/demo every visible module is a full-width
  // row (unchanged). On staging the grid modules (cal/cost/adv) collapse into ONE grid block, anchored
  // at the first grid module's slot; the others render full-width in place. visibleGrid is their order.
  type RenderItem = { type: 'full'; key: string } | { type: 'grid'; keys: string[] };
  const visibleGrid = $derived(visiblePanels.filter(k => GRID_KEYS.includes(k)));
  const renderSeq = $derived.by((): RenderItem[] => {
    if (!isStaging) return visiblePanels.map(k => ({ type: 'full', key: k }));
    const seq: RenderItem[] = [];
    let placed = false;
    for (const k of visiblePanels) {
      if (GRID_KEYS.includes(k)) {
        if (!placed) {
          seq.push({ type: 'grid', keys: visibleGrid });
          placed = true;
        }
      } else {
        seq.push({ type: 'full', key: k });
      }
    }
    return seq;
  });
  let wsNames = $state<string[]>(Object.keys(asObject(store.local.get(WS_KEY, {}))));
  let wsSelected = $state('');

  const persistOrder = () => store.local.set(LS_ORDER, $state.snapshot(panelOrder));
  const persistCollapsed = () => store.local.set(LS_COLLAPSE, $state.snapshot(collapsedPanels));
  const persistHidden = () => store.local.set(LS_HIDDEN, $state.snapshot(hiddenPanels));

  // R12/A71 (staging): move a module one slot among the VISIBLE panels, then persist the new order.
  function movePanel(key: string, dir: -1 | 1) {
    if (isGridKey(key)) {
      moveGrid(key, dir);
      return;
    }
    const vis = panelOrder.filter(k => !hiddenPanels[k]);
    const vi = vis.indexOf(key);
    const swapWith = vis[vi + dir];
    if (!swapWith) return; // already at an end
    const next = [...panelOrder];
    const a = next.indexOf(key);
    const b = next.indexOf(swapWith);
    [next[a], next[b]] = [next[b], next[a]];
    panelOrder = next;
    persistOrder();
  }
  // F26 (staging): the visible grid modules in panelOrder + the slots they occupy. Reordering rewrites
  // only those slots, so the grid block stays anchored and the full-width modules around it never move.
  const gridSlots = (): { slots: number[]; seq: string[] } => {
    const slots: number[] = [];
    const seq: string[] = [];
    panelOrder.forEach((k, i) => {
      if (GRID_KEYS.includes(k) && !hiddenPanels[k]) {
        slots.push(i);
        seq.push(k);
      }
    });
    return { slots, seq };
  };
  const writeGrid = (slots: number[], seq: string[]) => {
    const next = [...panelOrder];
    slots.forEach((slot, i) => (next[slot] = seq[i]));
    panelOrder = next;
  };
  // F26 (staging): move a grid module one position left/right within the grid (the menu's keyboard
  // fallback for the drag reorder), then persist.
  function moveGrid(key: string, dir: -1 | 1) {
    const { slots, seq } = gridSlots();
    const si = seq.indexOf(key);
    const j = si + dir;
    if (si < 0 || j < 0 || j >= seq.length) return;
    [seq[si], seq[j]] = [seq[j], seq[si]];
    writeGrid(slots, seq);
    persistOrder();
  }
  function hidePanel(key: string) {
    hiddenPanels = { ...hiddenPanels, [key]: 1 };
    persistHidden();
  }
  function showPanel(key: string) {
    const next = { ...hiddenPanels };
    delete next[key];
    hiddenPanels = next;
    persistHidden();
  }

  function togglePanel(key: string) {
    const next = { ...collapsedPanels };
    if (next[key]) delete next[key];
    else next[key] = 1;
    collapsedPanels = next;
    persistCollapsed();
  }
  function reorderOver(e: DragEvent, overKey: string) {
    if (!draggingKey || draggingKey === overKey) return;
    // F26 (staging): grid modules reorder only among themselves (reorderGridOver) — never let one drop
    // into the full-width stack, and never let a full-width module drop into the grid.
    if (isGridKey(draggingKey)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const next = panelOrder.filter(k => k !== draggingKey);
    const idx = next.indexOf(overKey);
    if (idx < 0) return;
    next.splice(idx + (after ? 1 : 0), 0, draggingKey);
    panelOrder = next;
  }
  // F26 (staging): horizontal drag reorder WITHIN the grid. Uses clientX (columns), reorders only the
  // visible grid modules, and writes back into their existing slots so the grid block stays anchored.
  function reorderGridOver(e: DragEvent, overKey: string) {
    if (!draggingKey || draggingKey === overKey) return;
    if (!isGridKey(draggingKey) || !GRID_KEYS.includes(overKey)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    const { slots, seq } = gridSlots();
    const without = seq.filter(k => k !== draggingKey);
    const oi = without.indexOf(overKey);
    if (oi < 0) return;
    without.splice(oi + (after ? 1 : 0), 0, draggingKey);
    writeGrid(slots, without);
  }
  // The prop bundle each panel forwards to its <Panel> chrome.
  const panelBundle = (key: string): PanelBundle => ({
    pkey: key,
    collapsed: !!collapsedPanels[key],
    dragging: draggingKey === key,
    ontoggle: () => togglePanel(key),
    onreorderstart: () => (draggingKey = key),
    onreorderend: () => {
      draggingKey = null;
      persistOrder();
    },
    onreorderover: e => reorderOver(e, key),
    // R12/A71 (promoted to all surfaces, CH16): the per-module header menu and its move/hide actions.
    menu: true,
    isFirst: visiblePanels[0] === key,
    isLast: visiblePanels[visiblePanels.length - 1] === key,
    onmoveup: () => movePanel(key, -1),
    onmovedown: () => movePanel(key, 1),
    onhide: () => hidePanel(key),
  });
  // F26 (staging): the bundle for a module rendered inside the grid — same chrome, but reorder is
  // horizontal (reorderGridOver), the move actions read Move left/right, and isFirst/isLast track the
  // module's position WITHIN the grid (not the whole dashboard).
  const gridPanelBundle = (key: string): PanelBundle => ({
    pkey: key,
    collapsed: !!collapsedPanels[key],
    dragging: draggingKey === key,
    ontoggle: () => togglePanel(key),
    onreorderstart: () => (draggingKey = key),
    onreorderend: () => {
      draggingKey = null;
      persistOrder();
    },
    onreorderover: e => reorderGridOver(e, key),
    menu: true,
    isFirst: visibleGrid[0] === key,
    isLast: visibleGrid[visibleGrid.length - 1] === key,
    onmoveup: () => movePanel(key, -1),
    onmovedown: () => movePanel(key, 1),
    onhide: () => hidePanel(key),
    moveUpLabel: 'Move left',
    moveDownLabel: 'Move right',
  });

  // Workspace templates (Store.local seam).
  // R12: workspace templates also snapshot which modules are hidden (older snapshots → nothing hidden).
  const readWs = (): Record<string, { order: string[]; collapsed: Record<string, number>; hidden?: Record<string, number> }> =>
    asObject(store.local.get(WS_KEY, {})) as Record<string, { order: string[]; collapsed: Record<string, number>; hidden?: Record<string, number> }>;
  function saveWorkspace() {
    if (isDemo) return; // demo never persists new layouts (B23)
    const name = (window.prompt('Name this workspace layout:') || '').trim();
    if (!name) return;
    const t = readWs();
    t[name] = { order: $state.snapshot(panelOrder), collapsed: $state.snapshot(collapsedPanels), hidden: $state.snapshot(hiddenPanels) };
    store.local.set(WS_KEY, t);
    wsNames = Object.keys(t);
    wsSelected = name;
    emit('ws:saved', { name });
  }
  function selectWorkspace(name: string) {
    wsSelected = name;
    if (!name) {
      // "— Default —" → drop the saved layout and restore the default arrangement.
      store.local.remove(LS_ORDER);
      store.local.remove(LS_COLLAPSE);
      store.local.remove(LS_HIDDEN);
      panelOrder = [...DEFAULT_ORDER];
      collapsedPanels = {};
      hiddenPanels = {};
      emit('ws:reverted', {});
      return;
    }
    const t = readWs()[name];
    if (t) {
      panelOrder = sanitizeOrder(t.order);
      collapsedPanels = sanitizeFlags(t.collapsed);
      hiddenPanels = sanitizeFlags(t.hidden);
      persistOrder();
      persistCollapsed();
      persistHidden();
      emit('ws:loaded', { name });
    }
  }

  // Filters drive the whole dashboard (a shared reactive object). scope = all-time vs the
  // calendar's current month. The cursor (calYear/calMonth) lives here so scope can read it.
  let filters = $state<FilterState>({ scope: 'all', from: '', to: '', root: '', side: '', session: '', tag: '', dows: [] });
  let calYear = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth());

  const inMonth = (t: Trade, y: number, m: number) => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  };
  // sessionOf (RTH 09:30–16:00 vs ETH) is shared from core.js so the Svelte filter and the vanilla
  // render.js filter use ONE definition (A29/A41).

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

  // metricsAll = filtered, all-time → feeds the curve + calendar (calendar colors ignore scope).
  // metricsActive = metricsAll, or just the calendar month when scope='month' → feeds the cards,
  // advanced stats, and cost panel. Mirrors the vanilla baseTrades()/activeMetrics() split.
  const filtered = $derived(applyFilters(allTrades, filters));
  const metricsAll = $derived(compute(filtered));
  const metricsActive = $derived(
    filters.scope === 'month' ? compute(filtered.filter(t => inMonth(t, calYear, calMonth))) : metricsAll
  );
  // F22 (promoted to all surfaces, CH16): the Break-even & Cost Budget panel reads as a stable,
  // account-level budget — it always computes from the FULL unfiltered dataset (all-time), independent
  // of the scope toggle and filter bar. Every other panel stays filter-driven (metricsActive).
  const breakEvenMetrics = $derived(compute(allTrades));
  const roots = $derived([...new Set(allTrades.map(t => t.root).filter(Boolean))].sort());
  const tags = $derived([...new Set([...tradeMeta.values()].flatMap(m => m.tags || []))].sort());
  // A50: the active-filtered trades for the selected day → the read-only intraday trade table.
  const dayTrades = $derived(selectedDate ? filtered.filter(t => t.date === selectedDate) : []);
  const filtersActive = $derived(
    !!(filters.from || filters.to || filters.root || filters.side || filters.session || filters.tag || filters.dows.length)
  );
  // Cost/tax inputs derived from the setup (feed value is "name|cost"; rate from the STATES table).
  const costInputs = $derived({
    broker: setup.broker,
    platform: setup.platform,
    feedCost: setup.feed ? parseFloat(setup.feed.split('|')[1]) || 0 : 0,
    stateRate: (STATES.find(s => s[0] === setup.stateAbbr) || [, 0])[1] || 0,
  });
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');
  // Human-readable labels for the export report header (parity with export.js BROKERS/feedName/
  // stateLabel/scopeLabel). feed value is "name|cost"; scope mirrors render.js scopeLabel().
  // Full month names to match vanilla scopeLabel() ("January 2025"), used in the export-report header.
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const reportLabels = $derived({
    broker: (BROKERS[setup.broker] && BROKERS[setup.broker].name) || setup.broker || '—',
    feed: setup.feed ? setup.feed.split('|')[0] : '—',
    state: (STATES.find(s => s[0] === setup.stateAbbr) || [, , '—'])[2] || '—',
    scope: filters.scope === 'all' ? 'all time' : `${MON[calMonth]} ${calYear}`,
    stateRate: costInputs.stateRate,
    platform: setup.platform || 0,
  });

  // Persist the cost setup whenever it changes (after the initial load).
  $effect(() => {
    if (!loaded || isDemo) return; // demo never persists (A87) — and its cost inputs are disabled
    void [setup.broker, setup.feed, setup.stateAbbr, setup.platform];
    store
      .setMeta('setup', { broker: setup.broker, feed: setup.feed, state: setup.stateAbbr, platform: String(setup.platform) })
      .catch((e: unknown) => console.warn('setup persist failed', e)); // A93: surface, don't throw into the effect
  });

  // A124: announce the boot/status events ONCE the dashboard (and the Activity Terminal) is mounted.
  // This effect runs after the first render that sets loaded=true — i.e. after the terminal has
  // subscribed to the bus — so the status lines actually land in the log (boot() can't emit them
  // because it resolves before the terminal exists). Restores the live status log the terminal lost.
  let bootAnnounced = false;
  $effect(() => {
    if (!loaded || bootAnnounced) return;
    bootAnnounced = true;
    emit('refdata:loaded', {});
    emit('data:loaded', { count: allTrades.length });
  });

  // Seed the dataset once if the backend is empty (seeded surfaces only: staging + demo).
  async function seedIfEmpty() {
    if ((await store.tradeCount()) > 0) return;
    const r = Adapters.parse(demoCSV(), 'tradingview');
    if (r.ok && r.trades && r.trades.length) {
      await store.addTrades(r.trades);
      await store.setMeta('setup', { broker: DEMO_BROKER, feed: DEMO_FEED, state: DEMO_STATE, platform: '35' });
    }
  }

  async function boot() {
    await loadRefData();
    if (!store.available()) throw new Error('Local storage is unavailable in this browser');
    await store.init();
    if (SEEDED) await seedIfEmpty();
    const trades = await store.getAllTrades();
    allTrades = trades;
    journalDates = await store.journalDates();
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m] as const));
    savedFilters = ((await store.getMeta('savedFilters')) as SavedFilter[]) || [];
    const su = ((await store.getMeta('setup')) as Partial<Setup>) || {};
    setup = { broker: su.broker || '', feed: su.feed || '', stateAbbr: su.state || '', platform: Number(su.platform) || 0 };
    const last = trades.length ? trades[trades.length - 1].date : null;
    calYear = last ? +last.slice(0, 4) : new Date().getFullYear();
    calMonth = last ? +last.slice(5, 7) - 1 : new Date().getMonth();
    loaded = true;
    status = '';
    // A124: data:loaded / refdata:loaded are emitted from a post-load $effect below, NOT here — the
    // Activity Terminal only subscribes once it mounts (which happens AFTER this boot resolves), so
    // emitting here would fire before any subscriber exists and the terminal would miss the events.
  }

  async function refreshNotes() {
    journalDates = await store.journalDates(); // reassign → reactive
  }

  // After manage-data changes the dataset (import / restore / erase / per-trade edit), reload
  // everything the dashboard derives from.
  async function reloadAll() {
    allTrades = await store.getAllTrades();
    journalDates = await store.journalDates();
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m] as const));
    savedFilters = ((await store.getMeta('savedFilters')) as SavedFilter[]) || []; // A49: a backup-restore can replace these
  }

  // App-mode landing: parse + persist a CSV, then the dashboard takes over (allTrades non-empty).
  // platformId overrides auto-detect when the user picks a platform in the landing dropdown.
  async function loadCSV(file: File, platformId?: string) {
    landingMsg = '';
    const r = Adapters.parse(await file.text(), platformId || undefined);
    if (!r.ok || !r.trades) {
      landingMsg = r.error || 'Could not parse that CSV.';
      return;
    }
    try {
      await store.addTrades(r.trades);
      emit('data:imported', { added: r.trades.length });
      await reloadAll();
      // A113: warn (don't block) when PnL was estimated at $1/point for an unknown contract.
      importWarning = r.estimatedRoots?.length
        ? `Heads-up: Blotterbook has no contract size on file for ${r.estimatedRoots.join(', ')}, so their P&L was estimated at $1/point and may be inaccurate — double-check those symbols.`
        : '';
    } catch (e: unknown) {
      // A93: a persist/reload failure must not leave the landing flow hung with no feedback.
      console.error('CSV import failed', e);
      landingMsg = 'Imported the file but could not save it locally — check your browser storage and try again.';
    }
  }

  // F24 (staging): open the donation page so the dashboard stays put — the user isn't redirected away.
  // A125: open in a new TAB (target _blank) rather than a popup window; noopener/noreferrer keep the
  // opened page from reaching back into this window. Triggered on a direct click (popup-blocker-safe).
  function openDonate() {
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
  }

  function navMonth(delta: number) {
    let m = calMonth + delta;
    let y = calYear;
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

  // A38: jump the calendar cursor to the most recent trade's month.
  function jumpToLatest() {
    const last = allTrades.length ? allTrades[allTrades.length - 1].date : null;
    if (last) {
      calYear = +last.slice(0, 4);
      calMonth = +last.slice(5, 7) - 1;
    }
  }

  // A108: the live dashboard context the module registry's prop-selectors read (see ./lib/modules.ts).
  // Exposed via GETTERS so each selector stays fine-grained reactive — reading ctx.metricsAll inside a
  // module's props() tracks only the underlying $derived, exactly like the old explicit `metrics={…}`.
  const ctx: DashCtx = {
    get metricsAll() {
      return metricsAll;
    },
    get metricsActive() {
      return metricsActive;
    },
    get breakEvenMetrics() {
      return breakEvenMetrics;
    },
    get costInputs() {
      return costInputs;
    },
    get journalDates() {
      return journalDates;
    },
    get selectedDate() {
      return selectedDate;
    },
    get calYear() {
      return calYear;
    },
    get calMonth() {
      return calMonth;
    },
    get filtered() {
      return filtered;
    },
    get tradeMeta() {
      return tradeMeta;
    },
    get filtersActive() {
      return filtersActive;
    },
    get setup() {
      return setup;
    },
    isDemo,
    onselect: d => (selectedDate = selectedDate === d ? null : d),
    navMonth,
    jumpToLatest,
    reloadAll,
  };

  function clearFilters() {
    filters.from = '';
    filters.to = '';
    filters.root = '';
    filters.side = '';
    filters.session = '';
    filters.tag = '';
    filters.dows = [];
  }

  // Saved filter views — persisted in the vanilla-compatible {id,name,f} shape (f.symbol holds the
  // root value, matching render.js + the Store.importAll sanitizer's FILTER_FIELDS).
  async function saveView(name: string) {
    if (isDemo) return; // A87: demo never persists (DemoStore + guard), belt-and-suspenders
    const f: SavedFilterDef = { from: filters.from, to: filters.to, symbol: filters.root, side: filters.side, session: filters.session, tag: filters.tag, dows: [...filters.dows] };
    const id = Date.now().toString(36) + savedFilters.length;
    savedFilters = [...savedFilters, { id, name: (name || '').trim() || `View ${savedFilters.length + 1}`, f }];
    await store.setMeta('savedFilters', $state.snapshot(savedFilters)); // plain clone — IndexedDB can't clone a $state proxy
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
  }
  async function deleteView(id: string) {
    if (isDemo) return; // A87
    savedFilters = savedFilters.filter(s => s.id !== id);
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
  }
  async function renameView(id: string, name: string) {
    if (isDemo) return; // A87
    savedFilters = savedFilters.map(s => (s.id === id ? { ...s, name } : s));
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
  }

  onMount(() => {
    boot().catch((e: unknown) => {
      console.error('app boot failed', e);
      error = e instanceof Error ? e.message : String(e);
      status = '';
    });
    // A89: apply admin flags once they resolve (non-blocking — the dashboard renders on defaults first).
    loadFlags().then(f => (flags = f));
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
</script>

<!-- The session pill (Popover) + Add-module menu (DropdownMenu) own their own open/close, outside-
     click + Escape (bits-ui, A128). This window handler is now ONLY the calendar day-deselect (A121). -->
<svelte:window
  onclick={e => {
    // A121 (staging): clicking off the calendar deselects the selected day. The calendar AND the
    // performance graph both drive day selection (cross-link), so a click inside either panel keeps
    // it; a click anywhere else clears it. (A same-day reclick already toggles off via onselect.)
    if (isStaging && selectedDate) {
      const t = e.target as HTMLElement;
      if (!t.closest('.panel[data-key="cal"]') && !t.closest('.panel[data-key="perf"]')) selectedDate = null;
    }
  }}
  onkeydown={e => {
    if (e.key === 'Escape' && isStaging) selectedDate = null; // A121: Escape clears the selected day too
  }}
/>

<main id="sv-app">
  {#if flags.maintenanceBanner}
    <!-- A89: admin-toggled maintenance notice. Compute stays local, so this is informational only. -->
    <div class="maintbanner" role="status">Scheduled maintenance is in progress — your local data is unaffected.</div>
  {/if}
  {#if importWarning}
    <!-- A113: PnL estimated at $1/point for an unknown contract — warn the user, don't drop their data. -->
    <div class="warnbanner" role="alert">
      <span>{importWarning}</span>
      <button type="button" class="warndismiss" aria-label="Dismiss warning" onclick={() => (importWarning = '')}>×</button>
    </div>
  {/if}
  <header class="topbar">
    <div class="brand">
      <!-- F33 (staging): the wordmark links back to the homepage. Plain text on prod/demo until CH16. -->
      {#if isStaging}<a class="brandlink" href="/">Blotterbook</a>{:else}Blotterbook{/if}
      {#if isStaging}<span class="badge">Staging</span>{/if}{#if flags.betaRibbon}<span class="badge beta">Beta</span>{/if}
    </div>
    <div class="meta">
      {metaLead}{#if dateRange}{metaLead ? ' · ' : ''}{dateRange}{/if}
    </div>
    <div class="topactions">
      <div class="sesswrap">
        <Popover.Root>
          <!-- child snippet → the real <button> lives in App's template, so the scoped `.pill`
               styling (and the class:off state) keep applying; bits-ui wires behavior via {props}. -->
          <Popover.Trigger>
            {#snippet child({ props })}
              <button {...props} class="pill" class:off={!online} title={online ? 'Online' : 'Offline'}>{online ? 'online' : 'offline'}</button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="sesspop w-[260px]" role="dialog" aria-label="Session status legend">
            <p class="pophd">Session status</p>
            <!-- Inner legend styling is utility-based (not `.sesspop X` scoped) so it applies across
                 the bits-ui Popover.Content component boundary (A128). -->
            <ul class="m-0 grid list-none gap-1.5 p-0 text-xs leading-[1.4] text-dim [&_b]:text-txt">
              <li><span class="sdot on"></span> <b>Online</b> — ref-data &amp; functions reachable.</li>
              <li><span class="sdot off"></span> <b>Offline</b> — no network; the app keeps working on your local data.</li>
              <li><span class="sdot deg"></span> <b>Degraded</b> — reserved for partial connectivity.</li>
            </ul>
            <p class="popnote">Compute always stays in your browser — status never gates your data.</p>
          </Popover.Content>
        </Popover.Root>
      </div>
      <!-- F21 (promoted to all surfaces, CH16): the Changelog link was journal-app noise; removed from
           the dashboard top bar on every surface. (The marketing changelog still lives at /changelog.html.) -->
      <a class="link" href="mailto:contact@blotterbook.com?subject=Blotterbook">Contact</a>
      <!-- F24 (staging): support the project. Opens the Stripe donation page in a new tab (A125) so the
           dashboard is never navigated away. -->
      {#if isStaging}<button type="button" class="donatebtn" onclick={openDonate} title="Support Blotterbook — opens Stripe in a new tab">Donate</button>{/if}
      {#if loaded && allTrades.length}<button type="button" class="exportbtn" onclick={() => (exportOpen = true)}>Export report</button>{/if}
      {#if loaded}<button type="button" class="managebtn" onclick={() => (manageOpen = true)}>Manage data</button>{/if}
    </div>
  </header>

  {#if error}
    <p class="msg error" role="alert">Could not start the app: {error}</p>
  {:else if loaded && PAGE_MODE === 'app' && !allTrades.length}
    <Landing {setup} onload={loadCSV} msg={landingMsg} showBeta={flags.showBetaAdapters} />
  {:else if loaded}
    <FilterBar {filters} {roots} {tags} {savedFilters} count={metricsActive.n} onclear={clearFilters} onsave={saveView} onapply={applyView} ondelete={deleteView} />
    <Overview metrics={metricsActive} tradeCount={metricsActive.n} oncard={k => (cardModalKey = k)} />
    <div class="wsrow">
      <WorkspaceBar names={wsNames} value={wsSelected} onsave={saveWorkspace} onselect={selectWorkspace} saveDisabled={isDemo} />
      {#if hiddenList.length}
        <!-- R12 (promoted, CH16): re-spawn a hidden module onto the dashboard. -->
        <div class="addmod">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button {...props} type="button" class="addmodbtn">+ Add module</button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="addmenu min-w-[200px]" align="start" aria-label="Add a hidden module">
              {#each hiddenList as key (key)}
                <DropdownMenu.Item onSelect={() => showPanel(key)}>{MODULE_LABELS[key] || key}</DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {/if}
    </div>
    <!-- A108: one module's chrome+content, keyed. App iterates the registry and renders each module's
         declared component with its selector props (the `panel` bundle differs between the full-width
         and F26-grid contexts, so it's passed per-render). The calendar is the one module with a child
         snippet (its `extra` day-trades + journal editor), so it's the single special-case below. -->
    {#snippet moduleBlock(key: string, panel: PanelBundle)}
      {@const def = MODULE_BY_KEY[key]}
      {#if def}
        {@const Comp = def.component}
        {#if key === 'cal'}
          <Comp {panel} {...def.props(ctx)}>
            {#snippet extra()}
              {#if selectedDate}
                <DayTrades date={selectedDate} trades={dayTrades} filtered={filtersActive} />
                <JournalEditor date={selectedDate} onsaved={refreshNotes} onclose={() => (selectedDate = null)} />
              {/if}
            {/snippet}
          </Comp>
        {:else}
          <Comp {panel} {...def.props(ctx)} />
        {/if}
      {/if}
    {/snippet}
    <div class="dash" role="region" aria-label="Dashboard panels">
      {#each renderSeq as item (item.type === 'grid' ? 'bb-grid' : item.key)}
        {#if item.type === 'grid'}
          <!-- F26 (staging): the grid modules lined up parallel; drag (or the menu's Move left/right)
               reorders them within the grid. -->
          <div class="modgrid" role="group" aria-label="Module grid">
            {#each item.keys as key (key)}
              {@render moduleBlock(key, gridPanelBundle(key))}
            {/each}
          </div>
        {:else}
          {@render moduleBlock(item.key, panelBundle(item.key))}
        {/if}
      {/each}
    </div>
    {#if isStaging}
      <!-- F27 (staging): the Definitions & Caveats module is relegated to a page footer. -->
      <Definitions footer />
    {/if}
  {:else}
    <p class="msg">{status}</p>
  {/if}

  {#if cardModalKey}
    <StatCardModal cardKey={cardModalKey} metrics={metricsActive} cost={costModel(metricsActive, costInputs)} onclose={() => (cardModalKey = null)} />
  {/if}

  {#if exportOpen}
    <ExportReport
      metrics={metricsActive}
      cost={costModel(metricsActive, costInputs)}
      labels={reportLabels}
      onclose={() => (exportOpen = false)}
    />
  {/if}

  {#if manageOpen}
    <ManageData
      onclose={() => (manageOpen = false)}
      onchanged={reloadAll}
      onopenday={d => {
        selectedDate = d;
        manageOpen = false;
      }}
      {savedFilters}
      onapplyview={sf => {
        applyView(sf);
        manageOpen = false;
      }}
      onrenameview={renameView}
      ondeleteview={deleteView}
    />
  {/if}
</main>

<style>
  /* A51: no horizontal page scroll on mobile (parity with vanilla app.css). Pin on BOTH html and
     body so the viewport scroller can't scroll sideways regardless of overflow propagation. */
  :global(html),
  :global(body) {
    max-width: 100%;
    overflow-x: hidden;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--txt);
    font-family: var(--sans);
  }
  #sv-app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px 16px 48px;
  }
  /* L8 (staging): use the full viewport width — drop the 1100px centered column so the modules span
     edge-to-edge (within the page gutters) instead of leaving wide empty margins. Prod/demo keep the
     centered column until promoted (CH16). */
  :global(body[data-mode='staging']) #sv-app {
    max-width: none;
    padding-left: 24px;
    padding-right: 24px;
  }
  @media (max-width: 560px) {
    #sv-app {
      padding: 14px 10px 40px;
    }
    :global(body[data-mode='staging']) #sv-app {
      padding-left: 10px;
      padding-right: 10px;
    }
  }
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 20px;
  }
  .brand {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  /* F33 (staging): the wordmark home-link inherits the brand styling (no underline). */
  .brandlink {
    color: inherit;
    text-decoration: none;
  }
  .brandlink:hover {
    color: var(--primary);
  }
  .brandlink:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: 5px;
    padding: 2px 6px;
    vertical-align: middle;
  }
  /* A89: the betaRibbon flag badge — accent-toned so it reads distinctly from the staging badge. */
  .badge.beta {
    color: var(--primary);
    border-color: var(--primary);
    margin-left: 6px;
  }
  /* A89: admin maintenanceBanner flag. */
  .maintbanner {
    background: var(--panel2);
    border: 1px solid var(--warn);
    border-left: 3px solid var(--warn);
    color: var(--txt);
    border-radius: 8px;
    padding: 9px 14px;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .warnbanner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: var(--panel2);
    border: 1px solid var(--warn);
    border-left: 3px solid var(--warn);
    color: var(--txt);
    border-radius: 8px;
    padding: 9px 14px;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .warndismiss {
    margin-left: auto;
    flex: none;
    background: none;
    border: none;
    color: var(--dim);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }
  .warndismiss:hover {
    color: var(--txt);
  }
  .meta {
    font-size: 12px;
    color: var(--faint);
    font-family: var(--mono);
  }
  .topactions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sesswrap {
    position: relative;
  }
  .pill {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--green);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 9px;
    cursor: pointer;
  }
  .pill::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    margin-right: 5px;
    vertical-align: middle;
  }
  .pill.off {
    color: var(--faint);
  }
  .pill.off::before {
    background: var(--faint);
  }
  /* A128: card chrome + positioning now come from the Popover primitive (bits-ui Floating UI keeps it
     on-screen — replacing the old A127 mobile-anchoring hack). Only the legend's inner styles remain. */
  .pophd {
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .sdot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }
  .sdot.on {
    background: var(--green);
  }
  .sdot.off {
    background: var(--faint);
  }
  .sdot.deg {
    background: var(--warn);
  }
  .popnote {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--faint);
    line-height: 1.4;
  }
  .link {
    font-size: 13px;
    color: var(--primary);
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
  .managebtn,
  .exportbtn {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .managebtn:hover,
  .exportbtn:hover {
    border-color: var(--hover-line);
  }
  /* F24 (staging): the Donate button — accent-toned so it reads as the primary "support" call. */
  .donatebtn {
    background: var(--primary);
    color: var(--bg);
    border: 1px solid var(--primary);
    border-radius: 6px;
    padding: 7px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .donatebtn:hover {
    filter: brightness(1.08);
  }
  .donatebtn:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  /* F26 (staging): the grid modules lined up parallel. auto-fit fits as many ≥360px columns as the
     (now full-width — L8) row allows, dropping to a single column on narrow/mobile. */
  .modgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 0 16px;
    /* L10 (staging): stretch all three columns to a common (tallest) height so the bottoms align and
       the negative space below the shorter modules is reclaimed into the module itself. */
    align-items: stretch;
  }
  /* min-width:0 lets a column shrink below its content's intrinsic width (no grid blowout). The panels
     reach a common height via the grid's align-items:stretch alone — do NOT also set height:100% here:
     the panel's own margin-top would then push its 100%-tall box past the cell bottom and overlap the
     full-width module below it (the Trade Blotter). */
  .modgrid > :global(.panel) {
    min-width: 0;
  }
  /* R12 (staging): the "Add module" control sits beside the workspace bar. */
  .wsrow {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .addmod {
    position: relative;
  }
  .addmodbtn {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .addmodbtn:hover {
    border-color: var(--hover-line);
  }
  .msg {
    color: var(--dim);
    padding: 24px 4px;
  }
  .error {
    color: var(--red);
  }
</style>
