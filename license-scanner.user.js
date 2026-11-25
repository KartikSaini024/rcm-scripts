// ==UserScript==
// @name         Simba License Scanner
// @namespace    https://github.com/kartiksaini024/rcm-scripts
// @version      2.0.0
// @description  Scan driver's license and auto-fill RCM booking form
// @author       Kartik
// @match        https://bookings.rentalcarmanager.com/reservations/update/booking/*
// @match        https://bookings.rentalcarmanager.com/s_DocumentUpload.aspx*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiMxYjRmNzIiLz48cmVjdCB4PSIxNCIgeT0iMjAiIHdpZHRoPSIzNiIgaGVpZ2h0PSIyNCIgcng9IjMiIGZpbGw9IiNmZmYiLz48cmVjdCB4PSIxOCIgeT0iMjQiIHdpZHRoPSI5IiBoZWlnaHQ9IjkiIGZpbGw9IiNhZWQ2ZjEiLz48cmVjdCB4PSIzMSIgeT0iMjQiIHdpZHRoPSIxNSIgaGVpZ2h0PSIzIiBmaWxsPSIjMWI0ZjcyIi8+PHJlY3QgeD0iMzEiIHk9IjMwIiB3aWR0aD0iMTUiIGhlaWdodD0iMyIgZmlsbD0iIzFiNGY3MiIvPjxyZWN0IHg9IjE4IiB5PSIzNyIgd2lkdGg9IjI4IiBoZWlnaHQ9IjMiIGZpbGw9IiMxYjRmNzIiLz48L3N2Zz4=
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      router.huggingface.co
// @connect      api.cloudinary.com
// @connect      bookings.rentalcarmanager.com
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/license-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/kartiksaini024/rcm-scripts/main/license-scanner.user.js
// ==/UserScript==

/* global GM_xmlhttpRequest, GM_setValue, GM_getValue, GM, unsafeWindow */

(function () {
  "use strict";

  // ============================================================
  // Config (was config.js + constants in background.js)
  // ============================================================
  const HF_API_KEY = "hf"; // add your huggingface token here
  const HF_MODEL   = "zai-org/GLM-5.3-Flash:cheapest";

  const CLOUD_NAME    = "rentalcarmanager";
  const UPLOAD_PRESET = "prod-upload-preset-20250702";
  const CLOUD_API_KEY = "128229988586749";
  const CLOUD_TAGS    = "ausimbacarhire759";

  const TOKEN_KEY = "simba_upload_token";

  // Page context window — needed so our hooks apply to the site's own code,
  // not just the userscript sandbox (this replaces the extension's isolated world).
  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  // GM_xmlhttpRequest replaces the background service worker's fetch()
  // (bypasses CORS the way an extension's host_permissions did).
  const gmXhr =
    typeof GM_xmlhttpRequest !== "undefined"
      ? GM_xmlhttpRequest
      : (typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest.bind(GM) : null);

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      if (!gmXhr) return reject(new Error("GM_xmlhttpRequest unavailable"));
      gmXhr(Object.assign({}, opts, {
        onload: res => resolve(res),
        onerror: () => reject(new Error("Network error contacting " + opts.url)),
        ontimeout: () => reject(new Error("Request timed out"))
      }));
    });
  }

  // Token storage — GM storage works across tabs/popups; localStorage kept as
  // a fallback so behaviour matches the original extension.
  function saveToken(token) {
    try { GM_setValue(TOKEN_KEY, token); } catch (e) {}
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    W.__simbaUploadToken = token;
  }

  function loadToken() {
    try {
      const t = GM_getValue(TOKEN_KEY, null);
      if (t) return t;
    } catch (e) {}
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) return t;
    } catch (e) {}
    return W.__simbaUploadToken || null;
  }

  // ============================================================
  // Router (replaces manifest.json content_scripts matching)
  // ============================================================
  const href = location.href;
  const isUploadPage  = /\/s_DocumentUpload\.aspx/i.test(href);
  const isBookingPage = href.includes("/reservations/update/booking/");

  if (isUploadPage) {
    runUploadInterceptor();               // was upload-interceptor.js @ document_start
    onReady(runZoomInjector);             // was zoom.js @ document_idle
    return;
  }

  if (isBookingPage) {
    runBookingPage();                     // was content.js
    return;
  }

  // ============================================================
  // onReady helper (replaces run_at: document_idle)
  // ============================================================
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  // ============================================================
  // SCANNING (was background.js callHuggingFace)
  // ============================================================
  async function scanLicense(base64Image, mimeType) {
    const resizedBase64 = await resizeImage(base64Image, mimeType);

    const prompt = `You are analyzing a driver's license image.
Extract the following fields and return ONLY a valid JSON object, no explanation, no markdown fences.

{
  "firstName": "",
  "lastName": "",
  "licenseNo": "",
  "dob": "DD/MM/YYYY",
  "expiry": "DD/MM/YYYY",
  "state": "",
  "licenseClass": "",
  "address": "",
  "city": "",
  "postcode": ""
}

Rules:
- dob and expiry must be in DD/MM/YYYY format
- For Australian licenses: state is the 2-3 letter abbreviation (NSW, VIC, QLD, WA, SA, TAS, ACT, NT)
- For international licenses: state is the country name (e.g. Germany, France, Japan)
- licenseClass is usually C, R, LR, MR, HR, HC, MC — leave empty if not visible
- address: street address only (e.g. "29 Monroe Crss")
- city: suburb/city name
- postcode: numeric postcode
- If a field is not visible, leave it as empty string
- Return ONLY the JSON object, nothing else`;

    const res = await gmRequest({
      method: "POST",
      url: "https://router.huggingface.co/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      data: JSON.stringify({
        model: HF_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${resizedBase64}` } }
            ]
          }
        ],
        max_tokens: 400,
        stream: false
      })
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HF API ${res.status}: ${res.responseText}`);
    }

    const result = JSON.parse(res.responseText);
    const text = result.choices?.[0]?.message?.content || "";
    console.log("[Simba] Raw response:", text);

    const clean = text.replace(/```json|```/gi, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in model response: " + text);

    return JSON.parse(match[0]);
  }

  // OffscreenCanvas (service worker) -> regular canvas, since we now run in a page
  async function resizeImage(base64, mimeType) {
    const MAX_WIDTH = 1024;
    const QUALITY = 0.85;

    const blob = base64ToBlob(base64, mimeType || "image/jpeg");
    const bitmap = await createImageBitmap(blob);

    const scale = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return canvas.toDataURL("image/jpeg", QUALITY).split(",")[1];
  }

  function base64ToBlob(base64, mimeType) {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeType });
  }

  // ============================================================
  // RCM DOCUMENT UPLOAD (was background.js uploadToRCM)
  // Same-origin RCM calls use plain fetch so session cookies ride along.
  // ============================================================
  async function uploadToRCM(base64Image, token, reservationRef, customerId, description) {
    const timestamp = Math.floor(Date.now() / 1000);

    // Step 0: If no token, fetch the document upload page to get one
    let uploadToken = token;
    if (!uploadToken && reservationRef) {
      console.log("[Simba] No token — fetching upload page for token...");
      const uploadPageUrl = `https://bookings.rentalcarmanager.com/s_DocumentUpload.aspx?rcmref=${reservationRef}`;
      const pageRes = await fetch(uploadPageUrl, { credentials: "include" });
      const pageHtml = await pageRes.text();
      const tokenMatch = pageHtml.match(/token=([a-f0-9-]{36})/i);
      if (tokenMatch) {
        uploadToken = tokenMatch[1];
        console.log("[Simba] Got token from upload page:", uploadToken);
      } else {
        throw new Error("Could not find upload token from document page");
      }
    }

    // Step 1: Get Cloudinary signature from RCM
    const signParams = new URLSearchParams({
      method: "signcloudinary",
      token: uploadToken,
      cacheprevent: Date.now(),
      "data[timestamp]": timestamp,
      "data[tags]": CLOUD_TAGS,
      "data[upload_preset]": UPLOAD_PRESET,
      "data[source]": "uw"
    });
    const signUrl = `https://bookings.rentalcarmanager.com/ImgManager/documentLink.ashx?${signParams}`;

    console.log("[Simba] Signing:", signUrl);
    const signRes = await fetch(signUrl, { credentials: "include" });
    if (!signRes.ok) throw new Error(`Sign failed: ${signRes.status}`);
    const signature = (await signRes.text()).trim();
    console.log("[Simba] Got signature:", signature);

    // Step 2: Upload image to Cloudinary
    const blob = base64ToBlob(base64Image, "image/jpeg");
    const formData = new FormData();
    formData.append("file", blob, "license.jpg");
    formData.append("api_key", CLOUD_API_KEY);
    formData.append("upload_preset", UPLOAD_PRESET);
    formData.append("tags", CLOUD_TAGS);
    formData.append("timestamp", String(timestamp));
    formData.append("signature", signature);
    formData.append("source", "uw");

    console.log("[Simba] Uploading to Cloudinary...");
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData
    });

    const uploadText = await uploadRes.text();
    console.log("[Simba] Cloudinary response:", uploadRes.status, uploadText);
    if (!uploadRes.ok) throw new Error(`Cloudinary upload failed: ${uploadRes.status}: ${uploadText}`);
    const uploadData = JSON.parse(uploadText);
    console.log("[Simba] Cloudinary upload success:", uploadData.public_id);

    // Step 3: Store reference in RCM
    const storeUrl = `https://bookings.rentalcarmanager.com/ImgManager/documentLink.ashx?token=${uploadToken}&method=store&cacheprevent=${Date.now()}`;

    const storeBody = {
      method: "store",
      documentlinksetupid: 0,
      customerid: customerId,
      description: description || "Customer License",
      doctype: "image",
      istaggedincloudinary: true,
      mappedrecordid: 0,
      mappedtablename: "",
      reservationref: reservationRef,
      resultsprovider: {
        id: uploadData.public_id,
        asset_id: uploadData.asset_id,
        secure_url: uploadData.secure_url,
        format: uploadData.format,
        width: uploadData.width,
        height: uploadData.height
      },
      sequencenumber: 0,
      source: "RCM (Reservation)",
      storageprovider: "cloudinary.com",
      url: uploadData.secure_url,
      vehicleid: 0
    };

    const storeRes = await fetch(storeUrl, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(storeBody)
    });

    if (!storeRes.ok) throw new Error(`Store failed: ${storeRes.status}`);
    console.log("[Simba] Document stored successfully");
  }

  // ============================================================
  // BOOKING PAGE (was content.js)
  // ============================================================
  function runBookingPage() {
    const MONTHS = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
                     "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };

    // ── Hook window.open to inject token interceptor into popup ─
    W.__simbaUploadToken = W.__simbaUploadToken || null;

    const _origWindowOpen = W.open;
    W.open = function (url, ...args) {
      const popup = _origWindowOpen.apply(this, [url, ...args]);
      if (popup && typeof url === "string" && url.includes("DocumentUpload")) {
        const injector = setInterval(() => {
          try {
            const popDoc = popup.document;
            if (!popDoc || popDoc.readyState === "loading") return;
            if (popDoc.__simbaInjected) { clearInterval(injector); return; }
            popDoc.__simbaInjected = true;
            clearInterval(injector);

            // Hook XHR in popup
            const popXHR = popup.XMLHttpRequest.prototype;
            const _popOpen = popXHR.open;
            popXHR.open = function (method, xhrUrl, ...xargs) {
              if (typeof xhrUrl === "string" && xhrUrl.includes("signcloudinary")) {
                const m = xhrUrl.match(/token=([a-f0-9-]{36})/i);
                if (m) {
                  saveToken(m[1]);
                  console.log("[Simba] Captured token from popup XHR:", m[1]);
                }
              }
              return _popOpen.apply(this, [method, xhrUrl, ...xargs]);
            };

            // Hook fetch in popup
            const _popFetch = popup.fetch;
            popup.fetch = function (input, ...fargs) {
              const furl = typeof input === "string" ? input : input?.url || "";
              if (furl.includes("signcloudinary")) {
                const m = furl.match(/token=([a-f0-9-]{36})/i);
                if (m) {
                  saveToken(m[1]);
                  console.log("[Simba] Captured token from popup fetch:", m[1]);
                }
              }
              return _popFetch.apply(popup, [input, ...fargs]);
            };

            console.log("[Simba] Injected interceptor into popup");
          } catch (e) {
            // Popup not ready yet — retry
          }
        }, 100);
      }
      return popup;
    };

    // ── Init ───────────────────────────────────────────────────
    function init() {
      injectPrimaryButton();

      // Watch DOM for additional driver form appearing after + click
      const observer = new MutationObserver(() => {
        injectAdditionalButton();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // ── Primary Driver Button ──────────────────────────────────
    function injectPrimaryButton() {
      if (document.getElementById("simba-wrapper-primary")) return;

      const heading = findExactHeading("Primary Driver");
      if (!heading) { setTimeout(injectPrimaryButton, 500); return; }

      const { wrapper, status } = buildScanButton("primary", "Scan License ▼");
      heading.insertAdjacentElement("afterend", status);
      heading.insertAdjacentElement("afterend", wrapper);
    }

    // ── Additional Driver Button ───────────────────────────────
    function injectAdditionalButton() {
      if (document.getElementById("simba-wrapper-additional")) return;

      const additionalInput = document.querySelector('input[name="extxtLastName"]');
      if (!additionalInput || !isVisible(additionalInput)) return;

      const heading = findExactHeading("Additional Drivers");
      if (!heading) return;

      const { wrapper, status } = buildScanButton("additional", "Scan Additional Driver ▼");
      heading.insertAdjacentElement("afterend", status);
      heading.insertAdjacentElement("afterend", wrapper);
    }

    function isVisible(el) {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // ── Find heading by exact text (ignoring child elements) ───
    function findExactHeading(text) {
      for (const el of document.querySelectorAll("h3,h4,legend,strong,b,span,div,td,th,a")) {
        if (el.childElementCount === 0 && el.textContent.trim() === text) return el;
      }
      return null;
    }

    // ── Build scan button with dropdown ───────────────────────
    function buildScanButton(driver, label) {
      const wrapperId = `simba-wrapper-${driver}`;
      const menuId    = `simba-menu-${driver}`;
      const statusId  = `simba-status-${driver}`;

      const wrapper = document.createElement("div");
      wrapper.id = wrapperId;
      wrapper.style.cssText = "display:inline-block;position:relative;margin-left:8px;vertical-align:middle;font-family:Arial,sans-serif;margin-top:4px;";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<span style="margin-right:4px">📋</span>${label}`;
      btn.style.cssText = `
        background:#337ab7;color:#fff;border:1px solid #2e6da4;
        padding:3px 10px;border-radius:3px;font-size:12px;
        cursor:pointer;line-height:1.5;white-space:nowrap;
      `;
      btn.addEventListener("mouseenter", () => btn.style.background = "#286090");
      btn.addEventListener("mouseleave", () => btn.style.background = "#337ab7");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = document.getElementById(menuId);
        if (!menu) return;
        document.querySelectorAll("[id^='simba-menu-']").forEach(m => {
          if (m.id !== menuId) m.style.display = "none";
        });
        menu.style.display = menu.style.display === "none" ? "block" : "none";
      });

      const menu = document.createElement("div");
      menu.id = menuId;
      menu.style.cssText = `
        display:none;position:absolute;top:100%;left:0;z-index:9999;
        background:#fff;border:1px solid #ccc;border-radius:3px;
        box-shadow:0 2px 6px rgba(0,0,0,0.15);min-width:170px;margin-top:2px;
      `;

      [
        { icon: "📁", label: "Upload File", action: () => triggerUpload(driver, statusId) },
        { icon: "📷", label: "Use Camera",  action: () => triggerCamera(driver, statusId) },
      ].forEach(item => {
        const opt = document.createElement("div");
        opt.style.cssText = "padding:7px 14px;cursor:pointer;font-size:12px;color:#333;display:flex;align-items:center;gap:8px;";
        opt.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
        opt.addEventListener("mouseenter", () => opt.style.background = "#f5f5f5");
        opt.addEventListener("mouseleave", () => opt.style.background = "");
        opt.addEventListener("click", () => { menu.style.display = "none"; item.action(); });
        menu.appendChild(opt);
      });

      // Close on outside click
      document.addEventListener("click", () => { menu.style.display = "none"; });

      const status = document.createElement("span");
      status.id = statusId;
      status.style.cssText = "margin-left:8px;font-size:12px;font-weight:bold;vertical-align:middle;";

      wrapper.appendChild(btn);
      wrapper.appendChild(menu);

      return { wrapper, status };
    }

    // ── Upload from file ───────────────────────────────────────
    function triggerUpload(driver, statusId) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const file = input.files[0];
        document.body.removeChild(input);
        if (file) processFile(file, driver, statusId);
      });
      input.click();
    }

    // ── Camera capture ─────────────────────────────────────────
    function triggerCamera(driver, statusId) {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;";

      const box = document.createElement("div");
      box.style.cssText = "background:#fff;border-radius:6px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:520px;width:95%;";

      const title = document.createElement("div");
      title.textContent = driver === "additional" ? "📷 Capture Additional Driver License" : "📷 Capture License";
      title.style.cssText = "font-size:15px;font-weight:bold;color:#333;align-self:flex-start;";

      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.style.cssText = "width:100%;border-radius:4px;background:#000;max-height:300px;object-fit:cover;";

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:10px;";

      const captureBtn = document.createElement("button");
      captureBtn.type = "button";
      captureBtn.textContent = "📸 Capture";
      captureBtn.style.cssText = "background:#337ab7;color:#fff;border:1px solid #2e6da4;padding:5px 18px;border-radius:3px;font-size:13px;cursor:pointer;";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = "background:#fff;color:#333;border:1px solid #ccc;padding:5px 18px;border-radius:3px;font-size:13px;cursor:pointer;";

      btnRow.appendChild(captureBtn);
      btnRow.appendChild(cancelBtn);
      box.appendChild(title);
      box.appendChild(video);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let stream = null;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(s => { stream = s; video.srcObject = s; })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true })
          .then(s => { stream = s; video.srcObject = s; })
          .catch(() => { closeOverlay(); setStatus(statusId, "❌ Camera not accessible", "#c0392b"); }));

      function closeOverlay() {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (overlay.parentNode) document.body.removeChild(overlay);
      }

      captureBtn.addEventListener("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        closeOverlay();
        canvas.toBlob(blob => {
          if (blob) processFile(new File([blob], "capture.jpg", { type: "image/jpeg" }), driver, statusId);
        }, "image/jpeg", 0.92);
      });

      cancelBtn.addEventListener("click", closeOverlay);
    }

    // ── Shared processing ──────────────────────────────────────
    async function processFile(file, driver, statusId) {
      setStatus(statusId, "⏳ Reading...", "#e67e22");
      try {
        const base64 = await fileToBase64(file);
        setStatus(statusId, "⏳ Scanning...", "#e67e22");

        // Direct call — replaces chrome.runtime.sendMessage to the service worker
        const data = await scanLicense(base64, file.type);

        console.log("[Simba] Extracted:", data);
        driver === "additional" ? fillAdditionalDriver(data) : fillPrimaryDriver(data);

        // The original extension defined uploadLicenseImage() but never called it.
        // Uncomment the next line to also push the scanned image into RCM Documents.
        // await uploadLicenseImage(base64, driver);

        setStatus(statusId, "✅ Done!", "#27ae60");
        setTimeout(() => setStatus(statusId, "", ""), 3000);
      } catch (err) {
        console.error("[Simba] Error:", err);
        setStatus(statusId, "❌ " + err.message, "#c0392b");
      }
    }

    // ── Upload scanned image to RCM Documents ─────────────────
    async function uploadLicenseImage(base64, driver) {
      try {
        const reservationRef = getReservationRef();
        const token = loadToken();
        const customerId = getCustomerId();
        if (!reservationRef) {
          console.warn("[Simba] Could not find reservationRef — skipping upload");
          return;
        }
        console.log("[Simba] Upload token available:", !!token);
        const description = driver === "additional" ? "Additional Driver License" : "Customer License";
        await uploadToRCM(base64, token, reservationRef, customerId, description);
        console.log("[Simba] Image uploaded to RCM documents");
      } catch (err) {
        console.warn("[Simba] Upload skipped:", err.message);
        // Non-fatal — form is already filled, just log
      }
    }

    function getReservationRef() {
      const m = document.documentElement.innerHTML.match(/rcmref=([A-Z0-9]+)/i);
      return m ? m[1] : null;
    }

    function getCustomerId() {
      const el = document.querySelector('input[name="hidCustID"]');
      return el ? parseInt(el.value) || 0 : 0;
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ── Fill Primary Driver ────────────────────────────────────
    function fillPrimaryDriver(data) {
      setField('input[name="txtLastName"]',  data.lastName);
      setField('input[name="txtFirstName"]', data.firstName);
      setField('input[name="txtLicense"]',   data.licenseNo);
      setField('input[name="txtLicIssued"]', data.state);
      if (data.address)  setField('input[name="txtAddress"]',  data.address);
      if (data.city)     setField('input[name="txtCity"]',     data.city);
      if (data.postcode) setField('input[name="txtPostCode"]', data.postcode);
      if (data.licenseClass) setDropdown('select[name="cmbLicClass"]', data.licenseClass);

      const unnamed = Array.from(document.querySelectorAll("select")).filter(s => !s.name);
      if (data.dob) {
        const [d, m, y] = splitDate(data.dob);
        setSelectByText(unnamed[0], d);
        setSelectByText(unnamed[1], MONTHS[m]);
        setSelectByText(unnamed[2], y);
      }
      if (data.expiry) {
        const [d, m, y] = splitDate(data.expiry);
        setSelectByText(unnamed[3], d);
        setSelectByText(unnamed[4], MONTHS[m]);
        setSelectByText(unnamed[5], y);
      }
    }

    // ── Fill Additional Driver ─────────────────────────────────
    function fillAdditionalDriver(data) {
      setField('input[name="extxtLastName"]',  data.lastName);
      setField('input[name="extxtFirstName"]', data.firstName);
      setField('input[name="extxtLicense"]',   data.licenseNo);
      setField('input[name="extxtLicIssued"]', data.state);
      if (data.address)  setField('input[name="extxtAddress"]',  data.address);
      if (data.city)     setField('input[name="extxtCity"]',     data.city);
      if (data.postcode) setField('input[name="extxtPostCode"]', data.postcode);
      if (data.licenseClass) setDropdown('select[name="excmbLicClass"]', data.licenseClass);

      const unnamed = Array.from(document.querySelectorAll("select")).filter(s => !s.name);
      if (data.dob) {
        const [d, m, y] = splitDate(data.dob);
        setSelectByText(unnamed[6], d);
        setSelectByText(unnamed[7], MONTHS[m]);
        setSelectByText(unnamed[8], y);
      }
      if (data.expiry) {
        const [d, m, y] = splitDate(data.expiry);
        setSelectByText(unnamed[9],  d);
        setSelectByText(unnamed[10], MONTHS[m]);
        setSelectByText(unnamed[11], y);
      }
    }

    // ── Helpers ────────────────────────────────────────────────
    function splitDate(str) {
      const parts = str.split("/");
      if (parts.length !== 3) return ["", "", ""];
      return [String(parseInt(parts[0])), parts[1].padStart(2, "0"), parts[2]];
    }

    function setField(selector, value) {
      if (!value) return;
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setSelectByText(el, value) {
      if (!el || !value) return;
      const match = Array.from(el.options).find(o =>
        o.value === value || o.text.trim() === value || o.text.trim().toLowerCase() === value.toLowerCase()
      );
      if (match) { el.value = match.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
    }

    function setDropdown(selector, value) {
      if (!value) return;
      const el = document.querySelector(selector);
      if (!el) return;
      const match = Array.from(el.options).find(o =>
        o.value === value ||
        o.text.trim().toLowerCase() === value.toLowerCase() ||
        o.text.trim().toLowerCase().includes(value.toLowerCase())
      );
      if (match) { el.value = match.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
    }

    function setStatus(statusId, msg, color) {
      const el = document.getElementById(statusId);
      if (el) { el.textContent = msg; el.style.color = color; }
    }

    onReady(init);
  }

  // ============================================================
  // UPLOAD PAGE — token interceptor (was upload-interceptor.js)
  // Hooks are applied to the page context via unsafeWindow so the
  // site's own XHR/fetch calls are seen.
  // ============================================================
  function runUploadInterceptor() {
    function captureToken(url) {
      if (!url || !url.includes("signcloudinary")) return;
      const m = url.match(/token=([a-f0-9-]{36})/i);
      if (m) {
        console.log("[Simba Interceptor] Captured token:", m[1]);
        saveToken(m[1]);
      }
    }

    // Hook XHR
    const _origOpen = W.XMLHttpRequest.prototype.open;
    W.XMLHttpRequest.prototype.open = function (method, url, ...args) {
      captureToken(typeof url === "string" ? url : "");
      return _origOpen.apply(this, [method, url, ...args]);
    };

    // Hook fetch
    const _origFetch = W.fetch;
    W.fetch = function (input, ...args) {
      captureToken(typeof input === "string" ? input : input?.url || "");
      return _origFetch.apply(this, [input, ...args]);
    };

    // Bonus: the token often sits in the page URL itself
    captureTokenFromLocation();
    function captureTokenFromLocation() {
      const m = location.href.match(/token=([a-f0-9-]{36})/i);
      if (m) saveToken(m[1]);
    }
  }

  // ============================================================
  // UPLOAD PAGE — camera zoom injector (was zoom.js)
  // ============================================================
  function runZoomInjector() {
    let zoomInjected = false;
    let zoomBar = null;

    function getIframeDoc() {
      const iframe = document.getElementById("frmVault");
      try { return iframe?.contentDocument || iframe?.contentWindow?.document; }
      catch (e) { return null; }
    }

    startPolling();

    function startPolling() {
      const p = setInterval(() => {
        const doc = getIframeDoc();
        if (!doc) return;
        const video = doc.querySelector("video");
        if (video && !zoomInjected) {
          zoomInjected = true;
          clearInterval(p);
          waitForStream(video, doc);
        }
      }, 400);
    }

    function waitForStream(video, doc) {
      const streamPoll = setInterval(() => {
        const stream = video.srcObject;
        if (stream && stream.getVideoTracks().length > 0) {
          clearInterval(streamPoll);
          injectZoomSlider(video, doc, stream);
        }
      }, 300);
    }

    async function injectZoomSlider(video, doc, stream) {
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      let zoomMin = 1, zoomMax = 5, zoomStep = 0.1;

      try {
        const caps = track.getCapabilities?.();
        if (caps?.zoom) {
          zoomMin = caps.zoom.min;
          zoomMax = caps.zoom.max;
          zoomStep = caps.zoom.step || 0.1;
        }
      } catch (e) {}

      const current = track.getSettings?.()?.zoom || zoomMin;

      // Build the zoom bar
      zoomBar = doc.createElement("div");
      zoomBar.id = "simba-zoom-bar";
      zoomBar.style.cssText = `
        display:flex;align-items:center;gap:10px;
        padding:7px 14px;background:#f0f4f8;
        border-top:1px solid #d0d8e0;
        font-family:Arial,sans-serif;box-sizing:border-box;width:100%;
      `;

      const label = doc.createElement("span");
      label.textContent = "🔍 Zoom";
      label.style.cssText = "font-size:12px;color:#555;white-space:nowrap;font-weight:bold;";

      const minBtn = doc.createElement("span");
      minBtn.textContent = "−";
      minBtn.style.cssText = "font-size:18px;color:#337ab7;cursor:pointer;user-select:none;font-weight:bold;line-height:1;";

      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = zoomMin;
      slider.max = zoomMax;
      slider.step = zoomStep;
      slider.value = current;
      slider.style.cssText = "flex:1;accent-color:#337ab7;cursor:pointer;height:4px;";

      const maxBtn = doc.createElement("span");
      maxBtn.textContent = "+";
      maxBtn.style.cssText = "font-size:18px;color:#337ab7;cursor:pointer;user-select:none;font-weight:bold;line-height:1;";

      const valueLabel = doc.createElement("span");
      valueLabel.textContent = `${parseFloat(current).toFixed(1)}×`;
      valueLabel.style.cssText = "font-size:12px;color:#337ab7;width:34px;text-align:right;white-space:nowrap;font-weight:bold;";

      async function applyZoom(val) {
        const v = Math.min(zoomMax, Math.max(zoomMin, parseFloat(val)));
        slider.value = v;
        valueLabel.textContent = `${v.toFixed(1)}×`;

        // Try native camera zoom first
        try {
          await track.applyConstraints({ advanced: [{ zoom: v }] });
          video.style.transform = "";
          return;
        } catch (e) {}

        // CSS scale fallback
        video.style.transformOrigin = "center center";
        video.style.transform = `scale(${v})`;
      }

      slider.addEventListener("input", () => applyZoom(slider.value));
      minBtn.addEventListener("click", () => applyZoom(parseFloat(slider.value) - zoomStep * 5));
      maxBtn.addEventListener("click", () => applyZoom(parseFloat(slider.value) + zoomStep * 5));

      zoomBar.appendChild(label);
      zoomBar.appendChild(minBtn);
      zoomBar.appendChild(slider);
      zoomBar.appendChild(maxBtn);
      zoomBar.appendChild(valueLabel);

      // Insert right below the video
      video.insertAdjacentElement("afterend", zoomBar);

      // Watch for modal close — reset if video disappears
      const closeWatch = setInterval(() => {
        if (!doc.querySelector("video")) {
          clearInterval(closeWatch);
          zoomInjected = false;
          zoomBar = null;
          startPolling();
        }
      }, 1000);
    }
  }

})();
