import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Help hub page (A273). Hydrates the build-time-prerendered HelpHome component
// in place so first paint + SEO come from the static SSR HTML (vite-ssg.mjs) and interactivity (the
// CSS-only mobile contents toggle, none here) attaches without a re-render.
import { hydrate } from 'svelte';
import HelpHome from '../components/HelpHome.svelte';

hydrate(HelpHome, { target: document.getElementById('app')! });
