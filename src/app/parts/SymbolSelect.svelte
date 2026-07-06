<script lang="ts">
  // F49: the Trade Editor's SYMBOL cell editor — a filterable select list inside the shared Popover
  // primitive (built on Popover + Input, not a hand-rolled combobox), built over the manual/new-row
  // symbol roots already in the dataset plus the known fee roots (EXCH/MICRO/NOT_MICRO — core.ts). A
  // free-text row ("Use "XYZ"") always sits at the top when the typed text isn't an existing option,
  // so an unlisted root can still be entered.
  //
  // A246: the trigger + open/reset-on-open/close-on-select shell is the shared EditableCellPopover —
  // this component owns only the filterable list content.
  import { Plus } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import EditableCellPopover from './EditableCellPopover.svelte';
  import { Input } from '$lib/components/ui/input';

  interface Props {
    value: string;
    /** Known roots to offer — dataset roots + fee-table roots (deduped, caller-sorted). */
    options: string[];
    onchange: (v: string) => void;
    /** Trigger button classes — matches the plain-text cell button so the swap is visually inert. */
    class?: string;
  }
  let { value, options, onchange, class: className = '' }: Props = $props();

  let filter = $state('');
  let highlight = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);

  function onOpen() {
    filter = '';
    highlight = 0;
    inputRef?.focus();
  }

  const trimmed = $derived(filter.trim());
  const filteredOptions = $derived.by(() => {
    const q = trimmed.toUpperCase();
    return q ? options.filter(o => o.toUpperCase().includes(q)) : options;
  });
  // Only offer the free-text row when the typed text isn't already an exact (case-insensitive) match.
  const showCustom = $derived(trimmed !== '' && !options.some(o => o.toUpperCase() === trimmed.toUpperCase()));
  const customValue = $derived(trimmed.toUpperCase());
  // The combined, keyboard-navigable list — custom row first (F49 spec), then the filtered options.
  const items = $derived<string[]>(showCustom ? [customValue, ...filteredOptions] : filteredOptions);

  function select(v: string, close: () => void) {
    onchange(v);
    close();
  }
  function onFilterInput(v: string) {
    filter = v;
    highlight = 0;
  }
  function onKey(e: KeyboardEvent, close: () => void) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = Math.min(highlight + 1, Math.max(items.length - 1, 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = items[highlight];
      if (v) select(v, close);
    }
    // Escape isn't handled here — it bubbles to bits-ui's Popover, which closes on Escape natively.
  }
</script>

<EditableCellPopover label={value || '—'} class={className} contentClass="w-56 p-2" onopen={onOpen}>
  {#snippet content({ close })}
    <Input
      bind:ref={inputRef}
      value={filter}
      oninput={e => onFilterInput(e.currentTarget.value)}
      onkeydown={e => onKey(e, close)}
      placeholder="Filter or type a new root…"
      aria-label="Filter symbol"
      class="h-8"
    />
    <div class="mt-1.5 max-h-56 overflow-y-auto" data-testid="symbolselect-list">
      {#each items as item, i (item)}
        <button
          type="button"
          data-testid={showCustom && i === 0 ? 'symbolselect-custom' : 'symbolselect-option'}
          onclick={() => select(item, close)}
          onmouseenter={() => (highlight = i)}
          class={cn(
            'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm',
            i === highlight ? 'bg-accent' : 'hover:bg-accent'
          )}
        >
          {#if showCustom && i === 0}
            <Plus class="size-3.5 shrink-0 text-muted-foreground" /> <span>Use "{item}"</span>
          {:else}
            {item}
          {/if}
        </button>
      {/each}
      {#if !items.length}
        <p class="px-2 py-1.5 text-xs text-muted-foreground">No matches</p>
      {/if}
    </div>
  {/snippet}
</EditableCellPopover>
