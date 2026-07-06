<script lang="ts">
  // Changelog / "Blotterlog" (A69 — ex changelog.html + site/lib/changelog.js). Server-renders the
  // inline FALLBACK so the page has content for SEO + first paint, then onMount fetches the curated,
  // hash-cache-busted release notes (data/changelog.json, the prod-track source of truth) and swaps
  // them in. Svelte auto-escapes interpolations, so the old esc() helper is gone. Timeline styles are
  // page-specific (scoped); shared chrome/typography come from SiteShell.
  import { onMount } from 'svelte';
  import SiteShell from '../lib/SiteShell.svelte';
  import { MONTH_ABBR } from '../../lib/core/core.ts';

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

  /* F44 — changelog-email signup (double opt-in). The form POSTs same-origin to /api/subscribe
     (CSP form-action/connect-src 'self' hold). The endpoint is enumeration-safe, so we show one
     generic success regardless of whether the address was new. `flash` surfaces the confirm /
     unsubscribe outcomes the /api/confirm + /api/unsubscribe redirects carry back as query flags. */
  let email = $state('');
  let signupState = $state<'idle' | 'sending' | 'ok' | 'error'>('idle');
  let signupMessage = $state('');
  let flash = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function subscribe(e: SubmitEvent) {
    e.preventDefault();
    if (signupState === 'sending' || !email.trim()) return;
    signupState = 'sending';
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (r.ok) {
        signupState = 'ok';
        signupMessage = d.message || 'Check your inbox for a confirmation link.';
        email = '';
      } else {
        signupState = 'error';
        signupMessage = d.error || 'Something went wrong — please try again.';
      }
    } catch (_) {
      signupState = 'error';
      signupMessage = 'Network error — please try again.';
    }
  }

  /* Render an ISO date (YYYY-MM-DD) as "Jun 26, 2026" without pulling in a tz/locale surprise —
     parse the parts directly so it reads the same everywhere. A247: MONTH_ABBR is the core's single
     source (also used by report/analytics) — this used to be a verbatim local copy. */
  function fmtDate(s: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return String(s || '');
    return MONTH_ABBR[+m[2] - 1] + ' ' + +m[3] + ', ' + m[1];
  }

  onMount(() => {
    // Surface the confirm / unsubscribe outcome the Function redirects carry back as query flags (F44).
    const p = new URLSearchParams(location.search);
    if (p.get('subscribed'))
      flash = { kind: 'ok', text: 'Subscription confirmed — you are on the list. New releases will land in your inbox.' };
    else if (p.get('unsubscribed')) flash = { kind: 'ok', text: 'You have been unsubscribed. No more release emails will be sent.' };
    else if (p.get('subscribe') === 'error')
      flash = { kind: 'error', text: 'That confirmation link has expired or was already used. Sign up again below.' };

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
  <p class="font-mono text-[11.5px] text-muted-foreground mt-0 mb-1.5">
    {live ? 'Release notes · prod track' : 'Showing the last saved snapshot'}
  </p>

  {#if flash}
    <div
      class="mt-4 rounded-md border px-3.5 py-2.5 text-sm {flash.kind === 'ok'
        ? 'border-chart-2/40 bg-chart-2/12 text-foreground'
        : 'border-destructive/40 bg-destructive/12 text-foreground'}"
      role="status"
    >
      {flash.text}
    </div>
  {/if}

  <!-- F44: changelog-email signup (double opt-in). Get release notes by email — nothing else is sent. -->
  <section id="subscribe" class="mt-6 rounded-lg border border-border bg-card px-5 py-[18px]">
    <h2 class="text-[15px] font-semibold m-0 tracking-[-0.01em]">Get release notes by email</h2>
    <p class="text-muted-foreground text-[13.5px] leading-[1.55] mt-1.5 mb-3 max-w-[560px]">
      One short email when a new version ships — release notes only, no marketing, and no trade data ever leaves your browser. Double
      opt-in; unsubscribe in one click anytime.
    </p>
    {#if signupState === 'ok'}
      <p class="text-chart-2 text-sm font-medium m-0">{signupMessage}</p>
    {:else}
      <form class="flex flex-wrap items-center gap-2.5" onsubmit={subscribe}>
        <label class="sr-only" for="subscribe-email">Email address</label>
        <input
          id="subscribe-email"
          type="email"
          required
          autocomplete="email"
          placeholder="you@example.com"
          bind:value={email}
          disabled={signupState === 'sending'}
          class="min-w-[240px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={signupState === 'sending'}
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {signupState === 'sending' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </form>
      {#if signupState === 'error'}
        <p class="text-destructive text-[13px] mt-2 mb-0">{signupMessage}</p>
      {/if}
    {/if}
  </section>

  <div class="log relative mt-9 pl-[26px]" id="log">
    {#each releases as r, i (r.version + r.date)}
      <div class="entry relative pb-[30px]" class:first={i === 0} class:beta={r.beta}>
        <div class="flex flex-wrap items-center gap-3 mb-[7px]">
          <span
            class="ver font-mono text-xs font-semibold rounded-[5px] border px-2 py-0.5 {r.beta
              ? 'text-muted-foreground bg-card border-border'
              : 'text-primary bg-primary/12 border-primary/28'}">v{r.version}</span
          >
          <span class="font-mono text-[12.5px] text-muted-foreground">{fmtDate(r.date)}</span>
          {#if i === 0}<span
              class="font-mono text-[10.5px] uppercase tracking-[0.08em] text-chart-2 bg-chart-2/12 rounded-[5px] px-2 py-0.5">Latest</span
            >{/if}
        </div>
        <h3 class="text-[16.5px] m-0 font-semibold tracking-[-0.01em] leading-[1.4]">{r.title}</h3>
        {#if r.summary}<p class="text-muted-foreground text-[14.5px] leading-[1.6] mt-[7px] mb-0 max-w-[680px]">{r.summary}</p>{/if}
        {#if r.highlights && r.highlights.length}
          <ul class="highlights mt-2.5 mb-0 pl-[18px] max-w-[680px]">
            {#each r.highlights as h}<li class="text-muted-foreground text-sm leading-[1.55] mt-0 mb-[5px]">{h}</li>{/each}
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
    background: linear-gradient(180deg, var(--primary), color-mix(in srgb, var(--chart-3) 40%, transparent), transparent);
  }
  .entry::before {
    content: '';
    position: absolute;
    left: -26px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--secondary);
    border: 2px solid var(--primary);
  }
  .entry.first::before {
    background: var(--primary);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 15%, transparent);
  }
  .entry .highlights li::marker {
    color: var(--primary);
  }
</style>
