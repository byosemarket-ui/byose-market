(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  function setFormVisible(visible) {
    $('#addressFormWrapper')?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function getFields() {
    return {
      fullName: $('#fullName'),
      phone: $('#phone'),
      city: $('#city'),
      district: $('#district'),
      sector: $('#sector'),
      street: $('#street'),
      additional: $('#additional')
    };
  }

  function fillForm(user) {
    const fields = getFields();
    const address = user?.address || {};
    const name = String(user?.name || [address.firstName, address.lastName].filter(Boolean).join(' ') || '').trim();

    fields.fullName.value = name;
    fields.phone.value = String(address.phone || user?.phone || '');
    fields.city.value = String(address.city || '');
    fields.district.value = String(address.district || '');
    fields.sector.value = String(address.sector || '');
    fields.street.value = String(address.street || address.line1 || '');
    fields.additional.value = String(address.additional || address.note || '');
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function renderAddress(user) {
    const list = $('#addressList');
    const emptyState = $('#emptyState');
    if (!list || !emptyState) return;

    const address = user?.address || {};
    const hasAddress = [address.city, address.district, address.sector, address.street, address.line1]
      .some((value) => String(value || '').trim());

    list.replaceChildren();
    emptyState.style.display = hasAddress ? 'none' : 'flex';
    if (!hasAddress) return;

    const card = createElement('article', 'address-card');
    const row = createElement('div', 'address-row');
    const detail = document.createElement('div');
    const recipient = createElement('div', 'recipient', user.name || 'Saved address');
    const phone = createElement('div', 'phone', address.phone || user.phone || '');
    const addressText = createElement(
      'div',
      'address-text',
      [address.city, address.district, address.sector, address.street || address.line1].filter(Boolean).join(', ')
    );
    const meta = createElement('div', 'meta', address.additional || address.note || '');
    const actions = createElement('div', 'card-actions');
    const edit = createElement('button', 'edit-btn', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      fillForm(user);
      setFormVisible(true);
    });
    const remove = createElement('button', 'delete-btn', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Remove this saved address?')) return;
      await saveAddress(user, true);
    });

    detail.append(recipient, phone, addressText, meta);
    row.append(detail);
    actions.append(edit, remove);
    card.append(row, actions);
    list.append(card);
  }

  async function saveAddress(user, clear) {
    const fields = getFields();
    const fullName = clear ? '' : fields.fullName.value.trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const address = clear
      ? { line1: '', street: '', city: '', district: '', sector: '', cell: '', village: '', firstName: '', lastName: '', phone: '', additional: '' }
      : {
          line1: fields.street.value.trim(),
          street: fields.street.value.trim(),
          city: fields.city.value.trim(),
          district: fields.district.value.trim(),
          sector: fields.sector.value.trim(),
          cell: '',
          village: '',
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' '),
          phone: fields.phone.value.trim(),
          additional: fields.additional.value.trim()
        };

    try {
      const updatedUser = await window.authService.updateProfile({
        name: clear ? user.name : (fullName || user.name),
        phone: clear ? user.phone : (fields.phone.value.trim() || user.phone),
        address
      });
      renderAddress(updatedUser);
      fillForm(updatedUser);
      setFormVisible(false);
    } catch (error) {
      window.alert('Unable to save your address. Please try again.');
    }
  }

  function init() {
    const user = window.authService?.getCurrentUser?.();
    if (!user) return;

    renderAddress(user);
    fillForm(user);
    document.querySelectorAll('.add-address-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        fillForm(window.authService.getCurrentUser());
        setFormVisible(true);
      });
    });
    $('#addressForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveAddress(window.authService.getCurrentUser(), false);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
