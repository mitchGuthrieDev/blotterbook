/* Tests for scripts/bump-version.mjs (CH12). Run: node scripts/test-version.mjs */
import { bumpLevel, isProdShipping, classifySurfaces, computeBump, platformLabel } from './bump-version.mjs';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
};

console.log('Bump level (conventional commits):');
ok('feat → minor', bumpLevel('feat: add thing') === 'minor');
ok('feat(scope) → minor', bumpLevel('feat(staging): add thing') === 'minor');
ok('fix → patch', bumpLevel('fix: a bug') === 'patch');
ok(
  'chore/refactor/docs → patch',
  ['chore: x', 'refactor: y', 'docs: z', 'perf: p', 'style: s', 'test: t'].every(m => bumpLevel(m) === 'patch')
);
ok('feat! → major', bumpLevel('feat!: drop old API') === 'major');
ok('fix(scope)! → major', bumpLevel('fix(core)!: change shape') === 'major');
ok('BREAKING CHANGE footer → major', bumpLevel('feat: x\n\nBREAKING CHANGE: removes Y') === 'major');
ok('untyped → patch', bumpLevel('just some title') === 'patch');

console.log('\nProd-shipping classification:');
ok('shared app JS is prod', isProdShipping('src/lib/adapters.ts') && isProdShipping('src/lib/core.ts'));
ok(
  'Svelte SPA modules ARE prod (A59 — shared by all surfaces post-A33)',
  isProdShipping('src/app/App.svelte') && isProdShipping('src/app/components/EquityCurve.svelte')
);
ok('app/staging.html is NOT prod', !isProdShipping('src/app/staging.html'));
ok('app+demo shells + tokens are prod', ['src/app/app.html', 'src/app/demo.html', 'src/styles/tokens.css'].every(isProdShipping));
ok(
  'A128: $ui primitives + the Tailwind entry CSS are prod (shared design system)',
  ['src/ui/button/button.svelte', 'src/ui/select/select-trigger.svelte', 'src/ui/utils.ts', 'src/styles/tailwind.css'].every(isProdShipping)
);
ok('A128: an ambient .d.ts ships nothing (no bump)', !isProdShipping('src/vite-env.d.ts'));
ok(
  'site Svelte page is prod-only (A69 — marketing/info ships to prod, not staging)',
  isProdShipping('src/site/components/Home.svelte') === false &&
    classifySurfaces(['src/site/components/Home.svelte']).prod &&
    !classifySurfaces(['src/site/components/Home.svelte']).staging
);
ok(
  'shared site chrome (Nav.svelte) is prod-only',
  classifySurfaces(['src/site/lib/Nav.svelte']).prod && !classifySurfaces(['src/site/lib/Nav.svelte']).staging
);
ok(
  'Admin.svelte / admin entry are NEITHER track (A69 — internal, Access-gated)',
  !classifySurfaces(['src/site/components/Admin.svelte']).prod &&
    !classifySurfaces(['src/site/components/Admin.svelte']).staging &&
    !classifySurfaces(['src/site/entries/admin.ts']).prod
);
ok(
  'bundled chrome + core + data are prod',
  isProdShipping('src/assets/favicon.svg') && isProdShipping('src/lib/format.ts') && isProdShipping('static/data/brokers.json')
);
ok(
  'versions/backlog/backlog_archive json are NOT prod',
  !isProdShipping('static/data/versions.json') &&
    !isProdShipping('static/data/backlog.json') &&
    !isProdShipping('static/data/backlog_archive.json')
);
ok('changelog.json is NOT prod (CH31 — notes must not self-bump)', !isProdShipping('static/data/changelog.json'));
ok(
  'info pages / readme / ci are NOT prod',
  !isProdShipping('src/index.html') && !isProdShipping('README.md') && !isProdShipping('.github/workflows/ci.yml')
);

console.log('\nSurface selection:');
ok(
  'shared code → both tracks',
  (() => {
    const s = classifySurfaces(['src/app/App.svelte']);
    return s.prod && s.staging;
  })()
);
ok(
  'staging-only → staging alone',
  (() => {
    const s = classifySurfaces(['src/app/staging.html']);
    return !s.prod && s.staging;
  })()
);
ok(
  'homepage/info pages → prod only (B16)',
  (() => {
    const s = classifySurfaces(['src/index.html']);
    return s.prod && !s.staging;
  })()
);
ok(
  'a site component + an info page → prod only',
  (() => {
    const s = classifySurfaces(['src/site/lib/SiteShell.svelte', 'src/howto.html']);
    return s.prod && !s.staging;
  })()
);
ok(
  'admin.html / README / backlog(+archive) → neither',
  (() => {
    const s = classifySurfaces(['src/admin.html', 'README.md', 'static/data/backlog.json', 'static/data/backlog_archive.json']);
    return !s.prod && !s.staging;
  })()
);
ok(
  'mixed (shared + staging) → both',
  (() => {
    const s = classifySurfaces(['src/app/staging.html', 'src/lib/core.ts']);
    return s.prod && s.staging;
  })()
);
ok(
  'mixed (homepage + staging-only) → both',
  (() => {
    const s = classifySurfaces(['src/index.html', 'src/app/staging.html']);
    return s.prod && s.staging;
  })()
);
ok(
  'changelog-only → neither track (CH31)',
  (() => {
    const s = classifySurfaces(['static/data/changelog.json']);
    return !s.prod && !s.staging;
  })()
);
ok(
  'changelog + a real prod-shipping change → still both (CH31)',
  (() => {
    const s = classifySurfaces(['static/data/changelog.json', 'src/lib/core.ts']);
    return s.prod && s.staging;
  })()
);

console.log('\ncomputeBump application:');
{
  const v = { prod: '0.12.0', staging: '0.22.0' };
  const a = computeBump({ message: 'feat: x', files: ['src/app/App.svelte'], versions: v });
  ok('feat shared → prod 0.13.0 + staging 0.23.0', a.next.prod === '0.13.0' && a.next.staging === '0.23.0');
  const b = computeBump({ message: 'fix: x', files: ['src/app/staging.html'], versions: v });
  ok('fix staging-only → prod unchanged, staging 0.22.1', b.next.prod === '0.12.0' && b.next.staging === '0.22.1');
  const c = computeBump({ message: 'feat!: x', files: ['src/lib/core.ts'], versions: v });
  ok('major shared → prod 1.0.0 + staging 1.0.0', c.next.prod === '1.0.0' && c.next.staging === '1.0.0');
  const d = computeBump({ message: 'docs: x', files: ['README.md'], versions: v });
  ok('non-app → no change, flags false', d.next.prod === '0.12.0' && d.next.staging === '0.22.0' && !d.bumpedProd && !d.bumpedStaging);
  const e = computeBump({ message: 'docs(changelog): notes', files: ['static/data/changelog.json'], versions: v });
  ok('changelog-only → no bump (CH31)', e.next.prod === '0.12.0' && e.next.staging === '0.22.0' && !e.bumpedProd && !e.bumpedStaging);
}

console.log('\nPlatform label (derived phase):');
ok('0.x → Beta', platformLabel('0.12.0') === 'Beta 0.12.0');
ok('1.x → stable (no Beta)', platformLabel('1.0.0') === '1.0.0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
