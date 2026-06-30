<script lang="ts" module>
  // Persistent left navigation rail for the app shell (UI redesign initiative). Data-driven: the
  // consumer passes nav `sections`; this component owns the rendering, the active-item highlight, and
  // the icon set. Items navigate via the `onnavigate(key)` callback (client-side view switching, wired
  // in Phase 2) unless they carry an `href` (rendered as a real link).
  export interface NavItem {
    key: string;
    label: string;
    /** Icon name from the built-in set below (falls back to a dot). */
    icon?: string;
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
  let { brand = 'Blotterbook', brandHref = '/', sections, active = '', onnavigate, collapsed = false }: Props =
    $props();
</script>

{#snippet icon(name: string)}
  <svg
    class="size-4 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if name === 'dashboard'}
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1"
      /><rect x="3" y="14" width="7" height="7" rx="1" />
    {:else if name === 'calendar'}
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    {:else if name === 'analytics'}
      <path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" />
    {:else if name === 'blotter'}
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    {:else if name === 'csv'}
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" /><path
        d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"
      />
    {:else if name === 'trades'}
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    {:else if name === 'reports'}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    {:else}
      <circle cx="12" cy="12" r="3" />
    {/if}
  </svg>
{/snippet}

<nav class="flex h-full flex-col gap-1 overflow-y-auto p-2" aria-label="Primary">
  <!-- Brand → homepage, like the top-corner logo in the reference. -->
  <a
    href={brandHref}
    class="mb-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold text-foreground hover:bg-accent"
  >
    <span class="grid size-5 shrink-0 place-items-center rounded-full border border-border" aria-hidden="true">
      <span class="size-2 rounded-full bg-foreground"></span>
    </span>
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
      {@const cls = cn(
        'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
        collapsed && 'justify-center',
        isActive
          ? 'border border-border bg-secondary text-foreground'
          : 'border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      {#if item.href}
        <a href={item.href} class={cls} title={collapsed ? item.label : undefined} aria-current={isActive ? 'page' : undefined}>
          {@render icon(item.icon ?? 'default')}
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
          {@render icon(item.icon ?? 'default')}
          {#if !collapsed}<span class="truncate">{item.label}</span>{/if}
        </button>
      {/if}
    {/each}
  {/each}
</nav>
