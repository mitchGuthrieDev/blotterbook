<script lang="ts">
  // The Blotterbook app root (UI redesign, CH16 cutover — THE app on all surfaces). Mounts the sidebar
  // AppShell + a hash router over the screens, booting the REAL engine via createDashboard. Mode-aware:
  //   app     → real IndexedDB Store, NO seed (empty → first-run onboarding)
  //   demo    → in-memory DemoStore (never persists), seeded, every write isDemo-guarded
  //   staging → real IndexedDB Store isolated to blotterbookStaging, seeded
  // Screens read real data via props.
  import { onMount } from 'svelte';
  import { Entitlements } from '../lib/core/entitlements.ts';
  import { createDemoStore } from '../lib/core/demostore.ts';
  import {
    usd,
    money,
    num,
    ratio,
    rateFor,
    feeForTrade,
    advStatVals,
    costLineVals,
    BROKERS,
    BROKER_ORDER,
    estimatedCommRoots,
    emit,
    PAGE_MODE,
    pad2,
    tone,
    MONTH_NAMES,
    csvCell,
    expiryOf,
    expiryCode,
  } from '../lib/core/core.ts';
  import { isBetaPhase } from '../lib/core/format.ts';
  import { Badge, badgeVariants } from '$lib/components/ui/badge';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Popover from '$lib/components/ui/popover';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { createDashboard, resolveFromFiles } from './lib/dashboard.svelte.ts';
  import { createDashTabs } from './lib/dashtabs.svelte.ts';
  import { dailySeries } from '../lib/core/curveseries.ts';
  import { navSections, navLabel } from './lib/nav';
  import { UserRound } from '@lucide/svelte';
  import { fade } from 'svelte/transition';
  import { dur } from './lib/motion.ts';
  import Dashboard, {
    type DashKpi,
    type DashStat,
    type DayCell,
    type StatDetail,
    type FilterModel,
    type FilterPatch,
  } from './screens/Dashboard.svelte';
  import { migrateLayout, defaultLayout, analyticsKit, type ModEntry } from './lib/modlayout.ts';
  // The non-default screens are CODE-SPLIT: type-only static imports (erased at build) + lazy
  // `import()` loaders in the router below, so their chunks stay out of the /app first paint
  // (A96 budget). Dashboard stays static — it's the boot screen.
  import type { CalDay, DayTrade } from './screens/Calendar.svelte';
  import { buildAnalytics } from './lib/analytics.ts';
  import type { BlotterRow } from './screens/Blotter.svelte';
  import type { EditorRow } from './screens/TradeEditor.svelte';
  import type { ReportVM, ReportRange, ReportMeta, ExportKind } from './screens/Reports.svelte';
  import { downloadBlob } from './lib/files.ts';
  import type { Csv, ImportPreview } from './screens/CsvLibrary.svelte';
  import Onboarding from './parts/Onboarding.svelte';
  import StatusBanner from './parts/StatusBanner.svelte';
  import DashTabs from './parts/DashTabs.svelte';
  import FeedbackDialog from './parts/FeedbackDialog.svelte';
  import BootSplash from './parts/BootSplash.svelte';
  import LaunchGate from './parts/LaunchGate.svelte';
  import WorkspaceSwitcher from './parts/WorkspaceSwitcher.svelte';
  import { account, refreshSession, completeRecovery, completeReclaim } from './lib/account.svelte.ts';
  import { wrapStore, configureCloudSync } from './lib/cloudsync.svelte.ts';
  import { loadFlags, APP_FLAGS, accountGateEnabled, type AppFlags } from './lib/flags.ts';
  import { pickFlavor } from './lib/flavor.ts';
  import { createEconOverlay } from './lib/econ.svelte.ts';
  import { Adapters } from '../lib/core/adapters.ts';
  import { checkCsvFile, checkXlsxFile, isXlsxFile } from '../lib/core/intake.ts';
  import { classifyNonTrade, type BatchRow } from './lib/batch.ts';
  import type { Trade, ParseResult } from '../lib/core/types.ts';

  // Mode-aware persistence seam (parity with the legacy App.svelte):
  //   app      → real IndexedDB Store (blotterbook DB), NO seed (real user data; empty → onboarding)
  //   demo     → in-memory DemoStore (never persists), seeded, every write isDemo-guarded
  //   staging  → real IndexedDB Store (isolated blotterbookStaging DB), seeded
  const isDemo = PAGE_MODE === 'demo';
  const isStaging = PAGE_MODE === 'staging';
  // F60: the non-demo Store is resolved THROUGH Entitlements (the tier → Store seam), never by
  // importing Store directly. storeFor() is tier-agnostic today — both tiers return the local
  // IndexedDB Store; F63's CloudStore swaps in for 'cloud' without touching any consumer — so this
  // resolves synchronously and boot is unchanged. The active WORKSPACE is still resolved inside the
  // local Store (F59); Entitlements only picks the implementation. The real tier probe
  // (Entitlements.current() → /api/me) is deferred to F63, where CloudStore actually consumes it —
  // so prod issues no new account traffic here (F56). Demo mounts the in-memory DemoStore.
  // A256/F63: every NON-DEMO store is wrapped in a CloudStore (write-behind sync) — reads still hit
  // IndexedDB (offline-first; network never on the read path), writes also enqueue a DEBOUNCED
  // encrypted push. The wrapper is INERT until a cloud-tier user opts a workspace into sync + unlocks:
  // the controller gates every push on tier === 'cloud' + an unlocked IK, so on local-tier prod (and
  // until a workspace is enabled) wrapping is a pure passthrough and boot is unchanged. Selection here
  // is DEMO-vs-not; the cloud-tier gate is the controller's RUNTIME check (A256). Demo uses the plain
  // in-memory DemoStore — CloudStore is never constructed there, so demo NEVER syncs (non-persistence
  // holds by construction).
  const localStore = isDemo ? createDemoStore() : Entitlements.storeFor('local');
  const store = isDemo ? localStore : wrapStore(localStore);
  const SEEDED = isStaging || isDemo;
  const dash = createDashboard(store, { seed: SEEDED, isDemo });
  const dashTabsState = createDashTabs(store, { isStaging });

  // Lazy screen loaders (one Vite chunk each). `import()` caches per specifier, and the shell
  // prefetches them once idle (see onMount), so the first navigation to a screen is instant in
  // practice while the boot payload carries only the shell + Dashboard.
  const SCREEN_LOADERS = {
    calendar: () => import('./screens/Calendar.svelte'),
    analytics: () => import('./screens/Analytics.svelte'),
    blotter: () => import('./screens/Blotter.svelte'),
    trades: () => import('./screens/TradeEditor.svelte'),
    reports: () => import('./screens/Reports.svelte'),
    csv: () => import('./screens/CsvLibrary.svelte'),
    account: () => import('./screens/Account.svelte'),
  };

  // F53/CH16: passkey accounts, promoted to every surface (demo renders it read-only via isDemo).
  const sections = [...navSections, { label: 'Account', items: [{ key: 'account', label: 'Account', icon: UserRound }] }];
  const allNavKeys = $derived(new Set(sections.flatMap(s => s.items.map(i => i.key))));

  const fromHash = (): string => {
    const h = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
    return allNavKeys.has(h) ? h : 'dashboard';
  };
  let active = $state(fromHash());
  $effect(() => {
    const onHash = () => (active = fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
  function navigate(key: string) {
    location.hash = key;
    active = key;
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────────────────────
  const dStats = $derived.by<DashStat[]>(() => {
    const m = dash.metricsActive;
    return [
      { key: 'net', label: 'Net P&L', value: usd(m.net), up: m.net >= 0, note: `${m.wins}W · ${m.losses}L` },
      { key: 'win', label: 'Win rate', value: `${m.winRate.toFixed(1)}%`, note: `${m.n} trades` },
      { key: 'pf', label: 'Profit factor', value: ratio(m.pf), note: 'gross win ÷ loss' },
      { key: 'exp', label: 'Expectancy', value: usd(m.expectancy), badge: 'per trade', up: m.expectancy >= 0, note: 'avg edge' },
      {
        key: 'dd',
        label: 'Max drawdown',
        value: m.maxDD > 0 ? `-${money(m.maxDD)}` : '$0',
        // A170: maxDDpct is null for an inception drawdown (no positive prior peak) — omit the badge
        // rather than render a wrong-looking 0.0%.
        badge: m.maxDDpct != null ? `${m.maxDDpct.toFixed(1)}%` : undefined,
        up: false,
        note: m.maxDDpct != null ? 'of peak' : 'from inception',
      },
      { key: 'sharpe', label: 'Sharpe (daily)', value: num(m.sharpe), note: `${m.active} trading days` },
    ];
  });
  // A271 remainder: raw numbers for the glanceable KPI-card modules (Win Rate / Profit Factor /
  // Expectancy) — same scope-active Metrics as the stat row; the modules add the visual breakdown.
  const dashKpi = $derived.by<DashKpi>(() => {
    const m = dash.metricsActive;
    return {
      n: m.n,
      wins: m.wins,
      losses: m.losses,
      scratch: m.scratch,
      winRate: m.winRate,
      pf: m.pf,
      gp: m.gp,
      gl: m.gl,
      expectancy: m.expectancy,
      avgW: m.avgW,
      avgL: m.avgL,
    };
  });
  // Daily cumulative gross/net/take series for the Performance chart — same cost/tax-adjusted math as
  // the cost panel (tEff/fixedMo from costModel), so the Net/Take-home overlays reconcile.
  const dashSeries = $derived(
    dailySeries(dash.metricsActive, {
      broker: String(dash.costInputs.broker ?? ''),
      tEff: dash.cost.tEff,
      fixedMo: dash.cost.fixedMo,
      brokerFor: dash.costInputs.brokerFor, // A211 — per-file overrides, same rule as costModel
    }).pts
  );
  // Live filter model for the dashboard Filters popover — reads the app's filter state; the setters
  // mutate it in place so filtered/metrics/series/calendar all re-derive.
  // ── Dashboard tabs (A135; promoted to all surfaces — CH16) ──────────────────────────────────
  // Multiple named dashboards, each with its own module layout, persisted to the Store.local seam
  // (staging-namespaced keys). Extracted to dashtabs.svelte.ts (A224) — dashTabsState owns the tabs/
  // dirty/draft-layout runes; App.svelte just wires it to DashTabs + the Dashboard module prop below.
  const dashModules = $derived(dashTabsState.dashModules);

  // Economic-event overlay (R14/R14b) — a shared reactive instance for the Calendar screen + the
  // dashboard Calendar module. Persisted pref key is per-surface namespaced like the dashTabs keys;
  // the dataset is LAZY (loadEconEvents, kept out of the boot loadRefData path). First-run defaults
  // to 'high' (overlay on, high-impact only) per the owner's v1 decision. Demo uses DemoStore.local
  // (in-memory) so toggles work but never persist — no special-casing.
  const ECON_KEY = isStaging ? 'bb:staging:econCal' : 'bb:econCal';
  const econ = createEconOverlay(store, ECON_KEY);

  // Named workspace layout templates (R12 parity): save/apply/delete the module layout by name; revert
  // clears the layout back to the default (all modules). Persisted to Store.local (per-surface key).
  const WS_KEY = isStaging ? 'bb:staging:dashLayouts' : 'bb:dashLayouts';
  // A271: a workspace template snapshots the full sized layout ({key,size}[]). Read through the SAME
  // lossless migration as tab layouts, so pre-A271 templates (a bare key `string[]`) upgrade in place.
  let wsTemplates = $state<Record<string, ModEntry[]>>(
    Object.fromEntries(
      Object.entries((store.local.get(WS_KEY, {}) as Record<string, unknown>) || {}).map(([name, v]) => [
        name,
        migrateLayout(v)?.mods ?? defaultLayout().mods,
      ])
    )
  );
  function persistWs() {
    // Persist each template as the versioned payload so migrateLayout round-trips it on next read.
    const out = Object.fromEntries(Object.entries($state.snapshot(wsTemplates)).map(([name, mods]) => [name, { v: 2, mods }]));
    store.local.set(WS_KEY, out);
  }

  // A286: the Calendar screen's daily P&L target — persisted via the Store.local seam (per-surface key)
  // so it survives reload instead of resetting to $200. On demo the in-memory DemoStore just doesn't
  // persist it across reloads, which is correct (a UI pref, not trade data).
  const CAL_TARGET_KEY = isStaging ? 'bb:staging:calTarget' : 'bb:calTarget';
  let calTarget = $state(Number(store.local.get(CAL_TARGET_KEY, 200)) || 200);
  function saveCalTarget(v: number) {
    calTarget = v;
    store.local.set(CAL_TARGET_KEY, v);
  }

  // A271 slice: the Analytics screen's per-module size layout — persisted to the Store.local seam
  // (per-surface namespaced key), read through the analyticsKit lossless migration (a v1 bare-key
  // string[] or a v2 {key,size}[] both upgrade). Analytics has no tabs/staged-save, so a size change
  // persists immediately (unlike the Dashboard's dirty-asterisk model). On demo the in-memory
  // DemoStore.local means edits work but never persist across reloads — correct (a UI pref, not trade
  // data), and no isDemo guard is needed (DemoStore.local writes to its in-memory map, so nothing
  // reaches localStorage by construction).
  const ANALYTICS_MOD_KEY = isStaging ? 'bb:staging:analyticsModules' : 'bb:analyticsModules';
  let analyticsModules = $state<ModEntry[] | undefined>(analyticsKit.migrateLayout(store.local.get(ANALYTICS_MOD_KEY))?.mods);
  function saveAnalyticsModules(mods: ModEntry[]) {
    analyticsModules = mods;
    store.local.set(ANALYTICS_MOD_KEY, { v: 2, mods });
  }
  const dashLayouts = $derived({
    names: Object.keys(wsTemplates),
    canSave: !dash.isDemo,
    save: (name: string) => {
      if (dash.isDemo) return;
      // A148: an untouched dashboard has dashModules === undefined (= the default layout) — capture
      // the ACTUAL default layout, not [], so applying the saved template can't blank the dashboard.
      wsTemplates = { ...wsTemplates, [name]: [...(dashModules ?? defaultLayout().mods)] };
      persistWs();
    },
    // A193: applying a template / resetting to default are EXPLICIT target states — they persist
    // immediately (stage + save), unlike incremental module edits which stage behind the dirty
    // asterisk. Keeps the template menu's contract consistent with its save/remove actions.
    apply: (name: string) => {
      const mods = wsTemplates[name];
      if (mods) {
        dashTabsState.saveModules([...mods]);
        dashTabsState.saveTabLayout();
      }
    },
    remove: (name: string) => {
      if (dash.isDemo) return;
      const next = { ...wsTemplates };
      delete next[name];
      wsTemplates = next;
      persistWs();
    },
    revert: () => {
      dashTabsState.revertModules();
      dashTabsState.saveTabLayout();
    },
  });

  const filterModel = $derived<FilterModel>({
    root: dash.filters.root,
    side: dash.filters.side,
    session: dash.filters.session,
    tag: dash.filters.tag,
    from: dash.filters.from,
    to: dash.filters.to,
    dows: dash.filters.dows,
    hours: dash.filters.hours,
    roots: dash.roots,
    tags: dash.tags,
    count: dash.filtered.length,
    set: (patch: FilterPatch) => Object.assign(dash.filters, patch),
    clear: () => dash.clearFilters(),
    views: dash.savedFilters.map(v => ({ id: v.id, name: v.name })),
    canSaveView: !dash.isDemo,
    saveView: (name: string) => dash.saveView(name),
    applyView: (id: string) => {
      const sf = dash.savedFilters.find(s => s.id === id);
      if (sf) dash.applyView(sf);
    },
    deleteView: (id: string) => dash.deleteView(id),
    renameView: (id: string, name: string) => dash.renameView(id, name),
  });

  // KPI card drill-in content (parity with the app/demo stat-card modal), from metrics + cost.
  function statDetail(key: string): StatDetail {
    const m = dash.metricsActive;
    const c = dash.cost;
    const cv = costLineVals(c); // A288/A289: single-sourced cost + stat values (labels kept local)
    const av = advStatVals(m);
    const bar = (
      label: string,
      v: number,
      max: number,
      t: 'pos' | 'neg' | 'muted'
    ): { label: string; value: string; pct: number; tone: 'pos' | 'neg' | 'muted' } => ({
      label,
      value: usd(v),
      pct: max ? (Math.abs(v) / max) * 100 : 0,
      tone: t,
    });
    switch (key) {
      case 'net': {
        const mx = Math.max(Math.abs(c.gross), Math.abs(c.netPreTax), Math.abs(c.afterTax), 1);
        return {
          title: 'Net P&L',
          value: usd(m.net),
          tone: tone(m.net),
          // A172: this figure is the imported realized P&L BEFORE modeled costs — the waterfall
          // below applies commissions, subscriptions and the estimated §1256 tax to it.
          desc: 'Realized P&L as imported — before modeled costs. The waterfall below applies commissions, subscriptions and estimated Section 1256 tax.',
          bars: [bar('Gross', c.gross, mx, 'pos'), bar('Net (pre-tax)', c.netPreTax, mx, 'pos'), bar('Take-home', c.afterTax, mx, 'muted')],
          rows: [
            { label: 'Gross P&L', value: cv.gross, tone: tone(c.gross) },
            { label: 'Commissions (all-in)', value: cv.commissions, tone: 'neg' },
            { label: `Subscriptions (${c.months} mo)`, value: cv.subscriptions, tone: 'neg' },
            { label: 'Est. 1256 tax', value: usd(-c.tax), tone: 'neg' },
            { label: 'Take-home', value: usd(c.afterTax), tone: tone(c.afterTax) },
          ],
        };
      }
      case 'win': {
        const mx = Math.max(m.wins, m.losses, m.scratch, 1);
        return {
          title: 'Win rate',
          value: `${m.winRate.toFixed(1)}%`,
          desc: 'Share of trades closed for a profit.',
          bars: [
            { label: 'Wins', value: `${m.wins}`, pct: (m.wins / mx) * 100, tone: 'pos' },
            { label: 'Losses', value: `${m.losses}`, pct: (m.losses / mx) * 100, tone: 'neg' },
            { label: 'Scratch', value: `${m.scratch}`, pct: (m.scratch / mx) * 100, tone: 'muted' },
          ],
          rows: [
            { label: 'Wins', value: `${m.wins}`, tone: 'pos' },
            { label: 'Losses', value: `${m.losses}`, tone: 'neg' },
            { label: 'Scratch (0)', value: `${m.scratch}` },
            { label: 'Total trades', value: `${m.n}` },
          ],
        };
      }
      case 'pf': {
        const mx = Math.max(m.gp, Math.abs(m.gl), 1);
        return {
          title: 'Profit factor',
          value: ratio(m.pf),
          desc: 'Gross profit ÷ gross loss — dollars won per dollar lost.',
          bars: [bar('Gross profit', m.gp, mx, 'pos'), bar('Gross loss', m.gl, mx, 'neg')],
          rows: [
            { label: 'Gross profit', value: usd(m.gp), tone: 'pos' },
            { label: 'Gross loss', value: usd(m.gl), tone: 'neg' },
            { label: 'Profit factor', value: ratio(m.pf) },
          ],
        };
      }
      case 'exp':
        return {
          title: 'Expectancy',
          value: usd(m.expectancy),
          tone: tone(m.expectancy),
          desc: 'Average P&L per trade — your statistical edge.',
          rows: [
            { label: 'Average win', value: usd(m.avgW), tone: 'pos' },
            { label: 'Average loss', value: usd(m.avgL), tone: 'neg' },
            { label: 'Payoff ratio', value: av.payoff },
            { label: 'Per-trade std dev', value: money(m.tStd) },
          ],
        };
      case 'dd':
        return {
          title: 'Max drawdown',
          value: m.maxDD > 0 ? `-${money(m.maxDD)}` : '$0',
          tone: 'neg',
          desc: 'Largest peak-to-trough drop in realized equity.',
          rows: [
            { label: 'Max drawdown', value: m.maxDD > 0 ? usd(-m.maxDD) : '$0', tone: 'neg' },
            { label: '% of peak', value: m.maxDDpct != null ? `${m.maxDDpct.toFixed(1)}%` : '—' },
            // A170: ddPeakIdx/ddTroughIdx are curve indices (curve[k] = equity after trade k;
            // index 0 is the pre-trade origin) — surface the span the duration is counted over.
            {
              label: 'Peak → trough',
              value:
                m.ddPeakIdx != null && m.ddTroughIdx != null
                  ? `${m.ddPeakIdx === 0 ? 'inception' : `trade ${m.ddPeakIdx}`} → trade ${m.ddTroughIdx}`
                  : '—',
            },
            { label: 'Duration', value: `${m.maxDDdur} trades` },
            { label: 'Recovery factor', value: av.recovery },
          ],
        };
      case 'sharpe':
        return {
          title: 'Sharpe (daily)',
          value: num(m.sharpe),
          desc: 'Daily mean P&L ÷ daily P&L std dev (illustrative — not annualized).',
          rows: [
            { label: 'Avg daily P&L', value: usd(m.avgDaily), tone: tone(m.avgDaily) },
            { label: 'Sortino (daily)', value: av.sortino },
            { label: 'Active days', value: `${m.active}` },
            { label: 'Avg trades / day', value: m.avgTrades.toFixed(1) },
          ],
        };
      default:
        return { title: key, value: '—', desc: '', rows: [] };
    }
  }
  // The Trading Calendar module shows the cursor month from the all-time (filtered) days, independent
  // of the scope toggle (mirrors the current app).
  const calData = $derived.by(() => {
    const y = dash.calYear,
      mo = dash.calMonth;
    const dayPnl: Record<number, DayCell> = {};
    let net = 0;
    for (const d of dash.metricsAll.days) {
      const dt = new Date(d.date + 'T00:00:00');
      if (dt.getFullYear() === y && dt.getMonth() === mo) {
        dayPnl[dt.getDate()] = { pnl: d.pnl, tr: d.trades };
        net += d.pnl;
      }
    }
    return {
      dayPnl,
      net,
      firstDow: new Date(y, mo, 1).getDay(),
      daysInMonth: new Date(y, mo + 1, 0).getDate(),
      label: `${MONTH_NAMES[mo]} ${y}`,
    };
  });

  // ── Calendar ─────────────────────────────────────────────────────────────────────────────────
  // The full Calendar screen reads per-day records (P&L / trades / wins + a note flag) for the cursor
  // month and a date→P&L map for the year heatmap, both from the all-time (filtered) days.
  const dateOf = (day: number) => `${dash.calYear}-${pad2(dash.calMonth + 1)}-${pad2(day)}`;
  const calMonthDays = $derived.by<Record<number, CalDay>>(() => {
    const out: Record<number, CalDay> = {};
    for (const d of dash.metricsAll.days) {
      const dt = new Date(d.date + 'T00:00:00');
      if (dt.getFullYear() === dash.calYear && dt.getMonth() === dash.calMonth) {
        // A166: carry the day's journal (context) tags so the month grid can surface them (cell title).
        out[dt.getDate()] = {
          pnl: d.pnl,
          trades: d.trades,
          wins: d.wins,
          note: dash.journalDates.has(d.date),
          tags: dash.journalFor(d.date).tags,
        };
      }
    }
    return out;
  });
  const calYearPnl = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of dash.metricsAll.days) if (+d.date.slice(0, 4) === dash.calYear) out[d.date] = d.pnl;
    return out;
  });
  // Econ overlay for the calendar cursor month (R14b) — reactive to the cursor + the overlay mode +
  // the lazy dataset finishing loading. Empty Map when off/unloaded, so the cells just show no marks.
  const calEconMonth = $derived(econ.monthEvents(dash.calYear, dash.calMonth + 1));
  const calTradesForDay = (day: number): DayTrade[] =>
    dash.tradesForDay(dateOf(day)).map(t => ({
      time: (t.time || '').slice(11, 16),
      sym: t.root,
      side: t.side === 'short' ? 'Short' : 'Long',
      qty: t.qty ?? 1,
      pnl: t.pnl,
    }));

  // ── Analytics ────────────────────────────────────────────────────────────────────────────────
  // Per-trade tags live in trademeta (keyed by trade id), so the By-tag breakdown (R17/A165) gets
  // the lookup as an accessor — buildAnalytics stays pure.
  const tagsForTrade = (t: Trade) => dash.tradeMeta.get(dash.tradeId(t))?.tags ?? [];
  const analytics = $derived(buildAnalytics(dash.metricsActive, dash.metricsActive.trades, tagsForTrade));

  // Dashboard modules (Break-even & Cost + Advanced Statistics) — reuse the cost waterfall + the
  // Analytics advanced-stats grid so the dashboard cards match their full-screen counterparts.
  // A171: roots priced off the fallback per-side rate get an asterisk + footnote so estimated
  // commissions are distinguishable from fee-table rates.
  const dashEstRoots = $derived(estimatedCommRoots(dash.cost));
  // A208: how many active trades are priced at their ACTUAL CSV commission (vs the modeled rate).
  const dashActualCommNote = $derived.by(() => {
    const c = dash.cost;
    return c.actualCommTrades > 0
      ? `† ${c.actualCommTrades} of ${c.n} trade${c.n === 1 ? '' : 's'} priced at actual commissions from your CSV (${usd(c.actualComm)}).`
      : '';
  });
  const dashCostRows = $derived.by(() => {
    const c = dash.cost;
    const cv = costLineVals(c); // A288: single-sourced cost-line values (labels/markers stay here)
    return [
      { label: 'Gross P&L', value: cv.gross, tone: tone(c.gross) },
      {
        label: `Commissions (all-in)${dashEstRoots.length ? ' *' : ''}${c.actualCommTrades > 0 ? ' †' : ''}`,
        value: cv.commissions,
        tone: 'neg' as const,
      },
      { label: `Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, value: cv.subscriptions, tone: 'neg' as const },
      { label: 'Est. 1256 tax', value: usd(-c.tax), tone: 'neg' as const },
      { label: 'Take-home', value: usd(c.afterTax), tone: tone(c.afterTax), total: true },
      { label: 'Break-even / trade', value: usd(c.bePer) },
    ];
  });
  const dashAdvStats = $derived(analytics.statRows);

  // ── Blotter / Trade Editor rows ──────────────────────────────────────────────────────────────
  // ONE per-trade row base for both tables (A157 — the two mappers had drifted into near-identical
  // copies): id/qty/meta, display date/time/side, fees from the broker rate via the shared core
  // roundTurn, F42 entry/exit prices (when the export carried them; else undefined → '—'), and the
  // F40 contract expiry code derived from the RAW symbol (t.symbol, not the stripped root).
  const rowBase = (t: Trade) => {
    const id = dash.tradeId(t);
    const qty = t.qty ?? 1;
    const meta = dash.tradeMeta.get(id);
    // F30: dated rate; A211: at the trade's own broker when its source file carries an override.
    const rowBroker = dash.costInputs.brokerFor?.(t) ?? dash.setup.broker;
    const r = rowBroker ? rateFor(rowBroker, t.root, t.date) : null;
    const exp = expiryOf(t.symbol, t.date); // F40 — null for continuous/spread/bare symbols
    return {
      id,
      qty,
      meta,
      date: t.date,
      time: (t.time || '').slice(11, 16),
      side: t.side === 'short' ? ('Short' as const) : ('Long' as const),
      pnl: t.pnl,
      // F42: per-fill entry/exit prices when the source export carried them.
      entryPrice: Number.isFinite(t.entryPrice) ? (t.entryPrice as number) : undefined,
      exitPrice: Number.isFinite(t.exitPrice) ? (t.exitPrice as number) : undefined,
      // F40: compact contract code ("M25"); undefined when the symbol has no month code.
      expiry: exp ? expiryCode(exp) : undefined,
      // A208/A283: the actual-CSV-commission-wins-else-modeled rule is single-sourced in feeForTrade
      // (same helper costModel uses), so this column can't drift from the cost totals. No fee shown when
      // there's neither an actual commission nor a fee-table rate row (r) to model from.
      fees:
        t.commission != null && Number.isFinite(t.commission)
          ? +feeForTrade(t, 0, qty).toFixed(2)
          : r
            ? +feeForTrade(t, r.rate, qty).toFixed(2)
            : undefined,
    };
  };
  const blotterRows = $derived<BlotterRow[]>(
    dash.filtered.map(t => {
      const b = rowBase(t);
      return {
        ...b,
        sym: t.root,
        entry: b.entryPrice, // F42
        exit: b.exitPrice,
        expiry: b.expiry, // F40
        holdMin: t.holdMs != null ? Math.round(t.holdMs / 60000) : undefined,
        tags: b.meta?.tags ?? [],
        note: !!b.meta?.note,
        noteText: b.meta?.note ?? '',
        session: dash.sessionOf(t) === 'rth' ? 'RTH' : 'ETH',
        platform: platformOf(t), // F50 — provenance platform (same resolver as the Trade Editor)
      };
    })
  );

  // F46: provenance platform per trade — fileIds → the contributing file records' labels, compacted
  // (the family adapters' '(orders)'-style type suffix is per-FILE detail; the trade-level column
  // shows the platform). Overlap trades list each distinct platform once; legacy/no-provenance → ''.
  // A249: resolveFromFiles (dashboard.svelte.ts) owns the shared "index csvFiles by id, scan
  // t.fileIds" idiom; this caller's pick collects every distinct label.
  function platformOf(t: Trade): string {
    const labels = resolveFromFiles(t, dash.csvFiles, f => (f.platformLabel || f.platform || '').replace(/\s*\(.*\)$/, '') || undefined);
    return [...new Set(labels)].join(' · ');
  }

  // Imported trades are immutable → the editor edits the metadata layer (tags + note); core cells
  // render read-only (entry/exit NaN → "—").
  const editorRows = $derived<EditorRow[]>(
    dash.filtered.map(t => {
      const b = rowBase(t);
      return {
        ...b,
        symbol: t.root,
        // F42: real prices when the export carried them (else NaN → '—' in the read-only cell).
        entry: b.entryPrice ?? NaN,
        exit: b.exitPrice ?? NaN,
        fees: b.fees ?? NaN,
        platform: platformOf(t),
        tags: b.meta?.tags ?? [],
        note: b.meta?.note ?? '',
        shots: b.meta?.shots ?? [],
      };
    })
  );
  // Persist the Trade Editor's staged changes. editorRows reflects the PERSISTED state at save time
  // (the component holds edits in its own draft), so it's the pre-edit snapshot to diff against: a row
  // whose core fields changed goes through editTradeCore (rebuild + new id + migrate meta); a row with
  // only tag/note changes goes through saveTradeMeta.
  async function persistEditorRows(changed: EditorRow[]) {
    const origById = new Map(editorRows.map(r => [r.id, r]));
    for (const r of changed) {
      const o = origById.get(r.id);
      const coreChanged =
        !!o && (o.date !== r.date || o.time !== r.time || o.symbol !== r.symbol || o.side !== r.side || o.qty !== r.qty || o.pnl !== r.pnl);
      if (coreChanged) await dash.editTradeCore(r);
      else await dash.saveTradeMeta(r.id, r.tags, r.note, r.shots);
    }
  }
  const EDITABLE_FIELDS = ['date', 'time', 'symbol', 'side', 'qty', 'pnl'];

  // ── Reports ──────────────────────────────────────────────────────────────────────────────────
  // The preview + exports are built from the real engine: slice trades to the chosen range, run
  // compute()+costModel(), and assemble via the shared report.ts builder. Reads dash live so the
  // preview tracks data/setup changes through the component's derived.
  const reportLabels = $derived({
    broker: dash.brokerName(dash.setup.broker),
    feed: dash.setup.feed || '—',
    state: dash.setup.stateAbbr || '—',
    stateRate: Number(dash.costInputs.stateRate) || 0,
    platform: dash.setup.platform,
  });
  function onReportExport(kind: ExportKind, vm: ReportVM) {
    if (kind === 'md') downloadBlob('blotterbook-report.md', new Blob([vm.md], { type: 'text/markdown' }));
    else if (kind === 'copy') void navigator.clipboard?.writeText(vm.text);
    else if (kind === 'email') location.href = vm.mailto;
    else if (kind === 'pdf') window.print();
    else if (kind === 'csv') {
      // A154: neutralize spreadsheet formula prefixes (= + - @ tab) with a leading apostrophe so a
      // cell that reached the store un-sanitized can't execute when the export opens in Excel/Sheets,
      // then quote-wrap via the shared csvCell (core.ts, A247).
      const esc = (c: string) => csvCell(/^[=+\-@\t\r]/.test(c) ? `'${c}` : c);
      // A282: export the SAME range/scope-filtered trades the preview + every other export use (vm.trades),
      // not the full dataset — so a Custom/Month range in the toolbar is honored by CSV too.
      const rows = [
        ['date', 'time', 'symbol', 'side', 'qty', 'pnl'],
        ...vm.trades.map(t => [t.date, t.time, t.root, t.side, String(t.qty ?? 1), String(t.pnl)]),
      ];
      downloadBlob('blotterbook-trades.csv', new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    }
  }

  // ── CSV Library ──────────────────────────────────────────────────────────────────────────────
  // F37: real per-file provenance. The table lists the Store's file records (rename/include/
  // download/re-import/delete all work per file); trades imported BEFORE per-file storage landed
  // carry no fileIds and surface as one derived legacy row (delete = clear the dataset, as before).
  // The parsed text/result are stashed between parse() and import() (one preview at a time).
  const legacyTradeCount = $derived(dash.allTrades.filter(t => !t.fileIds?.length).length);
  const csvFiles = $derived<Csv[]>([
    ...dash.csvFiles.map(f => ({
      id: f.id,
      name: f.name,
      label: f.label,
      platform: f.platformLabel || f.platform,
      rows: f.rows,
      trades: f.tradeCount,
      imported: (f.imported || '').slice(0, 10),
      from: f.from,
      to: f.to,
      status: 'ok' as const,
      sizeKb: Math.max(1, Math.round(f.size / 1024)),
      overlap: f.overlap,
      included: f.included,
      broker: f.broker, // A211
    })),
    ...(legacyTradeCount
      ? [
          {
            id: 'dataset',
            name: 'Imported trades (no file history)',
            platform: 'Imported',
            rows: legacyTradeCount,
            trades: legacyTradeCount,
            imported: '',
            from: dash.allTrades.find(t => !t.fileIds?.length)?.date ?? '',
            to: [...dash.allTrades].reverse().find(t => !t.fileIds?.length)?.date ?? '',
            status: 'ok' as const,
            sizeKb: 0,
            overlap: 0,
            included: true,
            legacy: true,
          },
        ]
      : []),
  ]);
  let pendingCsv: { text: string; name: string; result: ParseResult } | null = null;
  function parseCsv(text: string, name: string): ImportPreview {
    const r = Adapters.parse(text);
    pendingCsv = { text, name, result: r };
    if (!r.ok || !r.trades) {
      pendingCsv = null;
      // (an error-only preview — keep the shape aligned with CsvLibrary's errorPreview(); a value
      //  import of it here would pull the lazy-loaded screen into the boot chunk)
      return {
        name,
        platform: '',
        rows: 0,
        tradeCount: 0,
        from: '',
        to: '',
        estimatedRoots: [],
        skippedFills: 0,
        openLots: 0,
        sample: [],
        error: r.ok ? 'No completed trades found.' : r.error,
      };
    }
    const trades = r.trades;
    const rows = Math.max(0, text.trim().split(/\r?\n/).length - 1);
    const sample = trades.slice(0, 3).map(t => ({
      time: (t.time || '').slice(11, 16),
      sym: t.root,
      side: t.side === 'short' ? 'Short' : 'Long',
      qty: t.qty ?? 1,
      pnl: t.pnl,
      up: t.pnl >= 0,
    }));
    return {
      name,
      platform: r.label ?? 'CSV',
      beta: !!r.beta, // A178: surface beta detection in the preview, before confirm
      rows,
      tradeCount: trades.length,
      from: trades[0]?.date ?? '',
      to: trades[trades.length - 1]?.date ?? '',
      estimatedRoots: r.estimatedRoots ?? [],
      skippedFills: r.skippedFills ?? 0,
      openLots: r.openLots ?? 0,
      sample,
      // A176 first slice: data-driven field coverage — computed from the actual parsed trades,
      // so the preview truthfully states what THIS file provides (not what the format claims).
      coverage: {
        hold: trades.filter(t => t.holdMs != null).length / trades.length,
        qty: trades.filter(t => t.qty != null).length / trades.length,
        comm: trades.filter(t => t.commission != null).length / trades.length,
      },
      upgradeHint: r.upgradeHint,
      // Cross-export reconciliation preview: how many rows the authoritative record contradicts —
      // resolved automatically on confirm (same classifiers the real import uses).
      conflicts: dash.previewReconcile(trades, r.kind || '', r.platform || ''),
    };
  }
  async function importPreview() {
    // F37: persist the file record + raw text alongside the trades (provenance-stamped).
    if (pendingCsv) await dash.importCsv(pendingCsv.text, pendingCsv.name, pendingCsv.result);
    pendingCsv = null;
  }

  // F37 CSV Library per-file actions — all thin wrappers over the dash/store seam.
  function csvDelete(id: string) {
    // The legacy no-provenance row can only be cleared wholesale (pre-F37 behavior).
    return id === 'dataset' ? dash.purgeAll() : dash.deleteFile(id);
  }
  async function csvDownload(id: string) {
    const rec = dash.csvFiles.find(f => f.id === id);
    const text = await dash.fileText(id);
    if (rec && text != null) downloadBlob(rec.name || 'import.csv', new Blob([text], { type: 'text/csv' }));
  }

  // First-run onboarding (prod /app only): shown when the real Store is empty. Parses + imports a CSV
  // directly (setup is already persisted via CostSetup → dash.saveSetup on each change).
  // A235: onboarding is for a TRULY fresh app — no trades AND no files in the library. An
  // all-excluded library (the include toggles off) keeps the normal shell with empty-state
  // dashboards + the banner below; only Erase all data returns to this initial state.
  // F48: `onboardingActive` (armed by freshness, cleared by the Launch button) keeps the review
  // step up after an import instead of auto-entering the app (the review list itself lives in
  // Onboarding — F47's DetectionStatus rows).
  let onboardingActive = $state(false);
  const freshApp = $derived(!isDemo && !isStaging && dash.loaded && !dash.allTrades.length && !dash.csvFiles.length);
  const needsOnboarding = $derived(!isDemo && !isStaging && dash.loaded && onboardingActive);
  $effect(() => {
    if (freshApp) onboardingActive = true;
  });

  // F56: login-gated launch (staging-only). Armed by the ACCOUNT_GATE constant or a bb:flags override;
  // CH16 (2026-07-06): the login gate is promoted to PROD — armed on app + staging when
  // accountGateEnabled(), DEMO is never gated (isDemo excluded; demo is the public, no-signup try-it
  // surface). When armed, App probes /api/me at boot (refreshSession, below) and holds the whole app
  // behind LaunchGate until a user is signed in — `!account.user` covers both the in-flight probe
  // (gate shows its own skeleton) and the logged-out state. On login/register `account.user` flips and
  // the gate unmounts, so the normal flow proceeds (dashboard, or first-run onboarding composed after).
  const gateArmed = !isDemo && accountGateEnabled();
  const gateBlocking = $derived(gateArmed && !account.user);

  // F45/CH16: a quick branded splash over the boot sequence, on every surface. Purely visual —
  // mounted alongside boot, removed the instant the shell is ready (dash.loaded) or on BootSplash's
  // own 3s safety timeout; never blocks or delays boot.
  let bootSplash = $state(true);
  // F47: batch intake — every file runs gates → parse → import; recognized non-trade exports are
  // NAMED (Cash History, Account Balance History, …) instead of getting the generic A178 refusal.
  // Sequential on purpose: imports hit the same Store and A219 reconciliation applies in order.
  async function importBatch(files: File[]): Promise<BatchRow[]> {
    const out: BatchRow[] = [];
    for (const file of files) {
      // F52: an .xlsx (ATAS X) converts to CSV text first (lazy chunk), then rides the normal
      // pipeline — the derived text persists as the file's raw text so F37 re-import/provenance work.
      let text: string;
      if (isXlsxFile(file)) {
        const veto = checkXlsxFile(file);
        if (veto) {
          out.push({ name: file.name, state: 'refused', label: '', detail: veto });
          continue;
        }
        try {
          const { atasXlsxToCsv } = await import('../lib/core/xlsx.ts');
          text = await atasXlsxToCsv(await file.arrayBuffer());
        } catch (e) {
          out.push({ name: file.name, state: 'refused', label: '', detail: `Could not read this workbook: ${(e as Error).message}` });
          continue;
        }
      } else {
        const veto = checkCsvFile(file);
        if (veto) {
          out.push({ name: file.name, state: 'refused', label: '', detail: veto });
          continue;
        }
        text = await file.text();
      }
      const r = Adapters.parse(text);
      if (r.ok && r.trades && r.trades.length) {
        await dash.importCsv(text, file.name, r); // F37 provenance + A219 reconciliation
        out.push({
          name: file.name,
          state: 'ok',
          label: r.label || 'CSV',
          detail: `${r.trades.length} trade${r.trades.length === 1 ? '' : 's'}`,
        });
      } else {
        const nt = classifyNonTrade(text);
        out.push(
          nt
            ? { name: file.name, state: 'nontrade', label: nt, detail: 'recognized, not a trade file' }
            : {
                name: file.name,
                state: 'refused',
                label: '',
                detail: r.ok ? 'No completed trades found.' : r.error || 'Could not read this file.',
              }
        );
      }
    }
    return out;
  }

  // F47 capability relay (the A176 model, dataset-level): what the imported mix unlocks or limits.
  const coverageLines = $derived.by(() => {
    const all = dash.allTrades;
    if (!all.length) return [];
    const hold = all.filter(t => t.holdMs != null).length / all.length;
    const comm = all.filter(t => t.commission != null).length / all.length;
    const lines: string[] = [];
    if (hold <= 0.005)
      lines.push(
        'No hold-time data detected — hold-time and duration stats are unavailable. Fills-type exports unlock them (overlapping trades merge).'
      );
    else if (hold < 0.995) lines.push(`Hold times cover ${Math.round(hold * 100)}% of trades — fills-type exports fill the gap.`);
    if (comm <= 0.005)
      lines.push(
        'No real commission data detected — costs use modeled rates. Fills-type exports (Tradovate/NinjaTrader Fills, Quantower Trades, TradingView order history) carry your actual costs.'
      );
    else if (comm < 0.995) lines.push(`Real commissions cover ${Math.round(comm * 100)}% of trades; the rest use modeled rates.`);
    if (!lines.length) lines.push('Full coverage: hold times and real commissions are available for every trade.');
    return lines;
  });

  // Data management (backup / restore / erase) — parity with the legacy ManageData. Neutral file name
  // on prod/demo, staging-branded on staging. Restore/erase are demo-guarded in dash; erase confirms.
  const BACKUP_NAME = isStaging ? 'blotterbook-staging-backup.json' : 'blotterbook-backup.json';
  let restoreMsg = $state('');
  async function doBackup() {
    const data = await dash.exportBackup();
    downloadBlob(BACKUP_NAME, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    emit('backup:created');
  }
  async function doRestore(file: File) {
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const res = await dash.importBackup(data);
      restoreMsg = `Restored ${res.added} trade${res.added === 1 ? '' : 's'} (${res.dup} duplicate).`;
    } catch (e) {
      // A236: a v3 checksum mismatch throws a corruption-specific message; surface it, else the
      // generic parse-failure copy.
      restoreMsg = /checksum|corrupt/i.test((e as Error)?.message || '')
        ? 'That backup is corrupted or was modified — nothing was restored.'
        : 'That backup file could not be read.';
    }
  }
  function doErase() {
    const where = isStaging ? ' (staging)' : '';
    if (typeof confirm === 'function' && !confirm(`Erase ALL trades, day-notes and per-trade tags/notes${where}? This cannot be undone.`))
      return;
    void dash.purgeAll();
  }

  // Header meta: the running version (staging track), the platform phase (Beta while prod is pre-1.0,
  // mirroring platformLabel), and the environment. Fetched from the CH12 versions.json single source.
  let versions = $state<{ prod?: string; staging?: string } | null>(null);
  const appVersion = $derived(versions ? (PAGE_MODE === 'staging' ? versions.staging : versions.prod) : '');
  const isBeta = $derived(!!versions?.prod && isBetaPhase(versions.prod)); // ONE major<1→Beta rule (format.ts)
  // Environment pill: only the non-prod surfaces are badged (Staging | Demo); prod /app shows none.
  const envLabel = isStaging ? 'Staging' : isDemo ? 'Demo' : '';

  // A179: one flavor phrase per page load (module-scope pick — stable for the session).
  const flavor = pickFlavor();

  // Admin-managed flags (A89): the maintenance banner (the dead betaRibbon/showBetaAdapters keys
  // were retired in A245). Applied once resolved; dashboard renders on defaults first.
  let flags = $state<AppFlags>({ ...APP_FLAGS });
  // Import-quality notice (A113): close-event exports without per-contract quantity are billed as a
  // single contract, so commissions can be understated — flag it when every trade lacks a real qty.
  const importWarning = $derived(
    dash.loaded && dash.allTrades.length && dash.allTrades.every(t => (t.qty ?? 1) === 1)
      ? 'Some imports report P&L without per-contract quantity, so modeled commissions are billed as a single contract and may be understated.'
      : ''
  );

  // A234: the online/status pill (the CH16 cutover dropped the legacy indicator) — /api/status is
  // the admin-set source of truth (auto|live|offline|maintenance + label); navigator.onLine catches
  // genuine offline. Convenience-only: a failed fetch just hides the pill (no error UI).
  let statusRec = $state<{ mode?: string; label?: string } | null>(null);
  let online = $state(typeof navigator === 'undefined' || navigator.onLine);
  $effect(() => {
    const on = () => (online = true),
      off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
  const statusPill = $derived.by(() => {
    if (!online) return { text: 'Offline', tone: 'down' as const };
    if (!statusRec) return null;
    if (statusRec.mode === 'maintenance') return { text: statusRec.label || 'Maintenance', tone: 'warn' as const };
    if (statusRec.mode === 'offline') return { text: statusRec.label || 'Offline', tone: 'down' as const };
    return { text: statusRec.label || 'Online', tone: 'up' as const }; // live/auto
  });
  // A239: plain-language popover body per status tone — the pill itself only ever carries the short
  // admin label, so the "what does this mean" explanation lives here instead.
  const statusExplainer = $derived(
    !statusPill
      ? ''
      : statusPill.tone === 'up'
        ? 'All systems normal.'
        : statusPill.tone === 'warn'
          ? 'Some functionality may be degraded. See the status detail link below for specifics.'
          : 'Local data is still fully usable — nothing ever leaves your browser, online or offline.'
  );

  onMount(() => {
    dash.boot().catch((e: unknown) => {
      console.error('app boot failed', e);
      dash.error = e instanceof Error ? e.message : String(e);
    });
    // F56: only when the gate is armed (staging + flag) do we probe /api/me — prod/demo issue no
    // account traffic at all. refreshSession never throws; account.loaded flips when it settles.
    if (gateArmed) {
      void refreshSession();
      // A300: a lost-passkey recovery link (`?recover=<token>`) lands here BEHIND the login gate —
      // Account.svelte (which normally handles it) never mounts while the gate blocks, so the 15-min
      // token used to just expire. Run the re-enrollment ceremony pre-gate; on success account.user
      // flips and the gate falls through. Scrub the token so a reload can't reuse a spent link.
      const params = new URLSearchParams(location.search);
      const recoverToken = params.get('recover');
      const reclaimToken = params.get('reclaim'); // A316: squatted-email reclaim, same pre-gate problem
      if (recoverToken || reclaimToken) {
        const url = new URL(location.href);
        url.searchParams.delete('recover');
        url.searchParams.delete('reclaim');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
        if (recoverToken) void completeRecovery(recoverToken);
        else if (reclaimToken) void completeReclaim(reclaimToken);
      }
    }
    // A256/F63: initialize cloud sync on every NON-DEMO surface (probes the tier, wires focus/
    // connectivity, settles per-workspace status). It stays inert on local tier — no /api/sync
    // (write-behind) traffic until a cloud-tier user enables + unlocks a workspace. Demo never calls
    // this, so demo never syncs.
    if (!isDemo) configureCloudSync({ localStore, dash });
    fetch('/api/status', { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? (r.json() as Promise<{ mode?: string; label?: string }>) : null))
      .then(v => (statusRec = v))
      .catch(() => {});
    fetch('/data/versions.json', { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ prod?: string; staging?: string }>) : null))
      .then(v => (versions = v))
      .catch(() => {});
    loadFlags()
      .then(f => (flags = f))
      .catch(() => {});
    // Warm the lazy screen chunks once the shell has settled — off the critical boot path.
    const idle: (fn: () => void) => void = typeof requestIdleCallback === 'function' ? requestIdleCallback : fn => setTimeout(fn, 1500);
    idle(() => Object.values(SCREEN_LOADERS).forEach(load => void load().catch(() => {})));
  });
</script>

<!-- A206: shape-matched placeholder while data/chunks resolve — boot (loadRefData → Store.init →
     restore) and the code-split screens' pending state. Card-shaped like every screen's layout, so
     content arriving causes no layout shift; the pulse collapses under reduced motion. -->
{#snippet screenSkeleton()}
  <div role="status" aria-label="Loading">
    <div class="mb-4 flex items-center gap-2" aria-hidden="true">
      <Skeleton class="h-7 w-28" />
      <Skeleton class="h-7 w-20" />
    </div>
    <div class="flex flex-col gap-4" aria-hidden="true">
      {#each [0, 1] as i (i)}
        <div class="rounded-md border border-border bg-card">
          <div class="border-b border-border px-4 py-2.5"><Skeleton class="h-4 w-40" /></div>
          <div class="space-y-3 p-4">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-2/3" />
            {#if i === 0}<Skeleton class="h-40 w-full" />{/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

<!-- A132/CH16: the workspace switcher — prod + staging (NOT demo). Named local workspaces need a real
     per-workspace IndexedDB; the in-memory DemoStore can't do multiple workspaces, so the switcher is
     hidden on demo (sidebarHeader stays undefined → AppShell renders nothing) and the single Demo
     workspace is unaffected. On prod/staging it drives dash's F59 workspace passthroughs + the F63
     cloud-sync status row (which reads sensibly as inert "cloud tier required" on local tier). -->
{#snippet sidebarHeader(railCollapsed: boolean)}
  <WorkspaceSwitcher {dash} collapsed={railCollapsed} />
{/snippet}

<!-- F45: branded boot splash (staging only) — fixed overlay above the A206 skeletons; unmounts on ready. -->
{#if bootSplash}
  <BootSplash ready={dash.loaded} ondismiss={() => (bootSplash = false)} />
{/if}

<AppShell
  {sections}
  {active}
  onnavigate={navigate}
  title={active === 'account' ? 'Account' : navLabel(active)}
  hideNav={needsOnboarding || gateBlocking}
  sidebarHeader={isDemo ? undefined : sidebarHeader}
>
  {#snippet actions()}
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <!-- A179/A225: rotating flavor text — one phrase per page load; hidden on narrow viewports.
           flex-1 + min-w-0 lets it use the header's whole free width (full phrases readable on
           desktop), truncating only when the row is genuinely full — never reflowing the header. -->
      <span
        class="hidden min-w-0 flex-1 truncate text-right text-xs text-muted-foreground italic lg:inline"
        data-testid="flavor-text"
        title={flavor}>{flavor}</span
      >
      <!-- A234/A239: online/status pill — admin-set /api/status + navigator.onLine. Clickable: opens a
           popover explaining the current status. Below sm it renders dot-only (the aria-label still
           carries the full text for a11y); the popover always has the full label + explanation. -->
      {#if statusPill}
        <Popover.Root>
          <Popover.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                data-testid="status-pill"
                aria-label={`Status: ${statusPill.text}`}
                class={[
                  badgeVariants({ variant: 'outline' }),
                  'relative cursor-pointer hover:bg-accent',
                  // A222: coarse-pointer hit-slop — below `sm` this pill renders dot-only (~20px
                  // visual box), so touch users need an invisible enlarged tap area.
                  "pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']",
                  statusPill.tone === 'up'
                    ? 'border-chart-2/40 text-chart-2'
                    : statusPill.tone === 'warn'
                      ? 'border-chart-4/40 text-chart-4'
                      : 'border-destructive/40 text-destructive',
                ]}
              >
                <span
                  aria-hidden="true"
                  class={[
                    'size-1.5 rounded-full',
                    statusPill.tone === 'up' ? 'bg-chart-2' : statusPill.tone === 'warn' ? 'bg-chart-4' : 'bg-destructive',
                  ]}
                ></span>
                <span class="hidden sm:inline" data-testid="status-pill-label">{statusPill.text}</span>
              </button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content align="end" class="w-64 space-y-1.5">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span
                aria-hidden="true"
                class={[
                  'size-1.5 rounded-full',
                  statusPill.tone === 'up' ? 'bg-chart-2' : statusPill.tone === 'warn' ? 'bg-chart-4' : 'bg-destructive',
                ]}
              ></span>
              {statusPill.text}
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">
              {statusExplainer}
              {#if statusPill.tone === 'warn'}
                <a href="/api/status" target="_blank" rel="noopener" class="underline hover:no-underline">Status detail</a>
              {/if}
            </p>
          </Popover.Content>
        </Popover.Root>
      {/if}
      {#if isBeta}<Badge variant="outline" class="border-chart-4/40 text-chart-4">Beta</Badge>{/if}
      {#if envLabel}<Badge variant="secondary">{envLabel}</Badge>{/if}
      {#if appVersion}<span class="font-mono text-[11px] text-muted-foreground">v{appVersion}</span>{/if}
      <span class="hidden font-mono text-xs text-muted-foreground md:inline">{dash.dateRange}</span>
      <FeedbackDialog version={appVersion} surface={PAGE_MODE || 'app'} />
    </div>
  {/snippet}

  <StatusBanner maintenance={flags.maintenanceBanner} {importWarning} />

  {#if gateBlocking}
    <!-- F56/CH16: hold the whole app behind the login gate (app + staging; demo is never gated).
         LaunchGate is self-contained over account.svelte.ts; on login/register account.user flips and
         this branch falls through to the normal flow (onboarding or dashboard). -->
    <LaunchGate />
  {:else}
    {@render appBody()}
  {/if}
</AppShell>

{#snippet appBody()}
  <!-- A235: every imported file is toggled off — say so instead of bouncing to onboarding. -->
  {#if dash.loaded && !needsOnboarding && !dash.allTrades.length && dash.csvFiles.length}
    <div class="mb-4 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-chart-4" role="status">
      All imported files are excluded, so the dashboards are empty — re-enable files in the
      <a href="#csv" class="font-medium text-chart-4 underline hover:no-underline">CSV Library</a>, or use Erase all data (CSV Library) to
      start over.
    </div>
  {/if}

  <!-- A146: screen changes fade in (keyed on the route; instant under reduced motion). -->
  {#key active}
    <div in:fade={{ duration: dur(120) }}>
      {#if dash.error}
        <p class="text-sm text-destructive" role="alert">Could not start the app: {dash.error}</p>
      {:else if !dash.loaded}
        {@render screenSkeleton()}
      {:else if needsOnboarding}
        <Onboarding
          setup={dash.setup}
          onsetupsave={s => dash.saveSetup(s)}
          onbatch={importBatch}
          capability={coverageLines}
          onlaunch={() => (onboardingActive = false)}
        />
      {:else if active === 'dashboard'}
        <!-- A135 (promoted CH16): named dashboard tabs, each with its own module layout. -->
        <div class="mb-4">
          <DashTabs
            tabs={dashTabsState.dashTabs}
            active={dashTabsState.activeDashTab}
            dirty={dashTabsState.dirtyTabs}
            onselect={dashTabsState.selectDashTab}
            oncreate={dashTabsState.createDashTab}
            onrename={dashTabsState.renameDashTab}
            onmove={dashTabsState.moveDashTab}
            onreorder={dashTabsState.reorderDashTabs}
            ondelete={dashTabsState.deleteDashTab}
            onsave={dashTabsState.saveTabLayout}
          />
        </div>
        <Dashboard
          moduleData={dash.dashModuleData}
          stats={dStats}
          series={dashSeries}
          dateRange={dash.dateRange}
          monthLabel={calData.label}
          monthNet={calData.net}
          dayPnl={calData.dayPnl}
          firstDow={calData.firstDow}
          daysInMonth={calData.daysInMonth}
          econMonth={calEconMonth}
          econDay={dateOf}
          onscope={dash.setScope}
          dayTrades={calTradesForDay}
          getNote={day => dash.noteFor(dateOf(day))}
          getDayTags={day => dash.journalFor(dateOf(day)).tags}
          onsavenote={(day, text) => dash.saveNote(dateOf(day), text)}
          {statDetail}
          {filterModel}
          onpickdate={(y, m) => dash.setCal(y, m)}
          costRows={dashCostRows}
          estRoots={dashEstRoots}
          actualCommNote={dashActualCommNote}
          advStats={dashAdvStats}
          setup={dash.setup}
          onsetupsave={s => dash.saveSetup(s)}
          costDisabled={dash.isDemo}
          modules={dashModules}
          onmoduleschange={dashTabsState.saveModules}
          {isStaging}
          kpi={dashKpi}
          recentTrades={dash.filtered
            .slice(-12)
            .reverse()
            .map(t => ({
              date: t.date,
              time: (t.time || '').slice(11, 16),
              sym: t.root,
              side: (t.side === 'short' ? 'Short' : 'Long') as 'Long' | 'Short',
              qty: t.qty ?? 1,
              pnl: t.pnl,
              platform: platformOf(t),
            }))}
          layouts={dashLayouts}
        />
      {:else if active === 'calendar'}
        {#await SCREEN_LOADERS.calendar()}
          {@render screenSkeleton()}
        {:then Calendar}
          <Calendar.default
            monthDays={calMonthDays}
            year={dash.calYear}
            month={dash.calMonth}
            monthLabel={calData.label}
            yearPnl={calYearPnl}
            tagVocab={dash.journalTags}
            onprev={() => dash.navMonth(-1)}
            onnext={() => dash.navMonth(1)}
            onlatest={() => dash.jumpToLatest()}
            tradesForDay={calTradesForDay}
            getJournal={day => dash.journalFor(dateOf(day))}
            onsavenote={(day, text, tags, shots) => dash.saveNote(dateOf(day), text, tags, shots)}
            dailyTarget={calTarget}
            onsavetarget={saveCalTarget}
            econMonth={calEconMonth}
            econDay={dateOf}
            econEventsForDay={date => econ.dayEvents(date)}
            econMode={econ.mode}
            oneconmode={m => econ.setMode(m)}
          />
        {/await}
      {:else if active === 'analytics'}
        {#await SCREEN_LOADERS.analytics()}
          {@render screenSkeleton()}
        {:then Analytics}
          <Analytics.default
            curveDates={['', ...dash.metricsActive.trades.map(t => t.date)]}
            kpis={analytics.kpis}
            dist={analytics.dist}
            wins={analytics.wins}
            losses={analytics.losses}
            scratch={analytics.scratch}
            curve={dash.metricsActive.curve}
            maxDD={dash.metricsActive.maxDD}
            maxDDpct={dash.metricsActive.maxDDpct}
            long={analytics.long}
            short={analytics.short}
            unknownSide={analytics.unknownSide}
            hours={analytics.hours}
            wdays={analytics.wdays}
            symbols={analytics.symbols}
            byTag={analytics.byTag}
            untagged={analytics.untagged}
            statRows={analytics.statRows}
            {filterModel}
            modules={analyticsModules}
            onmoduleschange={saveAnalyticsModules}
            holdCoverage={analytics.holdCoverage}
            bucketTrades={(lo, hi) =>
              dash.metricsActive.trades
                .filter(t => t.pnl !== 0 && (lo == null || t.pnl >= lo) && (hi == null || t.pnl < hi))
                .map(t => ({
                  date: t.date,
                  time: (t.time || '').slice(11, 16),
                  sym: t.root || t.symbol || '—',
                  side: t.side === 'short' ? 'Short' : t.side === 'long' ? 'Long' : '—',
                  qty: t.qty ?? 1,
                  pnl: t.pnl,
                }))}
          />
        {/await}
      {:else if active === 'blotter'}
        {#await SCREEN_LOADERS.blotter()}
          {@render screenSkeleton()}
        {:then Blotter}
          <Blotter.default
            rows={blotterRows}
            tagVocab={dash.tags}
            onsavemeta={(id, tags, note) => dash.saveTradeMeta(id, tags, note)}
            ondelete={ids => dash.deleteTrades(ids)}
            dataDisabled={dash.isDemo}
          />
        {/await}
      {:else if active === 'trades'}
        {#await SCREEN_LOADERS.trades()}
          {@render screenSkeleton()}
        {:then TradeEditor}
          <TradeEditor.default
            rows={editorRows}
            coreEditable={false}
            editableFields={EDITABLE_FIELDS}
            tagVocab={dash.tags}
            onsave={persistEditorRows}
            ondelete={ids => dash.deleteTrades(ids)}
            dataDisabled={dash.isDemo}
          />
        {/await}
      {:else if active === 'reports'}
        {#await SCREEN_LOADERS.reports()}
          {@render screenSkeleton()}
        {:then Reports}
          <Reports.default
            defaultTitle="Performance report"
            defaultAccount={dash.brokerName(dash.setup.broker)}
            calYear={dash.calYear}
            calMonth={dash.calMonth}
            trades={dash.allTrades}
            costInputs={dash.costInputs}
            labels={reportLabels}
            onexport={onReportExport}
          />
        {/await}
      {:else if active === 'csv'}
        {#await SCREEN_LOADERS.csv()}
          {@render screenSkeleton()}
        {:then CsvLibrary}
          <CsvLibrary.default
            files={csvFiles}
            blotterHref="#blotter"
            parse={parseCsv}
            onimport={importPreview}
            ondelete={csvDelete}
            oninclude={(id, v) => dash.setFileIncluded(id, v)}
            onrename={(id, label) => dash.renameFile(id, label)}
            ondownload={csvDownload}
            onreimport={async id => {
              await dash.reimportFile(id);
            }}
            brokers={BROKER_ORDER.map(k => [k, BROKERS[k]?.name ?? k])}
            onbroker={(id, key) => dash.setFileBroker(id, key)}
            onbackup={doBackup}
            onrestore={doRestore}
            onerase={doErase}
            dataDisabled={dash.isDemo}
            {restoreMsg}
            onbatch={importBatch}
            coverage={coverageLines}
          />
        {/await}
      {:else if active === 'account'}
        <!-- F53: passkey accounts (CH16-promoted; demo is read-only via isDemo). -->
        {#await SCREEN_LOADERS.account()}
          {@render screenSkeleton()}
        {:then Account}
          <Account.default {isDemo} />
        {/await}
      {:else}
        <div class="grid min-h-[60vh] place-items-center">
          <div class="flex max-w-md flex-col items-center gap-2 text-center">
            <h2 class="text-lg font-semibold text-foreground">Screen not found</h2>
            <p class="text-sm text-muted-foreground">
              There's no <code>{active}</code> screen. Pick a section from the sidebar to continue.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {/key}
{/snippet}
