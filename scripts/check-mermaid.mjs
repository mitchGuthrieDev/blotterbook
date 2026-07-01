// Mermaid drift gate (docs-only). Extracts every ```mermaid fenced block under docs/ and validates
// it with Mermaid's OWN parser, so a diagram that no longer parses fails CI instead of silently
// rendering as an error box on GitHub. Parse-only (no image output) — fast, deterministic.
//
// Reuses the Playwright chromium that CI already installs for the e2e job (mermaid needs a DOM), so
// this adds only the lightweight `mermaid` lib as a devDependency — not a second headless browser.
//
// Usage: node scripts/check-mermaid.mjs   (also: npm run check-mermaid)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(ROOT, 'docs');
const MERMAID_UMD = join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js');

/** Recursively collect every *.md under a directory. */
function mdFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Pull ```mermaid … ``` blocks out of markdown, tracking the block's start line for error output. */
function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let inBlock = false;
  let start = 0;
  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^```mermaid\s*$/.test(line.trim())) {
      inBlock = true;
      start = i + 1; // 1-indexed line of the ```mermaid fence
      buf = [];
    } else if (inBlock && line.trim() === '```') {
      blocks.push({ startLine: start, code: buf.join('\n') });
      inBlock = false;
    } else if (inBlock) {
      buf.push(line);
    }
  }
  return blocks;
}

const files = mdFiles(DOCS);
const tasks = [];
for (const file of files) {
  const blocks = extractBlocks(readFileSync(file, 'utf8'));
  for (const b of blocks) tasks.push({ file, ...b });
}

if (tasks.length === 0) {
  console.log('check-mermaid: no ```mermaid blocks found under docs/ — nothing to validate.');
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: MERMAID_UMD });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));

const failures = [];
for (const t of tasks) {
  const err = await page.evaluate(async code => {
    try {
      // mermaid.parse throws on a syntax error (suppressErrors defaults to false).
      await window.mermaid.parse(code);
      return null;
    } catch (e) {
      return String((e && e.message) || e);
    }
  }, t.code);
  const where = `${relative(ROOT, t.file)}:${t.startLine}`;
  if (err) {
    failures.push({ where, err });
    console.error(`✗ ${where}\n  ${err.split('\n').join('\n  ')}`);
  } else {
    console.log(`✓ ${where}`);
  }
}

await browser.close();

console.log(`\ncheck-mermaid: ${tasks.length} diagram(s), ${failures.length} invalid.`);
process.exit(failures.length ? 1 : 0);
