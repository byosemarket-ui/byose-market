import { getProductById, getProducts } from "../../services/admin-data.service.js";
import { errorState } from "../../components/ui.js";
import { migrateLegacyStoredApiBase } from "../../../../services/api-origin.js";
import { createDefaultDraft, readDraft, writeDraft } from "./draft.js";
import { renderProductListMarkup, mountProductList } from "./list.js";
import { mountProductWizard } from "./wizard.js";
import { mountProductEditor } from "./edit.js";
import { getProductsView, getRouteProductId } from "./utils.js";

function renderEditLoadError(message) {
  return `
    <div class="pm-shell">
      <section class="pm-hero card">
        <div class="pm-hero-copy">
          <p class="pm-kicker">Hindura Product / Edit Product</p>
          <h1>Product Manager</h1>
          <p>The selected product could not be loaded for editing.</p>
        </div>
        <div class="pm-hero-actions">
          <a class="pm-btn pm-btn-secondary" href="#/products">Back to Catalog</a>
        </div>
      </section>
      ${errorState(message)}
    </div>
  `;
}

function startNewProductDraft() {
  const existing = readDraft();
  if (existing.productId || existing.savedProductId) {
    const fresh = createDefaultDraft();
    writeDraft(fresh);
    return fresh;
  }
  return existing;
}

export async function renderProducts(container, context = {}) {
  const view = getProductsView();
  const routeProductId = getRouteProductId();
  const isEditView = view === "edit" || (view === "create" && Boolean(routeProductId));

  if (isEditView && context?.softRefresh && container.querySelector("[data-product-editor]")) {
    return;
  }

  if (view === "create" && !routeProductId && context?.softRefresh && container.querySelector("[data-product-wizard]")) {
    return;
  }

  if (isEditView) {
    migrateLegacyStoredApiBase();
    if (!routeProductId) {
      container.innerHTML = renderEditLoadError("No product was selected for editing.");
      return;
    }

    try {
      const product = await getProductById(routeProductId);
      if (!product) {
        container.innerHTML = renderEditLoadError("Product not found. It may have been deleted.");
        return;
      }

      mountProductEditor(container, product);
    } catch (error) {
      const rawMessage = String(error?.message || "").trim();
      container.innerHTML = renderEditLoadError(
        rawMessage || "Live product data could not be loaded. Return to the catalog and try again."
      );
    }
    return;
  }

  if (view === "create") {
    migrateLegacyStoredApiBase();
    mountProductWizard(container, startNewProductDraft());
    return;
  }

  let products = [];
  let productsError = "";

  try {
    products = await getProducts({ force: true, allowCacheFallback: true });
  } catch (error) {
    const rawMessage = String(error?.message || "").trim();
    productsError = /404|failed|network|fetch|request/i.test(rawMessage)
      ? "Live catalog snapshot is unavailable. You can still create products when the backend is reachable."
      : rawMessage || "Live catalog data could not be loaded.";
  }

  container.innerHTML = renderProductListMarkup(products, productsError);
  mountProductList(container, products, async () => {
    const refreshed = await getProducts({ force: true, allowCacheFallback: true });
    container.innerHTML = renderProductListMarkup(refreshed, productsError);
    mountProductList(container, refreshed, () => undefined);
  });
}
