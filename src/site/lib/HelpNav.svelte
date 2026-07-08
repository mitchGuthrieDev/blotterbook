<script lang="ts">
  // Persistent left sidebar for the Help site (A273 — help.obsidian.md-style docs hub). Plain <a
  // href> links to real pages (no client router), active-page highlight via `active`. Mobile: a
  // CSS-only "Contents" disclosure toggle, modeled on Nav.svelte's `.navtoggle` checkbox pattern —
  // no new JS.
  interface Props {
    active?: string;
  }
  let { active = '' }: Props = $props();

  const sections: { key: string; href: string; label: string }[] = [
    { key: 'getting-started', href: '/help/getting-started.html', label: 'Getting started' },
    { key: 'import', href: '/help/import.html', label: 'Importing your trades' },
    { key: 'cloud-sync', href: '/help/cloud-sync.html', label: 'Cloud sync' },
    { key: 'support', href: '/help/support.html', label: 'Support' },
  ];
</script>

<nav class="helpnav text-[13.5px]" aria-label="Help sections">
  <input type="checkbox" id="helpnavtoggle" class="helpnavtoggle pointer-events-none absolute h-px w-px opacity-0" />
  <label
    class="helpnavlabel hidden cursor-pointer items-center justify-between rounded-[9px] border border-border bg-card px-3 py-2 font-mono text-[11px] tracking-[0.08em] uppercase text-foreground"
    for="helpnavtoggle">Contents <span class="helpnavcaret">&#9662;</span></label
  >
  <div class="helplinks flex flex-col gap-0.5">
    <a
      class="block rounded-[7px] border-l-2 border-transparent px-2.5 py-[7px] text-muted-foreground no-underline hover:bg-card hover:text-foreground hover:no-underline"
      class:active={active === ''}
      href="/help/index.html">Help home</a
    >
    <div class="mt-2 mb-1 px-2.5 font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground uppercase">Sections</div>
    {#each sections as s (s.key)}
      <a
        class="block rounded-[7px] border-l-2 border-transparent px-2.5 py-[7px] text-muted-foreground no-underline hover:bg-card hover:text-foreground hover:no-underline"
        class:active={active === s.key}
        href={s.href}>{s.label}</a
      >
    {/each}
  </div>
</nav>

<style>
  /* .active styling + the mobile checkbox disclosure stay scoped (specificity/behavior, not pure
     utilities) — mirrors Nav.svelte's `.navtoggle:checked ~ .navlinks` pattern. */
  .helplinks a.active {
    color: var(--foreground);
    border-left-color: var(--primary);
    background: var(--card);
  }
  @media (max-width: 760px) {
    .helpnavlabel {
      display: flex;
    }
    .helplinks {
      display: none;
      margin-top: 8px;
    }
    .helpnavtoggle:checked ~ .helplinks {
      display: flex;
    }
    .helpnavtoggle:checked ~ .helpnavlabel .helpnavcaret {
      transform: rotate(180deg);
    }
  }
</style>
