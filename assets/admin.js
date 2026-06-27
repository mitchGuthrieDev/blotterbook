import { esc, platformLabel } from './util.js';

(function () {
  // The admin token (S3) is a live credential — keep it in the page-session field only,
  // never localStorage (S10), so an XSS can't lift a persisted token. autoKey() re-issues
  // a fresh token on each load via Access; a manually-typed raw key just isn't remembered.
  var keyInput = document.getElementById('adminkey');
  var labelInput = document.getElementById('label');
  var msg = document.getElementById('amsg');
  var cur = document.getElementById('curstate');
  var authnote = document.getElementById('authnote');

  function setMsg(t, kind) {
    msg.textContent = t || '';
    msg.className = 'amsg' + (kind ? ' ' + kind : '');
  }
  function mark(mode) {
    document.querySelectorAll('.modebtn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
  }

  // Fetch with an 8s timeout so a hung/slow endpoint falls into its .catch (e.g. shows
  // "unavailable") instead of leaving a row stuck forever on "loading…".
  function fetchT(url, opts) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var o = Object.assign({}, opts || {});
    if (ctl) o.signal = ctl.signal;
    var t = ctl
      ? setTimeout(function () {
          try {
            ctl.abort();
          } catch (e) {}
        }, 8000)
      : null;
    return fetch(url, o).then(
      function (r) {
        if (t) clearTimeout(t);
        return r;
      },
      function (e) {
        if (t) clearTimeout(t);
        throw e;
      }
    );
  }

  // Reached through Cloudflare Access: fetch a SHORT-LIVED signed token (S3) — the raw
  // ADMIN_KEY never reaches the browser. The token is sent as x-admin-key for writes and
  // carried in the bb_staging cookie for launching staging, exactly like the key was.
  function autoKey() {
    fetchT('/api/admin-key', { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.token) {
          keyInput.value = d.token;
          var until = d.exp ? ' — expires ' + new Date(d.exp).toLocaleTimeString() : '';
          authnote.textContent = 'Authenticated' + (d.email ? ' as ' + d.email : '') + ' — admin token issued' + until + '.';
        }
      })
      .catch(function () {});
  }

  function loadStatus() {
    fetchT('/api/status', { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var when = d.updatedAt ? ' · updated ' + new Date(d.updatedAt).toLocaleString() : '';
        cur.innerHTML = 'Current: <b>' + esc(d.mode || 'auto') + '</b>' + (d.label ? ' — “' + esc(d.label) + '”' : '') + esc(when);
        mark(d.mode || 'auto');
        if (d.label && !labelInput.value) labelInput.value = d.label;
      })
      .catch(function () {
        cur.textContent = 'Current: unavailable (deploy on Cloudflare to use)';
      });
  }

  function save(mode) {
    var key = (keyInput.value || '').trim();
    if (!key) {
      setMsg('Enter the admin key first.', 'err');
      return;
    }
    setMsg('Saving…');
    fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ mode: mode, label: (labelInput.value || '').trim() }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok) {
          setMsg('Saved: ' + res.d.mode + (res.d.label ? ' (“' + res.d.label + '”)' : ''), 'ok');
          loadStatus();
        } else setMsg('Error: ' + (res.d.error || 'request failed'), 'err');
      })
      .catch(function () {
        setMsg('Network error — is this deployed on Cloudflare?', 'err');
      });
  }

  document.querySelectorAll('#modes .modebtn').forEach(function (b) {
    if (b.dataset.mode)
      b.addEventListener('click', function () {
        save(b.dataset.mode);
      });
  });

  // ---- feature flags (/api/config) ----
  var flagmsg = document.getElementById('flagmsg');
  function setFlagMsg(t, k) {
    flagmsg.textContent = t || '';
    flagmsg.className = 'amsg' + (k ? ' ' + k : '');
  }
  var verstate = document.getElementById('verstate');
  function loadConfig() {
    fetchT('/api/config', { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (c) {
        var f = c.flags || {};
        document.querySelectorAll('[data-flag]').forEach(function (el) {
          el.checked = !!f[el.dataset.flag];
        });
      })
      .catch(function () {
        setFlagMsg('Config unavailable (deploy on Cloudflare to use)', 'err');
      });
  }
  // CH12: read versions straight from the public source of truth (no server self-fetch, which
  // hung GET /api/config behind Access). Platform phase derived from the prod major (0.x → Beta).
  function loadVersions() {
    fetchT('/data/versions.json', { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (v) {
        var platform = platformLabel(v.prod || '—'); // shared helper (A11)
        verstate.innerHTML =
          'Prod (main + demo) <b>' +
          esc(v.prod || '—') +
          '</b> · Staging <b>' +
          esc(v.staging || '—') +
          '</b> · Platform <b>' +
          esc(platform) +
          '</b>';
      })
      .catch(function () {
        verstate.textContent = 'Versions: unavailable';
      });
  }
  function postConfig(body, onMsg) {
    var key = (keyInput.value || '').trim();
    if (!key) {
      onMsg('Enter the admin key first.', 'err');
      return;
    }
    onMsg('Saving…');
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok) {
          onMsg('Saved', 'ok');
          loadConfig();
        } else onMsg('Error: ' + (res.d.error || 'request failed'), 'err');
      })
      .catch(function () {
        onMsg('Network error — is this deployed on Cloudflare?', 'err');
      });
  }
  document.getElementById('saveflags').addEventListener('click', function () {
    var flags = {};
    document.querySelectorAll('[data-flag]').forEach(function (el) {
      flags[el.dataset.flag] = el.checked;
    });
    postConfig({ flags: flags }, setFlagMsg);
  });

  // Launch staging: carry the short-lived admin token to the gated page TWO ways — a cookie
  // (the navigation-safe header equivalent) AND a ?k= query-param fallback, since the cookie
  // isn't always delivered on a window.open navigation. The middleware accepts either, so the
  // gate passes as long as a token was issued. (Staging now fails closed without a credential,
  // so an empty token field means Access didn't issue one — surface that clearly.)
  document.getElementById('launchstaging').addEventListener('click', function () {
    var key = (keyInput.value || '').trim();
    var sm = document.getElementById('stagemsg');
    var url = '/app/staging.html';
    if (key) {
      // S19: carry the staging token ONLY in the path-scoped cookie — never in the URL (?k=),
      // which would leak it into history, referrers, and access logs. _middleware reads the cookie.
      document.cookie = 'bb_staging=' + encodeURIComponent(key) + ';path=/app/;SameSite=Lax;Secure;max-age=3600';
      sm.textContent = '';
      sm.className = 'amsg';
    } else {
      sm.textContent =
        'No admin token in the key field yet — it’s issued via Access on load. Wait for the “Authenticated…” note, then retry.';
      sm.className = 'amsg err';
    }
    window.open(url, '_blank', 'noopener');
  });

  // ---- backlog (read-only view of data/backlog.json) ----
  var bkData = null;
  var bkFStatus = document.getElementById('bk_fstatus'),
    bkFEffort = document.getElementById('bk_feffort');

  // Renders only the item LIST, honoring the status + effort filters. The per-category
  // counts above always reflect full totals (project health), not the active filter.
  function bkRenderList() {
    var list = document.getElementById('bk_list');
    if (!bkData) {
      list.innerHTML = '';
      return;
    }
    var fs = bkFStatus.value,
      fe = bkFEffort.value;
    var cats = bkData.categories || [],
      items = bkData.items || [];
    var html = cats
      .map(function (c) {
        var its = items.filter(function (i) {
          return i.category === c && (!fs || i.status === fs) && (!fe || i.effort === fe);
        });
        if (!its.length) return '';
        return (
          '<div class="bkgroup">' +
          esc(c) +
          '</div>' +
          its
            .map(function (i) {
              var badge = i.status === 'done' ? 'done' : i.status === 'guardrail' ? 'guard' : 'open';
              return (
                '<div class="bkrow is-' +
                i.status +
                '"><span class="bk-id">' +
                esc(i.id) +
                '</span>' +
                '<span class="bk-title">' +
                esc(i.title) +
                '</span>' +
                '<span class="bk-eff">' +
                esc(i.effort) +
                '</span>' +
                '<span class="bk-badge ' +
                i.status +
                '">' +
                badge +
                '</span></div>'
              );
            })
            .join('')
        );
      })
      .join('');
    list.innerHTML = html || '<div class="bktotal">No items match these filters.</div>';
  }
  function bkFillOptions(items) {
    var statuses = {},
      efforts = {};
    items.forEach(function (i) {
      if (i.status) statuses[i.status] = 1;
      if (i.effort) efforts[i.effort] = 1;
    });
    function fill(sel, vals) {
      var keep = sel.value;
      sel.innerHTML =
        '<option value="">All</option>' +
        Object.keys(vals)
          .sort()
          .map(function (k) {
            return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
          })
          .join('');
      sel.value = keep;
    }
    fill(bkFStatus, statuses);
    fill(bkFEffort, efforts);
  }
  function loadBacklog() {
    var counts = document.getElementById('bk_counts'),
      total = document.getElementById('bk_total'),
      bmsg = document.getElementById('bk_msg');
    // The active backlog (open + guardrail) lives in backlog.json; completed (done) items were
    // moved to backlog_archive.json to keep the active file lean. Fetch BOTH and merge the item
    // lists so the panel still shows done items (filterable via Status). The archive is fail-soft:
    // if it's missing (e.g. an older deploy), the panel still renders the active backlog.
    Promise.all([
      fetch('/data/backlog.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }),
      fetch('/data/backlog_archive.json', { cache: 'no-store' })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
    ])
      .then(function (res) {
        var b = res[0],
          arch = res[1];
        bkData = b;
        var archItems = (arch && arch.items) || [];
        var items = (b.items || []).concat(archItems),
          cats = b.categories || [];
        b.items = items; // bkRenderList() reads bkData.items — render from the merged list
        var tDone = 0,
          tOpen = 0,
          tGuard = 0;
        // per-category counts (prompt/doneNote intentionally NOT rendered)
        counts.innerHTML = cats
          .map(function (c) {
            var its = items.filter(function (i) {
              return i.category === c;
            });
            var done = its.filter(function (i) {
              return i.status === 'done';
            }).length;
            var open = its.filter(function (i) {
              return i.status === 'open';
            }).length;
            var guard = its.filter(function (i) {
              return i.status === 'guardrail';
            }).length;
            var tot = done + open;
            tDone += done;
            tOpen += open;
            tGuard += guard;
            var pct = tot ? Math.round((100 * done) / tot) : 0;
            return (
              '<div class="bkcount"><div class="bk-cat">' +
              esc(c) +
              '</div>' +
              '<div class="bk-nums"><span class="bk-done">' +
              done +
              '</span><span class="bk-of">/ ' +
              tot +
              ' done</span>' +
              '<span class="bk-rem">' +
              open +
              ' left' +
              (guard ? ' · ' + guard + ' guard' : '') +
              '</span></div>' +
              '<div class="bkbar"><i data-w="' +
              pct +
              '"></i></div></div>'
            );
          })
          .join('');
        // A21: bar width via a custom property (CSSOM), not an inline style=
        Array.prototype.forEach.call(counts.querySelectorAll('.bkbar i'), function (el) {
          el.style.setProperty('--w', el.dataset.w + '%');
        });
        var grand = tDone + tOpen;
        total.innerHTML =
          'Overall: <b>' +
          tDone +
          '</b> done · <b>' +
          tOpen +
          '</b> remaining' +
          (tGuard ? ' · ' + tGuard + ' guardrail' : '') +
          ' · <b>' +
          (grand ? Math.round((100 * tDone) / grand) : 0) +
          '%</b> complete (' +
          items.length +
          ' items)';
        bkFillOptions(items);
        // CH21: open the backlog filtered to OPEN items (the actionable view) by default; the user can
        // still switch to All/done/guardrail. Only applied while the filter is at its initial "All".
        if (
          bkFStatus.value === '' &&
          Array.prototype.some.call(bkFStatus.options, function (o) {
            return o.value === 'open';
          })
        )
          bkFStatus.value = 'open';
        bkRenderList();
        bmsg.textContent = '';
      })
      .catch(function () {
        bmsg.textContent = 'Could not load data/backlog.json.';
        bmsg.className = 'amsg err';
      });
  }
  bkFStatus.addEventListener('change', bkRenderList);
  bkFEffort.addEventListener('change', bkRenderList);
  document.getElementById('bk_fclear').addEventListener('click', function () {
    bkFStatus.value = '';
    bkFEffort.value = '';
    bkRenderList();
  });

  autoKey();
  loadStatus();
  loadConfig();
  loadVersions();
  loadBacklog();
})();
