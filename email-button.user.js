// ==UserScript==
// @name         RentalCarManager - WE Integrate Popup + Copy Email Button
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.1
// @description  Adds a styled "Photos" button and matching "Copy" button for email
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/s_SignatureSelectBooking.aspx*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/email-button.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/email-button.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // === Beautiful 3D layered button styles – light blue theme (compact) ===
    const BUTTON_STYLES = `
        .rcm-3d-btn {
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
            margin-left: 0.5rem;
        }

        .rcm-3d-btn.photos {
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

        .rcm-3d-btn.photos::before {
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

        .rcm-3d-btn.photos:hover {
            background: #e0f2fe;
            transform: translate(0, 0.15em);
        }

        .rcm-3d-btn.photos:hover::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0.25em 0 0 #dbeafe;
            transform: translate3d(0, 0.25em, -1em);
        }

        .rcm-3d-btn.photos:active {
            background: #e0f2fe;
            transform: translate(0, 0.35em);
        }

        .rcm-3d-btn.photos:active::before {
            box-shadow:
                0 0 0 1.5px #60a5fa,
                0 0 #dbeafe;
            transform: translate3d(0, 0, -1em);
        }

        /* Slightly different shade for Copy button to distinguish it */
        .rcm-3d-btn.copy {
            color: #1e40af;
            padding: 0.55em 1.1em;
            background: #f0f9ff;
            border: 1.5px solid #3b82f6;
            border-radius: 0.5em;
            transform-style: preserve-3d;
            transition:
                transform 140ms cubic-bezier(0, 0, 0.58, 1),
                background 140ms cubic-bezier(0, 0, 0.58, 1);
        }

        .rcm-3d-btn.copy::before {
            background: #bfdbfe;
            box-shadow:
                0 0 0 1.5px #3b82f6,
                0 0.35em 0 0 #e0f2fe;
            transform: translate3d(0, 0.4em, -1em);
        }

        .rcm-3d-btn.copy:hover {
            background: #e0f2fe;
            transform: translate(0, 0.15em);
        }

        .rcm-3d-btn.copy:hover::before {
            box-shadow:
                0 0 0 1.5px #3b82f6,
                0 0.25em 0 0 #e0f2fe;
            transform: translate3d(0, 0.25em, -1em);
        }

        .rcm-3d-btn.copy:active {
            background: #e0f2fe;
            transform: translate(0, 0.35em);
        }

        .rcm-3d-btn.copy:active::before {
            box-shadow:
                0 0 0 1.5px #3b82f6,
                0 0 #e0f2fe;
            transform: translate3d(0, 0, -1em);
        }
    `;

    // Inject styles once
    function injectButtonStyles() {
        if (document.getElementById('rcm-3d-btn-styles')) return;
        const style = document.createElement('style');
        style.id = 'rcm-3d-btn-styles';
        style.textContent = BUTTON_STYLES;
        document.head.appendChild(style);
    }

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
        button.className = 'rcm-3d-btn photos';
        button.textContent = 'Photos';
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

        const emailCol = emailInput.closest('.col-sm-5');
        if (!emailCol) return;
        if (emailCol.querySelector('#copyEmailBtn')) return; // already added

        const button = document.createElement('button');
        button.id = 'copyEmailBtn';
        button.type = 'button';
        button.className = 'rcm-3d-btn copy';
        button.textContent = 'Copy';
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
                console.error('[CopyEmail] Failed to copy:', err);
                alert('Failed to copy email (browser permission issue or old browser).');
            }
        };

        // Insert the button right after the input field
        emailInput.insertAdjacentElement('afterend', button);
    }

    // Initial run
    injectButtonStyles();
    addPhotosButton();
    addCopyEmailButton();

    // Observe DOM changes (both features rely on async page updates)
    const observer = new MutationObserver(() => {
        addPhotosButton();
        addCopyEmailButton();
    });

    const cardBody = document.querySelector('.card-body');
    if (cardBody) {
        observer.observe(cardBody, { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Fallback periodic check (every 2 seconds)
    setInterval(() => {
        addPhotosButton();
        addCopyEmailButton();
    }, 2000);

})();
