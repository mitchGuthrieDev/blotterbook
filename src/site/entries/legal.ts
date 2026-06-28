// Client entry for the Legal page (A69). Hydrates the build-time-prerendered Legal component in
// place so first paint + SEO come from the static SSR HTML (vite-ssg.mjs) and interactivity (the
// CSS-only mobile menu aside, none here) attaches without a re-render.
import { hydrate } from 'svelte';
import Legal from '../components/Legal.svelte';

hydrate(Legal, { target: document.getElementById('app')! });
