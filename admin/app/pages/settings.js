import { emptyState, panel } from "../components/ui.js";
import { getSettings, updateSettings } from "../services/admin-data.service.js";

function settingsForm(settings) {
  return `
    <form class="settings-form" id="settingsForm">
      <label>
        <span>Store Name</span>
        <input name="storeName" type="text" value="${String(settings?.storeName || "").replace(/\"/g, "&quot;")}" />
      </label>
      <label>
        <span>Support Email</span>
        <input name="supportEmail" type="email" value="${String(settings?.supportEmail || "").replace(/\"/g, "&quot;")}" />
      </label>
      <label>
        <span>Support Phone</span>
        <input name="supportPhone" type="text" value="${String(settings?.supportPhone || "").replace(/\"/g, "&quot;")}" />
      </label>
      <label>
        <span>Default Currency</span>
        <input name="currency" type="text" value="${String(settings?.currency || "RWF").replace(/\"/g, "&quot;")}" />
      </label>
      <button class="btn btn-primary" type="submit">Save Settings</button>
      <p id="settingsFeedback" class="form-feedback"></p>
    </form>
  `;
}

export async function renderSettings(container) {
  const settings = await getSettings();

  container.innerHTML = panel(
    "Settings",
    "Centralized admin preferences and store configuration",
    settingsForm(settings)
  );

  const form = document.getElementById("settingsForm");
  const feedback = document.getElementById("settingsFeedback");

  if (!form || !feedback) {
    container.insertAdjacentHTML("beforeend", emptyState("Unable to mount settings form."));
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      storeName: String(formData.get("storeName") || "").trim(),
      supportEmail: String(formData.get("supportEmail") || "").trim(),
      supportPhone: String(formData.get("supportPhone") || "").trim(),
      currency: String(formData.get("currency") || "RWF").trim() || "RWF"
    };

    feedback.textContent = "Saving settings...";

    try {
      await updateSettings(payload);
      feedback.textContent = "Settings saved successfully.";
    } catch (error) {
      feedback.textContent = error?.message || "Unable to save settings right now.";
    }
  });
}
