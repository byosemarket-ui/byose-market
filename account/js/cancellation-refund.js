(function () {
  'use strict';

  var state = {
    orders: [],
    selectedOrderId: '',
    loading: false,
    submitting: false
  };

  function apiOrigin() {
    var explicit = String(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '').replace(/\/+$/, '');
    if (explicit) return explicit.replace(/\/api$/i, '');
    var hostname = String(window.location?.hostname || '');
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://' + (hostname || 'localhost') + ':5000';
    }
    return String(window.location?.origin || '').replace(/\/+$/, '');
  }

  function money(value) {
    var amount = Number(value || 0) || 0;
    try {
      return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(amount);
    } catch (_error) {
      return amount + ' RWF';
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Kigali'
      }).format(date);
    } catch (_error) {
      return date.toLocaleString();
    }
  }

  function setStatus(type, message) {
    var el = document.getElementById('refundActionStatus');
    if (!el) return;
    el.className = 'refund-status' + (type ? ' is-' + type : '');
    el.textContent = message || '';
    el.hidden = !message;
  }

  function selectedOrder() {
    return state.orders.find(function (order) {
      return String(order.orderId) === String(state.selectedOrderId);
    }) || null;
  }

  function eligibleActions(order) {
    return (order?.eligibility?.actions || []).filter(function (action) {
      return action.eligible;
    });
  }

  function renderOrders() {
    var list = document.getElementById('refundOrdersList');
    var empty = document.getElementById('refundOrdersEmpty');
    if (!list) return;

    if (!state.orders.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    list.innerHTML = state.orders.map(function (order) {
      var selected = String(order.orderId) === String(state.selectedOrderId);
      var request = order.request;
      var canAct = eligibleActions(order).length > 0;
      var badge = request
        ? '<span class="badge badge-info">' + escapeHtml(request.statusLabel) + '</span>'
        : (canAct
          ? '<span class="badge badge-ok">Actions available</span>'
          : '<span class="badge">No open action</span>');
      var itemNames = (order.items || []).slice(0, 2).map(function (item) {
        return escapeHtml(item.productName);
      }).join(', ') || 'Order items';

      return [
        '<button type="button" class="order-card' + (selected ? ' is-selected' : '') + '" data-order-id="' + escapeHtml(order.orderId) + '">',
        '  <div class="order-card-top">',
        '    <strong>' + escapeHtml(order.orderId) + '</strong>',
        badge,
        '  </div>',
        '  <div class="order-card-meta">' + escapeHtml(order.status) + ' · ' + money(order.totalAmount) + '</div>',
        '  <div class="order-card-meta">Placed ' + escapeHtml(formatDate(order.createdAt)) + '</div>',
        '  <div class="order-card-items">' + itemNames + '</div>',
        '</button>'
      ].join('');
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('[data-order-id]'), function (button) {
      button.addEventListener('click', function () {
        state.selectedOrderId = button.getAttribute('data-order-id');
        renderOrders();
        renderDetail();
      });
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderDetail() {
    var panel = document.getElementById('refundOrderDetail');
    if (!panel) return;
    var order = selectedOrder();
    if (!order) {
      panel.innerHTML = '<p class="muted">Select one of your orders to check eligibility or submit a request.</p>';
      return;
    }

    var actions = order.eligibility?.actions || [];
    var eligible = eligibleActions(order);
    var request = order.request;
    var reasonOptions = eligible
      .filter(function (action) { return action.reasonCode !== 'cancel'; })
      .map(function (action) {
        return '<option value="' + escapeHtml(action.reasonCode) + '">' + escapeHtml(reasonLabel(action.reasonCode)) + '</option>';
      }).join('');

    var eligibilityRows = actions.map(function (action) {
      return [
        '<div class="eligibility-row">',
        '  <div>',
        '    <strong>' + escapeHtml(reasonLabel(action.reasonCode)) + '</strong>',
        '    <p>' + escapeHtml(action.reason) + '</p>',
        '  </div>',
        '  <span class="badge ' + (action.eligible ? 'badge-ok' : '') + '">' + (action.eligible ? 'Eligible' : 'Not available') + '</span>',
        '</div>'
      ].join('');
    }).join('');

    var requestBlock = request ? [
      '<div class="detail-card">',
      '  <h3>Request status</h3>',
      '  <p><strong>' + escapeHtml(request.statusLabel) + '</strong></p>',
      request.reasonLabel ? '<p class="muted">' + escapeHtml(request.reasonLabel) + '</p>' : '',
      request.requestedAt ? '<p class="muted">Submitted ' + escapeHtml(formatDate(request.requestedAt)) + '</p>' : '',
      request.refundMethodLabel ? '<p class="muted">Refund method (when approved): ' + escapeHtml(request.refundMethodLabel) + '</p>' : '',
      request.processingNote ? '<p class="note">' + escapeHtml(request.processingNote) + '</p>' : '',
      request.refundCompletedAt ? '<p class="muted">Refund recorded ' + escapeHtml(formatDate(request.refundCompletedAt)) + '</p>' : '',
      '</div>'
    ].join('') : '';

    var cancelBlock = order.eligibility?.canCancel ? [
      '<div class="detail-card">',
      '  <h3>Cancel this order</h3>',
      '  <p class="muted">Allowed within 48 business hours of placing the order, and only before dispatch.</p>',
      '  <label class="field-label" for="cancelReasonInput">Optional reason</label>',
      '  <textarea id="cancelReasonInput" rows="2" maxlength="400" placeholder="Why are you cancelling?"></textarea>',
      '  <button type="button" class="btn btn-danger" id="cancelOrderBtn">Cancel order</button>',
      '</div>'
    ].join('') : '';

    var returnBlock = reasonOptions ? [
      '<div class="detail-card">',
      '  <h3>Request a return or refund</h3>',
      '  <label class="field-label" for="returnReasonSelect">Reason</label>',
      '  <select id="returnReasonSelect">' + reasonOptions + '</select>',
      '  <label class="field-label" for="returnNotesInput">Explanation</label>',
      '  <textarea id="returnNotesInput" rows="3" maxlength="800" placeholder="Share any details that help us review your request"></textarea>',
      '  <div id="returnAttestations" class="attestations" hidden>',
      '    <label class="check-row"><input type="checkbox" id="attestUnused"> Product is unused</label>',
      '    <label class="check-row"><input type="checkbox" id="attestPackaging"> Product is in original packaging</label>',
      '  </div>',
      '  <button type="button" class="btn btn-primary" id="submitReturnBtn">Submit request</button>',
      '</div>'
    ].join('') : [
      '<div class="detail-card">',
      '  <h3>Return / refund request</h3>',
      '  <p class="muted">No return or refund action is currently available for this order under the policy windows.</p>',
      '</div>'
    ].join('');

    panel.innerHTML = [
      '<div class="detail-card">',
      '  <h3>' + escapeHtml(order.orderId) + '</h3>',
      '  <p class="muted">' + escapeHtml(order.status) + ' · ' + money(order.totalAmount) + ' · ' + escapeHtml(order.paymentMethodLabel || order.paymentMethod || '') + '</p>',
      '  <p class="muted">Placed ' + escapeHtml(formatDate(order.createdAt)) + '</p>',
      order.deliveredAt ? '<p class="muted">Delivered ' + escapeHtml(formatDate(order.deliveredAt)) + '</p>' : '',
      '</div>',
      requestBlock,
      '<div class="detail-card"><h3>Eligibility</h3>' + eligibilityRows + '</div>',
      cancelBlock,
      returnBlock
    ].join('');

    var reasonSelect = document.getElementById('returnReasonSelect');
    if (reasonSelect) {
      reasonSelect.addEventListener('change', syncAttestations);
      syncAttestations();
    }
    document.getElementById('cancelOrderBtn')?.addEventListener('click', function () {
      void submitCancel();
    });
    document.getElementById('submitReturnBtn')?.addEventListener('click', function () {
      void submitReturn();
    });
  }

  function reasonLabel(code) {
    var map = {
      cancel: 'Order cancellation',
      delivery_delay: 'Delivery delay',
      incorrect_product: 'Incorrect product received',
      description_mismatch: 'Product significantly different from description',
      unsuitable_product: 'Product unsuitable for intended purpose'
    };
    return map[code] || code;
  }

  function syncAttestations() {
    var select = document.getElementById('returnReasonSelect');
    var box = document.getElementById('returnAttestations');
    if (!select || !box) return;
    var needs = select.value === 'description_mismatch' || select.value === 'unsuitable_product';
    box.hidden = !needs;
  }

  async function authFetch(path, options) {
    if (!window.authService?.authFetch) {
      throw new Error('Please sign in again.');
    }
    var response = await window.authService.authFetch(apiOrigin() + path, options || {});
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload?.success) {
      var error = new Error(payload?.message || 'Request failed');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function loadCenter() {
    state.loading = true;
    setStatus('saving', 'Loading your orders…');
    try {
      var payload = await authFetch('/api/orders/cancellation-refunds', {
        headers: { Accept: 'application/json' }
      });
      state.orders = Array.isArray(payload.orders) ? payload.orders : [];
      if (!state.selectedOrderId && state.orders[0]) {
        state.selectedOrderId = state.orders[0].orderId;
      } else if (state.selectedOrderId) {
        var stillThere = state.orders.some(function (order) {
          return String(order.orderId) === String(state.selectedOrderId);
        });
        if (!stillThere) state.selectedOrderId = state.orders[0]?.orderId || '';
      }
      renderOrders();
      renderDetail();
      setStatus('', '');
    } catch (error) {
      setStatus('error', error.message || 'Unable to load your orders.');
      renderOrders();
      renderDetail();
    } finally {
      state.loading = false;
    }
  }

  async function submitCancel() {
    if (state.submitting) return;
    var order = selectedOrder();
    if (!order) return;
    state.submitting = true;
    setStatus('saving', 'Cancelling order…');
    var btn = document.getElementById('cancelOrderBtn');
    if (btn) btn.disabled = true;
    try {
      var reason = String(document.getElementById('cancelReasonInput')?.value || '').trim();
      var payload = await authFetch('/api/orders/' + encodeURIComponent(order.orderId) + '/status', {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'Cancelled', reason: reason || 'Cancelled by customer' })
      });
      if (payload.order) {
        state.orders = state.orders.map(function (entry) {
          return String(entry.orderId) === String(payload.order.orderId) ? payload.order : entry;
        });
      }
      renderOrders();
      renderDetail();
      setStatus('success', payload.message || 'Order cancelled successfully.');
      try {
        window.dispatchEvent(new CustomEvent('byose:orders-changed', { detail: { action: 'cancel', orderId: order.orderId } }));
      } catch (_error) {}
      await loadCenter();
      setStatus('success', payload.message || 'Order cancelled successfully.');
    } catch (error) {
      setStatus('error', error.message || 'Unable to cancel this order.');
    } finally {
      state.submitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function submitReturn() {
    if (state.submitting) return;
    var order = selectedOrder();
    if (!order) return;
    var reasonCode = String(document.getElementById('returnReasonSelect')?.value || '').trim();
    if (!reasonCode) {
      setStatus('error', 'Select a reason for your request.');
      return;
    }
    var needsAttest = reasonCode === 'description_mismatch' || reasonCode === 'unsuitable_product';
    var unused = !!document.getElementById('attestUnused')?.checked;
    var packaging = !!document.getElementById('attestPackaging')?.checked;
    if (needsAttest && (!unused || !packaging)) {
      setStatus('error', 'Confirm the product is unused and in its original packaging.');
      return;
    }

    state.submitting = true;
    setStatus('saving', 'Submitting your request…');
    var btn = document.getElementById('submitReturnBtn');
    if (btn) btn.disabled = true;
    try {
      var payload = await authFetch('/api/orders/' + encodeURIComponent(order.orderId) + '/return-request', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reasonCode: reasonCode,
          customerNotes: String(document.getElementById('returnNotesInput')?.value || '').trim(),
          attestUnused: unused,
          attestOriginalPackaging: packaging
        })
      });
      await loadCenter();
      setStatus('success', payload.message || 'Request submitted.');
      try {
        window.dispatchEvent(new CustomEvent('byose:orders-changed', { detail: { action: 'return-request', orderId: order.orderId } }));
      } catch (_error) {}
    } catch (error) {
      setStatus('error', error.message || 'Unable to submit this request.');
    } finally {
      state.submitting = false;
      if (btn) btn.disabled = false;
    }
  }

  function bindAccordions() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-accordion-btn]'), function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-accordion-btn');
        var panel = document.querySelector('[data-accordion-panel="' + id + '"]');
        var open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (panel) panel.hidden = open;
      });
    });
  }

  async function init() {
    bindAccordions();
    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(function () {});
    }
    await loadCenter();
  }

  document.addEventListener('DOMContentLoaded', function () {
    void init();
  });
})();
