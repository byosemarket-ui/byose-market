(function () {
  'use strict';

  function isStrongPassword(value) {
    const password = String(value || '');
    return password.length >= 8 && password.length <= 128
      && /[a-z]/.test(password)
      && /[A-Z]/.test(password)
      && /\d/.test(password);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const current = document.getElementById('currentPassword');
    const next = document.getElementById('newPassword');
    const confirm = document.getElementById('confirmPassword');
    const button = document.getElementById('updatePasswordBtn');
    const error = document.getElementById('errorMessage');
    const success = document.getElementById('successMessage');
    if (!form || !current || !next || !confirm || !button) return;

    const validate = () => {
      const valid = Boolean(current.value) && isStrongPassword(next.value) && next.value === confirm.value;
      button.disabled = !valid;
      return valid;
    };
    [current, next, confirm].forEach((input) => input.addEventListener('input', validate));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validate()) return;
      button.disabled = true;
      error.hidden = true;
      success.hidden = true;
      try {
        await window.authService.changePassword(current.value, next.value);
        form.reset();
        success.textContent = 'Your password has been updated.';
        success.hidden = false;
      } catch (requestError) {
        error.textContent = requestError?.message || 'Unable to update your password.';
        error.hidden = false;
      } finally {
        validate();
      }
    });
  });
})();
