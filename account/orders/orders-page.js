(function () {
  const service = window.orderService;
  const root = document.getElementById('ordersApp');

  if (!service || !root) {
    return;
  }

  const VIEW_CONFIG = {
    all: {
      label: 'View All',
      subtitle: 'All orders',
      icon: 'fa-solid fa-layer-group'
    },
    pending: {
      label: 'Pending',
      subtitle: 'Awaiting confirmation',
      icon: 'fa-solid fa-hourglass-half'
    },
    shipping: {
      label: 'Shipping',
      subtitle: 'On the way to you',
      icon: 'fa-solid fa-truck-fast'
    },
    delivered: {
      label: 'Delivered',
      subtitle: 'Completed purchases',
      icon: 'fa-solid fa-circle-check'
    },
    returns: {
      label: 'Returns',
      subtitle: 'Returned or refunded orders',
      icon: 'fa-solid fa-rotate-left'
    },
    cancelled: {
      label: 'Cancelled',
      subtitle: 'Cancelled orders',
      icon: 'fa-solid fa-ban'
    }
  };

  const TRACKING_STEPS = ['pending', 'confirmed', 'shipping', 'delivered'];
  const view = document.body.dataset.ordersView || 'all';
  const FALLBACK_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Crect width="96" height="96" rx="20" fill="%23E9F8F3"/%3E%3Cpath d="M27 62h42v4H27z" fill="%2300B894" fill-opacity=".2"/%3E%3Crect x="29" y="26" width="38" height="28" rx="10" fill="%2300B894" fill-opacity=".18"/%3E%3Cpath d="M39 38h18v4H39zm0 8h12v4H39z" fill="%23008F72"/%3E%3C/svg%3E';
  const state = {
    query: '',
    sortBy: 'newest',
    filterMenuOpen: false
  };

  function formatDate(value) {
    if (!value) {
      return 'No date';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'No date';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getItemSummary(item) {
    const parts = [];
    if (item.size) {
      parts.push(`Size ${item.size}`);
    }
    if (item.color) {
      parts.push(`Color ${item.color}`);
    }
    return parts.join(' • ') || 'Standard option';
  }

  function getTrackingIndex(status) {
    const index = TRACKING_STEPS.indexOf(String(status || '').toLowerCase());
    return index === -1 ? 0 : index;
  }

  function createTimeline(order) {
    if (order.orderStatus === 'cancelled' || order.orderStatus === 'returned') {
      return '';
    }

    const currentIndex = getTrackingIndex(order.orderStatus);
    return `
      <div class="orders-timeline" aria-label="Order tracking progress">
        ${TRACKING_STEPS.map((step, index) => {
          const label = VIEW_CONFIG[step]?.label || (step.charAt(0).toUpperCase() + step.slice(1));
          const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : '';
          return `<div class="orders-timeline-step ${state}">${escapeHtml(label)}</div>`;
        }).join('')}
      </div>
    `;
  }

  function createStatusNav(groups) {
    return Object.entries(VIEW_CONFIG).map(([key, config]) => {
      const count = key === 'all'
        ? Object.values(groups).reduce((sum, list) => sum + list.length, 0)
        : groups[key]?.length || 0;
      const activeClass = key === view ? 'is-active' : '';
      return `
        <a class="orders-tab ${activeClass}" href="${escapeHtml(key)}.html" aria-current="${key === view ? 'page' : 'false'}">
          <span>${escapeHtml(config.label)}</span>
          <small>${count}</small>
        </a>
      `;
    }).join('');
  }

  function getViewOrders(groups, allOrders) {
    if (view === 'all') {
      return allOrders.slice();
    }

    return groups[view] || [];
  }

  function matchesSearch(order, query) {
    if (!query) {
      return true;
    }

    const haystack = [
      order.orderId,
      order.customerName,
      order.statusLabel,
      order.trackingMessage,
      ...order.items.map((item) => `${item.productName} ${item.size} ${item.color}`)
    ].join(' ').toLowerCase();

    return haystack.includes(query.toLowerCase());
  }

  function sortOrders(orders, sortBy) {
    const list = orders.slice();
    if (sortBy === 'oldest') {
      return list.sort((left, right) => new Date(left.createdAt || left.date || 0) - new Date(right.createdAt || right.date || 0));
    }
    if (sortBy === 'amount') {
      return list.sort((left, right) => Number(right.totalAmount || 0) - Number(left.totalAmount || 0));
    }
    return list.sort((left, right) => new Date(right.createdAt || right.date || 0) - new Date(left.createdAt || left.date || 0));
  }

  function createHeader(config) {
    return `
      <section class="orders-app-header" aria-label="Orders tools">
        <a class="orders-app-icon orders-app-back" href="../account.html" aria-label="Back to account">
          <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
        </a>
        <label class="orders-search" for="ordersSearchInput">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input id="ordersSearchInput" type="search" placeholder="Search orders" value="${escapeHtml(state.query)}" autocomplete="off">
        </label>
        <button class="orders-app-icon ${state.filterMenuOpen ? 'is-active' : ''}" type="button" id="ordersFilterButton" aria-label="Open filters" aria-expanded="${state.filterMenuOpen ? 'true' : 'false'}" aria-haspopup="menu" aria-controls="ordersFilterMenu">
          <i class="fa-solid fa-sliders" aria-hidden="true"></i>
        </button>
        <a class="orders-app-icon" href="../settings/guide.html" aria-label="Get support">
          <i class="fa-regular fa-circle-question" aria-hidden="true"></i>
        </a>
      </section>
      <section class="orders-view-bar" aria-label="Current orders view">
        <div>
          <p class="orders-view-kicker">My Orders</p>
          <h1>${escapeHtml(config.label)}</h1>
        </div>
      </section>
    `;
  }

  function createFilterMenu() {
    return `
      <section class="orders-filter-menu ${state.filterMenuOpen ? 'is-open' : ''}" id="ordersFilterMenu" role="menu" aria-label="Sort orders" ${state.filterMenuOpen ? '' : 'hidden'}>
        <button class="orders-filter-option ${state.sortBy === 'newest' ? 'is-active' : ''}" type="button" data-sort="newest" role="menuitemradio" aria-checked="${state.sortBy === 'newest' ? 'true' : 'false'}">Newest first</button>
        <button class="orders-filter-option ${state.sortBy === 'oldest' ? 'is-active' : ''}" type="button" data-sort="oldest" role="menuitemradio" aria-checked="${state.sortBy === 'oldest' ? 'true' : 'false'}">Oldest first</button>
        <button class="orders-filter-option ${state.sortBy === 'amount' ? 'is-active' : ''}" type="button" data-sort="amount" role="menuitemradio" aria-checked="${state.sortBy === 'amount' ? 'true' : 'false'}">Highest amount</button>
      </section>
    `;
  }

  function createOrderCard(order) {
    const firstItem = order.items[0] || {};
    const moreItems = Math.max(0, order.itemCount - Number(firstItem.quantity || 0));
    const imageSource = firstItem.image || firstItem.imageUrl || FALLBACK_IMAGE;
    return `
      <article class="orders-card">
        <img class="orders-card-image" src="${escapeHtml(imageSource)}" alt="${escapeHtml(firstItem.productName || 'Product')} product image" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';this.classList.add('is-fallback-image');">
        <div class="orders-card-main">
          <div class="orders-card-header">
            <div>
              <h2 class="orders-card-title">${escapeHtml(firstItem.productName || 'Product')}</h2>
              <div class="orders-card-subline">
                <span>${escapeHtml(getItemSummary(firstItem))}</span>
                ${moreItems ? `<span>+${moreItems} more item${moreItems === 1 ? '' : 's'}</span>` : ''}
              </div>
            </div>
            <span class="orders-badge" data-tone="${escapeHtml(order.statusTone)}"><i class="${escapeHtml(order.statusIcon)}" aria-hidden="true"></i>${escapeHtml(order.statusLabel)}</span>
          </div>
          <div class="orders-card-meta">
            <span>Qty ${Number(firstItem.quantity || 1)}</span>
            <span>${escapeHtml(service.formatCurrency(firstItem.price || 0))}</span>
            <span>${escapeHtml(order.orderId)}</span>
            <span>${escapeHtml(formatDate(order.createdAt || order.date))}</span>
          </div>
          <div class="orders-card-tracking">${escapeHtml(order.trackingMessage)}</div>
          ${createTimeline(order)}
          <div class="orders-card-actions">
            <a class="orders-action-link" href="../order-details.html?id=${encodeURIComponent(order.orderId)}"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Track order</a>
          </div>
        </div>
      </article>
    `;
  }

  function createEmptyState(currentUser) {
    const config = VIEW_CONFIG[view] || VIEW_CONFIG.pending;
    if (!currentUser || !(currentUser.id || currentUser.userId || currentUser.email || currentUser.phone)) {
      return `
        <section class="orders-login-state orders-panel">
          <i class="fa-solid fa-user-lock" aria-hidden="true"></i>
          <h2>Sign in to view your orders</h2>
          <p>Your My Orders page only loads orders linked to your account or saved contact details.</p>
          <a class="orders-action-link" href="../../login.html">Go to login</a>
        </section>
      `;
    }

    return `
      <section class="orders-empty-state orders-panel">
        <i class="${escapeHtml(config.icon)}" aria-hidden="true"></i>
        <h2>No ${escapeHtml(config.label.toLowerCase())} orders yet</h2>
        <p>${escapeHtml(config.subtitle)} orders will appear here as soon as your checkout flow creates them or their status changes.</p>
      </section>
    `;
  }

  async function render() {
    const currentUser = service.getCurrentUser();
    const allOrders = await service.getOrders(currentUser?.id || currentUser?.userId || '');
    const groups = service.groupOrders(allOrders);
    const currentOrders = getViewOrders(groups, allOrders)
      .filter((order) => matchesSearch(order, state.query));
    const sortedOrders = sortOrders(currentOrders, state.sortBy);
    const config = VIEW_CONFIG[view] || VIEW_CONFIG.pending;

    root.innerHTML = `
      ${createHeader(config)}
      <section class="orders-tabs-shell">
        <div class="orders-tabs" role="tablist" aria-label="Order status tabs">${createStatusNav(groups)}</div>
        ${createFilterMenu()}
      </section>
      <section class="orders-list">${sortedOrders.length ? sortedOrders.map(createOrderCard).join('') : createEmptyState(currentUser)}</section>
    `;

    document.getElementById('ordersSearchInput')?.addEventListener('input', handleSearchInput);
    document.getElementById('ordersFilterButton')?.addEventListener('click', toggleFilterMenu);
    document.querySelectorAll('[data-sort]').forEach((button) => {
      button.addEventListener('click', handleSortChange);
    });
  }

  function handleSearchInput(event) {
    state.query = String(event.target.value || '');
    render();
  }

  function toggleFilterMenu() {
    state.filterMenuOpen = !state.filterMenuOpen;
    render();
  }

  function handleSortChange(event) {
    state.sortBy = String(event.currentTarget.dataset.sort || 'newest');
    state.filterMenuOpen = false;
    render();
  }

  let refreshFrame = 0;
  function queueRender() {
    if (refreshFrame) {
      window.cancelAnimationFrame(refreshFrame);
    }
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      render();
    });
  }

  const unsubscribe = service.subscribe(queueRender);
  window.addEventListener('focus', queueRender);
  document.addEventListener('click', (event) => {
    if (!state.filterMenuOpen) {
      return;
    }

    if (event.target.closest('#ordersFilterButton') || event.target.closest('#ordersFilterMenu')) {
      return;
    }

    state.filterMenuOpen = false;
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      queueRender();
    }
  });

  window.addEventListener('beforeunload', () => {
    unsubscribe();
  });

  render();
})();