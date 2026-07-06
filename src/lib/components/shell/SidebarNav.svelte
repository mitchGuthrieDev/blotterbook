<script lang="ts" module>
  // Persistent left navigation rail for the app shell (UI redesign initiative). Data-driven: the
  // consumer passes nav `sections`; this component owns the rendering, the active-item highlight, and
  // the collapse behavior. Items navigate via the `onnavigate(key)` callback (client-side view
  // switching) unless they carry an `href` (rendered as a real link). Icons are @lucide/svelte
  // components passed per item.
  import type { LucideIcon } from '@lucide/svelte';

  export interface NavItem {
    key: string;
    label: string;
    icon?: LucideIcon;
    /** If set, the item is a real link instead of a navigate callback. */
    href?: string;
  }
  export interface NavSection {
    /** Optional section label (e.g. "Data Management"), like "Documents" in the reference. */
    label?: string;
    items: NavItem[];
  }
</script>

<script lang="ts">
  import { cn } from '$lib/utils';

  interface Props {
    brand?: string;
    brandHref?: string;
    sections: NavSection[];
    active?: string;
    onnavigate?: (key: string) => void;
    /** Icon-only rail. */
    collapsed?: boolean;
  }
  let { brand = 'Blotterbook', brandHref = '/', sections, active = '', onnavigate, collapsed = false }: Props = $props();
</script>

<nav class="flex h-full flex-col gap-1 overflow-y-auto p-2" aria-label="Primary">
  <!-- Brand → homepage, like the top-corner logo in the reference. -->
  <a
    href={brandHref}
    class="mb-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold text-foreground no-underline hover:bg-accent"
  >
    <!-- A185: the real Blotterbook mark (same art as src/assets/favicon.svg), not a placeholder dot.
         Inlined so it needs no asset import and stays CSP-clean. -->
    <svg class="size-5 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bb-brand-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6aa0ff" />
          <stop offset="1" stop-color="#c98bff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#bb-brand-g)" />
    </svg>
    {#if !collapsed}<span class="truncate">{brand}</span>{/if}
  </a>

  {#each sections as section, i (section.label ?? i)}
    {#if section.label}
      {#if collapsed}
        <div class="mx-2 my-2 border-t border-border"></div>
      {:else}
        <div class="mt-3 mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {section.label}
        </div>
      {/if}
    {/if}
    {#each section.items as item (item.key)}
      {@const isActive = item.key === active}
      {@const Icon = item.icon}
      {@const cls = cn(
        // CH37 type-weight scale: nav items are the "labels + nav" tier (500).
        'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium no-underline transition-colors',
        collapsed && 'justify-center',
        isActive
          ? 'border border-border bg-secondary text-foreground'
          : 'border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      {#if item.href}
        <a href={item.href} class={cls} title={collapsed ? item.label : undefined} aria-current={isActive ? 'page' : undefined}>
          {#if Icon}<Icon class="size-4 shrink-0" />{/if}
          {#if !collapsed}<span class="truncate">{item.label}</span>{/if}
        </a>
      {:else}
        <button
          type="button"
          class={cls}
          title={collapsed ? item.label : undefined}
          aria-current={isActive ? 'page' : undefined}
          onclick={() => onnavigate?.(item.key)}
        >
          {#if Icon}<Icon class="size-4 shrink-0" />{/if}
          {#if !collapsed}<span class="truncate">{item.label}</span>{/if}
        </button>
      {/if}
    {/each}
  {/each}
</nav>
