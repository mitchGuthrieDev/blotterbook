// Blotterbook — staging Svelte 5 entry (ADR-001 / A27).
//
// Side-effect import of util.js preserves the S14 `?k=` token strip on load (and any version
// badge population) exactly as the vanilla surfaces get it. Then mount the Svelte app.
import '../../assets/util.js';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
mount(App, { target });
