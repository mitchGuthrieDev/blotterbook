<script lang="ts">
  // A36 — workspace template bar (parity with vanilla widgets.js ws_tpl / ws_save). Picks a saved
  // panel layout or "— Default —" (revert), and saves the current layout under a name. The template
  // CRUD + persistence live in App (Store.local seam); this is presentation only. Save is disabled
  // in demo (the demo is a 1:1 mirror with data-writing controls off — B23).
  // A128: native <select> → $ui Select (bits-ui); the save control → the Button primitive.
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    names?: string[];
    value?: string;
    onsave?: () => void;
    onselect?: (name: string) => void;
    saveDisabled?: boolean;
  }
  let { names = [], value = '', onsave = () => {}, onselect = () => {}, saveDisabled = false }: Props = $props();

  // The "default" layout is the empty string in App's model; bits-ui Select treats '' as no-value, so
  // map it to a sentinel internally (invisible to callers + e2e, which key off the visible labels).
  const DEFAULT = '__default__';
  const selValue = $derived(value === '' ? DEFAULT : value);
  const onSel = (v: string) => onselect(v === DEFAULT ? '' : v);
  // Pass items to Root so Select.Value resolves the label even while the listbox is closed (A128).
  const items = $derived([{ value: DEFAULT, label: '— Default —' }, ...names.map(n => ({ value: n, label: n }))]);
</script>

<div class="wsbar mt-4 flex items-center gap-2.5">
  <div class="wslabel flex items-center gap-2 text-[11px] uppercase tracking-[0.5px] text-muted-foreground">
    <span>Workspace</span>
    <Select.Root type="single" value={selValue} onValueChange={onSel} {items}>
      <Select.Trigger aria-label="Workspace" class="min-w-[140px]"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each items as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </div>
  <Button
    variant="secondary"
    class="wssave"
    size="sm"
    onclick={onsave}
    disabled={saveDisabled}
    title={saveDisabled ? 'Saving layouts is disabled in the demo.' : 'Save the current panel layout'}>Save layout</Button
  >
</div>

