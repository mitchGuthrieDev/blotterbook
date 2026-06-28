// Blotterbook — staging Svelte 5 entry (ADR-001 / A27).
//
// Side-effect import of format.ts (ex assets/util.js) preserves the S14 `?k=` token strip on load
// (and the version-badge population) exactly as the vanilla surfaces got it. Then mount the Svelte app.
import '../lib/format.ts';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app')!; // the mount point exists in every app/*.html shell
mount(App, { target });
