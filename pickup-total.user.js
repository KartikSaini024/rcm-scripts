// ==UserScript==
// @name         Simba Car Hire — Pickup Category Totals
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      1.3.0
// @author       Kartik
// @description  Inline summary bar with pickup counts by vehicle category
// @match        https://bookings.rentalcarmanager.com/report/dailyactivity*
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/pickup-total.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/pickup-total.user.js
// @grant        none
// ==UserScript==

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
      @keyframes rcm-fadein {
        from { opacity:0; transform:translateY(-7px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes rcm-popin {
        from { opacity:0; transform:translateX(-50%) translateY(6px) scale(0.96); }
        to   { opacity:1; transform:translateX(-50%) translateY(0)   scale(1); }
      }

      #rcm-summary-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        justify-content: center;
        background: #ffffff;
        border: 0.5px solid #e2e2e2;
        border-radius: 12px;
        padding: 11px 16px;
        margin-bottom: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
        animation: rcm-fadein 0.35s cubic-bezier(.22,1,.36,1) both;
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
        border-radius: 7px;
        padding: 5px 9px 5px 8px;
        border-width: 0.5px;
        border-style: solid;
        white-space: nowrap;
        cursor: default;
        position: relative;
        transition: transform 0.18s cubic-bezier(.34,1.56,.64,1),
                    box-shadow 0.18s ease;
      }
      #rcm-summary-bar .rcm-chip:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(0,0,0,0.09);
        z-index: 10;
      }

      #rcm-summary-bar .rcm-chip-name {
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
      }

      #rcm-summary-bar .rcm-chip-num {
        border-radius: 4px;
        padding: 1px 7px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.65;
        color: #fff;
        min-width: 20px;
        text-align: center;
        transition: transform 0.15s ease;
      }
      #rcm-summary-bar .rcm-chip:hover .rcm-chip-num {
        transform: scale(1.13);
      }

      #rcm-summary-bar .rcm-total {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #f8fafc;
        border: 0.5px solid #e2e2e2;
        border-radius: 7px;
        padding: 5px 11px;
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

      /* Tooltip */
      #rcm-summary-bar .rcm-tooltip {
        position: absolute;
        bottom: calc(100% + 11px);
        left: 50%;
        transform: translateX(-50%) translateY(6px) scale(0.97);
        background: #ffffff;
        color: #1e293b;
        border-radius: 10px;
        padding: 12px 14px 10px;
        min-width: 220px;
        max-width: 270px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.16s ease,
                    transform 0.2s cubic-bezier(.34,1.3,.64,1);
        z-index: 9999;
        font-size: 12px;
        line-height: 1.5;
        border: 0.5px solid #e2e2e2;
        box-shadow: 0 8px 24px rgba(0,0,0,0.10);
      }
      #rcm-summary-bar .rcm-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #e2e2e2;
      }
      #rcm-summary-bar .rcm-tooltip::before {
        content: '';
        position: absolute;
        top: calc(100% - 1px);
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #ffffff;
        z-index: 1;
      }
      #rcm-summary-bar .rcm-chip:hover .rcm-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
      }

      #rcm-summary-bar .rcm-tt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 9px;
        padding-bottom: 8px;
        border-bottom: 0.5px solid #e5e7eb;
      }
      #rcm-summary-bar .rcm-tt-cat {
        font-weight: 700;
        font-size: 13px;
        color: #0f172a;
      }
      #rcm-summary-bar .rcm-tt-badge {
        border-radius: 4px;
        padding: 1px 8px;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        flex-shrink: 0;
      }

      #rcm-summary-bar .rcm-tt-section-lbl {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9ca3af;
        margin-bottom: 5px;
      }

      #rcm-summary-bar .rcm-tt-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 0;
        border-bottom: 0.5px solid #f1f5f9;
      }
      #rcm-summary-bar .rcm-tt-row:last-child { border-bottom: none; }

      #rcm-summary-bar .rcm-tt-name {
        color: #64748b;
        font-size: 12px;
        flex: 1;
        margin-right: 8px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        max-width: 130px;
      }
      #rcm-summary-bar .rcm-tt-right {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }
      #rcm-summary-bar .rcm-tt-time {
        color: #0f172a;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #rcm-summary-bar .rcm-tt-alloc {
        font-size: 9px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 3px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      #rcm-summary-bar .rcm-alloc-yes {
        background: #dcfce7;
        color: #166534;
      }
      #rcm-summary-bar .rcm-alloc-no {
        background: #fee2e2;
        color: #991b1b;
      }

      #rcm-summary-bar .rcm-tt-footer {
        margin-top: 8px;
        padding-top: 7px;
        border-top: 0.5px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #9ca3af;
      }
      #rcm-summary-bar .rcm-tt-footer-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      #rcm-summary-bar .rcm-tt-footer-val {
        color: #374151;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Data extraction ────────────────────────────────────────────────────────

  function getColIndex(table, label) {
    let idx = -1;
    table.querySelectorAll('thead th').forEach((th, i) => {
      if (th.textContent.trim() === label) idx = i;
    });
    return idx;
  }

  function firstTextOf(cell) {
    const node = Array.from(cell.childNodes).find(
      n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ''
    );
    return node ? node.textContent.trim() : '';
  }

  // Returns { [category]: [ { customer, time, allocated } ] }
  function getPickupData() {
    const data = {};

    const tables = [
      { id: 'UnallocatePickup', allocated: false },
      { id: 'Pickup',           allocated: true  },
    ];

    tables.forEach(({ id, allocated }) => {
      const table = document.getElementById(id);
      if (!table) return;

      const catIdx      = getColIndex(table, 'Category');
      const timeIdx     = getColIndex(table, 'Time');
      const customerIdx = getColIndex(table, 'Customer');
      const statusIdx   = getColIndex(table, 'Status');
      if (catIdx < 0) return;

      table.querySelectorAll('tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 15) return;

        if (statusIdx >= 0 && cells[statusIdx]) {
          if (cells[statusIdx].textContent.trim().toLowerCase().includes('maintenance')) return;
        }

        const cat = catIdx >= 0 && cells[catIdx] ? firstTextOf(cells[catIdx]) : '';
        if (!cat) return;

        const time     = timeIdx >= 0 && cells[timeIdx]     ? cells[timeIdx].textContent.trim()     : '';
        const customer = customerIdx >= 0 && cells[customerIdx]
          ? firstTextOf(cells[customerIdx]) || cells[customerIdx].textContent.trim()
          : '';

        if (!data[cat]) data[cat] = [];
        data[cat].push({ customer: customer.replace(/\s+/g, ' ').trim(), time, allocated });
      });
    });

    return data;
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ── Tooltip builder ────────────────────────────────────────────────────────

  function buildTooltip(cat, entries, c) {
    const tip = el('div', 'rcm-tooltip');

    // Header
    const hdr = el('div', 'rcm-tt-header');
    hdr.appendChild(el('span', 'rcm-tt-cat', cat));
    const badge = el('span', 'rcm-tt-badge', entries.length);
    badge.style.background = c.badge;
    hdr.appendChild(badge);
    tip.appendChild(hdr);

    // Section label
    tip.appendChild(el('div', 'rcm-tt-section-lbl', 'Pickup times'));

    // Sort by time
    const sorted = [...entries].sort((a, b) => a.time.localeCompare(b.time));

    sorted.forEach(({ customer, time, allocated }) => {
      const row = el('div', 'rcm-tt-row');

      const name = el('span', 'rcm-tt-name', customer || '—');
      row.appendChild(name);

      const right = el('span', 'rcm-tt-right');
      right.appendChild(el('span', 'rcm-tt-time', time || '—'));

      const pill = el('span', allocated ? 'rcm-tt-alloc rcm-alloc-yes' : 'rcm-tt-alloc rcm-alloc-no',
                      allocated ? 'alloc' : 'unalloc');
      right.appendChild(pill);
      row.appendChild(right);
      tip.appendChild(row);
    });

    // Footer — earliest / latest
    const times = sorted.map(e => e.time).filter(Boolean);
    if (times.length > 0) {
      const footer = el('div', 'rcm-tt-footer');

      const earliest = el('span', 'rcm-tt-footer-item');
      earliest.appendChild(document.createTextNode('Earliest\u00a0'));
      earliest.appendChild(el('span', 'rcm-tt-footer-val', times[0]));
      footer.appendChild(earliest);

      const latest = el('span', 'rcm-tt-footer-item');
      latest.appendChild(document.createTextNode('Latest\u00a0'));
      latest.appendChild(el('span', 'rcm-tt-footer-val', times[times.length - 1]));
      footer.appendChild(latest);

      tip.appendChild(footer);
    }

    return tip;
  }

  // ── Bar builder ────────────────────────────────────────────────────────────

  function buildSummaryBar(data) {
    const sorted = Object.entries(data).sort((a, b) => b[1].length - a[1].length);
    const total  = sorted.reduce((s, [, v]) => s + v.length, 0);

    const bar = document.createElement('div');
    bar.id = 'rcm-summary-bar';

    bar.appendChild(el('span', 'rcm-bar-label', 'Pickups'));
    bar.appendChild(el('span', 'rcm-sep'));

    sorted.forEach(([cat, entries]) => {
      const c    = colorFor(cat);
      const chip = el('span', 'rcm-chip');
      chip.style.background  = c.bg;
      chip.style.borderColor = c.border;

      const name = el('span', 'rcm-chip-name', cat);
      name.style.color = c.text;

      const num = el('span', 'rcm-chip-num', entries.length);
      num.style.background = c.badge;

      chip.appendChild(name);
      chip.appendChild(num);
      chip.appendChild(buildTooltip(cat, entries, c));
      bar.appendChild(chip);
    });

    if (sorted.length > 0) {
      bar.appendChild(el('span', 'rcm-sep'));
      const tot = el('span', 'rcm-total');
      tot.appendChild(el('span', 'rcm-total-lbl', 'Total'));
      tot.appendChild(el('span', 'rcm-total-num', total));
      bar.appendChild(tot);
    }

    return bar;
  }

  // ── Inject ─────────────────────────────────────────────────────────────────

  function injectSummaryBar(data) {
    const old = document.getElementById('rcm-summary-bar');
    if (old) old.remove();
    const table   = document.getElementById('UnallocatePickup');
    if (!table) return;
    const wrapper = document.getElementById('UnallocatePickup_wrapper') || table;
    wrapper.parentNode.insertBefore(buildSummaryBar(data), wrapper);
  }

  function init() {
    injectStyles();
    injectSummaryBar(getPickupData());
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
