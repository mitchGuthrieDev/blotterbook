<script lang="ts">
  // Live visual reference for the design system (UI mockup workflow, Step 3). Renders the design
  // tokens + every installed shadcn-svelte primitive with its variants/sizes, framed by the reusable
  // sidebar AppShell so it doubles as the redesign's shell preview. KEEP THIS UPDATED: when a
  // component is added via `npx shadcn-svelte@latest add <name>`, add a section here.
  //
  // Dev-only surface (/dev/components.html) — noindex. Utility-only styling (CSP-clean); animation
  // examples use Svelte's built-in transitions (workflow Step 5).
  import { fade, fly, slide } from 'svelte/transition';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { type NavSection } from '$lib/components/shell/SidebarNav.svelte';
  import { Button, type ButtonVariant, type ButtonSize } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';

  // ── App nav (the redesign's sidebar structure) ──────────────────────────────────────────────
  const sections: NavSection[] = [
    {
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        { key: 'calendar', label: 'Calendar', icon: 'calendar' },
        { key: 'analytics', label: 'Analytics', icon: 'analytics' },
        { key: 'blotter', label: 'Blotter', icon: 'blotter' },
      ],
    },
    {
      label: 'Data Management',
      items: [
        { key: 'csv', label: 'CSV Library', icon: 'csv' },
        { key: 'trades', label: 'Trades', icon: 'trades' },
        { key: 'reports', label: 'Reports', icon: 'reports' },
      ],
    },
  ];
  let activeView = $state('dashboard');

  // ── Token reference data ────────────────────────────────────────────────────────────────────
  const semanticTokens: { name: string; bg: string; fg?: string; note?: string }[] = [
    { name: 'background', bg: 'bg-background', fg: 'text-foreground' },
    { name: 'foreground', bg: 'bg-foreground', fg: 'text-background' },
    { name: 'card', bg: 'bg-card', fg: 'text-card-foreground' },
    { name: 'popover', bg: 'bg-popover', fg: 'text-popover-foreground' },
    { name: 'primary', bg: 'bg-primary', fg: 'text-primary-foreground', note: 'near-white action' },
    { name: 'secondary', bg: 'bg-secondary', fg: 'text-secondary-foreground' },
    { name: 'muted', bg: 'bg-muted', fg: 'text-muted-foreground' },
    { name: 'accent', bg: 'bg-accent', fg: 'text-accent-foreground', note: 'item-hover surface' },
    { name: 'destructive', bg: 'bg-destructive', fg: 'text-white', note: 'error / P&L loss (red kept)' },
    { name: 'border', bg: 'bg-border' },
    { name: 'input', bg: 'bg-input' },
    { name: 'ring', bg: 'bg-ring', note: 'focus ring (grey)' },
  ];
  const chartTokens: { name: string; bg: string; note: string }[] = [
    { name: 'chart-1', bg: 'bg-chart-1', note: 'series blue' },
    { name: 'chart-2', bg: 'bg-chart-2', note: 'P&L up / positive (green)' },
    { name: 'chart-3', bg: 'bg-chart-3', note: 'take-home (purple)' },
    { name: 'chart-4', bg: 'bg-chart-4', note: 'warning (amber)' },
    { name: 'chart-5', bg: 'bg-chart-5', note: 'P&L down / negative (red)' },
  ];
  const radii: { name: string; cls: string }[] = [
    { name: 'rounded-sm', cls: 'rounded-sm' },
    { name: 'rounded-md', cls: 'rounded-md' },
    { name: 'rounded-lg', cls: 'rounded-lg' },
    { name: 'rounded-xl', cls: 'rounded-xl' },
    { name: 'rounded-full', cls: 'rounded-full' },
  ];

  const buttonVariants: ButtonVariant[] = ['default', 'secondary', 'outline', 'ghost', 'link', 'destructive'];
  const buttonSizes: Exclude<ButtonSize, 'icon'>[] = ['sm', 'default', 'lg'];

  // KPI stat-card pattern (the reference's signature). `up` picks the only-color-in-data treatment.
  const stats: { label: string; value: string; badge: string; up: boolean; note: string }[] = [
    { label: 'Net P&L', value: '$1,250.00', badge: '+12.5%', up: true, note: 'Trending up this month' },
    { label: 'Win rate', value: '58.3%', badge: '-2.1%', up: false, note: 'Slightly down this period' },
    { label: 'Total trades', value: '1,234', badge: '+180', up: true, note: 'Across all sessions' },
  ];

  // ── Interactive demo state ──────────────────────────────────────────────────────────────────
  let selectValue = $state('');
  const contracts = [
    { value: 'es', label: 'E-mini S&P (ES)' },
    { value: 'nq', label: 'E-mini Nasdaq (NQ)' },
    { value: 'cl', label: 'Crude Oil (CL)' },
    { value: 'gc', label: 'Gold (GC)' },
  ];
  const selectLabel = $derived(contracts.find(c => c.value === selectValue)?.label ?? 'Pick a contract');

  let dialogOpen = $state(false);
  let showTransition = $state(true);
  type Tx = 'fade' | 'fly' | 'slide';
  let txKind = $state<Tx>('fade');
</script>

{#snippet section(title: string, blurb: string)}
  <h2 class="mt-12 mb-1 text-lg font-semibold tracking-[-0.01em]">{title}</h2>
  <p class="mb-5 text-sm text-muted-foreground">{blurb}</p>
{/snippet}

<AppShell {sections} active={activeView} onnavigate={k => (activeView = k)} title="Styleguide">
  {#snippet actions()}
    <a class="text-sm text-muted-foreground hover:text-foreground" href="/app/">Open app →</a>
  {/snippet}

  <p class="max-w-2xl text-sm text-muted-foreground">
    Greyscale UI · Geist Mono · 4px corners. Every design token and installed shadcn-svelte primitive,
    rendered with all variants and sizes. Add a section here whenever you install a new component so this
    reference stays live.
  </p>

  <!-- ── Stat cards ────────────────────────────────────────────────────────────────────────── -->
  {@render section('Stat cards', 'KPI card pattern — color appears only in the data (P&L badge).')}
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each stats as s (s.label)}
      <div class="rounded-md border border-border bg-card p-4">
        <div class="flex items-start justify-between gap-2">
          <span class="text-xs text-muted-foreground">{s.label}</span>
          <span
            class={`rounded border px-1.5 py-0.5 text-[11px] ${s.up ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}`}
            >{s.badge}</span
          >
        </div>
        <div class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{s.value}</div>
        <div class="mt-2 text-xs text-muted-foreground">{s.note}</div>
      </div>
    {/each}
  </div>

  <!-- ── Colors ────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Color tokens', 'Greyscale semantic set — use these names, not raw Tailwind palette colors.')}
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {#each semanticTokens as t (t.name)}
      <div class="overflow-hidden rounded-md border border-border">
        <div class={`flex h-16 items-end p-2 ${t.bg} ${t.fg ?? 'text-foreground'}`}>
          <span class="text-xs font-medium">{t.name}</span>
        </div>
        {#if t.note}
          <div class="bg-card px-2 py-1 text-[11px] text-muted-foreground">{t.note}</div>
        {/if}
      </div>
    {/each}
  </div>

  {@render section('Chart / trading hues', 'The only color kept — chart-2 = positive P&L, chart-5/destructive = negative, chart-4 = warning.')}
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    {#each chartTokens as t (t.name)}
      <div class="overflow-hidden rounded-md border border-border">
        <div class={`h-16 ${t.bg}`}></div>
        <div class="bg-card px-2 py-1 text-[11px]">
          <div class="font-medium text-foreground">{t.name}</div>
          <div class="text-muted-foreground">{t.note}</div>
        </div>
      </div>
    {/each}
  </div>

  <!-- ── Radius ────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Radius', 'Angular — derived from --radius (0.25rem / 4px).')}
  <div class="flex flex-wrap gap-5">
    {#each radii as rdef (rdef.name)}
      <div class="flex flex-col items-center gap-2">
        <div class={`size-16 border border-border bg-secondary ${rdef.cls}`}></div>
        <span class="text-[11px] text-muted-foreground">{rdef.name}</span>
      </div>
    {/each}
  </div>

  <!-- ── Buttons ───────────────────────────────────────────────────────────────────────────── -->
  {@render section('Button', 'variant × size props. Override visuals with Tailwind classes via the class prop.')}
  <div class="space-y-4">
    {#each buttonVariants as variant (variant)}
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-24 shrink-0 text-xs text-muted-foreground">{variant}</span>
        {#each buttonSizes as size (size)}
          <Button {variant} {size}>{size}</Button>
        {/each}
        <Button {variant} size="icon" aria-label="icon button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" /><path d="M12 5v14" />
          </svg>
        </Button>
        <Button {variant} disabled>disabled</Button>
      </div>
    {/each}
  </div>

  <!-- ── Overlays ──────────────────────────────────────────────────────────────────────────── -->
  {@render section('Overlays', 'Dialog, dropdown menu, popover, select — all portal to <body>.')}
  <div class="flex flex-wrap gap-3">
    <Dialog.Root bind:open={dialogOpen}>
      <Dialog.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline">Open dialog</Button>
        {/snippet}
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Dialog title</Dialog.Title>
          <Dialog.Description>Modal dialog composed over bits-ui, portalled to the body.</Dialog.Description>
        </Dialog.Header>
        <p class="text-sm text-muted-foreground">Body content goes here.</p>
        <Dialog.Footer>
          <Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
          <Button onclick={() => (dialogOpen = false)}>Confirm</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline">Dropdown menu</Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="min-w-[180px]" align="start">
        <DropdownMenu.Label>Actions</DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Edit</DropdownMenu.Item>
        <DropdownMenu.Item>Duplicate</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Delete</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline">Popover</Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content>
        <p class="mb-1 text-sm font-medium text-foreground">Popover</p>
        <p class="text-xs text-muted-foreground">Floating content positioned by Floating UI.</p>
      </Popover.Content>
    </Popover.Root>

    <Select.Root type="single" bind:value={selectValue}>
      <Select.Trigger class="w-[220px]">{selectLabel}</Select.Trigger>
      <Select.Content>
        <Select.Group>
          <Select.Label>Contracts</Select.Label>
          {#each contracts as c (c.value)}
            <Select.Item value={c.value} label={c.label}>{c.label}</Select.Item>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  </div>

  <!-- ── Transitions ───────────────────────────────────────────────────────────────────────── -->
  {@render section('Transitions', "Workflow Step 5: prefer Svelte's built-in transitions for early mockups.")}
  <div class="flex flex-wrap items-center gap-3">
    {#each ['fade', 'fly', 'slide'] as const as k (k)}
      <Button variant={txKind === k ? 'default' : 'secondary'} size="sm" onclick={() => (txKind = k)}>{k}</Button>
    {/each}
    <Button variant="outline" size="sm" onclick={() => (showTransition = !showTransition)}>Toggle</Button>
  </div>
  <div class="mt-3 h-24">
    {#if showTransition}
      {#if txKind === 'fade'}
        <div transition:fade class="inline-block rounded-md border border-border bg-card px-4 py-3 text-sm">fade</div>
      {:else if txKind === 'fly'}
        <div transition:fly={{ y: 16 }} class="inline-block rounded-md border border-border bg-card px-4 py-3 text-sm">fly</div>
      {:else}
        <div transition:slide class="inline-block rounded-md border border-border bg-card px-4 py-3 text-sm">slide</div>
      {/if}
    {/if}
  </div>
</AppShell>
