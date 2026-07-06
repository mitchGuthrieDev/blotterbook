<script lang="ts">
  // Shared tag input with vocabulary autocomplete (A167) — an Input + native <datalist> so typing
  // suggests the EXISTING canonical tags (prefix-matched on the cleanTag form) and the personal
  // vocabulary converges instead of fragmenting into near-duplicates. Native datalist keeps this
  // dependency-free, keyboard-navigable, and CSP-safe (the popup is OS chrome, themed by the
  // page's color-scheme); picking a suggestion fills the input, and Enter commits through the
  // SAME onadd path as typing — the parent applies cleanTag, so the round-trip is canonical.
  import { Input } from '$lib/components/ui/input';
  import { cleanTag } from '../../lib/core/store.ts';

  let {
    value = $bindable(''),
    suggestions = [],
    placeholder = 'Add tag, Enter…',
    disabled = false,
    class: className = 'h-8',
    onadd,
  }: {
    value?: string;
    /** The existing canonical vocabulary to suggest from (e.g. dash.tags / journal tags). */
    suggestions?: string[];
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    /** Commit the entered/picked tag (the parent canonicalizes + dedupes). */
    onadd: (tag: string) => void;
  } = $props();

  const uid = $props.id();
  const matches = $derived.by(() => {
    const q = cleanTag(value);
    return (q ? suggestions.filter(s => s.startsWith(q) && s !== q) : suggestions).slice(0, 8);
  });
</script>

<Input
  bind:value
  {placeholder}
  aria-label="Add tag"
  {disabled}
  class={className}
  autocomplete="off"
  list="bb-tags-{uid}"
  onkeydown={e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onadd(value);
      value = '';
    }
  }}
/>
<datalist id="bb-tags-{uid}">
  {#each matches as s (s)}<option value={s}></option>{/each}
</datalist>
