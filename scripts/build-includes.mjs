#!/usr/bin/env node
/* Blotterbook static-include prebuild — single-sources shared HTML.

   Edit the partials in partials/, then run:
       node scripts/build-includes.mjs
   to sync them into every page that carries the matching include markers.
   Idempotent and safe to re-run.

   ONE partial family remains after the A33 Svelte cutover — the info-site nav + footer
   (root pages: changelog/roadmap/legal/howto):
        <!-- include:nav active=changelog --> ...replaced... <!-- /include:nav -->
        <!-- include:footer --> ...replaced... <!-- /include:footer -->
   active=KEY (optional) highlights the matching `data-nav="KEY"` nav link.

   The old app-shell partials (app-topbar/landing/scope/filters/dash/modal/scripts) were removed
   in A33: app/app.html, app/demo.html and app/staging.html are now hand-authored Svelte mounts that
   carry no include markers, so this script leaves them untouched.

   The output is plain static HTML, so the committed pages already contain the rendered partials —
   the deploy works with or without running this. CI re-runs it and fails on drift.

   NOTE: the homepage (index.html) and admin panel (admin.html) keep their own bespoke nav/footer
   BY DESIGN (A9). They still share colors via tokens.css. */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

const nav = read('partials/nav.html').trim();
const footer = read('partials/footer.html').trim();

// Replace everything between <!-- include:NAME ... --> and <!-- /include:NAME -->
function fill(html, name, render) {
  const re = new RegExp(`(<!--\\s*include:${name}\\b([^>]*?)-->)[\\s\\S]*?(<!--\\s*/include:${name}\\s*-->)`, 'g');
  return html.replace(re, (_m, open, attrs, close) => `${open}\n  ${render((attrs || '').trim())}\n  ${close}`);
}

let changed = 0;
// A30: the info pages live under src/ now (the Vite root); the app surfaces (src/app/*.html) are
// hand-authored Svelte mounts with no include markers, so scanning the top of src/ is sufficient.
for (const dir of ['src']) {
  for (const file of readdirSync(join(root, dir)).filter(f => f.endsWith('.html'))) {
    const rel = `${dir}/${file}`;
    const src = read(rel);
    if (!src.includes('<!-- include:')) continue;

    let out = fill(src, 'nav', attrs => {
      const m = /active=([A-Za-z0-9_-]+)/.exec(attrs);
      return m ? nav.replace(`<a data-nav="${m[1]}"`, `<a data-nav="${m[1]}" class="active"`) : nav;
    });
    out = fill(out, 'footer', () => footer);

    if (out !== src) {
      writeFileSync(join(root, rel), out);
      changed++;
      console.log('updated', rel);
    }
  }
}
console.log(`build-includes: ${changed} file(s) updated`);
