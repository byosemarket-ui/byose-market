(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  function ui() {
    return window.ByoseCustomerProfileUi;
  }

  function setStatus(message, type) {
    const el = $('#profileStatus');
    if (!el) return;
    const text = String(message || '').trim();
    el.textContent = text;
    el.classList.toggle('is-visible', Boolean(text));
    el.classList.toggle('is-error', type === 'error');
    el.classList.toggle('is-success', type === 'success');
  }

  function fillForm(user) {
    const helpers = ui();
    const name = helpers?.text(user?.name) || '';
    const email = helpers?.text(user?.email) || '';
    const phone = helpers?.text(user?.phone) || '';
    const id = helpers?.text(user?.id) || '';
    const memberSince = helpers?.formatMemberSince(user?.createdAt) || '';
    const hasPhoto = Boolean(helpers?.resolveAvatarUrl(user?.avatar));

    const displayName = $('#profileDisplayName');
    const displaySub = $('#profileDisplaySub');
    if (displayName) displayName.textContent = name || 'Your profile';
    if (displaySub) {
      displaySub.textContent = [
        memberSince ? `Member since ${memberSince}` : '',
        id ? `ID: ${id}` : ''
      ].filter(Boolean).join(' • ');
    }

    const customerId = $('#profileCustomerId');
    const summaryEmail = $('#profileSummaryEmail');
    const summaryPhone = $('#profileSummaryPhone');
    if (customerId) customerId.textContent = id || '—';
    if (summaryEmail) summaryEmail.textContent = email || 'Not provided';
    if (summaryPhone) summaryPhone.textContent = phone || 'Not provided';

    const nameInput = $('#profileName');
    const emailInput = $('#profileEmail');
    const phoneInput = $('#profilePhone');
    if (nameInput) nameInput.value = name;
    if (emailInput) emailInput.value = email;
    if (phoneInput) phoneInput.value = phone;

    const removeBtn = $('#removePhotoBtn');
    if (removeBtn) removeBtn.hidden = !hasPhoto;

    helpers?.paintAvatar($('#avatarContainer'), user, { initialClass: 'avatar-initial' });

    // Keep camera button above painted avatar contents.
    const camera = $('#editAvatarBtn');
    const fileInput = $('#avatarInput');
    const container = $('#avatarContainer');
    if (container && fileInput && !container.contains(fileInput)) container.append(fileInput);
    if (container && camera && !container.contains(camera)) container.append(camera);
  }

  function renderProfile(user) {
    if (!user) return;
    fillForm(user);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const auth = window.authService;
    if (!auth?.updateProfile) return;

    const name = String($('#profileName')?.value || '').trim();
    const email = String($('#profileEmail')?.value || '').trim();
    const phone = String($('#profilePhone')?.value || '').trim();
    const saveBtn = $('#saveProfileBtn');

    if (!name) {
      setStatus('Full name is required.', 'error');
      return;
    }

    setStatus('');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const updated = await auth.updateProfile({ name, email, phone });
      renderProfile(updated || auth.getCurrentUser?.());
      setStatus('Profile saved.', 'success');
    } catch (error) {
      setStatus(error?.message || 'Unable to save profile. Please try again.', 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function uploadPhoto(file) {
    const auth = window.authService;
    if (!auth?.uploadProfilePhoto || !file) return;
    setStatus('Uploading photo…');
    try {
      const updated = await auth.uploadProfilePhoto(file);
      renderProfile(updated || auth.getCurrentUser?.());
      setStatus('Profile photo updated.', 'success');
    } catch (error) {
      setStatus(error?.message || 'Unable to upload photo.', 'error');
    } finally {
      const input = $('#avatarInput');
      if (input) input.value = '';
    }
  }

  async function removePhoto() {
    const auth = window.authService;
    if (!auth?.removeProfilePhoto) return;
    if (!window.confirm('Remove your profile photo?')) return;
    setStatus('');
    try {
      const updated = await auth.removeProfilePhoto();
      renderProfile(updated || auth.getCurrentUser?.());
      setStatus('Profile photo removed.', 'success');
    } catch (error) {
      setStatus(error?.message || 'Unable to remove photo.', 'error');
    }
  }

  async function init() {
    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(() => {});
    }

    const user = window.authService?.getCurrentUser?.();
    if (user) renderProfile(user);

    $('#profileForm')?.addEventListener('submit', saveProfile);
    $('#editAvatarBtn')?.addEventListener('click', () => $('#avatarInput')?.click());
    $('#avatarInput')?.addEventListener('change', (event) => {
      const file = event.target?.files?.[0];
      if (file) uploadPhoto(file);
    });
    $('#removePhotoBtn')?.addEventListener('click', removePhoto);

    window.addEventListener('userUpdated', (event) => {
      if (event.detail) renderProfile(event.detail);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
