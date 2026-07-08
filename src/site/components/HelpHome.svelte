<script lang="ts">
  // Help hub (A273 — help.obsidian.md-style docs landing). Card/TOC links into the four Help
  // sections, each with a one-line description. Shared chrome from HelpShell (active="").
  import HelpShell from '../lib/HelpShell.svelte';

  const cards: { href: string; title: string; blurb: string }[] = [
    {
      href: '/help/getting-started.html',
      title: 'Getting started',
      blurb: 'First run, broker & cost setup, loading your first CSV, and reading the dashboard.',
    },
    {
      href: '/help/import.html',
      title: 'Importing your trades',
      blurb: 'Export the right CSV from TradingView, Tradovate, ATAS X, IBKR, and every other supported platform.',
    },
    {
      href: '/help/cloud-sync.html',
      title: 'Cloud sync',
      blurb: 'How end-to-end encrypted, multi-device sync works — the recovery key, subscribing, and enabling it per workspace.',
    },
    {
      href: '/help/support.html',
      title: 'Support',
      blurb: 'Contact us, what to include in a bug report, and where to check known issues and recent changes.',
    },
  ];
</script>

<HelpShell active="">
  <p class="eyebrow">Blotterbook Help</p>
  <h1>How can we help?</h1>
  <p class="blurb">
    Everything you need to set up Blotterbook, get your trades in, keep them in sync across devices, and reach us if something's wrong.
  </p>

  <div class="mt-6 grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
    {#each cards as c (c.href)}
      <a
        class="group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-[18px] no-underline transition-colors duration-150 hover:border-primary/50 hover:no-underline"
        href={c.href}
      >
        <span class="text-[15px] font-semibold text-foreground group-hover:text-primary">{c.title} &rarr;</span>
        <span class="text-[13px] leading-[1.5] text-muted-foreground">{c.blurb}</span>
      </a>
    {/each}
  </div>

  <section class="mt-9 border-t border-border pt-6">
    <h2 class="mt-0">Still stuck?</h2>
    <p>
      Email <a href="mailto:contact@blotterbook.com?subject=Blotterbook%20support">contact@blotterbook.com</a> — see
      <a href="/help/support.html">Support</a> for what to include (and please never attach a CSV or trade data; we never need it).
    </p>
  </section>
</HelpShell>
