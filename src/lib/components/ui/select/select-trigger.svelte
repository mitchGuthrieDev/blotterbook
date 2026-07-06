<script lang="ts">
  import { Select as SelectPrimitive, type WithoutChild } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    size = 'default',
    children,
    ...restProps
  }: WithoutChild<SelectPrimitive.TriggerProps> & {
    size?: 'sm' | 'default';
  } = $props();
</script>

<SelectPrimitive.Trigger
  bind:ref
  data-slot="select-trigger"
  data-size={size}
  class={cn(
    // A237: bits-ui's Select.Value only ever sets the bare `data-select-value` attribute (no
    // `data-slot`), so a `data-[slot=select-value]` selector here never matched anything — the
    // value span had no line-clamp/min-w-0 applied and a long selected label overflowed the
    // closed trigger. Target the attribute bits-ui actually emits (same pattern as the
    // `data-[placeholder]` selector just above) and force the flex child to actually shrink.
    "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive bg-transparent flex w-fit min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[select-value]:line-clamp-1 *:data-[select-value]:min-w-0 *:data-[select-value]:flex *:data-[select-value]:items-center *:data-[select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    className
  )}
  {...restProps}
>
  {@render children?.()}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="size-4 opacity-50"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
</SelectPrimitive.Trigger>
