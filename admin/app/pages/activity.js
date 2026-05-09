import { badge, emptyState, formatDate, loadingState, panel, statCard, table } from "../components/ui.js";
import { getActivityLogs } from "../services/admin-data.service.js";

function levelTone(level) {
  const v = String(level || "").toLowerCase();
  if (v === "error" || v === "critical") return "danger";
  if (v === "warn" || v === "warning") return "warn";
  if (v === "info") return "neutral";
  return "neutral";
}

export async function renderActivity(container) {
  container.innerHTML = loadingState("Loading activity logs...");
  const allLogs = await getActivityLogs();

  const state = { eventType: "all", level: "all", query: "", page: 0 };
  const PAGE_SIZE = 60;

  const allTypes = [...new Set(allLogs.map((e) => e?.event || e?.type || "event").filter(Boolean))].sort();
  const allLevels = [...new Set(allLogs.map((e) => e?.level).filter(Boolean))].sort();

  function filtered() {
    return allLogs.filter((entry) => {
      const etype = entry?.event || entry?.type || "event";
      const elevel = entry?.level || "info";
      if (state.eventType !== "all" && etype !== state.eventType) return false;
      if (state.level !== "all" && elevel !== state.level) return false;
      if (state.query) {
        const q = state.query.toLowerCase();
        const detail = JSON.stringify(entry?.detail || entry?.metadata || {}).toLowerCase();
        if (!etype.toLowerCase().includes(q) && !detail.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const records = filtered();
    const start = state.page * PAGE_SIZE;
    const page = records.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(records.length / PAGE_SIZE);

    const errors = allLogs.filter((e) => String(e?.level || "").toLowerCase().includes("error")).length;
    const warnings = allLogs.filter((e) => String(e?.level || "").toLowerCase().includes("warn")).length;
    const recents = allLogs.slice(0, 5);

    const stats = `
      <section class="stats-grid">
        ${statCard("Total Events", String(allLogs.length), "All activity logs")}
        ${statCard("Filtered", String(records.length), "Current filters")}
        ${statCard("Errors", String(errors), "Error-level events")}
        ${statCard("Warnings", String(warnings), "Warning-level events")}
      </section>
    `;

    const livePanel = `
      <div class="live-activity-feed">
        <p class="feed-label">Latest Events</p>
        ${recents.map((entry) => `
          <div class="feed-entry">
            <span>${badge(entry?.level || "info", levelTone(entry?.level))}</span>
            <span class="feed-event">${entry?.event || entry?.type || "event"}</span>
            <span class="feed-time">${formatDate(entry?.timestamp || entry?.createdAt)}</span>
          </div>
        `).join("")}
      </div>
    `;

    const typeOptions = allTypes.map((t) => `<option value="${t}">${t}</option>`).join("");
    const levelOptions = allLevels.map((l) => `<option value="${l}">${l}</option>`).join("");

    const toolbar = `
      <div class="filter-toolbar">
        <label><span>Search</span><input id="actSearch" type="search" value="${state.query.replace(/"/g, "&quot;")}" placeholder="Event type or detail" /></label>
        <label><span>Event Type</span>
          <select id="actType">
            <option value="all">All types</option>
            ${typeOptions}
          </select>
        </label>
        <label><span>Level</span>
          <select id="actLevel">
            <option value="all">All levels</option>
            ${levelOptions}
          </select>
        </label>
      </div>
    `;

    const rows = page.map((entry) => [
      entry?.event || entry?.type || "event",
      { html: badge(entry?.level || "info", levelTone(entry?.level)) },
      formatDate(entry?.timestamp || entry?.createdAt),
      JSON.stringify(entry?.detail || entry?.metadata || {}).slice(0, 120)
    ]);

    const pagination = totalPages > 1 ? `
      <div class="pagination-row">
        <button class="btn btn-secondary" type="button" id="actPrev" ${state.page === 0 ? "disabled" : ""}>← Previous</button>
        <span>Page ${state.page + 1} of ${totalPages} (${records.length} events)</span>
        <button class="btn btn-secondary" type="button" id="actNext" ${state.page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
      </div>
    ` : `<p class="table-count">${records.length} events</p>`;

    const content = rows.length
      ? table(["Event", "Level", "Date", "Detail"], rows) + pagination
      : emptyState("No activity logs match the current filters.");

    container.innerHTML = `
      ${stats}
      ${panel("Live Monitoring", "Real-time event feed", livePanel)}
      ${panel("Activity Logs", "Operational and sync events — filterable event log", toolbar + content)}
    `;

    const searchInput = container.querySelector("#actSearch");
    const typeFilter = container.querySelector("#actType");
    const levelFilter = container.querySelector("#actLevel");
    if (typeFilter) typeFilter.value = state.eventType;
    if (levelFilter) levelFilter.value = state.level;

    searchInput?.addEventListener("input", () => { state.query = searchInput.value; state.page = 0; render(); });
    typeFilter?.addEventListener("change", () => { state.eventType = typeFilter.value; state.page = 0; render(); });
    levelFilter?.addEventListener("change", () => { state.level = levelFilter.value; state.page = 0; render(); });
    container.querySelector("#actPrev")?.addEventListener("click", () => { state.page--; render(); });
    container.querySelector("#actNext")?.addEventListener("click", () => { state.page++; render(); });
  }

  render();
}
