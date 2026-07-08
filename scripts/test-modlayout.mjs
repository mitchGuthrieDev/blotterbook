/* A271 — dashboard module layout migration + size math (src/app/lib/modlayout.ts). The persisted
   layout upgrades from the v1 `string[]` to a versioned `{ v:2, mods:[{key,size}] }` LOSSLESSLY, and
   the upgrade must preserve today's visual layout (paired/half-width → md, others → lg). Run:
   node scripts/test-modlayout.mjs */
import assert from 'node:assert/strict';

const m = await import('../src/app/lib/modlayout.ts');
const { migrateLayout, defaultSizeFor, spanFor, clampSize, validLayout, keysOf, defaultLayout, DEFAULT_MODULE_KEYS } = m;

let pass = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`  ok  ${name}`);
  pass++;
};
const J = v => JSON.stringify(v);

// defaultSizeFor preserves today's layout: paired half-width → md, full-width → lg.
ok('defaultSizeFor: full-width perf → lg', defaultSizeFor('perf') === 'lg');
ok(
  'defaultSizeFor: paired cal/cost/adv/term → md',
  ['cal', 'cost', 'adv', 'term'].every(k => defaultSizeFor(k) === 'md')
);
ok('defaultSizeFor: full-width compare/blotter → lg', defaultSizeFor('compare') === 'lg' && defaultSizeFor('blotter') === 'lg');

// spanFor: 12-track grid spans.
ok('spanFor: sm=2, md=6, lg=12', spanFor('sm') === 2 && spanFor('md') === 6 && spanFor('lg') === 12);

// null/undefined → undefined (= default layout).
ok('migrateLayout(null/undefined) → undefined', migrateLayout(null) === undefined && migrateLayout(undefined) === undefined);

// v1 string[] upgrades with the layout-preserving default sizes.
ok(
  'migrateLayout(v1 string[]) → v2 with default sizes (LAYOUT PRESERVED)',
  J(migrateLayout(['perf', 'cal', 'cost'])) ===
    J({
      v: 2,
      mods: [
        { key: 'perf', size: 'lg' },
        { key: 'cal', size: 'md' },
        { key: 'cost', size: 'md' },
      ],
    })
);

// v1 drops unknown keys.
ok('migrateLayout(v1) drops unknown keys', J(migrateLayout(['perf', 'bogus', 'cal']).mods.map(e => e.key)) === J(['perf', 'cal']));

// v2 passes through, honoring an explicit (supported) stored size.
ok(
  'migrateLayout(v2) honors an explicit supported size',
  J(migrateLayout({ v: 2, mods: [{ key: 'perf', size: 'md' }] })) === J({ v: 2, mods: [{ key: 'perf', size: 'md' }] })
);

// v2 clamps an unsupported/garbage size to the module default; drops unknown keys.
ok(
  'migrateLayout(v2) clamps a bad size to the default',
  migrateLayout({ v: 2, mods: [{ key: 'perf', size: 'huge' }] }).mods[0].size === 'lg'
);
ok('migrateLayout(v2) drops unknown keys', J(migrateLayout({ v: 2, mods: [{ key: 'bogus', size: 'sm' }] }).mods) === J([]));

// garbage / non-array non-v2 → undefined.
ok(
  'migrateLayout(garbage) → undefined',
  migrateLayout('nope') === undefined && migrateLayout({ v: 1 }) === undefined && migrateLayout(42) === undefined
);

// clampSize direct: a supported size passes; an unsupported (sm today) or garbage size → the default.
ok(
  'clampSize: supported passes, unsupported/invalid → default',
  clampSize('perf', 'md') === 'md' && clampSize('perf', 'sm') === 'lg' && clampSize('perf', 'x') === 'lg'
);

// defaultLayout / keysOf round-trip the default order.
ok('defaultLayout keys === DEFAULT_MODULE_KEYS', J(keysOf(defaultLayout().mods)) === J(DEFAULT_MODULE_KEYS));

// validLayout drops unknown + clamps, and undefined → the default layout.
ok('validLayout(undefined) → default layout', J(keysOf(validLayout(undefined))) === J(DEFAULT_MODULE_KEYS));
ok(
  'validLayout drops unknown key + clamps bad size',
  J(
    validLayout([
      { key: 'perf', size: 'bad' },
      { key: 'bogus', size: 'sm' },
    ])
  ) === J([{ key: 'perf', size: 'lg' }])
);

// ── A271 slice: makeLayoutKit + the Analytics domain ─────────────────────────────────────────────
const { makeLayoutKit, analyticsKit, analyticsDefaultSizeFor, ANALYTICS_DEFAULT_KEYS } = m;

// analyticsDefaultSizeFor preserves today's Analytics layout: full-width (dist/sym/tag/stats) → lg,
// the paired half-width cards (dd/ls/hour/wday) → md.
ok(
  'analyticsDefaultSizeFor: full-width dist/sym/tag/stats → lg',
  ['dist', 'sym', 'tag', 'stats'].every(k => analyticsDefaultSizeFor(k) === 'lg')
);
ok(
  'analyticsDefaultSizeFor: paired dd/ls/hour/wday → md',
  ['dd', 'ls', 'hour', 'wday'].every(k => analyticsDefaultSizeFor(k) === 'md')
);

// analyticsKit.migrateLayout upgrades a v1 string[] with the layout-preserving default sizes.
ok(
  'analyticsKit.migrateLayout(v1 string[]) → v2 with default sizes (LAYOUT PRESERVED)',
  J(analyticsKit.migrateLayout(['dist', 'dd', 'sym'])) ===
    J({
      v: 2,
      mods: [
        { key: 'dist', size: 'lg' },
        { key: 'dd', size: 'md' },
        { key: 'sym', size: 'lg' },
      ],
    })
);

// analyticsKit drops keys the analytics domain doesn't know (incl. dashboard-only keys).
ok(
  'analyticsKit.migrateLayout drops unknown/foreign keys',
  J(analyticsKit.migrateLayout(['dist', 'perf', 'bogus', 'wday']).mods.map(e => e.key)) === J(['dist', 'wday'])
);

// analyticsKit honors an explicit supported size + clamps garbage to the domain default.
ok(
  'analyticsKit.migrateLayout(v2) honors md and clamps garbage on a full-width key',
  analyticsKit.migrateLayout({ v: 2, mods: [{ key: 'dist', size: 'md' }] }).mods[0].size === 'md' &&
    analyticsKit.migrateLayout({ v: 2, mods: [{ key: 'dist', size: 'sm' }] }).mods[0].size === 'lg'
);

// analyticsKit.defaultLayout / validLayout round-trip the full analytics set at default sizes.
ok(
  'analyticsKit.defaultLayout keys === ANALYTICS_DEFAULT_KEYS',
  J(keysOf(analyticsKit.defaultLayout().mods)) === J(ANALYTICS_DEFAULT_KEYS)
);
ok(
  'analyticsKit.validLayout(undefined) → the full default analytics layout',
  J(keysOf(analyticsKit.validLayout(undefined))) === J(ANALYTICS_DEFAULT_KEYS)
);

// makeLayoutKit is a general factory — an ad-hoc single-key domain migrates/validates on its own terms.
const kit = makeLayoutKit({
  keys: ['a', 'b'],
  defaultKeys: ['a', 'b'],
  defaultSizeFor: () => 'md',
  supportedSizes: () => ['sm', 'md', 'lg'],
});
ok('makeLayoutKit: ad-hoc domain honors its own supported sizes', kit.clampSize('a', 'sm') === 'sm' && kit.clampSize('a', 'x') === 'md');
ok(
  'makeLayoutKit: ad-hoc domain drops keys outside its own set',
  J(kit.migrateLayout(['a', 'perf', 'b']).mods.map(e => e.key)) === J(['a', 'b'])
);

// The dashboard exports are UNCHANGED by the refactor — a dashboard-only key still round-trips, and an
// analytics key is foreign to the dashboard kit (proves the two domains are isolated).
ok(
  'dashboard migrateLayout unchanged: perf survives, dist is foreign',
  J(migrateLayout(['perf', 'dist']).mods.map(e => e.key)) === J(['perf'])
);

// ── A320: duplicated keys in a stored layout are dropped (first occurrence wins) — a corrupted /
// tampered Store.local value must never reach the screens' keyed {#each} blocks with a repeat. ──
ok('migrateLayout(v1) dedupes a repeated key', J(migrateLayout(['perf', 'cal', 'perf']).mods.map(e => e.key)) === J(['perf', 'cal']));
ok(
  'migrateLayout(v2) dedupes a repeated key (first size wins)',
  J(
    migrateLayout({
      v: 2,
      mods: [
        { key: 'cal', size: 'lg' },
        { key: 'cal', size: 'md' },
      ],
    }).mods
  ) === J([{ key: 'cal', size: 'lg' }])
);
ok(
  'validLayout dedupes a repeated key',
  J(
    validLayout([
      { key: 'perf', size: 'lg' },
      { key: 'perf', size: 'md' },
      { key: 'cal', size: 'md' },
    ])
  ) ===
    J([
      { key: 'perf', size: 'lg' },
      { key: 'cal', size: 'md' },
    ])
);

// ── A320: the key + label tables are the single source — the kits' key sets derive from them, so a
// module added to a screen table is automatically known to that screen's migration (drift gate). ──
const { DASHBOARD_MODULES, MODULE_KEYS, ANALYTICS_MODULES, ANALYTICS_MODULE_KEYS, labelsOf } = m;
ok('DASHBOARD_MODULES ↔ MODULE_KEYS derive in lockstep', J(DASHBOARD_MODULES.map(d => d.key)) === J(MODULE_KEYS));
ok('ANALYTICS_MODULES ↔ ANALYTICS_MODULE_KEYS derive in lockstep', J(ANALYTICS_MODULES.map(d => d.key)) === J(ANALYTICS_MODULE_KEYS));
ok(
  'every default key is a known key with a non-empty label',
  DEFAULT_MODULE_KEYS.every(k => MODULE_KEYS.includes(k)) &&
    ANALYTICS_DEFAULT_KEYS.every(k => ANALYTICS_MODULE_KEYS.includes(k)) &&
    [...DASHBOARD_MODULES, ...ANALYTICS_MODULES].every(d => typeof d.label === 'string' && d.label.length > 0)
);
ok('labelsOf builds the key→label map', labelsOf(ANALYTICS_MODULES).dist === 'P&L distribution (per trade)');

// ── A271 remainder: the glanceable Small slice — KPI cards + the F39 trio. ──────────────────────
const { supportedSizes, KPI_MODULE_KEYS } = m;
ok(
  'KPI cards are registered keys',
  ['winrate', 'pfactor', 'expect'].every(k => MODULE_KEYS.includes(k))
);
ok(
  'KPI cards are NOT in the default layout (picker-addable)',
  ['winrate', 'pfactor', 'expect'].every(k => !DEFAULT_MODULE_KEYS.includes(k))
);
ok('KPI_MODULE_KEYS matches the registered KPI cards', J([...KPI_MODULE_KEYS].sort()) === J(['expect', 'pfactor', 'winrate']));
ok(
  'KPI cards default to Small',
  ['winrate', 'pfactor', 'expect'].every(k => defaultSizeFor(k) === 'sm')
);
ok(
  'KPI cards support sm/md only (no full-width KPI number)',
  ['winrate', 'pfactor', 'expect'].every(k => J(supportedSizes(k)) === J(['sm', 'md']))
);
ok(
  'the F39 trio gains Small (sm/md/lg)',
  ['today', 'ddstatus', 'streak'].every(k => J(supportedSizes(k)) === J(['sm', 'md', 'lg']))
);
ok(
  '...but their default stays md (existing layouts preserved)',
  ['today', 'ddstatus', 'streak'].every(k => defaultSizeFor(k) === 'md')
);
ok(
  'rich modules still refuse Small',
  ['perf', 'cal', 'cost', 'adv', 'term', 'compare', 'blotter'].every(k => J(supportedSizes(k)) === J(['md', 'lg']))
);
ok('clampSize: sm on a rich module falls back to its default', clampSize('perf', 'sm') === 'lg' && clampSize('cal', 'sm') === 'md');
ok('clampSize: sm on a KPI card sticks', clampSize('winrate', 'sm') === 'sm');
ok(
  'a persisted layout that predates the KPI cards is untouched by migration (no auto-injection)',
  J(keysOf(migrateLayout(['perf', 'cal']).mods)) === J(['perf', 'cal']) &&
    J(keysOf(migrateLayout({ v: 2, mods: [{ key: 'perf', size: 'lg' }] }).mods)) === J(['perf'])
);
ok(
  'a v2 layout carrying a KPI card round-trips (sm preserved)',
  J(migrateLayout({ v: 2, mods: [{ key: 'winrate', size: 'sm' }] }).mods) === J([{ key: 'winrate', size: 'sm' }])
);

console.log(`\n${pass} assertions passed.`);
