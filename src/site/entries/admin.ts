import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the admin panel (A69). Hydrates the build-time-prerendered component (whose SSR
// markup is the initial loading state) in place; onMount then issues the Access token and fetches
// status/config/versions/backlog.
import { hydrate } from 'svelte';
import Admin from '../components/Admin.svelte';

hydrate(Admin, { target: document.getElementById('app')! });
