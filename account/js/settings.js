(function () {
  'use strict';

  var LANG_LABELS = {
    en: 'English',
    rw: 'Kinyarwanda',
    fr: 'Français'
  };

  function ui() {
    return window.ByoseCustomerProfileUi;
  }

  function languageLabel(user) {
    if (window.ByoseLanguagePreference?.labelFor) {
      return window.ByoseLanguagePreference.labelFor(
        user?.preferredLanguage || window.ByoseLanguagePreference.readGuestLanguage()
      );
    }
    var lang = String(user?.preferredLanguage || 'en').trim().toLowerCase();
    return LANG_LABELS[lang] || LANG_LABELS.en;
  }

  function renderSettingsCard(user) {
    const helpers = ui();
    if (!helpers || !user) return;

    const nameNode = document.querySelector('.profile-card .profile-meta .name');
    const subNode = document.querySelector('.profile-card .profile-meta .sub');
    const avatarBox = document.querySelector('.profile-card .avatar');
    const languageMeta = document.querySelector('a[data-link="language.html"] .settings-meta');
    const email = helpers.text(user.email);
    const phone = helpers.text(user.phone);

    if (nameNode) nameNode.textContent = helpers.text(user.name) || 'Your profile';
    if (subNode) {
      subNode.textContent = email || phone || 'Profile';
    }
    if (avatarBox) {
      helpers.paintAvatar(avatarBox, user, { initialClass: 'avatar-initial' });
    }
    if (languageMeta) {
      languageMeta.textContent = languageLabel(user);
    }
  }

  async function init() {
    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(() => {});
    }
    const user = window.authService?.getCurrentUser?.();
    if (user) renderSettingsCard(user);

    window.addEventListener('userUpdated', (event) => {
      if (event.detail) renderSettingsCard(event.detail);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
