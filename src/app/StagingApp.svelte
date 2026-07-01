<script lang="ts">
  // Redesigned app root for the STAGING surface (UI redesign, Phase 3 cutover). Mounts the new sidebar
  // AppShell + a hash router over the seven screens, booting the REAL engine via createDashboard (real
  // IndexedDB Store, isolated to staging + seeded). The live /app/ + demo keep the current App.svelte
  // until promoted — main.ts mounts this only for data-mode="staging". Screens read real data via props
  // (the same components the /dev harness previews with mock data); a screen with no wiring yet shows a
  // "being wired" state.
  import { onMount, setContext } from 'svelte';
  import { Store } from '../lib/core/store.ts';
  import { usd, money, num, ratio, rateFor } from '../lib/core/core.ts';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { createDashboard } from './lib/dashboard.svelte.ts';
  import { dailySeries } from '../lib/core/curveseries.ts';
  import { navSections, navLabel, navItems } from './lib/nav';
  import Dashboard, { type DashStat, type DayCell } from './screens/Dashboard.svelte';
  import Calendar, { type CalDay, type DayTrade } from './screens/Calendar.svelte';
  import Analytics from './screens/Analytics.svelte';
  import { buildAnalytics } from './lib/analytics.ts';
  import Blotter, { type BlotterRow } from './screens/Blotter.svelte';
  import TradeEditor, { type EditorRow } from './screens/TradeEditor.svelte';
  import Reports, { type ReportVM, type ReportRange, type ExportKind } from './screens/Reports.svelte';
  import { buildReportVM } from './lib/reports.ts';
  import { downloadBlob } from './lib/files.ts';
  import CsvLibrary, { type Csv, type ImportPreview } from './screens/CsvLibrary.svelte';
  import { Adapters } from '../lib/core/adapters.ts';
  import type { Trade } from '../lib/core/types.ts';

  const store = Store;
  setContext('bb:store', store);
  const dash = createDashboard(store, { seed: true }); // staging: isolated DB, seeded

  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const fromHash = (): string => {
    const h = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
    return navItems.some(i => i.key === h) ? h : 'dashboard';
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
      { label: 'Net P&L', value: usd(m.net), up: m.net >= 0, note: `${m.wins}W · ${m.losses}L` },
      { label: 'Win rate', value: `${m.winRate.toFixed(1)}%`, note: `${m.n} trades` },
      { label: 'Profit factor', value: ratio(m.pf), note: 'gross win ÷ loss' },
      { label: 'Expectancy', value: usd(m.expectancy), badge: 'per trade', up: m.expectancy >= 0, note: 'avg edge' },
      { label: 'Max drawdown', value: m.maxDD > 0 ? `-${money(m.maxDD)}` : '$0', badge: `${m.maxDDpct.toFixed(1)}%`, up: false, note: 'of peak' },
      { label: 'Sharpe (daily)', value: num(m.sharpe), note: `${m.active} trading days` },
    ];
  });
  // Daily cumulative gross/net/take series for the Performance chart — same cost/tax-adjusted math as
  // the cost panel (tEff/fixedMo from costModel), so the Net/Take-home overlays reconcile.
  const dashSeries = $derived(
    dailySeries(dash.metricsActive, { broker: String(dash.costInputs.broker ?? ''), tEff: dash.cost.tEff, fixedMo: dash.cost.fixedMo }).pts
  );
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
    return { dayPnl, net, firstDow: new Date(y, mo, 1).getDay(), daysInMonth: new Date(y, mo + 1, 0).getDate(), label: `${MON[mo]} ${y}` };
  });

  // ── Calendar ─────────────────────────────────────────────────────────────────────────────────
  // The full Calendar screen reads per-day records (P&L / trades / wins + a note flag) for the cursor
  // month and a date→P&L map for the year heatmap, both from the all-time (filtered) days.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dateOf = (day: number) => `${dash.calYear}-${pad2(dash.calMonth + 1)}-${pad2(day)}`;
  const calMonthDays = $derived.by<Record<number, CalDay>>(() => {
    const out: Record<number, CalDay> = {};
    for (const d of dash.metricsAll.days) {
      const dt = new Date(d.date + 'T00:00:00');
      if (dt.getFullYear() === dash.calYear && dt.getMonth() === dash.calMonth) {
        out[dt.getDate()] = { pnl: d.pnl, trades: d.trades, wins: d.wins, note: dash.journalDates.has(d.date) };
      }
    }
    return out;
  });
  const calYearPnl = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of dash.metricsAll.days) if (+d.date.slice(0, 4) === dash.calYear) out[d.date] = d.pnl;
    return out;
  });
  const calTradesForDay = (day: number): DayTrade[] =>
    dash.tradesForDay(dateOf(day)).map(t => ({
      time: (t.time || '').slice(11, 16),
      sym: t.root,
      side: t.side === 'short' ? 'Short' : 'Long',
      qty: t.qty ?? 1,
      pnl: t.pnl,
    }));

  // ── Analytics ────────────────────────────────────────────────────────────────────────────────
  const analytics = $derived(buildAnalytics(dash.metricsActive, dash.metricsActive.trades));

  // ── Blotter ──────────────────────────────────────────────────────────────────────────────────
  // Entry/exit prices aren't in the trade model (P&L events, not bars) → undefined → "—"; hold from
  // holdMs (fills exports only); fees from the broker rate (round-turn = rate × 2 × qty); tags/note
  // from trademeta; session from sessionOf().
  const blotterRows = $derived<BlotterRow[]>(
    dash.filtered.map(t => {
      const id = dash.tradeId(t);
      const qty = t.qty ?? 1;
      const meta = dash.tradeMeta.get(id);
      const r = dash.setup.broker ? rateFor(dash.setup.broker, t.root) : null;
      return {
        id,
        date: t.date,
        time: (t.time || '').slice(11, 16),
        sym: t.root,
        side: t.side === 'short' ? 'Short' : 'Long',
        qty,
        holdMin: t.holdMs != null ? Math.round(t.holdMs / 60000) : undefined,
        pnl: t.pnl,
        fees: r ? +(r.rate * 2 * qty).toFixed(2) : undefined,
        tags: meta?.tags ?? [],
        note: !!(meta && meta.note),
        session: dash.sessionOf(t) === 'rth' ? 'RTH' : 'ETH',
      };
    })
  );

  // ── Trade Editor ─────────────────────────────────────────────────────────────────────────────
  // Imported trades are immutable → the editor edits the metadata layer (tags + note). entry/exit
  // aren't in the trade model (NaN → "—"); fees from the broker rate; core cells render read-only.
  const editorRows = $derived<EditorRow[]>(
    dash.filtered.map(t => {
      const id = dash.tradeId(t);
      const qty = t.qty ?? 1;
      const meta = dash.tradeMeta.get(id);
      const r = dash.setup.broker ? rateFor(dash.setup.broker, t.root) : null;
      return {
        id,
        date: t.date,
        time: (t.time || '').slice(11, 16),
        symbol: t.root,
        side: t.side === 'short' ? 'Short' : 'Long',
        qty,
        entry: NaN,
        exit: NaN,
        pnl: t.pnl,
        fees: r ? +(r.rate * 2 * qty).toFixed(2) : NaN,
        tags: meta?.tags ?? [],
        note: meta?.note ?? '',
      };
    })
  );
  async function persistEditorRows(changed: EditorRow[]) {
    for (const r of changed) await dash.saveTradeMeta(r.id, r.tags, r.note);
  }

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
  function buildReport(range: ReportRange, compare: boolean): ReportVM {
    return buildReportVM(dash.allTrades, range, compare, dash.costInputs, reportLabels);
  }
  function onReportExport(kind: ExportKind, vm: ReportVM) {
    if (kind === 'md') downloadBlob('blotterbook-report.md', new Blob([vm.md], { type: 'text/markdown' }));
    else if (kind === 'copy') void navigator.clipboard?.writeText(vm.text);
    else if (kind === 'email') location.href = vm.mailto;
    else if (kind === 'pdf') window.print();
    else if (kind === 'csv') {
      const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
      const rows = [['date', 'time', 'symbol', 'side', 'qty', 'pnl'], ...dash.allTrades.map(t => [t.date, t.time, t.root, t.side, String(t.qty ?? 1), String(t.pnl)])];
      downloadBlob('blotterbook-trades.csv', new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    }
  }

  // ── CSV Library ──────────────────────────────────────────────────────────────────────────────
  // No per-file provenance is stored (only the merged trade set), so file storage is deferred: the
  // table shows one derived "active dataset" row, and the upload zone is a real Adapters→addTrades
  // importer. The parsed trades are stashed between parse() and import() (one preview at a time).
  const csvFiles = $derived<Csv[]>(
    dash.allTrades.length
      ? [
          {
            id: 'dataset',
            name: 'Imported trades',
            platform: 'Imported',
            rows: dash.allTrades.length,
            trades: dash.allTrades.length,
            imported: '',
            from: dash.allTrades[0].date,
            to: dash.allTrades[dash.allTrades.length - 1].date,
            status: 'ok',
            sizeKb: 0,
            overlap: 0,
            included: true,
          },
        ]
      : []
  );
  let pendingTrades: Trade[] = [];
  function parseCsv(text: string, name: string): ImportPreview {
    const r = Adapters.parse(text);
    if (!r.ok || !r.trades) {
      pendingTrades = [];
      return { name, platform: '', rows: 0, tradeCount: 0, from: '', to: '', estimatedRoots: [], sample: [], error: r.ok ? 'No completed trades found.' : r.error };
    }
    const trades = r.trades;
    pendingTrades = trades;
    const rows = Math.max(0, text.trim().split(/\r?\n/).length - 1);
    const sample = trades.slice(0, 3).map(t => ({ time: (t.time || '').slice(11, 16), sym: t.root, side: t.side === 'short' ? 'Short' : 'Long', qty: t.qty ?? 1, pnl: t.pnl, up: t.pnl >= 0 }));
    return { name, platform: r.label ?? 'CSV', rows, tradeCount: trades.length, from: trades[0]?.date ?? '', to: trades[trades.length - 1]?.date ?? '', estimatedRoots: r.estimatedRoots ?? [], sample };
  }
  async function importPreview() {
    if (pendingTrades.length) await dash.importTrades(pendingTrades);
    pendingTrades = [];
  }

  onMount(() => {
    dash.boot().catch((e: unknown) => {
      console.error('staging app boot failed', e);
      dash.error = e instanceof Error ? e.message : String(e);
    });
  });
</script>

<AppShell sections={navSections} {active} onnavigate={navigate} title={navLabel(active)}>
  {#snippet actions()}
    <span class="font-mono text-xs text-muted-foreground">staging · {dash.dateRange}</span>
  {/snippet}

  {#if dash.error}
    <p class="text-sm text-destructive" role="alert">Could not start the app: {dash.error}</p>
  {:else if !dash.loaded}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if active === 'dashboard'}
    <Dashboard
      stats={dStats}
      series={dashSeries}
      dateRange={dash.dateRange}
      monthLabel={calData.label}
      monthNet={calData.net}
      dayPnl={calData.dayPnl}
      firstDow={calData.firstDow}
      daysInMonth={calData.daysInMonth}
      onscope={dash.setScope}
      dayTrades={calTradesForDay}
      getNote={day => dash.noteFor(dateOf(day))}
      onsavenote={(day, text) => dash.saveNote(dateOf(day), text)}
    />
  {:else if active === 'calendar'}
    <Calendar
      monthDays={calMonthDays}
      year={dash.calYear}
      month={dash.calMonth}
      monthLabel={calData.label}
      yearPnl={calYearPnl}
      onprev={() => dash.navMonth(-1)}
      onnext={() => dash.navMonth(1)}
      onlatest={() => dash.jumpToLatest()}
      tradesForDay={calTradesForDay}
      getNote={day => dash.noteFor(dateOf(day))}
      onsavenote={(day, text) => dash.saveNote(dateOf(day), text)}
    />
  {:else if active === 'analytics'}
    <Analytics
      kpis={analytics.kpis}
      dist={analytics.dist}
      wins={analytics.wins}
      losses={analytics.losses}
      curve={dash.metricsActive.curve}
      maxDD={dash.metricsActive.maxDD}
      maxDDpct={dash.metricsActive.maxDDpct}
      long={analytics.long}
      short={analytics.short}
      hours={analytics.hours}
      wdays={analytics.wdays}
      symbols={analytics.symbols}
      statRows={analytics.statRows}
    />
  {:else if active === 'blotter'}
    <Blotter rows={blotterRows} />
  {:else if active === 'trades'}
    <TradeEditor rows={editorRows} coreEditable={false} onsave={persistEditorRows} ondelete={ids => dash.deleteTrades(ids)} />
  {:else if active === 'reports'}
    <Reports
      defaultTitle="Performance report"
      defaultAccount={dash.brokerName(dash.setup.broker)}
      calYear={dash.calYear}
      calMonth={dash.calMonth}
      build={buildReport}
      onexport={onReportExport}
    />
  {:else if active === 'csv'}
    <CsvLibrary files={csvFiles} perFileActions={false} blotterHref="#blotter" parse={parseCsv} onimport={importPreview} ondelete={() => dash.purgeAll()} />
  {:else}
    <div class="grid min-h-[60vh] place-items-center">
      <div class="flex max-w-md flex-col items-center gap-2 text-center">
        <h2 class="text-lg font-semibold text-foreground">{navLabel(active)}</h2>
        <p class="text-sm text-muted-foreground">Being wired to your real data — coming online shortly. The boot + engine are real; this screen's layout is mocked in the <code>/dev</code> preview.</p>
      </div>
    </div>
  {/if}
</AppShell>
