/**
 * Storefront settings consumer — loads public platform settings and applies them
 * to elements marked with data-store-setting / data-store-href / data-store-attr.
 */
(function storefrontSettingsBootstrap(global) {
  if (!global || global.ByoseStoreSettingsLoader) {
    return;
  }

  var CACHE_KEY = "byose_public_settings_v1";
  var CACHE_TTL_MS = 30 * 1000;
  var defaults = {
    storeName: "BYOSE Market",
    companyName: "BYOSE Market Ltd",
    supportEmail: "byosemarket@gmail.com",
    supportPhone: "+250780430710",
    whatsappNumber: "+250723731250",
    whatsappContact: "+250723731250",
    customerServicePhone: "+250780430710",
    defaultSupportEmail: "byosemarket@gmail.com",
    companyAddress: "",
    country: "Rwanda",
    provinceCity: "Kigali",
    websiteUrl: "https://byosemarket.com",
    currency: "RWF",
    currencySymbol: "RWF",
    language: "en",
    timeZone: "Africa/Kigali",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    numberFormat: "en-US",
    maintenanceMode: false,
    storeStatus: "open",
    allowCustomerRegistration: true,
    allowGuestCheckout: true,
    businessHours: "Mon–Sat 08:00–18:00",
    emergencyContact: ""
  };

  function resolveApiBase() {
    var base = String(global.BYOSE_API_BASE_URL || "").trim().replace(/\/+$/, "");
    if (base) return base;
    if (global.location && /^(https?:)/i.test(global.location.protocol)) {
      return String(global.location.origin || "").replace(/\/+$/, "") + "/api";
    }
    return "/api";
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function displayPhone(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var digits = digitsOnly(raw);
    if (digits.indexOf("250") === 0 && digits.length >= 12) {
      return "0" + digits.slice(3, 6) + " " + digits.slice(6, 9) + " " + digits.slice(9, 12);
    }
    return raw;
  }

  function telHref(value) {
    var digits = digitsOnly(value);
    if (!digits) return "#";
    if (digits.charAt(0) === "0" && digits.length === 10) {
      return "tel:+250" + digits.slice(1);
    }
    if (digits.indexOf("250") === 0) {
      return "tel:+" + digits;
    }
    return "tel:+" + digits;
  }

  function waHref(value, message) {
    var digits = digitsOnly(value);
    if (!digits) return "#";
    if (digits.charAt(0) === "0" && digits.length === 10) {
      digits = "250" + digits.slice(1);
    }
    var url = "https://wa.me/" + digits;
    if (message) {
      url += "?text=" + encodeURIComponent(message);
    }
    return url;
  }

  function locationLabel(settings) {
    var city = String(settings.provinceCity || "").trim();
    var country = String(settings.country || "").trim();
    if (city && country) return city + ", " + country;
    return city || country || "Rwanda";
  }

  function mapsHref(settings) {
    var query = encodeURIComponent(locationLabel(settings) || "Kigali, Rwanda");
    return "https://maps.google.com/?q=" + query;
  }

  function readCache() {
    try {
      var raw = global.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.settings || !parsed.savedAt) return null;
      if (Date.now() - Number(parsed.savedAt) > CACHE_TTL_MS) return null;
      return parsed.settings;
    } catch (_error) {
      return null;
    }
  }

  function writeCache(settings) {
    try {
      global.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        settings: settings
      }));
    } catch (_error) {
      // ignore
    }
  }

  function mergeSettings(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var merged = Object.assign({}, defaults, source);
    if (source.branding && typeof source.branding === "object") {
      merged.branding = source.branding;
    }
    if (source.seo && typeof source.seo === "object") {
      merged.seo = source.seo;
    }
    if (source.delivery && typeof source.delivery === "object") {
      merged.delivery = source.delivery;
    }
    return merged;
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value == null ? "" : String(value);
  }

  function applyMaintenanceBanner(settings) {
    var existing = document.getElementById("byoseMaintenanceBanner");
    var shouldShow = Boolean(settings.maintenanceMode) || String(settings.storeStatus || "").toLowerCase() === "closed";
    if (!shouldShow) {
      if (existing) existing.remove();
      document.documentElement.classList.remove("byose-store-unavailable");
      return;
    }

    document.documentElement.classList.add("byose-store-unavailable");
    var message = settings.maintenanceMode
      ? (settings.storeName || "BYOSE Market") + " is currently under maintenance. Ordering may be unavailable."
      : (settings.storeName || "BYOSE Market") + " is currently closed. Please check back during business hours.";

    if (!existing) {
      existing = document.createElement("div");
      existing.id = "byoseMaintenanceBanner";
      existing.setAttribute("role", "status");
      existing.style.cssText = "position:sticky;top:0;z-index:9999;background:#24564d;color:#fff;padding:0.65rem 1rem;text-align:center;font:600 0.9rem/1.4 Manrope,system-ui,sans-serif;";
      document.body.insertBefore(existing, document.body.firstChild);
    }
    existing.textContent = message;
  }

  function applyBranding(settings) {
    var branding = settings && settings.branding && typeof settings.branding === "object"
      ? settings.branding
      : {};
    var colors = branding.colors || {};
    var logos = branding.logos || {};
    var icons = branding.icons || {};
    var identity = branding.identity || {};
    var root = document.documentElement;

    var colorMap = {
      "--accent": colors.primary || colors.accent,
      "--accent-2": colors.secondary || colors.accent,
      "--home-primary": colors.primary,
      "--home-primary-deep": colors.primary,
      "--shop-primary": colors.primary,
      "--shop-primary-deep": colors.primary,
      "--primary": colors.primary,
      "--brand-primary": colors.primary,
      "--brand-secondary": colors.secondary,
      "--brand-accent": colors.accent,
      "--brand-success": colors.success,
      "--brand-warning": colors.warning,
      "--brand-error": colors.error,
      "--brand-text": colors.text,
      "--brand-bg": colors.background
    };

    Object.keys(colorMap).forEach(function (key) {
      if (colorMap[key]) {
        root.style.setProperty(key, String(colorMap[key]));
      }
    });

    var mainLogo = logos.mainLogo || logos.darkLogo || "";
    var footerLogo = logos.footerLogo || mainLogo;
    var mobileLogo = logos.mobileLogo || mainLogo;
    var whiteLogo = logos.whiteLogo || mainLogo;

    document.querySelectorAll("[data-brand-logo], img.brand-logo, .brand-logo, a.brand img, .footer-logo").forEach(function (el) {
      var role = el.getAttribute("data-brand-logo") || "";
      var next = mainLogo;
      if (role === "footer" || el.classList.contains("footer-logo")) next = footerLogo;
      if (role === "mobile") next = mobileLogo;
      if (role === "white") next = whiteLogo;
      if (next) {
        el.setAttribute("src", next);
      }
    });

    if (identity.footerCopyright || identity.copyrightText) {
      document.querySelectorAll("[data-brand-copyright], .footer-bottom p").forEach(function (el) {
        if (el.hasAttribute("data-brand-copyright") || el.closest(".footer-bottom")) {
          el.textContent = identity.footerCopyright || identity.copyrightText;
        }
      });
    }

    if (identity.tagline) {
      document.querySelectorAll("[data-brand-tagline]").forEach(function (el) {
        el.textContent = identity.tagline;
      });
    }

    if (identity.brandDescription) {
      document.querySelectorAll("[data-brand-description], .footer-brand__desc").forEach(function (el) {
        el.textContent = identity.brandDescription;
      });
    }

    function upsertIconLink(rel, href, extra) {
      if (!href) return;
      var selector = 'link[rel="' + rel + '"][data-branding-icon]';
      var link = document.querySelector(selector);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        link.setAttribute("data-branding-icon", "true");
        if (extra) {
          Object.keys(extra).forEach(function (key) {
            link.setAttribute(key, extra[key]);
          });
        }
        document.head.appendChild(link);
      }
      link.href = href;
    }

    upsertIconLink("icon", icons.favicon || icons.browserTabIcon || mainLogo);
    upsertIconLink("apple-touch-icon", icons.appleTouchIcon || icons.pwaIcon || mainLogo);
    upsertIconLink("manifest-icon", icons.pwaIcon || icons.androidIcon || mainLogo);

    global.ByoseBrand = branding;
  }

  function applyDom(settings) {
    var phone = settings.customerServicePhone || settings.supportPhone || "";
    var whatsapp = settings.whatsappContact || settings.whatsappNumber || "";
    var email = settings.defaultSupportEmail || settings.supportEmail || "";
    var location = locationLabel(settings);

    var values = {
      storeName: settings.storeName,
      companyName: settings.companyName,
      companyEmail: settings.companyEmail || email,
      supportEmail: email,
      defaultSupportEmail: email,
      supportPhone: displayPhone(phone) || phone,
      customerServicePhone: displayPhone(phone) || phone,
      whatsappNumber: displayPhone(whatsapp) || whatsapp,
      whatsappContact: displayPhone(whatsapp) || whatsapp,
      companyAddress: settings.companyAddress,
      country: settings.country,
      provinceCity: settings.provinceCity,
      location: location,
      websiteUrl: settings.websiteUrl,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol || settings.currency,
      businessHours: settings.businessHours,
      emergencyContact: settings.emergencyContact
    };

    document.querySelectorAll("[data-store-setting]").forEach(function (el) {
      var key = el.getAttribute("data-store-setting");
      if (key && Object.prototype.hasOwnProperty.call(values, key)) {
        setText(el, values[key]);
      }
    });

    document.querySelectorAll("[data-store-href]").forEach(function (el) {
      var key = el.getAttribute("data-store-href");
      if (key === "supportPhone" || key === "customerServicePhone") {
        el.setAttribute("href", telHref(phone));
      } else if (key === "whatsappNumber" || key === "whatsappContact") {
        el.setAttribute("href", waHref(whatsapp));
      } else if (key === "supportEmail" || key === "defaultSupportEmail") {
        el.setAttribute("href", email ? "mailto:" + email : "#");
      } else if (key === "location" || key === "maps") {
        el.setAttribute("href", mapsHref(settings));
      } else if (key === "websiteUrl") {
        el.setAttribute("href", settings.websiteUrl || "#");
      }
    });

    applyMaintenanceBanner(settings);

    if (!settings.allowCustomerRegistration) {
      document.querySelectorAll("[data-requires-registration]").forEach(function (el) {
        el.setAttribute("aria-disabled", "true");
        el.classList.add("is-disabled");
        if (el.tagName === "A") {
          el.addEventListener("click", function (event) {
            event.preventDefault();
            alert("Customer registration is currently disabled.");
          }, { once: true });
        }
      });
    }

    if (settings.allowGuestCheckout === false) {
      document.querySelectorAll("[data-requires-guest-checkout], [data-guest-checkout]").forEach(function (el) {
        el.setAttribute("aria-disabled", "true");
        el.classList.add("is-disabled");
        el.setAttribute("title", "Guest checkout is currently disabled. Please sign in to continue.");
      });
    }

    try {
      document.documentElement.lang = settings.language || document.documentElement.lang || "en";
    } catch (_error) {
      // ignore
    }

    applyBranding(settings);
    applySeo(settings);
  }

  function upsertMeta(selector, attrs) {
    var node = document.querySelector(selector);
    if (!node) {
      node = document.createElement(attrs.property || attrs.name ? "meta" : "link");
      document.head.appendChild(node);
    }
    Object.keys(attrs).forEach(function (key) {
      if (attrs[key] == null || attrs[key] === "") return;
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }

  function upsertJsonLd(id, data) {
    var script = document.getElementById(id);
    if (!data || !data["@graph"] || !data["@graph"].length) {
      if (script) script.remove();
      return;
    }
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = id;
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }

  function injectOnce(id, builder) {
    if (document.getElementById(id)) return;
    var node = builder();
    if (!node) return;
    node.id = id;
    document.head.appendChild(node);
  }

  function applySeo(settings) {
    var seo = settings && settings.seo && typeof settings.seo === "object" ? settings.seo : null;
    if (!seo) return;

    var website = seo.website || {};
    var social = seo.social || {};
    var analytics = seo.analytics || {};
    var structured = seo.structuredData || {};
    var searchEngine = seo.searchEngine || {};
    var pageTitle = website.metaTitle || website.websiteTitle || "";
    var description = website.metaDescription || "";
    var canonical = website.canonicalUrl || settings.websiteUrl || "";
    var robots = website.robotsMeta || searchEngine.indexingRules || "index, follow";
    var ogTitle = social.ogTitle || pageTitle;
    var ogDescription = social.ogDescription || description;
    var ogImage = social.ogImage || "";
    var twitterTitle = social.twitterTitle || ogTitle;
    var twitterDescription = social.twitterDescription || ogDescription;
    var twitterImage = social.twitterImage || ogImage;

    if (pageTitle && !document.documentElement.hasAttribute("data-seo-page-title-locked")) {
      document.title = pageTitle;
    }

    upsertMeta('meta[name="description"][data-seo-managed], meta[name="description"]', {
      name: "description",
      content: description,
      "data-seo-managed": "true"
    });
    if (website.metaKeywords) {
      upsertMeta('meta[name="keywords"][data-seo-managed], meta[name="keywords"]', {
        name: "keywords",
        content: website.metaKeywords,
        "data-seo-managed": "true"
      });
    }
    upsertMeta('meta[name="robots"][data-seo-managed], meta[name="robots"]', {
      name: "robots",
      content: robots,
      "data-seo-managed": "true"
    });

    if (canonical) {
      var link = document.querySelector('link[rel="canonical"][data-seo-managed], link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        link.setAttribute("data-seo-managed", "true");
        document.head.appendChild(link);
      }
      if (searchEngine.canonicalMode === "page" && global.location && global.location.href) {
        link.href = String(global.location.href).split("#")[0].split("?")[0];
      } else {
        link.href = canonical;
      }
    }

    upsertMeta('meta[property="og:title"]', { property: "og:title", content: ogTitle, "data-seo-managed": "true" });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: ogDescription, "data-seo-managed": "true" });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website", "data-seo-managed": "true" });
    if (canonical) {
      upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical, "data-seo-managed": "true" });
    }
    if (ogImage) {
      upsertMeta('meta[property="og:image"]', { property: "og:image", content: ogImage, "data-seo-managed": "true" });
    }

    upsertMeta('meta[name="twitter:card"]', {
      name: "twitter:card",
      content: social.twitterCard || "summary_large_image",
      "data-seo-managed": "true"
    });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: twitterTitle, "data-seo-managed": "true" });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: twitterDescription, "data-seo-managed": "true" });
    if (twitterImage) {
      upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: twitterImage, "data-seo-managed": "true" });
    }

    if (analytics.googleSearchConsoleVerification) {
      upsertMeta('meta[name="google-site-verification"]', {
        name: "google-site-verification",
        content: analytics.googleSearchConsoleVerification,
        "data-seo-managed": "true"
      });
    }
    if (analytics.bingWebmasterVerification) {
      upsertMeta('meta[name="msvalidate.01"]', {
        name: "msvalidate.01",
        content: analytics.bingWebmasterVerification,
        "data-seo-managed": "true"
      });
    }

    if (analytics.googleTagManagerId) {
      injectOnce("byoseGtmScript", function () {
        var script = document.createElement("script");
        script.text = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
          + "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';"
          + "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);"
          + "})(window,document,'script','dataLayer','" + String(analytics.googleTagManagerId).replace(/'/g, "") + "');";
        return script;
      });
    }

    if (analytics.googleAnalyticsId) {
      injectOnce("byoseGaScript", function () {
        var script = document.createElement("script");
        script.async = true;
        script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(analytics.googleAnalyticsId);
        return script;
      });
      injectOnce("byoseGaConfig", function () {
        var script = document.createElement("script");
        script.text = "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}"
          + "gtag('js', new Date());gtag('config','" + String(analytics.googleAnalyticsId).replace(/'/g, "") + "');";
        return script;
      });
    }

    if (analytics.metaPixelId) {
      injectOnce("byoseMetaPixel", function () {
        var script = document.createElement("script");
        script.text = "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?"
          + "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;"
          + "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;"
          + "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}"
          + "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');"
          + "fbq('init','" + String(analytics.metaPixelId).replace(/'/g, "") + "');fbq('track','PageView');";
        return script;
      });
    }

    var graphs = [];
    if (structured.organizationEnabled) {
      graphs.push({
        "@type": "Organization",
        name: structured.organizationName || settings.storeName || "BYOSE Market",
        url: structured.organizationUrl || canonical,
        logo: structured.organizationLogo || ogImage || undefined
      });
    }
    if (structured.websiteEnabled) {
      graphs.push({
        "@type": "WebSite",
        name: website.websiteTitle || settings.storeName || "BYOSE Market",
        url: canonical || settings.websiteUrl
      });
    }
    if (structured.localBusinessEnabled) {
      graphs.push({
        "@type": structured.localBusinessType || "Store",
        name: structured.organizationName || settings.storeName || "BYOSE Market",
        url: structured.organizationUrl || canonical,
        address: structured.localBusinessAddress || undefined
      });
    }
    upsertJsonLd("byoseSeoJsonLd", graphs.length ? { "@context": "https://schema.org", "@graph": graphs } : null);

    global.ByoseSeo = seo;
  }

  function publish(settings) {
    global.ByoseStoreSettings = settings;
    global.dispatchEvent(new CustomEvent("byose:store-settings", { detail: settings }));
    applyDom(settings);
  }

  function fetchSettings() {
    var cached = readCache();
    if (cached) {
      publish(mergeSettings(cached));
    }

    var url = resolveApiBase() + "/settings/public";
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("settings_http_" + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        var settings = mergeSettings(payload && payload.settings);
        writeCache(settings);
        publish(settings);
        return settings;
      })
      .catch(function () {
        if (!cached) {
          publish(mergeSettings(defaults));
        }
        return global.ByoseStoreSettings;
      });
  }

  global.ByoseStoreSettingsLoader = {
    load: fetchSettings,
    apply: applyDom,
    waHref: waHref,
    telHref: telHref,
    displayPhone: displayPhone
  };

  global.ByoseStoreSettings = mergeSettings(defaults);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchSettings, { once: true });
  } else {
    fetchSettings();
  }

  // Refresh public settings when the tab becomes visible so admin changes sync faster.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      try {
        global.sessionStorage.removeItem(CACHE_KEY);
      } catch (_error) {
        // ignore
      }
      fetchSettings();
    }
  });
})(typeof window !== "undefined" ? window : null);
