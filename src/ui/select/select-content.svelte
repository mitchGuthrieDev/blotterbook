<script lang="ts">
  // Select listbox surface (A128). Rendered without a Portal so it stays under #sv-app for the e2e
  // specs; Floating UI positions + keeps it on-screen.
  import { Select as SelectPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$ui/utils';

  let {
    class: className,
    ref = $bindable(null),
    sideOffset = 4,
    children,
    ...rest
  }: SelectPrimitive.ContentProps & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Content
  bind:ref
  {sideOffset}
  class={cn(
    'z-50 max-h-72 min-w-[var(--bits-select-anchor-width)] overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] focus:outline-none',
    className
  )}
  {...rest}
>
  <SelectPrimitive.Viewport>
    {@render children?.()}
  </SelectPrimitive.Viewport>
</SelectPrimitive.Content>
