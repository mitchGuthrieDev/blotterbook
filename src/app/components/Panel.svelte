<script lang="ts">
  // A36 — unified dashboard panel chrome: a collapsible, drag-to-reorder card (parity with vanilla
  // ui.js initPanels). Collapse state + order are OWNED by App (persisted through the Store.local
  // seam under a staging-namespaced key) so workspace templates can snapshot them. The grip is the
  // drag handle (matches vanilla: mousedown arms the whole-panel draggable); clicking the header —
  // but not the grip or chevron — toggles collapse, and the chevron mirrors aria-expanded/label (B41).
  import type { Snippet } from 'svelte';

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
  let menuOpen = $state(false); // A71 module-header menu popup
  const runMenu = (fn: () => void) => {
    fn();
    menuOpen = false;
  };

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

<svelte:window
  onclick={() => (menuOpen = false)}
  onkeydown={e => {
    if (e.key === 'Escape') menuOpen = false;
  }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions (drag-to-reorder is a pointer-only enhancement;
     the grip is aria-hidden and collapse/expand has a real keyboard button — panel content is fully
     reachable without dragging) -->
<section class="panel" class:collapsed class:dragging data-key={pkey} draggable={armed} ondragstart={onDragStart} ondragend={onDragEnd} ondragover={onDragOver}>
  <div class="phead" role="presentation" onclick={headClick}>
    <span
      class="grip"
      aria-hidden="true"
      title="Drag to reorder"
      onmousedown={() => (armed = true)}
      onmouseup={() => (armed = false)}
    >⠿</span>
    <h2>{title}</h2>
    {#if actions}<div class="pactions">{@render actions()}</div>{/if}
    {#if menu}
      <!-- A71 (staging): clickable header menu — per-module actions (move / hide). -->
      <div class="pmenu">
        <button
          type="button"
          class="pmenubtn"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-label="{title} module menu"
          title="Module options"
          onclick={e => {
            e.stopPropagation();
            menuOpen = !menuOpen;
          }}>⋯</button>
        {#if menuOpen}
          <div class="pmenupop" role="menu" aria-label="{title} options">
            <button type="button" role="menuitem" onclick={() => runMenu(ontoggle)}>{collapsed ? 'Expand' : 'Collapse'}</button>
            <button type="button" role="menuitem" disabled={isFirst} onclick={() => runMenu(onmoveup)}>{moveUpLabel}</button>
            <button type="button" role="menuitem" disabled={isLast} onclick={() => runMenu(onmovedown)}>{moveDownLabel}</button>
            <button type="button" role="menuitem" class="danger" onclick={() => runMenu(onhide)}>Hide module</button>
          </div>
        {/if}
      </div>
    {/if}
    <button type="button" class="chev" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand' : 'Collapse'} title={collapsed ? 'Expand' : 'Collapse'} onclick={ontoggle}>
      {collapsed ? '▸' : '▾'}
    </button>
  </div>
  {#if !collapsed}
    <div class="pbody">{@render children()}</div>
  {/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-top: 16px;
  }
  .panel.dragging {
    opacity: 0.55;
    border-color: var(--accent);
  }
  .phead {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .grip {
    cursor: grab;
    color: var(--faint);
    font-size: 13px;
    line-height: 1;
    user-select: none;
    letter-spacing: -2px;
  }
  .grip:active {
    cursor: grabbing;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .pactions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .chev {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
  }
  .pactions + .chev {
    margin-left: 0;
  }
  .chev:hover {
    color: var(--txt);
  }
  /* A71 (staging): the module-header menu button + popup. */
  .pmenu {
    position: relative;
    margin-left: auto;
  }
  .pactions + .pmenu {
    margin-left: 0;
  }
  .pmenu + .chev {
    margin-left: 0;
  }
  .pmenubtn {
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .pmenubtn:hover {
    color: var(--txt);
    background: var(--panel2);
  }
  .pmenupop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 40;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .pmenupop button {
    text-align: left;
    background: transparent;
    color: var(--txt);
    border: 0;
    border-radius: 6px;
    padding: 7px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .pmenupop button:hover:not(:disabled) {
    background: var(--panel2);
  }
  .pmenupop button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .pmenupop button.danger {
    color: var(--red);
  }
</style>
