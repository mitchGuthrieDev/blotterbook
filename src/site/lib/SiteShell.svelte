<script lang="ts">
  // Shared layout for the info pages (changelog/help/roadmap/legal) + the admin panel (A69 — ex the
  // shared half of site.css). Composes <Nav>/<Footer> around a `.wrap` content column and owns the
  // site-wide base styles (resets, body chrome, typographic scale, .note/.panel) so each page
  // component only carries ITS OWN page-specific CSS. These base rules are declared :global because
  // they style the slotted page markup (Svelte scoping doesn't cross the slot boundary) and the
  // document <body> — they're deliberately site-wide, the single source moved here from site.css.
  // src/styles/tailwind.css is the single source for colors/fonts (the design tokens in :root, read
  // here as CSS vars; tokens.css was deleted in ADR-002). CSP-clean (A55): no inline style="" — Vite
  // extracts this to a linked stylesheet.
  import type { Snippet } from 'svelte';
  import Nav from './Nav.svelte';
  import Footer from './Footer.svelte';

  interface Props {
    active?: string;
    variant?: 'full' | 'admin';
    wide?: boolean;
    children: Snippet;
  }
  let { active = '', variant = 'full', wide = false, children }: Props = $props();
</script>

<Nav {active} {variant} />
<div class="wrap" class:wide>
  {@render children()}
</div>
<Footer {variant} />

<style>
  /* A128: the site's base typography/chrome lives in @layer base so Tailwind utilities (a higher
     layer in tailwind.css's `@layer theme, base, components, utilities` order) can override it
     per-element during the utility migration — e.g. a utility text color on an <a> beats the global
     a{color} rule. Without the layer, these unlayered :global rules would always win over utilities. */
  @layer base {
    :global {
      * {
        box-sizing: border-box;
      }
      html {
        scroll-behavior: smooth;
      }
      html,
      body {
        margin: 0;
        min-height: 100%;
      }
      body {
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font-sans);
        -webkit-font-smoothing: antialiased;
        line-height: 1.6;
      }
      a {
        color: var(--primary);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background:
          radial-gradient(620px 420px at 18% -8%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 70%),
          radial-gradient(560px 420px at 96% 4%, color-mix(in srgb, var(--chart-3) 8%, transparent), transparent 70%);
      }

      /* page frame */
      .wrap {
        max-width: 880px;
        margin: 0 auto;
        padding: 48px 22px 70px;
      }
      .wrap.wide {
        max-width: 1080px;
      }
      .eyebrow {
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--primary);
        margin: 0 0 14px;
      }
      h1 {
        font-size: clamp(30px, 5vw, 44px);
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0 0 12px;
        line-height: 1.1;
      }
      .blurb {
        color: var(--muted-foreground);
        font-size: 16px;
        max-width: 680px;
        line-height: 1.65;
        margin: 0 0 8px;
      }
      .blurb b {
        color: var(--foreground);
      }
      h2 {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
        margin: 40px 0 12px;
      }
      h3 {
        font-size: 16px;
        font-weight: 600;
        margin: 24px 0 8px;
      }
      p {
        color: var(--muted-foreground);
      }
      .wrap p b,
      .wrap li b {
        color: var(--foreground);
      }
      ul,
      ol {
        color: var(--muted-foreground);
        padding-left: 20px;
      }
      li {
        margin: 5px 0;
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.9em;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 5px;
        padding: 1px 6px;
        color: var(--foreground);
      }

      /* cards / callouts (shared) */
      .panel {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 18px 20px;
        margin: 14px 0;
      }
      .note {
        background: var(--card);
        border: 1px solid var(--border);
        border-left: 3px solid var(--primary);
        border-radius: 10px;
        padding: 14px 16px;
        margin: 16px 0;
        font-size: 14px;
        color: var(--muted-foreground);
      }
      .note.warn {
        border-left-color: var(--chart-4);
      }
      .note b {
        color: var(--foreground);
      }
    }
  }
</style>
