(function () {
  'use strict';

  var helpers = null;
  var items = [];
  var currentLabel = null;
  var statusEl = null;
  var saving = false;
  var currentLang = 'en';

  function setStatus(type, message) {
    if (!statusEl) return;
    statusEl.className = 'lang-status' + (type ? ' is-' + type : '');
    statusEl.textContent = message || '';
    statusEl.hidden = !message;
  }

  function paint(lang) {
    currentLang = helpers.normalize(lang);
    items.forEach(function (item) {
      var selected = item.dataset.lang === currentLang;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      item.setAttribute('aria-disabled', saving ? 'true' : 'false');
    });
    if (currentLabel) currentLabel.textContent = helpers.labelFor(currentLang);
  }

  async function selectLanguage(lang) {
    if (saving) return;
    var next = helpers.normalize(lang);
    if (next === currentLang) return;

    var previous = currentLang;
    paint(next);
    helpers.applyToPage(next);

    if (!window.authService?.updateProfile) {
      setStatus('error', 'Unable to save language right now.');
      paint(previous);
      helpers.applyToPage(previous);
      return;
    }

    saving = true;
    setStatus('saving', 'Saving language…');
    try {
      var user = await window.authService.updateProfile({ preferredLanguage: next });
      var saved = helpers.normalize(user?.preferredLanguage || next);
      paint(saved);
      helpers.applyToPage(saved);
      setStatus('success', 'Language saved.');
    } catch (error) {
      paint(previous);
      helpers.applyToPage(previous);
      var message = String(error?.message || error || '').trim();
      if (/unsupported language/i.test(message)) {
        setStatus('error', 'That language is not supported.');
      } else if (/not_authenticated|401|unauthorized/i.test(message)) {
        setStatus('error', 'Please sign in again to save language.');
      } else {
        setStatus('error', message || 'Could not save language. Try again.');
      }
    } finally {
      saving = false;
      items.forEach(function (item) {
        item.setAttribute('aria-disabled', 'false');
      });
    }
  }

  async function init() {
    helpers = window.ByoseLanguagePreference;
    var list = document.getElementById('languageList');
    currentLabel = document.getElementById('currentLanguage');
    statusEl = document.getElementById('languageStatus');
    if (!helpers || !list) return;

    items = Array.from(list.querySelectorAll('.language-item'));

    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(function () {});
    }

    var user = window.authService?.getCurrentUser?.();
    var initial = helpers.normalize(
      user?.preferredLanguage || helpers.readGuestLanguage(),
      'en'
    );
    paint(initial);
    helpers.applyToPage(initial);

    items.forEach(function (item) {
      item.addEventListener('click', function () {
        void selectLanguage(item.dataset.lang);
      });
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void selectLanguage(item.dataset.lang);
        }
      });
    });

    window.addEventListener('userUpdated', function (event) {
      if (saving || !event.detail?.preferredLanguage) return;
      paint(event.detail.preferredLanguage);
      helpers.applyToPage(event.detail.preferredLanguage);
    });
  }

  document.addEventListener('DOMContentLoaded', function () { void init(); });
})();
