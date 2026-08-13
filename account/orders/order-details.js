(function () {
  const service = window.orderService;
  const root = document.getElementById('orderDetailsApp');

  if (!service || !root) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('id') || '';
  const FALLBACK_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Crect width="96" height="96" rx="20" fill="%23E9F8F3"/%3E%3Cpath d="M27 62h42v4H27z" fill="%2300B894" fill-opacity=".2"/%3E%3Crect x="29" y="26" width="38" height="28" rx="10" fill="%2300B894" fill-opacity=".18"/%3E%3Cpath d="M39 38h18v4H39zm0 8h12v4H39z" fill="%23008F72"/%3E%3C/svg%3E';
  const TRACKING_STEPS = [
    { key: 'pending', label: 'Order received' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'shipping', label: 'Shipping' },
    { key: 'delivered', label: 'Delivered' }
  ];

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(value) {
    if (!value) {
      return 'No timestamp';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'No timestamp';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function getStageIndex(status) {
    const orderStatus = String(status || '').toLowerCase();
    const index = TRACKING_STEPS.findIndex((step) => step.key === orderStatus);
    return index === -1 ? 0 : index;
  }

  function renderTimeline(order) {
    if (order.orderStatus === 'cancelled' || order.orderStatus === 'returned') {
      return `<p class="orders-detail-note">Current status: ${escapeHtml(order.statusLabel)}. This order is no longer moving through the standard delivery flow.</p>`;
    }

    const currentIndex = getStageIndex(order.orderStatus);
    return `
      <div class="orders-timeline" aria-label="Order tracking stages">
        ${TRACKING_STEPS.map((step, index) => {
          const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : '';
          return `<div class="orders-timeline-step ${state}">${escapeHtml(step.label)}</div>`;
        }).join('')}
      </div>
    `;
  }

  function renderAddress(order) {
    const address = order.fullAddress || {};
    const gps = order.gpsLocation || {};
    const rows = [
      ['Province', address.province],
      ['District', address.district],
      ['Sector', address.sector],
      ['Cell', address.cell],
      ['Village', address.village],
      ['Street', address.street],
      ['Phone', order.phoneNumber],
      ['GPS', gps.latitude && gps.longitude ? `${gps.latitude}, ${gps.longitude}` : '']
    ].filter(([, value]) => Boolean(value));

    return `
      <div class="orders-address-grid">
        ${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
      </div>
      ${gps.googleMapsLink || gps.mapLink ? `<p class="orders-detail-note"><a class="orders-map-link" href="${escapeHtml(gps.googleMapsLink || gps.mapLink)}" target="_blank" rel="noreferrer noopener"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>Open Google Maps location</a></p>` : ''}
    `;
  }

  function renderItems(order) {
    return order.items.map((item) => `
      <article class="orders-item-card">
        <img src="${escapeHtml(item.image || FALLBACK_IMAGE)}" alt="${escapeHtml(item.productName)} product image" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';this.classList.add('is-fallback-image');">
        <div>
          <div class="orders-item-heading">
            <h3>${escapeHtml(item.productName)}</h3>
            <strong>${escapeHtml(service.formatCurrency(item.price || 0))}</strong>
          </div>
          <div class="orders-item-meta">
            <span>${escapeHtml(item.size ? `Size ${item.size}` : 'Standard size')}</span>
            <span>${escapeHtml(item.color ? `Color ${item.color}` : 'Standard color')}</span>
            <span>Qty ${Number(item.quantity || 1)}</span>
            <strong>${escapeHtml(service.formatCurrency((Number(item.price || 0) * Number(item.quantity || 0)) || 0))}</strong>
          </div>
        </div>
      </article>
    `).join('');
  }

  function getPaymentLabel(order) {
    const method = String(order?.paymentMethod || '').trim().toLowerCase();
    if (method === 'cod') return 'Cash on Delivery';
    if (method === 'mtn') return 'MTN MoMo';
    if (method === 'card') return 'Card';
    if (method === 'dpo') return order?.paymentMethodLabel || 'Card / MTN MoMo';
    return order?.paymentMethodLabel || 'Not set';
  }

  async function render() {
    const currentUser = service.getCurrentUser();
    if (!currentUser || !(currentUser.id || currentUser.userId)) {
      root.innerHTML = `
        <div class="orders-topbar"><a class="orders-detail-back" href="account.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>Back to account</a></div>
        <section class="orders-login-state orders-panel">
          <i class="fa-solid fa-user-lock" aria-hidden="true"></i>
          <h2>Sign in to view this order</h2>
          <p>Order tracking is only available for the account that placed the order.</p>
          <a class="orders-action-link" href="../login.html">Go to login</a>
        </section>
      `;
      return;
    }

    const order = await service.getOrderById(orderId, currentUser.id || currentUser.userId || '');
    if (!order) {
      root.innerHTML = `
        <div class="orders-topbar"><a class="orders-detail-back" href="account.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>Back to account</a></div>
        <section class="orders-empty-state orders-panel">
          <i class="fa-solid fa-box-open" aria-hidden="true"></i>
          <h2>Order not found</h2>
          <p>The requested order is not linked to your account or has not been created yet.</p>
        </section>
      `;
      return;
    }

    root.innerHTML = `
      <div class="orders-topbar">
        <a class="orders-detail-back" href="account.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>Back to account</a>
        <a class="orders-action-link" href="orders/${escapeHtml(order.groupKey)}.html"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>Open ${escapeHtml(order.statusLabel)} orders</a>
      </div>
      <section class="orders-detail-hero">
        <p class="orders-kicker">Order tracking</p>
        <h1>${escapeHtml(order.orderId)}</h1>
        <p>${escapeHtml(order.customerName)} • ${escapeHtml(formatDateTime(order.createdAt || order.date))}</p>
        <span class="orders-badge" data-tone="${escapeHtml(order.statusTone)}"><i class="${escapeHtml(order.statusIcon)}" aria-hidden="true"></i>${escapeHtml(order.statusLabel)}</span>
        <div class="orders-detail-live"><i class="fa-solid fa-signal" aria-hidden="true"></i>Live updates enabled</div>
      </section>
      <section class="orders-detail-grid">
        <div>
          <article class="orders-detail-card orders-detail-section">
            <h2>Tracking progress</h2>
            <p>${escapeHtml(order.trackingMessage)}</p>
            ${renderTimeline(order)}
          </article>
          <article class="orders-detail-card orders-detail-section">
            <h2>Delivery details</h2>
            ${renderAddress(order)}
          </article>
          <article class="orders-detail-card orders-detail-section">
            <h2>Items in this order</h2>
            <div class="orders-item-list">${renderItems(order)}</div>
          </article>
        </div>
        <div>
          <article class="orders-detail-card orders-detail-section">
            <h3>Order summary</h3>
            <div class="orders-detail-summary">
              <div><span>Subtotal</span><strong>${escapeHtml(service.formatCurrency(order.subtotal || 0))}</strong></div>
              <div><span>Delivery fee</span><strong>${escapeHtml(service.formatCurrency(order.deliveryFee || 0))}</strong></div>
              <div><span>Total</span><strong>${escapeHtml(service.formatCurrency(order.totalAmount || 0))}</strong></div>
              <div><span>Payment</span><strong>${escapeHtml(getPaymentLabel(order))}</strong></div>
            </div>
            <p class="orders-detail-note">Payment status: ${escapeHtml(order.paymentStatus || 'pending')}.</p>
          </article>
        </div>
      </section>
    `;
  }

  const unsubscribe = service.subscribe(render);
  window.addEventListener('focus', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      render();
    }
  });
  window.addEventListener('beforeunload', () => {
    unsubscribe();
  });

  render();
})();