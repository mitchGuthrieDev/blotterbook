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
  import { navSections, navLabel, navItems } from './lib/nav';
  import Dashboard, { type DashStat, type DayCell } from './screens/Dashboard.svelte';
  import Calendar, { type CalDay, type DayTrade } from './screens/Calendar.svelte';
  import Blotter, { type BlotterRow } from './screens/Blotter.svelte';

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
      curve={dash.metricsActive.curve}
      dateRange={dash.dateRange}
      monthLabel={calData.label}
      monthNet={calData.net}
      dayPnl={calData.dayPnl}
      firstDow={calData.firstDow}
      daysInMonth={calData.daysInMonth}
      onscope={dash.setScope}
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
  {:else if active === 'blotter'}
    <Blotter rows={blotterRows} />
  {:else}
    <div class="grid min-h-[60vh] place-items-center">
      <div class="flex max-w-md flex-col items-center gap-2 text-center">
        <h2 class="text-lg font-semibold text-foreground">{navLabel(active)}</h2>
        <p class="text-sm text-muted-foreground">Being wired to your real data — coming online shortly. The boot + engine are real; this screen's layout is mocked in the <code>/dev</code> preview.</p>
      </div>
    </div>
  {/if}
</AppShell>
