<script lang="ts" module>
  // A238: the shared KPI stat-card row — ONE implementation of the Dashboard's stat cards behavior,
  // adopted by both the Dashboard and Analytics. On wide viewports the cards tile in a grid; below
  // Tailwind's `sm` breakpoint they collapse into the A200 one-at-a-time swipeable carousel
  // (conditionally RENDERED via MediaQuery, never CSS-hidden — so a card exists once in the DOM/a11y
  // tree). Every card is a click-through: selecting it opens the stat-detail Dialog (the Dashboard's
  // drill-in pattern) built from the caller's `detail(key)` accessor. Color lives only in the value.
  export type StatBar = { label: string; value: string; pct: number; tone: 'pos' | 'neg' | 'muted' };
  /** The drill-in content for one card (parity with the Dashboard stat-card modal). */
  export type StatDetail = {
    title: string;
    value: string;
    tone?: 'pos' | 'neg';
    desc: string;
    rows: { label: string; value: string; tone?: 'pos' | 'neg' }[];
    bars?: StatBar[];
  };
  /** A single card. `tone` colors the value (undefined = neutral). `badge` (+ `badgeUp` for its
   *  color) and `note` are optional trailing bits the Dashboard uses; Analytics omits them. */
  export type StatItem = {
    key: string;
    label: string;
    value: string;
    tone?: 'pos' | 'neg';
    badge?: string;
    badgeUp?: boolean;
    note?: string;
  };
</script>

<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { Badge } from '$lib/components/ui/badge';
  import * as Dialog from '$lib/components/ui/dialog';
  import { styleProps } from '../lib/actions.ts';
  import ModuleCarousel from './ModuleCarousel.svelte';

  let {
    stats,
    detail,
    label = 'Key stats',
    gridClass = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }: {
    stats: StatItem[];
    /** Resolves a card's key → its drill-in content (null = no detail for that key). */
    detail: (key: string) => StatDetail | null;
    /** Accessible name for the carousel group (kept distinct per screen so locators don't collide). */
    label?: string;
    /** Wide-layout grid classes (screens tile differently: Dashboard 6-up at xl, Analytics 6-up at lg). */
    gridClass?: string;
  } = $props();

  // A200: below Tailwind's sm breakpoint the cards render as a one-at-a-time carousel. Conditional
  // RENDER (not CSS hiding) so the cards never exist twice in the DOM/a11y tree.
  const isNarrow = new MediaQuery('(max-width: 639px)');

  // ── Stat-card drill-in (bits-ui owns the Dialog open state via bind:open, per L11) ──
  let openKey = $state<string | null>(null);
  let dlgOpen = $state(false);
  $effect(() => {
    if (!dlgOpen) openKey = null;
  });
  function openStat(key: string) {
    openKey = key;
    dlgOpen = true;
  }
  const active = $derived(openKey ? detail(openKey) : null);
</script>

{#snippet statCard(s: StatItem)}
  <button
    type="button"
    onclick={() => openStat(s.key)}
    class="w-full cursor-pointer rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-ring hover:bg-accent/30"
  >
    <div class="flex items-start justify-between gap-2">
      <span class="text-xs text-muted-foreground">{s.label}</span>
      {#if s.badge}
        <Badge variant="outline" class={s.badgeUp ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
          >{s.badge}</Badge
        >
      {/if}
    </div>
    <div
      class={[
        'mt-2 text-xl font-bold tracking-tight tabular-nums',
        s.tone === 'pos' ? 'text-chart-2' : s.tone === 'neg' ? 'text-destructive' : 'text-foreground',
      ]}
    >
      {s.value}
    </div>
    {#if s.note}<div class="mt-1 text-[11px] text-muted-foreground">{s.note}</div>{/if}
  </button>
{/snippet}

{#if isNarrow.current}
  <ModuleCarousel count={stats.length} {label}>
    {#snippet slide(i)}
      {@render statCard(stats[i])}
    {/snippet}
  </ModuleCarousel>
{:else}
  <div class={gridClass}>
    {#each stats as s (s.key)}
      {@render statCard(s)}
    {/each}
  </div>
{/if}

<Dialog.Root bind:open={dlgOpen}>
  <Dialog.Content class="sm:max-w-md">
    {#if active}
      <Dialog.Header>
        <Dialog.Title class="flex items-baseline justify-between gap-3 pr-6">
          <span>{active.title}</span>
          <span
            class={[
              'text-lg tabular-nums',
              active.tone === 'pos' ? 'text-chart-2' : active.tone === 'neg' ? 'text-destructive' : 'text-foreground',
            ]}>{active.value}</span
          >
        </Dialog.Title>
        {#if active.desc}<Dialog.Description>{active.desc}</Dialog.Description>{/if}
      </Dialog.Header>
      <div class="space-y-4">
        {#if active.bars?.length}
          <div class="space-y-1.5">
            {#each active.bars as bar, i (i)}
              <div class="flex items-center gap-2 text-xs">
                <span class="w-24 shrink-0 text-muted-foreground">{bar.label}</span>
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    class={[
                      'h-full rounded-full',
                      bar.tone === 'pos' ? 'bg-chart-2' : bar.tone === 'neg' ? 'bg-destructive' : 'bg-muted-foreground',
                    ]}
                    use:styleProps={{ width: `${Math.max(2, Math.min(100, bar.pct))}%` }}
                  ></div>
                </div>
                <span
                  class={[
                    'w-20 shrink-0 text-right font-medium tabular-nums',
                    bar.tone === 'pos' ? 'text-chart-2' : bar.tone === 'neg' ? 'text-destructive' : 'text-foreground',
                  ]}>{bar.value}</span
                >
              </div>
            {/each}
          </div>
        {/if}
        {#if active.rows.length}
          <div class="overflow-hidden rounded-md border border-border">
            {#each active.rows as r, i (i)}
              <div class={['flex items-center justify-between px-3 py-2 text-sm', i > 0 && 'border-t border-border']}>
                <span class="text-muted-foreground">{r.label}</span>
                <span
                  class={['tabular-nums', r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground']}
                  >{r.value}</span
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
