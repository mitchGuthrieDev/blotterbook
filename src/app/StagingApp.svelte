<script lang="ts">
  // Redesigned app root for the STAGING surface (UI redesign, Phase 3 cutover). Mounts the new sidebar
  // AppShell + a hash router over the seven screens, booting the REAL engine via createDashboard (real
  // IndexedDB Store, isolated to staging + seeded). The live /app/ + demo keep the current App.svelte
  // until promoted — main.ts mounts this only for data-mode="staging". Screens are wired to real data
  // one at a time; until a screen is wired it shows a "being wired" state, but the boot + data are real
  // (the KPI overview below reads live metrics).
  import { onMount, setContext } from 'svelte';
  import { Store } from '../lib/core/store.ts';
  import { usd, money, num, rateFor } from '../lib/core/core.ts';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import * as Card from '$lib/components/ui/card';
  import { createDashboard } from './lib/dashboard.svelte.ts';
  import { navSections, navLabel, navItems } from './lib/nav';
  import Blotter, { type BlotterRow } from './screens/Blotter.svelte';

  const store = Store;
  setContext('bb:store', store);
  const dash = createDashboard(store, { seed: true }); // staging: isolated DB, seeded

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

  // Map the real filtered trades → Blotter rows. Entry/exit prices aren't in the trade model (P&L
  // events, not price bars), so they're left undefined → rendered "—"; hold comes from holdMs (fills
  // exports only); fees from the broker rate (round-turn = rate × 2 × qty); tags/note from trademeta.
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

  // Live KPI overview from the real metrics — the proof that the new shell boots the real engine.
  const m = $derived(dash.metricsActive);
  const kpis = $derived([
    { label: 'Net P&L', value: usd(m.net), tone: m.net >= 0 ? 'pos' : 'neg' },
    { label: 'Win rate', value: `${m.winRate.toFixed(1)}%`, tone: 'plain' },
    { label: 'Profit factor', value: num(m.pf), tone: 'plain' },
    { label: 'Expectancy', value: usd(m.expectancy), tone: m.expectancy >= 0 ? 'pos' : 'neg' },
    { label: 'Trades', value: `${m.n}`, tone: 'plain' },
    { label: 'Max drawdown', value: m.maxDD > 0 ? `-${money(m.maxDD)}` : '$0', tone: 'neg' },
  ]);

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
    <div class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {#each kpis as k (k.label)}
          <Card.Root class="p-4">
            <div class="text-xs text-muted-foreground">{k.label}</div>
            <div class={['mt-1 text-xl font-semibold tabular-nums', k.tone === 'pos' ? 'text-chart-2' : k.tone === 'neg' ? 'text-destructive' : 'text-foreground']}>
              {k.value}
            </div>
          </Card.Root>
        {/each}
      </div>
      <Card.Root>
        <Card.Content class="p-6 text-sm text-muted-foreground">
          ✅ The redesigned shell is live on staging, booted against your real (seeded) data — the cards
          above are computed from {m.n} trades. The full Dashboard, Calendar, Analytics, Blotter, CSV
          Library, Trade Editor and Reports screens are being wired to this data next.
        </Card.Content>
      </Card.Root>
    </div>
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
