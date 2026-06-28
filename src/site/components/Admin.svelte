<script lang="ts">
  // Internal admin panel (A69 — ex admin.html + site/lib/admin.js). Cloudflare Access–gated +
  // noindex (the robots meta stays in the template). A9: keeps a bespoke, marketing-free chrome —
  // SiteShell variant="admin" renders the trimmed nav/footer. The former admin.js DOM-building (which
  // used esc()) becomes Svelte reactive markup with auto-escaping; platformLabel still comes from the
  // shared core (format.ts). Admin-specific CSS is folded into the scoped block below.
  import { onMount } from 'svelte';
  import SiteShell from '../lib/SiteShell.svelte';
  import { platformLabel } from '../../lib/format.ts';

  // The admin token (S3) is a live credential — kept in this page-session field only, never
  // localStorage (S10). autoKey() re-issues a fresh token on each load via Access.
  let adminKey = $state('');
  let label = $state('');

  // ---- live-status override ----
  let status = $state<any>(null);
  let statusErr = $state(false);
  let amsg = $state({ text: '', kind: '' });
  function setMsg(text: string, kind = '') {
    amsg = { text, kind };
  }

  // ---- feature flags + versions ----
  const FLAGS = [
    { key: 'showBetaAdapters', label: 'Show beta platform adapters in the upload picker' },
    { key: 'maintenanceBanner', label: 'Show a maintenance banner in the app' },
    { key: 'betaRibbon', label: 'Show a “Beta” badge in the app header' },
  ];
  let flags = $state<Record<string, boolean>>({});
  let flagmsg = $state({ text: '', kind: '' });
  let versions = $state<any>(null);
  let verErr = $state(false);
  let authnote = $state('');
  let stagemsg = $state({ text: '', kind: '' });

  // ---- backlog (read-only) ----
  let bkData = $state<any>(null);
  let bkArchive = $state<any>(null);
  let bkErr = $state(false);
  let fStatus = $state('');
  let fEffort = $state('');

  const MODES = [
    { m: 'auto', label: 'Auto-detect' },
    { m: 'live', label: 'Live' },
    { m: 'offline', label: 'Offline' },
    { m: 'maintenance', label: 'Maintenance' },
  ];

  const bkItems = $derived(bkData ? [...(bkData.items || []), ...((bkArchive && bkArchive.items) || [])] : []);
  const bkCats = $derived((bkData && bkData.categories) || []);
  const bkStatuses = $derived([...new Set(bkItems.map((i: any) => i.status).filter(Boolean))].sort());
  const bkEfforts = $derived([...new Set(bkItems.map((i: any) => i.effort).filter(Boolean))].sort());
  // Per-category counts always reflect full totals (project health), not the active filter.
  const bkCounts = $derived(
    bkCats.map((c: string) => {
      const its = bkItems.filter((i: any) => i.category === c);
      const done = its.filter((i: any) => i.status === 'done').length;
      const open = its.filter((i: any) => i.status === 'open').length;
      const guard = its.filter((i: any) => i.status === 'guardrail').length;
      const tot = done + open;
      return { cat: c, done, open, guard, tot, pct: tot ? Math.round((100 * done) / tot) : 0 };
    })
  );
  const tDone = $derived(bkCounts.reduce((a: number, c: any) => a + c.done, 0));
  const tOpen = $derived(bkCounts.reduce((a: number, c: any) => a + c.open, 0));
  const tGuard = $derived(bkCounts.reduce((a: number, c: any) => a + c.guard, 0));
  const bkGrand = $derived(tDone + tOpen);
  // The item list honors the status + effort filters, grouped by category.
  const bkGroups = $derived(
    bkCats
      .map((c: string) => ({
        cat: c,
        items: bkItems.filter((i: any) => i.category === c && (!fStatus || i.status === fStatus) && (!fEffort || i.effort === fEffort)),
      }))
      .filter((g: any) => g.items.length)
  );
  const badgeText = (s: string) => (s === 'done' ? 'done' : s === 'guardrail' ? 'guard' : 'open');

  // A21/A55: bar width via a CSS custom property set through the CSSOM (client-only action — never an
  // SSR'd inline style="", which CSP style-src 'self' would block). Mirrors the old admin.js setProperty.
  function barWidth(node: HTMLElement, pct: number) {
    node.style.setProperty('--w', pct + '%');
    return { update: (p: number) => node.style.setProperty('--w', p + '%') };
  }

  // Fetch with an 8s timeout so a hung/slow endpoint falls into its .catch instead of leaving a row
  // stuck forever on "loading…".
  function fetchT(url: string, opts: RequestInit = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const o: RequestInit = { ...opts };
    if (ctl) o.signal = ctl.signal;
    const t = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    return fetch(url, o).then(
      r => {
        if (t) clearTimeout(t);
        return r;
      },
      e => {
        if (t) clearTimeout(t);
        throw e;
      }
    );
  }

  // Reached through Cloudflare Access: fetch a SHORT-LIVED signed token (S3) — the raw ADMIN_KEY
  // never reaches the browser. Carried as x-admin-key for writes and in bb_staging for launching staging.
  function autoKey() {
    fetchT('/api/admin-key', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && d.token) {
          adminKey = d.token;
          const until = d.exp ? ' — expires ' + new Date(d.exp).toLocaleTimeString() : '';
          authnote = 'Authenticated' + (d.email ? ' as ' + d.email : '') + ' — admin token issued' + until + '.';
        }
      })
      .catch(() => {});
  }

  function loadStatus() {
    fetchT('/api/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        status = d;
        statusErr = false;
        if (d.label && !label) label = d.label;
      })
      .catch(() => {
        statusErr = true;
      });
  }

  function save(mode: string) {
    const key = (adminKey || '').trim();
    if (!key) {
      setMsg('Enter the admin key first.', 'err');
      return;
    }
    setMsg('Saving…');
    fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ mode, label: (label || '').trim() }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(res => {
        if (res.ok) {
          setMsg('Saved: ' + res.d.mode + (res.d.label ? ' (“' + res.d.label + '”)' : ''), 'ok');
          loadStatus();
        } else setMsg('Error: ' + (res.d.error || 'request failed'), 'err');
      })
      .catch(() => setMsg('Network error — is this deployed on Cloudflare?', 'err'));
  }

  function setFlagMsg(text: string, kind = '') {
    flagmsg = { text, kind };
  }
  function loadConfig() {
    fetchT('/api/config', { cache: 'no-store' })
      .then(r => r.json())
      .then(c => {
        const f = c.flags || {};
        const next: Record<string, boolean> = {};
        for (const fl of FLAGS) next[fl.key] = !!f[fl.key];
        flags = next;
      })
      .catch(() => setFlagMsg('Config unavailable (deploy on Cloudflare to use)', 'err'));
  }
  // CH12: read versions straight from the public source of truth (no server self-fetch).
  function loadVersions() {
    fetchT('/data/versions.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(v => {
        versions = v;
        verErr = false;
      })
      .catch(() => {
        verErr = true;
      });
  }
  function saveFlags() {
    const key = (adminKey || '').trim();
    if (!key) {
      setFlagMsg('Enter the admin key first.', 'err');
      return;
    }
    setFlagMsg('Saving…');
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ flags: $state.snapshot(flags) }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(res => {
        if (res.ok) {
          setFlagMsg('Saved', 'ok');
          loadConfig();
        } else setFlagMsg('Error: ' + (res.d.error || 'request failed'), 'err');
      })
      .catch(() => setFlagMsg('Network error — is this deployed on Cloudflare?', 'err'));
  }

  // Launch staging: carry the short-lived admin token to the gated page ONLY in the path-scoped
  // bb_staging cookie (S19 removed the ?k= fallback — a token in the URL leaks). Fails closed.
  function launchStaging() {
    const key = (adminKey || '').trim();
    if (key) {
      document.cookie = 'bb_staging=' + encodeURIComponent(key) + ';path=/app/;SameSite=Lax;Secure;max-age=3600';
      stagemsg = { text: '', kind: '' };
    } else {
      stagemsg = {
        text: 'No admin token in the key field yet — it’s issued via Access on load. Wait for the “Authenticated…” note, then retry.',
        kind: 'err',
      };
    }
    window.open('/app/staging.html', '_blank', 'noopener');
  }

  function loadBacklog() {
    // active backlog (open + guardrail) lives in backlog.json; completed (done) items in
    // backlog_archive.json. Fetch BOTH and merge. The archive is fail-soft.
    Promise.all([
      fetch('/data/backlog.json', { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch('/data/backlog_archive.json', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([b, arch]) => {
        bkData = b;
        bkArchive = arch;
        bkErr = false;
        // CH21: default to the actionable OPEN view if the filter is still at its initial "All".
        if (fStatus === '' && (b.items || []).concat((arch && arch.items) || []).some((i: any) => i.status === 'open')) fStatus = 'open';
      })
      .catch(() => {
        bkErr = true;
      });
  }
  function clearFilters() {
    fStatus = '';
    fEffort = '';
  }

  onMount(() => {
    autoKey();
    loadStatus();
    loadConfig();
    loadVersions();
    loadBacklog();
  });
</script>

<SiteShell variant="admin">
  <p class="eyebrow">Admin</p>
  <h1>Configuration</h1>
  <p class="blurb">
    Internal controls for Blotterbook. This page should be locked down with <b>Cloudflare Access</b>; changes also require the admin key
    below.
  </p>

  <div class="note warn">
    <b>Access-controlled.</b> Protect this page (and ideally <code>admin.blotterbook.com</code>) with Cloudflare Access. Writes additionally
    require the <code>ADMIN_KEY</code> secret, and the status is stored in the <code>STATUS_KV</code> namespace.
  </div>

  <h2>Homepage “Live” indicator</h2>
  <p>
    Override the status pill shown on the marketing homepage. <b>Auto</b> hands control back to the automatic check (pings <code>/app/</code>);
    the others force a fixed state.
  </p>

  <p class="curstate">
    {#if statusErr}Current: unavailable (deploy on Cloudflare to use){:else if status}Current: <b>{status.mode || 'auto'}</b>{#if status.label} — “{status.label}”{/if}{#if status.updatedAt} · updated {new Date(status.updatedAt).toLocaleString()}{/if}{:else}Current: loading…{/if}
  </p>

  <p class="authnote">{authnote}</p>
  <div class="adminkeyrow">
    <div class="fld">
      <label for="label">Custom label (optional)</label>
      <input type="text" id="label" maxlength="40" placeholder="e.g. Back at 5pm ET" bind:value={label} />
    </div>
  </div>

  <!-- The admin credential is auto-issued as a short-lived token via Cloudflare Access (S3/S4). This
       manual field is a tucked-away fallback: only needed off-Access or if the token didn't issue. -->
  <details class="advkey">
    <summary>Advanced — manual admin key</summary>
    <p class="advkey-note">
      Auto-filled from Cloudflare Access. Enter the raw <code>ADMIN_KEY</code> here only if you're working off-Access or the token didn't
      issue.
    </p>
    <div class="fld">
      <label for="adminkey">Admin key</label>
      <input type="password" id="adminkey" placeholder="ADMIN_KEY" autocomplete="off" bind:value={adminKey} />
    </div>
  </details>

  <div class="modes">
    {#each MODES as md (md.m)}
      <button class="modebtn" class:on={(status?.mode || 'auto') === md.m} data-mode={md.m} onclick={() => save(md.m)}>
        <span class="d"></span>{md.label}
      </button>
    {/each}
  </div>
  <p class="amsg {amsg.kind}">{amsg.text}</p>

  <h2>Staging environment</h2>
  <p>
    A 1:1 sandbox copy of the app on sample data, for trialling UI/behavior changes before they reach the main app. The page is gated by the
    admin key — this button carries it for you (sets a short-lived <code>bb_staging</code> cookie, then opens staging).
  </p>
  <div class="modes"><button class="modebtn" onclick={launchStaging}><span class="d warn"></span>Launch staging env &rarr;</button></div>
  <p class="amsg {stagemsg.kind}">{stagemsg.text}</p>

  <h2>Platform versions</h2>
  <p>
    Read-only. Versions are <b>automated</b> (CH12): a merge to main derives the bump from the PR's conventional-commit type and changed
    paths, and writes <code>data/versions.json</code> — the single source of truth every surface reads at load. The platform phase (Beta →
    stable) is derived from the prod major. There's nothing to set here.
  </p>
  <p class="curstate">
    {#if verErr}Versions: unavailable{:else if versions}Prod (main + demo) <b>{versions.prod || '—'}</b> · Staging <b>{versions.staging || '—'}</b> · Platform <b>{platformLabel(versions.prod || '—')}</b>{:else}Versions: loading…{/if}
  </p>

  <h2>Feature flags</h2>
  <p>
    Server-side flags stored in KV; the app reads them at boot (<code>/api/config</code>). New flags must also be added to
    <code>DEFAULTS.flags</code> in <code>functions/api/config.js</code> (allow-list).
  </p>
  <div class="flags">
    {#each FLAGS as f (f.key)}
      <label class="flagrow"><input type="checkbox" bind:checked={flags[f.key]} /><span>{f.label}</span></label>
    {/each}
  </div>
  <div class="modes"><button class="modebtn" onclick={saveFlags}><span class="d accent"></span>Save flags</button></div>
  <p class="amsg {flagmsg.kind}">{flagmsg.text}</p>

  <h2>Backlog</h2>
  <p>
    Read-only view of the engineering backlog — active items from <code>data/backlog.json</code> merged with completed items archived in
    <code>data/backlog_archive.json</code> (filter by Status to see done items). Per-item prompts and done-notes live in the files but are not
    shown here.
  </p>
  <div class="bkcounts">
    {#each bkCounts as c (c.cat)}
      <div class="bkcount">
        <div class="bk-cat">{c.cat}</div>
        <div class="bk-nums">
          <span class="bk-done">{c.done}</span><span class="bk-of">/ {c.tot} done</span>
          <span class="bk-rem">{c.open} left{#if c.guard} · {c.guard} guard{/if}</span>
        </div>
        <div class="bkbar"><i use:barWidth={c.pct}></i></div>
      </div>
    {/each}
  </div>
  {#if bkData}
    <div class="bktotal">
      Overall: <b>{tDone}</b> done · <b>{tOpen}</b> remaining{#if tGuard} · {tGuard} guardrail{/if} · <b>{bkGrand ? Math.round((100 * tDone) / bkGrand) : 0}%</b>
      complete ({bkItems.length} items)
    </div>
  {/if}
  <div class="bkfilters">
    <div class="fld">
      <label class="lbl" for="bk_fstatus">Status</label>
      <select id="bk_fstatus" bind:value={fStatus}>
        <option value="">All</option>
        {#each bkStatuses as s}<option value={s}>{s}</option>{/each}
      </select>
    </div>
    <div class="fld">
      <label class="lbl" for="bk_feffort">Effort</label>
      <select id="bk_feffort" bind:value={fEffort}>
        <option value="">All</option>
        {#each bkEfforts as e}<option value={e}>{e}</option>{/each}
      </select>
    </div>
    <button type="button" class="bkclear" onclick={clearFilters}>Clear filters</button>
    <span class="bkfnote">Counts above are full totals; filters narrow the list only.</span>
  </div>
  <div class="bklist">
    {#each bkGroups as g (g.cat)}
      <div class="bkgroup">{g.cat}</div>
      {#each g.items as i (i.id)}
        <div class="bkrow is-{i.status}">
          <span class="bk-id">{i.id}</span>
          <span class="bk-title">{i.title}</span>
          <span class="bk-eff">{i.effort}</span>
          <span class="bk-badge {i.status}">{badgeText(i.status)}</span>
        </div>
      {/each}
    {:else}
      {#if bkData}<div class="bktotal">No items match these filters.</div>{/if}
    {/each}
  </div>
  <p class="amsg {bkErr ? 'err' : ''}">{bkErr ? 'Could not load data/backlog.json.' : ''}</p>
</SiteShell>

<style>
  .adminkeyrow {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: flex-end;
    margin: 8px 0 4px;
  }
  .adminkeyrow .fld {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .adminkeyrow label {
    font-size: 10.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .adminkeyrow input {
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--txt);
    font-family: var(--mono);
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 7px;
    outline: none;
    min-width: 240px;
  }
  .adminkeyrow input:focus {
    border-color: var(--accent);
  }
  .modes {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 14px 0;
  }
  .modebtn {
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--panel2);
    color: var(--txt);
    font-family: inherit;
    font-size: 13.5px;
    padding: 10px 16px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .modebtn:hover {
    border-color: var(--accent);
  }
  .modebtn .d {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }
  .modebtn.on {
    border-color: var(--accent);
    background: var(--panel);
  }
  .modebtn[data-mode='live'] .d {
    background: var(--green);
  }
  .modebtn[data-mode='offline'] .d {
    background: var(--red);
  }
  .modebtn[data-mode='maintenance'] .d {
    background: var(--warn);
  }
  .modebtn[data-mode='auto'] .d {
    background: var(--accent);
  }
  .curstate {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--dim);
  }
  .curstate b {
    color: var(--txt);
  }
  .amsg {
    font-family: var(--mono);
    font-size: 12.5px;
    margin-top: 10px;
    min-height: 16px;
  }
  .amsg.ok {
    color: var(--green);
  }
  .amsg.err {
    color: var(--red);
  }
  .flags {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 10px 0;
  }
  .flagrow {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    color: var(--txt);
    cursor: pointer;
  }
  .flagrow input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .authnote {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--green);
    margin: 0 0 10px;
    min-height: 14px;
  }
  /* advanced (tucked-away) manual admin-key fallback */
  .advkey {
    margin: 6px 0 4px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel2);
    padding: 0 12px;
  }
  .advkey > summary {
    cursor: pointer;
    list-style: none;
    padding: 10px 0;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
    user-select: none;
  }
  .advkey > summary::-webkit-details-marker {
    display: none;
  }
  .advkey > summary::before {
    content: '\25B8 ';
    color: var(--faint);
  }
  .advkey[open] > summary::before {
    content: '\25BE ';
  }
  /* explicitly hide content when closed — our .fld{display:flex} below would otherwise out-specify
     the UA rule that collapses <details>, leaking the field out of the box */
  .advkey:not([open]) > :not(summary) {
    display: none;
  }
  .advkey .advkey-note {
    font-size: 12px;
    color: var(--dim);
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .advkey .advkey-note code {
    font-family: var(--mono);
    color: var(--txt);
  }
  .advkey .fld {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0 0 12px;
    max-width: 320px;
  }
  .advkey .fld label {
    font-size: 10.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .advkey .fld input {
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--txt);
    font-family: var(--mono);
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 7px;
    outline: none;
  }
  .advkey .fld input:focus {
    border-color: var(--accent);
  }
  /* backlog module */
  .bkcounts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
    margin: 12px 0;
  }
  .bkcount {
    border: 1px solid var(--line);
    background: var(--panel2);
    border-radius: 9px;
    padding: 10px 12px;
  }
  .bkcount .bk-cat {
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: 6px;
  }
  .bkcount .bk-nums {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-family: var(--mono);
  }
  .bkcount .bk-done {
    color: var(--green);
    font-size: 18px;
    font-weight: 600;
  }
  .bkcount .bk-of {
    color: var(--dim);
    font-size: 12.5px;
  }
  .bkcount .bk-rem {
    color: var(--warn);
    font-size: 11.5px;
    margin-left: auto;
  }
  .bkbar {
    height: 5px;
    border-radius: 3px;
    background: var(--line);
    margin-top: 8px;
    overflow: hidden;
  }
  .bkbar i {
    display: block;
    height: 100%;
    background: var(--green);
    width: var(--w);
  }
  .bktotal {
    margin: 4px 0 16px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--dim);
  }
  .bktotal b {
    color: var(--txt);
  }
  .bkgroup {
    margin: 16px 0 4px;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .bkrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 2px;
    border-bottom: 1px solid var(--line);
    font-size: 13.5px;
  }
  .bkrow .bk-id {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--dim);
    min-width: 36px;
  }
  .bkrow .bk-title {
    color: var(--txt);
    flex: 1;
  }
  .bkrow.is-done .bk-title {
    color: var(--dim);
    text-decoration: line-through;
  }
  /* backlog filters (F9) */
  .bkfilters {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: flex-end;
    margin: 14px 0 6px;
  }
  .bkfilters .fld {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .bkfilters label.lbl {
    font-size: 10.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .bkfilters select {
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--txt);
    font-family: inherit;
    font-size: 13px;
    padding: 7px 9px;
    border-radius: 7px;
    outline: none;
    min-width: 150px;
  }
  .bkfilters select:focus {
    border-color: var(--accent);
  }
  .bkfilters .bkclear {
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--panel2);
    color: var(--dim);
    font-family: inherit;
    font-size: 12.5px;
    padding: 8px 12px;
    border-radius: 7px;
  }
  .bkfilters .bkclear:hover {
    border-color: var(--accent);
    color: var(--txt);
  }
  .bkfilters .bkfnote {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
    margin-left: auto;
    align-self: center;
  }
  .bk-eff {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
  }
  .bk-badge {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--dim);
  }
  .bk-badge.done {
    color: var(--green);
    border-color: rgba(63, 185, 80, 0.4);
  }
  .bk-badge.open {
    color: var(--warn);
    border-color: rgba(227, 179, 65, 0.4);
  }
  .bk-badge.guardrail {
    color: var(--accent);
    border-color: rgba(106, 160, 255, 0.4);
  }
  /* A55/S18: extracted from former inline style="" attributes (mode-indicator dots). */
  .d.warn {
    background: var(--warn);
  }
  .d.accent {
    background: var(--accent);
  }
</style>
