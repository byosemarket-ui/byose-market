import { emptyState, escapeHtml, panel } from "../components/ui.js";
import {
  createAdminDeliveryZone,
  deleteAdminDeliveryZone,
  getAdminDelivery,
  updateAdminDelivery,
  updateAdminDeliveryZone
} from "../services/admin-data.service.js";

const METHOD_FIELDS = [
  ["homeDelivery", "Home Delivery"],
  ["storePickup", "Store Pickup"],
  ["expressDelivery", "Express Delivery"],
  ["sameDayDelivery", "Same-Day Delivery"],
  ["scheduledDelivery", "Scheduled Delivery"]
];

const WEEKDAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"]
];

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function sectionCard(title, subtitle, body, wide = false) {
  return `
    <section class="admin-profile-card${wide ? " admin-profile-card-wide" : ""}">
      <header class="admin-profile-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${body}
    </section>
  `;
}

function money(value) {
  return `${Number(value || 0).toLocaleString("en-US")} RWF`;
}

function zoneRows(zones = []) {
  if (!zones.length) {
    return emptyState("No delivery zones yet. Add your first zone below.");
  }

  return `
    <div class="admin-delivery-zone-list">
      ${zones.map((zone) => `
        <article class="admin-delivery-zone" data-zone-id="${attr(zone.publicId)}">
          <div class="admin-delivery-zone-main">
            <div class="admin-delivery-zone-title">
              <strong>${escapeHtml(zone.name)}</strong>
              <span class="admin-profile-chip admin-profile-chip-${zone.enabled ? "success" : "danger"}">
                ${zone.enabled ? "Active" : "Disabled"}
              </span>
            </div>
            <p>${escapeHtml([zone.country, zone.provinceCity, zone.district, zone.sector, zone.cell, zone.village].filter(Boolean).join(" · ") || "Nationwide / broad match")}</p>
            <p>${escapeHtml(money(zone.fee))} · ETA ${escapeHtml(zone.estimatedDaysMin)}–${escapeHtml(zone.estimatedDaysMax)} days</p>
          </div>
          <div class="admin-delivery-zone-actions">
            <button class="btn btn-ghost" type="button" data-zone-toggle>${zone.enabled ? "Disable" : "Enable"}</button>
            <button class="btn btn-ghost" type="button" data-zone-edit>Edit</button>
            <button class="btn btn-ghost" type="button" data-zone-delete>Delete</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function deliveryMarkup(delivery) {
  const config = delivery?.config || {};
  const pricing = config.pricing || {};
  const methods = config.methods || {};
  const timing = config.timing || {};
  const coverage = delivery?.coverage || {};
  const zones = delivery?.zones || [];
  const selectedDays = new Set(timing.businessDays || []);

  return `
    <div class="admin-profile-page admin-delivery-page" id="adminDeliveryPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Fulfillment configuration</p>
            <h3>Delivery Settings</h3>
            <p class="admin-profile-username">Zones, pricing, methods, and delivery timing for checkout</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip">${escapeHtml(pricing.mode || "zone")} pricing</span>
              <span class="admin-profile-chip admin-profile-chip-success">${escapeHtml(coverage.activeZones || 0)} active zones</span>
              <span class="admin-profile-chip">${escapeHtml(money(pricing.fixedFee || 0))} fixed fallback</span>
            </div>
          </div>
        </div>
        <div class="admin-profile-hero-meta">
          <div class="admin-profile-meta-item"><span>Total Zones</span><strong>${escapeHtml(coverage.totalZones || 0)}</strong></div>
          <div class="admin-profile-meta-item"><span>Disabled</span><strong>${escapeHtml(coverage.disabledZones || 0)}</strong></div>
          <div class="admin-profile-meta-item"><span>Free Delivery From</span><strong>${escapeHtml(pricing.freeDeliveryThreshold ? money(pricing.freeDeliveryThreshold) : "Off")}</strong></div>
          <div class="admin-profile-meta-item"><span>Min Order</span><strong>${escapeHtml(pricing.minimumOrderAmount ? money(pricing.minimumOrderAmount) : "None")}</strong></div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard(
          "Delivery Coverage",
          "Active and disabled zones available for checkout matching.",
          `
            <div class="admin-delivery-coverage">
              <div class="admin-profile-meta-item"><span>Active Zones</span><strong>${escapeHtml(coverage.activeZones || 0)}</strong></div>
              <div class="admin-profile-meta-item"><span>Disabled Zones</span><strong>${escapeHtml(coverage.disabledZones || 0)}</strong></div>
              <div class="admin-profile-meta-item"><span>Availability</span><strong>${(coverage.activeZones || 0) > 0 ? "Delivering" : "Limited"}</strong></div>
            </div>
            ${zoneRows(zones)}
          `,
          true
        )}

        ${sectionCard(
          "Add / Edit Zone",
          "Match by country → province/city → district → sector → cell → village. More specific zones win.",
          `
            <form class="settings-form admin-delivery-zone-form" id="adminDeliveryZoneForm" novalidate>
              <input type="hidden" name="publicId" id="zonePublicId" value="" />
              <label><span>Zone Name</span><input name="name" required maxlength="120" placeholder="Kigali Metro" /><small class="field-error" data-error-for="name"></small></label>
              <label><span>Country</span><input name="country" maxlength="80" value="Rwanda" /></label>
              <label><span>Province / City</span><input name="provinceCity" maxlength="120" placeholder="Kigali" /></label>
              <label><span>District</span><input name="district" maxlength="120" /></label>
              <label><span>Sector</span><input name="sector" maxlength="120" /></label>
              <label><span>Cell</span><input name="cell" maxlength="120" /></label>
              <label><span>Village (optional)</span><input name="village" maxlength="120" /></label>
              <label><span>Delivery Fee (RWF)</span><input name="fee" type="number" min="0" step="100" value="2000" /></label>
              <label><span>ETA Min Days</span><input name="estimatedDaysMin" type="number" min="0" value="1" /></label>
              <label><span>ETA Max Days</span><input name="estimatedDaysMax" type="number" min="0" value="3" /></label>
              <label><span>Sort Order</span><input name="sortOrder" type="number" value="0" /></label>
              <label class="admin-delivery-span-2"><span>Notes</span><input name="notes" maxlength="240" /></label>
              <label class="admin-general-toggle admin-delivery-span-2">
                <span><strong>Enabled</strong><small>Only enabled zones are offered at checkout.</small></span>
                <input type="checkbox" name="enabled" checked />
              </label>
              <div class="admin-delivery-zone-form-actions admin-delivery-span-2">
                <button class="btn btn-primary" type="submit" id="zoneSaveBtn">Save Zone</button>
                <button class="btn btn-ghost" type="button" id="zoneResetBtn">Clear Form</button>
                <p id="zoneFormFeedback" class="form-feedback"></p>
              </div>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Delivery Pricing",
          "Fixed or zone-based fees, free delivery threshold, and order minimums.",
          `
            <form class="settings-form admin-delivery-config-form" id="adminDeliveryPricingForm">
              <label>
                <span>Pricing Mode</span>
                <select name="mode">
                  <option value="zone" ${pricing.mode === "zone" ? "selected" : ""}>Zone-based Delivery Fee</option>
                  <option value="fixed" ${pricing.mode === "fixed" ? "selected" : ""}>Fixed Delivery Fee</option>
                </select>
              </label>
              <label><span>Fixed Delivery Fee (RWF)</span><input name="fixedFee" type="number" min="0" step="100" value="${attr(pricing.fixedFee ?? 2000)}" /></label>
              <label><span>Free Delivery Threshold (RWF)</span><input name="freeDeliveryThreshold" type="number" min="0" step="100" value="${attr(pricing.freeDeliveryThreshold ?? 0)}" /></label>
              <label><span>Minimum Order Amount (RWF)</span><input name="minimumOrderAmount" type="number" min="0" step="100" value="${attr(pricing.minimumOrderAmount ?? 0)}" /></label>
              <label><span>Max Delivery Distance (km, optional)</span><input name="maxDeliveryDistanceKm" type="number" min="0" step="1" value="${attr(pricing.maxDeliveryDistanceKm ?? 0)}" /></label>
            </form>
          `,
          true
        )}

        ${sectionCard(
          "Delivery Methods",
          "Enable or disable checkout delivery options and optional fee modifiers.",
          `
            <div class="admin-delivery-methods" id="adminDeliveryMethods">
              ${METHOD_FIELDS.map(([key, label]) => {
                const method = methods[key] || {};
                return `
                  <label class="admin-general-toggle">
                    <span>
                      <strong>${escapeHtml(label)}</strong>
                      <small>Fee modifier (RWF)</small>
                      <input type="number" data-method-modifier="${attr(key)}" value="${attr(method.feeModifier ?? 0)}" step="100" />
                    </span>
                    <input type="checkbox" data-method-enabled="${attr(key)}" ${method.enabled ? "checked" : ""} />
                  </label>
                `;
              }).join("")}
            </div>
          `,
          true
        )}

        ${sectionCard(
          "Delivery Time",
          "Business days, hours, processing, and holiday exceptions.",
          `
            <form class="settings-form" id="adminDeliveryTimingForm">
              <div class="admin-delivery-days">
                ${WEEKDAYS.map(([value, label]) => `
                  <label class="admin-delivery-day">
                    <input type="checkbox" name="businessDays" value="${attr(value)}" ${selectedDays.has(value) ? "checked" : ""} />
                    <span>${escapeHtml(label)}</span>
                  </label>
                `).join("")}
              </div>
              <label><span>Delivery Hours Start</span><input name="deliveryHoursStart" type="time" value="${attr(timing.deliveryHoursStart || "08:00")}" /></label>
              <label><span>Delivery Hours End</span><input name="deliveryHoursEnd" type="time" value="${attr(timing.deliveryHoursEnd || "18:00")}" /></label>
              <label><span>Estimated Delivery Time</span><input name="estimatedDeliveryTime" maxlength="120" value="${attr(timing.estimatedDeliveryTime || "")}" /></label>
              <label><span>Processing Time</span><input name="processingTime" maxlength="120" value="${attr(timing.processingTime || "")}" /></label>
              <label class="admin-delivery-span-2">
                <span>Holiday Exceptions (comma-separated dates)</span>
                <input name="holidayExceptions" value="${attr((timing.holidayExceptions || []).join(", "))}" placeholder="2026-01-01, 2026-07-04" />
              </label>
            </form>
          `,
          true
        )}
      </div>

      <div class="admin-profile-form-actions admin-delivery-actions">
        <button class="btn btn-primary" type="button" id="adminDeliverySaveBtn">Save Delivery Settings</button>
        <button class="btn btn-ghost" type="button" id="adminDeliveryReloadBtn">Reload</button>
        <p id="adminDeliveryFeedback" class="form-feedback" role="status"></p>
      </div>
    </div>
  `;
}

function readZoneForm(form) {
  const data = new FormData(form);
  return {
    publicId: String(data.get("publicId") || "").trim(),
    name: String(data.get("name") || "").trim(),
    country: String(data.get("country") || "Rwanda").trim(),
    provinceCity: String(data.get("provinceCity") || "").trim(),
    district: String(data.get("district") || "").trim(),
    sector: String(data.get("sector") || "").trim(),
    cell: String(data.get("cell") || "").trim(),
    village: String(data.get("village") || "").trim(),
    fee: Number(data.get("fee") || 0),
    estimatedDaysMin: Number(data.get("estimatedDaysMin") || 1),
    estimatedDaysMax: Number(data.get("estimatedDaysMax") || 3),
    sortOrder: Number(data.get("sortOrder") || 0),
    notes: String(data.get("notes") || "").trim(),
    enabled: Boolean(form.querySelector('[name="enabled"]')?.checked)
  };
}

function fillZoneForm(form, zone) {
  if (!form || !zone) return;
  form.elements.namedItem("publicId").value = zone.publicId || "";
  form.elements.namedItem("name").value = zone.name || "";
  form.elements.namedItem("country").value = zone.country || "Rwanda";
  form.elements.namedItem("provinceCity").value = zone.provinceCity || "";
  form.elements.namedItem("district").value = zone.district || "";
  form.elements.namedItem("sector").value = zone.sector || "";
  form.elements.namedItem("cell").value = zone.cell || "";
  form.elements.namedItem("village").value = zone.village || "";
  form.elements.namedItem("fee").value = zone.fee ?? 2000;
  form.elements.namedItem("estimatedDaysMin").value = zone.estimatedDaysMin ?? 1;
  form.elements.namedItem("estimatedDaysMax").value = zone.estimatedDaysMax ?? 3;
  form.elements.namedItem("sortOrder").value = zone.sortOrder ?? 0;
  form.elements.namedItem("notes").value = zone.notes || "";
  const enabled = form.querySelector('[name="enabled"]');
  if (enabled) enabled.checked = zone.enabled !== false;
}

function collectConfigPayload(container) {
  const pricingForm = container.querySelector("#adminDeliveryPricingForm");
  const timingForm = container.querySelector("#adminDeliveryTimingForm");
  const pricingData = new FormData(pricingForm);
  const timingData = new FormData(timingForm);
  const businessDays = Array.from(timingForm.querySelectorAll('[name="businessDays"]:checked')).map((node) => node.value);
  const holidays = String(timingData.get("holidayExceptions") || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const methods = {};
  METHOD_FIELDS.forEach(([key]) => {
    methods[key] = {
      enabled: Boolean(container.querySelector(`[data-method-enabled="${key}"]`)?.checked),
      label: METHOD_FIELDS.find(([id]) => id === key)?.[1] || key,
      feeModifier: Number(container.querySelector(`[data-method-modifier="${key}"]`)?.value || 0)
    };
  });

  return {
    pricing: {
      mode: String(pricingData.get("mode") || "zone"),
      fixedFee: Number(pricingData.get("fixedFee") || 0),
      freeDeliveryThreshold: Number(pricingData.get("freeDeliveryThreshold") || 0),
      minimumOrderAmount: Number(pricingData.get("minimumOrderAmount") || 0),
      maxDeliveryDistanceKm: Number(pricingData.get("maxDeliveryDistanceKm") || 0)
    },
    methods,
    timing: {
      businessDays,
      deliveryHoursStart: String(timingData.get("deliveryHoursStart") || "08:00"),
      deliveryHoursEnd: String(timingData.get("deliveryHoursEnd") || "18:00"),
      estimatedDeliveryTime: String(timingData.get("estimatedDeliveryTime") || "").trim(),
      processingTime: String(timingData.get("processingTime") || "").trim(),
      holidayExceptions: holidays
    }
  };
}

function bindDeliveryPanel(container, delivery) {
  const feedback = container.querySelector("#adminDeliveryFeedback");
  const zoneForm = container.querySelector("#adminDeliveryZoneForm");
  const zoneFeedback = container.querySelector("#zoneFormFeedback");
  let current = delivery;

  async function reload() {
    await renderAdminDeliveryPanel(container);
  }

  zoneForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readZoneForm(zoneForm);
    zoneFeedback.textContent = "Saving zone...";
    try {
      if (payload.publicId) {
        await updateAdminDeliveryZone(payload.publicId, payload);
      } else {
        await createAdminDeliveryZone(payload);
      }
      zoneFeedback.textContent = "Zone saved.";
      await reload();
    } catch (error) {
      zoneFeedback.textContent = error?.message || "Unable to save zone.";
    }
  });

  container.querySelector("#zoneResetBtn")?.addEventListener("click", () => {
    zoneForm?.reset();
    if (zoneForm?.elements.namedItem("publicId")) {
      zoneForm.elements.namedItem("publicId").value = "";
    }
    const enabled = zoneForm?.querySelector('[name="enabled"]');
    if (enabled) enabled.checked = true;
  });

  container.querySelectorAll("[data-zone-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const zoneId = button.closest("[data-zone-id]")?.getAttribute("data-zone-id");
      const zone = (current.zones || []).find((entry) => entry.publicId === zoneId);
      if (zone) fillZoneForm(zoneForm, zone);
    });
  });

  container.querySelectorAll("[data-zone-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-zone-id]");
      const zoneId = card?.getAttribute("data-zone-id");
      const zone = (current.zones || []).find((entry) => entry.publicId === zoneId);
      if (!zone) return;
      try {
        await updateAdminDeliveryZone(zoneId, { ...zone, enabled: !zone.enabled });
        await reload();
      } catch (error) {
        if (feedback) feedback.textContent = error?.message || "Unable to update zone.";
      }
    });
  });

  container.querySelectorAll("[data-zone-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const zoneId = button.closest("[data-zone-id]")?.getAttribute("data-zone-id");
      if (!zoneId || !window.confirm("Delete this delivery zone?")) return;
      try {
        await deleteAdminDeliveryZone(zoneId);
        await reload();
      } catch (error) {
        if (feedback) feedback.textContent = error?.message || "Unable to delete zone.";
      }
    });
  });

  container.querySelector("#adminDeliverySaveBtn")?.addEventListener("click", async () => {
    feedback.textContent = "Saving delivery settings...";
    feedback.classList.remove("is-error", "is-success");
    try {
      current = await updateAdminDelivery(collectConfigPayload(container));
      feedback.textContent = "Delivery settings saved successfully.";
      feedback.classList.add("is-success");
      container.innerHTML = panel(
        "Admin Settings",
        "Delivery zones, pricing, methods, and timing",
        deliveryMarkup(current)
      );
      bindDeliveryPanel(container, current);
    } catch (error) {
      feedback.textContent = error?.message || "Unable to save delivery settings.";
      feedback.classList.add("is-error");
    }
  });

  container.querySelector("#adminDeliveryReloadBtn")?.addEventListener("click", reload);
}

export async function renderAdminDeliveryPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading delivery settings...",
    `<p class="admin-profile-help">Fetching delivery configuration…</p>`
  );

  try {
    const delivery = await getAdminDelivery({ force: true });
    container.innerHTML = panel(
      "Admin Settings",
      "Delivery zones, pricing, methods, and timing",
      deliveryMarkup(delivery)
    );
    bindDeliveryPanel(container, delivery);
  } catch (error) {
    container.innerHTML = panel(
      "Admin Settings",
      "Delivery configuration",
      emptyState(error?.message || "Unable to load delivery settings.")
    );
  }
}
