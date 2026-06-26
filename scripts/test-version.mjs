/* Tests for scripts/bump-version.mjs (CH12). Run: node scripts/test-version.mjs */
import { bumpLevel, isProdShipping, classifySurfaces, computeBump, platformLabel } from './bump-version.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } };

console.log('Bump level (conventional commits):');
ok('feat → minor', bumpLevel('feat: add thing') === 'minor');
ok('feat(scope) → minor', bumpLevel('feat(staging): add thing') === 'minor');
ok('fix → patch', bumpLevel('fix: a bug') === 'patch');
ok('chore/refactor/docs → patch', ['chore: x','refactor: y','docs: z','perf: p','style: s','test: t'].every(m => bumpLevel(m) === 'patch'));
ok('feat! → major', bumpLevel('feat!: drop old API') === 'major');
ok('fix(scope)! → major', bumpLevel('fix(core)!: change shape') === 'major');
ok('BREAKING CHANGE footer → major', bumpLevel('feat: x\n\nBREAKING CHANGE: removes Y') === 'major');
ok('untyped → patch', bumpLevel('just some title') === 'patch');

console.log('\nProd-shipping classification:');
ok('shared app JS is prod', isProdShipping('app/render.js') && isProdShipping('app/core.js'));
ok('app/staging.js is NOT prod', !isProdShipping('app/staging.js'));
ok('app+demo shells + css + tokens are prod', ['app/app.html','app/demo.html','app/app.css','tokens.css'].every(isProdShipping));
ok('partials + assets + data are prod', isProdShipping('partials/app-dash.html') && isProdShipping('assets/util.js') && isProdShipping('data/brokers.json'));
ok('versions/backlog json are NOT prod', !isProdShipping('data/versions.json') && !isProdShipping('data/backlog.json'));
ok('info pages / readme / ci are NOT prod', !isProdShipping('index.html') && !isProdShipping('README.md') && !isProdShipping('.github/workflows/ci.yml'));

console.log('\nSurface selection:');
ok('shared code → both tracks', (()=>{const s=classifySurfaces(['app/render.js']);return s.prod&&s.staging;})());
ok('staging-only → staging alone', (()=>{const s=classifySurfaces(['app/staging.js']);return !s.prod&&s.staging;})());
ok('non-app only → neither', (()=>{const s=classifySurfaces(['index.html','README.md','data/backlog.json']);return !s.prod&&!s.staging;})());
ok('mixed (shared + staging) → both', (()=>{const s=classifySurfaces(['app/staging.js','app/core.js']);return s.prod&&s.staging;})());

console.log('\ncomputeBump application:');
{
  const v = { prod: '0.12.0', staging: '0.22.0' };
  const a = computeBump({ message: 'feat: x', files: ['app/render.js'], versions: v });
  ok('feat shared → prod 0.13.0 + staging 0.23.0', a.next.prod === '0.13.0' && a.next.staging === '0.23.0');
  const b = computeBump({ message: 'fix: x', files: ['app/staging.js'], versions: v });
  ok('fix staging-only → prod unchanged, staging 0.22.1', b.next.prod === '0.12.0' && b.next.staging === '0.22.1');
  const c = computeBump({ message: 'feat!: x', files: ['app/core.js'], versions: v });
  ok('major shared → prod 1.0.0 + staging 1.0.0', c.next.prod === '1.0.0' && c.next.staging === '1.0.0');
  const d = computeBump({ message: 'docs: x', files: ['README.md'], versions: v });
  ok('non-app → no change, flags false', d.next.prod === '0.12.0' && d.next.staging === '0.22.0' && !d.bumpedProd && !d.bumpedStaging);
}

console.log('\nPlatform label (derived phase):');
ok('0.x → Beta', platformLabel('0.12.0') === 'Beta 0.12.0');
ok('1.x → stable (no Beta)', platformLabel('1.0.0') === '1.0.0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
