/* Behavior for the standalone Performance Report opened by the main-app / demo Export
   (export.js, non-staging path). Loaded as an EXTERNAL script so it runs under the
   strict CSP (script-src 'self') the report inherits from the opener — inline scripts
   and on*= handlers would be blocked. Per-report data (download filename + mailto draft)
   is passed in a non-executable <script type="application/json" id="rdata"> block. */
(function () {
  function $(id) { return document.getElementById(id); }
  var d = {};
  try { d = JSON.parse(($('rdata') || {}).textContent || '{}'); } catch (_) {}
  var RFNAME = d.fname || 'blotterbook-report.html';
  var RMAILTO = d.mailto || 'mailto:';

  var dl = $('r_download');
  if (dl) dl.addEventListener('click', function () {
    // Serialize the report minus the toolbar + all <script> tags -> a clean static HTML file.
    var clone = document.documentElement.cloneNode(true);
    var bar = clone.querySelector('.bar'); if (bar) bar.remove();
    clone.querySelectorAll('script').forEach(function (s) { s.remove(); });
    var html = '<!DOCTYPE html>\n' + clone.outerHTML;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = RFNAME;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  });

  var em = $('r_email');
  if (em) em.addEventListener('click', function () { window.location.href = RMAILTO; });

  var cl = $('r_close');
  if (cl) cl.addEventListener('click', function () { window.close(); });
})();
