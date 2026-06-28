<script lang="ts">
  // Shared info-site nav (A69 — ex partials/nav.html + scripts/build-includes.mjs). Sticky header
  // with a CSS-only mobile menu (the #navtoggle checkbox + the `.navtoggle:checked ~ .navlinks`
  // rule below — no JS, so it works pre- and post-hydration). `active` highlights the matching link
  // (the old build-includes `active=KEY` marker); `variant="admin"` renders the trimmed internal-tool
  // nav (A9: admin keeps a bespoke, marketing-free chrome).
  interface Props {
    active?: string;
    variant?: 'full' | 'admin';
  }
  let { active = '', variant = 'full' }: Props = $props();

  const links = [
    { key: 'features', href: 'index.html#features', label: 'Features' },
    { key: 'platforms', href: 'index.html#platforms', label: 'Platforms' },
    { key: 'pricing', href: 'index.html#pricing', label: 'Pricing' },
    { key: 'faq', href: 'index.html#faq', label: 'FAQ' },
    { key: 'howto', href: 'howto.html', label: 'How To' },
    { key: 'roadmap', href: 'roadmap.html', label: 'Roadmap' },
    { key: 'changelog', href: 'changelog.html', label: 'Changelog' },
  ];
</script>

<header>
  <nav class="nav">
    <a class="wordmark" href="index.html"><span class="dot"></span>Blotterbook</a>
    <input type="checkbox" id="navtoggle" class="navtoggle" aria-label="Toggle navigation menu" />
    <div class="navlinks">
      {#if variant === 'admin'}
        <a href="index.html">Home</a>
        <a href="changelog.html">Changelog</a>
      {:else}
        {#each links as l (l.key)}
          <a data-nav={l.key} class:active={active === l.key} href={l.href}>{l.label}</a>
        {/each}
      {/if}
      <a class="navlaunch" href="/app/">Launch Blotterbook &rarr;</a>
    </div>
    <a class="cta" href="/app/">Launch Blotterbook &rarr;</a>
    <label class="hamburger" for="navtoggle" title="Menu"
      ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></label>
  </nav>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 50;
    backdrop-filter: saturate(150%) blur(10px);
    background: rgba(13, 16, 20, 0.86);
    border-bottom: 1px solid var(--line);
  }
  .nav {
    max-width: 1080px;
    margin: 0 auto;
    padding: 13px 22px;
    display: flex;
    align-items: center;
    gap: 16px;
    position: relative;
  }
  .wordmark {
    font-weight: 700;
    font-size: 16px;
    color: var(--txt);
    display: inline-flex;
    align-items: center;
    gap: 9px;
    text-decoration: none;
  }
  .wordmark:hover {
    text-decoration: none;
  }
  .wordmark .dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: linear-gradient(135deg, var(--accent), var(--take));
  }
  .navlinks {
    display: flex;
    gap: 4px;
    margin-left: 6px;
    flex-wrap: wrap;
  }
  .navlinks a {
    color: var(--dim);
    font-size: 13.5px;
    padding: 7px 11px;
    border-radius: 7px;
    text-decoration: none;
  }
  .navlinks a:hover {
    color: var(--txt);
    background: var(--panel);
    text-decoration: none;
  }
  .navlinks a.active {
    color: var(--txt);
  }
  .cta {
    margin-left: auto;
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
    font-size: 13.5px;
    padding: 8px 14px;
    border-radius: 9px;
    text-decoration: none;
  }
  .cta:hover {
    filter: brightness(1.08);
    text-decoration: none;
  }
  /* mobile menu (hamburger replaces the Launch button) */
  .navtoggle {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .hamburger {
    display: none;
    margin-left: auto;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 36px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel);
  }
  .hamburger svg {
    width: 20px;
    height: 20px;
    stroke: var(--txt);
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
  }
  .navtoggle:focus-visible ~ .hamburger {
    border-color: var(--accent);
  }
  .navlaunch {
    display: none;
  }
  /* Breakpoint scale (L1): xs 460 · sm 560 · cal 620 · md 760 · lg 900 — see app/app.css for the full table. */
  @media (max-width: 760px) {
    /* md: nav collapses to the hamburger menu */
    .nav {
      gap: 10px;
    }
    .cta {
      display: none;
    }
    .hamburger {
      display: inline-flex;
    }
    .navlinks {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      flex-direction: column;
      gap: 2px;
      background: rgba(13, 16, 20, 0.98);
      backdrop-filter: saturate(150%) blur(10px);
      border-bottom: 1px solid var(--line);
      padding: 8px 16px 16px;
      margin: 0;
    }
    .navtoggle:checked ~ .navlinks {
      display: flex;
    }
    .navlinks a {
      font-size: 15px;
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      border-left: none;
    }
    .navlinks a:last-child {
      border-bottom: none;
    }
    .navlinks a.navlaunch {
      display: block;
      color: var(--bg);
      background: var(--accent);
      font-weight: 600;
      border-radius: 9px;
      margin-top: 10px;
      text-align: center;
    }
  }
</style>
