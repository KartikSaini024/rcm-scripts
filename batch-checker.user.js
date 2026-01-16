// ==UserScript==
// @name         Rental Car Batch Checker with Token Extractor + Auto-Refresh
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.99
// @description  Shows latest batch type (Check In / Damage) — 3× parallel + auto token refresh via popup
// @author       Kartik
// @match        https://we-integrate.co.nz/*
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/batch-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/batch-checker.user.js

// ==/UserScript==

(function () {
    'use strict';

    // ── Styles ────────────────────────────────────────────────────────────────
    GM_addStyle(`
        #rcm-batch-control-panel {
            display: flex;
            flex-direction: column;
            align-items: center;
            margin: 20px auto;
            max-width: 900px;
        }
        #rcm-batch-controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .rcm-control-item {
            padding: 10px 28px;
            font-size: 15px;
            font-weight: 600;
            border-radius: 50px;
            text-align: center;
            min-width: 170px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.12);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            cursor: pointer;
            border: none;
        }
        #rcm-check-button {
            background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
            color: white;
        }
        #rcm-check-button:hover:not(:disabled) {
            transform: translateY(-3px) scale(1.03);
            box-shadow: 0 12px 28px rgba(59, 130, 246, 0.4);
        }
        #rcm-help-button {
            width: 42px;
            height: 42px;
            background: #e2e8f0;
            color: #475569;
            font-size: 22px;
            font-weight: bold;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: help;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        #rcm-help-button:hover {
            background: #3b82f6;
            color: white;
            transform: translateY(-3px) scale(1.08);
        }
        #rcm-help-panel {
            position: absolute;
            top: 58px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            color: #1e293b;
            padding: 18px 22px;
            border-radius: 16px;
            box-shadow: 0 14px 38px rgba(0,0,0,0.22);
            width: 340px;
            font-size: 14px;
            line-height: 1.6;
            z-index: 10000;
            opacity: 0;
            visibility: hidden;
            transition: all 0.35s ease;
        }
        #rcm-help-panel.show {
            opacity: 1;
            visibility: visible;
            top: 52px;
        }
        .help-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 10px 0;
        }
        .help-color {
            width: 22px;
            height: 22px;
            border-radius: 6px;
            flex-shrink: 0;
        }
        #rcm-progress-container {
            width: 100%;
            max-width: 520px;
            background: #e2e8f0;
            border-radius: 999px;
            overflow: hidden;
            height: 26px;
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.08);
            margin-top: 18px;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.5s ease, transform 0.5s ease;
        }
        #rcm-progress-container.visible {
            opacity: 1;
            transform: translateY(0);
        }
        #rcm-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #4ade80 0%, #86efac 100%);
            transition: width 0.8s cubic-bezier(0.25, 0.8, 0.25, 1);
            position: relative;
            overflow: hidden;
        }
        #rcm-progress-bar::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%);
            background-size: 80px 100%;
            animation: shine 2.2s linear infinite;
        }
        @keyframes shine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        #rcm-progress-text {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #0f172a;
            font-weight: bold;
            font-size: 13.5px;
            text-shadow: 0 1px 3px rgba(255,255,255,0.9);
            pointer-events: none;
        }
        .batch-checkin    { background-color: #c8e6c9 !important; }
        .batch-damage     { background-color: #fed7aa !important; }
        .batch-error      { background-color: #fecaca !important; }
        #rcm-toast {
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            background: #1e293b;
            color: white;
            padding: 14px 28px;
            border-radius: 12px;
            box-shadow: 0 12px 32px rgba(0,0,0,0.35);
            z-index: 100000;
            opacity: 0;
            transition: all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        }
        #rcm-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    `);

    const currentHost = location.hostname;

    // ── Token saving on we-integrate.co.nz ───────────────────────────────────
    if (currentHost === 'we-integrate.co.nz') {
        function getCookie(name) {
            return document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1] || null;
        }

        function tryGetToken() {
            const token = getCookie('XSRF-TOKEN');
            if (token) {
                const decoded = decodeURIComponent(token);
                GM_setValue('xsrf_token', decoded);
                console.log('[TOKEN] XSRF token saved → ' + decoded.substring(0, 12) + '...');
            } else {
                setTimeout(tryGetToken, 1200);
            }
        }

        tryGetToken();
        return;
    }

    if (currentHost !== 'bookings.rentalcarmanager.com') return;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function showToast(message, duration = 9000) {
        let toast = document.getElementById('rcm-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'rcm-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast.hideTimeout);
        toast.hideTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }

    function getTimeStamp() {
        return new Date().toISOString().slice(11, 19);
    }

    // ── Add control panel & button ───────────────────────────────────────────
    function addCheckButton() {
        const table = document.querySelector('#Dropoff');
        if (!table) return setTimeout(addCheckButton, 800);

        const panel = document.createElement('div');
        panel.id = 'rcm-batch-control-panel';

        const controls = document.createElement('div');
        controls.id = 'rcm-batch-controls';

        const checkButton = document.createElement('button');
        checkButton.id = 'rcm-check-button';
        checkButton.className = 'rcm-control-item';
        checkButton.textContent = 'Check Vehicle Batches';

        const helpWrapper = document.createElement('div');
        helpWrapper.style.position = 'relative';

        const helpButton = document.createElement('div');
        helpButton.id = 'rcm-help-button';
        helpButton.textContent = '?';

        const helpPanel = document.createElement('div');
        helpPanel.id = 'rcm-help-panel';
        helpPanel.innerHTML = `
            <small>This tool highlights rows based on the <b>most recent</b> batch type photos.<br>Use as a helper only.</small>
            <br><strong>Color Legend:</strong><br>
            <div class="help-row"><div class="help-color" style="background:#c8e6c9"></div>Latest = <b>Check In</b></div>
            <div class="help-row"><div class="help-color" style="background:#fed7aa"></div>Latest = <b>Damage</b></div>
            <div class="help-row"><div class="help-color" style="background:#fecaca"></div>Error / connection issue</div>
            <div class="help-row"><div class="help-color" style="background:transparent;border:1px dashed #94a3b8"></div>Other / no data</div>
            <small style="color:#e11d48">Red rows? Token issue → popup will open. Log in if asked, then close it.</small>
        `;

        helpWrapper.appendChild(helpButton);
        helpWrapper.appendChild(helpPanel);

        helpButton.addEventListener('mouseenter', () => helpPanel.classList.add('show'));
        helpButton.addEventListener('mouseleave', () => helpPanel.classList.remove('show'));
        helpButton.addEventListener('click', e => { e.stopPropagation(); helpPanel.classList.toggle('show'); });
        document.addEventListener('click', () => helpPanel.classList.remove('show'));

        controls.appendChild(checkButton);
        controls.appendChild(helpWrapper);
        panel.appendChild(controls);
        table.parentNode.insertBefore(panel, table);

        checkButton.onclick = () => handleCheckClick(checkButton, panel);
    }

    // ── Main scan logic ───────────────────────────────────────────────────────
    let isRefreshingToken = false;

    async function handleCheckClick(button, controlPanel) {
        const startTime = Date.now();
        console.log('[BatchCheck] Starting scan...');
        button.disabled = true;
        button.textContent = 'Scanning...';
        button.style.opacity = '0.7';
        button.style.cursor = 'not-allowed';

        const progressContainer = document.createElement('div');
        progressContainer.id = 'rcm-progress-container';
        progressContainer.classList.add('visible');

        const progressBar = document.createElement('div');
        progressBar.id = 'rcm-progress-bar';
        progressBar.style.width = '0%';

        const progressText = document.createElement('div');
        progressText.id = 'rcm-progress-text';
        progressText.textContent = '0%';

        progressContainer.appendChild(progressBar);
        progressContainer.appendChild(progressText);
        controlPanel.appendChild(progressContainer);

        // Token check
        let xsrfToken = GM_getValue('xsrf_token', null);
        if (!xsrfToken) {
            console.log('[TOKEN] No token found - initiating refresh...');
            showToast('No saved token → opening login page...', 8000);
            const success = await refreshTokenAutomatically();
            if (!success) {
                showToast('Token refresh failed. Please allow popups and try again.', 14000);
                resetButton(progressContainer);
                return;
            }
            xsrfToken = GM_getValue('xsrf_token', null);
        }

        // Collect vehicles
        // ── COLLECT VEHICLES - DYNAMIC COLUMN DETECTION ──────────────────────────────

        // First, try to find the table header row to detect column names
        const headerRow = document.querySelector('#Dropoff thead tr');
        let vehicleColumnIndex = -1;

        if (headerRow) {
            const headers = Array.from(headerRow.querySelectorAll('th, td'));
            console.log(`[DEBUG] Found ${headers.length} header cells`);

            // Look for common registration-related column names (case-insensitive)
            const vehicleKeywords = [
                'vehicle', 'rego', 'reg', 'registration', 'plate', 'reg no', 'reg#',
                'licence', 'license', 'number plate', 'vin', 'unit'
            ];

            headers.forEach((header, idx) => {
                const text = header.innerText.trim().toLowerCase();
                if (vehicleKeywords.some(kw => text.includes(kw))) {
                    vehicleColumnIndex = idx;
                    console.log(`[DEBUG] Detected VEHICLE column at index ${idx} → "${header.innerText.trim()}"`);
                }
            });
        }

        if (vehicleColumnIndex === -1) {
            console.warn('[DEBUG] Could not detect Vehicle/Rego column from header → falling back to default column index 14');
            // Fallback: assume rego is in the last column (common when headers are missing/hidden)
            vehicleColumnIndex = 14; // will use tds.length - 1 later
        }

        // Now collect rows
        const rows = Array.from(document.querySelectorAll('#Dropoff tbody tr[role="row"]'))
        .filter(r => !r.classList.contains('noexport'));

        // console.log(`[DEBUG] Total rows with role="row": ${rows.length}`);

        const vehicles = [];

        rows.forEach((row, rowIndex) => {
            const tds = row.querySelectorAll('td');

            // console.log(`[DEBUG] Row ${rowIndex + 1} has ${tds.length} <td> cells`);

            if (tds.length === 0) return;

            // Determine which cell to read
            let targetCell;
            if (vehicleColumnIndex >= 0 && vehicleColumnIndex < tds.length) {
                targetCell = tds[vehicleColumnIndex];
            } else {
                // Fallback to last cell if header detection failed
                targetCell = tds[tds.length - 1];
                // console.log(`[DEBUG] Row ${rowIndex + 1} using fallback: last column`);
            }

            const text = targetCell?.innerText?.trim() || '';

            // console.log(`[DEBUG] Row ${rowIndex + 1} - Target column content: "${text}"`);

            const regoMatch = text.match(/^[A-Z0-9]{5,8}/i);

            if (regoMatch) {
                const rego = regoMatch[0].toUpperCase();
                // console.log(`[DEBUG] Row ${rowIndex + 1} → VALID REGO: ${rego}`);
                vehicles.push({ rego, row });
            } else {
                console.log(`[DEBUG] Row ${rowIndex + 1} → No valid rego found`);
            }
        });

        console.log(`[BatchCheck] Found ${vehicles.length} vehicles with valid rego`);

        if (vehicles.length === 0) {
            console.warn('[BatchCheck] No vehicles with valid registration plates were detected');
            showToast('No valid registration plates found in table (column detection may have failed)', 8000);
            resetButton(progressContainer);
            return;
        }

        // Counters
        let green = 0, orange = 0, other = 0, errors = 0, done = 0;
        const CONCURRENCY = 3;
        let failedVehicles = [];
        let requestCounter = 0;

        // Process single vehicle
        async function processOne(vehicle, attempt = 1) {
            const { rego, row } = vehicle;
            const reqId = ++requestCounter;

            console.log(`[REQ ${reqId}] attempt #${attempt} | ${rego} | START ${getTimeStamp()}`);

            try {
                const token = GM_getValue('xsrf_token');
                const result = await getLatestBatchType(rego, token);

                row.classList.remove('batch-checkin', 'batch-damage', 'batch-error');

                if (result.type === 'Check In') {
                    row.classList.add('batch-checkin');
                    green++;
                } else if (result.type === 'Damage') {
                    row.classList.add('batch-damage');
                    orange++;
                } else {
                    other++;
                }

                console.log(`[REQ ${reqId}] SUCCESS - ${rego} → ${result.type}`);
            } catch (e) {
                const isAuthError = /400|401|403|token|forbidden/i.test(e.message);

                if (isAuthError && attempt === 1 && !isRefreshingToken) {
                    console.warn(`[REQ ${reqId}] AUTH ERROR - ${rego} → queued for retry`);
                    failedVehicles.push(vehicle);
                } else {
                    row.classList.add('batch-error');
                    errors++;
                    console.error(`[REQ ${reqId}] FAILED - ${rego} → ${e.message}`);
                }
            } finally {
                done++;
                console.log(`[REQ ${reqId}] END ${rego} ${getTimeStamp()}`);
                const pct = Math.round((done / vehicles.length) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = `${pct}% (${done}/${vehicles.length})`;
            }
        }

        // First pass - concurrent processing
        let queue = vehicles.slice();
        const active = new Set();

        console.log(`[BatchCheck] Starting main scan - max concurrency: ${CONCURRENCY}`);

        while (queue.length > 0 || active.size > 0) {
            while (active.size < CONCURRENCY && queue.length > 0) {
                const vehicle = queue.shift();
                const promise = processOne(vehicle).finally(() => active.delete(promise));
                active.add(promise);
            }
            if (active.size > 0) await Promise.race(active);
        }

        // Retry failed due to auth
        if (failedVehicles.length > 0 && !isRefreshingToken) {
            console.log(`[BatchCheck] ${failedVehicles.length} vehicles need retry after token refresh`);
            showToast(`Auth error on ${failedVehicles.length} vehicle(s) → opening login popup...`, 12000);

            isRefreshingToken = true;
            const refreshed = await refreshTokenAutomatically();
            isRefreshingToken = false;

            if (refreshed) {
                showToast('Token updated → retrying failed vehicles...', 6000);
                done = vehicles.length - failedVehicles.length;
                queue = failedVehicles.slice();
                active.clear();

                while (queue.length > 0 || active.size > 0) {
                    while (active.size < CONCURRENCY && queue.length > 0) {
                        const vehicle = queue.shift();
                        const promise = processOne(vehicle, 2).finally(() => active.delete(promise));
                        active.add(promise);
                    }
                    if (active.size > 0) await Promise.race(active);
                }
            } else {
                showToast('No new token found after popup closed. Please log in properly.', 14000);
            }
        }

        // Final result
        const durationSeconds = Math.round((Date.now() - startTime) / 1000);
        const totalSuccess = green + orange + other;

        const summary = `
[BatchCheck] SCAN SUMMARY
──────────────────────────────
Vehicles processed: ${vehicles.length}
   ✓ Check-In: ${green}
   ⚠ Damage:   ${orange}
   • Other:     ${other}
   ✗ Errors:    ${errors}
Duration: ${durationSeconds} seconds
──────────────────────────────`;

        console.log(summary);

        if (totalSuccess === 0 && errors > 0) {
            showToast('All requests failed – most likely persistent token issue.', 14000);
        } else {
            showToast(
                `Scan finished:\n✓ Check-In: ${green}   ⚠ Damage: ${orange}\n• Other: ${other}   ✗ Errors: ${errors}`,
                14000
            );
        }

        setTimeout(() => resetButton(progressContainer), 2200);

        function resetButton(progressContainer) {
            button.disabled = false;
            button.textContent = 'Check Vehicle Batches';
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            progressContainer?.remove();
            console.log('[BatchCheck] Ready for next run');
        }
    }

    // ── Token refresh via popup ──────────────────────────────────────────────
    function refreshTokenAutomatically() {
        return new Promise((resolve) => {
            console.log('[TOKEN REFRESH] Opening login popup...');
            showToast('If asked, please log in → then CLOSE this window to continue', 18000);

            const popup = window.open(
                'https://we-integrate.co.nz/pwd/login',
                'tokenRefreshPopup',
                'width=820,height=640,left=180,top=80,menubar=no,toolbar=no,location=no'
            );

            if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                console.warn('[TOKEN REFRESH] Popup blocked or failed to open');
                showToast('Popup blocked! Please allow popups for this site.', 12000);
                resolve(false);
                return;
            }

            let checks = 0;
            const maxChecks = 45;

            const interval = setInterval(() => {
                checks++;
                if (popup.closed) {
                    clearInterval(interval);
                    setTimeout(() => {
                        const newToken = GM_getValue('xsrf_token', '');
                        if (newToken && newToken.length > 30) {
                            console.log('[TOKEN REFRESH] Success - valid token detected');
                            resolve(true);
                        } else {
                            console.warn('[TOKEN REFRESH] Popup closed but no valid token found');
                            resolve(false);
                        }
                    }, 1200);
                }
                if (checks >= maxChecks) {
                    clearInterval(interval);
                    popup.close?.();
                    resolve(false);
                }
            }, 1000);
        });
    }

    // ── API request ───────────────────────────────────────────────────────────
    function getLatestBatchType(rego, xsrfToken) {
        return new Promise((resolve, reject) => {
            const payload = {
                batchSearch: {
                    hasFiles: false,
                    type: "custom",
                    columnsNg: [],
                    limitColumns: [],
                    search: rego,
                    exactMatch: false,
                    fullTextSearch: true,
                    lastViews: [],
                    utcDateMode: false,
                    utcOffset: 0,
                    isPanelMode: false
                },
                accountCode: "sydney@simbacarhire.co.nz"
            };

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://we-integrate.co.nz/node/batch/search',
                data: JSON.stringify(payload),
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json',
                    'x-xsrf-token': xsrfToken || ''
                },
                timeout: 14000,
                onload: r => {
                    if ([400, 401, 403].includes(r.status)) {
                        reject(new Error(`HTTP ${r.status} - likely invalid/expired token`));
                        return;
                    }
                    if (r.status !== 200) {
                        reject(new Error(`HTTP ${r.status}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(r.responseText);
                        const batches = data.ests || [];
                        if (!batches.length) {
                            reject(new Error('No batches found'));
                            return;
                        }
                        const latest = batches[0];
                        const typeMeta = latest.metadata?.find(m => m.name === 'batch_type');
                        if (!typeMeta) {
                            reject(new Error('No batch_type in metadata'));
                            return;
                        }
                        resolve({ type: typeMeta.value.trim() });
                    } catch (e) {
                        reject(new Error('JSON parse error'));
                    }
                },
                onerror:   () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    // ── Initialize ────────────────────────────────────────────────────────────
    addCheckButton();
})();
