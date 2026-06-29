<script lang="ts">
  // Marketing homepage (A69 — ex index.html + site/lib/home.js). Self-contained (A9: the homepage
  // keeps its BESPOKE nav + footer + CSS, deliberately NOT the shared SiteShell/Nav/Footer): section
  // anchors, the hero CTAs + hamburger, and a fuller legal paragraph differ structurally from the
  // info-site chrome. It links tokens.css for shared colors; everything else is the scoped CSS below.
  //
  // The former home.js logic is ported into Svelte: header-border-on-scroll (svelte:window), the
  // CSS-only mobile menu (bound checkbox, closed on link tap), reveal-on-scroll (the `reveal` action),
  // the feature explorer (tablist with roving tabindex + selection-follows-focus), and the live-status
  // pill (admin override via /api/status, else auto-detect by pinging /app/). SSR renders the initial
  // state (first feature active, "Checking status…") so it matches hydration exactly.
  import { onMount } from 'svelte';

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
        '<rect class="gx-panel" x="34" y="22" width="192" height="96" rx="9"/><line class="gx-grid" x1="34" y1="44" x2="226" y2="44"/><circle class="gx-faint" cx="48" cy="33" r="3.2"/><circle class="gx-faint" cx="60" cy="33" r="3.2"/><circle class="gx-faint" cx="72" cy="33" r="3.2"/><path class="gx-stroke-accent" d="M118 82 v-10 a12 12 0 0 1 24 0 v10"/><rect class="gx-accent" x="112" y="80" width="36" height="28" rx="4"/><circle class="gx-panel" cx="130" cy="92" r="3"/>',
      body: "Your CSV is parsed and stored entirely in your browser via IndexedDB. Trade data never leaves the page — the only network calls are the app's own reference data.",
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
        '<line class="gx-grid" x1="22" y1="116" x2="238" y2="116"/><rect class="gx-green" x="80" y="58" width="62" height="58" rx="2"/><rect class="gx-red" x="80" y="40" width="62" height="18" rx="2"/><circle class="gx-accent" cx="192" cy="52" r="15"/><path class="gx-accent" d="M179 60 L192 90 L205 60 Z"/><circle class="gx-panel" cx="192" cy="52" r="5.5"/>',
      body: "A Section 1256 estimate blends 60/40 long/short-term federal rates with your state's top marginal rate, applied only to positive net profit. Pick your state and see take-home update instantly.",
    },
    {
      title: 'Broker & data-feed comparison',
      icon: '<path d="M4 7h16M4 12h16M4 17h10"/>',
      graphic:
        '<line class="gx-grid" x1="22" y1="116" x2="238" y2="116"/><rect class="gx-accent" x="40" y="58" width="22" height="58" rx="2"/><rect class="gx-accent" x="68" y="74" width="22" height="42" rx="2"/><rect class="gx-take" x="120" y="44" width="22" height="72" rx="2"/><rect class="gx-take" x="148" y="66" width="22" height="50" rx="2"/><rect class="gx-green" x="200" y="84" width="22" height="32" rx="2"/>',
      body: 'Model AMP, EdgeClear, Tradovate / NinjaTrader, Optimus, thinkorswim, Interactive Brokers, and TradeStation. Switch broker or data feed and watch the cost — and your net — change.',
    },
    {
      title: 'Equity curve & calendar',
      icon: '<path d="M3 12l4-4 4 4 4-6 4 8"/><path d="M3 20h18"/>',
      graphic:
        '<line class="gx-grid" x1="20" y1="116" x2="128" y2="116"/><path class="gx-area" d="M22 110 L48 92 L74 86 L100 60 L124 38 L124 116 L22 116 Z"/><path class="gx-line" d="M22 110 L48 92 L74 86 L100 60 L124 38"/><rect class="gx-panel" x="150" y="26" width="92" height="92" rx="7"/><rect class="gx-green" x="156" y="32" width="18" height="18" rx="3"/><rect class="gx-faint" x="176" y="32" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="32" width="18" height="18" rx="3"/><rect class="gx-red" x="216" y="32" width="18" height="18" rx="3"/><rect class="gx-red" x="156" y="52" width="18" height="18" rx="3"/><rect class="gx-green" x="176" y="52" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="52" width="18" height="18" rx="3"/><rect class="gx-faint" x="216" y="52" width="18" height="18" rx="3"/><rect class="gx-faint" x="156" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="176" y="72" width="18" height="18" rx="3"/><rect class="gx-red" x="196" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="216" y="72" width="18" height="18" rx="3"/><rect class="gx-green" x="156" y="92" width="18" height="18" rx="3"/><rect class="gx-faint" x="176" y="92" width="18" height="18" rx="3"/><rect class="gx-green" x="196" y="92" width="18" height="18" rx="3"/><rect class="gx-green" x="216" y="92" width="18" height="18" rx="3"/>',
      body: 'A cumulative performance graph with Gross / Net / Take-home overlays and hover detail, plus a Sunday-first monthly calendar of daily PnL with weekly summaries and day-notes.',
    },
    {
      title: 'Filters, journal & statistics',
      icon: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
      graphic:
        '<path class="gx-stroke-accent" d="M28 32 H118 L84 70 V108 L62 118 V70 Z"/><rect class="gx-panel" x="150" y="34" width="90" height="22" rx="5"/><rect class="gx-green" x="158" y="42" width="26" height="6" rx="3"/><rect class="gx-panel" x="150" y="62" width="90" height="22" rx="5"/><rect class="gx-accent" x="158" y="70" width="44" height="6" rx="3"/><rect class="gx-panel" x="150" y="90" width="90" height="22" rx="5"/><rect class="gx-take" x="158" y="98" width="18" height="6" rx="3"/>',
      body: 'Filter by date, symbol, side, session (RTH/ETH), and weekday. Keep day-notes per session. Read expectancy, profit factor, drawdown, streaks, and an illustrative Sharpe — all after costs.',
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
<header id="hdr" class:scrolled>
  <nav class="nav">
    <a class="wordmark" href="#home"><span class="dot"></span>Blotterbook</a>
    <input type="checkbox" id="navtoggle" class="navtoggle" aria-label="Toggle navigation menu" bind:checked={navOpen} />
    <div class="navlinks" role="presentation" onclick={() => (navOpen = false)}>
      <a href="#features">Features</a>
      <a href="#platforms">Platforms</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      <a href="howto.html">How&nbsp;To</a>
      <a href="roadmap.html">Roadmap</a>
      <a href="changelog.html">Changelog</a>
      <a class="navlaunch" href="/app/">Launch Blotterbook &rarr;</a>
    </div>
    <div class="navcta">
      <a class="btn-primary" href="/app/">Launch Blotterbook &rarr;</a>
    </div>
    <label class="hamburger" for="navtoggle" title="Menu">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </label>
  </nav>
</header>

<!-- ============ HERO / MAIN LANDING ============ -->
<section id="home">
  <div class="inner">
    <div class="livepill" class:live={pillState === 'live'} class:down={pillState === 'down'} class:maint={pillState === 'maint'} title="Checks whether the live Blotterbook app is responding">
      <span class="livedot"></span><span>{pillText}</span>
    </div>
    <div class="banner"><img src="assets/banner.svg" alt="Blotterbook — futures journal and cost dashboard" /></div>
    <p class="tag">
      A fast, private futures trading journal and true-cost dashboard. Import your broker CSV and see real, after-cost, after-tax
      performance — everything runs in your browser.
    </p>
    <div class="hero-ctas">
      <a class="cta-lg" href="/app/">Launch Blotterbook &rarr;</a>
      <a class="cta-ghost" href="/app/demo.html">See Demo</a>
    </div>
    <div class="hero-strip">
      <div><b>Private by design</b>Your trades are parsed and stored locally. Nothing is uploaded.</div>
      <div><b>True cost &amp; tax model</b>Per-symbol commissions, data fees, and a Section 1256 tax estimate.</div>
      <div><b>Journal &amp; analyze</b>Calendar, equity curve, filters, day-notes, and deep statistics.</div>
    </div>
    <div class="scrollhint">SCROLL ↓</div>
  </div>
</section>

<!-- ============ FEATURES ============ -->
<section id="features">
  <div class="inner reveal" use:reveal>
    <p class="eyebrow">Features</p>
    <h2 class="h2">Everything in one private dashboard</h2>
    <p class="lead">
      Blotterbook turns a raw broker export into an honest picture of your trading — gross, net of every fee, and after an estimated tax
      bill. No accounts, no uploads, no dependencies.
    </p>

    <!-- condensed use-cases, horizontal -->
    <div class="uc-row">
      <div class="ucx"><p class="tagline">Cost intelligence</p><h3>Brokers &amp; feeds vs. real PnL</h3><p>Flip commission tiers and data feeds; watch your net move across your real history.</p></div>
      <div class="ucx"><p class="tagline">Tax planning</p><h3>Location-based estimates</h3><p>A Section 1256 blend on positive net profit, by state — know it long before April.</p></div>
      <div class="ucx"><p class="tagline">Business budgeting</p><h3>Break-even before you trade</h3><p>Subscriptions + commissions become a break-even-per-trade and a clear cost waterfall.</p></div>
      <div class="ucx"><p class="tagline">Discipline &amp; review</p><h3>Journal every session</h3><p>Day-notes, equity-curve markup, and stats by session and weekday to find your edge.</p></div>
    </div>

    <!-- clickable feature list (left) + detail (right) -->
    <div class="feat-explorer">
      <div class="feat-list" role="tablist" aria-label="Feature explorer" aria-orientation="vertical">
        {#each FEATURES as f, i (f.title)}
          <button
            type="button"
            class="feat-item"
            class:is-active={activeFeat === i}
            role="tab"
            id="feattab-{i}"
            aria-controls="featDetail"
            aria-selected={activeFeat === i}
            tabindex={activeFeat === i ? 0 : -1}
            bind:this={featButtons[i]}
            onclick={() => (activeFeat = i)}
            onkeydown={onFeatKeydown}
          >
            <span class="ficon"><svg viewBox="0 0 24 24" aria-hidden="true">{@html f.icon}</svg></span><span class="fl-t">{f.title}</span>
          </button>
        {/each}
      </div>
      <div class="feat-detail" id="featDetail" role="tabpanel" tabindex="0" aria-live="polite" aria-labelledby="feattab-{activeFeat}">
        <svg class="feat-graphic" viewBox="0 0 260 140" role="img" aria-label="{FEATURES[activeFeat].title} — illustration">{@html FEATURES[activeFeat].graphic}</svg>
        <h3>{FEATURES[activeFeat].title}</h3>
        <p>{FEATURES[activeFeat].body}</p>
      </div>
    </div>

    <div class="dual-pitch">
      <span><b>The pitch:</b> profit calculator <span class="amp">&amp;</span> budgeting tool <span class="amp">+</span> a private trade journal — without a single byte leaving your browser.</span>
    </div>
  </div>
</section>

<!-- ============ SUPPORTED PLATFORMS ============ -->
<section id="platforms">
  <div class="inner reveal" use:reveal>
    <p class="eyebrow">Supported platforms</p>
    <h2 class="h2">Bring trades from the platform you already use</h2>
    <p class="lead">
      Blotterbook auto-detects your export's format and normalizes it — your broker is a separate, cost-only setting. <b>TradingView</b> is
      verified against real exports; the others are in <b>beta</b>, built from each platform's documented format and exercised with synthetic
      test data. Step-by-step export guides live in the <a href="howto.html">How&nbsp;To</a>.
    </p>
    <ul class="plat-grid" aria-label="Supported trading platforms and test status">
      <li><a class="plat verified" href="howto.html#imp-tradingview"><span class="pdot" aria-hidden="true"></span><b>TradingView</b><span class="pstate">Verified · real data</span></a></li>
      <li><a class="plat" href="howto.html#imp-tradovate"><span class="pdot" aria-hidden="true"></span><b>Tradovate</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-rithmic"><span class="pdot" aria-hidden="true"></span><b>Rithmic R|Trader</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-sierrachart"><span class="pdot" aria-hidden="true"></span><b>Sierra Chart</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-tradestation"><span class="pdot" aria-hidden="true"></span><b>TradeStation</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-motivewave"><span class="pdot" aria-hidden="true"></span><b>MotiveWave</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-webull"><span class="pdot" aria-hidden="true"></span><b>Webull</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-ibkr"><span class="pdot" aria-hidden="true"></span><b>Interactive Brokers</b><span class="pstate">Beta · synthetic</span></a></li>
      <li><a class="plat" href="howto.html#imp-schwab"><span class="pdot" aria-hidden="true"></span><b>Schwab / thinkorswim</b><span class="pstate">Beta · synthetic</span></a></li>
    </ul>
    <p class="plat-legend">
      <span><span class="lg verified"></span>Tested on real exports</span>
      <span><span class="lg"></span>Beta — built from docs &amp; synthetic tests; verify the numbers</span>
    </p>
  </div>
</section>

<!-- ============ PRICING ============ -->
<section id="pricing">
  <div class="inner reveal" use:reveal>
    <p class="eyebrow">Pricing</p>
    <h2 class="h2">Free for everyone. Support if it helps.</h2>
    <p class="lead">
      Blotterbook is free for everyone — the whole CSV-driven app, no account, nothing uploaded. If it saves you money, back the project
      with an optional donation. Cross-device <b>synced workspaces</b> are coming as a low-cost add-on.
    </p>
    <div class="price-grid">
      <div class="plan featured">
        <span class="ribbon">Available now</span>
        <h3>Blotterbook</h3>
        <p class="sub">The full app, free for everyone — no account, nothing uploaded, runs in your browser.</p>
        <div class="amt">Free</div>
        <ul>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Full journal, cost model, and tax estimate</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Live broker, fee, and feed reference data</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Everything runs locally in your browser</li>
        </ul>
        <p class="foot-note">No sign-up required to use the app.</p>
      </div>

      <div class="plan">
        <span class="soon-badge optional">Optional</span>
        <h3>Back the project</h3>
        <p class="sub">Pay-what-helps support that keeps Blotterbook free and funds new features.</p>
        <div class="amt">$25 <small>one-time</small></div>
        <div class="amt year">$50 <small>/ year</small></div>
        <ul>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Keeps the free app free for everyone</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Funds adapters, analytics, and fixes</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Supporter recognition (planned)</li>
        </ul>
        <p class="foot-note">Donations open soon — secure checkout via Stripe.</p>
      </div>

      <div class="plan soon">
        <span class="soon-badge">Planned</span>
        <h3>Synced workspaces</h3>
        <p class="sub">End-to-end-encrypted sync of your trades, notes, tags &amp; saved filters across devices.</p>
        <div class="amt">$5 <small>/ month</small></div>
        <ul>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Use Blotterbook on all your devices</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Zero-knowledge: we still never see your data</li>
          <li><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>No more re-uploading CSVs per device</li>
        </ul>
        <p class="foot-note">Not ready yet — on the roadmap.</p>
      </div>
    </div>
  </div>
</section>

<!-- ============ FAQ ============ -->
<section id="faq">
  <div class="inner reveal" use:reveal>
    <p class="eyebrow">FAQ</p>
    <h2 class="h2">Questions, limitations, and the fine print</h2>
    <p class="lead">Blotterbook is deliberately honest about what it does and doesn't measure. Here's the straight version.</p>
    <div class="faq-list">
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>What data does Blotterbook need, and where does it go?</summary>
        <p class="ans">It reads a balance-history CSV exported from TradingView. Required columns are <code>Time</code>, <code>Realized PnL (value)</code>, and <code>Action</code>; each row is treated as one position-close event. Everything is parsed and stored locally in your browser via IndexedDB — your trade data never leaves the page.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Do I need an account, and is anything uploaded?</summary>
        <p class="ans">No account, no sign-up, nothing uploaded. The only outbound network call is loading the app's own reference-data JSON (brokers, fees, feeds, state tax). Use <code>Manage data</code> any time to back up, edit, or wipe everything stored in your browser.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>How are commissions and fees calculated?</summary>
        <p class="ans">For each symbol, the all-in per-side cost is the broker's commission (micro or standard tier) plus the CME exchange, clearing, and NFA fee. A round turn is two sides. Broker rates come from editable reference data, so they can be kept current and may drift from your real fills — they're a close model, not your statement.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>How does the tax estimate work?</summary>
        <p class="ans">It uses a Section 1256 model: a blended rate of 60% long-term and 40% short-term federal rates plus your selected state's top marginal rate, applied to net pre-tax profit only when positive. It's a rough planning estimate to gauge take-home — not tax advice, and not a substitute for a professional.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Which brokers and instruments are supported?</summary>
        <p class="ans">Modeled brokers include AMP, EdgeClear, Tradovate / NinjaTrader, Optimus, Charles Schwab (thinkorswim), Interactive Brokers, and TradeStation. Instruments are CME futures, reduced to a root ticker (for example <code>MESM2025</code> becomes <code>MES</code>). Unknown symbols fall back to a default fee and are flagged.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>What are the known limitations?</summary>
        <p class="ans">Drawdown is realized-only from the closed-trade curve, with no open-position heat. The export carries close timestamps only, so holding time isn't derivable. Calendar-day and RTH/ETH session grouping use the literal timestamp, not the CME session day. Sharpe is illustrative — daily PnL, population standard deviation, not annualized.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Will my data sync across devices?</summary>
        <p class="ans">Not today. Local storage is per-browser, so data isn't synced across devices and is cleared if you clear site data — keep your original CSV or a backup. Re-uploading is safe: trades are de-duplicated by a stable id, so overlapping exports only add genuinely new rows. Cross-device <b>synced workspaces</b> (end-to-end encrypted, ~$5/month) are the one planned paid add-on — see Pricing.</p>
      </details>
      <details>
        <summary><svg class="q-ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>What does it cost?</summary>
        <p class="ans">The app is <b>free for everyone</b> and stays free. You can optionally <b>back the project</b> with a $25 one-time or $50/year donation (checkout via Stripe, coming soon). The only planned paid feature is <b>synced workspaces</b> — end-to-end-encrypted cross-device sync at about $5/month — which isn't ready yet. Nothing else is gated.</p>
      </details>
    </div>
  </div>
</section>

<footer class="site">
  <div class="frow">
    <span class="fbrand"><span class="dot"></span>Blotterbook</span>
    <div class="flinks">
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
    <p class="legal">
      Blotterbook is a trading journal and cost/tax estimation tool — <b>not a broker</b>, and not financial, investment, or tax advice. It
      runs entirely in your browser; your trade data never leaves the page. All figures are estimates. Trading involves risk of loss. See
      <a href="legal.html">Legal &amp; Disclaimers</a>.
    </p>
  </div>
</footer>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(html) {
    scroll-behavior: smooth;
  }
  :global(html),
  :global(body) {
    margin: 0;
    min-height: 100%;
  }
  :global(body) {
    background: var(--bg);
    color: var(--txt);
    font-family: var(--sans);
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
      radial-gradient(620px 420px at 18% -8%, rgba(106, 160, 255, 0.1), transparent 70%),
      radial-gradient(560px 420px at 96% 4%, rgba(201, 139, 255, 0.08), transparent 70%);
  }
  a {
    color: var(--accent);
    text-decoration: none;
  }

  /* ============ sticky header ============ */
  header {
    position: sticky;
    top: 0;
    z-index: 50;
    backdrop-filter: saturate(150%) blur(10px);
    background: rgba(13, 16, 20, 0.72);
    border-bottom: 1px solid transparent;
    transition:
      border-color 0.25s,
      background 0.25s;
  }
  header.scrolled {
    border-bottom-color: var(--line);
    background: rgba(13, 16, 20, 0.86);
  }
  .nav {
    max-width: 1180px;
    margin: 0 auto;
    padding: 13px 22px;
    display: flex;
    align-items: center;
    gap: 18px;
    position: relative;
  }
  .wordmark {
    font-weight: 700;
    letter-spacing: 0.01em;
    font-size: 16px;
    color: var(--txt);
    display: inline-flex;
    align-items: center;
    gap: 9px;
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
    margin-left: 8px;
    flex-wrap: wrap;
  }
  .navlinks a {
    color: var(--dim);
    font-size: 13.5px;
    padding: 7px 11px;
    border-radius: 7px;
    transition:
      color 0.15s,
      background 0.15s;
  }
  .navlinks a:hover {
    color: var(--txt);
    background: var(--panel);
  }
  .navcta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
    font-size: 13.5px;
    padding: 9px 16px;
    border-radius: 9px;
    transition:
      filter 0.15s,
      transform 0.15s;
  }
  .btn-primary:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
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
    }
    .navlinks a:last-child {
      border-bottom: none;
    }
    /* match the desktop nav button exactly — .navlinks a would otherwise tint the text dim */
    .navlinks a.navlaunch {
      display: block;
      color: var(--bg);
      background: var(--accent);
      font-weight: 600;
      border-radius: 9px;
      margin-top: 10px;
      text-align: center;
    }
    .navlinks a.navlaunch:hover {
      background: var(--accent);
      color: var(--bg);
    }
  }

  /* ============ generic section frame ============ */
  section {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 96px 22px 72px;
    scroll-margin-top: 0;
  }
  .inner {
    max-width: 1180px;
    margin: 0 auto;
    width: 100%;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .h2 {
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 14px;
    line-height: 1.12;
  }
  .lead {
    color: var(--dim);
    font-size: clamp(15px, 1.6vw, 17px);
    max-width: 680px;
    margin: 0 0 8px;
    line-height: 1.6;
  }

  /* reveal-on-scroll */
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

  /* ============ hero ============ */
  #home {
    align-items: center;
    text-align: center;
    padding-top: 88px;
  }
  #home .inner {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .livepill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--dim);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 6px 13px;
    margin-bottom: 22px;
  }
  .livedot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
    position: relative;
    flex: none;
  }
  .livepill.live .livedot {
    background: var(--green);
    box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5);
    animation: pulse 2s infinite;
  }
  .livepill.down .livedot {
    background: var(--red);
  }
  .livepill.maint .livedot {
    background: var(--warn);
  }
  .livepill.live,
  .livepill.maint {
    color: var(--txt);
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5);
    }
    70% {
      box-shadow: 0 0 0 7px rgba(63, 185, 80, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0);
    }
  }
  .banner {
    width: 100%;
    max-width: 880px;
  }
  .banner img {
    width: 100%;
    height: auto;
    display: block;
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .tag {
    color: var(--dim);
    font-size: clamp(15px, 1.7vw, 17px);
    max-width: 620px;
    margin: 24px auto 0;
    line-height: 1.6;
  }
  .hero-ctas {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 30px;
  }
  .cta-lg {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
    font-size: 15px;
    padding: 14px 28px;
    border-radius: 11px;
    transition:
      filter 0.15s,
      transform 0.15s;
  }
  .cta-lg:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  .cta-ghost {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--txt);
    font-weight: 500;
    font-size: 15px;
    padding: 13px 24px;
    border-radius: 11px;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .cta-ghost:hover {
    border-color: var(--accent);
    background: var(--panel2);
  }
  .hero-strip {
    display: flex;
    gap: 28px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 40px;
    max-width: 780px;
  }
  .hero-strip div {
    flex: 1;
    min-width: 180px;
    color: var(--dim);
    font-size: 13px;
    line-height: 1.55;
  }
  .hero-strip b {
    display: block;
    color: var(--txt);
    font-size: 14px;
    margin-bottom: 5px;
  }
  .scrollhint {
    margin-top: 46px;
    color: var(--faint);
    font-size: 12px;
    font-family: var(--mono);
    letter-spacing: 0.1em;
    animation: bob 2.4s ease-in-out infinite;
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(5px);
    }
  }

  /* ============ features (merged: condensed use-case row + clickable explorer) — F7 ============ */
  .ficon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(106, 160, 255, 0.12);
    flex: none;
  }
  .ficon svg {
    width: 18px;
    height: 18px;
    stroke: var(--accent);
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* condensed use-cases — one horizontal row of four, above the feature explorer */
  .uc-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-top: 30px;
  }
  .ucx {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    position: relative;
    overflow: hidden;
  }
  .ucx::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, var(--accent), var(--take));
  }
  .ucx .tagline {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--take);
    margin: 0 0 7px;
  }
  .ucx h3 {
    font-size: 14.5px;
    margin: 0 0 6px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  .ucx p {
    margin: 0;
    color: var(--dim);
    font-size: 12.5px;
    line-height: 1.55;
  }
  @media (max-width: 900px) {
    .uc-row {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (max-width: 560px) {
    .uc-row {
      grid-template-columns: 1fr;
    }
  }

  /* clickable feature list (left) + detail panel (right) */
  .feat-explorer {
    display: grid;
    grid-template-columns: minmax(0, 360px) 1fr;
    gap: 18px;
    margin-top: 18px;
    align-items: stretch;
  }
  .feat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .feat-item {
    display: flex;
    align-items: center;
    gap: 13px;
    cursor: pointer;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    appearance: none;
    -webkit-appearance: none;
    transition:
      border-color 0.18s,
      background 0.18s,
      transform 0.18s;
  }
  .feat-item:hover {
    border-color: var(--hover-line);
    transform: translateX(2px);
  }
  .feat-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .feat-item .fl-t {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .feat-item.is-active {
    border-color: var(--accent);
    background: var(--panel2);
  }
  .feat-item.is-active .ficon {
    background: rgba(106, 160, 255, 0.22);
  }
  .feat-detail {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 28px 30px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* F19: per-feature topic illustration. Themed via classes (CSP-clean — no inline style="") that
     pull from tokens.css, so the graphics track the palette like the rest of the site. */
  .feat-graphic {
    width: 100%;
    max-width: 320px;
    height: auto;
    margin: 0 0 20px;
    border-radius: 12px;
    background: var(--panel2);
    border: 1px solid var(--line);
    padding: 6px;
  }
  /* The shapes are injected via {@html}, so they don't receive Svelte's scope hash — the inner
     class selectors must be :global() to match (and to not be stripped as "unused"). */
  .feat-graphic :global(.gx-grid) {
    stroke: var(--line);
    stroke-width: 1.5;
    fill: none;
  }
  .feat-graphic :global(.gx-panel) {
    fill: var(--panel2);
    stroke: var(--line);
    stroke-width: 1.5;
  }
  .feat-graphic :global(.gx-line) {
    fill: none;
    stroke: var(--green);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .feat-graphic :global(.gx-area) {
    fill: var(--green);
    opacity: 0.16;
  }
  .feat-graphic :global(.gx-stroke-accent) {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .feat-graphic :global(.gx-green) {
    fill: var(--green);
  }
  .feat-graphic :global(.gx-accent) {
    fill: var(--accent);
  }
  .feat-graphic :global(.gx-take) {
    fill: var(--take);
  }
  .feat-graphic :global(.gx-red) {
    fill: var(--red);
  }
  .feat-graphic :global(.gx-faint) {
    fill: var(--faint);
    opacity: 0.5;
  }
  .feat-detail h3 {
    font-size: 21px;
    margin: 0 0 11px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .feat-detail p {
    margin: 0;
    color: var(--dim);
    font-size: 15px;
    line-height: 1.7;
    max-width: 54ch;
  }
  @media (max-width: 760px) {
    .feat-explorer {
      grid-template-columns: 1fr;
    }
  }

  .dual-pitch {
    margin-top: 30px;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 14px;
    color: var(--dim);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 11px;
    padding: 14px 18px;
  }
  .dual-pitch b {
    color: var(--txt);
  }
  .dual-pitch .amp {
    color: var(--faint);
    font-family: var(--mono);
  }

  /* ============ supported platforms ============ */
  .plat-grid {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 34px;
  }
  @media (max-width: 760px) {
    .plat-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 460px) {
    .plat-grid {
      grid-template-columns: 1fr;
    }
  }
  .plat {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    color: var(--txt);
    text-decoration: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 15px 16px;
    transition:
      border-color 0.2s,
      transform 0.2s;
  }
  .plat:hover {
    border-color: var(--hover-line);
    transform: translateY(-2px);
    text-decoration: none;
  }
  .plat b {
    font-size: 15px;
    flex: 1;
    font-weight: 600;
  }
  .plat .pdot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warn);
    flex: none;
  }
  .plat.verified .pdot {
    background: var(--green);
    box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.15);
  }
  .plat .pstate {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--dim);
  }
  .plat.verified .pstate {
    color: var(--green);
  }
  .plat-legend {
    margin-top: 20px;
    font-size: 12.5px;
    color: var(--dim);
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    align-items: center;
  }
  .plat-legend .lg {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 7px;
    vertical-align: middle;
    background: var(--warn);
  }
  .plat-legend .lg.verified {
    background: var(--green);
  }

  /* ============ pricing ============ */
  .price-grid {
    display: grid;
    grid-template-columns: 1.1fr 1fr 1fr;
    gap: 16px;
    margin-top: 34px;
    align-items: stretch;
  }
  @media (max-width: 900px) {
    .price-grid {
      grid-template-columns: 1fr;
    }
  }
  .plan {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 26px;
    display: flex;
    flex-direction: column;
  }
  .plan.featured {
    border-color: rgba(106, 160, 255, 0.5);
    box-shadow:
      0 0 0 1px rgba(106, 160, 255, 0.15),
      0 14px 40px -22px rgba(106, 160, 255, 0.5);
  }
  .plan .ribbon {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(106, 160, 255, 0.12);
    padding: 4px 10px;
    border-radius: 6px;
    margin-bottom: 14px;
  }
  .plan h3 {
    font-size: 18px;
    margin: 0 0 4px;
    font-weight: 600;
  }
  .plan .sub {
    color: var(--dim);
    font-size: 13px;
    margin: 0 0 18px;
    line-height: 1.5;
  }
  .plan .amt {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
    font-family: var(--mono);
  }
  .plan .amt small {
    font-size: 14px;
    color: var(--dim);
    font-weight: 400;
  }
  .plan ul {
    list-style: none;
    margin: 16px 0 22px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .plan li {
    font-size: 13.5px;
    color: var(--dim);
    display: flex;
    gap: 9px;
    line-height: 1.45;
  }
  .plan li svg {
    width: 15px;
    height: 15px;
    flex: none;
    margin-top: 2px;
    stroke: var(--green);
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .plan .foot-note {
    margin-top: auto;
    font-size: 12px;
    color: var(--faint);
    line-height: 1.5;
  }
  .plan.soon {
    opacity: 0.62;
  }
  .plan.soon .amt {
    color: var(--dim);
  }
  .plan.soon li svg {
    stroke: var(--faint);
  }
  .soon-badge {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
    border: 1px solid var(--line);
    padding: 4px 10px;
    border-radius: 6px;
    margin-bottom: 14px;
  }

  /* ============ FAQ ============ */
  .faq-list {
    margin-top: 30px;
    max-width: 840px;
    border-top: 1px solid var(--line);
  }
  details {
    border-bottom: 1px solid var(--line);
  }
  details summary {
    cursor: pointer;
    list-style: none;
    padding: 20px 4px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 15.5px;
    font-weight: 500;
    color: var(--txt);
    transition: color 0.15s;
  }
  details summary::-webkit-details-marker {
    display: none;
  }
  details summary:hover {
    color: #fff;
  }
  details summary .q-ico {
    flex: none;
    width: 18px;
    height: 18px;
    stroke: var(--accent);
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    transition: transform 0.25s;
  }
  details[open] summary .q-ico {
    transform: rotate(45deg);
  }
  details .ans {
    padding: 0 4px 22px 36px;
    color: var(--dim);
    font-size: 14px;
    line-height: 1.7;
    margin: 0;
  }
  details .ans code {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--txt);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 1px 5px;
  }

  /* ============ footer ============ */
  footer.site {
    border-top: 1px solid var(--line);
    padding: 40px 22px;
    text-align: center;
    color: var(--faint);
  }
  footer.site .frow {
    max-width: 1180px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    flex-wrap: wrap;
  }
  footer.site .fbrand {
    font-weight: 700;
    color: var(--txt);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  footer.site .fbrand .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: linear-gradient(135deg, var(--accent), var(--take));
  }
  footer.site .flinks {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  footer.site .flinks a {
    color: var(--dim);
    font-size: 13px;
  }
  footer.site .flinks a:hover {
    color: var(--txt);
  }
  footer.site .legal {
    font-size: 12px;
    color: var(--faint);
    width: 100%;
    margin-top: 8px;
  }

  /* A55/S18: extracted from former inline style="" attributes. */
  .soon-badge.optional {
    color: var(--take);
    border-color: rgba(201, 139, 255, 0.4);
  }
  .amt.year {
    font-size: 22px;
    margin-top: 6px;
  }
</style>
