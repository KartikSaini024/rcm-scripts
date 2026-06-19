// ==UserScript==
// @name         DPT Keep-Alive
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.5.0
// @description  DPT Ping to keep session warm, saves working cookies to Gist on success
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/dpt-cookie.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/dpt-cookie.user.js
// @connect      2a959d14101343.au.deputy.com
// @connect      api.github.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const PING_MS  = 60 * 1000;
  const PING_URL = 'https://2a959d14101343.au.deputy.com/api/v1/me';
  const LOCK_KEY = 'dpty_ka_lock';
  const LOCK_TTL = 90 * 1000;

  // ── GitHub Gist config ───────────────────────────────────────────────────────
  const GITHUB_PAT  = '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koKoLamA';
  const GIST_ID     = '80524852522e1c62dcd90bda61594372';    // e.g. 80524852522e1c62dcd90bda61594372
  const GIST_FILE   = 'dpt_cookies.txt';   // filename inside the Gist
  // ─────────────────────────────────────────────────────────────────────────────

  const COOKIE_NAMES = [
    'DPSID',
    '_cq_suid',
    '_cq_duid',
    '_cq_session',
    '_sp_id.c074',
  ];

  function collectCookies(callback) {
    const results = [];
    let pending = COOKIE_NAMES.length;

    COOKIE_NAMES.forEach(name => {
      try {
        GM_cookie.list({ name, url: 'https://2a959d14101343.au.deputy.com' }, (cookies, error) => {
          if (!error && cookies && cookies.length > 0) {
            cookies.forEach(c => {
              results.push({
                domain:   c.domain,
                hostOnly: c.hostOnly  ?? false,
                httpOnly: c.httpOnly  ?? false,
                name:     c.name,
                path:     c.path      ?? '/',
                sameSite: c.sameSite  ?? 'no_restriction',
                secure:   c.secure    ?? true,
                session:  c.session   ?? true,
                storeId:  c.storeId   ?? null,
                ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
                value:    c.value,
              });
            });
          }
          if (--pending === 0) callback(results);
        });
      } catch (e) {
        console.warn('[DPT] GM_cookie.list failed for ' + name + ':', e);
        if (--pending === 0) callback(results);
      }
    });
  }

  function formatDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (local)`;
  }

  function updateGist(cookies) {
    const timestamp = formatDate(new Date());
    const content   = `Last Updated: ${timestamp}\n\n${JSON.stringify(cookies, null, 4)}`;

    GM_xmlhttpRequest({
      method: 'PATCH',
      url: `https://api.github.com/gists/${GIST_ID}`,
      headers: {
        'Authorization':        `Bearer ${GITHUB_PAT}`,
        'Accept':               'application/vnd.github+json',
        'Content-Type':         'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      data: JSON.stringify({
        files: { [GIST_FILE]: { content } }
      }),
      onload(r) {
        if (r.status === 200) {
          console.log('[DPT] Gist updated successfully at ' + timestamp);
        } else {
          console.warn('[DPT] Gist update failed — HTTP ' + r.status, r.responseText);
        }
      },
      onerror() {
        console.warn('[DPT] Gist update failed — network error');
      },
    });
  }

  // ── Lock helpers ─────────────────────────────────────────────────────────────
  function acquireLock() {
    try {
      const now = Date.now();
      const existing = JSON.parse(localStorage.getItem(LOCK_KEY) || '{}');
      if (existing.ts && (now - existing.ts) < LOCK_TTL) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify({ ts: now }));
      return true;
    } catch(e) { return true; }
  }

  function refreshLock() {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify({ ts: Date.now() })); } catch(e) {}
  }

  function releaseLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch(e) {}
  }
  // ─────────────────────────────────────────────────────────────────────────────

  function ping() {
    refreshLock();
    GM_xmlhttpRequest({
      method: 'GET',
      url: PING_URL,
      withCredentials: true,
      headers: { 'Accept': 'application/json' },
      onload(r) {
        if (r.status === 200 || r.status === 204) {
          console.log('[DPT] ping ok — collecting cookies for Gist update');
          collectCookies(cookies => {
            if (cookies.length === 0) {
              console.warn('[DPT] No cookies found — skipping Gist update');
              return;
            }
            updateGist(cookies);
          });
        } else {
          console.warn('[DPT] ping failed — HTTP ' + r.status);
        }
      },
      onerror() {
        console.warn('[DPT] ping failed — network error');
      },
    });
  }

  function boot() {
    if (!acquireLock()) return;
    window.addEventListener('beforeunload', releaseLock);
    ping();
    setInterval(ping, PING_MS);
  }

  document.body ? boot() : document.addEventListener('DOMContentLoaded', boot);

})();
