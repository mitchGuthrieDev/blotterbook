// Client entry for the Changelog page (A69). Hydrates the build-time-prerendered component (whose
// SSR markup is the inline fallback) in place; onMount then fetches the live release notes.
import { hydrate } from 'svelte';
import Changelog from '../components/Changelog.svelte';

hydrate(Changelog, { target: document.getElementById('app')! });
