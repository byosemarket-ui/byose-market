export const DRAFT_STORAGE_KEY = "byose-admin-product-wizard-v6";
export const FALLBACK_IMAGE = "../img/logo.png";
export const DETAIL_PAGE_PATH = "../product-details1.html";

export const CATEGORY_OPTIONS = [
  { value: "fashion", labelRw: "Imyenda", labelEn: "Fashion & Clothing" },
  { value: "shoes", labelRw: "Inkweto", labelEn: "Shoes" },
  { value: "phones", labelRw: "Telefoni", labelEn: "Phones" },
  { value: "electronics", labelRw: "Ibikoresho bya elegitoroniki", labelEn: "Electronics" },
  { value: "bags", labelRw: "Agafuka", labelEn: "Bags" },
  { value: "watches", labelRw: "Amaso y'igihe", labelEn: "Watches" },
  { value: "general", labelRw: "Ibindi", labelEn: "General" }
];

export const SIZE_PRESETS = {
  fashion: ["XS", "S", "M", "L", "XL", "XXL"],
  shoes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
  default: ["One Size"]
};

export const STOCK_STATUS_OPTIONS = [
  { value: "in_stock", labelRw: "Ihari", labelEn: "In Stock" },
  { value: "limited_stock", labelRw: "Stock Nto", labelEn: "Limited Stock" },
  { value: "low_stock", labelRw: "Stock Nkeya", labelEn: "Low Stock" },
  { value: "out_of_stock", labelRw: "Byarangiye", labelEn: "Out of Stock" }
];

export const WIZARD_STEPS = [
  { id: "info", labelRw: "Amakuru y'ibanze", labelEn: "Basic Information", shortRw: "Amakuru", shortEn: "Basic" },
  { id: "pricing", labelRw: "Ibiciro", labelEn: "Pricing", shortRw: "Igiciro", shortEn: "Price" },
  { id: "inventory", labelRw: "Ububiko", labelEn: "Inventory", shortRw: "Stock", shortEn: "Stock" },
  { id: "description", labelRw: "Ibisobanuro", labelEn: "Description", shortRw: "Desc", shortEn: "Desc" },
  { id: "media", labelRw: "Amafoto", labelEn: "Media", shortRw: "Media", shortEn: "Media" },
  { id: "publish", labelRw: "Gusohora", labelEn: "Publishing", shortRw: "Gusohora", shortEn: "Publish" },
  { id: "review", labelRw: "Gusuzuma", labelEn: "Review", shortRw: "Review", shortEn: "Review" }
];

export const VISIBILITY_OPTIONS = [
  { value: "both", labelRw: "Homepage na Shop", labelEn: "Homepage & Shop" },
  { value: "home", labelRw: "Homepage Gusa", labelEn: "Homepage Only" },
  { value: "shop", labelRw: "Shop Gusa", labelEn: "Shop Only" }
];

/** Curated storefront sections (homepage/shop visibility is controlled separately). */
export const PLACEMENT_OPTIONS = [
  { value: "featured_products", labelRw: "Product Zihariye", labelEn: "Featured Products" },
  { value: "best_sellers", labelRw: "Byagurishije Cyane", labelEn: "Best Sellers" },
  { value: "fresh_picks", labelRw: "Ibyatoranyijwe Bishya", labelEn: "Fresh Picks" },
  { value: "new_arrivals", labelRw: "Ibipya", labelEn: "New Arrivals" },
  { value: "recommended_products", labelRw: "Byasabwe", labelEn: "Recommended Products" },
  { value: "flash_deals", labelRw: "Deals vuba", labelEn: "Flash Deals" }
];

export const POSITION_MODE_OPTIONS = [
  { value: "automatic", labelRw: "Bikora mu buryo bwikora", labelEn: "Automatic" },
  { value: "top", labelRw: "Hejuru", labelEn: "Top" },
  { value: "middle", labelRw: "Hagati", labelEn: "Middle" },
  { value: "bottom", labelRw: "Hasi", labelEn: "Bottom" }
];

export const PRIORITY_SCORE_PRESETS = [
  { value: 100, labelRw: "Hejuru cyane", labelEn: "Highest (100)" },
  { value: 50, labelRw: "Hagati", labelEn: "Medium (50)" },
  { value: 10, labelRw: "Hasi", labelEn: "Low (10)" }
];

export const PRODUCT_TYPE_OPTIONS = [
  { value: "simple", labelRw: "Yoroshye", labelEn: "Simple Product" },
  { value: "variable", labelRw: "Ifite Amahitamo", labelEn: "Variable Product" },
  { value: "digital", labelRw: "ya Digital", labelEn: "Digital Product" },
  { value: "service", labelRw: "Serivisi", labelEn: "Service" },
  { value: "bundle", labelRw: "Zifatanyijwe", labelEn: "Bundle Product" }
];

export const PRODUCT_CONDITION_OPTIONS = [
  { value: "new", labelRw: "Nshya", labelEn: "New" },
  { value: "used", labelRw: "Yakoreshejwe", labelEn: "Used" },
  { value: "refurbished", labelRw: "Yongeye Gukorwa", labelEn: "Refurbished" }
];

export const PRODUCT_STATUS_OPTIONS = [
  { value: "active", labelRw: "Iracyakoreshwa", labelEn: "Active" },
  { value: "draft", labelRw: "Igitekerezo", labelEn: "Draft" },
  { value: "inactive", labelRw: "Iraboneka Gusa", labelEn: "Inactive" }
];

export const COUNTRY_OF_ORIGIN_OPTIONS = [
  "China",
  "Turkey",
  "Vietnam",
  "USA",
  "Rwanda",
  "India",
  "Kenya",
  "UAE",
  "Other"
];

export const WARRANTY_OPTIONS = [
  { value: "none", labelRw: "Nta Garanti", labelEn: "No Warranty" },
  { value: "1_month", labelRw: "Ukwezi 1", labelEn: "1 Month" },
  { value: "3_months", labelRw: "Amezi 3", labelEn: "3 Months" },
  { value: "6_months", labelRw: "Amezi 6", labelEn: "6 Months" },
  { value: "1_year", labelRw: "Umwaka 1", labelEn: "1 Year" },
  { value: "custom", labelRw: "Indi Garanti", labelEn: "Custom Warranty" }
];

export const CURRENCY_OPTIONS = [
  { value: "RWF", labelRw: "RWF", labelEn: "RWF (Rwandan Franc)" },
  { value: "USD", labelRw: "USD", labelEn: "USD (US Dollar)" },
  { value: "EUR", labelRw: "EUR", labelEn: "EUR (Euro)" }
];
