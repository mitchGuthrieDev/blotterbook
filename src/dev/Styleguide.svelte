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
  import { navSections } from './nav';
  // A180 spike: Phosphor comparison set (pinned dep). A191: DEEP imports — the package index
  // re-exports every icon and does NOT tree-shake through named imports (the naive form shipped an
  // 8.5 MB devcomponents chunk); per-icon paths keep this chunk in the tens of KBs.
  import PhChartLine from 'phosphor-svelte/lib/ChartLine';
  import PhCalendar from 'phosphor-svelte/lib/CalendarDots';
  import PhTable from 'phosphor-svelte/lib/Table';
  import PhPencil from 'phosphor-svelte/lib/PencilSimple';
  import PhFileCsv from 'phosphor-svelte/lib/FileCsv';
  import PhNotebook from 'phosphor-svelte/lib/Notebook';
  import PhFunnel from 'phosphor-svelte/lib/Funnel';
  import PhTag from 'phosphor-svelte/lib/Tag';
  import PhTerminal from 'phosphor-svelte/lib/Terminal';
  import PhSave from 'phosphor-svelte/lib/FloppyDisk';
  import PhTrash from 'phosphor-svelte/lib/Trash';
  import PhPlus from 'phosphor-svelte/lib/Plus';
  import PhX from 'phosphor-svelte/lib/X';
  import PhList from 'phosphor-svelte/lib/List';
  import PhGauge from 'phosphor-svelte/lib/Gauge';
  import PhReceipt from 'phosphor-svelte/lib/Receipt';
  import {
    ChartLine as LuChartLine,
    CalendarDays as LuCalendar,
    Table2 as LuTable,
    Pencil as LuPencil,
    FileText as LuFile,
    NotebookPen as LuNotebook,
    Filter as LuFilter,
    Tag as LuTag,
    Terminal as LuTerminal,
    Save as LuSave,
    Trash2 as LuTrash,
    Plus as LuPlus,
    X as LuX,
    Menu as LuMenu,
    Gauge as LuGauge,
    Receipt as LuReceipt,
  } from '@lucide/svelte';

  const ICON_PAIRS = [
    { label: 'chart / performance', lu: LuChartLine, ph: PhChartLine },
    { label: 'calendar', lu: LuCalendar, ph: PhCalendar },
    { label: 'table / blotter', lu: LuTable, ph: PhTable },
    { label: 'edit', lu: LuPencil, ph: PhPencil },
    { label: 'csv / file', lu: LuFile, ph: PhFileCsv },
    { label: 'journal / notes', lu: LuNotebook, ph: PhNotebook },
    { label: 'filter', lu: LuFilter, ph: PhFunnel },
    { label: 'tag', lu: LuTag, ph: PhTag },
    { label: 'terminal / activity', lu: LuTerminal, ph: PhTerminal },
    { label: 'save', lu: LuSave, ph: PhSave },
    { label: 'delete', lu: LuTrash, ph: PhTrash },
    { label: 'add', lu: LuPlus, ph: PhPlus },
    { label: 'close', lu: LuX, ph: PhX },
    { label: 'menu', lu: LuMenu, ph: PhList },
    { label: 'gauge / stats', lu: LuGauge, ph: PhGauge },
    { label: 'costs', lu: LuReceipt, ph: PhReceipt },
  ] as const;
  const PH_WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const;
  import { Button, type ButtonVariant, type ButtonSize } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';

  // App nav (the redesign's sidebar structure) lives in ./nav — shared with the Dashboard harness.
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

  // CH37 type-weight scale — mono-forward UI, so weight (not a second typeface) carries hierarchy.
  // The self-hosted Geist Mono variable woff2 spans the full wght 100–900 axis (verified against the
  // @font-face `font-weight: 100 900` range in tailwind.css), so every tier below renders as a real
  // native weight — no faux-bold synthesis. Keep new UI on one of these four; don't reach for a fifth.
  const weightScale: { cls: string; weight: string; tier: string; example: string }[] = [
    { cls: 'font-normal', weight: '400', tier: 'Body', example: 'Prose, table cell values, descriptions.' },
    { cls: 'font-medium', weight: '500', tier: 'Labels + nav', example: 'Field labels, sidebar nav items, tabs, badges.' },
    {
      cls: 'font-semibold',
      weight: '600',
      tier: 'Emphasis + card headers + table headers',
      example: 'Card.Title, module headers, table column headers, active-state emphasis.',
    },
    {
      cls: 'font-bold',
      weight: '700',
      tier: 'KPI numerals + page titles',
      example: 'Standalone hero stat values (Dashboard KPI cards), report/page titles.',
    },
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
  let cbA = $state(true);
  let cbB = $state(false);
  let switchOn = $state(true);
  let tabValue = $state('overview');
  let sheetOpen = $state(false);
  let alertOpen = $state(false);
  let showTransition = $state(true);
  type Tx = 'fade' | 'fly' | 'slide';
  let txKind = $state<Tx>('fade');
</script>

{#snippet section(title: string, blurb: string)}
  <h2 class="mt-12 mb-1 text-lg font-semibold tracking-[-0.01em]">{title}</h2>
  <p class="mb-5 text-sm text-muted-foreground">{blurb}</p>
{/snippet}

<AppShell sections={navSections} active={activeView} onnavigate={k => (activeView = k)} title="Styleguide">
  {#snippet actions()}
    <a class="text-sm text-muted-foreground no-underline hover:text-foreground" href="/app/">Open app →</a>
  {/snippet}

  <p class="max-w-2xl text-sm text-muted-foreground">
    Greyscale UI · Geist Mono · 4px corners. Every design token and installed shadcn-svelte primitive, rendered with all variants and sizes.
    Add a section here whenever you install a new component so this reference stays live.
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
        <!-- CH37: hero KPI numeral tier (700) — matches Dashboard's statCard. -->
        <div class="mt-2 text-3xl font-bold tracking-tight tabular-nums">{s.value}</div>
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

  {@render section(
    'Chart / trading hues',
    'The only color kept — chart-2 = positive P&L, chart-5/destructive = negative, chart-4 = warning.'
  )}
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

  <!-- ── Type weight scale (CH37) ──────────────────────────────────────────────────────────── -->
  {@render section(
    'Type weight scale',
    'Mono-forward UI (Geist Mono serves both --font-sans and --font-mono), so weight carries hierarchy instead of a second typeface. Four tiers only — normalize new UI onto one of these.'
  )}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each weightScale as w (w.cls)}
      <div class="rounded-md border border-border bg-card p-4">
        <div class={`text-2xl tabular-nums ${w.cls}`}>Ag 123</div>
        <div class="mt-2 text-xs text-foreground">{w.cls} <span class="text-muted-foreground">· {w.weight}</span></div>
        <div class="mt-1 text-xs font-medium text-muted-foreground">{w.tier}</div>
        <div class="mt-1 text-[11px] text-muted-foreground">{w.example}</div>
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

  <!-- ── Badge ─────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Badge', 'variant prop. Use outline + class overrides for P&L tints.')}
  <div class="flex flex-wrap items-center gap-2">
    <Badge>default</Badge>
    <Badge variant="secondary">secondary</Badge>
    <Badge variant="destructive">destructive</Badge>
    <Badge variant="outline">outline</Badge>
    <Badge variant="outline" class="border-chart-2/40 text-chart-2">+P&L</Badge>
    <Badge variant="outline" class="border-destructive/40 text-destructive">-P&L</Badge>
  </div>

  <!-- ── Card ──────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Card', 'Compact module shell — Header / Content / Footer.')}
  <Card.Root class="max-w-sm">
    <Card.Header>
      <Card.Title>Card title</Card.Title>
      <Badge variant="secondary">badge</Badge>
    </Card.Header>
    <Card.Content>
      <p class="text-sm text-muted-foreground">Card content sits here. Used as the shell for every dashboard module.</p>
    </Card.Content>
    <Card.Footer class="justify-end">
      <Button variant="ghost" size="sm">Cancel</Button>
      <Button size="sm">Save</Button>
    </Card.Footer>
  </Card.Root>

  <!-- ── Form controls ─────────────────────────────────────────────────────────────────────── -->
  {@render section('Form controls', 'Input, Textarea, Label, Checkbox, Switch (bits-ui).')}
  <div class="flex flex-wrap items-start gap-6">
    <div class="grid gap-1.5">
      <Label for="sg-input">Label</Label>
      <Input id="sg-input" placeholder="Search…" class="w-56" />
    </div>
    <Textarea placeholder="Notes…" class="w-56" />
    <div class="flex flex-col gap-3 pt-6">
      <Label class="gap-2"><Checkbox bind:checked={cbA} /> Checkbox checked</Label>
      <Label class="gap-2"><Checkbox bind:checked={cbB} /> Checkbox unchecked</Label>
      <Label class="gap-2"><Switch bind:checked={switchOn} /> Switch</Label>
    </div>
  </div>

  <!-- ── Tabs ──────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Tabs', 'value-bound segmented sections.')}
  <Tabs.Root bind:value={tabValue} class="max-w-md">
    <Tabs.List>
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="costs">Costs</Tabs.Trigger>
      <Tabs.Trigger value="tax">Tax</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="overview" class="pt-2 text-sm text-muted-foreground">Overview panel content.</Tabs.Content>
    <Tabs.Content value="costs" class="pt-2 text-sm text-muted-foreground">Costs panel content.</Tabs.Content>
    <Tabs.Content value="tax" class="pt-2 text-sm text-muted-foreground">Tax panel content.</Tabs.Content>
  </Tabs.Root>

  <!-- ── Tooltip ───────────────────────────────────────────────────────────────────────────── -->
  {@render section('Tooltip', 'Wrap triggers in Tooltip.Provider.')}
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline">Hover me</Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Tooltip text</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>

  <!-- ── Breadcrumb · Separator · Skeleton ─────────────────────────────────────────────────── -->
  {@render section('Breadcrumb, Separator, Skeleton', 'Navigation + layout primitives.')}
  <Breadcrumb.Root>
    <Breadcrumb.List>
      <Breadcrumb.Item><Breadcrumb.Link href="/app/">Dashboard</Breadcrumb.Link></Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item><Breadcrumb.Page>Blotter</Breadcrumb.Page></Breadcrumb.Item>
    </Breadcrumb.List>
  </Breadcrumb.Root>
  <div class="flex items-center gap-3 text-sm text-muted-foreground">left <Separator orientation="vertical" class="h-4" /> right</div>
  <Separator />
  <div class="flex items-center gap-3">
    <Skeleton class="size-10 rounded-full" />
    <div class="grid gap-2">
      <Skeleton class="h-3 w-40" />
      <Skeleton class="h-3 w-24" />
    </div>
  </div>

  <!-- ── Sheet · Alert dialog ──────────────────────────────────────────────────────────────── -->
  {@render section('Sheet & Alert dialog', 'Slide-over sheet + confirm dialog (portal to <body>).')}
  <div class="flex flex-wrap gap-3">
    <Sheet.Root bind:open={sheetOpen}>
      <Sheet.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline">Open sheet</Button>
        {/snippet}
      </Sheet.Trigger>
      <Sheet.Content side="right">
        <Sheet.Header>
          <Sheet.Title>Sheet title</Sheet.Title>
          <Sheet.Description>A right-side slide-over panel.</Sheet.Description>
        </Sheet.Header>
        <div class="p-4 text-sm text-muted-foreground">Sheet body content.</div>
        <Sheet.Footer>
          <Button onclick={() => (sheetOpen = false)}>Done</Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>

    <AlertDialog.Root bind:open={alertOpen}>
      <AlertDialog.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="destructive">Delete…</Button>
        {/snippet}
      </AlertDialog.Trigger>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete this trade?</AlertDialog.Title>
          <AlertDialog.Description>This action cannot be undone.</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90">Delete</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>

  <!-- ── Table ─────────────────────────────────────────────────────────────────────────────── -->
  {@render section('Table', 'Header / Body / Row / Cell / Footer.')}
  <Card.Root>
    <Table.Root>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head>Symbol</Table.Head>
          <Table.Head>Side</Table.Head>
          <Table.Head class="text-right">P&L</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell class="font-medium">ES</Table.Cell>
          <Table.Cell><Badge variant="outline" class="border-chart-2/40 text-chart-2">Long</Badge></Table.Cell>
          <Table.Cell class="text-right tabular-nums text-chart-2">+$375.00</Table.Cell>
        </Table.Row>
        <Table.Row>
          <Table.Cell class="font-medium">NQ</Table.Cell>
          <Table.Cell><Badge variant="outline" class="border-destructive/40 text-destructive">Short</Badge></Table.Cell>
          <Table.Cell class="text-right tabular-nums text-destructive">-$230.00</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  </Card.Root>

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

  <!-- ── A180 spike: Phosphor vs Lucide ─────────────────────────────────────────────────────── -->
  {@render section(
    'Icons: Lucide vs Phosphor (A180 spike)',
    'The app ships @lucide/svelte; this compares the ~16 core glyphs against phosphor-svelte at app sizes, plus Phosphor\u2019s weight axis (its differentiator). Decision notes live in the A180 backlog item.'
  )}
  <div class="overflow-x-auto">
    <table class="text-sm">
      <thead>
        <tr class="text-left text-xs text-muted-foreground">
          <th class="py-1 pr-6">use</th>
          <th class="py-1 pr-6">Lucide 16/20</th>
          <th class="py-1 pr-6">Phosphor 16/20</th>
        </tr>
      </thead>
      <tbody>
        {#each ICON_PAIRS as p (p.label)}
          {@const Lu = p.lu}
          {@const Ph = p.ph}
          <tr class="border-t border-border">
            <td class="py-2 pr-6 text-xs text-muted-foreground">{p.label}</td>
            <td class="py-2 pr-6"><span class="inline-flex items-center gap-3"><Lu class="size-4" /><Lu class="size-5" /></span></td>
            <td class="py-2 pr-6"><span class="inline-flex items-center gap-3"><Ph size={16} /><Ph size={20} /></span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="mt-4 mb-1 text-xs text-muted-foreground">Phosphor weight axis (ChartLine at 20px):</p>
  <div class="flex flex-wrap items-center gap-4">
    {#each PH_WEIGHTS as w (w)}
      <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><PhChartLine size={20} weight={w} /> {w}</span>
    {/each}
  </div>
</AppShell>
