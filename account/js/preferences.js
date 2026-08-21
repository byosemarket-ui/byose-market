(function () {
  'use strict';

  var ALLOWED = ['fashion', 'shoes', 'bags', 'electronics', 'phones', 'beauty', 'accessories', 'home'];
  var inputs = [];
  var saveBtn = null;
  var validation = null;
  var statusEl = null;
  var saving = false;
  var lastSaved = [];

  function setStatus(type, message) {
    if (!statusEl) return;
    statusEl.className = 'prefs-status' + (type ? ' is-' + type : '');
    statusEl.textContent = message || '';
    statusEl.hidden = !message;
  }

  function syncSelectedClass(input) {
    var label = document.querySelector('label[for="' + input.id + '"]');
    if (!label) return;
    label.classList.toggle('selected', !!input.checked);
  }

  function selectedCategories() {
    return inputs
      .filter(function (input) { return input.checked; })
      .map(function (input) { return String(input.dataset.category || input.value || '').trim().toLowerCase(); })
      .filter(function (value) { return ALLOWED.indexOf(value) !== -1; });
  }

  function applyCategories(categories) {
    var set = {};
    (Array.isArray(categories) ? categories : []).forEach(function (item) {
      set[String(item || '').trim().toLowerCase()] = true;
    });
    inputs.forEach(function (input) {
      var key = String(input.dataset.category || input.value || '').trim().toLowerCase();
      input.checked = !!set[key];
      syncSelectedClass(input);
    });
  }

  function loadFromUser(user) {
    var categories = user?.preferences?.interestCategories;
    if (!Array.isArray(categories)) categories = [];
    applyCategories(categories);
    lastSaved = selectedCategories();
  }

  async function save() {
    if (saving) return;
    var selected = selectedCategories();
    if (!selected.length) {
      if (validation) validation.classList.add('visible');
      setStatus('error', 'Select at least one category.');
      return;
    }
    if (validation) validation.classList.remove('visible');

    if (!window.authService?.updateProfile) {
      setStatus('error', 'Unable to save preferences right now.');
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    setStatus('saving', 'Saving your preferences…');

    try {
      var user = await window.authService.updateProfile({
        preferences: { interestCategories: selected }
      });
      loadFromUser(user);
      lastSaved = selectedCategories();
      setStatus('success', 'Preferences saved.');
      try {
        document.dispatchEvent(new CustomEvent('preferences:save', {
          detail: { categories: lastSaved }
        }));
      } catch (_error) {}
    } catch (error) {
      applyCategories(lastSaved);
      var message = String(error?.message || error || '').trim();
      if (/at least one/i.test(message)) {
        setStatus('error', 'Select at least one category.');
      } else if (/not_authenticated|401|unauthorized/i.test(message)) {
        setStatus('error', 'Please sign in again to save preferences.');
      } else {
        setStatus('error', message || 'Could not save preferences. Try again.');
      }
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Preferences';
    }
  }

  async function init() {
    inputs = Array.from(document.querySelectorAll('.category-input'));
    saveBtn = document.getElementById('savePreferencesBtn');
    validation = document.getElementById('preferencesValidation');
    statusEl = document.getElementById('preferencesStatus');
    if (!saveBtn || !inputs.length) return;

    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(function () {});
    }

    var user = window.authService?.getCurrentUser?.();
    if (user) loadFromUser(user);
    else setStatus('error', 'Please sign in to manage preferences.');

    inputs.forEach(function (input) {
      syncSelectedClass(input);
      input.addEventListener('change', function () {
        syncSelectedClass(input);
        if (validation) validation.classList.remove('visible');
        if (statusEl && statusEl.classList.contains('is-success')) setStatus('', '');
      });
    });

    saveBtn.addEventListener('click', function () { void save(); });

    document.querySelectorAll('label.category-card').forEach(function (label) {
      label.setAttribute('tabindex', '0');
      label.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        var input = document.getElementById(label.getAttribute('for'));
        if (!input || input.disabled) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      });
    });

    window.addEventListener('userUpdated', function (event) {
      if (event.detail && !saving) loadFromUser(event.detail);
    });
  }

  document.addEventListener('DOMContentLoaded', function () { void init(); });
})();
