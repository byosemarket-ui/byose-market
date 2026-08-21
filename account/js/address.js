(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let addresses = [];
  let editingId = '';

  function addressesApi() {
    return window.ByoseCustomerAddresses;
  }

  function setStatus(message, isError) {
    const banner = $('#statusBanner');
    if (!banner) return;
    const text = String(message || '').trim();
    banner.textContent = text;
    banner.classList.toggle('is-visible', Boolean(text));
    banner.classList.toggle('is-error', Boolean(isError && text));
  }

  function setFormVisible(visible) {
    $('#addressFormWrapper')?.setAttribute('aria-hidden', visible ? 'false' : 'true');
    document.body.classList.toggle('is-form-open', Boolean(visible));
    const listSection = $('#addressListSection');
    if (listSection) listSection.hidden = Boolean(visible);
    if (visible) {
      $('#fullName')?.focus();
    }
  }

  function setError(message) {
    const el = $('#addressFormError');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function getFields() {
    return {
      addressId: $('#addressId'),
      fullName: $('#fullName'),
      phone: $('#phone'),
      provinceCity: $('#provinceCity'),
      district: $('#district'),
      sector: $('#sector'),
      cell: $('#cell'),
      village: $('#village'),
      street: $('#street'),
      note: $('#note'),
      isDefault: $('#isDefault')
    };
  }

  function readForm() {
    const fields = getFields();
    return {
      id: String(fields.addressId?.value || '').trim(),
      fullName: String(fields.fullName?.value || '').trim(),
      phone: String(fields.phone?.value || '').trim(),
      provinceCity: String(fields.provinceCity?.value || '').trim(),
      district: String(fields.district?.value || '').trim(),
      sector: String(fields.sector?.value || '').trim(),
      cell: String(fields.cell?.value || '').trim(),
      village: String(fields.village?.value || '').trim(),
      street: String(fields.street?.value || '').trim(),
      note: String(fields.note?.value || '').trim(),
      isDefault: Boolean(fields.isDefault?.checked)
    };
  }

  function fillForm(address, user) {
    const fields = getFields();
    const currentUser = user || window.authService?.getCurrentUser?.() || {};
    fields.addressId.value = String(address?.id || '');
    fields.fullName.value = String(address?.fullName || currentUser.name || '');
    fields.phone.value = String(address?.phone || currentUser.phone || '');
    fields.provinceCity.value = String(address?.provinceCity || address?.city || '');
    fields.district.value = String(address?.district || '');
    fields.sector.value = String(address?.sector || '');
    fields.cell.value = String(address?.cell || '');
    fields.village.value = String(address?.village || '');
    fields.street.value = String(address?.street || address?.line1 || '');
    fields.note.value = String(address?.note || address?.additional || '');
    fields.isDefault.checked = address ? Boolean(address.isDefault) : addresses.length === 0;
    $('#address-form-heading').textContent = address?.id ? 'Edit address' : 'Add address';
  }

  function appendHierarchyRow(parent, label, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const row = document.createElement('span');
    const key = document.createElement('strong');
    key.textContent = label;
    const val = document.createElement('span');
    val.textContent = text;
    row.append(key, val);
    parent.append(row);
  }

  function renderAddresses() {
    const list = $('#addressList');
    const emptyState = $('#emptyState');
    if (!list || !emptyState) return;

    list.replaceChildren();
    const hasAddresses = addresses.length > 0;
    emptyState.style.display = hasAddresses ? 'none' : 'flex';
    if (!hasAddresses) return;

    addresses.forEach((address) => {
      const card = document.createElement('article');
      card.className = `address-card${address.isDefault ? ' is-default' : ''}`;
      card.dataset.id = address.id;

      const row = document.createElement('div');
      row.className = 'address-row';

      const detail = document.createElement('div');
      const recipient = document.createElement('div');
      recipient.className = 'recipient';
      recipient.textContent = address.fullName || 'Saved address';
      const phone = document.createElement('div');
      phone.className = 'phone';
      phone.textContent = address.phone || '';

      const hierarchy = document.createElement('div');
      hierarchy.className = 'address-hierarchy';
      appendHierarchyRow(hierarchy, 'Province', address.provinceCity || address.city);
      appendHierarchyRow(hierarchy, 'District', address.district);
      appendHierarchyRow(hierarchy, 'Sector', address.sector);
      appendHierarchyRow(hierarchy, 'Cell', address.cell);
      appendHierarchyRow(hierarchy, 'Village', address.village);
      appendHierarchyRow(hierarchy, 'Street', address.street || address.line1);

      detail.append(recipient, phone, hierarchy);
      if (address.note) {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = address.note;
        detail.append(meta);
      }

      const badgeWrap = document.createElement('div');
      if (address.isDefault) {
        const badge = document.createElement('div');
        badge.className = 'default-badge';
        badge.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Default';
        badgeWrap.append(badge);
      }

      row.append(detail, badgeWrap);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-btn';
      edit.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edit';
      edit.addEventListener('click', () => openForm(address));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-btn';
      remove.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete';
      remove.addEventListener('click', () => deleteAddress(address));

      actions.append(edit, remove);
      if (!address.isDefault) {
        const makeDefault = document.createElement('button');
        makeDefault.type = 'button';
        makeDefault.className = 'default-btn';
        makeDefault.innerHTML = '<i class="fa-regular fa-star" aria-hidden="true"></i> Set as Default';
        makeDefault.addEventListener('click', () => setDefault(address));
        actions.append(makeDefault);
      }

      card.append(row, actions);
      list.append(card);
    });
  }

  function openForm(address) {
    editingId = String(address?.id || '');
    setError('');
    setStatus('');
    fillForm(address || null);
    setFormVisible(true);
  }

  async function refresh() {
    const api = addressesApi();
    if (!api) return;
    addresses = await api.list();
    renderAddresses();
  }

  async function saveAddress(event) {
    event.preventDefault();
    const api = addressesApi();
    if (!api) return;
    const payload = readForm();
    const saveBtn = $('#saveAddressBtn');
    setError('');
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (payload.id) {
        await api.update(payload.id, payload);
      } else {
        await api.create(payload);
      }
      await refresh();
      setFormVisible(false);
      editingId = '';
      setStatus('Address saved.');
    } catch (error) {
      setError(error?.message || 'Unable to save this address. Please try again.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteAddress(address) {
    if (!window.confirm('Remove this shipping address? Existing orders keep the address used when they were placed.')) {
      return;
    }
    try {
      await addressesApi().remove(address.id);
      if (editingId === address.id) {
        setFormVisible(false);
        editingId = '';
      }
      await refresh();
      setStatus('Address removed.');
    } catch (error) {
      window.alert(error?.message || 'Unable to delete this address.');
    }
  }

  async function setDefault(address) {
    try {
      await addressesApi().setDefault(address.id);
      await refresh();
      setStatus('Default address updated.');
    } catch (error) {
      window.alert(error?.message || 'Unable to set the default address.');
    }
  }

  async function init() {
    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(() => {});
    }
    const user = window.authService?.getCurrentUser?.();
    if (!user) return;

    document.querySelectorAll('.add-address-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openForm(null);
      });
    });
    $('#addressForm')?.addEventListener('submit', saveAddress);
    $('#cancelAddressBtn')?.addEventListener('click', () => {
      setFormVisible(false);
      editingId = '';
      setError('');
    });

    setStatus('Loading addresses…');
    try {
      await refresh();
      setStatus(addresses.length ? '' : '');
    } catch (error) {
      setStatus(error?.message || 'Unable to load your shipping addresses.', true);
      setFormVisible(false);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
