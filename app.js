// =============================================================================
// ANIMO — customer card logic
// No login, no accounts. The customer's identity is a random UUID we generate
// once and keep in localStorage. That same UUID is what the QR code encodes.
// =============================================================================
(function () {
  "use strict";

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.ANIMO_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const STORAGE_KEY = "animo_customer_id";
  const STAMP_SLOTS = 5;
  const POLL_MS = 4000;

  const stampsEl = document.getElementById("stamps");
  const labelEl = document.getElementById("progressLabel");
  const qrEl = document.getElementById("qrcode");
  const toastEl = document.getElementById("toast");

  let currentStamps = -1; // force first render
  let qrRendered = false;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("toast--show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("toast--show"), 3200);
  }

  function renderQr(customerId) {
    if (qrRendered) return;
    // eslint-disable-next-line no-undef
    new QRCode(qrEl, {
      text: customerId,
      width: 176,
      height: 176,
      colorDark: "#1B1410",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
    qrRendered = true;
  }

  function renderStamps(stamps, justEarned) {
    if (stamps === currentStamps && !justEarned) return;
    const wasLower = currentStamps >= 0 && stamps > currentStamps;
    currentStamps = stamps;

    stampsEl.innerHTML = "";
    for (let i = 0; i < STAMP_SLOTS; i++) {
      const el = document.createElement("div");
      const filled = i < stamps;
      el.className = "stamp" + (filled ? " stamp--filled" : "");
      if (filled) el.textContent = "✦";
      if (filled && wasLower && i === stamps - 1) {
        el.classList.add("stamp--pop");
      }
      stampsEl.appendChild(el);
    }

    if (justEarned) {
      labelEl.textContent = "🎉 Free coffee earned — enjoy!";
      labelEl.classList.add("progress-label--reward");
      showToast("Free coffee unlocked!");
    } else {
      labelEl.classList.remove("progress-label--reward");
      const remaining = STAMP_SLOTS - stamps;
      labelEl.textContent =
        stamps === 0
          ? "Get a stamp with every cup"
          : `${remaining} more stamp${remaining === 1 ? "" : "s"} to a free coffee`;
    }
  }

  async function getOrCreateCustomerId() {
    let id = localStorage.getItem(STORAGE_KEY);
    if (id) return id;

    const { data, error } = await sb.rpc("register_customer");
    if (error || !data) {
      throw new Error(error?.message || "Could not create your card.");
    }
    localStorage.setItem(STORAGE_KEY, data);
    return data;
  }

  async function refresh(customerId) {
    const { data, error } = await sb.rpc("get_customer_status", {
      p_customer_id: customerId,
    });
    if (error) {
      console.error(error);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    renderStamps(row.stamps, row.reward_just_earned);
  }

  async function init() {
    try {
      const customerId = await getOrCreateCustomerId();
      renderQr(customerId);
      await refresh(customerId);
      setInterval(() => {
        if (document.visibilityState === "visible") refresh(customerId);
      }, POLL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refresh(customerId);
      });
    } catch (err) {
      labelEl.textContent = "Couldn't load your card. Check your connection and reopen the app.";
      console.error(err);
    }
  }

  init();

  // Register the service worker for installability / offline app-shell.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
