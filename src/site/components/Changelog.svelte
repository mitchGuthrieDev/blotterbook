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
        return r.json();
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
  <p class="clstatus">{live ? 'Release notes · prod track' : 'Showing the last saved snapshot'}</p>

  <div class="log" id="log">
    {#each releases as r, i (r.version + r.date)}
      <div class="entry" class:first={i === 0} class:beta={r.beta}>
        <div class="meta">
          <span class="ver">v{r.version}</span>
          <span class="date">{fmtDate(r.date)}</span>
          {#if i === 0}<span class="latest">Latest</span>{/if}
        </div>
        <h3>{r.title}</h3>
        {#if r.summary}<p class="summary">{r.summary}</p>{/if}
        {#if r.highlights && r.highlights.length}
          <ul class="highlights">
            {#each r.highlights as h}<li>{h}</li>{/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
</SiteShell>

<style>
  /* timeline (changelog) */
  .log {
    margin-top: 36px;
    position: relative;
    padding-left: 26px;
  }
  .log::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: linear-gradient(180deg, var(--accent), rgba(201, 139, 255, 0.4), transparent);
  }
  .entry {
    position: relative;
    padding: 0 0 30px;
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
    border: 2px solid var(--accent);
  }
  .entry.first::before {
    background: var(--accent);
    box-shadow: 0 0 0 4px rgba(106, 160, 255, 0.15);
  }
  .entry .meta {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 7px;
  }
  .entry .date {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--dim);
  }
  .entry .latest {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green);
    background: rgba(63, 185, 80, 0.12);
    border-radius: 5px;
    padding: 2px 8px;
  }
  /* F13: versioned release-notes entry — version badge, summary, highlight bullets */
  .entry .ver {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: rgba(106, 160, 255, 0.12);
    border: 1px solid rgba(106, 160, 255, 0.28);
    border-radius: 5px;
    padding: 2px 8px;
  }
  .entry.beta .ver {
    color: var(--dim);
    background: var(--panel);
    border-color: var(--line);
  }
  .entry h3 {
    font-size: 16.5px;
    margin: 0;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }
  .entry .summary {
    color: var(--dim);
    font-size: 14.5px;
    line-height: 1.6;
    margin: 7px 0 0;
    max-width: 680px;
  }
  .entry .highlights {
    margin: 10px 0 0;
    padding-left: 18px;
    max-width: 680px;
  }
  .entry .highlights li {
    color: var(--dim);
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 5px;
  }
  .entry .highlights li::marker {
    color: var(--accent);
  }
  .clstatus {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--faint);
    margin: 0 0 6px;
  }
</style>
