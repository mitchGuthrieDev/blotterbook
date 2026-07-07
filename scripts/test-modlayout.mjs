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

console.log(`\n${pass} assertions passed.`);
