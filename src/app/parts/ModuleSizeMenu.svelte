<script lang="ts">
  // A319: the shared ⋯-menu "Size" radio group (Dashboard + Analytics) — the discoverable,
  // keyboard-friendly path to change a module's size (the corner drag handle is the pointer path).
  // Renders inside the host screen's DropdownMenu.Content (bits-ui context flows through the
  // component boundary). Each pick stages/persists via the screen's size controller.
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Check } from '@lucide/svelte';
  import { SIZE_LABEL, type SizeController } from '../lib/modsize.svelte.ts';

  let { ctl, modKey }: { ctl: SizeController; modKey: string } = $props();
</script>

<DropdownMenu.Group>
  <DropdownMenu.Label class="text-xs font-normal text-muted-foreground">Size</DropdownMenu.Label>
  {#each ctl.supportedSizes(modKey) as sz (sz)}
    <DropdownMenu.Item onSelect={() => ctl.setSize(modKey, sz)}>
      <Check class={['size-4', ctl.sizeOf(modKey) === sz ? 'opacity-100' : 'opacity-0']} />
      {SIZE_LABEL[sz]}
    </DropdownMenu.Item>
  {/each}
</DropdownMenu.Group>
