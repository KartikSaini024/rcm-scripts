// ==UserScript==
// @name         RCM Notes Panel
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.0
// @description  Clipboard templates with floating chat-style popup
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/notes-panel.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/notes-panel.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'rcm_note_templates_v1';

    function formatDate() {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
    }

    function loadTemplates() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);

        return [
            "NAME - {date} - CUSTOMER HAS THIRD PARTY INSURANCE",
            "NAME - {date} - CUSTOMER HAS OPTED OUR INSURANCE"
        ];
    }

    function saveTemplates(tpls) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tpls));
    }

    function insertNote(textarea, template) {
        const current = textarea.value;
        const prefix = current.trim() ? "\n" : "";
        const text = template.replace('{date}', formatDate());

        textarea.value = current + prefix + text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function stopEvent(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function init() {
        const textarea = document.getElementById('txtNotes');
        if (!textarea) return;
        if (document.getElementById('tm-clipboard-icon')) return;

        let templates = loadTemplates();

        // 📋 ICON
        const iconBtn = document.createElement('div');
        iconBtn.id = 'tm-clipboard-icon';
        iconBtn.textContent = '📋';
        Object.assign(iconBtn.style, {
            display: 'inline-block',
            marginBottom: '6px',
            cursor: 'pointer',
            fontSize: '16px'
        });

        // 💬 PANEL
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'absolute',
            width: '320px',
            maxHeight: '300px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: '10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '10px',
            zIndex: '9999',
            opacity: '0',
            transform: 'translateY(10px)',
            transition: 'all 0.2s ease',
            pointerEvents: 'none'
        });

        // 🔺 ARROW
        const arrow = document.createElement('div');
        Object.assign(arrow.style, {
            position: 'absolute',
            width: '0',
            height: '0',
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: '8px solid #ccc',
            bottom: '-8px',
            left: '20px'
        });

        panel.appendChild(arrow);

        function showPanel() {
            const rect = iconBtn.getBoundingClientRect();
            const panelHeight = panel.offsetHeight || 200;

            let top = rect.top + window.scrollY - panelHeight - 10;
            let placeAbove = true;

            // If not enough space above → place below
            if (top < 0) {
                top = rect.bottom + window.scrollY + 10;
                placeAbove = false;
            }

            panel.style.top = `${top}px`;
            panel.style.left = `${rect.left + window.scrollX}px`;

            // Flip arrow
            if (placeAbove) {
                arrow.style.top = '';
                arrow.style.bottom = '-8px';
                arrow.style.borderTop = '8px solid #ccc';
                arrow.style.borderBottom = '';
            } else {
                arrow.style.bottom = '';
                arrow.style.top = '-8px';
                arrow.style.borderTop = '';
                arrow.style.borderBottom = '8px solid #ccc';
            }

            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0)';
            panel.style.pointerEvents = 'auto';
        }

        function hidePanel() {
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(10px)';
            panel.style.pointerEvents = 'none';
        }

        function render() {
    panel.innerHTML = '';
    panel.appendChild(arrow);

    templates.forEach((tpl, i) => {
        const card = document.createElement('div');

        Object.assign(card.style, {
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '8px',
            marginBottom: '8px',
            background: '#fafafa',
            cursor: 'pointer',
            position: 'relative',
            transition: 'all 0.15s ease'
        });

        // Hover effect
        card.onmouseenter = () => {
            card.style.background = '#f0f7ff';
            card.style.borderColor = '#cce0ff';
        };
        card.onmouseleave = () => {
            card.style.background = '#fafafa';
            card.style.borderColor = '#eee';
        };

        // 📄 Template text
        const text = document.createElement('div');
        text.textContent = tpl;
        Object.assign(text.style, {
            fontSize: '12px',
            lineHeight: '1.4',
            paddingRight: '40px',
            wordBreak: 'break-word'
        });

        // 🖊 Edit
        const edit = document.createElement('span');
        edit.textContent = '✏️';
        Object.assign(edit.style, {
            position: 'absolute',
            right: '22px',
            top: '6px',
            cursor: 'pointer',
            fontSize: '12px'
        });

        edit.onclick = (e) => {
            stopEvent(e);
            const val = prompt('Edit template:', tpl);
            if (val) {
                templates[i] = val;
                saveTemplates(templates);
                render();
            }
        };

        // 🗑 Delete
        const del = document.createElement('span');
        del.textContent = '🗑';
        Object.assign(del.style, {
            position: 'absolute',
            right: '6px',
            top: '6px',
            cursor: 'pointer',
            fontSize: '12px'
        });

        del.onclick = (e) => {
            stopEvent(e);
            if (confirm('Delete template?')) {
                templates.splice(i, 1);
                saveTemplates(templates);
                render();
            }
        };

        // ✅ Click card = use template
        card.onclick = (e) => {
            stopEvent(e);
            insertNote(textarea, tpl);
        };

        card.appendChild(text);
        card.appendChild(edit);
        card.appendChild(del);

        panel.appendChild(card);
    });

    // ➕ Add button
    const addBtn = document.createElement('div');
    addBtn.textContent = '+ Add Template';

    Object.assign(addBtn.style, {
        marginTop: '10px',
        padding: '8px',
        textAlign: 'center',
        borderRadius: '8px',
        background: '#e9f5ec',
        color: '#1e7e34',
        cursor: 'pointer',
        fontSize: '13px',
        border: '1px solid #c3e6cb'
    });

    addBtn.onmouseenter = () => {
        addBtn.style.background = '#d4edda';
    };
    addBtn.onmouseleave = () => {
        addBtn.style.background = '#e9f5ec';
    };

    addBtn.onclick = () => {
        const val = prompt('New template (use {date}):');
        if (val) {
            templates.push(val);
            saveTemplates(templates);
            render();
        }
    };

    panel.appendChild(addBtn);
}

        let open = false;

        iconBtn.onclick = (e) => {
            stopEvent(e);
            open = !open;
            if (open) {
                render();
                showPanel();
            } else {
                hidePanel();
            }
        };

        document.addEventListener('click', () => {
            open = false;
            hidePanel();
        });

        panel.addEventListener('click', (e) => e.stopPropagation());

        textarea.parentElement.insertBefore(iconBtn, textarea);
        document.body.appendChild(panel);
    }

    const observer = new MutationObserver(init);
    observer.observe(document.body, { childList: true, subtree: true });

})();
