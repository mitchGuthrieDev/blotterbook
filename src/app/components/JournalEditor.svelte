<script lang="ts">
  // Day-note editor (A27; A32 added tags + screenshots). Persists per-day annotations through the
  // Store seam (getJournal/saveJournal — A29, reused verbatim). The store comes from context (A31):
  // real Store on app/staging, in-memory DemoStore on demo. Screenshots are gated by the shared
  // store.validShot allow-list (base64 images only — S15/S18). An empty save deletes the row.
  import { getContext } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { emit, PAGE_MODE } from '../../lib/core/core.ts';
  import { readImage } from '../lib/files.ts';
  import type { StoreLike } from '../../lib/core/types.ts';

  interface Props {
    date: string;
    onsaved?: () => void;
    onclose?: () => void;
  }
  let { date, onsaved, onclose }: Props = $props();
  const store = getContext('bb:store') as StoreLike;
  const isDemo = PAGE_MODE === 'demo'; // demo never persists — controls are disabled + a note shown (A49/A33)

  let text = $state('');
  let tagsStr = $state('');
  let shots = $state<string[]>([]);
  let saving = $state(false);
  let savedMsg = $state('');
  let ready = $state(false); // false until the day's record has loaded (avoids clobbering edits — see below)
  let shotInput: HTMLInputElement;

  // Reload whenever the selected date changes. The load is async (IndexedDB), so we gate the form on
  // `ready` until it resolves — otherwise a fast edit could be overwritten by the in-flight load.
  // A101: a per-load generation token guards against a stale resolve — if the date changes again
  // before a slow getJournal() settles, the older promise must not clobber the newer day's fields.
  let loadId = 0;
  $effect(() => {
    const d = date;
    const myId = ++loadId;
    savedMsg = '';
    ready = false;
    store.getJournal(d).then(
      rec => {
        if (myId !== loadId) return; // superseded by a newer date load
        text = rec.text || '';
        tagsStr = (rec.tags || []).join(', ');
        shots = rec.shots || [];
        ready = true;
      },
      (err: unknown) => {
        if (myId !== loadId) return; // superseded — let the newer load drive the form
        // A93: a read failure used to silently leave the form disabled forever. Re-enable on a blank
        // record and tell the user, rather than hanging.
        console.error('day-note load failed', err);
        text = '';
        tagsStr = '';
        shots = [];
        ready = true;
        savedMsg = 'Could not load this day’s note.';
      }
    );
  });

  async function addShot(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    const url = await readImage(f);
    if (url && store.validShot(url)) shots = [...shots, url];
    else savedMsg = 'Only image screenshots are allowed.';
  }

  async function save() {
    if (isDemo) return; // demo-never-persists guard
    saving = true;
    const tags = [...new Set(tagsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
    try {
      await store.saveJournal(date, { text, tags, shots });
    } catch (err: unknown) {
      // A93: don't report "Saved" when the persist actually rejected.
      console.error('day-note save failed', err);
      savedMsg = 'Could not save — check your browser storage.';
      saving = false;
      return;
    }
    saving = false;
    savedMsg = text.trim() || tags.length || shots.length ? 'Saved' : 'Cleared';
    emit('note:saved', { date });
    onsaved?.();
  }
</script>

<section class="journal mt-4 rounded-[10px] border border-border bg-card px-4 pb-4 pt-3.5">
  <div class="phead mb-2.5 flex items-center justify-between">
    <h2 class="m-0 text-[13px] font-bold uppercase tracking-[0.5px] text-muted-foreground">Day note · {date}</h2>
    <button type="button" class="cursor-pointer border-0 bg-transparent text-[20px] leading-none text-muted-foreground hover:text-foreground" onclick={onclose} aria-label="Close day note">×</button>
  </div>
  {#if isDemo}<p class="demonote m-0 mb-2 text-[12px] text-chart-4">Day-notes are read-only in the demo — nothing is saved.</p>{/if}
  <textarea class="box-border w-full resize-y rounded-[7px] border border-border bg-secondary p-2.5 font-sans text-[13px] text-foreground focus:border-primary focus:outline-none" bind:value={text} rows="4" disabled={!ready || isDemo} placeholder={`What happened on ${date}? Setups, mistakes, market context…`}></textarea>
  <input class="box-border mt-2 w-full rounded-[7px] border border-border bg-secondary px-2.5 py-2 font-sans text-[13px] text-foreground focus:border-primary focus:outline-none" type="text" bind:value={tagsStr} disabled={!ready || isDemo} placeholder="tags (comma separated)" />
  <div class="mt-2.5 flex flex-wrap items-center gap-2">
    {#each shots as s, i (i)}
      <span class="shot relative inline-block">
        <img class="block h-12 rounded-md border border-border" src={s} alt="screenshot {i + 1}" />
        <button type="button" class="absolute -right-1.5 -top-1.5 h-[18px] w-[18px] cursor-pointer rounded-full border-0 bg-destructive text-[12px] leading-none text-white" aria-label="Remove screenshot" onclick={() => (shots = shots.filter((_, j) => j !== i))}>×</button>
      </span>
    {/each}
    <button type="button" class="cursor-pointer rounded-md border border-dashed border-border bg-secondary px-3 py-[7px] text-[12px] text-muted-foreground" onclick={() => shotInput.click()} disabled={isDemo}>+ screenshot</button>
    <input bind:this={shotInput} type="file" accept="image/*" hidden onchange={addShot} />
  </div>
  <div class="mt-2.5 flex items-center gap-3">
    <Button class="save px-4 py-2" disabled={saving || !ready || isDemo} onclick={save}>Save note</Button>
    {#if savedMsg}<span class="text-[12px] text-chart-2">{savedMsg}</span>{/if}
  </div>
</section>
