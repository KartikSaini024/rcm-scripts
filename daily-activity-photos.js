//daily activity photos button
// ==UserScript==
// @name         RentalCarManager - Photos Column (Popup Window)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds Photos column with buttons that open in a popup window
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @updateURL    https://raw.githubusercontent.com/exampleuser/my-scripts/main/daily-activity-photos.js.user.js
// @downloadURL  https://raw.githubusercontent.com/exampleuser/my-scripts/main/daily-activity-photos.js.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;
    const log = (...args) => DEBUG && console.log('[Photos Popup]', ...args);

    // Popup window settings
    const POPUP_WIDTH  = 1200;
    const POPUP_HEIGHT = 800;

    function openPopup(url, title = 'Vehicle Photos') {
        // Center the popup on screen
        const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
        const dualScreenTop  = window.screenTop  !== undefined ? window.screenTop  : window.screenY;

        const width  = window.innerWidth  ? window.innerWidth  : document.documentElement.clientWidth  ? document.documentElement.clientWidth  : screen.width;
        const height = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height;

        const left = ((width  / 2) - (POPUP_WIDTH  / 2)) + dualScreenLeft;
        const top  = ((height / 2) - (POPUP_HEIGHT / 2)) + dualScreenTop;

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

        // Focus the popup if it was opened successfully
        if (popup && popup.focus) {
            popup.focus();
        }

        return popup;
    }

    function tryAddPhotosColumn() {
        const table = document.querySelector('table#Dropoff.dataTable');
        if (!table) return false;
        if (!table.classList.contains('dataTable')) return false;

        // Already added?
        if (document.querySelector('th[data-photos-col="true"]')) {
            log('Photos column already exists');
            return true;
        }

        log('Adding Photos column with popup functionality');

        // Find Vehicle column
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
        photosTh.style.minWidth = '100px';
        photosTh.dataset.photosCol = 'true';
        headerRow.appendChild(photosTh);

        // Add cells to data rows
        const dataRows = table.querySelectorAll('tbody > tr:not(.noexport)');

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
                btn.className = 'btn btn-info btn-xs';
                btn.textContent = 'Photos';
                btn.style.padding = '4px 10px';
                btn.style.cursor = 'pointer';

                btn.onclick = (e) => {
                    e.preventDefault();
                    const url = `https://we-integrate.co.nz/new-ui/client-card-page?search=${encodeURIComponent(rego)}`;
                    openPopup(url, `Photos - ${rego}`);
                };

                td.appendChild(btn);
            } else {
                td.textContent = '—';
                td.style.color = '#aaa';
            }

            row.appendChild(td);
        });

        log(`Added popup buttons to ${dataRows.length} rows`);
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
            log(done ? 'Success' : 'Stopped after max attempts');
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
