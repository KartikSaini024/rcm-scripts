// ==UserScript==
// @name         RentalCarManager - WE Integrate Popup + Copy Email Button
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a button to open WE Integrate photos popup and a copy button for the email field
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/s_SignatureSelectBooking.aspx*
// @updateURL    https://raw.githubusercontent.com/exampleuser/my-scripts/main/email-button.user.js
// @downloadURL  https://raw.githubusercontent.com/exampleuser/my-scripts/main/email-button.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // === Feature 1: Add "Photos" button next to vehicle rego ===
    function addPhotosButton() {
        const vehicleRow = document.querySelector('.card-body .row.mb-3:has(#MainBodyContent_lblVehicleRego)');
        if (!vehicleRow) return;

        if (vehicleRow.querySelector('#weIntegratePopupBtn')) return; // already added

        const regoSpan = document.getElementById('MainBodyContent_lblVehicleRego');
        if (!regoSpan || !regoSpan.textContent.trim()) return;

        const rego = regoSpan.textContent.trim();

        const button = document.createElement('button');
        button.id = 'weIntegratePopupBtn';
        button.type = 'button';
        button.textContent = 'Photos';
        button.className = 'btn btn-info btn-sm ml-3';
        button.title = 'Open vehicle photos in WE Integrate';

        button.onclick = function () {
            const url = `https://we-integrate.co.nz/new-ui/client-card-page?search=${encodeURIComponent(rego)}`;
            window.open(url, 'weIntegratePopup', 'width=1200,height=800,scrollbars=yes,resizable=yes');
        };

        const valueCol = vehicleRow.querySelector('.col-sm-10');
        if (valueCol) {
            valueCol.appendChild(button);
        }
    }

    // === Feature 2: Add "Copy" button next to email input ===
    function addCopyEmailButton() {
        const emailInput = document.getElementById('MainBodyContent_txtEmail');
        if (!emailInput) return;

        // Find the parent col-sm-5 that contains the input
        const emailCol = emailInput.closest('.col-sm-5');
        if (!emailCol) return;

        if (emailCol.querySelector('#copyEmailBtn')) return; // already added

        const button = document.createElement('button');
        button.id = 'copyEmailBtn';
        button.type = 'button';
        button.textContent = 'Copy';
        button.className = 'btn btn-outline-secondary btn-sm ml-2';
        button.title = 'Copy email address to clipboard';

        button.onclick = async function () {
            const email = emailInput.value.trim();
            if (!email) {
                alert('Email field is empty.');
                return;
            }

            try {
                await navigator.clipboard.writeText(email);
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = 'Copy';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
                alert('Failed to copy email (browser permission issue or old browser).');
            }
        };

        // Insert the button right after the input field
        emailInput.insertAdjacentElement('afterend', button);
    }

    // Run both functions initially
    addPhotosButton();
    addCopyEmailButton();

    // Observe DOM changes for dynamic content (both features rely on async updates)
    const observer = new MutationObserver(function () {
        addPhotosButton();
        addCopyEmailButton();
    });

    const cardBody = document.querySelector('.card-body');
    if (cardBody) {
        observer.observe(cardBody, { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Fallback periodic check
    setInterval(() => {
        addPhotosButton();
        addCopyEmailButton();
    }, 2000);

})();
