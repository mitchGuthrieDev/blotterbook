import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Help > Getting Started page (A273). Hydrates the build-time-prerendered
// component in place.
import { hydrate } from 'svelte';
import HelpGettingStarted from '../components/HelpGettingStarted.svelte';

hydrate(HelpGettingStarted, { target: document.getElementById('app')! });
