<script lang="ts">
  // Dashboard tab bar (A135; promoted CH16; v2 in A186): multiple named dashboards, each with its
  // own module layout, persisted via the Store.local seam (App owns the state + keys). Each tab has
  // a direct close ✕ (the menu keeps rename + the keyboard-accessible Move left/right fallback),
  // shows a dirty asterisk while its layout has unsaved changes, and reorders by pointer drag with
  // a FLIP animation (A146 pattern — collapses under reduced motion). "+ New tab" creates; a Save
  // button appears while the active tab is dirty (A189's asterisk pairs with this Save).
  import { Plus, MoreHorizontal, Pencil, ChevronLeft, ChevronRight, Trash2, X, Save } from '@lucide/svelte';
  import { flip } from 'svelte/animate';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { dur } from '../lib/motion.ts';

  export type DashTab = { id: string; name: string };
  let {
    tabs,
    active,
    dirty = [],
    onselect,
    oncreate,
    onrename,
    onmove,
    onreorder,
    ondelete,
    onsave,
  }: {
    tabs: DashTab[];
    active: string;
    /** Tab ids whose module layout has unsaved changes (A186/A189 — rendered as an asterisk). */
    dirty?: string[];
    onselect: (id: string) => void;
    oncreate: () => void;
    onrename: (id: string) => void;
    onmove: (id: string, dir: -1 | 1) => void;
    /** Drag-reorder: commit the FINAL tab order (ids), once, on drop (A192). */
    onreorder?: (ids: string[]) => void;
    ondelete: (id: string) => void;
    /** Persist the ACTIVE tab's layout (clears its dirty flag). */
    onsave?: () => void;
  } = $props();

  const isDirty = (id: string) => dirty.includes(id);

  // Pointer drag-to-reorder (A186; reworked A192). HTML5 drag events + animate:flip on the keyed
  // each; the menu's Move left/right stays as the keyboard-accessible path, so drag is a
  // pointer-only enhancement. During the drag we reorder a LOCAL working copy (rendered instead of
  // the prop) and only commit — once — on drop; a cancelled drag (Esc / dropped elsewhere) fires
  // dragend without drop and simply discards the working copy, restoring the entry order. Reorders
  // trigger at the hovered tab's horizontal MIDPOINT, not on edge entry, so unequal-width tabs
  // don't thrash while animate:flip is mid-flight.
  let dragId = $state<string | null>(null);
  let workOrder = $state<DashTab[] | null>(null);
  const view = $derived(workOrder ?? tabs);
  function dragStart(e: DragEvent, id: string) {
    dragId = id;
    workOrder = [...tabs];
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    }
  }
  function dragOver(e: DragEvent, overId: string) {
    e.preventDefault(); // allow drop
    if (!dragId || dragId === overId || !workOrder) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < box.x + box.width / 2;
    const from = workOrder.findIndex(t => t.id === dragId);
    const over = workOrder.findIndex(t => t.id === overId);
    if (from < 0 || over < 0) return;
    let to = before ? over : over + 1;
    if (from < to) to -= 1; // account for the removal shifting indices
    if (to === from) return;
    const next = [...workOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    workOrder = next;
  }
  function drop() {
    if (dragId && workOrder) onreorder?.(workOrder.map(t => t.id));
    dragId = null;
    workOrder = null;
  }
  // dragend fires on the SOURCE after drop (already committed + cleared) or on cancel — either
  // way, discard the working copy; without a preceding drop this restores the entry order.
  function dragEnd() {
    dragId = null;
    workOrder = null;
  }
</script>

<div class="flex flex-wrap items-center gap-1 border-b border-border pb-2">
  {#each view as t, i (t.id)}
    <div
      role="presentation"
      draggable="true"
      ondragstart={e => dragStart(e, t.id)}
      ondragover={e => dragOver(e, t.id)}
      ondrop={drop}
      ondragend={dragEnd}
      animate:flip={{ duration: dur(180) }}
      class={[
        'flex items-center rounded-md border',
        active === t.id ? 'border-border bg-secondary text-foreground' : 'border-transparent text-muted-foreground',
        dragId === t.id && 'opacity-60',
      ]}
    >
      <button
        type="button"
        class="rounded-l-md px-2.5 py-1 text-xs font-medium hover:bg-accent hover:text-foreground"
        aria-current={active === t.id ? 'page' : undefined}
        onclick={() => onselect(t.id)}
      >
        {t.name}{#if isDirty(t.id)}<span class="ml-0.5 text-chart-4" title="Unsaved layout changes">*</span>{/if}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="grid size-6 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Tab menu: {t.name}"><MoreHorizontal class="size-3.5" /></button
            >
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-[160px]">
          <DropdownMenu.Item onSelect={() => onrename(t.id)}><Pencil class="size-4" /> Rename</DropdownMenu.Item>
          <DropdownMenu.Item disabled={i === 0} onSelect={() => onmove(t.id, -1)}
            ><ChevronLeft class="size-4" /> Move left</DropdownMenu.Item
          >
          <DropdownMenu.Item disabled={i === tabs.length - 1} onSelect={() => onmove(t.id, 1)}
            ><ChevronRight class="size-4" /> Move right</DropdownMenu.Item
          >
          <DropdownMenu.Item disabled={tabs.length === 1} class="text-destructive" onSelect={() => ondelete(t.id)}
            ><Trash2 class="size-4" /> Delete</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <!-- A186: direct close ✕ (the last tab can't be closed — same rule as the menu Delete). -->
      <button
        type="button"
        class="grid size-6 place-items-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"
        aria-label="Close tab: {t.name}"
        disabled={tabs.length === 1}
        onclick={() => ondelete(t.id)}><X class="size-3" /></button
      >
    </div>
  {/each}
  <button
    type="button"
    class="ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    onclick={oncreate}><Plus class="size-3.5" /> New tab</button
  >
  {#if onsave && isDirty(active)}
    <button
      type="button"
      class="ml-auto flex items-center gap-1 rounded-md border border-chart-4/40 px-2 py-1 text-xs text-chart-4 hover:bg-accent"
      onclick={onsave}><Save class="size-3.5" /> Save layout</button
    >
  {/if}
</div>
