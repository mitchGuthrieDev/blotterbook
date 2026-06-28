<script>
  // A36 — unified dashboard panel chrome: a collapsible, drag-to-reorder card (parity with vanilla
  // ui.js initPanels). Collapse state + order are OWNED by App (persisted through the Store.local
  // seam under a staging-namespaced key) so workspace templates can snapshot them. The grip is the
  // drag handle (matches vanilla: mousedown arms the whole-panel draggable); clicking the header —
  // but not the grip or chevron — toggles collapse, and the chevron mirrors aria-expanded/label (B41).
  let {
    pkey,
    title,
    collapsed = false,
    dragging = false,
    ontoggle = () => {},
    onreorderstart = () => {},
    onreorderend = () => {},
    onreorderover = () => {},
    actions,
    children,
  } = $props();

  let armed = $state(false); // grip pressed → the section is draggable for this gesture only

  function headClick(e) {
    // Toggle on a bare-header click only — never when the click lands on the grip, the chevron, or
    // an interactive control in the actions area (overlays, calendar nav), which would otherwise
    // collapse the panel out from under the user.
    if (e.target.closest('.grip') || e.target.closest('.chev') || e.target.closest('.pactions')) return;
    ontoggle();
  }
  function onDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', pkey);
    } catch (_) {}
    onreorderstart(pkey);
  }
  function onDragEnd() {
    armed = false;
    onreorderend();
  }
  function onDragOver(e) {
    e.preventDefault();
    onreorderover(e, pkey);
  }
</script>

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
    <button type="button" class="chev" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand' : 'Collapse'} onclick={ontoggle}>
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
</style>
