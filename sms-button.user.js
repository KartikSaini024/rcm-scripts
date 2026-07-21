// ==UserScript==
// @name         Simba RCM Review Follow-up → Pulse SMS
// @namespace    simba.carhire.reviewfollowup
// @version      1.0
// @description  Adds a "Copy & Send SMS" button on RentalCarManager booking pages that copies a review follow-up template (with first name filled in) and auto-fills it into a new Pulse compose tab.
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @match        https://pulse.simbacarhire.com.au/compose*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/sms-button.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/sms-button.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'simba_pending_sms_message';
    const STORAGE_KEY_PHONE = 'simba_pending_sms_phone';

    // ---------------------------------------------------------------------
    // PART 1: Booking page — add the button, build message, copy, open tab
    // ---------------------------------------------------------------------
    function initBookingPage() {
        const container = document.getElementById('panTab1');
        if (!container) return;

        // Avoid adding twice (e.g. if script re-runs on AJAX nav)
        if (document.getElementById('simbaCopySmsBtn')) return;

        const btn = document.createElement('button');
        btn.id = 'simbaCopySmsBtn';
        btn.type = 'button';
        btn.title = 'Copy and send SMS';
        btn.textContent = '📋 Send SMS';
        btn.style.cssText = [
            'margin:12px 0',
            'padding:8px 16px',
            'background:#2e7d32',
            'color:#fff',
            'border:none',
            'border-radius:4px',
            'cursor:pointer',
            'font-size:13px',
            'font-weight:bold',
            'display:inline-block'
        ].join(';');

        btn.addEventListener('mouseenter', () => (btn.style.background = '#256428'));
        btn.addEventListener('mouseleave', () => (btn.style.background = '#2e7d32'));

        btn.addEventListener('click', onCopyClick);

        container.appendChild(btn);
    }

    function getFirstName() {
        const input = document.getElementById('txtFirstName');
        if (!input) return '';
        // "MATTHIAS FRIEDRICH" -> "Matthias"
        const raw = (input.value || '').trim().split(/\s+/)[0] || '';
        if (!raw) return '';
        return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    }

    function getPhoneNumber() {
        const phone = document.getElementById('txtPhone');
        if (phone && phone.value && phone.value.trim()) return phone.value.trim();

        const mobile = document.getElementById('txtMobile');
        if (mobile && mobile.value && mobile.value.trim()) return mobile.value.trim();

        return '';
    }

    function buildMessage() {
        const firstName = getFirstName();
        return `Hi ${firstName}😊 \n` +
            `Thanks for choosing Simba Car Hire Sydney! We hope you had an amazing trip 🚗\n` +
            `We'd really appreciate a quick review — it only takes a minute:\n` +
            `⭐ Google: https://g.page/r/CR5bZWhnD8TwEAE/review\n` +
            `— The Simba Sydney Team`;
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            // Fallback for contexts where async clipboard API is blocked
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                return true;
            }
            console.error('Clipboard copy failed:', e);
            return false;
        }
    }

    async function onCopyClick() {
        const message = buildMessage();
        const phone = getPhoneNumber();

        await copyToClipboard(message);

        // Stash the message/phone so the compose tab (different origin) can pick
        // them up. GM_setValue/GM_getValue storage is scoped to this userscript,
        // not the page origin, so it works across the two different domains.
        GM_setValue(STORAGE_KEY, message);
        GM_setValue(STORAGE_KEY_PHONE, phone);
        GM_setValue(STORAGE_KEY + '_ts', Date.now());

        window.open('https://pulse.simbacarhire.com.au/compose', '_blank');
    }

    // ---------------------------------------------------------------------
    // PART 2: Pulse compose page — read stashed message and fill textarea
    // ---------------------------------------------------------------------
    function initComposePage() {
        const message = GM_getValue(STORAGE_KEY, '');
        const phone = GM_getValue(STORAGE_KEY_PHONE, '');
        const ts = GM_getValue(STORAGE_KEY + '_ts', 0);

        // Ignore stale messages older than 2 minutes (in case a tab is reopened later)
        if (!message || Date.now() - ts > 2 * 60 * 1000) return;

        waitForElement('textarea[placeholder="Type your message..."]', (textarea) => {
            fillTextField(textarea, message);
        });

        if (phone) {
            waitForElement('input[placeholder^="Enter phone numbers"]', (phoneInput) => {
                fillTextField(phoneInput, phone);
            });
        }

        // Clear stashed values so they don't get reused on refresh / next visit
        GM_deleteValue(STORAGE_KEY);
        GM_deleteValue(STORAGE_KEY_PHONE);
        GM_deleteValue(STORAGE_KEY + '_ts');
    }

    function fillTextField(el, value) {
        // Use the native setter so React's onChange fires correctly
        const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(el, value);

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function waitForElement(selector, callback, timeoutMs = 15000) {
        const existing = document.querySelector(selector);
        if (existing) {
            callback(existing);
            return;
        }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                callback(el);
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });

        setTimeout(() => observer.disconnect(), timeoutMs);
    }

    // ---------------------------------------------------------------------
    // Bootstrap
    // ---------------------------------------------------------------------
    function boot() {
        if (location.hostname === 'bookings.rentalcarmanager.com') {
            initBookingPage();
            // In case #panTab1 loads after an AJAX/tab switch, keep watching briefly
            waitForElement('#panTab1', initBookingPage);
        } else if (location.hostname === 'pulse.simbacarhire.com.au') {
            initComposePage();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
