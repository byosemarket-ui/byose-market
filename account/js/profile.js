(function () {
  'use strict';

  function setRowValue(label, value) {
    const rows = Array.from(document.querySelectorAll('.row'));
    const row = rows.find((item) => item.querySelector('.label')?.textContent.trim() === label);
    const valueNode = row?.querySelector('.value');
    if (valueNode) {
      valueNode.textContent = value || 'Not set';
    }
  }

  function renderProfile(user) {
    const name = String(user?.name || '').trim() || 'Your profile';
    const email = String(user?.email || '').trim();
    const phone = String(user?.phone || '').trim();
    const id = String(user?.id || '').trim();
    const avatar = String(user?.avatar || '').trim();
    const createdAt = user?.createdAt ? new Date(user.createdAt) : null;
    const memberSince = createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleDateString()
      : '—';

    const nameNode = document.querySelector('.user-name');
    const summaryNode = document.querySelector('.user-sub');
    const avatarNode = document.querySelector('#avatarContainer img');

    if (nameNode) nameNode.textContent = name;
    if (summaryNode) summaryNode.textContent = `Member since ${memberSince}${id ? ` • ID: ${id}` : ''}`;
    if (avatarNode) {
      avatarNode.alt = `${name} avatar`;
      if (avatar) {
        avatarNode.src = avatar;
        avatarNode.style.display = '';
      } else {
        avatarNode.removeAttribute('src');
      }
    }

    setRowValue('Account', id || 'Active');
    setRowValue('Mobile number', phone);
    setRowValue('Email', email);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const user = window.authService?.getCurrentUser?.();
    if (user) renderProfile(user);

    window.addEventListener('userUpdated', (event) => {
      if (event.detail) renderProfile(event.detail);
    });
  });
})();
