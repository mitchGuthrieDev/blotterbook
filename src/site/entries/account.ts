import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the Account Dashboard page (A293). Hydrates the build-time-prerendered frame in
// place; the account state itself is session-dependent, so it loads client-side from /api/me after
// hydration (the prerendered HTML shows the loading skeleton).
import { hydrate } from 'svelte';
import AccountDash from '../components/AccountDash.svelte';

hydrate(AccountDash, { target: document.getElementById('app')! });
