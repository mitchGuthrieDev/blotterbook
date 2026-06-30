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

<header
  class="sticky top-0 z-50 border-b border-border bg-background/86 backdrop-blur-[10px] backdrop-saturate-150"
>
  <nav class="nav relative mx-auto flex max-w-[1080px] items-center px-[22px] py-[13px]">
    <a
      class="wordmark inline-flex items-center gap-[9px] text-[16px] font-bold text-foreground no-underline hover:no-underline"
      href="index.html"
      ><span
        class="dot h-[9px] w-[9px] rounded-[2px] bg-[linear-gradient(135deg,var(--primary),var(--chart-3))]"
      ></span>Blotterbook</a
    >
    <input
      type="checkbox"
      id="navtoggle"
      class="navtoggle pointer-events-none absolute h-px w-px opacity-0"
      aria-label="Toggle navigation menu"
    />
    <div class="navlinks ml-[6px] flex-wrap gap-1">
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
    <a
      class="cta ml-auto rounded-[9px] bg-primary px-[14px] py-2 text-[13.5px] font-semibold text-primary-foreground no-underline hover:no-underline hover:brightness-[1.08]"
      href="/app/">Launch Blotterbook &rarr;</a
    >
    <label
      class="hamburger ml-auto h-9 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-border bg-card"
      for="navtoggle"
      title="Menu"
      ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></label
    >
  </nav>
</header>

<style>
  /* Layout/display props the responsive block below toggles stay scoped to avoid utility-vs-scoped
     specificity fights at the bespoke 760px breakpoint; the rest moved to Tailwind utilities. */
  .nav {
    gap: 16px;
  }
  .navlinks {
    display: flex;
  }
  .navlinks a {
    color: var(--muted-foreground);
    font-size: 13.5px;
    padding: 7px 11px;
    border-radius: 7px;
    text-decoration: none;
  }
  .navlinks a:hover {
    color: var(--foreground);
    background: var(--card);
    text-decoration: none;
  }
  .navlinks a.active {
    color: var(--foreground);
  }
  /* mobile menu (hamburger replaces the Launch button) */
  .hamburger {
    display: none;
  }
  .hamburger svg {
    width: 20px;
    height: 20px;
    stroke: var(--foreground);
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
  }
  .navtoggle:focus-visible ~ .hamburger {
    border-color: var(--primary);
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
      background: color-mix(in srgb, var(--background) 98%, transparent);
      backdrop-filter: saturate(150%) blur(10px);
      border-bottom: 1px solid var(--border);
      padding: 8px 16px 16px;
      margin: 0;
    }
    .navtoggle:checked ~ .navlinks {
      display: flex;
    }
    .navlinks a {
      font-size: 15px;
      padding: 12px 10px;
      border-bottom: 1px solid var(--border);
      border-left: none;
    }
    .navlinks a:last-child {
      border-bottom: none;
    }
    .navlinks a.navlaunch {
      display: block;
      color: var(--background);
      background: var(--primary);
      font-weight: 600;
      border-radius: 9px;
      margin-top: 10px;
      text-align: center;
    }
  }
</style>
