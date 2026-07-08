import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Help > Cloud Sync page (A273). Hydrates the build-time-prerendered component
// in place.
import { hydrate } from 'svelte';
import HelpCloudSync from '../components/HelpCloudSync.svelte';

hydrate(HelpCloudSync, { target: document.getElementById('app')! });
