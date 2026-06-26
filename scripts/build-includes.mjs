#!/usr/bin/env node
/* Blotterbook static-include prebuild — single-sources shared HTML.

   Edit the partials in partials/, then run:
       node scripts/build-includes.mjs
   to sync them into every page that carries the matching include markers.
   Idempotent and safe to re-run.

   Two families of partials:

   1. Info-site nav + footer (root pages: changelog/roadmap/legal/howto):
        <!-- include:nav active=changelog --> ...replaced... <!-- /include:nav -->
        <!-- include:footer --> ...replaced... <!-- /include:footer -->
      active=KEY (optional) highlights the matching `data-nav="KEY"` nav link.

   2. App shell (app/app.html, app/demo.html, app/staging.html — A5): the scope
      toggle, landing/setup, filter bar, dashboard panels, and data-manager modal
      are single-sourced here and injected per page. Per-page differences are kept
      in ONE source via a tiny mode conditional inside the partial:
        <!--IF mode=staging-->  …staging-only markup…  <!--ENDIF-->
        <!--IF mode!=demo-->     …everything but demo…  <!--ENDIF-->
      The page selects its variant on the marker:
        <!-- include:app-dash mode=staging --> ...replaced... <!-- /include:app-dash -->
      mode is one of app | demo | staging (defaults to app). Staging-only panels
      that exist on staging ALONE (activity terminal) are NOT duplicated, so they
      stay inline in staging.html, just after the shared include.

   The output is plain static HTML, so the committed pages already contain the
   rendered partials — the deploy works with or without running this. It can also
   be wired up as the Cloudflare Pages build command for belt-and-suspenders sync.

   NOTE: the homepage and admin keep their own bespoke nav/footer by design; they
   still share colors via tokens.css. app/demo.html uses the shared dashboard but
   keeps its own trimmed top bar, landing, and (preview-only) data manager. */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

const nav = read('partials/nav.html').trim();
const footer = read('partials/footer.html').trim();

// App-shell partials (single source for app.html / demo.html / staging.html).
const appParts = {
  'app-topbar':  read('partials/app-topbar.html'),
  'app-landing': read('partials/app-landing.html'),
  'app-scope':   read('partials/app-scope.html'),
  'app-filters': read('partials/app-filters.html'),
  'app-dash':    read('partials/app-dash.html'),
  'app-modal':   read('partials/app-modal.html'),
  'app-scripts': read('partials/app-scripts.html'),
};

// Tiny mode conditional: <!--IF mode=staging-->..<!--ENDIF--> and
// <!--IF mode!=demo-->..<!--ENDIF-->. No nesting; that's all the shell needs.
function applyMode(tpl, mode) {
  return tpl.replace(
    /<!--IF\s+mode(!?)=([a-z]+)-->([\s\S]*?)<!--ENDIF-->/g,
    (_m, neg, val, body) => ((mode === val) !== Boolean(neg) ? body : '')
  );
}

// Replace everything between <!-- include:NAME ... --> and <!-- /include:NAME -->
function fill(html, name, render) {
  const re = new RegExp(
    `(<!--\\s*include:${name}\\b([^>]*?)-->)[\\s\\S]*?(<!--\\s*/include:${name}\\s*-->)`, 'g'
  );
  return html.replace(re, (_m, open, attrs, close) => `${open}\n  ${render((attrs || '').trim())}\n  ${close}`);
}

const modeOf = attrs => (/mode=([a-z]+)/.exec(attrs) || [])[1] || 'app';

let changed = 0;
for (const dir of ['.', 'app']) {
  for (const file of readdirSync(join(root, dir)).filter(f => f.endsWith('.html'))) {
    const rel = dir === '.' ? file : `${dir}/${file}`;
    const src = read(rel);
    if (!src.includes('<!-- include:')) continue;

    let out = fill(src, 'nav', attrs => {
      const m = /active=([A-Za-z0-9_-]+)/.exec(attrs);
      return m ? nav.replace(`<a data-nav="${m[1]}"`, `<a data-nav="${m[1]}" class="active"`) : nav;
    });
    out = fill(out, 'footer', () => footer);
    for (const [name, tpl] of Object.entries(appParts)) {
      out = fill(out, name, attrs => applyMode(tpl, modeOf(attrs)).trim());
    }

    if (out !== src) { writeFileSync(join(root, rel), out); changed++; console.log('updated', rel); }
  }
}
console.log(`build-includes: ${changed} file(s) updated`);
