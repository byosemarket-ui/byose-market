(function (global) {
  'use strict';

  var ALLOWED = ['en', 'rw', 'fr'];
  var KEYS = ['bm_lang', 'byose_language', 'byose_market_language'];
  var LABELS = {
    en: 'English',
    rw: 'Kinyarwanda',
    fr: 'Français'
  };

  function normalize(lang, fallback) {
    var value = String(lang || '').trim().toLowerCase();
    if (ALLOWED.indexOf(value) !== -1) return value;
    var fb = String(fallback || 'en').trim().toLowerCase();
    return ALLOWED.indexOf(fb) !== -1 ? fb : 'en';
  }

  function labelFor(lang) {
    return LABELS[normalize(lang)] || LABELS.en;
  }

  function readGuestLanguage() {
    for (var i = 0; i < KEYS.length; i += 1) {
      try {
        var value = localStorage.getItem(KEYS[i]);
        if (value) return normalize(value);
      } catch (_error) {}
    }
    return 'en';
  }

  function writeGuestLanguage(lang) {
    var next = normalize(lang);
    KEYS.forEach(function (key) {
      try { localStorage.setItem(key, next); } catch (_error) {}
    });
    try {
      if (window.storage && typeof window.storage.saveLanguage === 'function') {
        window.storage.saveLanguage(next);
      }
    } catch (_error) {}
    try {
      document.documentElement.setAttribute('lang', next);
    } catch (_error) {}
    return next;
  }

  function applyToPage(lang) {
    var next = writeGuestLanguage(lang);
    try {
      if (typeof global.setLanguage === 'function') {
        global.setLanguage(next);
      } else if (typeof global.applyLanguage === 'function') {
        global.applyLanguage(next);
      }
    } catch (_error) {}
    try {
      global.dispatchEvent(new CustomEvent('byose:languageChanged', { detail: { lang: next } }));
    } catch (_error) {}
    return next;
  }

  global.ByoseLanguagePreference = {
    ALLOWED: ALLOWED,
    normalize: normalize,
    labelFor: labelFor,
    readGuestLanguage: readGuestLanguage,
    writeGuestLanguage: writeGuestLanguage,
    applyToPage: applyToPage
  };
})(window);
