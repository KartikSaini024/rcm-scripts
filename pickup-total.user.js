// ==UserScript==
// @name         Simba Car Hire — Pickup Category Totals
// @namespace    https://bookings.rentalcarmanager.com/
// @version      1.3.0
// @description  Inline summary bar with pickup counts by vehicle category
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PALETTE = [
    { bg:'#EEEDFE', border:'#AFA9EC', text:'#3C3489', badge:'#534AB7' },
    { bg:'#E1F5EE', border:'#5DCAA5', text:'#085041', badge:'#0F6E56' },
    { bg:'#FAECE7', border:'#F0997B', text:'#712B13', badge:'#993C1D' },
    { bg:'#FAEEDA', border:'#EF9F27', text:'#633806', badge:'#854F0B' },
    { bg:'#E6F1FB', border:'#85B7EB', text:'#0C447C', badge:'#185FA5' },
    { bg:'#EAF3DE', border:'#97C459', text:'#27500A', badge:'#3B6D11' },
    { bg:'#FBEAF0', border:'#ED93B1', text:'#72243E', badge:'#993556' },
    { bg:'#F1EFE8', border:'#B4B2A9', text:'#444441', badge:'#5F5E5A' },
  ];

  const colorMap = {};
  let colorIdx = 0;
  function colorFor(cat) {
    if (!colorMap[cat]) {
      colorMap[cat] = PALETTE[colorIdx % PALETTE.length];
      colorIdx++;
    }
    return colorMap[cat];
  }

  function injectStyles() {
    if (document.getElementById('rcm-bar-style')) return;
    const s = document.createElement('style');
    s.id = 'rcm-bar-style';
    s.textContent = `
      #rcm-summary-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        justify-content: center;
        background: #ffffff;
        border: 0.5px solid #e2e2e2;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
      }
      #rcm-summary-bar .rcm-bar-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #9ca3af;
        white-space: nowrap;
        margin-right: 2px;
      }
      #rcm-summary-bar .rcm-sep {
        width: 1px;
        height: 18px;
        background: #e5e7eb;
        flex-shrink: 0;
        margin: 0 2px;
        align-self: center;
      }
      #rcm-summary-bar .rcm-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 6px;
        padding: 4px 8px 4px 7px;
        border-width: 0.5px;
        border-style: solid;
        white-space: nowrap;
        cursor: default;
        transition: opacity 0.1s;
      }
      #rcm-summary-bar .rcm-chip:hover { opacity: 0.82; }
      #rcm-summary-bar .rcm-chip-name {
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
      }
      #rcm-summary-bar .rcm-chip-num {
        border-radius: 4px;
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.6;
        color: #fff;
        min-width: 18px;
        text-align: center;
      }
      #rcm-summary-bar .rcm-total {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #f8fafc;
        border: 0.5px solid #e2e2e2;
        border-radius: 6px;
        padding: 4px 10px;
        white-space: nowrap;
      }
      #rcm-summary-bar .rcm-total-lbl {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9ca3af;
      }
      #rcm-summary-bar .rcm-total-num {
        font-size: 15px;
        font-weight: 800;
        color: #1e293b;
        line-height: 1;
      }
    `;
    document.head.appendChild(s);
  }

  function getCategoryCounts() {
    const counts = {};
    ['UnallocatePickup', 'Pickup'].forEach(tableId => {
      const table = document.getElementById(tableId);
      if (!table) return;
      const headers = table.querySelectorAll('thead th');
      let catIdx = -1;
      let statusIdx = -1;
      headers.forEach((th, i) => {
        const txt = th.textContent.trim();
        if (txt === 'Category') catIdx = i;
        if (txt === 'Status')   statusIdx = i;
      });
      if (catIdx < 0) return;
      table.querySelectorAll('tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 15) return;
        // Skip maintenance rows (only present in the Pickup table)
        if (statusIdx >= 0 && cells[statusIdx]) {
          const status = cells[statusIdx].textContent.trim().toLowerCase();
          if (status.includes('maintenance')) return;
        }
        const cell = cells[catIdx];
        if (!cell) return;
        const firstText = Array.from(cell.childNodes).find(
          n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ''
        );
        const cat = firstText ? firstText.textContent.trim() : '';
        if (!cat) return;
        counts[cat] = (counts[cat] || 0) + 1;
      });
    });
    return counts;
  }

  function el(tag, props = {}) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    return e;
  }

  function buildSummaryBar(counts) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total  = sorted.reduce((s, [, n]) => s + n, 0);

    const bar = el('div');
    bar.id = 'rcm-summary-bar';

    const lbl = el('span', { className: 'rcm-bar-label', textContent: 'Pickups' });
    bar.appendChild(lbl);
    bar.appendChild(el('span', { className: 'rcm-sep' }));

    sorted.forEach(([cat, count]) => {
      const c = colorFor(cat);
      const chip = el('span', { className: 'rcm-chip' });
      chip.style.background   = c.bg;
      chip.style.borderColor  = c.border;

      const name = el('span', { className: 'rcm-chip-name', textContent: cat });
      name.style.color = c.text;

      const num = el('span', { className: 'rcm-chip-num', textContent: count });
      num.style.background = c.badge;

      chip.appendChild(name);
      chip.appendChild(num);
      bar.appendChild(chip);
    });

    if (sorted.length > 0) {
      bar.appendChild(el('span', { className: 'rcm-sep' }));
      const tot = el('span', { className: 'rcm-total' });
      tot.appendChild(el('span', { className: 'rcm-total-lbl', textContent: 'Total' }));
      tot.appendChild(el('span', { className: 'rcm-total-num', textContent: total }));
      bar.appendChild(tot);
    }

    return bar;
  }

  function injectSummaryBar(counts) {
    const old = document.getElementById('rcm-summary-bar');
    if (old) old.remove();
    const table   = document.getElementById('UnallocatePickup');
    if (!table) return;
    const wrapper = document.getElementById('UnallocatePickup_wrapper') || table;
    wrapper.parentNode.insertBefore(buildSummaryBar(counts), wrapper);
  }

  function init() {
    injectStyles();
    injectSummaryBar(getCategoryCounts());
  }

  function waitForTables() {
    const check = setInterval(() => {
      const t1 = document.getElementById('UnallocatePickup');
      const t2 = document.getElementById('Pickup');
      if (t1 || t2) {
        clearInterval(check);
        init();
        [t1, t2].forEach(table => {
          if (!table) return;
          new MutationObserver(() => init())
            .observe(table.querySelector('tbody'), { childList: true, subtree: true });
        });
      }
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTables);
  } else {
    waitForTables();
  }
})();
