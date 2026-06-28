// Client entry for the Roadmap page (A69). Hydrates the build-time-prerendered component in place.
import { hydrate } from 'svelte';
import Roadmap from '../components/Roadmap.svelte';

hydrate(Roadmap, { target: document.getElementById('app')! });
