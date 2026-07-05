<script lang="ts">
  // A205: tooltip wrapper for icon-only / ambiguous buttons. Composes the canonical shadcn-svelte
  // tooltip with a self-contained Provider (works anywhere, consistent delay) and hands the trigger
  // props to the caller through the `button` snippet, so the real element stays in the caller's
  // template (its own classes, handlers and other spreads keep working — the bits-ui child pattern).
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Snippet } from 'svelte';

  let {
    label,
    side = 'top',
    button,
  }: {
    label: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Renders the actual trigger element; spread the snippet arg onto it. */
    button: Snippet<[Record<string, unknown>]>;
  } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render button(props)}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side}>{label}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
