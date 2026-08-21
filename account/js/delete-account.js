(function initDeleteAccount() {
  const form = document.getElementById('deleteAccountForm');
  const passwordInput = document.getElementById('password');
  const confirmationInput = document.getElementById('confirmation');
  const openConfirmBtn = document.getElementById('openConfirmBtn');
  const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const confirmBox = document.getElementById('confirmBox');
  const statusMsg = document.getElementById('statusMsg');

  if (!form || !window.authService) return;

  function setStatus(message, tone) {
    if (!statusMsg) return;
    statusMsg.textContent = message || '';
    statusMsg.className = 'status' + (tone ? ' ' + tone : '');
  }

  function busy(isBusy) {
    [openConfirmBtn, cancelConfirmBtn, deleteBtn, passwordInput, confirmationInput].forEach((el) => {
      if (el) el.disabled = Boolean(isBusy);
    });
  }

  openConfirmBtn?.addEventListener('click', () => {
    setStatus('');
    const password = String(passwordInput?.value || '');
    const confirmation = String(confirmationInput?.value || '').trim();
    if (!password) {
      setStatus('Enter your current password.', 'error');
      passwordInput?.focus();
      return;
    }
    if (confirmation.toUpperCase() !== 'DELETE') {
      setStatus('Type DELETE exactly to continue.', 'error');
      confirmationInput?.focus();
      return;
    }
    confirmBox?.classList.add('is-open');
  });

  cancelConfirmBtn?.addEventListener('click', () => {
    confirmBox?.classList.remove('is-open');
    setStatus('Account deletion cancelled.', 'ok');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = String(passwordInput?.value || '');
    const confirmation = String(confirmationInput?.value || '').trim();
    if (!password || confirmation.toUpperCase() !== 'DELETE') {
      setStatus('Password and DELETE confirmation are required.', 'error');
      return;
    }

    busy(true);
    setStatus('Deleting your account…');
    try {
      await window.authService.deleteAccount(password, confirmation);
      setStatus('Account deleted. Redirecting…', 'ok');
      window.setTimeout(() => {
        try {
          window.location.replace('../../index.html');
        } catch (_error) {
          window.location.href = '../../index.html';
        }
      }, 600);
    } catch (error) {
      const message = String(error?.message || 'Unable to delete account.');
      setStatus(message, 'error');
      busy(false);
      confirmBox?.classList.remove('is-open');
    }
  });
})();
