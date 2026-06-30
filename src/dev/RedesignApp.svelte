<script lang="ts">
  // Redesign preview harness (UI initiative, Phase 2). Hosts the new sidebar AppShell + a minimal
  // hash router so the seven surfaces are navigable; each screen is built out as we work down the
  // list. Dev-only (/dev/app.html) — the live /app/ surface is untouched until the redesign is
  // approved and cut over. Client-side view switching here previews the Phase-2 routing approach.
  import type { Component } from 'svelte';
  import { ArrowUpRight } from '@lucide/svelte';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { navSections, navItems, navLabel } from './nav';
  import Dashboard from '../app/screens/Dashboard.svelte';
  import Calendar from '../app/screens/Calendar.svelte';
  import Analytics from './screens/Analytics.svelte';
  import Blotter from '../app/screens/Blotter.svelte';
  import CsvLibrary from './screens/CsvLibrary.svelte';
  import TradeEditor from './screens/TradeEditor.svelte';
  import Reports from './screens/Reports.svelte';
  import Placeholder from './screens/Placeholder.svelte';

  // Screens are registered here as they're built; unregistered keys fall back to the Placeholder.
  const SCREENS: Record<string, Component> = {
    dashboard: Dashboard,
    calendar: Calendar,
    analytics: Analytics,
    blotter: Blotter,
    csv: CsvLibrary,
    trades: TradeEditor,
    reports: Reports,
  };

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

  const Screen = $derived(SCREENS[active]);
</script>

<AppShell sections={navSections} {active} onnavigate={navigate} title={navLabel(active)}>
  {#snippet actions()}
    <Button variant="outline" size="sm" href="/app/" class="text-foreground no-underline hover:text-foreground"
      >Open live app <ArrowUpRight class="size-4" /></Button
    >
  {/snippet}

  {#if Screen}
    <Screen />
  {:else}
    <Placeholder title={navLabel(active)} />
  {/if}
</AppShell>
