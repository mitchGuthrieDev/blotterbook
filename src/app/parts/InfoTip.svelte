<script lang="ts">
  // A242: a tap-friendly "what is this?" affordance for the contextual definitions/caveats that used
  // to live in the standalone Definitions module. Unlike IconTip (a hover tooltip for short labels),
  // this is a shadcn-svelte Popover carrying a title + prose paragraph(s), so longer definition text
  // stays reachable on touch (a tooltip-only affordance isn't — A222). Icon-only trigger; the popover
  // portals to <body> (canonical). CSP-clean (utilities only).
  import * as Popover from '$lib/components/ui/popover';
  import { Info } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let {
    title,
    label = 'What is this?',
    side = 'top',
    align = 'center',
    children,
  }: {
    title: string;
    /** Accessible name for the icon trigger (defaults to a generic "What is this?"). */
    label?: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    /** The definition body — plain prose. */
    children: Snippet;
  } = $props();
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        aria-label={label}
        class="relative inline-grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
      >
        <Info class="size-3.5" />
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content {side} {align} class="w-72 space-y-1.5">
    <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
    <div class="text-xs leading-relaxed text-muted-foreground">{@render children()}</div>
  </Popover.Content>
</Popover.Root>
