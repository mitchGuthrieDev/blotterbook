import { esc } from '../../lib/format.ts';

(function () {
  var log = document.getElementById('log'),
    status = document.getElementById('clstatus');

  /* F13: the changelog reads from a curated, version-keyed release-notes file
     (data/changelog.json, prod track) instead of raw commit titles — that file is the source
     of truth. The inline fallback below is a deliberately-minimal degraded-state notice for
     local dev / a failed fetch; it is INTENTIONALLY NOT kept in lockstep with releases (CH24),
     so its versions will lag the live changelog and that's expected, not a bug to chase. */
  var FALLBACK = [
    {
      version: '0.14.2',
      date: '2026-06-26',
      title: 'Stability & security pass',
      summary:
        'A sweep of fixes from an internal audit — tightening up the calendar, your data, and the behind-the-scenes release machinery.',
    },
    {
      version: '0.12.0',
      date: '2026-06-24',
      beta: true,
      title: 'Beta released',
      summary: 'The first public Beta of Blotterbook — a fast, private, browser-based futures-trading journal.',
    },
  ];

  /* Render an ISO date (YYYY-MM-DD) as "Jun 26, 2026" without pulling in a tz/locale
     surprise — parse the parts directly so it reads the same everywhere. */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return String(s || '');
    return MONTHS[+m[2] - 1] + ' ' + +m[3] + ', ' + m[1];
  }

  function render(releases, live) {
    log.innerHTML = releases
      .map(function (r, i) {
        var hl =
          r.highlights && r.highlights.length
            ? '<ul class="highlights">' +
              r.highlights
                .map(function (h) {
                  return '<li>' + esc(h) + '</li>';
                })
                .join('') +
              '</ul>'
            : '';
        return (
          '<div class="entry' +
          (i === 0 ? ' first' : '') +
          (r.beta ? ' beta' : '') +
          '">' +
          '<div class="meta">' +
          '<span class="ver">v' +
          esc(r.version) +
          '</span>' +
          '<span class="date">' +
          esc(fmtDate(r.date)) +
          '</span>' +
          (i === 0 ? '<span class="latest">Latest</span>' : '') +
          '</div>' +
          '<h3>' +
          esc(r.title) +
          '</h3>' +
          (r.summary ? '<p class="summary">' + esc(r.summary) + '</p>' : '') +
          hl +
          '</div>'
        );
      })
      .join('');
    if (status) status.textContent = live ? 'Release notes · prod track' : 'Showing the last saved snapshot';
  }

  render(FALLBACK, false);

  /* Curated release notes — a static, hash-cache-busted data file (no GitHub API). */
  fetch('/data/changelog.json', { headers: { Accept: 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function (d) {
      if (d && Array.isArray(d.releases) && d.releases.length) render(d.releases, true);
    })
    .catch(function () {
      /* keep the fallback already rendered */
    });
})();
