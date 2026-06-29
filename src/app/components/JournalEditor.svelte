<script lang="ts">
  // Day-note editor (A27; A32 added tags + screenshots). Persists per-day annotations through the
  // Store seam (getJournal/saveJournal — A29, reused verbatim). The store comes from context (A31):
  // real Store on app/staging, in-memory DemoStore on demo. Screenshots are gated by the shared
  // store.validShot allow-list (base64 images only — S15/S18). An empty save deletes the row.
  import { getContext } from 'svelte';
  import { emit, PAGE_MODE } from '../../lib/core.ts';
  import { readImage } from '../lib/files.ts';
  import type { StoreLike } from '../../lib/types.ts';

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
  $effect(() => {
    const d = date;
    savedMsg = '';
    ready = false;
    store.getJournal(d).then(
      rec => {
        text = rec.text || '';
        tagsStr = (rec.tags || []).join(', ');
        shots = rec.shots || [];
        ready = true;
      },
      (err: unknown) => {
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

<section class="panel journal">
  <div class="phead">
    <h2>Day note · {date}</h2>
    <button type="button" class="x" onclick={onclose} aria-label="Close day note">×</button>
  </div>
  {#if isDemo}<p class="demonote">Day-notes are read-only in the demo — nothing is saved.</p>{/if}
  <textarea bind:value={text} rows="4" disabled={!ready || isDemo} placeholder={`What happened on ${date}? Setups, mistakes, market context…`}></textarea>
  <input class="tags" type="text" bind:value={tagsStr} disabled={!ready || isDemo} placeholder="tags (comma separated)" />
  <div class="shots">
    {#each shots as s, i (i)}
      <span class="shot">
        <img src={s} alt="screenshot {i + 1}" />
        <button type="button" class="rm" aria-label="Remove screenshot" onclick={() => (shots = shots.filter((_, j) => j !== i))}>×</button>
      </span>
    {/each}
    <button type="button" class="addshot" onclick={() => shotInput.click()} disabled={isDemo}>+ screenshot</button>
    <input bind:this={shotInput} type="file" accept="image/*" hidden onchange={addShot} />
  </div>
  <div class="actions">
    <button type="button" class="save" onclick={save} disabled={saving || !ready || isDemo}>Save note</button>
    {#if savedMsg}<span class="ok">{savedMsg}</span>{/if}
  </div>
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-top: 16px;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .x {
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover {
    color: var(--txt);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px;
    font-family: var(--sans);
    font-size: 13px;
    resize: vertical;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tags {
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 8px 10px;
    font-family: var(--sans);
    font-size: 13px;
  }
  .tags:focus {
    outline: none;
    border-color: var(--accent);
  }
  .shots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .shot {
    position: relative;
    display: inline-block;
  }
  .shot img {
    height: 48px;
    border-radius: 6px;
    border: 1px solid var(--line);
    display: block;
  }
  .shot .rm {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 0;
    background: var(--red);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .addshot {
    background: var(--panel2);
    color: var(--dim);
    border: 1px dashed var(--line);
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .save {
    background: var(--accent);
    color: #0d1014;
    border: 0;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .save:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ok {
    font-size: 12px;
    color: var(--green);
  }
  .demonote {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--warn);
  }
</style>
