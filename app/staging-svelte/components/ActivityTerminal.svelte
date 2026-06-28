<script>
  // Activity terminal (A27). Subscribes to the core event bus (onEvent — A29, reused verbatim) and
  // logs the action events shared code emits (note saved, CSV imported, backup, erase, trade edit).
  // The vanilla terminal does the same; here the Svelte components fire the emits.
  import { onMount } from 'svelte';
  import { onEvent, pad2 } from '../../core.js';
  import Panel from './Panel.svelte';

  let { panel = {} } = $props();
  let lines = $state([]);
  let box;

  const FMT = {
    'data:loaded': d => `loaded ${d && d.count != null ? d.count : '?'} trades`,
    'data:imported': d => `imported ${d && d.added != null ? d.added : '?'} new trades`,
    'note:saved': d => `note saved · ${d && d.date ? d.date : ''}`,
    'trade:edited': () => 'trade metadata updated',
    'backup:created': () => 'backup downloaded',
    'data:erased': () => 'all staging data erased',
    'ws:saved': d => `workspace saved · ${d && d.name ? d.name : ''}`,
    'ws:loaded': d => `workspace loaded · ${d && d.name ? d.name : ''}`,
    'ws:reverted': () => 'layout reverted to default',
  };

  function add(msg) {
    const t = new Date();
    const ts = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
    lines = [...lines.slice(-49), { ts, msg }]; // keep the last 50
  }

  onMount(() => {
    add('staging app ready');
    // onEvent returns an unsubscribe (core.js); collect them so the bus subscriptions are released
    // if this panel ever unmounts — no duplicate log lines on a remount.
    const offs = Object.entries(FMT).map(([ev, fmt]) => onEvent(ev, d => add(fmt(d))));
    return () => offs.forEach(off => off());
  });

  // Auto-scroll to the newest line.
  $effect(() => {
    lines.length;
    if (box) box.scrollTop = box.scrollHeight;
  });
</script>

<Panel {...panel} title="Activity">
  <div class="terminal">
    <div class="log" bind:this={box} role="log" aria-live="polite">
      {#each lines as l, i (i)}
        <div class="row"><span class="ts">{l.ts}</span><span class="msg">{l.msg}</span></div>
      {/each}
    </div>
  </div>
</Panel>

<style>
  .log {
    max-height: 160px;
    overflow: auto;
    font-family: var(--mono);
    font-size: 12px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 8px 10px;
  }
  .row {
    display: flex;
    gap: 10px;
    padding: 2px 0;
  }
  .ts {
    color: var(--faint);
  }
  .msg {
    color: var(--green);
  }
</style>
