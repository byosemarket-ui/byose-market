import { badge, emptyState, formatCurrency, formatDate, panel, table } from "../../components/ui.js";
import { deleteProductAndSync } from "../../services/admin-data.service.js";
import { buildCreateHash, escapeHtml, toLabel } from "./utils.js";

function getProductIdentity(product) {
  return String(product?.id || product?.catalogId || "").trim();
}

function stockTone(stock) {
  const value = Number(stock || 0);
  if (value <= 0) {
    return "danger";
  }
  if (value <= 5) {
    return "warn";
  }
  return "success";
}

export function renderProductListMarkup(products = [], errorMessage = "") {
  const total = products.length;
  const lowStock = products.filter((product) => Number(product.stock || 0) <= 5).length;

  return `
    <div class="pm-shell">
      <section class="pm-hero card">
        <div class="pm-hero-copy">
          <p class="pm-kicker">Catalog Management</p>
          <h1>Products</h1>
          <p>Manage live inventory, pricing, media, and storefront visibility from one professional workspace.</p>
        </div>
        <div class="pm-hero-actions">
          <a class="pm-btn pm-btn-primary" href="${buildCreateHash("info")}">Add Product</a>
        </div>
      </section>

      ${errorMessage ? `<div class="pm-alert pm-alert-warn">${escapeHtml(errorMessage)}</div>` : ""}

      <section class="pm-stats">
        <article class="pm-stat card"><span>Total Products</span><strong>${total}</strong></article>
        <article class="pm-stat card"><span>Low Stock</span><strong>${lowStock}</strong></article>
        <article class="pm-stat card"><span>Live Sync</span><strong>Active</strong></article>
      </section>

      <section class="card pm-panel">
        <header class="pm-panel-head">
          <div>
            <h2>Product Catalog</h2>
            <p>Recently synced products from the backend API.</p>
          </div>
          <a class="pm-btn pm-btn-secondary" href="${buildCreateHash("info")}">Create New</a>
        </header>
        <div class="pm-panel-body" data-product-list-body>
          ${products.length ? "" : emptyState("No products yet. Create your first product to populate the storefront.")}
        </div>
      </section>
    </div>
  `;
}

export function renderProductTable(products = []) {
  if (!products.length) {
    return emptyState("No products found.");
  }

  const rows = products.slice(0, 100).map((product) => {
    const id = getProductIdentity(product);
    const image = product.mainImage || product.image || "../img/logo.png";
    return [
      { html: `<div class="pm-table-product"><img src="${escapeHtml(image)}" alt="" loading="lazy" /><div><strong>${escapeHtml(product.name || "Product")}</strong><small>${escapeHtml(product.sku || id || "-")}</small></div></div>` },
      toLabel(product.category || "general"),
      formatCurrency(product.price || 0),
      { html: badge(String(product.stock ?? 0), stockTone(product.stock)) },
      formatDate(product.updatedAt || product.createdAt),
      {
        html: `
          <div class="pm-row-actions">
            <a class="pm-btn pm-btn-ghost" href="${buildCreateHash("info", id)}">Edit</a>
            <button type="button" class="pm-btn pm-btn-danger" data-delete-product="${escapeHtml(id)}">Delete</button>
          </div>
        `
      }
    ];
  });

  return table(["Product", "Category", "Price", "Stock", "Updated", "Actions"], rows);
}

export function mountProductList(container, products, onRefresh) {
  const body = container.querySelector("[data-product-list-body]");
  if (!body) {
    return;
  }

  body.innerHTML = renderProductTable(products);

  body.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = button.getAttribute("data-delete-product");
      const matched = products.find((product) => getProductIdentity(product) === productId);
      const confirmed = window.confirm(`Delete ${matched?.name || "this product"} from the live catalog?`);
      if (!confirmed) {
        return;
      }

      try {
        button.disabled = true;
        await deleteProductAndSync(productId);
        if (typeof onRefresh === "function") {
          await onRefresh();
        }
      } catch (error) {
        button.disabled = false;
        window.alert(String(error?.message || "Unable to delete the product."));
      }
    });
  });
}
