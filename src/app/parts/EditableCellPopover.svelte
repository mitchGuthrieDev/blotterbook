<script lang="ts" module>
  // A246: the shared trigger classes for a Trade Editor cell that opens a popover editor — byte-
  // identical to the plain (non-popover) editable-cell button in TradeEditor.svelte, so swapping one
  // for the other (DatePickerPopover/SymbolSelect vs. the plain text/number cell) is visually inert.
  export const CELL_TRIGGER_CLASS = 'block w-full rounded px-1.5 py-1 text-sm hover:bg-accent';
</script>

<script lang="ts">
  // F49: the Popover shell shared by DatePickerPopover and SymbolSelect — a real <button> trigger
  // (child-snippet pattern, so the actual element + its classes stay in the caller's control), an
  // `open` state, an `onopen` callback so the caller can reset its working state (view month / filter
  // text / highlight index) every time the popover opens, and a `close()` handed to the content
  // snippet so the caller's own select handler can close on pick. The grid-vs-list content itself
  // stays per-component — this owns only the scaffolding that was byte-identical between the two.
  import { cn } from '$lib/utils';
  import * as Popover from '$lib/components/ui/popover';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Trigger label — usually the cell's current value ('—' when unset). */
    label: string;
    /** Extra trigger classes layered on top of CELL_TRIGGER_CLASS (e.g. 'text-left'). */
    class?: string;
    /** Popover.Content classes (width/padding — the content shape is per-caller). */
    contentClass?: string;
    align?: 'start' | 'center' | 'end';
    /** Fires every time the popover transitions closed → open — reset filter/view state here so
     *  re-opening always starts fresh rather than wherever it was left. */
    onopen?: () => void;
    /** The popover body. Receives `close`; call it from the caller's own select handler (after
     *  invoking `onchange`) to close on pick — the same close-on-select shell both pickers used
     *  ad hoc before this was extracted. */
    content: Snippet<[{ close: () => void }]>;
  }
  let { label, class: className = '', contentClass = '', align = 'start', onopen, content }: Props = $props();

  let open = $state(false);
  $effect(() => {
    if (open) onopen?.();
  });
  const close = () => (open = false);
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button {...props} type="button" class={cn(CELL_TRIGGER_CLASS, className)}>
        {label}
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class={contentClass} {align}>
    {@render content({ close })}
  </Popover.Content>
</Popover.Root>
