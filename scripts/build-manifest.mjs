#!/usr/bin/env node
/**
 * Build a cache-busting manifest for the reference-data JSON files.
 *
 * For each /data/*.json (except manifest.json) it computes a short SHA-256
 * content hash and writes /data/manifest.json mapping filename -> hash.
 *
 * The app fetches manifest.json with no-cache, then requests each data file
 * as `<file>?v=<hash>`. Because the URL changes only when the file's bytes
 * change, the data files themselves can be cached indefinitely by the browser
 * and Cloudflare's edge, while edits still take effect immediately.
 *
 * Run after editing any data file:   node scripts/build-manifest.mjs
 * (Also a good Cloudflare Pages build command.)
 *
 * Uses only Node built-ins — no dependencies.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const MANIFEST = 'manifest.json';
// Only the reference-data files the app fetches with `?v=<hash>` need a manifest entry.
// backlog.json (admin-only), versions.json (CH12 — bumped on every merge, fetched
// no-store), and changelog.json (F13 — curated release notes fetched directly by the
// changelog page) are excluded so the manifest doesn't churn on every content edit.
const EXCLUDE = new Set([MANIFEST, 'backlog.json', 'versions.json', 'changelog.json']);

const names = (await readdir(dataDir))
  .filter(n => n.endsWith('.json') && !EXCLUDE.has(n))
  .sort();

const files = {};
for (const name of names) {
  const bytes = await readFile(join(dataDir, name));
  files[name] = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

// No timestamp/non-deterministic fields: the manifest is a pure function of the data
// files' bytes, so re-running it produces no diff (lets CI assert generated outputs are
// committed). The app only reads `files`; it cache-busts the manifest fetch itself.
const manifest = {
  schemaVersion: 1,
  files
};

await writeFile(join(dataDir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${MANIFEST} for ${names.length} file(s):`);
for (const [n, h] of Object.entries(files)) console.log(`  ${n}  ${h}`);
