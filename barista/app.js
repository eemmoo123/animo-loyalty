document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  const SUPABASE_URL = "https://zljlwnqphtbowtjazyqu.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_5Q-Zd5dkLvuKqwwRUF6zew_952ZJtqZ";

  let sb = null;
  function getSupabase() {
    if (!sb && window.supabase) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return sb;
  }

  const PIN_SESSION_KEY = "animo_staff_pin";
  const RESCAN_COOLDOWN_MS = 2500;

  const pinPanel = document.getElementById("pinPanel");
  const pinInput = document.getElementById("pinInput");
  const pinError = document.getElementById("pinError");
  const unlockBtn = document.getElementById("unlockBtn");
  const scanPanel = document.getElementById("scanPanel");
  const lockBtn = document.getElementById("lockBtn");
  const resultEl = document.getElementById("result");

  let html5QrCode = null;
  let busy = false;
  let lastCode = null;
  let lastCodeAt = 0;

  function showResult(kind, text) {
    if (!resultEl) return;
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
    if (text === lastCode && now - lastCodeAt < RESCAN_COOLDOWN_MS) return;
    lastCode = text;
    lastCodeAt = now;

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
      const client = getSupabase();
      if (!client) throw new Error("Supabase client not ready");

      const { data, error } = await client.rpc("add_stamp", {
        p_customer_id: text,
        p_pin: pin,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;

      if (!row.ok) {
        showResult("error", row.message);
        vibrate([60, 40, 60]);
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
    try {
      if (typeof Html5Qrcode === "undefined") {
        showResult("error", "Scanner script loading...");
        return;
      }
      html5QrCode = new Html5Qrcode("reader");
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => handleDecoded(decodedText),
        () => {}
      );
    } catch (err) {
      showResult("error", "Camera access required.");
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
    if (pinPanel) pinPanel.classList.add("hidden");
    if (scanPanel) scanPanel.classList.remove("hidden");
    startScanner();
  }

  function lockScanner() {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    stopScanner();
    if (scanPanel) scanPanel.classList.add("hidden");
    if (pinPanel) pinPanel.classList.remove("hidden");
    if (pinInput) {
      pinInput.value = "";
      pinInput.focus();
    }
  }

  if (unlockBtn) {
    unlockBtn.addEventListener("click", function () {
      const pin = pinInput ? pinInput.value.trim() : "";
      if (!pin) {
        if (pinError) pinError.textContent = "Please enter PIN";
        return;
      }
      if (pinError) pinError.textContent = "";
      sessionStorage.setItem(PIN_SESSION_KEY, pin);
      unlockScanner();
    });
  }

  if (lockBtn) {
    lockBtn.addEventListener("click", lockScanner);
  }

  if (sessionStorage.getItem(PIN_SESSION_KEY)) {
    unlockScanner();
  }
});
