export const DRAFT_STORAGE_KEY = "byose-admin-product-wizard-v3";
export const FALLBACK_IMAGE = "../img/logo.png";
export const DETAIL_PAGE_PATH = "../product-details1.html";

export const CATEGORY_OPTIONS = [
  "fashion",
  "electronics",
  "shoes",
  "bags",
  "watches",
  "phones",
  "general"
];

export const SIZE_PRESETS = {
  fashion: ["XS", "S", "M", "L", "XL", "XXL"],
  shoes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
  default: ["One Size"]
};

export const STOCK_STATUS_OPTIONS = [
  { value: "in_stock", label: "In Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "preorder", label: "Pre-order" }
];

export const WIZARD_STEPS = [
  { id: "info", label: "Product Info", short: "Info" },
  { id: "pricing", label: "Pricing", short: "Price" },
  { id: "inventory", label: "Inventory", short: "Stock" },
  { id: "media", label: "Media", short: "Media" },
  { id: "seo", label: "SEO", short: "SEO" },
  { id: "review", label: "Review", short: "Review" }
];

export const VISIBILITY_OPTIONS = [
  { value: "both", label: "Homepage & Shop" },
  { value: "home", label: "Homepage Only" },
  { value: "shop", label: "Shop Only" }
];
