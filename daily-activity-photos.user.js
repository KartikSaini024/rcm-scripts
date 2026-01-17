// ==UserScript==
// @name         RentalCarManager - Photos Column (Popup Window)
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.1
// @description  Adds Photos column with popup buttons
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/daily-activity-photos.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/daily-activity-photos.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // === Very compact 3D layered button – light blue theme (~40% smaller) ===
    const BUTTON_STYLES = `
        .rcm-photo-btn {
            position: relative;
            display: inline-block;
            cursor: pointer;
            outline: none;
            border: 0;
            vertical-align: middle;
            text-decoration: none;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 11px;           /* significantly smaller text */
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rcm-photo-btn.learn-more {
            color: #1e3a5f;
            padding: 0.55em 1.1em;     /* much tighter padding */
            background: #f0f7ff;
            border: 1.5px solid #60a5fa;
            border-radius: 0.5em;      /* smaller radius */
            transform-style: preserve-3d;
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                background 140ms cubic-bezier(0, 0, 0.58, 1);
        }

        .rcm-photo-btn.learn-more::before {
            position: absolute;
            content: '';
            width: 100%;
            height: 100%;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #bfdbfe;
            border-radius: inherit;
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.35em 0 0 #dbeafe;   /* reduced shadow depth */
            transform: translate3d(0, 0.4em, -1em);
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                box-shadow 140ms cubic-bezier(0, 0, 0.58, 1);
        }

        .rcm-photo-btn.learn-more:hover {
            background: #e0f2fe;
            transform: translate(0, 0.15em);
        }

        .rcm-photo-btn.learn-more:hover::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.25em 0 0 #dbeafe;
            transform: translate3d(0, 0.25em, -1em);
        }

        .rcm-photo-btn.learn-more:active {
            background: #e0f2fe;
            transform: translate(0, 0.35em);
        }

        .rcm-photo-btn.learn-more:active::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0 #dbeafe;
            transform: translate3d(0, 0, -1em);
        }
    `;

    const DEBUG = false;
    const log = (...args) => DEBUG && console.log('[Photos Popup]', ...args);

    // Popup window settings
    const POPUP_WIDTH = 1200;
    const POPUP_HEIGHT = 800;

    function openPopup(url, title = 'Vehicle Photos') {
        const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
        const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
        const width = window.innerWidth || document.documentElement.clientWidth || screen.width;
        const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
        const left = ((width / 2) - (POPUP_WIDTH / 2)) + dualScreenLeft;
        const top = ((height / 2) - (POPUP_HEIGHT / 2)) + dualScreenTop;

        const features = [
            `width=${POPUP_WIDTH}`,
            `height=${POPUP_HEIGHT}`,
            `top=${top}`,
            `left=${left}`,
            'scrollbars=yes',
            'resizable=yes',
            'toolbar=no',
            'menubar=no',
            'location=yes',
            'status=yes'
        ].join(',');

        const popup = window.open(url, title, features);
        if (popup && popup.focus) popup.focus();
        return popup;
    }

    function injectStyles() {
        if (document.getElementById('rcm-photo-btn-styles')) return;

        const style = document.createElement('style');
        style.id = 'rcm-photo-btn-styles';
        style.textContent = BUTTON_STYLES;
        document.head.appendChild(style);
    }

    function tryAddPhotosColumn() {
        const table = document.querySelector('table#Dropoff.dataTable');
        if (!table || !table.classList.contains('dataTable')) return false;

        if (document.querySelector('th[data-photos-col="true"]')) {
            log('Photos column already exists');
            return true;
        }

        log('Adding Photos column with very compact 3D light-blue buttons');

        injectStyles();

        const headerRow = table.querySelector('thead tr:first-child');
        const headers = [...headerRow.querySelectorAll('th')];
        const vehicleIndex = headers.findIndex(th => th.textContent.trim() === 'Vehicle');

        if (vehicleIndex === -1) {
            console.warn('[Photos] Vehicle column not found');
            return false;
        }

        // Add header
        const photosTh = document.createElement('th');
        photosTh.className = 'center no-sort sorting_disabled';
        photosTh.textContent = 'Photos';
        photosTh.style.minWidth = '80px';  // also reduced column width
        photosTh.dataset.photosCol = 'true';
        headerRow.appendChild(photosTh);

        // Add cells to data rows
        const dataRows = table.querySelectorAll('tbody > tr:not(.noexport)');
        let buttonsAdded = 0;

        dataRows.forEach(row => {
            if (row.cells.length < 12) return;
            if (/TOTAL/i.test(row.cells[0]?.textContent || '')) return;

            const vehicleCell = row.cells[vehicleIndex];
            if (!vehicleCell) return;

            const text = vehicleCell.textContent.trim();
            const regoMatch = text.match(/^([A-Z0-9]{5,10})\b/i);
            const rego = regoMatch?.[1]?.trim();

            const td = document.createElement('td');
            td.className = 'center';
            td.dataset.photosCell = 'true';

            if (rego) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'rcm-photo-btn learn-more';
                btn.textContent = 'Photos';

                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = `https://we-integrate.co.nz/new-ui/client-card-page?search=${encodeURIComponent(rego)}`;
                    openPopup(url, `Photos - ${rego}`);
                };

                td.appendChild(btn);
                buttonsAdded++;
            } else {
                td.textContent = '—';
                td.style.color = '#94a3b8';
                td.style.fontSize = '11px';
            }

            row.appendChild(td);
        });

        log(`Added very compact 3D buttons to ${buttonsAdded} rows`);
        return true;
    }

    // Wait & run when table is ready
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const intervalId = setInterval(() => {
        attempts++;
        const done = tryAddPhotosColumn();
        if (done || attempts >= MAX_ATTEMPTS) {
            clearInterval(intervalId);
            log(done ? 'Success ✓' : 'Stopped after max attempts');
        }
    }, 600);

    // Fallback observer
    const observer = new MutationObserver(() => {
        if (tryAddPhotosColumn()) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Last chance
    setTimeout(() => {
        tryAddPhotosColumn();
        observer.disconnect();
    }, 18000);

})();
