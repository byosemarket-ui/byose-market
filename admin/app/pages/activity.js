import { emptyState, formatDate, panel, table } from "../components/ui.js";
import { getActivityLogs } from "../services/admin-data.service.js";

export async function renderActivity(container) {
  const logs = await getActivityLogs();

  if (!logs.length) {
    container.innerHTML = panel("Activity Logs", "Operational and sync events", emptyState("No activity logs available."));
    return;
  }

  const rows = logs.slice(0, 80).map((entry) => [
    entry?.event || entry?.type || "event",
    entry?.level || "info",
    formatDate(entry?.timestamp || entry?.createdAt),
    JSON.stringify(entry?.detail || entry?.metadata || {}).slice(0, 120)
  ]);

  container.innerHTML = panel(
    "Activity Logs",
    "Foundation for realtime monitoring and diagnostics",
    table(["Event", "Level", "Date", "Detail"], rows)
  );
}
