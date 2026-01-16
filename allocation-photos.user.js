// ==UserScript==
// @name         RentalCarManager - Vehicle Allocation Photos Button
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.0
// @description  Adds Photos button to vehicle allocation table using REGO column
// @author  Kartik
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

    function openPopup(url) {
        window.open(
            url,
            'weIntegratePopup',
            'width=1200,height=800,noopener,noreferrer'
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
            headerRow.appendChild(th);
        }
    }

    function processRows(table) {
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach(row => {
            // Prevent duplicates
            if (row.querySelector('.tm-photos-btn')) return;

            const cells = row.children;
            if (cells.length < 4) return;

            // Rego column index = 3
            const rego = extractRego(cells[3]);
            if (!rego) return;

            const td = document.createElement('td');
            td.className = 'left';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-info btn-xs tm-photos-btn';
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

        ensureHeader(table);
        processRows(table);
    }

    // Observe DataTable redraws / AJAX refreshes
    const observer = new MutationObserver(() => init());
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Initial run
    init();
})();
