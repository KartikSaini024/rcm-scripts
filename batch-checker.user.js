// ==UserScript==
// @name         Rental Car Batch Checker with Token Extractor + Auto-Refresh
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      2.0
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

        /* 3D light-blue compact button - fixed disabled state */
        .rcm-3d-batch-btn {
            position: relative;
            display: inline-block;
            cursor: pointer;
            outline: none;
            border: 0;
            vertical-align: middle;
            text-decoration: none;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            padding: 0.65em 1.4em;
            color: #1e3a5f;
            background: #f0f7ff;
            border: 1.5px solid #60a5fa;
            border-radius: 0.5em;
            transform-style: preserve-3d;
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                background 140ms cubic-bezier(0, 0, 0.58, 1),
                opacity 140ms ease;
            min-width: 220px;
            text-align: center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
            z-index: 1;
        }

        .rcm-3d-batch-btn::before {
            position: absolute;
            content: '';
            inset: 0;
            background: #bfdbfe;
            border-radius: inherit;
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.4em 0 0 #dbeafe;
            transform: translate3d(0, 0.4em, -1em);
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                box-shadow 140ms cubic-bezier(0, 0, 0.58, 1);
            z-index: -1;
        }

        .rcm-3d-batch-btn:hover:not(:disabled) {
            background: #e0f2fe;
            transform: translate(0, 0.15em);
        }

        .rcm-3d-batch-btn:hover:not(:disabled)::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.25em 0 0 #dbeafe;
            transform: translate3d(0, 0.25em, -1em);
        }

        .rcm-3d-batch-btn:active:not(:disabled) {
            background: #e0f2fe;
            transform: translate(0, 0.35em);
        }

        .rcm-3d-batch-btn:active:not(:disabled)::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0 #dbeafe;
            transform: translate3d(0, 0, -1em);
        }

        /* Disabled / Scanning state - clean & readable */
        .rcm-3d-batch-btn:disabled,
        .rcm-3d-batch-btn:disabled::before {
            opacity: 0.75;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
            transition: opacity 0.2s ease;
        }

        .rcm-3d-batch-btn:disabled::before {
            transform: translate3d(0, 0.2em, -1em) !important;
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.2em 0 0 #dbeafe !important;
        }

        /* Rest of your original styles remain unchanged */
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
        .batch-checkin { background-color: #c8e6c9 !important; }
        .batch-damage { background-color: #fed7aa !important; }
        .batch-error { background-color: #fecaca !important; }
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
        checkButton.className = 'rcm-3d-batch-btn';
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

    let isRefreshingToken = false;

    async function handleCheckClick(button, controlPanel) {
        const startTime = Date.now();
        console.log('[BatchCheck] Starting scan...');
        button.disabled = true;
        button.textContent = 'Scanning...';

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

        // ── COLLECT VEHICLES - DYNAMIC COLUMN DETECTION ──────────────────────────────
        const headerRow = document.querySelector('#Dropoff thead tr');
        let vehicleColumnIndex = -1;
        if (headerRow) {
            const headers = Array.from(headerRow.querySelectorAll('th, td'));
            const vehicleKeywords = [
                'vehicle', 'rego', 'reg', 'registration', 'plate', 'reg no', 'reg#',
                'licence', 'license', 'number plate', 'vin', 'unit'
            ];
            headers.forEach((header, idx) => {
                const text = header.innerText.trim().toLowerCase();
                if (vehicleKeywords.some(kw => text.includes(kw))) {
                    vehicleColumnIndex = idx;
                }
            });
        }
        if (vehicleColumnIndex === -1) {
            vehicleColumnIndex = 14;
        }

        const rows = Array.from(document.querySelectorAll('#Dropoff tbody tr[role="row"]'))
            .filter(r => !r.classList.contains('noexport'));

        const vehicles = [];
        rows.forEach((row) => {
            const tds = row.querySelectorAll('td');
            if (tds.length === 0) return;

            let targetCell = (vehicleColumnIndex >= 0 && vehicleColumnIndex < tds.length)
                ? tds[vehicleColumnIndex]
                : tds[tds.length - 1];

            const text = targetCell?.innerText?.trim() || '';
            const regoMatch = text.match(/^[A-Z0-9]{5,8}/i);
            if (regoMatch) {
                vehicles.push({ rego: regoMatch[0].toUpperCase(), row });
            }
        });

        if (vehicles.length === 0) {
            showToast('No valid registration plates found in table', 8000);
            resetButton(progressContainer);
            return;
        }

        let green = 0, orange = 0, other = 0, errors = 0, done = 0;
        const CONCURRENCY = 3;
        let failedVehicles = [];
        let requestCounter = 0;

        async function processOne(vehicle, attempt = 1) {
            const { rego, row } = vehicle;
            const reqId = ++requestCounter;

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
            } catch (e) {
                const isAuthError = /400|401|403|token|forbidden/i.test(e.message);
                if (isAuthError && attempt === 1 && !isRefreshingToken) {
                    failedVehicles.push(vehicle);
                } else {
                    row.classList.add('batch-error');
                    errors++;
                }
            } finally {
                done++;
                const pct = Math.round((done / vehicles.length) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = `${pct}% (${done}/${vehicles.length})`;
            }
        }

        // First pass
        let queue = vehicles.slice();
        const active = new Set();
        while (queue.length > 0 || active.size > 0) {
            while (active.size < CONCURRENCY && queue.length > 0) {
                const vehicle = queue.shift();
                const promise = processOne(vehicle).finally(() => active.delete(promise));
                active.add(promise);
            }
            if (active.size > 0) await Promise.race(active);
        }

        // Retry failed
        if (failedVehicles.length > 0 && !isRefreshingToken) {
            showToast(`Auth error on ${failedVehicles.length} vehicle(s) → refreshing token...`, 12000);
            isRefreshingToken = true;
            const refreshed = await refreshTokenAutomatically();
            isRefreshingToken = false;
            if (refreshed) {
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
            }
        }

        const durationSeconds = Math.round((Date.now() - startTime) / 1000);
        showToast(
            `Scan finished:\n✓ Check-In: ${green} ⚠ Damage: ${orange}\n• Other: ${other} ✗ Errors: ${errors}\n(${durationSeconds}s)`,
            14000
        );

        setTimeout(() => resetButton(progressContainer), 2200);

        function resetButton(progressContainer) {
            button.disabled = false;
            button.textContent = 'Check Vehicle Batches';
            progressContainer?.remove();
        }
    }

    function refreshTokenAutomatically() {
        return new Promise((resolve) => {
            const popup = window.open(
                'https://we-integrate.co.nz/pwd/login',
                'tokenRefreshPopup',
                'width=820,height=640,left=180,top=80,menubar=no,toolbar=no,location=no'
            );

            if (!popup) {
                showToast('Popup blocked! Please allow popups.', 12000);
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
                        resolve(newToken && newToken.length > 30);
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
                        reject(new Error(`HTTP ${r.status}`));
                        return;
                    }
                    if (r.status !== 200) {
                        reject(new Error(`HTTP ${r.status}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(r.responseText);
                        const batches = data.ests || [];
                        if (!batches.length) return reject(new Error('No batches'));
                        const latest = batches[0];
                        const typeMeta = latest.metadata?.find(m => m.name === 'batch_type');
                        if (!typeMeta) return reject(new Error('No batch_type'));
                        resolve({ type: typeMeta.value.trim() });
                    } catch (e) {
                        reject(new Error('JSON error'));
                    }
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }

    // ── Initialize ────────────────────────────────────────────────────────────
    addCheckButton();

})();
