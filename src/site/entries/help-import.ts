import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Help > Importing Your Trades page (A273; ex howto.ts). Hydrates the
// build-time-prerendered component in place.
import { hydrate } from 'svelte';
import HelpImport from '../components/HelpImport.svelte';

hydrate(HelpImport, { target: document.getElementById('app')! });
