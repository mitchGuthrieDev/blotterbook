<script lang="ts">
  // Changelog / "Blotterlog" (A69 — ex changelog.html + site/lib/changelog.js). Server-renders the
  // inline FALLBACK so the page has content for SEO + first paint, then onMount fetches the curated,
  // hash-cache-busted release notes (data/changelog.json, the prod-track source of truth) and swaps
  // them in. Svelte auto-escapes interpolations, so the old esc() helper is gone. Timeline styles are
  // page-specific (scoped); shared chrome/typography come from SiteShell.
  import { onMount } from 'svelte';
  import SiteShell from '../lib/SiteShell.svelte';

  interface Release {
    version: string;
    date: string;
    title: string;
    summary?: string;
    beta?: boolean;
    highlights?: string[];
  }

  /* F13: the inline fallback is a deliberately-minimal degraded-state notice for local dev / a failed
     fetch; it is INTENTIONALLY NOT kept in lockstep with releases (CH24), so its versions will lag the
     live changelog and that's expected, not a bug to chase. */
  const FALLBACK: Release[] = [
    {
      version: '0.14.2',
      date: '2026-06-26',
      title: 'Stability & security pass',
      summary:
        'A sweep of fixes from an internal audit — tightening up the calendar, your data, and the behind-the-scenes release machinery.',
    },
    {
      version: '0.12.0',
      date: '2026-06-24',
      beta: true,
      title: 'Beta released',
      summary: 'The first public Beta of Blotterbook — a fast, private, browser-based futures-trading journal.',
    },
  ];

  let releases = $state<Release[]>(FALLBACK);
  let live = $state(false);

  /* Render an ISO date (YYYY-MM-DD) as "Jun 26, 2026" without pulling in a tz/locale surprise —
     parse the parts directly so it reads the same everywhere. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return String(s || '');
    return MONTHS[+m[2] - 1] + ' ' + +m[3] + ', ' + m[1];
  }

  onMount(() => {
    // Curated release notes — a static, hash-cache-busted data file (no GitHub API).
    fetch('/data/changelog.json', { headers: { Accept: 'application/json' } })
      .then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ releases?: Release[] }>; // A88: type the boundary, no `any`
      })
      .then(d => {
        if (d && Array.isArray(d.releases) && d.releases.length) {
          releases = d.releases;
          live = true;
        }
      })
      .catch(() => {
        /* keep the fallback already rendered */
      });
  });
</script>

<SiteShell active="changelog">
  <p class="eyebrow">The Blotterlog</p>
  <h1>Changelog</h1>
  <p class="blurb">
    Release notes for <b>Blotterbook</b> — what shipped in each version, newest first. Tracks the live production app and demo.
  </p>
  <p class="font-mono text-[11.5px] text-faint mt-0 mb-1.5">
    {live ? 'Release notes · prod track' : 'Showing the last saved snapshot'}
  </p>

  <div class="log relative mt-9 pl-[26px]" id="log">
    {#each releases as r, i (r.version + r.date)}
      <div class="entry relative pb-[30px]" class:first={i === 0} class:beta={r.beta}>
        <div class="flex flex-wrap items-center gap-3 mb-[7px]">
          <span
            class="ver font-mono text-xs font-semibold rounded-[5px] border px-2 py-0.5 {r.beta
              ? 'text-dim bg-panel border-line'
              : 'text-primary bg-[rgba(106,160,255,0.12)] border-[rgba(106,160,255,0.28)]'}"
            >v{r.version}</span
          >
          <span class="font-mono text-[12.5px] text-dim">{fmtDate(r.date)}</span>
          {#if i === 0}<span
              class="font-mono text-[10.5px] uppercase tracking-[0.08em] text-green bg-[rgba(63,185,80,0.12)] rounded-[5px] px-2 py-0.5"
              >Latest</span
            >{/if}
        </div>
        <h3 class="text-[16.5px] m-0 font-semibold tracking-[-0.01em] leading-[1.4]">{r.title}</h3>
        {#if r.summary}<p class="text-dim text-[14.5px] leading-[1.6] mt-[7px] mb-0 max-w-[680px]">{r.summary}</p>{/if}
        {#if r.highlights && r.highlights.length}
          <ul class="highlights mt-2.5 mb-0 pl-[18px] max-w-[680px]">
            {#each r.highlights as h}<li class="text-dim text-sm leading-[1.55] mt-0 mb-[5px]">{h}</li>{/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
</SiteShell>

<style>
  /* timeline (changelog) — bespoke pseudo-elements (the rail gradient, node markers, and bullet
     marker color) stay scoped; everything else moved to Tailwind utilities on the elements. */
  .log::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: linear-gradient(180deg, var(--primary), rgba(201, 139, 255, 0.4), transparent);
  }
  .entry::before {
    content: '';
    position: absolute;
    left: -26px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--panel2);
    border: 2px solid var(--primary);
  }
  .entry.first::before {
    background: var(--primary);
    box-shadow: 0 0 0 4px rgba(106, 160, 255, 0.15);
  }
  .entry .highlights li::marker {
    color: var(--primary);
  }
</style>
