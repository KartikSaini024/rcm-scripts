// ==UserScript==
// @name         RCM - Open Agreement Button (Green)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a prominent green 'Open Agreement' button in the Documents section
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @updateURL    https://raw.githubusercontent.com/exampleuser/my-scripts/main/open-agreement.user.js
// @downloadURL  https://raw.githubusercontent.com/exampleuser/my-scripts/main/open-agreement.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const init = () => {
        // Extract reservation number from URL
        const path = window.location.pathname;
        const match = path.match(/\/booking\/(\d+)/);
        if (!match) {
            console.log('Reservation number not found in URL');
            return false;
        }
        const resNo = match[1];
        console.log('Reservation No:', resNo);

        // Look for the Documents section by finding the h3 with "Documents"
        const documentsHeader = Array.from(document.querySelectorAll('h3')).find(h =>
            h.textContent.trim() === 'Documents' ||
            (h.hasAttribute('data-translate') && h.getAttribute('data-translate') === '')
        );

        if (!documentsHeader) {
            console.log('Documents <h3> header not found yet');
            return false;
        }

        // Get the parent .cell33 that contains the Documents column
        const documentsSection = documentsHeader.closest('.cell33');
        if (!documentsSection) {
            console.log('Documents .cell33 container not found');
            return false;
        }

        // Prevent adding the button multiple times
        if (documentsSection.querySelector('.open-agreement-green-btn')) {
            console.log('Green button already exists');
            return true;
        }

        // Create new row and button
        const newRow = document.createElement('div');
        newRow.className = 'colRow row';

        const newButton = document.createElement('span');
        newButton.className = 'button btn btn-xs open-agreement-green-btn';
        newButton.style.cssText = 'background-color: #28a745 !important; border-color: #28a745 !important; color: white !important;';
        newButton.innerHTML = '<i class="fa fa-file-signature" aria-hidden="true"></i> <span data-translate="">Open Agreement</span>';

        // Click handler
        newButton.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();

            const width = 1100;
            const height = 800;
            const left = (screen.width / 2) - (width / 2);
            const top = (screen.height / 2) - (height / 2);

            const popup = window.open(
                'https://bookings.rentalcarmanager.com/s_SignatureSelectBooking.aspx',
                'agreementPopup',
                `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
            );

            if (!popup) {
                alert('Popup blocked! Please allow popups for this site.');
                return;
            }

            const checkInterval = setInterval(() => {
                try {
                    if (popup.document && popup.document.readyState === 'complete') {
                        const input = popup.document.getElementById('MainBodyContent_txtReservationNo');
                        if (input) {
                            input.value = resNo;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            clearInterval(checkInterval);
                            console.log('Reservation number filled');
                            popup.focus();
                        }
                    }
                } catch (err) {
                    clearInterval(checkInterval);
                }
            }, 500);

            setTimeout(() => clearInterval(checkInterval), 30000);
        };

        newRow.appendChild(newButton);

        // Insert the new button right after the header row (so it appears near the top of Documents)
        const headerRow = documentsHeader.closest('.colRow.row');
        if (headerRow && headerRow.parentNode) {
            headerRow.parentNode.insertBefore(newRow, headerRow.nextSibling);
        } else {
            // Fallback: append to the section
            documentsSection.appendChild(newRow);
        }

        console.log('Green Open Agreement button added successfully');
        return true;
    };

    // Try immediately
    if (!init()) {
        // If not ready (e.g., on a different tab), wait for DOM changes
        console.log('Waiting for Documents section to load...');
        const observer = new MutationObserver(() => {
            if (init()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Stop observing after 20 seconds
        setTimeout(() => observer.disconnect(), 20000);
    }

})();
