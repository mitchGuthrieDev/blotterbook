// ESLint flat config — DEV-ONLY (R19 Tier A). Catches real bugs (undeclared names,
// duplicate keys, unreachable code, …) without fighting the codebase's intentionally
// terse, hand-written style. Never runs at deploy; the shipped app stays minimal-dep.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// House-style rules for the hand-written TypeScript tree (the pure-logic core + Svelte app glue
// under src/, and the Cloudflare Pages Functions under functions/). tsc / svelte-check own type
// checking and undefined-name resolution, so ESLint here only adds the lint-style bug checks from
// js.configs.recommended, with the @typescript-eslint/no-unused-vars variant matching the JS house
// style. Kept MINIMAL (A79/A28) — NOT the opinionated typescript-eslint recommended set.
const tsRules = {
  // tsc resolves names/globals/types; the core rule false-positives on type-only references.
  'no-undef': 'off',
  // Replaced by the TS-aware variant so type-only and `_`-prefixed names aren't flagged.
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
};

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

  // TypeScript — the pure-logic core + Svelte app glue (src/**/*.ts, browser runtime). A79:
  // typescript-eslint 8.62 added ESLint 10 support, so .ts is now linted (was tsc-only). The parser
  // handles TS syntax; rules stay minimal. (.svelte components are type-checked by svelte-check.)
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: tsRules,
  },

  // Cloudflare Pages Functions — Workers runtime (Response/Request/crypto/fetch/URL/…) plus a few
  // Node-ish globals. TypeScript since A78; linted via typescript-eslint since A79 (was tsc-only,
  // `tsc -p tsconfig.functions.json`).
  {
    files: ['functions/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: tsRules,
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

  // check-mermaid.mjs drives a Playwright chromium page; its page.evaluate() callbacks reference
  // browser globals (window/mermaid), same as the e2e specs — allow both here too.
  {
    files: ['scripts/check-mermaid.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
