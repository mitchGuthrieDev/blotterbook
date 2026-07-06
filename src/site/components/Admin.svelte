<script lang="ts">
  // Internal admin panel (A69 — ex admin.html + site/lib/admin.js). Cloudflare Access–gated +
  // noindex (the robots meta stays in the template). A9: keeps a bespoke, marketing-free chrome —
  // SiteShell variant="admin" renders the trimmed nav/footer. The former admin.js DOM-building (which
  // used esc()) becomes Svelte reactive markup with auto-escaping; platformLabel still comes from the
  // shared core (format.ts). Admin-specific CSS is folded into the scoped block below.
  import { onMount } from 'svelte';
  import SiteShell from '../lib/SiteShell.svelte';
  import { platformLabel } from '../../lib/core/format.ts';
  import * as Select from '$lib/components/ui/select';

  // Shapes of the admin-only JSON this page fetches (status override, versions, backlog). Local to
  // this view — they aren't part of the shared pure-logic core (src/lib/core/types.ts).
  interface StatusInfo {
    mode?: string;
    label?: string;
    updatedAt?: number | string;
  }
  interface Versions {
    prod?: string;
    staging?: string;
    schemaVersion?: number;
  }
  interface BacklogItem {
    id: string;
    title: string;
    category: string;
    status: string;
    effort: string;
    priority?: string;
    completedDate?: string | null;
    partial?: boolean;
    prompt?: string;
    doneNote?: string | null;
  }
  interface BacklogData {
    items?: BacklogItem[];
    categories?: string[];
  }
  // A88: type the remaining /api/* JSON boundaries instead of letting r.json() flow in as `any`.
  interface AdminKeyResp {
    token?: string;
    exp?: number;
    email?: string;
  }
  interface ConfigResp {
    flags?: Record<string, boolean>;
    error?: string;
  }
  interface StatusSaveResp {
    mode?: string;
    label?: string;
    error?: string;
  }

  // The admin token (S3) is a live credential — kept in this page-session field only, never
  // localStorage (S10). autoKey() re-issues a fresh token on each load via Access.
  let adminKey = $state('');
  let label = $state('');

  // ---- live-status override ----
  let status = $state<StatusInfo | null>(null);
  let statusErr = $state(false);
  let amsg = $state({ text: '', kind: '' });
  function setMsg(text: string, kind = '') {
    amsg = { text, kind };
  }

  // ---- feature flags + versions ----
  const FLAGS = [{ key: 'maintenanceBanner', label: 'Show a maintenance banner in the app' }];
  let flags = $state<Record<string, boolean>>({});
  let flagmsg = $state({ text: '', kind: '' });
  let versions = $state<Versions | null>(null);
  let verErr = $state(false);
  let authnote = $state('');
  let stagemsg = $state({ text: '', kind: '' });

  // ---- backlog (read-only) ----
  let bkData = $state<BacklogData | null>(null);
  let bkArchive = $state<BacklogData | null>(null);
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
  const bkStatuses = $derived([...new Set(bkItems.map(i => i.status).filter(Boolean))].sort());
  const bkEfforts = $derived([...new Set(bkItems.map(i => i.effort).filter(Boolean))].sort());
  // A128: '' = "All" maps to a sentinel (bits-ui Select treats '' as no-value); items resolve labels.
  const FILT_ALL = '__all__';
  const statusItems = $derived([{ value: FILT_ALL, label: 'All' }, ...bkStatuses.map(s => ({ value: s, label: s }))]);
  const effortItems = $derived([{ value: FILT_ALL, label: 'All' }, ...bkEfforts.map(e => ({ value: e, label: e }))]);
  // Per-category counts always reflect full totals (project health), not the active filter.
  const bkCounts = $derived(
    bkCats.map((c: string) => {
      const its = bkItems.filter(i => i.category === c);
      const done = its.filter(i => i.status === 'done').length;
      const open = its.filter(i => i.status === 'open').length;
      const guard = its.filter(i => i.status === 'guardrail').length;
      const tot = done + open;
      return { cat: c, done, open, guard, tot, pct: tot ? Math.round((100 * done) / tot) : 0 };
    })
  );
  const tDone = $derived(bkCounts.reduce((a, c) => a + c.done, 0));
  const tOpen = $derived(bkCounts.reduce((a, c) => a + c.open, 0));
  const tGuard = $derived(bkCounts.reduce((a, c) => a + c.guard, 0));
  const bkGrand = $derived(tDone + tOpen);
  // The item list honors the status + effort filters, grouped by category.
  const bkGroups = $derived(
    bkCats
      .map((c: string) => ({
        cat: c,
        items: bkItems.filter(i => i.category === c && (!fStatus || i.status === fStatus) && (!fEffort || i.effort === fEffort)),
      }))
      .filter(g => g.items.length)
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
      .then(r => (r.ok ? (r.json() as Promise<AdminKeyResp>) : null))
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
      .then(r => r.json() as Promise<StatusInfo>)
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
      .then(r => r.json().then((d: StatusSaveResp) => ({ ok: r.ok, d })))
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
      .then(r => r.json() as Promise<ConfigResp>)
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
      .then(r => r.json() as Promise<Versions>)
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
      .then(r => r.json().then((d: ConfigResp) => ({ ok: r.ok, d })))
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
        return r.json() as Promise<BacklogData>;
      }),
      fetch('/data/backlog_archive.json', { cache: 'no-store' })
        .then(r => (r.ok ? (r.json() as Promise<BacklogData>) : null))
        .catch(() => null),
    ])
      .then(([b, arch]) => {
        bkData = b;
        bkArchive = arch;
        bkErr = false;
        // CH21: default to the actionable OPEN view if the filter is still at its initial "All".
        if (fStatus === '' && (b.items || []).concat((arch && arch.items) || []).some(i => i.status === 'open')) fStatus = 'open';
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
    Override the status pill shown on the marketing homepage. <b>Auto</b> hands control back to the automatic check (pings
    <code>/app/</code>); the others force a fixed state.
  </p>

  <p class="font-mono text-[13px] text-muted-foreground [&_b]:text-foreground">
    {#if statusErr}Current: unavailable (deploy on Cloudflare to use){:else if status}Current: <b>{status.mode || 'auto'}</b
      >{#if status.label}
        — “{status.label}”{/if}{#if status.updatedAt}
        · updated {new Date(status.updatedAt).toLocaleString()}{/if}{:else}Current: loading…{/if}
  </p>

  <p class="m-0 mb-[10px] min-h-[14px] font-mono text-[11.5px] text-chart-2">{authnote}</p>
  <div class="mx-0 mt-2 mb-1 flex flex-wrap items-end gap-[10px]">
    <div class="flex flex-col gap-[5px]">
      <label class="text-[10.5px] tracking-[0.07em] text-muted-foreground uppercase" for="label">Custom label (optional)</label>
      <input
        class="min-w-[240px] rounded-[7px] border border-border bg-secondary px-[10px] py-2 font-mono text-[13px] text-foreground outline-none focus:border-primary"
        type="text"
        id="label"
        maxlength="40"
        placeholder="e.g. Back at 5pm ET"
        bind:value={label}
      />
    </div>
  </div>

  <!-- The admin credential is auto-issued as a short-lived token via Cloudflare Access (S3/S4). This
       manual field is a tucked-away fallback: only needed off-Access or if the token didn't issue. -->
  <details class="advkey mx-0 mt-[6px] mb-1 rounded-[9px] border border-border bg-secondary px-3 py-0">
    <summary class="cursor-pointer list-none py-[10px] text-[12px] tracking-[0.04em] text-muted-foreground uppercase select-none"
      >Advanced — manual admin key</summary
    >
    <p class="m-0 mb-[10px] text-[12px] leading-[1.5] text-muted-foreground [&_code]:font-mono [&_code]:text-foreground">
      Auto-filled from Cloudflare Access. Enter the raw <code>ADMIN_KEY</code> here only if you're working off-Access or the token didn't issue.
    </p>
    <div class="m-0 mb-3 flex max-w-[320px] flex-col gap-[5px]">
      <label class="text-[10.5px] tracking-[0.07em] text-muted-foreground uppercase" for="adminkey">Admin key</label>
      <input
        class="rounded-[7px] border border-border bg-card px-[10px] py-2 font-mono text-[13px] text-foreground outline-none focus:border-primary"
        type="password"
        id="adminkey"
        placeholder="ADMIN_KEY"
        autocomplete="off"
        bind:value={adminKey}
      />
    </div>
  </details>

  <div class="mx-0 my-[14px] flex flex-wrap gap-[10px]">
    {#each MODES as md (md.m)}
      <button
        class="inline-flex cursor-pointer items-center gap-2 rounded-[9px] border border-border bg-secondary px-4 py-[10px] font-sans text-[13.5px] text-foreground hover:border-primary {(status?.mode ||
          'auto') === md.m
          ? 'border-primary bg-card'
          : ''}"
        data-mode={md.m}
        onclick={() => save(md.m)}
      >
        <span
          class="h-2 w-2 rounded-full {md.m === 'live'
            ? 'bg-chart-2'
            : md.m === 'offline'
              ? 'bg-destructive'
              : md.m === 'maintenance'
                ? 'bg-chart-4'
                : 'bg-primary'}"
        ></span>{md.label}
      </button>
    {/each}
  </div>
  <p
    class="mt-[10px] min-h-4 font-mono text-[12.5px] {amsg.kind === 'ok' ? 'text-chart-2' : amsg.kind === 'err' ? 'text-destructive' : ''}"
  >
    {amsg.text}
  </p>

  <h2>Staging environment</h2>
  <p>
    A 1:1 sandbox copy of the app on sample data, for trialling UI/behavior changes before they reach the main app. The page is gated by the
    admin key — this button carries it for you (sets a short-lived <code>bb_staging</code> cookie, then opens staging).
  </p>
  <div class="mx-0 my-[14px] flex flex-wrap gap-[10px]">
    <button
      class="inline-flex cursor-pointer items-center gap-2 rounded-[9px] border border-border bg-secondary px-4 py-[10px] font-sans text-[13.5px] text-foreground hover:border-primary"
      onclick={launchStaging}><span class="h-2 w-2 rounded-full bg-chart-4"></span>Launch staging env &rarr;</button
    >
  </div>
  <p
    class="mt-[10px] min-h-4 font-mono text-[12.5px] {stagemsg.kind === 'ok'
      ? 'text-chart-2'
      : stagemsg.kind === 'err'
        ? 'text-destructive'
        : ''}"
  >
    {stagemsg.text}
  </p>

  <h2>Platform versions</h2>
  <p>
    Read-only. Versions are <b>automated</b> (CH12): a merge to main derives the bump from the PR's conventional-commit type and changed
    paths, and writes <code>data/versions.json</code> — the single source of truth every surface reads at load. The platform phase (Beta → stable)
    is derived from the prod major. There's nothing to set here.
  </p>
  <p class="font-mono text-[13px] text-muted-foreground [&_b]:text-foreground">
    {#if verErr}Versions: unavailable{:else if versions}Prod (main + demo) <b>{versions.prod || '—'}</b> · Staging
      <b>{versions.staging || '—'}</b>
      · Platform <b>{platformLabel(versions.prod || '—')}</b>{:else}Versions: loading…{/if}
  </p>

  <h2>Feature flags</h2>
  <p>
    Server-side flags stored in KV; the app reads them at boot (<code>/api/config</code>). New flags must also be added to
    <code>DEFAULTS.flags</code> in <code>functions/api/config.js</code> (allow-list).
  </p>
  <div class="mx-0 my-[10px] flex flex-col gap-[9px]">
    {#each FLAGS as f (f.key)}
      <label class="flex cursor-pointer items-center gap-[10px] text-[13.5px] text-foreground"
        ><input class="h-4 w-4 accent-[var(--primary)]" type="checkbox" bind:checked={flags[f.key]} /><span>{f.label}</span></label
      >
    {/each}
  </div>
  <div class="mx-0 my-[14px] flex flex-wrap gap-[10px]">
    <button
      class="inline-flex cursor-pointer items-center gap-2 rounded-[9px] border border-border bg-secondary px-4 py-[10px] font-sans text-[13.5px] text-foreground hover:border-primary"
      onclick={saveFlags}><span class="h-2 w-2 rounded-full bg-primary"></span>Save flags</button
    >
  </div>
  <p
    class="mt-[10px] min-h-4 font-mono text-[12.5px] {flagmsg.kind === 'ok'
      ? 'text-chart-2'
      : flagmsg.kind === 'err'
        ? 'text-destructive'
        : ''}"
  >
    {flagmsg.text}
  </p>

  <h2>Backlog</h2>
  <p>
    Read-only view of the engineering backlog — active items from <code>data/backlog.json</code> merged with completed items archived in
    <code>data/backlog_archive.json</code> (filter by Status to see done items). Per-item prompts and done-notes live in the files but are not
    shown here.
  </p>
  <div class="mx-0 my-3 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-[10px]">
    {#each bkCounts as c (c.cat)}
      <div class="rounded-[9px] border border-border bg-secondary px-3 py-[10px]">
        <div class="mb-[6px] text-[10.5px] tracking-[0.05em] text-muted-foreground uppercase">{c.cat}</div>
        <div class="flex items-baseline gap-[7px] font-mono">
          <span class="text-[18px] font-semibold text-chart-2">{c.done}</span><span class="text-[12.5px] text-muted-foreground"
            >/ {c.tot} done</span
          >
          <span class="ml-auto text-[11.5px] text-chart-4"
            >{c.open} left{#if c.guard}
              · {c.guard} guard{/if}</span
          >
        </div>
        <div class="bkbar mt-2 h-[5px] overflow-hidden rounded-[3px] bg-line"><i use:barWidth={c.pct}></i></div>
      </div>
    {/each}
  </div>
  {#if bkData}
    <div class="mx-0 mt-1 mb-4 font-mono text-[13px] text-muted-foreground [&_b]:text-foreground">
      Overall: <b>{tDone}</b> done · <b>{tOpen}</b> remaining{#if tGuard}
        · {tGuard} guardrail{/if} · <b>{bkGrand ? Math.round((100 * tDone) / bkGrand) : 0}%</b>
      complete ({bkItems.length} items)
    </div>
  {/if}
  <div class="mx-0 mt-[14px] mb-[6px] flex flex-wrap items-end gap-[14px]">
    <div class="flex flex-col gap-[5px]">
      <span class="text-[10.5px] tracking-[0.07em] text-muted-foreground uppercase">Status</span>
      <Select.Root type="single" value={fStatus || FILT_ALL} onValueChange={v => (fStatus = v === FILT_ALL ? '' : v)} items={statusItems}>
        <Select.Trigger aria-label="Status" class="min-w-[150px]"><Select.Value /></Select.Trigger>
        <Select.Content>
          {#each statusItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-[5px]">
      <span class="text-[10.5px] tracking-[0.07em] text-muted-foreground uppercase">Effort</span>
      <Select.Root type="single" value={fEffort || FILT_ALL} onValueChange={v => (fEffort = v === FILT_ALL ? '' : v)} items={effortItems}>
        <Select.Trigger aria-label="Effort" class="min-w-[150px]"><Select.Value /></Select.Trigger>
        <Select.Content>
          {#each effortItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <button
      type="button"
      class="cursor-pointer rounded-[7px] border border-border bg-secondary px-3 py-2 font-sans text-[12.5px] text-muted-foreground hover:border-primary hover:text-foreground"
      onclick={clearFilters}>Clear filters</button
    >
    <span class="ml-auto self-center font-mono text-[11px] text-muted-foreground"
      >Counts above are full totals; filters narrow the list only.</span
    >
  </div>
  <div>
    {#each bkGroups as g (g.cat)}
      <div class="mx-0 mt-4 mb-1 text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase">{g.cat}</div>
      {#each g.items as i (i.id)}
        <div class="flex items-center gap-[10px] border-b border-border px-[2px] py-[7px] text-[13.5px]">
          <span class="min-w-9 font-mono text-[11.5px] text-muted-foreground">{i.id}</span>
          <span class="flex-1 {i.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}">{i.title}</span>
          <span class="font-mono text-[11px] text-muted-foreground">{i.effort}</span>
          <span
            class="rounded-full border px-2 py-[2px] font-mono text-[10px] tracking-[0.04em] uppercase {i.status === 'done'
              ? 'border-chart-2/40 text-chart-2'
              : i.status === 'open'
                ? 'border-chart-4/40 text-chart-4'
                : i.status === 'guardrail'
                  ? 'border-primary/40 text-primary'
                  : 'border-border text-muted-foreground'}">{badgeText(i.status)}</span
          >
        </div>
      {/each}
    {:else}
      {#if bkData}<div class="mx-0 mt-1 mb-4 font-mono text-[13px] text-muted-foreground">No items match these filters.</div>{/if}
    {/each}
  </div>
  <p class="mt-[10px] min-h-4 font-mono text-[12.5px] {bkErr ? 'text-destructive' : ''}">
    {bkErr ? 'Could not load data/backlog.json.' : ''}
  </p>
</SiteShell>

<style>
  /* advanced (tucked-away) manual admin-key fallback — disclosure-triangle pseudo-elements + the
     closed-collapse rule stay scoped (no Tailwind equivalent for ::before content / details state). */
  .advkey > summary::-webkit-details-marker {
    display: none;
  }
  .advkey > summary::before {
    content: '\25B8 ';
    color: var(--muted-foreground);
  }
  .advkey[open] > summary::before {
    content: '\25BE ';
  }
  /* explicitly hide content when closed — the field's display:flex would otherwise out-specify the
     UA rule that collapses <details>, leaking the field out of the box */
  .advkey:not([open]) > :not(summary) {
    display: none;
  }
  /* backlog progress-bar fill — width is driven through the CSSOM (--w via the barWidth action, A55),
     so this stays scoped rather than becoming a static utility. */
  .bkbar i {
    display: block;
    height: 100%;
    background: var(--chart-2);
    width: var(--w);
  }
</style>
