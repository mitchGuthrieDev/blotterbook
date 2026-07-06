// Motion helpers (A146). One switch for the Svelte-transition side of reduced motion: durations
// collapse to 0 when the user asks for reduced motion, so enter/exit effects become instant
// without branching at every call site. The CSS-animation side (tw-animate-css on the shadcn
// primitives) is flattened by the matching @media rule in src/styles/tailwind.css.
//
// A249: queried LIVE (not frozen at module load) — matchMedia() is cheap, and every call site is a
// `dur(ms)` inside a transition/animate directive (evaluated each time the transition fires), so a
// mid-session `prefers-reduced-motion` change now takes effect on the next transition rather than
// being permanently frozen to whatever it was at boot.
export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A transition duration honoring prefers-reduced-motion (checked live — see reducedMotion above). */
export const dur = (ms: number) => (reducedMotion() ? 0 : ms);
