import '../../styles/tailwind.css'; // A128 — Tailwind utility layer for the marketing/info SSG pages
// Client entry for the How-To page (A69). Hydrates the build-time-prerendered component in place.
import { hydrate } from 'svelte';
import Howto from '../components/Howto.svelte';

hydrate(Howto, { target: document.getElementById('app')! });
