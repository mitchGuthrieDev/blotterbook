// ESLint flat config — DEV-ONLY (R19 Tier A). Catches real bugs (undeclared names,
// duplicate keys, unreachable code, …) without fighting the codebase's intentionally
// terse, hand-written style. Never runs at deploy; the shipped app stays dependency-free.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'dist/**', 'build/**'] },

  js.configs.recommended,

  // Shared relaxations for the whole hand-written codebase.
  {
    rules: {
      // Surface unused names as warnings (not CI-failing): the code keeps a few intentional
      // ones; `_`-prefixed and unused fn args are ignored, matching the house style.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      // The codebase uses empty `catch (_) {}` deliberately (best-effort/fail-soft paths).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Browser-served scripts (native ES modules). After the A30 reorg the only remaining .js under
  // src/ is the marketing/info JS (src/site/**) — the typed core/app are .ts/.svelte (skipped by
  // ESLint; type-checked by tsc/svelte-check, tracked as A79). ESLint lints .js by default.
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
  },

  // Cloudflare Pages Functions — Workers runtime (Response/Request/crypto/fetch/URL/…)
  // plus a few Node-ish globals. NOTE (A78): the functions are now TypeScript (.ts). ESLint
  // can't parse .ts without typescript-eslint, which doesn't yet support ESLint 10 (peer-dep
  // conflict) — so .ts files are skipped by ESLint for now and type-checked by
  // `tsc -p tsconfig.functions.json` instead (tracked as A79). This block stays a .js glob so
  // espree never tries to parse the .ts (it would error); it re-activates once .ts linting lands.
  {
    files: ['functions/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
  },

  // Node tooling: build scripts, the test suite, and the config files themselves.
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },

  // Playwright e2e specs run in Node, but their page.evaluate() callbacks reference browser
  // globals (document, getComputedStyle, …) — so allow both.
  {
    files: ['e2e/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
