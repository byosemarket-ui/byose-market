(function invoiceVerifyPage() {
  const card = document.getElementById("ivCard");
  const storeEl = document.getElementById("ivStore");
  const logoEl = document.getElementById("ivLogo");
  if (!card) return;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw || raw.toLowerCase() === "undefined" || raw.toLowerCase() === "null") return "";
    return raw;
  }

  function apiBase() {
    const configured = String(window.BYOSE_API_BASE_URL || "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    const origin = String(window.location?.origin || "").replace(/\/+$/, "");
    return origin ? `${origin}/api` : "/api";
  }

  function formatMoney(value, currency) {
    const amount = Number(value);
    const code = text(currency) || "RWF";
    if (!Number.isFinite(amount)) return "";
    return `${code} ${amount.toLocaleString("en-US")}`;
  }

  function formatDate(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function titleCase(value) {
    const raw = text(value);
    if (!raw) return "";
    return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function renderError(message) {
    card.innerHTML = `
      <h1>Document not verified</h1>
      <p class="iv-kicker">${escapeHtml(message || "This invoice reference could not be confirmed.")}</p>
      <div class="iv-status is-bad">Unverified</div>
      <p class="iv-note">This page confirms only that a BYOSE Market invoice exists for a signed document reference. It does not display customer personal details.</p>
    `;
  }

  function renderSuccess(payload, storeName) {
    const rows = [
      ["Document", payload.documentType || "Invoice & Delivery Confirmation"],
      ["Store", storeName || payload.storeName || "BYOSE Market"],
      ["Order Number", payload.orderNumber ? `#${payload.orderNumber}` : ""],
      ["Order Date", formatDate(payload.orderDate)],
      ["Payment Status", titleCase(payload.paymentStatus)],
      ["Delivery Status", titleCase(payload.deliveryStatus)],
      ["Customer Confirmation", titleCase(payload.customerConfirmation)],
      ["Items", payload.itemCount != null && payload.itemCount !== "" ? String(payload.itemCount) : ""],
      ["Total", formatMoney(payload.total, payload.currency)]
    ].filter((row) => row[1]);

    card.innerHTML = `
      <h1>Invoice verified</h1>
      <p class="iv-kicker">This signed reference matches a BYOSE Market invoice &amp; delivery confirmation.</p>
      ${rows.map((row) => `<div class="iv-row"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`).join("")}
      <div class="iv-status is-ok">Verified document</div>
      <p class="iv-note">Customer name, address, phone, email, and payment credentials are not shown here. Full invoice details remain available to authorised BYOSE Market administrators.</p>
    `;
  }

  async function loadPublicBranding() {
    try {
      const response = await fetch(`${apiBase()}/settings/public`, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      const settings = payload?.settings || payload || {};
      const storeName = text(settings.storeName) || "BYOSE Market";
      if (storeEl) storeEl.textContent = storeName;
      const logo = text(settings.branding?.logos?.mainLogo || settings.branding?.logos?.emailLogo);
      if (logo && logoEl) logoEl.src = logo;
      const primary = text(settings.branding?.colors?.primary);
      if (primary) document.documentElement.style.setProperty("--inv", primary);
      return storeName;
    } catch (_error) {
      return "BYOSE Market";
    }
  }

  async function start() {
    const params = new URLSearchParams(window.location.search || "");
    const ref = text(params.get("ref") || params.get("r"));
    const sig = text(params.get("sig") || params.get("s"));
    const storeName = await loadPublicBranding();
    if (!ref || !sig) {
      renderError("This verification link is incomplete.");
      return;
    }
    try {
      const url = `${apiBase()}/invoices/verify?ref=${encodeURIComponent(ref)}&sig=${encodeURIComponent(sig)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.verification) {
        renderError(payload?.message || "This invoice reference could not be confirmed.");
        return;
      }
      renderSuccess(payload.verification, storeName);
    } catch (_error) {
      renderError("Unable to reach BYOSE Market invoice verification right now.");
    }
  }

  start();
}());
