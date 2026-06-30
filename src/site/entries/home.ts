import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the homepage (A69). Hydrates the build-time-prerendered Home component in place
// so the marketing hero is static HTML (SEO + first paint) and the scroll/feature/live-pill logic
// attaches on hydration.
import { hydrate } from 'svelte';
import Home from '../components/Home.svelte';

hydrate(Home, { target: document.getElementById('app')! });
