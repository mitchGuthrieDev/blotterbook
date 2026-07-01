// Blotterbook — app Svelte 5 entry (ADR-001 / A27).
//
// Side-effect import of format.ts (ex assets/util.js) preserves the S14 `?k=` token strip on load
// (and the version-badge population) exactly as the vanilla surfaces got it. Then mount the Svelte app.
import '../lib/core/format.ts';
import '../styles/tailwind.css'; // A128 — Tailwind utility layer for the app surfaces (app/demo/staging)
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app')!; // the mount point exists in every app/*.html shell

// CH16 cutover: the redesigned sidebar-shell App is THE app on ALL surfaces. It is mode-aware
// internally (PAGE_MODE → real Store / seeded DemoStore / isolated staging DB), so a single mount
// covers app/demo/staging. (The pre-cutover vanilla App.svelte + src/app/components/* were deleted.)
mount(App, { target });
