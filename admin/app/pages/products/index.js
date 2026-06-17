import { getProducts } from "../../services/admin-data.service.js";
import { migrateLegacyStoredApiBase } from "../../../../services/api-origin.js";
import { readDraft, hydrateDraftFromProduct, writeDraft } from "./draft.js";
import { renderProductListMarkup, mountProductList } from "./list.js";
import { mountProductWizard } from "./wizard.js";
import { getProductsView, getRouteProductId } from "./utils.js";

export async function renderProducts(container, context = {}) {
  if (getProductsView() === "create" && context?.softRefresh && container.querySelector("[data-product-wizard]")) {
    return;
  }

  let products = [];
  let productsError = "";

  try {
    products = await getProducts({ preferCache: true, allowCacheFallback: true });
  } catch (error) {
    const rawMessage = String(error?.message || "").trim();
    productsError = /404|failed|network|fetch|request/i.test(rawMessage)
      ? "Live catalog snapshot is unavailable. You can still create products when the backend is reachable."
      : rawMessage || "Live catalog data could not be loaded.";
  }

  if (getProductsView() === "create") {
    migrateLegacyStoredApiBase();

    let draft = readDraft();
    const routeProductId = getRouteProductId(draft.productId || draft.savedProductId);

    if (routeProductId) {
      const matchedProduct = products.find((product) => String(product.id || product.catalogId) === routeProductId);
      if (matchedProduct) {
        draft = hydrateDraftFromProduct(matchedProduct);
        draft.productId = routeProductId;
        draft.savedProductId = routeProductId;
        writeDraft(draft);
      }
    }

    mountProductWizard(container, draft);
    return;
  }

  container.innerHTML = renderProductListMarkup(products, productsError);
  mountProductList(container, products, async () => {
    const refreshed = await getProducts({ force: true, allowCacheFallback: true });
    container.innerHTML = renderProductListMarkup(refreshed, productsError);
    mountProductList(container, refreshed, () => undefined);
  });
}
