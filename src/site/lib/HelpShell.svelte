<script lang="ts">
  // Shared shell for the Help site (A273 — help.obsidian.md-style docs hub). Composes the existing
  // SiteShell (top Nav/Footer + base typography/.note/.panel — active="help" highlights the header's
  // Help link) with a persistent left HelpNav sidebar + a content column. Also owns the `.steps`
  // numbered-list styling shared by the migrated Getting Started + Import pages (kept :global so it
  // reaches the slotted page markup, same reasoning as SiteShell's own :global base rules).
  import type { Snippet } from 'svelte';
  import SiteShell from './SiteShell.svelte';
  import HelpNav from './HelpNav.svelte';

  interface Props {
    /** '' for the hub, or a HelpNav section key ('getting-started' | 'import' | 'cloud-sync' | 'support'). */
    active?: string;
    children: Snippet;
  }
  let { active = '', children }: Props = $props();
</script>

<SiteShell active="help" wide>
  <div class="grid grid-cols-[190px_1fr] items-start gap-9 max-[760px]:grid-cols-1 max-[760px]:gap-[18px]">
    <div class="sticky top-[70px] max-[760px]:static">
      <HelpNav {active} />
    </div>
    <main>
      {@render children()}
    </main>
  </div>
</SiteShell>

<style>
  /* Step lists use CSS counters + a ::before badge (bespoke, kept scoped/:global — ex Howto.svelte,
     shared by HelpGettingStarted + HelpImport so it isn't duplicated per page). */
  :global(.steps) {
    counter-reset: step;
    list-style: none;
    padding: 0;
    margin: 14px 0;
  }
  :global(.steps > li) {
    position: relative;
    padding: 0 0 18px 42px;
    counter-increment: step;
  }
  :global(.steps > li::before) {
    content: counter(step);
    position: absolute;
    left: 0;
    top: -2px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--secondary);
    border: 1px solid var(--border);
    color: var(--primary);
    font-family: var(--font-mono);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }
  :global(.steps > li b) {
    color: var(--foreground);
  }
</style>
