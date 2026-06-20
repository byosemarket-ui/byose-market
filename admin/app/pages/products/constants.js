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
  { value: "limited_stock", label: "Limited Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" }
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
  { value: "both", label: "Homepage & Shop", labelRw: "Homepage na Shop", labelEn: "Homepage & Shop" },
  { value: "home", label: "Homepage Only", labelRw: "Homepage gusa", labelEn: "Homepage Only" },
  { value: "shop", label: "Shop Only", labelRw: "Shop gusa", labelEn: "Shop Only" }
];

export const PRODUCT_TYPE_OPTIONS = [
  { value: "simple", labelRw: "Product yoroshye", labelEn: "Simple Product" },
  { value: "variable", labelRw: "Product ifite amahitamo", labelEn: "Variable Product" },
  { value: "digital", labelRw: "Product ya digital", labelEn: "Digital Product" },
  { value: "service", labelRw: "Serivisi", labelEn: "Service" },
  { value: "bundle", labelRw: "Product zifatanyijwe", labelEn: "Bundle Product" }
];

export const PRODUCT_CONDITION_OPTIONS = [
  { value: "new", labelRw: "Nshya", labelEn: "New" },
  { value: "used", labelRw: "Yakoreshejwe", labelEn: "Used" },
  { value: "refurbished", labelRw: "Yongeye gukorwa", labelEn: "Refurbished" }
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
  { value: "none", labelRw: "Nta garanti", labelEn: "No Warranty" },
  { value: "1_month", labelRw: "Ukwezi 1", labelEn: "1 Month" },
  { value: "3_months", labelRw: "Amezi 3", labelEn: "3 Months" },
  { value: "6_months", labelRw: "Amezi 6", labelEn: "6 Months" },
  { value: "1_year", labelRw: "Umwaka 1", labelEn: "1 Year" },
  { value: "custom", labelRw: "Indi garanti", labelEn: "Custom" }
];

export const PLACEMENT_OPTIONS = [
  { value: "all", labelRw: "Ahantu hose", labelEn: "All Locations" },
  { value: "homepage", labelRw: "Homepage", labelEn: "Homepage" },
  { value: "shop", labelRw: "Shop Page", labelEn: "Shop Page" },
  { value: "featured", labelRw: "Featured Products", labelEn: "Featured Products" },
  { value: "best_sellers", labelRw: "Best Sellers", labelEn: "Best Sellers" },
  { value: "fresh_picks", labelRw: "Fresh Picks", labelEn: "Fresh Picks" },
  { value: "new_arrivals", labelRw: "New Arrivals", labelEn: "New Arrivals" },
  { value: "recommended", labelRw: "Recommended Products", labelEn: "Recommended Products" },
  { value: "flash_deals", labelRw: "Flash Deals", labelEn: "Flash Deals" }
];

export const POSITION_MODE_OPTIONS = [
  { value: "automatic", labelRw: "Automatic", labelEn: "Automatic" },
  { value: "top", labelRw: "Hejuru / Top", labelEn: "Top" },
  { value: "middle", labelRw: "Hagati / Middle", labelEn: "Middle" },
  { value: "bottom", labelRw: "Hasi / Bottom", labelEn: "Bottom" }
];

export const FEATURED_FLAG_OPTIONS = [
  { value: "featuredHomepage", labelRw: "Garagaza kuri Homepage", labelEn: "Show on Homepage" },
  { value: "featuredProducts", labelRw: "Garagaza mu Featured Products", labelEn: "Show in Featured Products" },
  { value: "featuredBestSellers", labelRw: "Garagaza mu Best Sellers", labelEn: "Show in Best Sellers" },
  { value: "featuredFreshPicks", labelRw: "Garagaza mu Fresh Picks", labelEn: "Show in Fresh Picks" }
];

export const CURRENCY_OPTIONS = [
  { value: "RWF", labelRw: "RWF", labelEn: "RWF (Rwandan Franc)" },
  { value: "USD", labelRw: "USD", labelEn: "USD (US Dollar)" },
  { value: "EUR", labelRw: "EUR", labelEn: "EUR (Euro)" }
];

export const SEO_SEARCH_VISIBILITY_OPTIONS = [
  { value: "homepage_shop", labelRw: "Homepage + Shop", labelEn: "Homepage + Shop" },
  { value: "shop_only", labelRw: "Shop gusa", labelEn: "Shop Only" },
  { value: "search_only", labelRw: "Gushakisha gusa", labelEn: "Search Only" },
  { value: "featured", labelRw: "Featured Products", labelEn: "Featured Products" },
  { value: "hidden", labelRw: "Bihishe", labelEn: "Hidden" }
];
