// ==UserScript==
// @name         Simba Return Manager (Userscript)
// @namespace    simba-return-manager
// @version      1.1.0
// @description  Auto-detects returned vehicles via We-Integrate and marks them as returned in RCM. Auto-return is OFF by default for testing — use the floating toggle or the per-row "Check In" button.
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
    if (batchType.toLowerCase() !== 'check in') return { found: false, reason: 'Latest batch is "' + batchType + '", not Check In' };
    if (dateAdded !== todayStr) return { found: false, reason: 'Check In found but date is ' + dateAdded + ', not today' };
    if (!kms || kms === '0') return { found: true, checkInToday: true, noKms: true, reason: 'No KMs input for this batch', kms: null, needsRefuel };
    return { found: true, checkInToday: true, noKms: false, kms, needsRefuel, notes };
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
    `;

    injectStyles(STYLE);
    injectFloatingMenu();

    // Re-scan continuously — as soon as one scan finishes, wait 5 seconds then start next
    const continuousScan = () => {
      window.__simbaReturnManagerLoaded = false;
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
        const tbl = Array.from(document.querySelectorAll('table.lstReport'))
          .find(t => t.rows.length > 5 && Array.from(t.querySelectorAll('th')).some(th => th.textContent.trim() === 'Photos'));
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
      const rows = getDropoffRows();
      const regoList = rows.map(r => r.rego).join(', ');
      console.log('[Simba] Scanning ' + rows.length + ' vehicles: ' + regoList);
      showStatusBar('Checking ' + rows.length + ' vehicle(s) against We-Integrate...', 'checking');
      if (!rows.length) {
        console.log('[Simba Return] No dropoff rows found.');
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
          if (!result.success) { results.push(null); continue; }
          results.push({ row, data: result.data });
        } catch (e) {
          console.error('[Simba Return] Error checking ' + rego + ':', e);
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
          if (data.noKms) {
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

      const vehicleColIdx = (() => {
        const tbl = Array.from(document.querySelectorAll('table.lstReport'))
          .find(t => t.rows.length > 5 && Array.from(t.querySelectorAll('th')).some(th => th.textContent.trim() === 'Photos'));
        if (!tbl) return -1;
        const ths = Array.from(tbl.querySelectorAll('th'));
        return ths.findIndex(th => th.textContent.trim() === 'Vehicle');
      })();

      let allRows;
      let dropoffTable = null;
      const lstTables = Array.from(document.querySelectorAll('table.lstReport'))
        .filter(t => t.rows.length > 5);
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

        let updateUrl = null;
        if (resNo) {
          updateUrl = 'https://bookings.rentalcarmanager.com/reservations/update/booking/' + resNo + '/2';
        }

        if (rego && resNo && updateUrl) {
          if (!rows.find(r => r.resNo === resNo)) {
            rows.push({ rego, resNo, updateUrl, photosCell, tr });
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
      if (photosCell.querySelector('.simba-btn-success, .simba-btn-ready, .simba-btn-error')) return;

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
      if (photosCell.querySelector('.simba-btn-success, .simba-btn-ready, .simba-btn-error')) return;

      const btn = document.createElement('button');
      btn.className = 'simba-btn simba-btn-error';
      btn.textContent = message;
      btn.title = rego + ': ' + message;
      btn.disabled = true;

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

    // New: floating bottom-right panel with the Auto-Return toggle.
    function injectFloatingMenu() {
      const menu = document.createElement('div');
      menu.className = 'simba-menu';
      menu.innerHTML = `
        <div class="simba-menu-title">🚗 Simba Return Manager</div>
        <label class="simba-menu-row">
          <span>Auto-Return</span>
          <span class="simba-switch">
            <input type="checkbox" id="simba-auto-toggle">
            <span class="simba-slider"></span>
          </span>
        </label>
        <div class="simba-menu-hint" id="simba-menu-hint"></div>
      `;
      document.body.appendChild(menu);

      const checkbox = menu.querySelector('#simba-auto-toggle');
      const hint = menu.querySelector('#simba-menu-hint');

      function refreshHint() {
        hint.textContent = checkbox.checked
          ? 'Ready vehicles will be auto checked-in.'
          : 'Auto check-in is off — use the "Check In" button on each row.';
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
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

})();
