<script lang="ts">
  // Reusable SIDEBAR app frame for the UI redesign initiative — the consistent frame every screen
  // mockup sits inside. Composes the persistent left <SidebarNav> + a content column (slim topbar with
  // a sidebar toggle + page title + page actions, then scrollable content). Responsive: the rail is a
  // static column on md+ (collapsible to an icon rail) and a slide-over drawer on mobile (Svelte
  // transitions — workflow Step 5). Utility-only styling (CSP-clean); reads design tokens directly.
  //
  // Phase 1 builds this as a presentational frame: `active` + `onnavigate` drive the highlight and the
  // navigate callback; wiring the seven screens to it is Phase 2 (client-side view switching).
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { Menu, PanelLeft } from '@lucide/svelte';
  import IconTip from '$lib/components/IconTip.svelte';
  import SidebarNav, { type NavSection } from './SidebarNav.svelte';

  interface Props {
    brand?: string;
    brandHref?: string;
    sections: NavSection[];
    active?: string;
    onnavigate?: (key: string) => void;
    /** Page title shown in the content topbar. */
    title?: string;
    /** Content-topbar right-side controls. */
    actions?: Snippet;
    /** Hide the sidebar rail entirely (+ its topbar toggles) — used for the first-run empty state
     * until a CSV is imported (A144), so onboarding stays focused. */
    hideNav?: boolean;
    children: Snippet;
  }
  let {
    brand = 'Blotterbook',
    brandHref = '/',
    sections,
    active = '',
    onnavigate,
    title,
    actions,
    hideNav = false,
    children,
  }: Props = $props();

  let collapsed = $state(false); // desktop icon-rail
  let mobileOpen = $state(false); // mobile drawer
</script>

<div class="flex h-dvh overflow-hidden">
  <!-- Desktop rail: static column, collapsible. Hidden entirely during first-run onboarding (A144). -->
  {#if !hideNav}
    <aside
      class={['hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 md:block', collapsed ? 'md:w-14' : 'md:w-60']}
    >
      <SidebarNav {brand} {brandHref} {sections} {active} {onnavigate} {collapsed} />
    </aside>
  {/if}

  <!-- Mobile drawer + backdrop. -->
  {#if mobileOpen && !hideNav}
    <div
      class="fixed inset-0 z-40 bg-black/60 md:hidden"
      transition:fade={{ duration: 150 }}
      onclick={() => (mobileOpen = false)}
      role="presentation"
    ></div>
    <aside class="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card md:hidden" transition:fly={{ x: -260, duration: 200 }}>
      <SidebarNav
        {brand}
        {brandHref}
        {sections}
        {active}
        onnavigate={k => {
          onnavigate?.(k);
          mobileOpen = false;
        }}
      />
    </aside>
  {/if}

  <!-- Content column. -->
  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
      {#if !hideNav}
        <!-- Mobile: open drawer. -->
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Open navigation"
          onclick={() => (mobileOpen = true)}
        >
          <Menu class="size-4" />
        </button>
        <!-- Desktop: collapse rail. -->
        <IconTip label={collapsed ? 'Expand navigation' : 'Collapse navigation'} side="bottom">
          {#snippet button(tip)}
            <button
              {...tip}
              type="button"
              class="hidden size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:grid"
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-pressed={collapsed}
              onclick={() => (collapsed = !collapsed)}
            >
              <PanelLeft class="size-4" />
            </button>
          {/snippet}
        </IconTip>
      {/if}
      {#if title}
        {#if !hideNav}<div class="h-4 w-px bg-border"></div>{/if}
        <h1 class="truncate text-sm font-medium text-foreground">{title}</h1>
      {/if}
      {#if actions}
        <!-- A225: min-w-0 + flex-1 so a growable action (the flavor text) can use the header's real
             free space and truncation only kicks in when the row is genuinely full. -->
        <div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">{@render actions()}</div>
      {/if}
    </header>

    <!-- A183: overflow-x-hidden locks page-level horizontal scrolling (mobile especially) — wide
         content (tables) must scroll INSIDE its own overflow-x-auto wrapper, never widen the page. -->
    <main class="flex-1 overflow-x-hidden overflow-y-auto">
      <div class="min-w-0 p-4 sm:p-6">{@render children()}</div>
    </main>
  </div>
</div>
