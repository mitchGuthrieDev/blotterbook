<script>
  // Day-note editor (A27; A32 added tags + screenshots). Persists per-day annotations through the
  // Store seam (getJournal/saveJournal — A29, reused verbatim). The store comes from context (A31):
  // real Store on app/staging, in-memory DemoStore on demo. Screenshots are gated by the shared
  // store.validShot allow-list (base64 images only — S15/S18). An empty save deletes the row.
  import { getContext } from 'svelte';
  import { emit } from '../../core.js';

  let { date, onsaved, onclose } = $props();
  const store = getContext('bb:store');

  let text = $state('');
  let tagsStr = $state('');
  let shots = $state([]);
  let saving = $state(false);
  let savedMsg = $state('');
  let ready = $state(false); // false until the day's record has loaded (avoids clobbering edits — see below)
  let shotInput;

  // Reload whenever the selected date changes. The load is async (IndexedDB), so we gate the form on
  // `ready` until it resolves — otherwise a fast edit could be overwritten by the in-flight load.
  $effect(() => {
    const d = date;
    savedMsg = '';
    ready = false;
    store.getJournal(d).then(rec => {
      text = rec.text || '';
      tagsStr = (rec.tags || []).join(', ');
      shots = rec.shots || [];
      ready = true;
    });
  });

  const readImage = file =>
    new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(file);
    });

  async function addShot(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    const url = await readImage(f);
    if (url && store.validShot(url)) shots = [...shots, url];
    else savedMsg = 'Only image screenshots are allowed.';
  }

  async function save() {
    saving = true;
    const tags = [...new Set(tagsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
    await store.saveJournal(date, { text, tags, shots });
    saving = false;
    savedMsg = text.trim() || tags.length || shots.length ? 'Saved' : 'Cleared';
    emit('note:saved', { date });
    onsaved();
  }
</script>

<section class="panel journal">
  <div class="phead">
    <h2>Day note · {date}</h2>
    <button type="button" class="x" onclick={onclose} aria-label="Close day note">×</button>
  </div>
  <textarea bind:value={text} rows="4" disabled={!ready} placeholder={`What happened on ${date}? Setups, mistakes, market context…`}></textarea>
  <input class="tags" type="text" bind:value={tagsStr} disabled={!ready} placeholder="tags (comma separated)" />
  <div class="shots">
    {#each shots as s, i (i)}
      <span class="shot">
        <img src={s} alt="screenshot {i + 1}" />
        <button type="button" class="rm" aria-label="Remove screenshot" onclick={() => (shots = shots.filter((_, j) => j !== i))}>×</button>
      </span>
    {/each}
    <button type="button" class="addshot" onclick={() => shotInput.click()}>+ screenshot</button>
    <input bind:this={shotInput} type="file" accept="image/*" hidden onchange={addShot} />
  </div>
  <div class="actions">
    <button type="button" class="save" onclick={save} disabled={saving || !ready}>Save note</button>
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
</style>
