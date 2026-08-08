(function () {
  'use strict';

  const root = document.getElementById('couponItems');
  const statusHost = document.getElementById('couponsStatusHost');
  const form = document.getElementById('applyCouponForm');
  const input = document.getElementById('couponCodeInput');
  const countChip = document.getElementById('couponsCountChip');
  const countLabel = document.getElementById('couponsCountLabel');
  const toast = document.getElementById('couponsToast');
  const tabs = Array.from(document.querySelectorAll('.af-tab'));
  let activeStatus = 'available';
  let latestCounts = { available: 0, used: 0, expired: 0, not_eligible: 0, total: 0 };
  let toastTimer = null;
  let loading = false;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function formatDate(value) {
    if (!value) return 'No expiry';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No expiry';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function showToast(message, type) {
    if (!toast || !message) return;
    toast.textContent = message;
    toast.classList.remove('is-error', 'is-success', 'is-visible');
    if (type === 'error') toast.classList.add('is-error');
    if (type === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function setActiveTab(status) {
    activeStatus = status || 'available';
    tabs.forEach((node) => {
      const active = node.dataset.status === activeStatus;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setCounts(counts) {
    latestCounts = counts || latestCounts;
    const available = Number(latestCounts.available || 0);
    if (countChip) countChip.hidden = available <= 0 && activeStatus === 'available';
    if (countLabel) countLabel.textContent = `${available} available`;
    try {
      window.dispatchEvent(new CustomEvent('byose:coupons-updated', {
        detail: { counts: latestCounts, source: 'coupons-page' }
      }));
    } catch (_error) {}
  }

  function describeApplicability(coupon) {
    const products = coupon?.applicableProducts;
    const categories = coupon?.applicableCategories;
    const productLabel = Array.isArray(products)
      ? (products.length ? `Selected products (${products.length})` : 'Selected products')
      : (String(products || 'all').toLowerCase() === 'all' ? 'All products' : String(products));
    const categoryLabel = Array.isArray(categories)
      ? (categories.length ? `Selected categories (${categories.length})` : 'Selected categories')
      : (String(categories || 'all').toLowerCase() === 'all' ? 'All categories' : String(categories));
    return `${productLabel} · ${categoryLabel}`;
  }

  function renderLoading() {
    statusHost.replaceChildren();
    root.className = 'coupons-skeleton';
    root.replaceChildren();
    for (let i = 0; i < 3; i += 1) {
      const card = document.createElement('div');
      card.className = 'coupons-skeleton__card';
      root.append(card);
    }
  }

  function renderError(message) {
    root.className = '';
    root.replaceChildren();
    statusHost.replaceChildren();
    const box = document.createElement('div');
    box.className = 'coupons-error';
    box.innerHTML = `
      <div class="coupons-error__icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h2>Unable to load coupons</h2>
      <p>${escapeHtml(message || 'We could not load your coupons right now.')}</p>
    `;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'af-button is-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => loadCoupons());
    box.append(retry);
    statusHost.append(box);
  }

  function renderEmpty() {
    root.className = '';
    root.replaceChildren();
    statusHost.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'coupons-empty';
    const title = activeStatus === 'available'
      ? 'No Coupons Available'
      : `No ${activeStatus.replace('_', ' ')} coupons`;
    const copy = activeStatus === 'available'
      ? 'Available discount coupons will appear here when assigned to your account.'
      : 'Nothing to show in this category yet.';
    empty.innerHTML = `
      <div class="coupons-empty__icon" aria-hidden="true"><i class="fa-solid fa-ticket"></i></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(copy)}</p>
      <a class="af-button is-primary" href="../../shop.html">Continue Shopping</a>
    `;
    root.append(empty);
  }

  function render(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    setCounts(payload?.counts || latestCounts);
    statusHost.replaceChildren();
    root.className = 'coupons-list';
    root.replaceChildren();

    if (!items.length) {
      renderEmpty();
      return;
    }

    items.forEach((entry) => {
      const coupon = entry.coupon || {};
      const status = entry.status || 'available';
      const article = document.createElement('article');
      article.className = `coupon-card is-${status}`;

      const usageLimit = Number(coupon.usageLimit || 0);
      const perUser = Number(coupon.perUserLimit || 0);
      const usageLabel = perUser === 1
        ? 'Single use per customer'
        : (perUser > 1 ? `${perUser} uses per customer` : (usageLimit > 0 ? `${usageLimit} total uses` : 'No personal usage limit'));

      article.innerHTML = `
        <div class="coupon-card__rail" aria-hidden="true">
          <i class="fa-solid fa-ticket"></i>
          <span class="coupon-card__rail-label">${escapeHtml(status.replace('_', ' '))}</span>
        </div>
        <div class="coupon-card__content">
          <div class="coupon-card__top">
            <div>
              <h2 class="coupon-card__title">${escapeHtml(coupon.title || coupon.discountLabel || 'Coupon')}</h2>
              <p class="coupon-card__subtitle">${escapeHtml(coupon.description || coupon.discountLabel || '')}</p>
            </div>
            <span class="coupon-card__status is-${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>
          </div>
          <span class="coupon-card__code" aria-label="Coupon code">${escapeHtml(coupon.code || '')}</span>
          <dl class="coupon-card__meta">
            <div><strong>Discount</strong> <span>${escapeHtml(coupon.discountLabel || '')}</span></div>
            <div><strong>Minimum order</strong> <span>${Number(coupon.minOrderAmount || 0) > 0 ? formatCurrency(coupon.minOrderAmount) : 'No minimum'}</span></div>
            ${Number(coupon.maxDiscountAmount || 0) > 0 ? `<div><strong>Max discount</strong> <span>${formatCurrency(coupon.maxDiscountAmount)}</span></div>` : ''}
            <div><strong>Expires</strong> <span>${escapeHtml(formatDate(coupon.expiresAt))}</span></div>
            <div><strong>Applies to</strong> <span>${escapeHtml(describeApplicability(coupon))}</span></div>
            <div><strong>Usage</strong> <span>${escapeHtml(usageLabel)}</span></div>
            ${entry.eligibilityReason ? `<div><strong>Note</strong> <span>${escapeHtml(entry.eligibilityReason)}</span></div>` : ''}
          </dl>
          <div class="coupon-card__actions"></div>
        </div>
      `;

      const actions = article.querySelector('.coupon-card__actions');
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'af-button';
      copyBtn.setAttribute('aria-label', `Copy coupon code ${coupon.code || ''}`);
      copyBtn.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i> Copy Code';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(String(coupon.code || ''));
          showToast('Coupon code copied.', 'success');
        } catch (_error) {
          showToast('Unable to copy code. Please copy it manually.', 'error');
        }
      });
      actions.append(copyBtn);

      if (status === 'available') {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'af-button is-primary';
        useBtn.setAttribute('aria-label', `Use coupon ${coupon.code || ''}`);
        useBtn.innerHTML = '<i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> Use Coupon';
        useBtn.addEventListener('click', () => {
          window.couponService.setSelectedCoupon(coupon);
          showToast('Coupon saved for checkout.', 'success');
          window.setTimeout(() => {
            window.location.href = '../../shop.html';
          }, 450);
        });
        actions.append(useBtn);
      }

      root.append(article);
    });
  }

  async function loadCoupons() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      const coupons = await window.couponService.getCoupons(activeStatus);
      render(coupons);
    } catch (error) {
      renderError(error?.status === 401
        ? 'Please sign in to view your coupons.'
        : 'We could not load your coupons right now.');
    } finally {
      loading = false;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setActiveTab(tab.dataset.status || 'available');
      loadCoupons();
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = String(input.value || '').trim();
    if (!code) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await window.couponService.applyCoupon(code);
      input.value = '';
      setActiveTab('available');
      showToast(result.valid ? `Coupon ${result.coupon?.code || code} is ready.` : 'Coupon added.', 'success');
      await loadCoupons();
    } catch (error) {
      showToast(error.message || 'Unable to add this coupon.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  loadCoupons();
})();
