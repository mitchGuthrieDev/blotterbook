"use strict";
/* Shared tiny utilities, loaded as a classic global script before any page's own scripts.
   Single source for HTML escaping across the app, the info pages, and the admin panel (A7). */

/* Escape text for safe interpolation into HTML — including BOTH quote characters, so a value
   placed inside a "double-" or 'single-quoted' attribute can't break out of it. */
function esc(s){
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
