<script lang="ts" module>
  export type { ReportVM, ReportKpi, ReportRange, ReportMeta } from '../lib/reports.ts';
  export type ExportKind = 'pdf' | 'md' | 'csv' | 'email' | 'copy';
</script>

<script lang="ts">
  // Reports surface (UI redesign; Data Management). A two-pane report generator: a left config panel
  // (template, title/account, date-range + scope, period comparison, section toggles) drives a live
  // document preview on the right; export actions (PDF / Markdown / CSV / Email / Copy) in the toolbar.
  // The preview + exports are built from real metrics via the `build` callback (which reuses the pure
  // report.ts builder, A34), wired by App.svelte on all surfaces. Color in P&L.
  import { FileDown, Code, Table2, Mail, Copy, Receipt, Percent, ChartLine, FileText } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import { buildReportVM } from '../lib/reports.ts';
  import type { ReportVM, ReportRange, ReportMeta, ReportSections, ReportLabelsIn } from '../lib/reports.ts';
  import type { Trade, CostInputs } from '../../lib/core/types.ts';

  type Tmpl = 'performance' | 'cost' | 'tax' | 'full';

  interface Props {
    defaultTitle?: string;
    defaultAccount?: string;
    calYear: number;
    calMonth: number;
    // A156: the builder receives the configured title/account/sections, so the vm's export
    // payloads (md/text/mailto) always match what the preview renders.
    /** A213: the screen owns buildReportVM (its chunk carries reports.ts/report.ts, not the boot
     *  payload) — App passes the raw reactive inputs instead of a prebuilt callback. */
    trades: Trade[];
    costInputs: CostInputs;
    labels: ReportLabelsIn;
    onexport?: (kind: ExportKind, vm: ReportVM) => void;
  }
  let { defaultTitle = '', defaultAccount = '', calYear, calMonth, trades, costInputs, labels, onexport }: Props = $props();

  let template = $state<Tmpl>('full');
  // svelte-ignore state_referenced_locally — seed the editable fields from the prop defaults once.
  let title = $state(defaultTitle);
  // svelte-ignore state_referenced_locally
  let account = $state(defaultAccount);
  let scope = $state<'all' | 'month' | 'custom'>('all');
  let from = $state('');
  let to = $state('');
  let compare = $state(true);
  let sections = $state<ReportSections>({ kpis: true, curve: true, calendar: true, cost: true, tax: true, advanced: true });

  const PRESETS: Record<Tmpl, ReportSections> = {
    performance: { kpis: true, curve: true, calendar: true, cost: false, tax: false, advanced: true },
    cost: { kpis: true, curve: false, calendar: false, cost: true, tax: false, advanced: false },
    tax: { kpis: true, curve: false, calendar: false, cost: false, tax: true, advanced: false },
    full: { kpis: true, curve: true, calendar: true, cost: true, tax: true, advanced: true },
  };
  function selectTemplate(t: Tmpl) {
    template = t;
    sections = { ...PRESETS[t] };
  }
  function pickScope(k: 'all' | 'month' | 'custom') {
    scope = k;
    // Seed the custom pickers from the real calendar-cursor month (props) the first time Custom is
    // chosen, so a custom report opens on a bounded range with a prior-period comparison — rather than
    // empty/open-ended. The user can then adjust either bound.
    if (k === 'custom' && !from && !to) {
      const mm = String(calMonth + 1).padStart(2, '0');
      const last = new Date(calYear, calMonth + 1, 0).getDate();
      from = `${calYear}-${mm}-01`;
      to = `${calYear}-${mm}-${String(last).padStart(2, '0')}`;
    }
  }

  const range = $derived<ReportRange>({ scope, from, to, calYear, calMonth });
  const vm = $derived(buildReportVM(trades, range, compare, costInputs, labels, { title, account, sections }));

  const TEMPLATES: { key: Tmpl; label: string; icon: typeof FileText }[] = [
    { key: 'performance', label: 'Performance', icon: ChartLine },
    { key: 'cost', label: 'Cost & break-even', icon: Receipt },
    { key: 'tax', label: 'Tax (1256)', icon: Percent },
    { key: 'full', label: 'Full / custom', icon: FileText },
  ];
  const SECTION_LIST: { key: keyof ReportSections; label: string }[] = [
    { key: 'kpis', label: 'Headline KPIs' },
    { key: 'curve', label: 'Equity curve' },
    { key: 'calendar', label: 'Trading calendar' },
    { key: 'cost', label: 'Cost breakdown' },
    { key: 'tax', label: 'Tax (Section 1256)' },
    { key: 'advanced', label: 'Advanced stats' },
  ];

  // Equity-curve points → SVG line + area (loop-safe normalize; no Math.max spread).
  function curvePaths(pts: number[], w = 1000, h = 240, pad = 10) {
    if (pts.length < 2) return { line: '', area: '' };
    let min = pts[0],
      max = pts[0];
    for (const v of pts) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const X = (i: number) => (i / (pts.length - 1)) * w;
    const Y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
    const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
  }
  const cp = $derived(curvePaths(vm.curve));
  const calCells = $derived<(number | null)[]>([
    ...Array.from({ length: vm.calFirstDow }, () => null),
    ...Array.from({ length: vm.calDaysInMonth }, (_, i) => i + 1),
  ]);
  const fire = (kind: ExportKind) => onexport?.(kind, vm);
</script>

{#snippet sectionTitle(t: string)}
  <h3 class="mb-2 mt-5 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{t}</h3>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Export toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs text-muted-foreground">Preview updates live as you configure.</span>
    <div class="ml-auto flex flex-wrap gap-2">
      <Button size="sm" onclick={() => fire('pdf')}><FileDown class="size-4" /> PDF</Button>
      <Button variant="outline" size="sm" onclick={() => fire('md')}><Code class="size-4" /> Markdown</Button>
      <Button variant="outline" size="sm" onclick={() => fire('csv')}><Table2 class="size-4" /> CSV</Button>
      <Button variant="outline" size="sm" onclick={() => fire('email')}><Mail class="size-4" /> Email</Button>
      <Button variant="outline" size="sm" onclick={() => fire('copy')}><Copy class="size-4" /> Copy</Button>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-[300px_1fr]">
    <!-- Config panel -->
    <Card.Root class="h-fit">
      <Card.Header><Card.Title>Configure</Card.Title></Card.Header>
      <Card.Content class="space-y-4">
        <div>
          <Label class="mb-1.5">Template</Label>
          <div class="grid grid-cols-2 gap-2">
            {#each TEMPLATES as t (t.key)}
              {@const Icon = t.icon}
              <button
                type="button"
                onclick={() => selectTemplate(t.key)}
                class={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors',
                  template === t.key
                    ? 'border-border bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon class="size-4 shrink-0" /> <span class="truncate">{t.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <Separator />

        <div class="grid gap-1.5"><Label for="r-title">Report title</Label><Input id="r-title" bind:value={title} class="h-8" /></div>
        <div class="grid gap-1.5"><Label for="r-acct">Account</Label><Input id="r-acct" bind:value={account} class="h-8" /></div>

        <Separator />

        <div>
          <Label class="mb-1.5">Date range</Label>
          <div class="mb-2 flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {#each [['all', 'All time'], ['month', 'Month'], ['custom', 'Custom']] as const as [k, lbl] (k)}
              <button
                type="button"
                onclick={() => pickScope(k)}
                class={cn(
                  'flex-1 rounded px-2 py-1 text-xs transition-colors',
                  scope === k ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}>{lbl}</button
              >
            {/each}
          </div>
          {#if scope === 'custom'}
            <div class="grid grid-cols-2 gap-2">
              <Input type="date" aria-label="Start date" bind:value={from} class="h-8" />
              <Input type="date" aria-label="End date" bind:value={to} class="h-8" />
            </div>
          {/if}
        </div>

        <Label class="justify-between"><span>Compare to prior period</span><Switch bind:checked={compare} /></Label>

        <Separator />

        <div>
          <Label class="mb-2">Sections</Label>
          <div class="space-y-2.5">
            {#each SECTION_LIST as s (s.key)}
              <Label class="justify-between font-normal"><span>{s.label}</span><Switch bind:checked={sections[s.key]} /></Label>
            {/each}
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Live preview document -->
    <Card.Root>
      <Card.Content class="p-6 sm:p-8">
        <div class="mx-auto max-w-2xl">
          <!-- Document header -->
          <div class="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h1 class="text-2xl font-bold tracking-tight">{title || 'Untitled report'}</h1>
              <p class="mt-1 text-sm text-muted-foreground">{account} · {vm.rangeLabel}</p>
            </div>
            <div class="flex items-center gap-2 text-right">
              <span class="grid size-9 place-items-center rounded-full border border-border"
                ><span class="size-3.5 rounded-full bg-foreground"></span></span
              >
              <span class="text-sm font-semibold">Blotterbook</span>
            </div>
          </div>

          {#if sections.kpis}
            {@render sectionTitle('Summary')}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {#each vm.kpis as k (k.label)}
                <div class="rounded-md border border-border bg-background p-3">
                  <div class="text-[11px] text-muted-foreground">{k.label}</div>
                  <div
                    class={cn(
                      'mt-0.5 text-lg font-semibold tabular-nums',
                      k.tone === 'pos' ? 'text-chart-2' : k.tone === 'neg' ? 'text-destructive' : 'text-foreground'
                    )}
                  >
                    {k.value}
                  </div>
                  {#if compare && k.prior}<div class="text-[10px] text-muted-foreground">vs {k.prior}</div>{/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if sections.curve}
            {@render sectionTitle('Equity curve')}
            <svg viewBox="0 0 1000 240" class="h-44 w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative P&L">
              <defs
                ><linearGradient id="repFill" x1="0" y1="0" x2="0" y2="1"
                  ><stop offset="0%" class="[stop-color:var(--chart-2)] [stop-opacity:0.25]" /><stop
                    offset="100%"
                    class="[stop-color:var(--chart-2)] [stop-opacity:0]"
                  /></linearGradient
                ></defs
              >
              {#each [48, 96, 144, 192] as y (y)}<line x1="0" y1={y} x2="1000" y2={y} class="stroke-border" stroke-width="1" />{/each}
              <path d={cp.area} fill="url(#repFill)" />
              <path d={cp.line} fill="none" class="stroke-chart-2" stroke-width="2" />
            </svg>
          {/if}

          {#if sections.calendar}
            {@render sectionTitle(`Trading calendar — ${vm.calMonthLabel}`)}
            <div class="grid grid-cols-7 gap-1">
              {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as d, i (i)}<div class="pb-0.5 text-center text-[9px] text-muted-foreground">
                  {d}
                </div>{/each}
              {#each calCells as day, i (i)}
                {#if day === null}
                  <div></div>
                {:else}
                  {@const p = vm.calPnl[day]}
                  <div
                    class={cn(
                      'flex h-9 flex-col rounded-sm border p-1 text-[9px]',
                      p === undefined
                        ? 'border-border text-muted-foreground'
                        : p >= 0
                          ? 'border-chart-2/30 bg-chart-2/10 text-chart-2'
                          : 'border-destructive/30 bg-destructive/10 text-destructive'
                    )}
                  >
                    <span class="text-muted-foreground">{day}</span>
                    {#if p !== undefined}<span class="mt-auto text-right font-medium tabular-nums"
                        >{p >= 0 ? '+' : '-'}{Math.abs(Math.round(p))}</span
                      >{/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}

          {#if sections.cost}
            {@render sectionTitle('Cost breakdown')}
            <div class="overflow-hidden rounded-md border border-border">
              {#each vm.costRows as [label, amt, total], i (label)}
                <div
                  class={cn(
                    'flex items-center justify-between px-3 py-2 text-sm',
                    i > 0 && 'border-t border-border',
                    total && 'bg-secondary font-semibold'
                  )}
                >
                  <span class={total ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                  <span class={cn('tabular-nums', amt.startsWith('-') ? 'text-destructive' : 'text-foreground')}>{amt}</span>
                </div>
              {/each}
            </div>
            {#if vm.commNote}
              <p class="mt-1.5 text-[11px] text-muted-foreground">{vm.commNote}</p>
            {/if}
          {/if}

          {#if sections.tax}
            {@render sectionTitle('Tax — Section 1256 (60/40)')}
            <div class="overflow-hidden rounded-md border border-border">
              {#each vm.taxRows as [label, amt, total], i (label)}
                <div
                  class={cn(
                    'flex items-center justify-between px-3 py-2 text-sm',
                    i > 0 && 'border-t border-border',
                    total && 'bg-secondary font-semibold'
                  )}
                >
                  <span class={total ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                  <span class={cn('tabular-nums', total ? 'text-chart-2' : amt.startsWith('-') ? 'text-destructive' : 'text-foreground')}
                    >{amt}</span
                  >
                </div>
              {/each}
            </div>
            <p class="mt-1.5 text-[11px] text-muted-foreground">
              Estimate only — not tax advice. Section 1256 contracts are marked-to-market with 60% long-term / 40% short-term treatment.
            </p>
          {/if}

          {#if sections.advanced}
            {@render sectionTitle('Advanced statistics')}
            <div class="grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-3">
              {#each vm.advRows as [label, value] (label)}
                <div class="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm">
                  <span class="text-xs text-muted-foreground">{label}</span>
                  <span class="font-semibold tabular-nums">{value}</span>
                </div>
              {/each}
            </div>
          {/if}

          {#if !sections.kpis && !sections.curve && !sections.calendar && !sections.cost && !sections.tax && !sections.advanced}
            <p class="py-12 text-center text-sm text-muted-foreground">No sections selected — toggle some on to build the report.</p>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
