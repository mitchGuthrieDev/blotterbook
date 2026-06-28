// Shared browser-side helpers for the Svelte app (DOM helpers, NOT pure core — those stay in
// core.js). Hoisted from the components (A41) so the FileReader read + blob-download patterns live
// in one place and can't drift.

// Read a File as a base64 data URL; resolves null on error (callers gate the result through
// store.validShot before persisting — S15/S18).
export const readImage = (file: Blob): Promise<string | null> =>
  new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result as string | null);
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });

// Trigger a download of a Blob under `name`. Revokes the object URL on the next tick so the click
// has a chance to start (the safer of the two patterns the components previously used).
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
