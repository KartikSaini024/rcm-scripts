// ==UserScript==
// @name         RCM – Cover Options Popup
// @namespace    https://bookings.rentalcarmanager.com/
// @version      1.3.0
// @description  Click the "Days / Nights" value in the Rate and Fees table to show Everyday and Premium cover prices for the booking length.
// @author       Kartik
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/cover-options.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/cover-options.user.js
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- Configure cover options here ---------- */
  const COVERS = [
    // excess = the customer's maximum liability in $ once the cover is taken.
    { id: 'everyday', name: 'Everyday cover', perDay: 35, excess: 500, tone: 'light' },
    { id: 'premium',  name: 'Premium cover',  perDay: 49, excess: 0,   tone: 'dark', featured: true },
  ];
  const CURRENCY = 'AUD';
  // Used when no "Basic Cover: $X Excess" row is found in the Rate and Fees table.
  const DEFAULT_BASIC_EXCESS = 5480;
  /* -------------------------------------------------- */

  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: CURRENCY });
  const MARK = 'data-cover-ready';
  let openHost = null;
  let openBtn = null;

  /* ---------- Trigger button in the table ---------- */

  function enhance() {
    const table = document.getElementById('tblPayList');
    if (!table || table.hasAttribute(MARK)) return;

    const row = table.tBodies[0] && table.tBodies[0].rows[0];
    if (!row || row.cells.length < 2) return;

    const cell = row.cells[1];
    const raw = cell.textContent.trim();
    const days = Math.ceil(parseFloat(raw));
    if (!isFinite(days) || days <= 0) return;

    table.setAttribute(MARK, '1');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'all:unset;font-weight:bold;cursor:pointer;';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.title = 'Show cover options for ' + days + ' days';
    btn.textContent = raw;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openHost && openBtn === btn) { closePopup(); return; }
      closePopup();
      openPopup(days, btn);
    });

    cell.textContent = '';
    cell.appendChild(btn);
  }

  /* ---------- Popup (Shadow DOM so site CSS can't interfere) ---------- */

  const POPUP_CSS = `
    :host{all:initial}
    *{box-sizing:border-box}
    .overlay{
      position:fixed;inset:0;z-index:2147483647;
      display:flex;align-items:center;justify-content:center;padding:20px;
      background:rgba(15,28,26,.5);backdrop-filter:blur(3px);
      font-family:"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;
      color:#14211f;animation:fade .18s ease-out;
    }
    .dialog{
      width:min(640px,100%);max-height:100%;overflow:auto;
      background:#fbfcfb;border-radius:18px;
      box-shadow:0 24px 60px rgba(8,24,21,.35);
      animation:rise .22s cubic-bezier(.2,.8,.2,1);
    }
    header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:24px 28px 8px}
    h2{margin:0;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
    .sub{margin:6px 0 0;font-size:14px;color:#51655f}
    .sub strong{color:#14211f}
    .close{
      flex:none;width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;
      background:#e9efed;color:#2c403b;display:grid;place-items:center;
      transition:background .15s;
    }
    .close:hover{background:#d9e3e0}
    .close:focus-visible,.card:focus-visible{outline:2px solid #0f5c4d;outline-offset:2px}
    .close svg{width:16px;height:16px}
    .grid{display:grid;grid-template-columns:1fr 1.2fr;gap:16px;padding:22px 28px 8px;align-items:stretch}
    .card{
      position:relative;border-radius:14px;padding:20px 20px 18px;display:flex;flex-direction:column;gap:14px;
      border:1px solid #d5e0dc;background:#f4f7f6;
    }
    .name{font-size:15px;font-weight:600;margin:0;color:#3d504b}
    .block{display:flex;flex-direction:column;gap:2px}
    .label{font-size:12.5px;color:#60746e}
    .total{font-size:32px;line-height:1.05;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:#2c3d39}
    .excess-block{padding-top:14px;border-top:1px dashed #cbd8d4}
    .excess{font-size:32px;line-height:1.05;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:#8a5a1e}
    .excess.unset{font-size:16px;font-weight:600;color:#b4501f;letter-spacing:0}
    .rate{margin:auto 0 0;font-size:12px;color:#7a8b86}

    /* Featured (premium) card */
    .card.featured{
      margin:-10px 0;padding:26px 24px 22px;gap:16px;
      background:radial-gradient(120% 80% at 100% 0%,#1d6a58 0%,rgba(29,106,88,0) 55%),linear-gradient(165deg,#10463b,#082a23);
      border:2px solid #f0c25a;color:#f2faf7;
      box-shadow:0 0 0 6px rgba(240,194,90,.16),0 22px 44px rgba(8,42,35,.45);
    }
    .featured .name{font-size:18px;color:#fff}
    .featured .label{color:#a9cfc5}
    .featured .total{font-size:44px;color:#fff}
    .featured .excess-block{border-top-color:#2f6a5e}
    .featured .excess{font-size:64px;line-height:1;color:#f0c25a;letter-spacing:-.04em}
    .save{
      align-self:flex-start;margin-top:8px;font-size:13px;font-weight:600;
      color:#0b2f27;background:#7fe0c3;padding:4px 10px;border-radius:999px;
    }
    .was{margin-top:6px;font-size:12.5px;color:#7a8b86}
    .featured .rate{color:#8fb8ad}
    .cta{
      margin-top:2px;padding:10px 12px;border-radius:10px;text-align:center;
      background:rgba(255,255,255,.1);font-size:13.5px;font-weight:600;color:#fff;
    }
    .cta b{color:#f0c25a}
    .diff{
      margin:22px 28px 0;padding:12px 16px;border-radius:10px;
      background:#fff7e0;border:1px solid #f0d58c;font-size:14px;color:#4a3a10;
    }
    .diff b{color:#0f5c4d}
    footer{padding:14px 28px 22px;font-size:12px;color:#7a8b86}
    @keyframes fade{from{opacity:0}to{opacity:1}}
    @keyframes rise{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
    @media (max-width:560px){.grid{grid-template-columns:1fr;gap:26px}.card.featured{margin:0}}
    @media (prefers-reduced-motion:reduce){.overlay,.dialog{animation:none}}
  `;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Reads the booking's basic-cover excess from the fee rows, e.g.
  // "Basic Cover: $5480 Excess" or "Basic Cover (CT): $6480 Excess".
  function readBasicExcess() {
    const table = document.getElementById('tblPayList');
    if (table) {
      const re = /Basic\s*Cover[^$]*\$\s*([\d,]+(?:\.\d+)?)\s*Excess/i;
      for (const el of table.querySelectorAll('td.tdscale, td.tdscale span')) {
        const m = re.exec(el.textContent);
        if (m) {
          const n = parseFloat(m[1].replace(/,/g, ''));
          if (isFinite(n) && n > 0) return n;
        }
      }
    }
    return DEFAULT_BASIC_EXCESS;
  }

  function openPopup(days, btn) {
    const basicExcess = readBasicExcess();
    const host = document.createElement('div');
    host.id = 'cover-popup-host';
    const root = host.attachShadow({ mode: 'open' });

    const fmt0 = (n) => money.format(n).replace(/\.00$/, '');
    const plural = days === 1 ? 'day' : 'days';
    const base = COVERS.find((c) => !c.featured);

    const cards = COVERS.map((c) => {
      const total = c.perDay * days;
      const hasExcess = typeof c.excess === 'number';
      const excessHtml = hasExcess
        ? `<span class="excess">${fmt0(c.excess)}</span>`
        : `<span class="excess unset">Excess not set</span>`;
      const saves = c.featured && hasExcess && basicExcess > c.excess
        ? `<span class="save">Saves you ${fmt0(basicExcess - c.excess)} in excess</span>`
        : (hasExcess && basicExcess > c.excess ? `<span class="was">Down from ${fmt0(basicExcess)}</span>` : '');
      const extraPerDay = c.featured && base ? c.perDay - base.perDay : 0;
      const cta = extraPerDay > 0
        ? `<div class="cta">Just <b>${fmt0(extraPerDay)} more per day</b> than ${esc(base.name)}</div>` : '';
      return `
        <section class="card ${c.featured ? 'featured' : ''}" tabindex="0" aria-label="${esc(c.name)}">
          <h3 class="name">${esc(c.name)}</h3>
          <div class="block">
            <span class="label">Total for ${days} ${plural}</span>
            <span class="total">${money.format(total)}</span>
          </div>
          <div class="block excess-block">
            <span class="label">Your excess</span>
            ${excessHtml}
            ${saves}
          </div>
          ${cta}
          <p class="rate">${money.format(c.perDay)} per day × ${days}</p>
        </section>`;
    }).join('');

    let diff = '';
    const prem = COVERS.find((c) => c.featured);
    if (prem && base && typeof prem.excess === 'number' && basicExcess > prem.excess) {
      const d = (prem.perDay - base.perDay) * days;
      diff = `<div class="diff">Upgrade to <b>${esc(prem.name)}</b> for <b>${money.format(d)} more</b> over ${days} ${plural} and drop your excess from ${fmt0(basicExcess)} to <b>${fmt0(prem.excess)}</b>.</div>`;
    }

    root.innerHTML = `
      <style>${POPUP_CSS}</style>
      <div class="overlay" part="overlay">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="ttl">
          <header>
            <div>
              <h2 id="ttl">Cover options</h2>
              <p class="sub">Prices for this booking’s length: <strong>${days} ${days === 1 ? 'day' : 'days'}</strong> · Basic cover excess: <strong>${fmt0(basicExcess)}</strong></p>
            </div>
            <button class="close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </header>
          <div class="grid">${cards}</div>
          ${diff}
          <footer>Esc or click outside to close.</footer>
        </div>
      </div>`;

    const overlay = root.querySelector('.overlay');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePopup(); });
    root.querySelector('.close').addEventListener('click', closePopup);
    root.querySelector('.close').focus();

    document.body.appendChild(host);
    openHost = host;
    openBtn = btn;
    btn.setAttribute('aria-pressed', 'true');
    document.addEventListener('keydown', onKey, true);
  }

  function closePopup() {
    if (!openHost) return;
    openHost.remove();
    if (openBtn) {
      openBtn.setAttribute('aria-pressed', 'false');
      if (document.contains(openBtn)) openBtn.focus();
    }
    openHost = null;
    openBtn = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closePopup(); }
  }

  /* ---------- Boot: the page uses tabs, so watch for the table appearing ---------- */

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enhance(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhance();
})();
