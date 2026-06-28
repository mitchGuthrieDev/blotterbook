<script lang="ts">
  // A36 — workspace template bar (parity with vanilla widgets.js ws_tpl / ws_save). Picks a saved
  // panel layout or "— Default —" (revert), and saves the current layout under a name. The template
  // CRUD + persistence live in App (Store.local seam); this is presentation only. Save is disabled
  // in demo (the demo is a 1:1 mirror with data-writing controls off — B23).
  interface Props {
    names?: string[];
    value?: string;
    onsave?: () => void;
    onselect?: (name: string) => void;
    saveDisabled?: boolean;
  }
  let { names = [], value = '', onsave = () => {}, onselect = () => {}, saveDisabled = false }: Props = $props();
</script>

<div class="wsbar">
  <label class="wslabel">
    <span>Workspace</span>
    <select value={value} onchange={e => onselect(e.currentTarget.value)}>
      <option value="">— Default —</option>
      {#each names as n (n)}<option value={n}>{n}</option>{/each}
    </select>
  </label>
  <button
    type="button"
    class="wssave"
    onclick={onsave}
    disabled={saveDisabled}
    title={saveDisabled ? 'Saving layouts is disabled in the demo.' : 'Save the current panel layout'}
  >Save layout</button>
</div>

<style>
  .wsbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .wslabel {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
  }
  select {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .wssave {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .wssave:hover:not(:disabled) {
    border-color: var(--hover-line);
  }
  .wssave:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
