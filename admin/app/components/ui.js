export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCurrency(value) {
  return `RWF ${Number(value || 0).toLocaleString("en-US")}`;
}

export function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function loadingState(message) {
  return `
    <div class="state-block state-block-loading">
      <div class="spinner"></div>
      <p>${escapeHtml(message || "Loading data...")}</p>
      <div class="skeleton-grid" aria-hidden="true">
        <div class="skeleton-box"></div>
        <div class="skeleton-box"></div>
        <div class="skeleton-box"></div>
      </div>
    </div>
  `;
}

export function errorState(message) {
  return `<div class="state-block state-block-error"><p>${escapeHtml(message || "Something went wrong.")}</p></div>`;
}

export function emptyState(message) {
  return `<div class="state-block state-block-empty"><p>${escapeHtml(message || "No records found.")}</p></div>`;
}

export function statCard(label, value, note) {
  return `
    <article class="card stat-card">
      <p class="stat-label">${escapeHtml(label)}</p>
      <h3 class="stat-value">${escapeHtml(value)}</h3>
      <p class="stat-note">${escapeHtml(note || "")}</p>
    </article>
  `;
}

export function panel(title, subtitle, content) {
  return `
    <section class="card panel">
      <header class="panel-header">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle || "")}</p>
      </header>
      <div class="panel-body">${content || ""}</div>
    </section>
  `;
}

export function table(columns, rows) {
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => {
    if (cell && typeof cell === "object" && typeof cell.html === "string") {
      return `<td>${cell.html}</td>`;
    }

    return `<td>${escapeHtml(cell)}</td>`;
  }).join("")}</tr>`).join("");

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function normalizeSeriesItem(item) {
  if (!item || typeof item !== "object") {
    return { label: "-", value: 0 };
  }

  const label = item.label || item.name || item.month || item.day || "-";
  const value = Number(item.total ?? item.value ?? item.count ?? item.joined ?? item.revenue ?? 0);
  return {
    label,
    value: Number.isFinite(value) ? value : 0
  };
}

function renderSeries(series) {
  const normalized = Array.isArray(series) ? series.map(normalizeSeriesItem) : [];
  const safeSeries = normalized.length ? normalized : Array.from({ length: 6 }).map((_entry, index) => ({
    label: `P${index + 1}`,
    value: 0
  }));

  const maxValue = Math.max(1, ...safeSeries.map((entry) => entry.value));

  return {
    bars: safeSeries.map((entry) => {
      const height = Math.max(8, Math.round((entry.value / maxValue) * 100));
      return `<div class="chart-bar" style="height: ${height}%"><span>${escapeHtml(entry.label)}</span></div>`;
    }).join(""),
    total: safeSeries.reduce((sum, entry) => sum + Number(entry.value || 0), 0),
    peak: maxValue,
    points: safeSeries.length
  };
}

export function chartContainer(title, subtitle, series = []) {
  const variantMap = {
    weekly: "chart-variant-weekly",
    monthly: "chart-variant-monthly",
    customers: "chart-variant-customers",
    visitors: "chart-variant-visitors",
    performance: "chart-variant-performance"
  };

  const firstWord = String(title || "").toLowerCase();
  const variant = firstWord.includes("weekly")
    ? variantMap.weekly
    : firstWord.includes("monthly")
      ? variantMap.monthly
      : firstWord.includes("customer")
        ? variantMap.customers
        : firstWord.includes("visitor")
          ? variantMap.visitors
          : variantMap.performance;

  const chart = renderSeries(series);

  return `
    <section class="card chart-card ${variant}">
      <header class="panel-header">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle || "Realtime-ready chart container")}</p>
      </header>
      <div class="chart-meta-row">
        <span>Total: ${Number(chart.total || 0).toLocaleString("en-US")}</span>
        <span>Peak: ${Number(chart.peak || 0).toLocaleString("en-US")}</span>
        <span>Points: ${Number(chart.points || 0)}</span>
      </div>
      <div class="chart-placeholder" role="img" aria-label="${escapeHtml(title)} chart">
        ${chart.bars}
      </div>
    </section>
  `;
}

export function badge(value, tone) {
  const normalizedTone = ["success", "warn", "danger", "neutral"].includes(tone) ? tone : "neutral";
  return `<span class="badge badge-${normalizedTone}">${escapeHtml(value)}</span>`;
}

export function modalTemplate() {
  return `
    <div class="app-modal" id="appModal" hidden>
      <div class="app-modal-backdrop" data-modal-close></div>
      <div class="app-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="appModalTitle">
        <header class="app-modal-header">
          <h3 id="appModalTitle">Modal</h3>
          <button type="button" class="btn btn-ghost" data-modal-close>Close</button>
        </header>
        <div class="app-modal-content" id="appModalContent"></div>
      </div>
    </div>
  `;
}

export function mountModalHandlers() {
  const modal = document.getElementById("appModal");
  if (!modal) {
    return;
  }

  modal.addEventListener("click", (event) => {
    if (!event.target.closest("[data-modal-close]")) {
      return;
    }

    modal.hidden = true;
  });
}

export function openModal(title, contentHtml) {
  const modal = document.getElementById("appModal");
  const titleNode = document.getElementById("appModalTitle");
  const contentNode = document.getElementById("appModalContent");

  if (!modal || !titleNode || !contentNode) {
    return;
  }

  titleNode.textContent = title || "Details";
  contentNode.innerHTML = contentHtml || "";
  modal.hidden = false;
}
