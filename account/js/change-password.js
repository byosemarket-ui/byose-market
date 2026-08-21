(function () {
  'use strict';

  function isStrongPassword(value) {
    const password = String(value || '');
    return password.length >= 8
      && password.length <= 128
      && /[a-z]/.test(password)
      && /[A-Z]/.test(password)
      && /\d/.test(password);
  }

  function setMessage(el, text, visibleClass) {
    if (!el) return;
    const value = String(text || '').trim();
    el.textContent = value;
    el.classList.toggle(visibleClass || 'is-visible', Boolean(value));
  }

  function updateRules(password, confirmValue) {
    const checks = {
      length: password.length >= 8 && password.length <= 128,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      match: Boolean(password) && password === confirmValue
    };

    document.querySelectorAll('.password-rule').forEach((item) => {
      const rule = item.getAttribute('data-rule');
      const met = Boolean(checks[rule]);
      item.classList.toggle('is-met', met);
      const icon = item.querySelector('.rule-icon');
      if (icon) icon.textContent = met ? '✓' : '•';
    });

    return checks;
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

    document.querySelectorAll('.toggle-password').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.querySelector(btn.getAttribute('data-target'));
        if (!target) return;
        const showing = target.type === 'text';
        target.type = showing ? 'password' : 'text';
        btn.innerHTML = showing
          ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
          : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
        btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      });
    });

    const validate = () => {
      const password = String(next.value || '');
      const confirmValue = String(confirm.value || '');
      updateRules(password, confirmValue);
      const valid = Boolean(String(current.value || '').trim())
        && isStrongPassword(password)
        && password === confirmValue
        && password !== String(current.value || '');
      button.disabled = !valid || button.dataset.loading === '1';
      return valid;
    };

    [current, next, confirm].forEach((input) => input.addEventListener('input', () => {
      setMessage(error, '');
      setMessage(success, '');
      validate();
    }));
    validate();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage(error, '');
      setMessage(success, '');

      const currentValue = String(current.value || '');
      const nextValue = String(next.value || '');
      const confirmValue = String(confirm.value || '');

      if (!currentValue) {
        setMessage(error, 'Enter your current password.');
        return;
      }
      if (!isStrongPassword(nextValue)) {
        setMessage(error, 'Password must be 8+ characters with uppercase, lowercase, and a number.');
        return;
      }
      if (nextValue !== confirmValue) {
        setMessage(error, 'New password and confirmation do not match.');
        return;
      }
      if (nextValue === currentValue) {
        setMessage(error, 'Choose a new password that is different from your current password.');
        return;
      }
      if (!window.authService?.changePassword) {
        setMessage(error, 'Unable to update your password right now.');
        return;
      }

      button.dataset.loading = '1';
      button.disabled = true;
      button.textContent = 'Updating…';

      try {
        await window.authService.changePassword(currentValue, nextValue);
        form.reset();
        updateRules('', '');
        setMessage(success, 'Your password has been updated. You remain signed in on this device.');
      } catch (requestError) {
        const status = Number(requestError?.status || 0);
        let message = requestError?.message || 'Unable to update your password.';
        if (status === 401 && /incorrect|unauthorized/i.test(message)) {
          message = 'Current password is incorrect.';
        }
        setMessage(error, message);
      } finally {
        button.dataset.loading = '0';
        button.textContent = 'Update Password';
        validate();
      }
    });
  });
})();
