// ==UserScript==
// @name         RentalCarManager - Copy Total Pickups & Dropoffs
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.7
// @description  Adds a clean copy button in the correct widget
// @author       Kartik
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/pickups-copy.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/pickups-copy.user.js
// @match        https://bookings.rentalcarmanager.com/dashboard
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    let buttonAdded = false;

    function getTotals() {
        const pickupsDone = parseInt(document.getElementById('widget_da_pickupsDone')?.innerText?.trim()) || 0;
        const pickupsRem = parseInt(document.getElementById('widget_da_pickupsRemaining2')?.innerText?.trim()) ||
                          parseInt(document.getElementById('widget_da_pickupsRemaining1')?.innerText?.trim()) || 0;

        const dropoffsDone = parseInt(document.getElementById('widget_da_dropoffsDone')?.innerText?.trim()) || 0;
        const dropoffsRem = parseInt(document.getElementById('widget_da_dropoffsRemaining2')?.innerText?.trim()) ||
                           parseInt(document.getElementById('widget_da_dropoffsRemaining1')?.innerText?.trim()) || 0;

        return {
            pickups: pickupsDone + pickupsRem,
            dropoffs: dropoffsDone + dropoffsRem
        };
    }

    function copyToClipboard() {
        const { pickups, dropoffs } = getTotals();
        const text = `Total Pickups : ${pickups}\nTotal dropoffs: ${dropoffs}`;

        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('rcm-copy-totals-btn');
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied';
                setTimeout(() => btn.textContent = orig, 1500);
            }
        }).catch(err => console.error('Copy failed', err));
    }

    function addCopyButton() {
        if (buttonAdded || document.getElementById('rcm-copy-totals-btn')) return;

        const locationSelect = document.getElementById('widget_da_location');
        if (!locationSelect) return;

        // ✅ Get the correct widget-body for THIS widget
        const widgetBody = locationSelect.closest('.widget-body');
        if (!widgetBody) return;

        const btnGroup = widgetBody.querySelector('.btn-group');
        if (!btnGroup) return;

        const btn = document.createElement('button');
        btn.id = 'rcm-copy-totals-btn';
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs';
        btn.textContent = 'Copy';

        btn.style.marginLeft = '6px';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            copyToClipboard();
        });

        // ✅ Insert right after date controls (clean + visible)
        btnGroup.parentNode.insertBefore(btn, btnGroup.nextSibling);

        buttonAdded = true;
        console.log('✅ Copy button added in correct widget');
    }

    function waitAndAdd() {
        const interval = setInterval(() => {
            const el = document.getElementById('widget_da_location');
            if (el) {
                addCopyButton();
            }
        }, 300);

        setTimeout(() => clearInterval(interval), 15000);
    }

    waitAndAdd();

    const observer = new MutationObserver(() => {
        if (!document.getElementById('rcm-copy-totals-btn')) {
            buttonAdded = false;
            waitAndAdd();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
