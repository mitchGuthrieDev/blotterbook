<script lang="ts">
  // Marketing homepage (A69 — ex index.html + site/lib/home.js). Self-contained (A9: the homepage
  // keeps its BESPOKE nav + footer + CSS, deliberately NOT the shared SiteShell/Nav/Footer): section
  // anchors, the hero CTAs + hamburger, and a fuller legal paragraph differ structurally from the
  // info-site chrome. Shared colors come from the design tokens in src/styles/tailwind.css (imported
  // via the page's client entry); everything else is the scoped CSS below.
  //
  // The former home.js logic is ported into Svelte: header-border-on-scroll (svelte:window), the
  // CSS-only mobile menu (bound checkbox, closed on link tap), reveal-on-scroll (the `reveal` action),
  // the feature explorer (tablist with roving tabindex + selection-follows-focus), and the live-status
  // pill (admin override via /api/status, else auto-detect by pinging /app/). SSR renders the initial
  // state (first feature active, "Checking status…") so it matches hydration exactly.
  import { onMount } from 'svelte';

  // F38 — Stripe donations (LIVE). Donations are Stripe-dashboard-created PAYMENT LINKS: hosted,
  // full-redirect checkout pages opened in a new tab — no Stripe.js on this page, so ZERO CSP change
  // (see docs/stripe-assessment-r15.md). Live as of 2026-07-06 (legal pack counsel-reviewed). Both
  // tiers are ONE-TIME: a recurring "$50/year" would be a Stripe *Subscription* (needs a Customer,
  // billing portal, and webhook provisioning Blotterbook doesn't build until accounts/CloudStore —
  // R15 open question #2), and a Payment Link can't do recurring + "customer chooses amount" at once
  // anyway. A '' value keeps that tier's button in its "Donations open soon" state; a URL renders it
  // as a real link styled as a button.
  const DONATION_LINKS: { once25: string; tier50: string } = {
    once25: 'https://buy.stripe.com/fZubJ1cKE2tabyN2sb5wI00', // LIVE Payment Link — "Back the project — $25 (one-time)"
    tier50: '', // No second tier for now (owner decision 2026-07-06) — set a Payment Link URL to re-enable the $50 button.
  };

  // ---- header border on scroll ----
  let scrolled = $state(false);

  // ---- mobile menu (CSS-only via the bound checkbox; closed after tapping a link) ----
  let navOpen = $state(false);

  // ---- reveal-on-scroll (F-parity with the old IntersectionObserver) ----
  function reveal(node: HTMLElement) {
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  // ---- features explorer (F7): click/keyboard a feature to show its detail. Tab/tabpanel pattern
  // (B10): roving tabindex + selection-follows-focus. ----
  const FEATURES = [
    {
      title: 'Private by design',
      icon: '<path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z"/>',
      graphic:
        '<rect class="gx-panel" x="34" y="22" width="192" height="96" rx="9"/><line class="gx-grid" x1="34" y1="44" x2="226" y2="44"/><circle class="gx-faint" cx="48" cy="33" r="3.2"/><circle class="gx-faint" cx="60" cy="33" r="3.2"/><circle class="gx-faint" cx="72" cy="33" r="3.2"/><path class="gx-stroke-primary" d="M118 82 v-10 a12 12 0 0 1 24 0 v10"/><rect class="gx-primary" x="112" y="80" width="36" height="28" rx="4"/><circle class="gx-panel" cx="130" cy="92" r="3"/>',
      body: 'Your CSVs (or an ATAS X .xlsx export) are parsed and stored entirely in your browser via IndexedDB — one file or a whole batch, even mixed platforms. Trade data never leaves the page — nothing about your trading is uploaded.',
    },
    {
      title: 'True after-cost performance',
      icon: '<path d="M3 17l5-5 4 3 7-8"/><path d="M16 6h4v4"/>',
      graphic:
        '<line class="gx-grid" x1="22" y1="116" x2="238" y2="116"/><rect class="gx-green" x="30" y="40" width="34" height="76" rx="2"/><rect class="gx-red" x="82" y="56" width="34" height="22" rx="2"/><rect class="gx-red" x="134" y="74" width="34" height="16" rx="2"/><rect class="gx-red" x="186" y="86" width="18" height="12" rx="2"/><rect class="gx-take" x="206" y="86" width="34" height="30" rx="2"/>',
      body: 'Per-symbol, broker-aware commissions plus CME exchange, clearing, and NFA fees are modeled on every round turn — so Net and Take-home reflect what you actually keep, not gross PnL.',
    },
    {
      title: 'Location-based tax model',
      icon: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
      graphic:
        '<line class="gx-grid" x1="22" y1="116" x2="238" y2="116"/><rect class="gx-green" x="80" y="58" width="62" height="58" rx="2"/><rect class="gx-red" x="80" y="40" width="62" height="18" rx="2"/><circle class="gx-primary" cx="192" cy="52" r="15"/><path class="gx-primary" d="M179 60 L192 90 L205 60 Z"/><circle class="gx-panel" cx="192" cy="52" r="5.5"/>',
      body: "A Section 1256 estimate blends 60/40 long/short-term federal rates with your state's top marginal rate, applied only to positive net profit. Pick your state and see take-home update instantly.",
    },
    {
      title: 'Broker & data-feed comparison',
      icon: '<path d="M4 7h16M4 12h16M4 17h10"/>',
      graphic:
        '<line class="gx-grid" x1="22" y1="116" x2="238" y2="116"/><rect class="gx-primary" x="40" y="58" width="22" height="58" rx="2"/><rect class="gx-primary" x="68" y="74" width="22" height="42" rx="2"/><rect class="gx-take" x="120" y="44" width="22" height="72" rx="2"/><rect class="gx-take" x="148" y="66" width="22" height="50" rx="2"/><rect class="gx-green" x="200" y="84" width="22" height="32" rx="2"/>',
      body: 'Model AMP, EdgeClear, Discount Trading, Tradovate / NinjaTrader, Optimus, thinkorswim, Interactive Brokers, and TradeStation. Switch broker or data feed and watch the cost — and your net — change.',
    },
    {
      title: 'Equity curve & calendar',
      icon: '<path d="M3 12l4-4 4 4 4-6 4 8"/><path d="M3 20h18"/>',
      graphic:
        '<line class="gx-grid" x1="20" y1="116" x2="128" y2="116"/><path class="gx-area" d="M22 110 L48 92 L74 86 L100 60 L124 38 L124 116 L22 116 Z"/><path class="gx-line" d="M22 110 L48 92 L74 86 L100 60 L124 38"/><rect class="gx-panel" x="150" y="26" width="92" height="92" rx="7"/><rect class="gx-green" x="156" y="32" width="18" height="18" rx="3"/><rect class="gx-faint" x="176" y="32" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="32" width="18" height="18" rx="3"/><rect class="gx-red" x="216" y="32" width="18" height="18" rx="3"/><rect class="gx-red" x="156" y="52" width="18" height="18" rx="3"/><rect class="gx-green" x="176" y="52" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="52" width="18" height="18" rx="3"/><rect class="gx-faint" x="216" y="52" width="18" height="18" rx="3"/><rect class="gx-faint" x="156" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="176" y="72" width="18" height="18" rx="3"/><rect class="gx-red" x="196" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="216" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="156" y="92" width="18" height="18" rx="3"/><rect class="gx-faint" x="176" y="92" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="92" width="18" height="18" rx="3"/><rect class="gx-green" x="216" y="92" width="18" height="18" rx="3"/>',
      body: 'A cumulative performance graph with Gross / Net / Take-home overlays and hover detail, plus a Sunday-first monthly calendar of daily PnL with weekly summaries and day-notes. Dashboard modules can be shown, hidden, and reordered to match how you work.',
    },
    {
      title: 'Filters, journal & statistics',
      icon: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
      graphic:
        '<path class="gx-stroke-primary" d="M28 32 H118 L84 70 V108 L62 118 V70 Z"/><rect class="gx-panel" x="150" y="34" width="90" height="22" rx="5"/><rect class="gx-green" x="158" y="42" width="26" height="6" rx="3"/><rect class="gx-panel" x="150" y="62" width="90" height="22" rx="5"/><rect class="gx-primary" x="158" y="70" width="44" height="6" rx="3"/><rect class="gx-panel" x="150" y="90" width="90" height="22" rx="5"/><rect class="gx-take" x="158" y="98" width="18" height="6" rx="3"/>',
      body: 'Filter by date, symbol, side, session (RTH/ETH), and weekday. Keep day-notes per session. Group the blotter by day, symbol, or platform, and click any analytics bucket to drill into its trades. Read expectancy, profit factor, drawdown, streaks, and an illustrative Sharpe — all after costs.',
    },
  ];
  let activeFeat = $state(0);
  let featButtons: HTMLButtonElement[] = $state([]);

  function onFeatKeydown(e: KeyboardEvent) {
    const n = FEATURES.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (activeFeat + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (activeFeat - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next !== null) {
      e.preventDefault();
      activeFeat = next;
      featButtons[next]?.focus();
    }
  }

  // ---- live status pill: an admin override (set on the admin page) wins; otherwise auto-detect by
  // pinging the app. ----
  let pillState = $state<'' | 'live' | 'down' | 'maint'>('');
  let pillText = $state('Checking status…');
  function set(state: '' | 'live' | 'down' | 'maint', label: string) {
    pillState = state;
    pillText = label;
  }
  function ping() {
    fetch('/app/', { method: 'GET', cache: 'no-store' })
      .then(r => set(r.ok ? 'live' : 'down', r.ok ? 'Live' : 'Offline'))
      .catch(() => set('down', 'Offline'));
  }

  onMount(() => {
    fetch('/api/status', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (s && s.mode && s.mode !== 'auto') {
          const st = s.mode === 'live' ? 'live' : s.mode === 'maintenance' ? 'maint' : 'down';
          set(st, s.label || (s.mode === 'live' ? 'Live' : s.mode === 'maintenance' ? 'Maintenance' : 'Offline'));
        } else ping();
      })
      .catch(ping);
  });
</script>

<svelte:window onscroll={() => (scrolled = window.scrollY > 8)} />

<!-- A9: the homepage keeps a BESPOKE nav + footer (and their own CSS), intentionally NOT fed by the
     shared Nav/Footer. It's a marketing landing page: section anchors, the launch CTA + hamburger,
     and a fuller legal paragraph differ structurally from the info-site chrome. -->
<header
  id="hdr"
  class="sticky top-0 z-50 border-b backdrop-blur-[10px] backdrop-saturate-150 transition-[border-color,background] duration-[250ms] {scrolled
    ? 'border-border bg-background/86'
    : 'border-transparent bg-background/72'}"
>
  <!-- A145: header sized to match the app's topbar (h-12 / 48px, text-sm font-semibold wordmark). -->
  <nav class="nav relative mx-auto flex h-12 max-w-[1180px] items-center gap-[18px] px-[22px]">
    <a class="wordmark inline-flex items-center gap-[9px] text-sm font-semibold tracking-[0.01em] text-foreground" href="#home"
      ><span class="dot h-2 w-2 rounded-[2px] bg-[linear-gradient(135deg,var(--primary),var(--chart-3))]"></span>Blotterbook</a
    >
    <input
      type="checkbox"
      id="navtoggle"
      class="navtoggle pointer-events-none absolute h-px w-px opacity-0"
      aria-label="Toggle navigation menu"
      bind:checked={navOpen}
    />
    <div class="navlinks ml-2 flex flex-wrap gap-1" role="presentation" onclick={() => (navOpen = false)}>
      <a href="#features">Features</a>
      <a href="#platforms">Platforms</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      <a href="howto.html">How&nbsp;To</a>
      <a href="roadmap.html">Roadmap</a>
      <a href="changelog.html">Changelog</a>
      <a class="navlaunch" href="/app/">Launch Blotterbook &rarr;</a>
    </div>
    <div class="navcta ml-auto flex items-center gap-[10px]">
      <a
        class="btn-primary inline-flex items-center gap-[7px] rounded-[9px] bg-primary px-4 py-[9px] text-[13.5px] font-semibold text-primary-foreground transition-[filter,transform] duration-150 hover:translate-y-[-1px] hover:brightness-[1.08]"
        href="/app/">Launch Blotterbook &rarr;</a
      >
    </div>
    <label
      class="hamburger ml-auto hidden h-9 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-border bg-card"
      for="navtoggle"
      title="Menu"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5 fill-none stroke-txt stroke-2 [stroke-linecap:round]"
        ><path d="M4 7h16M4 12h16M4 17h16" /></svg
      >
    </label>
  </nav>
</header>

<!-- ============ HERO / MAIN LANDING (A274 refresh) ============
     Left-aligned hero (matches the rest of the page's section headers) + a device-framed live-P&L
     dashboard, translated from the 21st.dev "Efferd" hero-3 reference into our tokens/CSP rules:
     no external screenshot (single dark theme, own synthetic panel), no inline style="" (mask +
     SVG strokes are scoped CSS), Geist Mono, greyscale chrome with color only in the data layer. -->
<section id="home" class="relative flex scroll-mt-0 flex-col overflow-hidden px-[22px] pb-[72px] pt-[96px]">
  <div class="mx-auto w-full max-w-[1180px]">
    <div class="flex max-w-[660px] flex-col items-start gap-[22px]">
      <!-- announcement chip (the reference's "NOW …" pill → a real Blotterbook announcement) -->
      <a
        class="rise r1 group inline-flex w-fit items-center gap-[10px] rounded-md border border-border bg-card px-[6px] py-[5px] text-[12.5px] text-muted-foreground shadow-[0_1px_0_rgba(0,0,0,0.3)] transition-colors hover:border-ring"
        href="#pricing"
      >
        <span
          class="rounded-[3px] border border-border bg-popover px-[6px] py-[2px] font-mono text-[10.5px] tracking-[0.14em] text-foreground"
          >NEW</span
        >
        <span>Cloud sync is live — end&#8209;to&#8209;end encrypted</span>
        <span class="h-4 w-px flex-none bg-border"></span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          class="h-[13px] w-[13px] flex-none fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] transition-transform duration-150 group-hover:translate-x-[2px]"
          ><path d="M5 12h14M13 6l6 6-6 6" /></svg
        >
      </a>

      <h1 class="rise r2 m-0 text-balance text-[clamp(2.4rem,5.4vw,3.6rem)] font-medium leading-[1.04] tracking-[-0.02em]">
        Know what you actually <span class="text-muted-foreground">keep.</span>
      </h1>

      <p
        class="rise r3 m-0 max-w-[560px] text-[clamp(15px,1.7vw,18px)] leading-[1.6] text-muted-foreground [&>b]:font-medium [&>b]:text-foreground"
      >
        A local-first trading journal for futures traders. Import your broker CSVs — <b>parsed in your browser, never uploaded</b> — and see Gross,
        Net, and Take-home after commissions, exchange fees, and taxes.
      </p>

      <div class="rise r4 flex flex-wrap items-center gap-3 pt-1">
        <a
          class="inline-flex items-center gap-[9px] rounded-[11px] bg-primary px-7 py-[13px] text-[15px] font-semibold text-primary-foreground transition-[filter,transform] duration-150 hover:translate-y-[-1px] hover:brightness-[1.08]"
          href="/app/"
          >Launch Blotterbook<svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="h-4 w-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            ><path d="M5 12h14M13 6l6 6-6 6" /></svg
          ></a
        >
        <a
          class="inline-flex items-center gap-2 rounded-[11px] border border-input bg-input/30 px-6 py-[12px] text-[15px] font-medium text-foreground transition-[border-color,background] duration-150 hover:border-ring hover:bg-accent"
          href="/app/demo.html"
          ><svg viewBox="0 0 24 24" aria-hidden="true" class="h-[15px] w-[15px] flex-none fill-current"><path d="M6 4l14 8-14 8z" /></svg
          >Try the demo</a
        >
      </div>

      <div class="rise r5 flex flex-wrap items-center gap-x-[18px] gap-y-2 pt-1 text-[12.5px] text-muted-foreground">
        <span
          class="livepill inline-flex items-center gap-2 {pillState === 'live' || pillState === 'maint'
            ? 'text-foreground'
            : 'text-muted-foreground'}"
          title="Checks whether the live Blotterbook app is responding"
        >
          <span
            class="livedot relative h-2 w-2 flex-none rounded-full {pillState === 'live'
              ? 'bg-chart-2 livedot-live'
              : pillState === 'down'
                ? 'bg-destructive'
                : pillState === 'maint'
                  ? 'bg-chart-4'
                  : 'bg-faint'}"
          ></span>{pillText}
        </span>
        <span class="inline-flex items-center gap-[6px]"
          ><svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="h-[13px] w-[13px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            ><path d="M20 6L9 17l-5-5" /></svg
          >No account needed</span
        >
        <span class="inline-flex items-center gap-[6px]"
          ><svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="h-[13px] w-[13px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            ><path d="M20 6L9 17l-5-5" /></svg
          >Nothing leaves your browser</span
        >
      </div>
    </div>
  </div>

  <!-- device-framed live-P&L dashboard — a synthetic panel (swappable for a real capture later),
       single dark theme, bottom-masked into the page. Chrome greyscale; color only in the data. -->
  <div class="showcase rise r6 relative mx-auto mt-[52px] w-full max-w-[1180px]">
    <div class="relative rounded-[10px] border border-border bg-background p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] ring-1 ring-card">
      <div
        class="grid min-h-[440px] grid-cols-[184px_1fr] overflow-hidden rounded-[6px] border border-border bg-background max-[820px]:grid-cols-1"
      >
        <aside class="flex flex-col gap-[3px] border-r border-border bg-card p-3 max-[820px]:hidden" aria-hidden="true">
          <div class="flex items-center gap-2 px-[6px] pb-3 pt-1 text-[12.5px] font-semibold">
            <span class="h-2 w-2 flex-none rounded-[2px] bg-[linear-gradient(135deg,var(--primary),var(--chart-3))]"></span>Acme Trading
          </div>
          <span class="dnav on"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              ><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect
                x="14"
                y="12"
                width="7"
                height="9"
              /><rect x="3" y="16" width="7" height="5" /></svg
            >Dashboard</span
          >
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              ><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg
            >Calendar</span
          >
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              ><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg
            >Analytics</span
          >
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              ><path d="M4 6h16M4 12h16M4 18h10" /></svg
            >Blotter</span
          >
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              ><path d="M14 3v5h5" /><path d="M6 3h8l5 5v13H6z" /></svg
            >Reports</span
          >
          <span class="mt-3 px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground opacity-70">Data</span>
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              ><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /></svg
            >CSV Library</span
          >
          <span class="dnav"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              ><path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20" /></svg
            >Account</span
          >
        </aside>
        <div class="flex flex-col gap-[14px] p-4">
          <div class="flex items-center gap-[10px]">
            <span class="text-[13px] font-semibold">Dashboard</span>
            <div class="ml-auto flex overflow-hidden rounded-[5px] border border-border text-[11px]">
              <span class="px-[10px] py-[4px] text-muted-foreground">Gross</span>
              <span class="bg-accent px-[10px] py-[4px] text-foreground">Net</span>
              <span class="px-[10px] py-[4px] text-muted-foreground">Take-home</span>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-[10px] max-[820px]:grid-cols-2">
            <div class="rounded-[6px] border border-border bg-card p-3">
              <div class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Net P&amp;L</div>
              <div class="mt-[5px] text-[19px] font-semibold text-chart-2 [font-variant-numeric:tabular-nums]">+$18,432</div>
              <div class="mt-[3px] text-[10.5px] text-muted-foreground">+12.4% after costs</div>
            </div>
            <div class="rounded-[6px] border border-border bg-card p-3">
              <div class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Win rate</div>
              <div class="mt-[5px] text-[19px] font-semibold [font-variant-numeric:tabular-nums]">58.3%</div>
              <div class="mt-[3px] text-[10.5px] text-muted-foreground">412 trades · 240W</div>
            </div>
            <div class="rounded-[6px] border border-border bg-card p-3">
              <div class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Take-home</div>
              <div class="mt-[5px] text-[19px] font-semibold text-chart-3 [font-variant-numeric:tabular-nums]">+$13,190</div>
              <div class="mt-[3px] text-[10.5px] text-muted-foreground">after §1256 tax est.</div>
            </div>
            <div class="rounded-[6px] border border-border bg-card p-3">
              <div class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Total costs</div>
              <div class="mt-[5px] text-[19px] font-semibold text-destructive [font-variant-numeric:tabular-nums]">&#8722;$2,847</div>
              <div class="mt-[3px] text-[10.5px] text-muted-foreground">commissions + fees</div>
            </div>
          </div>
          <div class="flex flex-1 flex-col gap-2 rounded-[6px] border border-border bg-card p-[14px]">
            <div class="flex items-center gap-[14px]">
              <span class="text-[12px] font-semibold">Equity curve</span>
              <span class="ml-auto flex flex-wrap gap-x-[14px] gap-y-1 text-[10.5px] text-muted-foreground">
                <span class="inline-flex items-center gap-[5px]"
                  ><span class="inline-block h-[2px] w-[9px] rounded-full bg-chart-1"></span>Gross</span
                >
                <span class="inline-flex items-center gap-[5px]"
                  ><span class="inline-block h-[2px] w-[9px] rounded-full bg-chart-2"></span>Net</span
                >
                <span class="inline-flex items-center gap-[5px]"
                  ><span class="inline-block h-[2px] w-[9px] rounded-full bg-chart-3"></span>Take-home</span
                >
              </span>
            </div>
            <svg
              class="h-auto w-full"
              viewBox="0 0 920 240"
              preserveAspectRatio="none"
              role="img"
              aria-label="Cumulative equity curve — Gross, Net, and Take-home rising over time"
            >
              <line class="eq-grid" x1="40" y1="55" x2="900" y2="55" />
              <line class="eq-grid" x1="40" y1="110" x2="900" y2="110" />
              <line class="eq-grid" x1="40" y1="165" x2="900" y2="165" />
              <line class="eq-baseline" x1="40" y1="220" x2="900" y2="220" />
              <path
                class="eq-net-area"
                d="M40,196 118,184 196,200 274,166 352,172 430,140 508,150 586,112 664,122 742,86 820,96 898,60 898,220 40,220 Z"
              />
              <polyline
                class="eq-gross"
                points="40,178 118,166 196,182 274,146 352,152 430,120 508,128 586,90 664,100 742,62 820,72 898,38"
              />
              <polyline
                class="eq-net"
                points="40,196 118,184 196,200 274,166 352,172 430,140 508,150 586,112 664,122 742,86 820,96 898,60"
              />
              <polyline
                class="eq-take"
                points="40,208 118,198 196,212 274,180 352,188 430,158 508,168 586,134 664,144 742,110 820,120 898,86"
              />
              <circle class="eq-dot" cx="898" cy="60" r="3.5" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============ FEATURES ============ -->
<section id="features" class="flex min-h-screen scroll-mt-0 flex-col justify-center px-[22px] pb-[72px] pt-[96px]">
  <div class="inner reveal mx-auto w-full max-w-[1180px]" use:reveal>
    <p class="mb-[14px] font-mono text-[12px] uppercase tracking-[0.16em] text-primary">Features</p>
    <h2 class="h2 mb-[14px] text-[clamp(26px,4vw,40px)] font-bold leading-[1.12] tracking-[-0.02em]">
      Everything in one private dashboard
    </h2>
    <p class="mb-2 max-w-[680px] text-[clamp(15px,1.6vw,17px)] leading-[1.6] text-muted-foreground">
      Blotterbook turns a raw broker export into an honest picture of your trading — gross, net of every fee, and after an estimated tax
      bill. Nothing about your trades is uploaded — it all runs in your browser.
    </p>

    <!-- condensed use-cases, horizontal -->
    <div class="uc-row mt-[30px] grid grid-cols-4 gap-[14px] max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
      <div
        class="ucx relative overflow-hidden rounded-[12px] border border-border bg-card p-4 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[linear-gradient(180deg,var(--primary),var(--chart-3))] before:content-['']"
      >
        <p class="mb-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-chart-3">Cost intelligence</p>
        <h3 class="mb-[6px] text-[14.5px] font-semibold leading-[1.25] tracking-[-0.01em]">Brokers &amp; feeds vs. real PnL</h3>
        <p class="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">
          Flip commission tiers and data feeds; watch your net move across your real history.
        </p>
      </div>
      <div
        class="ucx relative overflow-hidden rounded-[12px] border border-border bg-card p-4 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[linear-gradient(180deg,var(--primary),var(--chart-3))] before:content-['']"
      >
        <p class="mb-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-chart-3">Tax planning</p>
        <h3 class="mb-[6px] text-[14.5px] font-semibold leading-[1.25] tracking-[-0.01em]">Location-based estimates</h3>
        <p class="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">
          A Section 1256 blend on positive net profit, by state — know it long before April.
        </p>
      </div>
      <div
        class="ucx relative overflow-hidden rounded-[12px] border border-border bg-card p-4 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[linear-gradient(180deg,var(--primary),var(--chart-3))] before:content-['']"
      >
        <p class="mb-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-chart-3">Business budgeting</p>
        <h3 class="mb-[6px] text-[14.5px] font-semibold leading-[1.25] tracking-[-0.01em]">Break-even before you trade</h3>
        <p class="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">
          Subscriptions + commissions become a break-even-per-trade and a clear cost waterfall.
        </p>
      </div>
      <div
        class="ucx relative overflow-hidden rounded-[12px] border border-border bg-card p-4 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[linear-gradient(180deg,var(--primary),var(--chart-3))] before:content-['']"
      >
        <p class="mb-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-chart-3">Discipline &amp; review</p>
        <h3 class="mb-[6px] text-[14.5px] font-semibold leading-[1.25] tracking-[-0.01em]">Journal every session</h3>
        <p class="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">
          Day-notes, equity-curve markup, and stats by session and weekday to find your edge.
        </p>
      </div>
    </div>

    <!-- clickable feature list (left) + detail (right) -->
    <div class="feat-explorer mt-[18px] grid grid-cols-1 items-stretch gap-[18px] min-[761px]:grid-cols-[minmax(0,360px)_1fr]">
      <div class="feat-list flex flex-col gap-2" role="tablist" aria-label="Feature explorer" aria-orientation="vertical">
        {#each FEATURES as f, i (f.title)}
          <button
            type="button"
            class="feat-item flex w-full cursor-pointer appearance-none items-center gap-[13px] rounded-[12px] border bg-card px-4 py-[14px] text-left text-foreground transition-[border-color,background,transform] duration-[180ms] hover:translate-x-[2px] hover:border-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {activeFeat ===
            i
              ? 'is-active border-primary bg-secondary'
              : 'border-border'}"
            role="tab"
            id="feattab-{i}"
            aria-controls="featDetail"
            aria-selected={activeFeat === i}
            tabindex={activeFeat === i ? 0 : -1}
            bind:this={featButtons[i]}
            onclick={() => (activeFeat = i)}
            onkeydown={onFeatKeydown}
          >
            <span class="ficon flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-primary/12"
              ><svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="h-[18px] w-[18px] fill-none stroke-primary stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]"
                >{@html f.icon}</svg
              ></span
            ><span class="text-[14.5px] font-semibold tracking-[-0.01em]">{f.title}</span>
          </button>
        {/each}
      </div>
      <div
        class="feat-detail flex flex-col justify-center rounded-[14px] border border-border bg-card px-[30px] py-7"
        id="featDetail"
        role="tabpanel"
        tabindex="0"
        aria-live="polite"
        aria-labelledby="feattab-{activeFeat}"
      >
        <svg
          class="feat-graphic mb-5 h-auto w-full max-w-[320px] rounded-[12px] border border-border bg-secondary p-[6px]"
          viewBox="0 0 260 140"
          role="img"
          aria-label="{FEATURES[activeFeat].title} — illustration">{@html FEATURES[activeFeat].graphic}</svg
        >
        <h3 class="mb-[11px] text-[21px] font-semibold tracking-[-0.015em]">{FEATURES[activeFeat].title}</h3>
        <p class="m-0 max-w-[54ch] text-[15px] leading-[1.7] text-muted-foreground">{FEATURES[activeFeat].body}</p>
      </div>
    </div>

    <div
      class="dual-pitch mt-[30px] inline-flex flex-wrap items-center gap-[14px] rounded-[11px] border border-border bg-card px-[18px] py-[14px] text-[14px] text-muted-foreground [&_b]:text-foreground"
    >
      <span
        ><b>The pitch:</b> profit calculator <span class="font-mono text-muted-foreground">&amp;</span> budgeting tool
        <span class="font-mono text-muted-foreground">+</span> a private trade journal — without a single trade leaving your browser.</span
      >
    </div>
  </div>
</section>

<!-- ============ SUPPORTED PLATFORMS ============ -->
<section id="platforms" class="flex min-h-screen scroll-mt-0 flex-col justify-center px-[22px] pb-[72px] pt-[96px]">
  <div class="inner reveal mx-auto w-full max-w-[1180px]" use:reveal>
    <p class="mb-[14px] font-mono text-[12px] uppercase tracking-[0.16em] text-primary">Supported platforms</p>
    <h2 class="h2 mb-[14px] text-[clamp(26px,4vw,40px)] font-bold leading-[1.12] tracking-[-0.02em]">
      Bring trades from the platform you already use
    </h2>
    <p class="mb-2 max-w-[680px] text-[clamp(15px,1.6vw,17px)] leading-[1.6] text-muted-foreground">
      Blotterbook auto-detects your export's format and normalizes it — your broker is a separate, cost-only setting. Import one file or a
      whole batch, even mixing platforms — each file gets its own detection status. <b>TradingView</b>,
      <b>Tradovate&nbsp;/&nbsp;NinjaTrader</b>,
      <b>Quantower</b>, and <b>ATAS&nbsp;X</b> (a single .xlsx export) are verified against real exports; the rest are in <b>beta</b>, built
      from each platform's documented format and exercised with synthetic test data. Step-by-step export guides live in the
      <a href="howto.html">How&nbsp;To</a>.
    </p>
    <ul
      class="plat-grid mt-[34px] grid list-none grid-cols-3 gap-3 p-0 max-[760px]:grid-cols-2 max-[460px]:grid-cols-1"
      aria-label="Supported trading platforms and test status"
    >
      <li>
        <a
          class="plat verified flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-tradingview"
          ><span
            class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-2 shadow-[0_0_0_3px_color-mix(in_srgb,var(--chart-2)_15%,transparent)]"
            aria-hidden="true"
          ></span><b class="flex-1 text-[15px] font-semibold">TradingView</b><span class="pstate font-mono text-[10.5px] text-chart-2"
            >Verified · real data</span
          ></a
        >
      </li>
      <li>
        <a
          class="plat verified flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-tradovate"
          ><span
            class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-2 shadow-[0_0_0_3px_color-mix(in_srgb,var(--chart-2)_15%,transparent)]"
            aria-hidden="true"
          ></span><b class="flex-1 text-[15px] font-semibold">Tradovate / NinjaTrader</b><span
            class="pstate font-mono text-[10.5px] text-chart-2">Verified · real exports</span
          ></a
        >
      </li>
      <li>
        <a
          class="plat verified flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-quantower"
          ><span
            class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-2 shadow-[0_0_0_3px_color-mix(in_srgb,var(--chart-2)_15%,transparent)]"
            aria-hidden="true"
          ></span><b class="flex-1 text-[15px] font-semibold">Quantower</b><span class="pstate font-mono text-[10.5px] text-chart-2"
            >Verified · real exports</span
          ></a
        >
      </li>
      <li>
        <a
          class="plat verified flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-atas"
          ><span
            class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-2 shadow-[0_0_0_3px_color-mix(in_srgb,var(--chart-2)_15%,transparent)]"
            aria-hidden="true"
          ></span><b class="flex-1 text-[15px] font-semibold">ATAS X</b><span class="pstate font-mono text-[10.5px] text-chart-2"
            >Verified · real exports (.xlsx)</span
          ></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-rithmic"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">Rithmic R|Trader</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-sierrachart"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">Sierra Chart</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-tradestation"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">TradeStation</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-motivewave"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">MotiveWave</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-webull"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">Webull</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-ibkr"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">Interactive Brokers</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
      <li>
        <a
          class="plat flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-card px-4 py-[15px] text-foreground no-underline transition-[border-color,transform] duration-200 hover:translate-y-[-2px] hover:border-ring hover:no-underline"
          href="howto.html#imp-schwab"
          ><span class="pdot h-[9px] w-[9px] flex-none rounded-full bg-chart-4" aria-hidden="true"></span><b
            class="flex-1 text-[15px] font-semibold">Schwab / thinkorswim</b
          ><span class="pstate font-mono text-[10.5px] text-muted-foreground">Beta · synthetic</span></a
        >
      </li>
    </ul>
    <p class="plat-legend mt-5 flex flex-wrap items-center gap-5 text-[12.5px] text-muted-foreground">
      <span
        ><span class="lg mr-[7px] inline-block h-[10px] w-[10px] rounded-full bg-chart-2 align-middle"></span>Tested on real exports</span
      >
      <span
        ><span class="lg mr-[7px] inline-block h-[10px] w-[10px] rounded-full bg-chart-4 align-middle"></span>Beta — built from docs &amp;
        synthetic tests; verify the numbers</span
      >
    </p>
  </div>
</section>

<!-- ============ PRICING ============ -->
<section id="pricing" class="flex min-h-screen scroll-mt-0 flex-col justify-center px-[22px] pb-[72px] pt-[96px]">
  <div class="inner reveal mx-auto w-full max-w-[1180px]" use:reveal>
    <p class="mb-[14px] font-mono text-[12px] uppercase tracking-[0.16em] text-primary">Pricing</p>
    <h2 class="h2 mb-[14px] text-[clamp(26px,4vw,40px)] font-bold leading-[1.12] tracking-[-0.02em]">
      Free for everyone. Support if it helps.
    </h2>
    <p class="mb-2 max-w-[680px] text-[clamp(15px,1.6vw,17px)] leading-[1.6] text-muted-foreground">
      Blotterbook is free for everyone — the whole CSV-driven app, with nothing about your trades uploaded. Launching takes a free account;
      or try the <a href="/app/demo.html">demo</a> with no sign-up. If it saves you money, back the project with an optional donation.
      Cross-device
      <b>synced workspaces</b> are coming as a low-cost add-on.
    </p>
    <div class="price-grid mt-[34px] grid grid-cols-[1.1fr_1fr_1fr] items-stretch gap-4 max-[900px]:grid-cols-1">
      <div
        class="plan flex flex-col rounded-[14px] border border-primary/50 bg-card p-[26px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_15%,transparent),0_14px_40px_-22px_color-mix(in_srgb,var(--primary)_50%,transparent)]"
      >
        <span
          class="ribbon mb-[14px] self-start rounded-[6px] bg-primary/12 px-[10px] py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-primary"
          >Available now</span
        >
        <h3 class="mb-1 text-[18px] font-semibold">Blotterbook</h3>
        <p class="mb-[18px] text-[13px] leading-[1.5] text-muted-foreground">
          The full app, free for everyone — nothing about your trades uploaded, everything runs in your browser.
        </p>
        <div class="mb-1 font-mono text-[30px] font-bold tracking-[-0.02em]">Free</div>
        <ul class="my-4 mb-[22px] flex list-none flex-col gap-[10px] p-0">
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Full journal, cost model, and tax estimate
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Live broker, fee, and feed reference data
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Everything runs locally in your browser
          </li>
        </ul>
        <p class="mt-auto text-[12px] leading-[1.5] text-muted-foreground">
          A free account launches the app — or try the demo, no sign-up.
        </p>
      </div>

      <div class="plan flex flex-col rounded-[14px] border border-border bg-card p-[26px]">
        <span
          class="mb-[14px] self-start rounded-[6px] border border-chart-3/40 px-[10px] py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-chart-3"
          >Optional</span
        >
        <h3 class="mb-1 text-[18px] font-semibold">Back the project</h3>
        <p class="mb-[18px] text-[13px] leading-[1.5] text-muted-foreground">
          Pay-what-helps support that keeps Blotterbook free and funds new features.
        </p>
        <div class="mb-1 font-mono text-[30px] font-bold tracking-[-0.02em]">
          $25 <small class="text-[14px] font-normal text-muted-foreground">one-time</small>
        </div>
        <ul class="my-4 mb-[18px] flex list-none flex-col gap-[10px] p-0">
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Keeps the free app free for everyone
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Funds adapters, analytics, and fixes
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-green stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Supporter recognition (planned)
          </li>
        </ul>
        <div class="mt-auto flex flex-col gap-2">
          {#if DONATION_LINKS.once25}
            <a
              class="inline-flex w-full items-center justify-center gap-2 rounded-[9px] border border-primary/50 bg-primary/12 px-4 py-[10px] text-[13.5px] font-semibold text-foreground transition-[border-color,background] duration-150 hover:border-primary hover:bg-primary/20"
              href={DONATION_LINKS.once25}
              target="_blank"
              rel="noopener noreferrer">Back with $25 &rarr;</a
            >
          {:else}
            <p class="text-[12px] leading-[1.5] text-muted-foreground">$25 one-time — donations open soon via Stripe.</p>
          {/if}
          {#if DONATION_LINKS.tier50}
            <a
              class="inline-flex w-full items-center justify-center gap-2 rounded-[9px] border border-primary/50 bg-primary/12 px-4 py-[10px] text-[13.5px] font-semibold text-foreground transition-[border-color,background] duration-150 hover:border-primary hover:bg-primary/20"
              href={DONATION_LINKS.tier50}
              target="_blank"
              rel="noopener noreferrer">Back with $50 &rarr;</a
            >
          {/if}
          <p class="text-[11px] leading-[1.4] text-muted-foreground">
            A voluntary, non-refundable donation — not a purchase, and it grants no product access or entitlement.
            <a href="legal.html#donations">See donation terms</a>.
          </p>
        </div>
      </div>

      <div class="plan flex flex-col rounded-[14px] border border-border bg-card p-[26px]">
        <span
          class="ribbon mb-[14px] self-start rounded-[6px] bg-primary/12 px-[10px] py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-primary"
          >Available now</span
        >
        <h3 class="mb-1 text-[18px] font-semibold">Synced workspaces</h3>
        <p class="mb-[18px] text-[13px] leading-[1.5] text-muted-foreground">
          End-to-end-encrypted sync of your trades, notes, tags &amp; saved filters across devices.
        </p>
        <div class="mb-1 font-mono text-[30px] font-bold tracking-[-0.02em] text-foreground">
          $5 <small class="text-[14px] font-normal text-muted-foreground">/ month</small>
        </div>
        <ul class="my-4 mb-[22px] flex list-none flex-col gap-[10px] p-0">
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-faint stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Use Blotterbook on all your devices
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-faint stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >Zero-knowledge: we still never see your data
          </li>
          <li class="flex gap-[9px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              class="mt-[2px] h-[15px] w-[15px] flex-none fill-none stroke-faint stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              ><path d="M20 6L9 17l-5-5" /></svg
            >No more re-uploading CSVs per device
          </li>
        </ul>
        <div class="mt-auto flex flex-col gap-2">
          <a
            class="inline-flex w-full items-center justify-center gap-2 rounded-[9px] border border-primary/50 bg-primary/12 px-4 py-[10px] text-[13.5px] font-semibold text-foreground transition-[border-color,background] duration-150 hover:border-primary hover:bg-primary/20"
            href="/app/#account">Get cloud sync in the app &rarr;</a
          >
          <p class="text-[11px] leading-[1.4] text-muted-foreground">Launch the app, sign in, and subscribe from your account.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============ FAQ ============ -->
<section id="faq" class="flex min-h-screen scroll-mt-0 flex-col justify-center px-[22px] pb-[72px] pt-[96px]">
  <div class="inner reveal mx-auto w-full max-w-[1180px]" use:reveal>
    <p class="mb-[14px] font-mono text-[12px] uppercase tracking-[0.16em] text-primary">FAQ</p>
    <h2 class="h2 mb-[14px] text-[clamp(26px,4vw,40px)] font-bold leading-[1.12] tracking-[-0.02em]">
      Questions, limitations, and the fine print
    </h2>
    <p class="mb-2 max-w-[680px] text-[clamp(15px,1.6vw,17px)] leading-[1.6] text-muted-foreground">
      Blotterbook is deliberately honest about what it does and doesn't measure. Here's the straight version.
    </p>
    <div class="faq-list mt-[30px] max-w-[840px] border-t border-border">
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >What data does Blotterbook need, and where does it go?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          It reads the trade-history export from your trading platform — a CSV for most platforms, or a single <code>.xlsx</code> workbook for
          ATAS X — and auto-detects the format. You can import one file or a whole batch, even mixing platforms and export types; each file gets
          its own detection status, and Blotterbook normalizes and de-duplicates everything into one trade history. Everything is parsed and stored
          locally in your browser via IndexedDB — your trade data never leaves the page.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >Do I need an account, and is anything uploaded?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          Your trade data never leaves your browser and nothing about your trading is uploaded. Launching the app on the live site uses a
          free account (a passkey — no password) so the app can carry your identity; the <a href="/app/demo.html">demo</a> needs no account
          at all. Beyond the app's own reference-data JSON, the only network calls are the ones that sign you in and carry your account
          identity — they never include your trades. Use <code>Manage data</code> any time to back up, edit, or wipe everything stored in your
          browser.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >How are commissions and fees calculated?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          For each symbol, the all-in per-side cost is the broker's commission (micro or standard tier) plus the CME exchange, clearing, and
          NFA fee. A round turn is two sides. Broker rates come from editable reference data, so they can be kept current and may drift from
          your real fills — they're a close model, not your statement.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >How does the tax estimate work?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          It uses a Section 1256 model: a blended rate of 60% long-term and 40% short-term federal rates plus your selected state's top
          marginal rate, applied to net pre-tax profit only when positive. It's a rough planning estimate to gauge take-home — not tax
          advice, and not a substitute for a professional.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >Which brokers and instruments are supported?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          Modeled brokers include AMP, EdgeClear, Discount Trading, Tradovate / NinjaTrader, Optimus, Charles Schwab (thinkorswim),
          Interactive Brokers, and TradeStation. Instruments are CME futures, reduced to a root ticker (for example <code>MESM2025</code>
          becomes <code>MES</code>). Unknown symbols fall back to a default fee and are flagged.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >What are the known limitations?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          Drawdown is realized-only from the closed-trade curve, with no open-position heat. The export carries close timestamps only, so
          holding time isn't derivable. Calendar-day and RTH/ETH session grouping use the literal timestamp, not the CME session day. Sharpe
          is illustrative — daily PnL, population standard deviation, not annualized.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >Will my data sync across devices?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          Not today. Local storage is per-browser, so data isn't synced across devices and is cleared if you clear site data — keep your
          original CSV or a backup. Re-uploading is safe: trades are de-duplicated by a stable id, so overlapping exports only add genuinely
          new rows. Cross-device <b>synced workspaces</b> (end-to-end encrypted, ~$5/month) are the one planned paid add-on — see Pricing.
        </p>
      </details>
      <details class="border-b border-border">
        <summary
          class="flex cursor-pointer list-none items-center gap-[14px] px-1 py-5 text-[15.5px] font-medium text-foreground transition-colors duration-150 hover:text-white [&::-webkit-details-marker]:hidden"
          ><svg
            class="q-ico h-[18px] w-[18px] flex-none fill-none stroke-primary stroke-2 [stroke-linecap:round] transition-transform duration-[250ms]"
            viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg
          >What does it cost?</summary
        >
        <p
          class="ans m-0 pb-[22px] pl-9 pr-1 text-[14px] leading-[1.7] text-muted-foreground [&_code]:rounded-[5px] [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground"
        >
          The app is <b>free for everyone</b> and stays free. You can optionally <b>back the project</b> with a $25 one-time, non-refundable
          donation (checkout via Stripe) — it's not a purchase and grants no product access. The only planned paid feature is
          <b>synced workspaces</b> — end-to-end-encrypted cross-device sync at about $5/month — which isn't ready yet. Nothing else is gated.
        </p>
      </details>
    </div>
  </div>
</section>

<footer class="border-t border-border px-[22px] py-10 text-center text-muted-foreground">
  <div class="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-[18px]">
    <span class="inline-flex items-center gap-2 font-bold text-foreground"
      ><span class="dot h-2 w-2 rounded-[2px] bg-[linear-gradient(135deg,var(--primary),var(--chart-3))]"></span>Blotterbook</span
    >
    <div class="flex flex-wrap gap-[18px] [&_a]:text-[13px] [&_a]:text-muted-foreground [&_a:hover]:text-foreground">
      <a href="#features">Features</a>
      <a href="#platforms">Platforms</a>
      <a href="#pricing">Pricing</a>
      <a href="howto.html">How To</a>
      <a href="roadmap.html">Roadmap</a>
      <a href="changelog.html">Changelog</a>
      <a href="legal.html">Legal</a>
      <a href="/app/">Launch</a>
      <a href="mailto:contact@blotterbook.com?subject=Blotterbook">Contact</a>
    </div>
    <p class="mt-2 w-full text-[12px] text-muted-foreground">
      Blotterbook is a trading journal and cost/tax estimation tool — <b>not a broker</b>, and not financial, investment, or tax advice. It
      runs entirely in your browser; your trade data never leaves the page. All figures are estimates. Trading involves risk of loss. See
      <a href="legal.html">Legal &amp; Disclaimers</a>.
    </p>
  </div>
</footer>

<style>
  /* Page chrome lives global because Home is self-contained (A9 — NOT inside SiteShell): these style
     the document <body>/<html> and the bare <a>, which have no element in this component's template
     to carry a utility class. Kept scoped (bespoke global chrome). */
  :global(html) {
    scroll-behavior: smooth;
  }
  :global(html),
  :global(body) {
    margin: 0;
    min-height: 100%;
  }
  :global(body) {
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
    overflow-x: hidden;
  }
  :global(body)::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(620px 420px at 18% -8%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 70%),
      radial-gradient(560px 420px at 96% 4%, color-mix(in srgb, var(--chart-3) 8%, transparent), transparent 70%);
  }
  /* A128: the bare-<a> base color sits in @layer base so a utility text color on an <a> (e.g. the
     accent CTAs' text-primary-foreground) wins — without the layer this scoped rule would override the utility and
     render the CTA text invisible (accent-on-primary). Home is self-contained (not under SiteShell). */
  @layer base {
    a {
      color: var(--primary);
      text-decoration: none;
    }
  }

  /* ============ nav: desktop link styling + the bespoke CSS-only mobile menu ============
     Kept scoped: the mobile menu is a checkbox sibling-combinator toggle (.navtoggle:checked ~
     .navlinks) with dropdown positioning — genuinely bespoke and awkward as utilities. The base
     box/flex props of .nav/.wordmark/.navcta/.hamburger/etc. are utilities on the elements; these
     rules cover the link tinting and the <=760px responsive behavior. */
  .navlinks a {
    color: var(--muted-foreground);
    font-size: 13.5px;
    padding: 7px 11px;
    border-radius: 7px;
    transition:
      color 0.15s,
      background 0.15s;
  }
  .navlinks a:hover {
    color: var(--foreground);
    background: var(--card);
  }
  .navtoggle:focus-visible ~ .hamburger {
    border-color: var(--primary);
  }
  .navlaunch {
    display: none;
  }
  @media (max-width: 760px) {
    .nav {
      gap: 10px;
    }
    .navcta {
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
    }
    .navlinks a:last-child {
      border-bottom: none;
    }
    /* match the desktop nav button exactly — .navlinks a would otherwise tint the text dim */
    .navlinks a.navlaunch {
      display: block;
      color: var(--background);
      background: var(--primary);
      font-weight: 600;
      border-radius: 9px;
      margin-top: 10px;
      text-align: center;
    }
    .navlinks a.navlaunch:hover {
      background: var(--primary);
      color: var(--background);
    }
  }

  /* reveal-on-scroll: transition-driven + the `.in` class is toggled by the reveal action (and is
     {@html}-independent global state), so keep scoped per the keep-scoped rule for animation. */
  .reveal {
    opacity: 0;
    transform: translateY(18px);
    transition:
      opacity 0.6s ease,
      transform 0.6s ease;
  }
  :global(.reveal.in) {
    opacity: 1;
    transform: none;
  }

  /* ============ live pill — keyframe-driven (kept scoped per the keep-scoped rule) ============ */
  .livedot-live {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--chart-2) 50%, transparent);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--chart-2) 50%, transparent);
    }
    70% {
      box-shadow: 0 0 0 7px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }

  /* ============ hero refresh (A274): entrance stagger + device-frame showcase ============
     Keyframe/state-driven bits + the showcase mask stay scoped (keep-scoped rule for animation +
     the {@html}-independent state); the box/flex/spacing props are utilities on the elements. */
  .rise {
    opacity: 0;
    transform: translateY(14px);
    animation: riseIn 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  }
  .rise.r1 {
    animation-delay: 0.04s;
  }
  .rise.r2 {
    animation-delay: 0.1s;
  }
  .rise.r3 {
    animation-delay: 0.17s;
  }
  .rise.r4 {
    animation-delay: 0.24s;
  }
  .rise.r5 {
    animation-delay: 0.31s;
  }
  .rise.r6 {
    animation-delay: 0.16s;
  }
  @keyframes riseIn {
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rise {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }

  /* bottom-fade the app screenshot into the page (the reference's mask-b-from) */
  .showcase {
    -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
    mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
  }

  /* device-frame sidebar rows — repeated rows collapse to one scoped rule instead of N utility strings */
  .dnav {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 4px;
    padding: 7px 8px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .dnav.on {
    background: var(--accent);
    color: var(--foreground);
  }
  .dnav svg {
    height: 14px;
    width: 14px;
    flex: none;
  }

  /* equity-curve mock: the SVG is authored in-template (NOT {@html}), so plain scoped selectors
     match; strokes pull from the chart tokens so the mock tracks the palette (never hardcode a color). */
  .eq-grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .eq-baseline {
    stroke: var(--border);
    stroke-width: 1.5;
  }
  .eq-gross {
    fill: none;
    stroke: var(--chart-1);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .eq-net {
    fill: none;
    stroke: var(--chart-2);
    stroke-width: 2.25;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .eq-net-area {
    fill: var(--chart-2);
    fill-opacity: 0.1;
  }
  .eq-take {
    fill: none;
    stroke: var(--chart-3);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .eq-dot {
    fill: var(--chart-2);
  }

  /* feature explorer: the active item tints its child .ficon — a descendant rule on the {@html}-free
     but state-toggled child, kept scoped. */
  .feat-item.is-active .ficon {
    background: color-mix(in srgb, var(--primary) 22%, transparent);
  }

  /* F19: per-feature topic illustration. The shapes are injected via {@html}, so they DON'T receive
     Svelte's scope hash — the inner class selectors must stay :global() (SVG-child styling, kept
     scoped per the keep-scoped rule). They pull from the tailwind.css design tokens so the graphics track the palette. */
  .feat-graphic :global(.gx-grid) {
    stroke: var(--border);
    stroke-width: 1.5;
    fill: none;
  }
  .feat-graphic :global(.gx-panel) {
    fill: var(--secondary);
    stroke: var(--border);
    stroke-width: 1.5;
  }
  .feat-graphic :global(.gx-line) {
    fill: none;
    stroke: var(--chart-2);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .feat-graphic :global(.gx-area) {
    fill: var(--chart-2);
    opacity: 0.16;
  }
  .feat-graphic :global(.gx-stroke-primary) {
    fill: none;
    stroke: var(--primary);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .feat-graphic :global(.gx-green) {
    fill: var(--chart-2);
  }
  .feat-graphic :global(.gx-primary) {
    fill: var(--primary);
  }
  .feat-graphic :global(.gx-take) {
    fill: var(--chart-3);
  }
  .feat-graphic :global(.gx-red) {
    fill: var(--destructive);
  }
  .feat-graphic :global(.gx-faint) {
    fill: var(--muted-foreground);
    opacity: 0.5;
  }

  /* FAQ: the q-ico rotation is driven by the details[open] state (kept scoped per the keep-scoped
     rule); its base size/stroke/transition are utilities on the element. */
  details[open] summary .q-ico {
    transform: rotate(45deg);
  }
</style>
