<script lang="ts">
  // A36 — unified dashboard panel chrome: a collapsible, drag-to-reorder card (parity with vanilla
  // ui.js initPanels). Collapse state + order are OWNED by App (persisted through the Store.local
  // seam under a staging-namespaced key) so workspace templates can snapshot them. The grip is the
  // drag handle (matches vanilla: mousedown arms the whole-panel draggable); clicking the header —
  // but not the grip or chevron — toggles collapse, and the chevron mirrors aria-expanded/label (B41).
  import type { Snippet } from 'svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

  interface Props {
    pkey: string;
    title: string;
    collapsed?: boolean;
    dragging?: boolean;
    ontoggle?: () => void;
    onreorderstart?: (key?: string) => void;
    onreorderend?: () => void;
    onreorderover?: (e: DragEvent, key?: string) => void;
    // R12/A71 (staging): the per-module header menu (move/hide). Off by default → prod/demo unchanged.
    menu?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    onmoveup?: () => void;
    onmovedown?: () => void;
    onhide?: () => void;
    // F26 (staging): grid modules move left/right — the labels default to the stacked up/down wording.
    moveUpLabel?: string;
    moveDownLabel?: string;
    actions?: Snippet;
    children: Snippet;
  }
  let {
    pkey,
    title,
    collapsed = false,
    dragging = false,
    ontoggle = () => {},
    onreorderstart = () => {},
    onreorderend = () => {},
    onreorderover = () => {},
    menu = false,
    isFirst = false,
    isLast = false,
    onmoveup = () => {},
    onmovedown = () => {},
    onhide = () => {},
    moveUpLabel = 'Move up',
    moveDownLabel = 'Move down',
    actions,
    children,
  }: Props = $props();

  let armed = $state(false); // grip pressed → the section is draggable for this gesture only

  function headClick(e: MouseEvent) {
    // Toggle on a bare-header click only — never when the click lands on the grip, the chevron, the
    // module menu, or an interactive control in the actions area (overlays, calendar nav), which would
    // otherwise collapse the panel out from under the user.
    const target = e.target as HTMLElement;
    if (target.closest('.grip') || target.closest('.chev') || target.closest('.pactions') || target.closest('.pmenu')) return;
    ontoggle();
  }
  function onDragStart(e: DragEvent) {
    e.dataTransfer!.effectAllowed = 'move';
    try {
      e.dataTransfer!.setData('text/plain', pkey);
    } catch (_) {}
    onreorderstart(pkey);
  }
  function onDragEnd() {
    armed = false;
    onreorderend();
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    onreorderover(e, pkey);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (drag-to-reorder is a pointer-only enhancement;
     the grip is aria-hidden and collapse/expand has a real keyboard button — panel content is fully
     reachable without dragging) -->
<section
  class="panel mt-4 rounded-[10px] border border-border bg-card px-4 pt-3.5 pb-4"
  class:collapsed
  class:dragging
  class:opacity-[0.55]={dragging}
  class:border-primary={dragging}
  data-key={pkey}
  draggable={armed}
  ondragstart={onDragStart}
  ondragend={onDragEnd}
  ondragover={onDragOver}
>
  <div class="phead mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2" role="presentation" onclick={headClick}>
    <span
      class="grip cursor-grab select-none text-[13px] leading-none tracking-[-2px] text-muted-foreground active:cursor-grabbing"
      aria-hidden="true"
      title="Drag to reorder"
      onmousedown={() => (armed = true)}
      onmouseup={() => (armed = false)}
    >⠿</span>
    <h2 class="m-0 min-w-0 text-[13px] font-bold uppercase tracking-[0.5px] text-muted-foreground">{title}</h2>
    {#if actions}<div class="pactions ml-auto flex min-w-0 flex-wrap items-center gap-2.5">{@render actions()}</div>{/if}
    {#if menu}
      <!-- A71 (staging): clickable header menu — per-module actions (move / hide). bits-ui (A128)
           owns open/close, outside-click, Escape, keyboard nav + ARIA roles. -->
      <div class="pmenu relative" class:ml-auto={!actions} class:ml-0={actions}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="pmenubtn cursor-pointer rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 text-[15px] leading-none text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="{title} module menu"
            title="Module options">⋯</DropdownMenu.Trigger
          >
          <DropdownMenu.Content class="pmenupop" aria-label="{title} options">
            <DropdownMenu.Item onSelect={ontoggle}>{collapsed ? 'Expand' : 'Collapse'}</DropdownMenu.Item>
            <DropdownMenu.Item disabled={isFirst} onSelect={onmoveup}>{moveUpLabel}</DropdownMenu.Item>
            <DropdownMenu.Item disabled={isLast} onSelect={onmovedown}>{moveDownLabel}</DropdownMenu.Item>
            <DropdownMenu.Item variant="destructive" onSelect={onhide}>Hide module</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/if}
    <button
      type="button"
      class="chev cursor-pointer border-0 bg-transparent px-1 py-0.5 text-[13px] leading-none text-muted-foreground hover:text-foreground"
      class:ml-auto={!actions && !menu}
      class:ml-0={actions || menu}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      title={collapsed ? 'Expand' : 'Collapse'}
      onclick={ontoggle}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  </div>
  {#if !collapsed}
    <div class="pbody">{@render children()}</div>
  {/if}
</section>
