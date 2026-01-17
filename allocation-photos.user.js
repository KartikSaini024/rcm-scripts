// ==UserScript==
// @name         RentalCarManager - Vehicle Allocation Photos Button
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.1
// @description  Adds Photos button to vehicle allocation table
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/report/eng_vehicleallocation/param/*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/allocation-photos.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/allocation-photos.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const TABLE_ID = 'tblReport';
    const PHOTOS_HEADER_TEXT = 'Photos';
    const POPUP_BASE_URL = 'https://we-integrate.co.nz/new-ui/client-card-page?search=';

    // === Beautiful 3D layered button style – light blue, compact ===
    const BUTTON_STYLES = `
        .rcm-3d-photos-btn {
            position: relative;
            display: inline-block;
            cursor: pointer;
            outline: none;
            border: 0;
            vertical-align: middle;
            text-decoration: none;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rcm-3d-photos-btn::before {
            position: absolute;
            content: '';
            width: 100%;
            height: 100%;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #bfdbfe;
            border-radius: inherit;
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.35em 0 0 #dbeafe;
            transform: translate3d(0, 0.4em, -1em);
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                box-shadow 140ms cubic-bezier(0, 0, 0.58, 1);
        }

        .rcm-3d-photos-btn {
            color: #1e3a5f;
            padding: 0.55em 1.1em;
            background: #f0f7ff;
            border: 1.5px solid #60a5fa;
            border-radius: 0.5em;
            transform-style: preserve-3d;
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                background 140ms cubic-bezier(0, 0, 0.58, 1);
        }

        .rcm-3d-photos-btn:hover {
            background: #e0f2fe;
            transform: translate(0, 0.15em);
        }

        .rcm-3d-photos-btn:hover::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.25em 0 0 #dbeafe;
            transform: translate3d(0, 0.25em, -1em);
        }

        .rcm-3d-photos-btn:active {
            background: #e0f2fe;
            transform: translate(0, 0.35em);
        }

        .rcm-3d-photos-btn:active::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0 #dbeafe;
            transform: translate3d(0, 0, -1em);
        }
    `;

    function injectButtonStyles() {
        if (document.getElementById('rcm-3d-btn-styles-allocation')) return;
        const style = document.createElement('style');
        style.id = 'rcm-3d-btn-styles-allocation';
        style.textContent = BUTTON_STYLES;
        document.head.appendChild(style);
    }

    function openPopup(url) {
        window.open(
            url,
            'weIntegratePopup',
            'width=1200,height=800,scrollbars=yes,resizable=yes,noopener,noreferrer'
        );
    }

    function extractRego(cell) {
        if (!cell) return null;
        const text = cell.innerText.trim();
        return text ? text.toUpperCase() : null;
    }

    function ensureHeader(table) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        const exists = [...headerRow.children].some(
            th => th.innerText.trim() === PHOTOS_HEADER_TEXT
        );

        if (!exists) {
            const th = document.createElement('th');
            th.className = 'left no-sort sorting_disabled';
            th.textContent = PHOTOS_HEADER_TEXT;
            th.style.minWidth = '80px';
            headerRow.appendChild(th);
        }
    }

    function processRows(table) {
        // Only select data rows – skip header rows even if they're inside tbody
        const rows = table.querySelectorAll('tbody tr:not(:has(th))');

        rows.forEach(row => {
            // Extra safety: skip if row already has our button
            if (row.querySelector('.rcm-3d-photos-btn')) return;

            const cells = row.children;
            if (cells.length < 4) return;

            // Rego is in column index 3 (0-based)
            const rego = extractRego(cells[3]);
            if (!rego || rego.length < 3) return; // basic validation

            const td = document.createElement('td');
            td.className = 'left';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rcm-3d-photos-btn';
            btn.textContent = 'Photos';

            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                openPopup(POPUP_BASE_URL + encodeURIComponent(rego));
            });

            td.appendChild(btn);
            row.appendChild(td);
        });
    }

    function init() {
        const table = document.getElementById(TABLE_ID);
        if (!table) return;

        injectButtonStyles();
        ensureHeader(table);
        processRows(table);
    }

    // Observe table changes / DataTable redraws
    const observer = new MutationObserver(() => init());
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Initial run + safety fallback
    init();
    setInterval(init, 4000);
})();
