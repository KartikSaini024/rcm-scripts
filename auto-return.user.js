// ==UserScript==
// @name         Simba Return Manager (Userscript)
// @namespace    simba-return-manager
// @version      1.4.0
// @description  Auto-detects returned vehicles via We-Integrate and marks them as returned in RCM. Auto-return is OFF by default for testing — use the floating toggle or the per-row "Check In" button. Only vehicles whose Dropoff branch is enabled (Sydney only, by default) are scanned/shown.
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @connect      we-integrate.co.nz
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/auto-return.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/auto-return.user.js
// ==/UserScript==

/*
 * ─────────────────────────────────────────────────────────────────────────
 * PORTING NOTES (read me first)
 * ─────────────────────────────────────────────────────────────────────────
 * This is a 1:1 behavioural port of the "Simba Return Manager" Chrome
 * extension (manifest.json + background.js + content.js) into a single
 * userscript, with two intentional additions requested for testing:
 *
 *   1. Auto-return (the staggered automatic clicking of the return button)
 *      now defaults to OFF, and can be toggled at any time from a small
 *      floating panel in the bottom-right corner of the page.
 *   2. Every "ready to return" row already had a clickable button in the
 *      original extension (it just also got auto-clicked). That button is
 *      kept and now labelled "Check In" — clicking it manually runs the
 *      exact same submit flow the extension used to run automatically.
 *      When the Auto-Return toggle is ON, rows still get auto-clicked with
 *      the same staggered timing as the original; when it's OFF (default),
 *      nothing is clicked for you and you use the "Check In" button instead.
 *
 * Why some internals had to change (Chrome APIs have no userscript
 * equivalent, so the closest faithful equivalent was used):
 *
 *  - chrome.runtime.onMessage / background service worker
 *      There is no separate privileged background context in a userscript.
 *      The two message handlers (CHECK_WE_INTEGRATE, SUBMIT_RETURN) are now
 *      just plain async functions called directly from the page logic.
 *
 *  - fetch(..., { credentials: 'include' }) to we-integrate.co.nz
 *      A normal page-level fetch to a different origin would be blocked by
 *      CORS (the extension's host_permissions bypassed that). The
 *      userscript uses GM_xmlhttpRequest instead, which is not subject to
 *      the page's CORS policy and sends the browser's existing
 *      we-integrate.co.nz cookies, matching the original's behaviour. This
 *      requires the "@connect we-integrate.co.nz" declaration above, and
 *      Tampermonkey/Violentmonkey will ask you to allow that connection the
 *      first time it runs.
 *
 *  - chrome.tabs.create + chrome.scripting.executeScript (hidden tab that
 *    gets filled in and submitted)
 *      Userscripts can't reach into an arbitrary tab from the outside. This
 *      script now also matches the RCM booking-update page itself
 *      (@match .../reservations/update/booking/*). When the report page
 *      needs to submit a return, it opens that page in a background tab
 *      with a few extra query-string flags added to the URL
 *      (simbaAction / simbaKms / simbaRefuel / simbaToken). The userscript
 *      running on THAT page recognises the flags and runs the exact same
 *      poll → tick fees → fill fields → submit sequence, with the same
 *      delays as the original background.js. This should be invisible to
 *      RCM (unrecognised query parameters are simply ignored by the page)
 *      but it is a visible difference if you look at the tab's address bar.
 *
 *  - Result reporting from that hidden tab back to the report page
 *      chrome.runtime's sendResponse doesn't exist across tabs in a
 *      userscript. GM_setValue + GM_addValueChangeListener (a
 *      cross-tab key/value store with change notifications, supported by
 *      both Tampermonkey and Violentmonkey) is used instead — the hidden
 *      tab writes a small JSON result under a one-off key, the report page
 *      is already listening for that key, and closes the hidden tab once
 *      it has the result (the hidden tab also tries to self-close as a
 *      backup).
 *
 *  - jQuery / submitForm / displTotal (RCM's own page scripts)
 *      Userscripts normally run in a sandboxed JS context, so the page's
 *      own global functions/variables aren't directly visible. These are
 *      now accessed via `unsafeWindow.jQuery`, `unsafeWindow.submitForm`,
 *      `unsafeWindow.displTotal` instead of bare `jQuery`, `submitForm`,
 *      `displTotal`.
 *
 *  - chrome.storage / manifest permissions (cookies, storage, tabs,
 *    scripting, activeTab)
 *      Replaced by GM_getValue/GM_setValue for the one thing that's
 *      actually persisted (the Auto-Return toggle). Cookies are handled
 *      automatically by the browser for GM_xmlhttpRequest and for the
 *      normal page navigation of the hidden tab, so nothing extra was
 *      needed there.
 *
 *  - popup.html (the toolbar action popup)
 *      Userscripts don't have a toolbar button/popup. Its short "how to
 *      use" text is folded into the floating panel instead.
 *
 * Everything else — the We-Integrate query payload and result parsing, the
 * rego/resNo extraction heuristics, the row scanning and continuous
 * re-scan loop, the button states/styles, the field-filling and fee-ticking
 * logic and its timings — is carried over unchanged.
 * ─────────────────────────────────────────────────────────────────────────
 * v1.2.0 FIXES / ADDITIONS
 * ─────────────────────────────────────────────────────────────────────────
 *  - Fixed: table detection required `rows.length > 5` to consider a
 *    <table class="lstReport"> a candidate "dropoff" table. With few rows
 *    (e.g. only 1 record → header + 1 row = 2 total rows), that condition
 *    was never true, so the table was invisible to the scanner. This is
 *    why (a) a single-record list never scanned at all, and (b) on a
 *    borderline-sized list the very first pass could come up with zero
 *    rows and silently no-op, only "starting" to work once a couple more
 *    rows appeared on the following poll. The threshold is now `> 1`
 *    (i.e. header + at least one data row), and table identification
 *    still primarily relies on the presence of a "Photos" column header,
 *    so this doesn't loosen matching against unrelated tables.
 *  - Added: the status widget now shows the batch type (or the reason a
 *    vehicle isn't ready) for ~1s per vehicle while scanning, so it's
 *    visible that each row is actually being checked one at a time.
 *  - Added: the Auto-Return panel is now collapsed by default and toggles
 *    open/closed when you click the status widget in the corner.
 * ─────────────────────────────────────────────────────────────────────────
 * v1.3.0 FIXES / ADDITIONS
 * ─────────────────────────────────────────────────────────────────────────
 *  - Fixed: there was previously no real concept of "which branch is this
 *    vehicle dropping off at" — the only location-flavoured logic was
 *    inside extractRegoFromRow(), and that only used location codes (SYD,
 *    MEL, etc.) as a landmark to help pull the rego plate out of the
 *    "Vehicle" cell. It never looked at the report's actual "Dropoff"
 *    column, so there was no way to only act on (say) Sydney drop-offs —
 *    every branch's rows were scanned and shown together.
 *  - Added: rows are now matched against a "Dropoff" column (matched
 *    loosely — "Dropoff", "Drop Off", "Drop-off", "Dropoff Location" all
 *    count) and a branch/location code is detected inside that cell's
 *    full text using a whole-word search, not an exact-match on the whole
 *    cell. That means multi-line cells like:
 *        SYD
 *        SYD Office: 251 Coward Street, Mascot, NSW 2020
 *        Please return your rental vehicle to: 251 Coward Street, Mascot, NSW 2020
 *    are correctly recognised as a Sydney drop-off (the word "SYD" is
 *    present in the cell), rather than requiring the whole cell to equal
 *    "SYD". Matching is whole-word (via regex word boundaries) so "SYD"
 *    won't accidentally match inside an unrelated longer word.
 *  - Added: a "Locations" section in the floating menu lets you tick which
 *    branches' drop-offs should be scanned/shown at all (Sydney, Melbourne,
 *    Brisbane, Perth, Adelaide, Canberra, Hobart, Darwin, Cairns). Only
 *    Sydney is ticked by default — rows whose Dropoff branch isn't ticked
 *    (or whose branch couldn't be determined at all) are skipped entirely,
 *    before any We-Integrate lookups are made for them.
 * ─────────────────────────────────────────────────────────────────────────
 * v1.4.0 FIXES / ADDITIONS (this revision)
 * ─────────────────────────────────────────────────────────────────────────
 *  - Added: if the We-Integrate batch's notes contain the whole word
 *    "manual" (case-insensitive — matches "manual"/"manually" but not
 *    something like "Emmanuel"), the row no longer gets the normal
 *    "Check In" button at all. Instead it gets a differently-styled
 *    "Manual Checkin requested" button that does NOT run the automated
 *    submit flow (fillAndSubmit/submitReturnMsg) and is never auto-clicked
 *    even if Auto-Return is switched on. Clicking it simply opens RCM's
 *    own ordinary "manage booking" page for that reservation in a plain
 *    popup window (window.open, not GM_openInTab's hidden background tab,
 *    and with none of the simbaAction/simbaKms/simbaRefuel/simbaToken
 *    automation query flags added) so a person can review the booking and
 *    fill in / submit the check-in details by hand.
 *    Why: the notes are the operator's signal that the photos were taken
 *    later than the actual physical return (e.g. car was dropped off on
 *    time but not photographed until afterwards). This script infers the
 *    return time from "now" (see fillAndSubmit/doActualDropoff below) —
 *    it has no way to know the real return time in that situation, so
 *    rather than guess and submit a wrong Actual Drop-off time, it hands
 *    the row to a human with the real booking page one click away.
 * ─────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const IS_BOOKING_UPDATE_PAGE = /\/reservations\/update\/booking\/\d+/.test(location.pathname);
  const IS_DAILY_ACTIVITY_PAGE = location.pathname.indexOf('/report/dailyactivity') !== -1;

  if (IS_BOOKING_UPDATE_PAGE) {
    runBookingAutomationIfRequested();
    return;
  }

  if (IS_DAILY_ACTIVITY_PAGE) {
    runDailyActivityPage();
  }

  // ===========================================================================
  // ── Shared: We-Integrate lookup (was background.js) ───────────────────────
  // ===========================================================================

  function gmRequestJSON(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url: url,
        headers: opts.headers || {},
        data: opts.body,
        onload: (res) => {
          let json = null;
          try { json = JSON.parse(res.responseText); } catch (e) { /* leave null */ }
          resolve({ status: res.status, json: json });
        },
        onerror: () => reject(new Error('Network error contacting ' + url)),
        ontimeout: () => reject(new Error('Request to ' + url + ' timed out')),
      });
    });
  }

  async function checkWeIntegrate(rego) {
    const resp = await gmRequestJSON('https://we-integrate.co.nz/node/batch/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchSearch: {
          hasFiles: false, type: "custom", columnsNg: [], limitColumns: [],
          search: rego.toLowerCase(), exactMatch: false, fullTextSearch: true,
          lastViews: [], damageStatuses: [], utcDateMode: false, utcOffset: 0, isPanelMode: false
        },
        accountCode: "SIMBACARHIRE"
      })
    });
    if (resp.status === 401 || resp.status === 403) throw new Error('Not logged into We-Integrate. Please log in first.');
    if (resp.status < 200 || resp.status >= 300) throw new Error('We-Integrate search failed: ' + resp.status);
    return parseWeIntegrateResult(resp.json, rego);
  }

  function getMeta(metadata, name) {
    if (!Array.isArray(metadata)) return '';
    const e = metadata.find(m => m.name === name);
    return e ? (e.value || '').toString().trim() : '';
  }

  function parseWeIntegrateResult(data, rego) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    let batches = Array.isArray(data) ? data : [];
    if (!batches.length && data && typeof data === 'object') {
      for (const k of Object.keys(data)) { if (Array.isArray(data[k])) { batches = data[k]; break; } }
    }
    if (!batches.length) return { found: false, reason: 'No batches found' };
    const regoUpper = rego.toUpperCase();
    const pool = batches.filter(b => getMeta(b.metadata, 'car_registration').toUpperCase() === regoUpper);
    if (!pool.length) return { found: false, reason: 'No matching rego in We-Integrate' };
    const latest = pool[0];
    const batchType = getMeta(latest.metadata, 'batch_type');
    const kms = getMeta(latest.metadata, 'kilometers');
    const notes = getMeta(latest.metadata, 'notes');
    const dateAdded = (latest.dateAdded || '').toString().substring(0, 10);

    const fuelKeywords = /refuel|re-fuel|refuelling|refueling|needs fuel|fuel required|fuel not full|low fuel|no fuel|needs refuel/i;
    const needsRefuel = notes ? fuelKeywords.test(notes) : false;

    if (!batchType) return { found: false, reason: 'Could not read batch type' };
    if (batchType.toLowerCase() !== 'check in') return { found: false, reason: 'Latest batch is "' + batchType + '", not Check In', batchType };
    if (dateAdded !== todayStr) return { found: false, reason: 'Check In found but date is ' + dateAdded + ', not today', batchType };
    if (!kms || kms === '0') return { found: true, checkInToday: true, noKms: true, reason: 'No KMs input for this batch', kms: null, needsRefuel, batchType, notes };
    return { found: true, checkInToday: true, noKms: false, kms, needsRefuel, notes, batchType };
  }

  // ===========================================================================
  // ── Shared: hidden-tab submit orchestration (was background.js) ───────────
  // ===========================================================================

  function openBackgroundTab(url) {
    if (typeof GM_openInTab === 'function') {
      return GM_openInTab(url, { active: false, insert: true, setParent: false });
    }
    // Fallback if the userscript manager doesn't support GM_openInTab.
    return window.open(url, '_blank');
  }

  function submitReturnViaTab(updateUrl, kms, needsRefuel) {
    if (!updateUrl || !updateUrl.startsWith('https://bookings.rentalcarmanager.com/')) {
      return Promise.reject(new Error('Invalid booking URL: ' + updateUrl));
    }
    return new Promise((resolve, reject) => {
      const token = 'r' + Date.now() + Math.random().toString(36).slice(2);
      const resultKey = 'simba_result_' + token;

      const url = new URL(updateUrl);
      url.searchParams.set('simbaAction', 'return');
      url.searchParams.set('simbaKms', kms == null ? '' : String(kms));
      url.searchParams.set('simbaRefuel', needsRefuel ? '1' : '0');
      url.searchParams.set('simbaToken', token);

      let settled = false;
      let tabHandle = null;
      let listenerId = null;
      let overallTimeout = null;

      function finish(err, data) {
        if (settled) return;
        settled = true;
        if (listenerId !== null) { try { GM_removeValueChangeListener(listenerId); } catch (e) {} }
        if (overallTimeout) clearTimeout(overallTimeout);
        try { GM_deleteValue(resultKey); } catch (e) {}
        if (tabHandle && typeof tabHandle.close === 'function') { try { tabHandle.close(); } catch (e) {} }
        if (err) reject(err); else resolve(data);
      }

      listenerId = GM_addValueChangeListener(resultKey, (name, oldValue, newValue) => {
        if (!newValue) return;
        let parsed;
        try { parsed = JSON.parse(newValue); } catch (e) { finish(new Error('Bad result from booking tab')); return; }
        if (parsed.success) finish(null, parsed);
        else finish(new Error(parsed.error || 'Submit failed'));
      });

      tabHandle = openBackgroundTab(url.toString());

      overallTimeout = setTimeout(() => finish(new Error('Timed out')), 90000);
    });
  }

  // Message-shaped wrappers so the rest of the logic below (ported from
  // content.js) barely has to change from its original
  // `sendMessage({...})` call sites.
  async function checkWeIntegrateMsg(rego) {
    try {
      const data = await checkWeIntegrate(rego);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function submitReturnMsg(updateUrl, kms, needsRefuel) {
    try {
      const data = await submitReturnViaTab(updateUrl, kms, needsRefuel);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ===========================================================================
  // ── Booking-update-page automation (runs only on the hidden tab) ──────────
  // ===========================================================================

  function runBookingAutomationIfRequested() {
    const params = new URLSearchParams(location.search);
    if (params.get('simbaAction') !== 'return') return;

    const token = params.get('simbaToken');
    if (!token) return;
    const kms = params.get('simbaKms');
    const needsRefuel = params.get('simbaRefuel') === '1';

    const resultKey = 'simba_result_' + token;
    let reported = false;

    function reportResult(obj) {
      if (reported) return;
      reported = true;
      try { GM_setValue(resultKey, JSON.stringify(obj)); } catch (e) {}
      // Give the opener a moment to read the value (and close this tab);
      // also try to self-close as a fallback.
      setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
    }

    let attempts = 0;
    function poll() {
      attempts++;
      const el = document.querySelector('#hidResNo');
      const resNo = el ? el.value : '';
      if (resNo && resNo !== '0') {
        let alreadyReturned = false;
        const typeSelect = document.querySelector('#cmbType');
        if (typeSelect) {
          const selected = typeSelect.options[typeSelect.selectedIndex];
          if (selected && selected.text.trim() === 'Returned') alreadyReturned = true;
        }
        if (!alreadyReturned) {
          const badge = document.querySelector('#panHeader .title, .badge, #hdrTitle');
          if (badge && /RETURNED/i.test(badge.textContent)) alreadyReturned = true;
        }
        if (alreadyReturned) {
          reportResult({ success: true, alreadyReturned: true });
          return;
        }

        const runFillAndSubmit = () => {
          fillAndSubmit(kms, needsRefuel);
          const wait = needsRefuel ? 20000 : 8000;
          setTimeout(() => reportResult({ success: true }), wait);
        };

        if (needsRefuel) {
          const feesTab = document.querySelector('#lbtab3');
          if (feesTab) feesTab.click();
          setTimeout(() => {
            const chk302 = document.querySelector('#chkExt302');
            const amt302 = document.querySelector('#txtExtTot302');
            const chk303 = document.querySelector('#chkExt303');
            if (chk302) {
              chk302.checked = true;
              chk302.value = 'true';
              chk302.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (amt302) {
              amt302.value = '35.00';
              amt302.dispatchEvent(new Event('change', { bubbles: true }));
              amt302.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            if (chk303) {
              chk303.checked = true;
              chk303.value = 'true';
              chk303.dispatchEvent(new Event('change', { bubbles: true }));
            }
            try { unsafeWindow.displTotal(); } catch (e) {}
            setTimeout(runFillAndSubmit, 500);
          }, 3000);
        } else {
          runFillAndSubmit();
        }
      } else if (attempts >= 30) {
        reportResult({ success: false, error: 'RCM page did not load booking data in time' });
      } else {
        setTimeout(poll, 500);
      }
    }

    setTimeout(poll, 1500);
    setTimeout(() => reportResult({ success: false, error: 'Timed out' }), 90000);
  }

  // Runs inside the booking tab — sets the 3 fields then clicks Submit.
  // (identical to the original's injected `fillAndSubmit`, except page
  // globals are reached via unsafeWindow since this now runs as a
  // userscript rather than a chrome.scripting.executeScript payload)
  function fillAndSubmit(kmsValue, needsRefuel) {

    function setSelect(selector, value) {
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setInput(selector, value) {
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const rawMins = now.getMinutes();
    const roundedMins = Math.round(rawMins / 5) * 5;
    const finalHour = roundedMins === 60 ? now.getHours() + 1 : now.getHours();
    const finalMins = roundedMins === 60 ? 0 : roundedMins;
    const todayDate = pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear();
    const roundedTime = pad(finalHour) + ':' + pad(finalMins);

    if (needsRefuel) {
      setTimeout(doBookingDetails, 500);
    } else {
      doBookingDetails();
    }

    function doBookingDetails() {
      const tab2 = document.querySelector('#lbtab2');
      if (tab2) tab2.click();
      setTimeout(doSetFields, 1000);
    }

    function doSetFields() {
      const typeSelect = document.querySelector('#cmbType');
      if (typeSelect) {
        const opt = Array.from(typeSelect.options).find(o => o.text.trim() === 'Returned');
        if (opt) { typeSelect.value = opt.value; typeSelect.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      setSelect('#cmbFuelIn', 'Full');
      setInput('#txtKmsIn', kmsValue);
      setTimeout(doActualDropoff, 800);
    }

    function doActualDropoff() {
      const actDateEl = document.querySelector('#ActualDropOffDate');
      const actTimeEl = document.querySelector('#ActualDropOffTime');
      if (actDateEl) { actDateEl.value = todayDate; actDateEl.dispatchEvent(new Event('change', { bubbles: true })); }
      if (actTimeEl) { actTimeEl.value = roundedTime; actTimeEl.dispatchEvent(new Event('change', { bubbles: true })); }
      if (actDateEl) {
        const parent = actDateEl.closest('.col2_2') || actDateEl.parentElement;
        (parent ? parent.querySelectorAll('select') : []).forEach(s => {
          const opts = Array.from(s.options).map(o => parseInt(o.value)).filter(v => !isNaN(v));
          const max = Math.max(...opts), min = Math.min(...opts);
          if (max <= 31 && min >= 1 && opts.length <= 31) s.value = now.getDate();
          else if (max <= 12 && min >= 1 && opts.length <= 12) s.value = now.getMonth() + 1;
          else if (min >= 2020) s.value = now.getFullYear();
          s.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      if (actTimeEl) {
        const parent = actTimeEl.closest('.col2_2') || actTimeEl.parentElement;
        const h = parent ? parent.querySelector('select.hour') : null;
        const m = parent ? parent.querySelector('select.minute') : null;
        if (h) { h.value = finalHour; h.dispatchEvent(new Event('change', { bubbles: true })); }
        if (m) { m.value = finalMins; m.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      if (typeof unsafeWindow.jQuery !== 'undefined') {
        const jq = unsafeWindow.jQuery;
        jq('#ActualDropOffDate').val(todayDate).trigger('change');
        jq('#ActualDropOffTime').val(roundedTime).trigger('change');
        jq('#rowActualDropoff .hour').val(finalHour).trigger('change');
        jq('#rowActualDropoff .minute').val(finalMins).trigger('change');
      }
      setTimeout(doSubmit, 800);
    }

    function doSubmit() {
      try {
        if (typeof unsafeWindow.jQuery !== 'undefined') {
          unsafeWindow.jQuery('.ui-dialog:visible .ui-button:contains("Ok")').click();
        }
        if (typeof unsafeWindow.submitForm === 'function') unsafeWindow.submitForm();
        else { const btn = document.querySelector('#btnUpdate'); if (btn) btn.click(); }
      } catch (e) {
        const btn = document.querySelector('#btnUpdate');
        if (btn) btn.click();
      }
    }

    return { success: true };
  }

  // Ported from content.js, left in place even though nothing currently
  // calls it in the original extension either (kept for parity — see the
  // conversion notes shared alongside this file).
  function extractBookingPayload(html, resNo, kmsFromWeIntegrate) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const scripts = doc.querySelectorAll('script');
    let bookingData = null;

    for (const script of scripts) {
      const content = script.textContent;
      if (content.includes('saveBooking') || content.includes('bktyp') || content.includes('resno')) {
        bookingData = content;
        break;
      }
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const getValue = (pattern) => {
      const m = html.match(pattern);
      return m ? m[1] : '';
    };

    const carid = getValue(/['"']carid['"]:\s*['"]?(\d+)/i) || getValue(/name="carid"[^>]*value="(\d+)"/i) || '';
    const custid = getValue(/['"']custid['"]:\s*['"]?(\d+)/i) || getValue(/name="custid"[^>]*value="(\d+)"/i) || '';
    const catid = getValue(/['"']catid['"]:\s*['"]?(\d+)/i) || getValue(/name="catid"[^>]*value="(\d+)"/i) || '';
    const kmsout = getValue(/['"']kmsout['"]:\s*['"]?(\d+)/i) || getValue(/Kms Out[^>]*>([0-9]+)/i) || '';
    const insid = getValue(/['"']insid['"]:\s*['"]?(\d+)/i) || '';
    const kmsid = getValue(/['"']kmsid['"]:\s*['"]?(\d+)/i) || '4';
    const brand = getValue(/['"']brand['"]:\s*['"]?(\d+)/i) || '1';
    const ploc = getValue(/['"']ploc['"]:\s*['"]?(\d+)/i) || '9';
    const dloc = getValue(/['"']dloc['"]:\s*['"]?(\d+)/i) || '9';
    const pdate = getValue(/['"']pdate['"]:\s*['"]([^'"]+)/i) || '';
    const ddate = getValue(/['"']ddate['"]:\s*['"]([^'"]+)/i) || nowStr;
    const notes = getValue(/['"']notes['"]:\s*['"]([^'"]*)/i) || '';
    const rates = getValue(/['"']rates['"]:\s*(\[[^\]]+\])/i) || '[]';
    const exfee = getValue(/['"']exfee['"]:\s*(\[[^\]]*\])/i) || '[]';
    const exdrivers = getValue(/['"']exdrivers['"]:\s*(\[[^\]]*\])/i) || '[]';

    const payload = {
      resmode: 'update', restype: 'booking', resno: resNo, bktyp: '6', bnonrev: 'false',
      insheet: 'true', ratetype: '0', catid, custid, compid: '0', carid, brand, ploc,
      coll: '', pdate, dloc, drop: '', ddate, yage: '25', notrav: '1', trans: '0',
      aruse: '', arriv: '', depar: '', source: '', ccode: '', refer: '', refnm: '',
      agency: '', agent: '', agntem: '', refno: resNo, kmsout, kmsin: kmsFromWeIntegrate,
      kmscost: '0.00', flout: 'Full', flin: 'Full', flcost: '0.00', notes, discid: '',
      kmsid, insid, recalckmcost: 'true', currentlocation: '9', cancelreason: '0', exdrivers,
      afthrspickup: 'false', afthrsdropoff: 'false', actualpickup: '', actualdropoff: nowStr,
      dropoffinstruct: '4', agentcommission: '', agentcollect: '', closebooking: '0',
      operator: '0', quotestatid: '0', packid: '0', scanid: '0', rates, exfee,
      exdetail: '[]', accinsurance: '[]', paymenttypeid: '0', tntcode: 'AuSimbaCarHire759',
      custCompanyCreated: 'false', initCompID: '0'
    };

    return payload;
  }

  // ===========================================================================
  // ── Daily Activity page: scanning, buttons, floating menu (was content.js) ─
  // ===========================================================================

  function runDailyActivityPage() {

    if (window.__simbaReturnManagerLoaded) return;
    window.__simbaReturnManagerLoaded = true;

    const AUTO_RETURN_KEY = 'simba_auto_return_enabled';

    function isAutoReturnEnabled() {
      return GM_getValue(AUTO_RETURN_KEY, false) === true;
    }
    function setAutoReturnEnabled(val) {
      GM_setValue(AUTO_RETURN_KEY, !!val);
    }

    // Keyword that, when found in the We-Integrate batch's notes, means a
    // human needs to check the vehicle in manually (see v1.4.0 notes at
    // the top of the file for why). Whole-word match so it doesn't fire on
    // an unrelated longer word.
    const MANUAL_CHECKIN_KEYWORD_RE = /\bmanual\b/i;

    function notesRequireManualCheckin(notes) {
      return !!notes && MANUAL_CHECKIN_KEYWORD_RE.test(notes);
    }

    // ── Branch/location filtering (based on the report's "Dropoff" column) ──
    //
    // Recognised branch codes, with a friendly label for the menu. This is
    // deliberately the same set of city codes already used elsewhere in this
    // file (see extractRegoFromRow's locationPattern) so a code recognised in
    // one place is recognised everywhere.
    const LOCATIONS = [
      { code: 'SYD', label: 'Sydney' },
      { code: 'MEL', label: 'Melbourne' },
      { code: 'BNE', label: 'Brisbane' },
      { code: 'PER', label: 'Perth' },
      { code: 'ADL', label: 'Adelaide' },
      { code: 'CBR', label: 'Canberra' },
      { code: 'HBA', label: 'Hobart' },
      { code: 'DAR', label: 'Darwin' },
      { code: 'CNS', label: 'Cairns' },
    ];

    const ENABLED_LOCATIONS_KEY = 'simba_enabled_locations';

    // Default: Sydney only.
    function getEnabledLocations() {
      const stored = GM_getValue(ENABLED_LOCATIONS_KEY, null);
      if (Array.isArray(stored) && stored.length) return stored;
      return ['SYD'];
    }
    function setEnabledLocations(codes) {
      GM_setValue(ENABLED_LOCATIONS_KEY, codes);
    }
    function isLocationEnabled(code) {
      if (!code) return false;
      return getEnabledLocations().indexOf(code) !== -1;
    }

    // Whole-word search for a branch code anywhere inside a cell's text —
    // NOT an exact-match on the whole cell. This is what makes a multi-line
    // Dropoff cell such as:
    //   SYD
    //   SYD Office: 251 Coward Street, Mascot, NSW 2020
    //   Please return your rental vehicle to: 251 Coward Street, Mascot, NSW 2020
    // correctly count as Sydney: the word "SYD" appears in there, even
    // though the cell as a whole is much longer than just "SYD". Word
    // boundaries keep "MEL" from matching inside an unrelated longer word.
    // Turns a cell's innerHTML into plain text where every tag becomes a
    // space. This matters because `.textContent` simply drops tags like
    // <br> with NOTHING in their place — so a cell built as
    // "SYD<br>SYD Office: 251 Coward Street..." becomes the single glued
    // string "SYDSYD Office: 251 Coward Street...", and a whole-word match
    // for "SYD" then fails (there's no boundary between the two runs of
    // "SYD"). Replacing every tag with a space instead keeps "SYD" as its
    // own word no matter how the cell's lines are separated in the markup.
    function htmlToSpacedText(html) {
      if (!html) return '';
      return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Full text of a cell (or row) for location matching: HTML-tag-safe
    // (see htmlToSpacedText above) plus any `title` attribute text found on
    // the element itself or its descendants, in case a report shows the
    // branch code as visible text but the full office/return address only
    // as a hover tooltip rather than as literal cell content.
    function getCellFullText(el) {
      if (!el) return '';
      let text = htmlToSpacedText(el.innerHTML || '');
      const titledEls = [el].concat(el.querySelectorAll ? Array.from(el.querySelectorAll('[title]')) : []);
      for (const t of titledEls) {
        const title = t.getAttribute && t.getAttribute('title');
        if (title) text += ' ' + title;
      }
      return text;
    }

    function detectLocationCode(text) {
      if (!text) return null;
      const normalized = text.replace(/\s+/g, ' ');

      // Find the *earliest* (leftmost) occurrence of any known location
      // keyword in the text, and use that one — not simply the first code
      // in the LOCATIONS array that happens to match anywhere. This matters
      // because a Dropoff cell can legitimately mention more than one code
      // (e.g. a note referencing another branch further down the text); the
      // one that actually comes first in the cell is what should decide the
      // record's location, regardless of the order LOCATIONS is defined in.
      let bestCode = null;
      let bestIndex = Infinity;
      for (const loc of LOCATIONS) {
        const re = new RegExp('\\b' + loc.code + '\\b', 'i');
        const m = re.exec(normalized);
        if (m && m.index < bestIndex) {
          bestIndex = m.index;
          bestCode = loc.code;
        }
      }
      return bestCode;
    }

    function normalizeHeaderText(s) {
      return (s || '').toLowerCase().replace(/[\s\-]/g, '');
    }

    // Minimum total <tr> count (including the header row) for a
    // "table.lstReport" to be considered as a candidate dropoff/activity
    // table. This used to be `> 5`, which meant a list with only 1 (or a
    // handful of) data rows never had a table.rows.length big enough to
    // pass, so it was never detected at all — the scanner silently found
    // nothing to do. Identification is primarily driven by the presence of
    // a "Photos" column header anyway, so this just needs to rule out
    // genuinely empty/header-only tables.
    const MIN_TABLE_ROWS = 1;

    function findDropoffTable() {
      return Array.from(document.querySelectorAll('table.lstReport'))
        .find(t => t.rows.length > MIN_TABLE_ROWS && Array.from(t.querySelectorAll('th')).some(th => th.textContent.trim() === 'Photos'));
    }

    // Generic "find the column index whose header matches" helper, used for
    // both the "Vehicle" column (rego extraction) and the "Dropoff" column
    // (branch/location extraction).
    function findColumnIndex(headerMatcher) {
      const tbl = findDropoffTable();
      if (!tbl) return -1;
      const ths = Array.from(tbl.querySelectorAll('th'));
      return ths.findIndex(th => headerMatcher(th.textContent.trim()));
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Declared up front (not down near injectFloatingMenu's definition)
    // because injectFloatingMenu() is invoked before that point in the
    // function — referencing a `let` before its own declaration line has
    // run throws a ReferenceError and would silently kill the whole
    // script, which is why nothing was rendering at all.
    let menuEl = null;

    const STYLE = `
      .simba-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        margin-left: 5px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid transparent;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        vertical-align: middle;
        font-family: inherit;
        line-height: 1.4;
      }
      .simba-btn-ready {
        background: #1565c0;
        color: #fff;
        border-color: #1565c0;
        display: block;
        width: 100%;
        text-align: center;
        margin-left: 0;
        margin-top: 4px;
        box-sizing: border-box;
      }
      .simba-btn-ready:hover {
        background: #0d47a1;
        border-color: #0d47a1;
      }
      .simba-btn-loading {
        background: #f5f5f5;
        color: #888;
        border-color: #ddd;
        cursor: not-allowed;
      }
      .simba-btn-success {
        background: #2e7d32;
        color: #fff;
        border-color: #2e7d32;
        cursor: default;
        display: block;
        width: 100%;
        text-align: center;
        margin-left: 0;
        margin-top: 4px;
        box-sizing: border-box;
      }
      .simba-btn-error {
        background: #fff3f3;
        color: #c62828;
        border-color: #ffcdd2;
        cursor: default;
        font-size: 10px;
        max-width: 200px;
        white-space: normal;
        line-height: 1.3;
        padding: 3px 6px;
      }
      .simba-btn-manual {
        background: #fff8e1;
        color: #e65100;
        border-color: #ffcc80;
        cursor: pointer;
        display: block;
        width: 100%;
        text-align: center;
        margin-left: 0;
        margin-top: 4px;
        box-sizing: border-box;
        font-size: 10px;
        white-space: normal;
        line-height: 1.3;
      }
      .simba-btn-manual:hover {
        background: #ffecb3;
        border-color: #ffb74d;
      }
      .simba-btn-checking {
        background: #fffde7;
        color: #f57f17;
        border-color: #fff176;
        cursor: not-allowed;
      }
      .simba-spinner {
        display: inline-block;
        width: 10px;
        height: 10px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: simba-spin 0.7s linear infinite;
      }
      @keyframes simba-spin {
        to { transform: rotate(360deg); }
      }
      .simba-status-bar {
        position: fixed;
        bottom: 12px;
        right: 12px;
        background: rgba(20, 20, 40, 0.88);
        color: #e0e0e0;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-family: monospace;
        z-index: 99999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        max-width: 260px;
        border-left: 3px solid #4caf50;
        backdrop-filter: blur(4px);
        opacity: 0.85;
        transition: opacity 0.3s;
        cursor: pointer;
        user-select: none;
      }
      .simba-status-bar:hover { opacity: 1; }
      .simba-status-bar.checking { border-left-color: #ff9800; }
      .simba-status-bar.done { border-left-color: #4caf50; }
      .simba-status-bar.hidden { opacity: 0; pointer-events: none; }

      /* ── New: floating auto-return toggle menu ───────────────────────── */
      .simba-menu {
        position: fixed;
        bottom: 56px;
        right: 12px;
        background: rgba(20, 20, 40, 0.92);
        color: #e0e0e0;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-family: sans-serif;
        z-index: 100000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        width: 220px;
        border-left: 3px solid #1565c0;
        transform-origin: bottom right;
        transition: opacity 0.15s ease, transform 0.15s ease;
        max-height: 70vh;
        overflow-y: auto;
      }
      .simba-menu.simba-menu-collapsed {
        opacity: 0;
        transform: scale(0.95) translateY(6px);
        pointer-events: none;
      }
      .simba-menu-title { font-weight: 600; margin-bottom: 8px; }
      .simba-menu-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
      }
      .simba-switch { position: relative; display: inline-block; width: 34px; height: 18px; flex-shrink: 0; }
      .simba-switch input { opacity: 0; width: 0; height: 0; }
      .simba-slider {
        position: absolute; cursor: pointer; inset: 0; background: #555;
        transition: .2s; border-radius: 18px;
      }
      .simba-slider:before {
        content: ""; position: absolute; height: 14px; width: 14px; left: 2px; bottom: 2px;
        background: #fff; transition: .2s; border-radius: 50%;
      }
      .simba-switch input:checked + .simba-slider { background: #2e7d32; }
      .simba-switch input:checked + .simba-slider:before { transform: translateX(16px); }
      .simba-menu-hint { margin-top: 6px; font-size: 10px; color: #aaa; line-height: 1.4; }
      .simba-menu-divider { border-top: 1px solid rgba(255,255,255,0.15); margin: 10px 0 8px; }
      .simba-menu-subtitle { font-weight: 600; font-size: 11px; margin-bottom: 6px; color: #cfd8ff; }
      .simba-menu-locations { display: flex; flex-direction: column; gap: 5px; }
      .simba-menu-location-row { padding: 1px 0; }
      .simba-loc-code { color: #9aa; font-size: 10px; }
      .simba-loc-checkbox { width: 14px; height: 14px; accent-color: #1565c0; cursor: pointer; }
    `;

    injectStyles(STYLE);
    injectFloatingMenu();

    // Re-scan continuously — as soon as one scan finishes, wait 5 seconds then start next
    const continuousScan = () => {
      processDropoffList().then(() => {
        showStatusBar('Scan complete. Restarting in 5s...', 'done');
        setTimeout(continuousScan, 5000);
      }).catch(() => {
        setTimeout(continuousScan, 5000);
      });
    };

    // Wait for table to load, then start the continuous scan chain
    waitForDropoffList();

    function waitForDropoffList() {
      let lastCount = 0;
      let stableChecks = 0;
      const poll = () => {
        const tbl = findDropoffTable();
        const count = tbl ? tbl.rows.length : 0;
        if (count > 0 && count === lastCount) {
          stableChecks++;
          if (stableChecks >= 3) {
            processDropoffList().then(() => {
              showStatusBar('Scan complete. Restarting in 5s...', 'done');
              setTimeout(continuousScan, 5000);
            }).catch(() => {
              setTimeout(continuousScan, 5000);
            });
            return;
          }
        } else {
          stableChecks = 0;
          lastCount = count;
        }
        setTimeout(poll, 500);
      };
      setTimeout(poll, 500);
    }

    async function processDropoffList() {
      const enabledLocations = getEnabledLocations();
      const allRows = getDropoffRows();
      const rows = allRows.filter(r => isLocationEnabled(r.location));
      const skippedCount = allRows.length - rows.length;

      const regoList = rows.map(r => r.rego).join(', ');
      const locLabel = enabledLocations.length ? enabledLocations.join(', ') : 'none selected';
      console.log('[Simba] Scanning ' + rows.length + ' vehicle(s) for [' + locLabel + '] drop-off'
        + (skippedCount ? ' (skipped ' + skippedCount + ' from other/unknown branches)' : '') + ': ' + regoList);
      showStatusBar('Checking ' + rows.length + ' vehicle(s) [' + locLabel + '] against We-Integrate...', 'checking');
      if (!rows.length) {
        console.log('[Simba Return] No matching dropoff rows found for enabled locations: ' + locLabel);
        return;
      }

      const results = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const { rego, resNo, updateUrl, photosCell, tr } = row;
        if (!rego || !photosCell) { results.push(null); continue; }
        showStatusBar('Scanning ' + (i + 1) + '/' + rows.length + ': ' + rego, 'checking');
        try {
          const result = await checkWeIntegrateMsg(rego);
          if (!result.success) {
            showStatusBar(rego + ': ' + (result.error || 'check failed'), 'checking');
            await sleep(1000);
            results.push(null);
            continue;
          }
          // Briefly surface the batch type (or the reason it's not ready)
          // so it's visible that this specific vehicle was actually
          // checked, rather than the widget jumping straight to the next.
          const data = result.data;
          const label = data.batchType
            ? (data.batchType + (data.checkInToday ? (data.noKms ? ' (no KMs)' : '') : ' (not today)'))
            : (data.reason || 'no batch found');
          showStatusBar(rego + ': ' + label, 'checking');
          await sleep(1000);
          results.push({ row, data });
        } catch (e) {
          console.error('[Simba Return] Error checking ' + rego + ':', e);
          showStatusBar(rego + ': error — ' + e.message, 'checking');
          await sleep(1000);
          results.push(null);
        }
      }

      let readyCount = 0;
      for (const item of results) {
        if (!item) continue;
        const { row, data } = item;
        const { rego, resNo, updateUrl, photosCell, tr } = row;
        if (data.found && data.checkInToday) {
          readyCount++;
          // Notes flagged as "manual" take priority over everything else —
          // regardless of whether KMs are present — because the concern
          // (photos taken after the real return time) applies either way.
          if (notesRequireManualCheckin(data.notes)) {
            injectManualCheckinNotice(photosCell, rego, updateUrl, data.notes, tr);
          } else if (data.noKms) {
            injectErrorButton(photosCell, rego, '⚠ No KMs in We-Integrate');
          } else {
            injectReturnButton(photosCell, rego, resNo, updateUrl, data.kms, data.needsRefuel === true, data.notes || "", tr);
          }
        }
      }

      showStatusBar(
        `Done. ${readyCount} vehicle(s) ready to return.`,
        'done',
        0
      );
    }

    function getDropoffRows() {
      const rows = [];

      const vehicleColIdx = findColumnIndex(text => text === 'Vehicle');
      // Matched loosely: "Dropoff", "Drop Off", "Drop-off", "Dropoff Location"
      // (or "Dropoff Branch", etc.) all count, since RCM's exact header
      // wording can vary between report configurations.
      const dropoffColIdx = findColumnIndex(text => normalizeHeaderText(text).indexOf('dropoff') !== -1);

      let allRows;
      let dropoffTable = null;
      const lstTables = Array.from(document.querySelectorAll('table.lstReport'))
        .filter(t => t.rows.length > MIN_TABLE_ROWS);
      for (const tbl of lstTables) {
        const ths = Array.from(tbl.querySelectorAll('th'));
        if (ths.some(th => th.textContent.trim() === 'Photos')) {
          dropoffTable = tbl;
          break;
        }
      }
      if (!dropoffTable && lstTables.length) {
        dropoffTable = lstTables.reduce((a, b) => a.rows.length >= b.rows.length ? a : b);
      }
      allRows = dropoffTable ? dropoffTable.querySelectorAll('tr') : document.querySelectorAll('tr');

      for (const tr of allRows) {
        if (tr.querySelector('th')) continue;
        if (/Maintenance|Reservation/i.test(tr.textContent.substring(0, 300))) continue;

        const cells = tr.querySelectorAll('td');
        if (!cells.length) continue;

        let resNo = null;
        const allOnclick = tr.querySelectorAll('[onclick]');
        for (const el of allOnclick) {
          const onclick = el.getAttribute('onclick') || '';
          const m = onclick.match(/booking\/(\d+)/i) || onclick.match(/(\d{5,7})/);
          if (m) { resNo = m[1]; break; }
        }
        if (!resNo) {
          const links = tr.querySelectorAll('a[href]');
          for (const a of links) {
            const m = (a.getAttribute('href') || '').match(/booking\/(\d+)/i);
            if (m) { resNo = m[1]; break; }
          }
        }
        if (!resNo) {
          for (let i = 0; i < Math.min(cells.length, 6); i++) {
            const m = cells[i].textContent.trim().match(/^(\d{5,7})$/);
            if (m) { resNo = m[1]; break; }
          }
        }
        if (!resNo) continue;

        let photosCell = null;
        for (const td of cells) {
          const links = td.querySelectorAll('a, button');
          for (const link of links) {
            if (link.textContent.trim().toUpperCase() === 'PHOTOS') {
              photosCell = td;
              break;
            }
          }
          if (photosCell) break;
        }
        if (!photosCell) photosCell = cells[cells.length - 1];

        const rego = extractRegoFromRow(tr, vehicleColIdx);
        if (!rego) continue;

        // Determine the drop-off branch for this row from the "Dropoff"
        // column's full text (whole-word match, e.g. "SYD" anywhere inside
        // a multi-line address block still counts as Sydney). Falls back to
        // scanning the whole row's text if the Dropoff column itself
        // couldn't be located, so branch detection still works even if the
        // report's header wording changes.
        const dropoffCell = (dropoffColIdx >= 0 && cells[dropoffColIdx]) ? cells[dropoffColIdx] : tr;
        const dropoffText = getCellFullText(dropoffCell);
        const location = detectLocationCode(dropoffText);

        let updateUrl = null;
        if (resNo) {
          updateUrl = 'https://bookings.rentalcarmanager.com/reservations/update/booking/' + resNo + '/2';
        }

        if (rego && resNo && updateUrl) {
          if (!rows.find(r => r.resNo === resNo)) {
            rows.push({ rego, resNo, updateUrl, photosCell, tr, location });
          }
        }
      }

      return rows;
    }

    function extractRegoFromRow(tr, vehicleColIndex) {
      const cells = tr.querySelectorAll('td');
      const locationPattern0 = /^(SYD|MEL|BNE|PER|ADL|CBR|HBA|DAR|CA|SR|CNS)\d+$/i;
      const excludePattern0 = /^(CX|MG|GS|ZS|HS|CS|RX|SX|CRV|RAV|SUV|EV|MG3|MG5|GS8|CX3|CX5|CX7|CX9|UTE|VAN|BUS|I30|HIACE|SEDAN|HYBRID|SEATER|MOVER|PEOPLE|SMALL|LARGE|MEDIUM|ECONOMY|LUXURY|COMPACT|FAMILY|PREMIUM|COMMUTER|HATCHBACK|OUTLANDER|CARNIVAL|PICANTO|COROLLA|STARIA|JOLION|CERATO|STONIC|SWIFT)$/i;

      if (vehicleColIndex >= 0 && cells[vehicleColIndex]) {
        const text = cells[vehicleColIndex].textContent.trim();
        const tokens = text.split(/\s+/);
        for (let i = 1; i < tokens.length; i++) {
          if (locationPattern0.test(tokens[i])) {
            const candidate = tokens[i - 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (candidate.length >= 4 && candidate.length <= 7 &&
                /[A-Z]/.test(candidate) && /[0-9]/.test(candidate) &&
                !excludePattern0.test(candidate)) {
              return candidate;
            }
          }
        }
      }

      const locationPattern = /^(SYD|MEL|BNE|PER|ADL|CBR|HBA|DAR|CA|SR)\d+$/i;
      const vinPattern = /^\d{10,}$/;
      const excludePattern = /^(CX|MG|GS|ZS|HS|CS|RX|SX|CRV|RAV|SUV|EV|MG3|MG5|GS8|HS|CS|ZS|CX3|CX5|CX7|CX9|UTE|VAN|BUS)$/i;

      for (const td of cells) {
        const text = td.textContent.trim();
        if (!vinPattern.test(text.split(/\s+/).find(t => vinPattern.test(t)) || '')) continue;

        const tokens = text.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
          if (locationPattern.test(tokens[i])) {
            if (i > 0) {
              const candidate = tokens[i - 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
              if (candidate.length >= 4 && candidate.length <= 7 &&
                  /[A-Z]/.test(candidate) && /[0-9]/.test(candidate) &&
                  !excludePattern.test(candidate)) {
                return candidate;
              }
            }
          }
        }

        for (const token of tokens) {
          const t = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (t.length >= 4 && t.length <= 7 &&
              /[A-Z]/.test(t) && /[0-9]/.test(t) &&
              !locationPattern.test(t) && !vinPattern.test(t) &&
              !excludePattern.test(t)) {
            return t;
          }
        }
      }

      const photosLink = tr.querySelector('a');
      if (photosLink) {
        const href = photosLink.href || '';
        const regoMatch = href.match(/rego=([A-Z0-9]{4,8})/i);
        if (regoMatch) return regoMatch[1].toUpperCase();
      }

      return null;
    }

    function injectReturnButton(photosCell, rego, resNo, updateUrl, kms, needsRefuel, notes, tr) {
      if (photosCell.querySelector('.simba-btn-success, .simba-btn-ready, .simba-btn-error, .simba-btn-manual')) return;

      const rowEl = tr || photosCell.closest('tr');
      if (rowEl) {
        rowEl.style.backgroundColor = '#e8f5e9';
        const next = rowEl.nextElementSibling;
        if (next && !next.querySelector('button, input[type="button"]') && next.querySelector('td')) {
          next.style.backgroundColor = '#e8f5e9';
        }
      }

      const btn = document.createElement('button');
      btn.className = 'simba-btn simba-btn-ready';
      btn.title = 'Check In today · KMs: ' + kms + (needsRefuel ? ' · Refuel fee will be added' : '') + ' · Click to mark returned';

      // "Check In" — this is the manual button referenced in the brief: it
      // runs the exact same submit flow as the old auto-click did.
      const defaultText = 'Check In';
      const hoverText = notes ? notes : 'No notes';
      btn.innerHTML = defaultText;
      btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.innerHTML = hoverText; });
      btn.addEventListener('mouseleave', () => { if (!btn.disabled) btn.innerHTML = defaultText; });

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleMarkAsReturned(btn, rego, resNo, updateUrl, kms, needsRefuel);
      });

      // Auto-click with the same stagger as the original — but only when
      // the Auto-Return toggle is switched on (it's OFF by default).
      if (!window.__simbaReturnIndex) window.__simbaReturnIndex = 0;
      const myIndex = window.__simbaReturnIndex++;
      setTimeout(() => {
        if (!btn.disabled && isAutoReturnEnabled()) btn.click();
      }, 800 + (myIndex * 2000));

      const br = document.createElement('br');
      photosCell.appendChild(br);
      photosCell.appendChild(btn);
    }

    function injectErrorButton(photosCell, rego, message) {
      if (photosCell.querySelector('.simba-btn-success, .simba-btn-ready, .simba-btn-error, .simba-btn-manual')) return;

      const btn = document.createElement('button');
      btn.className = 'simba-btn simba-btn-error';
      btn.textContent = message;
      btn.title = rego + ': ' + message;
      btn.disabled = true;

      photosCell.appendChild(btn);
    }

    // New (v1.4.0): shown instead of the "Check In" button whenever the
    // We-Integrate notes contain the word "manual". This is deliberately
    // NOT the automated Check In button — it never gets auto-clicked (even
    // with Auto-Return on) and it never runs fillAndSubmit/submitReturnMsg,
    // since the whole point is that a human needs to enter the correct
    // return time themselves rather than have the script stamp "now".
    // Clicking it does nothing more than open RCM's own regular "manage
    // booking" page in a plain popup window — the exact same updateUrl
    // used elsewhere, with none of the simbaAction/simbaKms/simbaRefuel/
    // simbaToken query flags added, and via window.open (a normal, visible
    // popup) rather than GM_openInTab's hidden background tab — so the
    // user lands on the ordinary edit screen and fills in / submits the
    // check-in details by hand.
    function injectManualCheckinNotice(photosCell, rego, updateUrl, notes, tr) {
      if (photosCell.querySelector('.simba-btn-success, .simba-btn-ready, .simba-btn-error, .simba-btn-manual')) return;

      const rowEl = tr || photosCell.closest('tr');
      if (rowEl) {
        rowEl.style.backgroundColor = '#fff3e0';
      }

      const btn = document.createElement('button');
      btn.className = 'simba-btn simba-btn-manual';
      btn.textContent = 'Manual Checkin requested';
      btn.title = rego + ' — notes mention "manual": ' + (notes || '(no further note text)') + ' · Click to open the booking page and check in manually';

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!updateUrl) return;
        window.open(
          updateUrl,
          'simbaManualCheckin_' + rego,
          'popup=yes,width=1100,height=800,noopener,noreferrer'
        );
      });

      const br = document.createElement('br');
      photosCell.appendChild(br);
      photosCell.appendChild(btn);
    }

    async function handleMarkAsReturned(btn, rego, resNo, updateUrl, kms, needsRefuel) {
      setButtonState(btn, 'loading', '<span class="simba-spinner"></span> Submitting return...');
      try {
        const submitResp = await submitReturnMsg(updateUrl, kms, (typeof needsRefuel !== "undefined" ? needsRefuel : false));
        if (!submitResp.success) throw new Error(submitResp.error || 'Submit failed');
        setButtonState(btn, 'success', '✓ Returned');
        setTimeout(() => location.reload(), 3000);
        const successRow = btn.closest('tr');
        if (successRow) successRow.style.backgroundColor = '#c8e6c9';
        btn.title = rego + ' marked as returned. KMs: ' + kms;
      } catch (err) {
        console.error('[Simba Return] Error marking as returned:', err);
        setButtonState(btn, 'error', '✗ ' + (err.message || 'Error'));
        btn.title = err.message;
        btn.disabled = false;
        setTimeout(() => {
          setButtonState(btn, 'ready', '↺ Retry Return');
          btn.disabled = false;
        }, 3000);
      }
    }

    // ── UI Helpers ─────────────────────────────────────────────────────────

    function setButtonState(btn, state, html) {
      btn.className = `simba-btn simba-btn-${state}`;
      btn.innerHTML = html;
      btn.disabled = (state === 'loading' || state === 'success');
    }

    let statusBarEl = null;
    let statusTimeout = null;

    function showStatusBar(message, type = 'checking', autoDismissMs = 0) {
      if (!statusBarEl) {
        statusBarEl = document.createElement('div');
        statusBarEl.className = 'simba-status-bar';
        statusBarEl.title = 'Click to show/hide the Auto-Return menu';
        statusBarEl.addEventListener('click', toggleMenu);
        document.body.appendChild(statusBarEl);
      }
      statusBarEl.textContent = `🚗 Simba Return: ${message}`;
      statusBarEl.className = `simba-status-bar ${type}`;
      statusBarEl.classList.remove('hidden');

      if (statusTimeout) clearTimeout(statusTimeout);
      if (autoDismissMs > 0) {
        statusTimeout = setTimeout(() => {
          statusBarEl.classList.add('hidden');
        }, autoDismissMs);
      }
    }

    function injectStyles(css) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }

    // New: floating bottom-right panel with the Auto-Return toggle and the
    // branch/location filter. Collapsed by default; clicking the status
    // widget toggles it.
    function toggleMenu() {
      if (!menuEl) return;
      menuEl.classList.toggle('simba-menu-collapsed');
    }

    function injectFloatingMenu() {
      const menu = document.createElement('div');
      menu.className = 'simba-menu simba-menu-collapsed';
      menu.innerHTML = `
        <div class="simba-menu-title">🚗 Simba Return Manager</div>
        <label class="simba-menu-row">
          <span>Auto-Return</span>
          <span class="simba-switch">
            <input type="checkbox" id="simba-auto-toggle">
            <span class="simba-slider"></span>
          </span>
        </label>
        <div class="simba-menu-divider"></div>
        <div class="simba-menu-subtitle">Locations (Dropoff)</div>
        <div class="simba-menu-locations" id="simba-location-list"></div>
        <div class="simba-menu-hint" id="simba-menu-hint"></div>
      `;
      document.body.appendChild(menu);
      menuEl = menu;

      // Clicks inside the menu shouldn't bubble up to the document and
      // accidentally trigger anything else; they also shouldn't close the
      // menu via the status bar (which is a separate element anyway).
      menu.addEventListener('click', (e) => e.stopPropagation());

      const checkbox = menu.querySelector('#simba-auto-toggle');
      const hint = menu.querySelector('#simba-menu-hint');
      const locationList = menu.querySelector('#simba-location-list');

      function refreshHint() {
        const enabled = getEnabledLocations();
        const locLabel = enabled.length ? enabled.join(', ') : 'none — nothing will be scanned';
        hint.textContent = (checkbox.checked
          ? 'Ready vehicles will be auto checked-in.'
          : 'Auto check-in is off — use the "Check In" button on each row.')
          + ' Watching: ' + locLabel + '.';
      }

      checkbox.checked = isAutoReturnEnabled();
      refreshHint();

      checkbox.addEventListener('change', () => {
        setAutoReturnEnabled(checkbox.checked);
        refreshHint();
      });

      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(AUTO_RETURN_KEY, (name, oldValue, newValue) => {
          checkbox.checked = (newValue === true || newValue === 'true');
          refreshHint();
        });
      }

      // Build one checkbox row per known branch. Sydney is on by default
      // (see getEnabledLocations()); everything else starts unticked.
      const enabledSet = new Set(getEnabledLocations());
      const locationCheckboxes = [];
      LOCATIONS.forEach(loc => {
        const row = document.createElement('label');
        row.className = 'simba-menu-row simba-menu-location-row';
        row.innerHTML = `
          <span>${loc.label} <span class="simba-loc-code">(${loc.code})</span></span>
          <input type="checkbox" class="simba-loc-checkbox" data-code="${loc.code}">
        `;
        locationList.appendChild(row);

        const cb = row.querySelector('.simba-loc-checkbox');
        cb.checked = enabledSet.has(loc.code);
        locationCheckboxes.push(cb);

        cb.addEventListener('change', () => {
          const current = new Set(getEnabledLocations());
          if (cb.checked) current.add(loc.code);
          else current.delete(loc.code);
          setEnabledLocations(Array.from(current));
          refreshHint();
        });
      });

      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(ENABLED_LOCATIONS_KEY, (name, oldValue, newValue) => {
          let codes = [];
          try { codes = Array.isArray(newValue) ? newValue : JSON.parse(newValue); } catch (e) { codes = []; }
          const set = new Set(codes);
          locationCheckboxes.forEach(cb => { cb.checked = set.has(cb.dataset.code); });
          refreshHint();
        });
      }
    }
  }

})();
