import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Help > Support page (A273). Hydrates the build-time-prerendered component in
// place.
import { hydrate } from 'svelte';
import HelpSupport from '../components/HelpSupport.svelte';

hydrate(HelpSupport, { target: document.getElementById('app')! });
