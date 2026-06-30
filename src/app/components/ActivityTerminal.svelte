<script lang="ts">
  // Activity terminal (A27). Subscribes to the core event bus (onEvent — A29, reused verbatim) and
  // logs the action events shared code emits (note saved, CSV imported, backup, erase, trade edit).
  // The vanilla terminal does the same; here the Svelte components fire the emits.
  import { onMount } from 'svelte';
  import { onEvent, pad2 } from '../../lib/core/core.ts';
  import Panel from './Panel.svelte';
  import type { PanelBundle } from '../../lib/core/types.ts';

  interface Line {
    id: number;
    ts: string;
    msg: string;
  }

  // The (optional) detail payloads the core event bus carries for the events logged below.
  interface EventDetail {
    count?: number;
    added?: number;
    date?: string;
    name?: string;
  }

  interface Props {
    panel?: PanelBundle;
  }
  let { panel = {} as PanelBundle }: Props = $props();
  let lines = $state<Line[]>([]);
  let nextId = 0; // stable per-line key so the ring buffer doesn't reindex on wrap
  let box: HTMLDivElement | undefined;

  const FMT: Record<string, (d?: EventDetail) => string> = {
    'refdata:loaded': () => 'reference data loaded',
    'data:loaded': d => `loaded ${d && d.count != null ? d.count : '?'} trades`,
    'data:imported': d => `imported ${d && d.added != null ? d.added : '?'} new trades`,
    'note:saved': d => `note saved · ${d && d.date ? d.date : ''}`,
    'trade:edited': () => 'trade metadata updated',
    'trade:deleted': () => 'trade deleted',
    'backup:created': () => 'backup downloaded',
    'data:erased': () => 'all staging data erased',
    'ws:saved': d => `workspace saved · ${d && d.name ? d.name : ''}`,
    'ws:loaded': d => `workspace loaded · ${d && d.name ? d.name : ''}`,
    'ws:reverted': () => 'layout reverted to default',
  };

  function add(msg: string) {
    const t = new Date();
    const ts = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
    lines = [...lines.slice(-49), { id: nextId++, ts, msg }]; // keep the last 50
  }

  onMount(() => {
    add('staging app ready');
    // onEvent returns an unsubscribe (core.js); collect them so the bus subscriptions are released
    // if this panel ever unmounts — no duplicate log lines on a remount.
    const offs = Object.entries(FMT).map(([ev, fmt]) => onEvent(ev, d => add(fmt(d as EventDetail))));
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
    <div
      class="log max-h-40 overflow-auto rounded-[7px] border border-line bg-bg px-2.5 py-2 font-mono text-xs"
      bind:this={box}
      role="log"
      aria-live="polite"
    >
      {#each lines as l (l.id)}
        <div class="flex gap-2.5 py-0.5">
          <span class="text-faint">{l.ts}</span><span class="text-green">{l.msg}</span>
        </div>
      {/each}
    </div>
  </div>
</Panel>
