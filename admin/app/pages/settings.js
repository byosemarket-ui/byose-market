import { panel } from "../components/ui.js";
import { renderAdminProfilePanel } from "./settings-profile.js";
import { renderAdminSecurityPanel } from "./settings-security.js";
import { renderAdminPasswordPanel } from "./settings-password.js";
import { renderAdminGeneralPanel } from "./settings-general.js";
import { renderAdminBrandingPanel } from "./settings-branding.js";
import { renderAdminDeliveryPanel } from "./settings-delivery.js";
import { renderAdminPaymentPanel } from "./settings-payment.js";
import { renderAdminSeoPanel } from "./settings-seo.js";
import { renderAdminNotificationsPanel } from "./settings-notifications.js";
import { renderAdminLogoutPanel } from "./settings-logout.js";

function getSettingsPanel() {
  const hash = String(window.location.hash || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) {
    return "general";
  }

  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  const panelName = String(params.get("panel") || "general").trim().toLowerCase();
  return panelName || "general";
}

export async function renderSettings(container) {
  const activePanel = getSettingsPanel();

  if (activePanel === "profile") {
    await renderAdminProfilePanel(container);
    return;
  }

  if (activePanel === "security") {
    await renderAdminSecurityPanel(container);
    return;
  }

  if (activePanel === "password") {
    await renderAdminPasswordPanel(container);
    return;
  }

  if (activePanel === "branding") {
    await renderAdminBrandingPanel(container);
    return;
  }

  if (activePanel === "delivery") {
    await renderAdminDeliveryPanel(container);
    return;
  }

  if (activePanel === "payment") {
    await renderAdminPaymentPanel(container);
    return;
  }

  if (activePanel === "seo") {
    await renderAdminSeoPanel(container);
    return;
  }

  if (activePanel === "notifications") {
    await renderAdminNotificationsPanel(container);
    return;
  }

  if (activePanel === "logout" || activePanel === "sessions") {
    await renderAdminLogoutPanel(container);
    return;
  }

  if (activePanel === "general" || !activePanel) {
    await renderAdminGeneralPanel(container);
    return;
  }

  container.innerHTML = panel(
    "Admin Settings",
    "Configuration modules",
    `<p class="admin-profile-help">This settings panel is not available yet. Use General, Branding, Delivery, Payment, SEO, Notifications, Profile, Security, Password, or Logout & Sessions.</p>`
  );
}
