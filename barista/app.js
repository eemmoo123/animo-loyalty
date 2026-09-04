// =============================================================================
// ANIMO — barista scanner logic
// PIN unlocks the CAMERA for this browser tab only (sessionStorage, cleared on
// close). The PIN itself is re-verified by the server on every single stamp —
// unlocking the UI is a convenience, not the security boundary. The real
// boundary is add_stamp() in Postgres, which checks the PIN, checks lockouts,
// and checks a per-customer cooldown every time it's called.
// =============================================================================
(function () {
  "use strict";

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.ANIMO_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const PIN_SESSION_KEY = "animo_staff_pin"; // sessionStorage only — gone when tab closes
  const RESCAN_COOLDOWN_MS = 2500;

  const pinPanel = document.getElementById("pinPanel");
  const pinForm = document.getElementById("pinForm");
  const pinInput = document.getElementById("pinInput");
  const pinError = document.getElementById("pinError");
  const scanPanel = document.getElementById("scanPanel");
  const lockBtn = document.getElementById("lockBtn");
  const resultEl = document.getElementById("result");

  let html5QrCode = null;
  let busy = false;
  let lastCode = null;
  let lastCodeAt = 0;

  function showResult(kind, text) {
    resultEl.textContent = text;
    resultEl.className = "result result--show result--" + kind;
    clearTimeout(showResult._t);
    showResult._t = setTimeout(() => {
      resultEl.classList.remove("result--show");
    }, 2600);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  async function handleDecoded(text) {
    const now = Date.now();
    if (busy) return;
    if (text === lastCode && now - lastCodeAt < RESCAN_COOLDOWN_MS) return; // same code, still in view
    lastCode = text;
    lastCodeAt = now;

    // A customer QR encodes a UUID. Anything else isn't one of ours.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(text)) {
      showResult("error", "Not an Animo card.");
      vibrate(80);
      return;
    }

    const pin = sessionStorage.getItem(PIN_SESSION_KEY);
    if (!pin) {
      lockScanner();
      return;
    }

    busy = true;
    try {
      const { data, error } = await sb.rpc("add_stamp", {
        p_customer_id: text,
        p_pin: pin,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;

      if (!row.ok) {
        showResult("error", row.message);
        vibrate([60, 40, 60]);
        // A wrong/locked PIN means this device's stored PIN is no good — force re-entry.
        if (/pin/i.test(row.message)) lockScanner();
      } else if (row.reward_earned) {
        showResult("reward", "🎉 Free coffee! Card reset to 0/5.");
        vibrate([40, 30, 40, 30, 120]);
      } else {
        showResult("ok", `Stamped — ${row.stamps}/5`);
        vibrate(50);
      }
    } catch (err) {
      console.error(err);
      showResult("error", "Network error — try again.");
    } finally {
      busy = false;
    }
  }

  async function startScanner() {
    html5QrCode = new Html5Qrcode("reader");
    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => handleDecoded(decodedText),
        () => {} // ignore per-frame "no QR found" noise
      );
    } catch (err) {
      showResult("error", "Camera unavailable — check permissions.");
      console.error(err);
    }
  }

  async function stopScanner() {
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        html5QrCode.clear();
      } catch (_) {}
      html5QrCode = null;
    }
  }

  function unlockScanner() {
    pinPanel.classList.add("hidden");
    scanPanel.classList.remove("hidden");
    startScanner();
  }

  function lockScanner() {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    stopScanner();
    scanPanel.classList.add("hidden");
    pinPanel.classList.remove("hidden");
    pinInput.value = "";
    pinInput.focus();
  }

  pinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;
    pinError.textContent = "";
    // We don't verify the PIN here — there's nothing to verify against on the
    // client. We store it and let the first real scan confirm it server-side.
    sessionStorage.setItem(PIN_SESSION_KEY, pin);
    unlockScanner();
  });

  lockBtn.addEventListener("click", lockScanner);

  // If a PIN is already unlocked in this tab (e.g. page reload), skip the gate.
  if (sessionStorage.getItem(PIN_SESSION_KEY)) {
    unlockScanner();
  }
})();
