/*
  product-details1.js
  Modern, modular JS for Product Details page
  - Image gallery (keyboard, thumbnails, dots)
  - Quantity selector validation
  - Color/Size selection state
  - Add-to-cart and Buy-Now modal handling (localStorage)
  - Tabs accessibility and keyboard support
  - Lightweight, defensive error handling
*/
(function () {
  'use strict';

  const SELECTORS = {
    sliderImage: '.slider-image',
    dot: '.dot',
    thumbnailBtn: '.thumbnail-btn',
    qtyInput: '#quantity',
    decreaseBtn: '#decrease-qty',
    increaseBtn: '#increase-qty',
    addToCartBtn: '.add-to-cart-btn',
    buyNowBtn: '.buy-now-btn',
    wishlistBtn: '.wishlist-btn',
    colorOption: '.color-option',
    sizeOption: '.size-option',
    tabBtn: '.tab-btn',
    tabPanel: '.tab-panel',
    modal: '#buyNowModal',
    modalOpenBtn: '.buy-now-btn',
    modalClose: '#modalClose',
    modalCancel: '#modalCancelBtn',
    modalConfirm: '#modalConfirmBtn',
    modalQtyInput: '#modalQuantity',
    // unify with global cart storage key used by KCart
    cartStorageKey: 'byose_market_cart_v1'
  };

  // Utilities
  const $ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const $1 = (sel, ctx = document) => ctx.querySelector(sel);

  // Simple safe localStorage wrapper
  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(SELECTORS.cartStorageKey)) || [];
    } catch (e) {
      console.error('readCart error', e);
      return [];
    }
  }

  /* ----------------------- Reviews ----------------------- */
  function initReviews() {
    const productTitle = (document.querySelector('.product-title')?.textContent || 'product').trim();
    const key = `byose_reviews_${productTitle.replace(/\s+/g, '_').toLowerCase()}`;

    const $avgRating = document.getElementById('avgRating');
    const $avgStars = document.getElementById('avgStars');
    const $totalReviews = document.getElementById('totalReviews');
    const $reviewsList = document.getElementById('reviewsList');
    const $reviewForm = document.getElementById('reviewForm');
    const $toggleForm = document.getElementById('toggleReviewForm');
    const $cancelReview = document.getElementById('cancelReview');
    const $ratingInput = document.getElementById('ratingInput');
    const $reviewImage = document.getElementById('reviewImage');
    const $imagePreview = document.getElementById('imagePreview');

    if (!$reviewsList || !$avgRating) return;

    function readReviews() {
      try {
        return JSON.parse(localStorage.getItem(key)) || [];
      } catch (e) {
        return [];
      }
    }

    function writeReviews(revs) {
      try { localStorage.setItem(key, JSON.stringify(revs)); } catch (e) {}
    }

    function formatDate(iso) {
      try { const d = new Date(iso); return d.toLocaleDateString(); } catch (e) { return iso; }
    }

    function renderStars(rating) {
      const r = Math.round(rating);
      let out = '';
      for (let i = 1; i <= 5; i++) {
        out += i <= r ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
      }
      return out;
    }

    function updateSummary(list) {
      const count = list.length;
      const avg = count ? (list.reduce((s, r) => s + (Number(r.rating)||0), 0) / count) : 0;
      $avgRating.textContent = avg ? avg.toFixed(1) : '0.0';
      $avgStars.innerHTML = renderStars(avg);
      $totalReviews.textContent = `${count} review${count === 1 ? '' : 's'}`;
      // update tab label if present
      const tabBtn = document.getElementById('tab-reviews');
      if (tabBtn) tabBtn.textContent = `Reviews (${count})`;
    }

    function renderList() {
      const list = readReviews();
      $reviewsList.innerHTML = '';
      if (!list.length) {
        $reviewsList.innerHTML = '<p>No reviews yet. Be the first to review this product.</p>';
      }
      list.slice().reverse().forEach(item => {
        const div = document.createElement('div');
        div.className = 'review-item';
        div.innerHTML = `
          <div class="review-header">
            <div class="reviewer-info">
              <img src="${item.imageAvatar || 'img/logo.png'}" alt="${item.name || 'Anonymous'}" class="reviewer-avatar">
              <div>
                <strong>${item.name || 'Anonymous'}</strong>
                <div class="review-stars">${renderStars(item.rating)}</div>
              </div>
            </div>
            <span class="review-date">${formatDate(item.date)}</span>
          </div>
          <p class="review-text">${(item.text || '').replace(/</g,'&lt;')}</p>
          ${item.image ? `<div class="review-images"><img src="${item.image}" alt="review image"></div>` : ''}
        `;
        $reviewsList.appendChild(div);
      });
      updateSummary(list);
    }

    // rating input handling
    let selectedRating = 5;
    if ($ratingInput) {
      $ratingInput.addEventListener('click', (e) => {
        const btn = e.target.closest('.star');
        if (!btn) return;
        selectedRating = Number(btn.dataset.value) || 0;
        // highlight
        Array.from($ratingInput.querySelectorAll('.star')).forEach(s => {
          const v = Number(s.dataset.value) || 0;
          s.innerHTML = v <= selectedRating ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
        });
      });
      // initialize default
      Array.from($ratingInput.querySelectorAll('.star')).forEach(s => { s.innerHTML = '<i class="far fa-star"></i>'; });
    }

    // image preview
    if ($reviewImage && $imagePreview) {
      $reviewImage.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) { $imagePreview.innerHTML = ''; return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
          $imagePreview.innerHTML = `<img src="${ev.target.result}" alt="preview" style="max-width:120px; border-radius:8px;">`;
        };
        reader.readAsDataURL(f);
      });
    }

    // toggle form
    $toggleForm?.addEventListener('click', () => { $reviewForm.style.display = $reviewForm.style.display === 'none' ? 'block' : 'none'; $reviewForm.querySelector('#reviewerName')?.focus(); });
    $cancelReview?.addEventListener('click', () => { $reviewForm.style.display = 'none'; });

    // submit handler
    $reviewForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (document.getElementById('reviewerName')?.value || '').trim();
      const text = (document.getElementById('reviewText')?.value || '').trim();
      const file = document.getElementById('reviewImage')?.files?.[0];
      const rating = selectedRating || 5;
      if (!text) {
        alert('Please enter a review comment.');
        return;
      }

      function saveWithImage(dataUrl) {
        const list = readReviews();
        list.push({ name: name || 'Anonymous', text, rating, image: dataUrl || '', date: new Date().toISOString() });
        writeReviews(list);
        renderList();
        $reviewForm.reset();
        $imagePreview.innerHTML = '';
        $reviewForm.style.display = 'none';
      }

      if (file) {
        const r = new FileReader();
        r.onload = (ev) => saveWithImage(ev.target.result);
        r.readAsDataURL(file);
      } else {
        saveWithImage('');
      }
    });

    // initial render
    renderList();
  }

  function writeCart(cart) {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(SELECTORS.cartStorageKey)) {
        window.ByoseStorefrontSync.writeStateByKey(SELECTORS.cartStorageKey, cart);
      } else {
        localStorage.setItem(SELECTORS.cartStorageKey, JSON.stringify(cart));
      }
      window.dispatchEvent(new CustomEvent('kcart:updated'));
    } catch (e) {
      console.error('writeCart error', e);
    }
  }

  /* ----------------------- Image Gallery ----------------------- */
  function initGallery() {
    const images = $(SELECTORS.sliderImage);
    const dots = $(SELECTORS.dot);
    const thumbs = $(SELECTORS.thumbnailBtn);
    if (!images.length) return;

    let active = images.findIndex(img => img.classList.contains('active'));
    if (active === -1) active = 0;

    function show(index) {
      index = Math.max(0, Math.min(index, images.length - 1));
      images.forEach((img, i) => img.classList.toggle('active', i === index));
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
      thumbs.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.slide) === index || btn.dataset.image === images[index].src));
      active = index;
    }

    /* ------------------ Mobile Fullscreen & Swipe ------------------ */
    const fsRoot = document.getElementById('pd-fullscreen');
    const fsTrack = fsRoot && fsRoot.querySelector('[data-role="track"]');
    const fsBackdrop = fsRoot && fsRoot.querySelector('[data-role="backdrop"]');
    const fsCloseBtn = fsRoot && fsRoot.querySelector('.pd-fs-close');
    const fsPrevBtn = fsRoot && fsRoot.querySelector('.pd-fs-prev');
    const fsNextBtn = fsRoot && fsRoot.querySelector('.pd-fs-next');

    function isMobileNarrow() {
      return window.matchMedia && window.matchMedia('(max-width:820px)').matches;
    }

    // treat mobile+tablet as touch viewport for pre-fullscreen swipe
    function isTouchViewport() {
      return window.matchMedia && window.matchMedia('(max-width:1024px)').matches;
    }

    function buildFs() {
      if (!fsTrack) return;
      // populate slides from main images
      fsTrack.innerHTML = images.map((img, i) => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt') || '';
        return `<div class="pd-fs-slide" data-index="${i}"><img src="${src}" alt="${alt}" draggable="false"></div>`;
      }).join('');
      // set initial transform
      fsTrack.style.transform = `translateX(0px)`;
    }

    let fsIndex = 0;
    let startX = 0;
    let currentX = 0;
    let dragging = false;

    /* ------------------ Pre-fullscreen slider (mobile/tablet) ------------------ */
    const sliderContainer = document.querySelector('.slider-container');
    let slideIndex = active;
    let sliderDragging = false;
    let sliderStartX = 0;
    let sliderCurrentX = 0;

    function updateSliderTransform(index, animate = true) {
      if (!sliderContainer) return;
      index = Math.max(0, Math.min(index, images.length - 1));
      const w = sliderContainer.clientWidth || window.innerWidth;
      const tx = -index * w;
      sliderContainer.style.transition = animate ? 'transform 300ms cubic-bezier(.2,.9,.2,1)' : 'none';
      sliderContainer.style.transform = `translateX(${tx}px)`;
      slideIndex = index;
      // keep dots/thumbnails in sync
      show(index);
    }

    function onSliderStart(e) {
      if (!isTouchViewport()) return;
      sliderDragging = true;
      sliderStartX = (e.touches ? e.touches[0].clientX : e.clientX) || 0;
      sliderCurrentX = sliderStartX;
      sliderContainer.style.transition = 'none';
    }

    function onSliderMove(e) {
      if (!sliderDragging) return;
      sliderCurrentX = (e.touches ? e.touches[0].clientX : e.clientX) || 0;
      const dx = sliderCurrentX - sliderStartX;
      const w = sliderContainer.clientWidth || window.innerWidth;
      const base = -slideIndex * w;
      sliderContainer.style.transform = `translateX(${base + dx}px)`;
    }

    function onSliderEnd(e) {
      if (!sliderDragging) return;
      sliderDragging = false;
      const dx = (sliderCurrentX || 0) - (sliderStartX || 0);
      const threshold = Math.max(40, window.innerWidth * 0.08);
      if (dx > threshold) updateSliderTransform(slideIndex - 1);
      else if (dx < -threshold) updateSliderTransform(slideIndex + 1);
      else updateSliderTransform(slideIndex);
    }

    // Wire slider pointer/touch events (mobile/tablet)
    if (sliderContainer) {
      // Prefer Pointer Events for consistent cross-input handling
      let activePointerId = null;

      function onPointerDown(e) {
        if (!isTouchViewport()) return;
        // only left button or touch
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        sliderDragging = true;
        sliderStartX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
        sliderCurrentX = sliderStartX;
        sliderContainer.style.transition = 'none';
        activePointerId = e.pointerId;
        sliderContainer.setPointerCapture?.(activePointerId);
        e.preventDefault();
      }

      function onPointerMove(e) {
        if (!sliderDragging || (activePointerId && e.pointerId !== activePointerId)) return;
        sliderCurrentX = e.clientX || (e.touches && e.touches[0]?.clientX) || sliderCurrentX;
        const dx = sliderCurrentX - sliderStartX;
        const w = sliderContainer.clientWidth || window.innerWidth;
        const base = -slideIndex * w;
        sliderContainer.style.transform = `translateX(${base + dx}px)`;
      }

      function onPointerUp(e) {
        if (!sliderDragging || (activePointerId && e.pointerId !== activePointerId)) return;
        sliderDragging = false;
        try { sliderContainer.releasePointerCapture?.(activePointerId); } catch (err) {}
        activePointerId = null;
        const dx = (sliderCurrentX || 0) - (sliderStartX || 0);
        const threshold = Math.max(40, window.innerWidth * 0.08);
        if (dx > threshold) updateSliderTransform(slideIndex - 1);
        else if (dx < -threshold) updateSliderTransform(slideIndex + 1);
        else updateSliderTransform(slideIndex);
      }

      // Attach pointer handlers with passive/default behavior appropriate
      sliderContainer.addEventListener('pointerdown', onPointerDown, { passive: false });
      sliderContainer.addEventListener('pointermove', onPointerMove, { passive: true });
      sliderContainer.addEventListener('pointerup', onPointerUp);
      sliderContainer.addEventListener('pointercancel', onPointerUp);

      // Fallback for very old browsers: touch + mouse
      sliderContainer.addEventListener('touchstart', onSliderStart, { passive: true });
      sliderContainer.addEventListener('touchmove', onSliderMove, { passive: true });
      sliderContainer.addEventListener('touchend', onSliderEnd);
      sliderContainer.addEventListener('mousedown', (e) => { if (isTouchViewport()) { e.preventDefault(); onSliderStart(e); } });
      document.addEventListener('mousemove', (e) => { if (sliderDragging) onSliderMove(e); });
      document.addEventListener('mouseup', (e) => { if (sliderDragging) onSliderEnd(e); });

      // ensure initial position matches active image
      // small timeout ensures CSS media queries applied and layout settled on load
      setTimeout(() => updateSliderTransform(slideIndex, false), 20);
    }

    function setFsIndex(i, animate = true) {
      fsIndex = Math.max(0, Math.min(i, images.length - 1));
      if (!fsTrack) return;
      const w = window.innerWidth || document.documentElement.clientWidth;
      const tx = -fsIndex * w;
      if (!animate) fsTrack.style.transition = 'none';
      else fsTrack.style.transition = '';
      fsTrack.style.transform = `translateX(${tx}px)`;
      // update dots/thumbs on main page
      show(fsIndex);
    }

    function openFs(i) {
      if (!fsRoot) return;
      buildFs();
      fsRoot.classList.add('active');
      fsRoot.setAttribute('aria-hidden', 'false');
      document.documentElement.style.overflow = 'hidden';
      setFsIndex(i, false);
      // focus close for accessibility
      fsCloseBtn?.focus();
    }

    function closeFs() {
      if (!fsRoot) return;
      fsRoot.classList.remove('active');
      fsRoot.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
    }

    function prevFs() { setFsIndex(fsIndex - 1); }
    function nextFs() { setFsIndex(fsIndex + 1); }

    // Touch handling on track for swiping
    function onTouchStart(e) {
      if (!isMobileNarrow()) return;
      dragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX) || 0;
      currentX = startX;
      fsTrack.style.transition = 'none';
    }

    function onTouchMove(e) {
      if (!dragging) return;
      currentX = (e.touches ? e.touches[0].clientX : e.clientX) || 0;
      const dx = currentX - startX;
      const w = window.innerWidth || document.documentElement.clientWidth;
      const base = -fsIndex * w;
      fsTrack.style.transform = `translateX(${base + dx}px)`;
    }

    function onTouchEnd(e) {
      if (!dragging) return;
      dragging = false;
      const dx = (currentX || 0) - (startX || 0);
      const threshold = Math.max(40, window.innerWidth * 0.08);
      if (dx > threshold) prevFs();
      else if (dx < -threshold) nextFs();
      else setFsIndex(fsIndex);
    }

    // Hook touch/click only on mobile narrow devices
    images.forEach((img, idx) => {
      // prevent accidental fullscreen on swipe: track last pointer movement
      let pointerMoved = false;
      img.addEventListener('touchstart', () => { pointerMoved = false; });
      img.addEventListener('touchmove', () => { pointerMoved = true; });
      img.addEventListener('mousedown', () => { pointerMoved = false; });
      img.addEventListener('mousemove', () => { pointerMoved = true; });
      // pointer events fallback for devices using Pointer Events API
      img.addEventListener('pointerdown', () => { pointerMoved = false; });
      img.addEventListener('pointermove', () => { pointerMoved = true; });

      img.addEventListener('click', (e) => {
        // open fullscreen on narrow devices / phones/tablets when it was a tap
        if (isMobileNarrow() || isTouchViewport()) {
          if (!pointerMoved) openFs(idx);
        }
      });
    });

    // FS controls
    fsBackdrop && fsBackdrop.addEventListener('click', () => closeFs());
    fsCloseBtn && fsCloseBtn.addEventListener('click', () => closeFs());
    fsPrevBtn && fsPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); prevFs(); });
    fsNextBtn && fsNextBtn.addEventListener('click', (e) => { e.stopPropagation(); nextFs(); });

    // track pointer/touch events
    if (fsTrack) {
      fsTrack.addEventListener('touchstart', onTouchStart, { passive: true });
      fsTrack.addEventListener('touchmove', onTouchMove, { passive: true });
      fsTrack.addEventListener('touchend', onTouchEnd);
      // allow mouse drag for mobile-like behavior optionally
      fsTrack.addEventListener('mousedown', (e) => { if (isMobileNarrow()) { e.preventDefault(); onTouchStart(e); } });
      document.addEventListener('mousemove', (e) => { if (dragging) onTouchMove(e); });
      document.addEventListener('mouseup', (e) => { if (dragging) onTouchEnd(e); });
    }

    // keyboard navigation while in fullscreen
    document.addEventListener('keydown', (e) => {
      if (!fsRoot || !fsRoot.classList.contains('active')) return;
      if (e.key === 'ArrowRight') nextFs();
      if (e.key === 'ArrowLeft') prevFs();
      if (e.key === 'Escape') closeFs();
    });

    // keep track of resizes so transform reflects new viewport width
    window.addEventListener('resize', () => {
      if (fsRoot && fsRoot.classList.contains('active')) {
        setFsIndex(fsIndex, false);
      }
    });

    // Connect dots
    dots.forEach(d => d.addEventListener('click', (e) => {
      const i = Number(e.currentTarget.dataset.slide) || 0;
      show(i);
    }));

    // Thumbnails
    thumbs.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        // Try to match by data-image to images src, fallback to index
        const src = btn.dataset.image;
        const targetIndex = images.findIndex(img => img.getAttribute('src') === src) || idx;
        show(targetIndex);
      });
    });

    // Keyboard navigation
    const slider = $1('.image-slider');
    if (slider) {
      slider.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') show(active + 1);
        if (e.key === 'ArrowLeft') show(active - 1);
      });
      // make slider focusable
      slider.tabIndex = 0;
    }
  }

  /* ----------------------- Quantity ----------------------- */
  function initQuantity() {
    const input = $1(SELECTORS.qtyInput);
    const dec = $1(SELECTORS.decreaseBtn);
    const inc = $1(SELECTORS.increaseBtn);
    if (!input) return;

    const min = Number(input.getAttribute('min')) || 1;
    const max = Number(input.getAttribute('max')) || 999;

    function setVal(v) {
      let n = Number(v) || min;
      if (n < min) n = min;
      if (n > max) n = max;
      input.value = n;
    }

    dec && dec.addEventListener('click', () => setVal(Number(input.value) - 1));
    inc && inc.addEventListener('click', () => setVal(Number(input.value) + 1));

    // Validate manual input
    input.addEventListener('input', () => {
      const val = input.value.replace(/[^0-9]/g, '') || min;
      setVal(Number(val));
    });

    // Prevent scroll changing value on focus
    input.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  /* ----------------------- Options (color/size) ----------------------- */
  function initOptions() {
    function bindToggle(selector) {
      $(selector).forEach(btn => {
        btn.addEventListener('click', (e) => {
          const group = e.currentTarget.parentElement;
          // deactivate siblings
          Array.from(group.children).forEach(sib => {
            sib.classList.remove('active');
            sib.setAttribute('aria-pressed', 'false');
          });
          e.currentTarget.classList.add('active');
          e.currentTarget.setAttribute('aria-pressed', 'true');
        });
      });
    }

    bindToggle(SELECTORS.colorOption);
    bindToggle(SELECTORS.sizeOption);
    // Modal variants (if present)
    bindToggle('.modal-color-option');
    bindToggle('.modal-size-option');
  }

  /* ----------------------- Tabs ----------------------- */
  function initTabs() {
    const tabs = $(SELECTORS.tabBtn);
    const panels = $(SELECTORS.tabPanel);
    if (!tabs.length) return;

    tabs.forEach(btn => {
      btn.addEventListener('click', () => activate(btn));
      btn.addEventListener('keydown', (e) => {
        let idx = tabs.indexOf(btn);
        if (e.key === 'ArrowRight') idx = (idx + 1) % tabs.length;
        if (e.key === 'ArrowLeft') idx = (idx - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') idx = 0;
        if (e.key === 'End') idx = tabs.length - 1;
        if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          tabs[idx].focus();
          activate(tabs[idx]);
        }
      });
    });

    function activate(target) {
      const panelId = target.getAttribute('aria-controls');
      tabs.forEach(t => {
        t.classList.toggle('active', t === target);
        t.setAttribute('aria-selected', t === target ? 'true' : 'false');
      });
      panels.forEach(p => p.classList.toggle('active', p.id === panelId));
    }
  }

  /* ----------------------- Add to Cart & Buy Now ----------------------- */
  function initCart() {
    const addBtn = $1(SELECTORS.addToCartBtn);
    const buyBtn = $1(SELECTORS.buyNowBtn);
    const wishlist = $1(SELECTORS.wishlistBtn);

    function getSelected() {

  const title =
    ($1('.product-title') && $1('.product-title').textContent.trim()) ||
    'Product';

  const priceEl = $1('.current-price');
  const price = priceEl ? priceEl.textContent.replace(/[^0-9.]/g, '') : '0';

  const imgEl = $1('.slider-image.active') || $1('.slider-image');
  const image = imgEl ? imgEl.src : '';

  // COLOR (first check modal, then fallback to page)
  let colorBtn =
    $1('.modal-color-option.active') ||
    $1('.color-option.active');

  const color = colorBtn ? colorBtn.dataset.color : null;

  // SIZE (first check modal, then fallback to page)
  let sizeBtn =
    $1('.modal-size-option.active') ||
    $1('.size-option.active');

  const size = sizeBtn ? sizeBtn.dataset.size : null;

  // QUANTITY
  let qtyInput =
    $1('#modalQuantity') ||
    $1('#quantity');

  const qty = Number(qtyInput?.value) || 1;

  return {
    title,
    price,
    color,
    size,
    qty,
    image
  };
}

    function addToCartAction({ immediateFeedback = true } = {}) {
      try {
        const selected = getSelected();
        if (!selected) return;

        // build unique id including options so identical SKUs merge
        const id = `${selected.title}::${selected.size || 'nosize'}::${selected.color || 'nocolor'}`;
        const item = {
          id,
          name: selected.title,
          price: Number(selected.price) || 0,
          qty: Number(selected.qty) || 1,
          image: selected.image || '',
          color: selected.color || '',
          size: selected.size || '',
          total: (Number(selected.price) || 0) * (Number(selected.qty) || 1)
        };

        // use shared cart API if available
        if (window.addToCart) {
          addToCart(item);
        } else if (window.KCart && KCart.add) {
          KCart.add(item);
        } else {
          window.dispatchEvent(new CustomEvent('byose:storefront-cart-error', {
            detail: {
              action: 'add',
              message: 'Centralized cart service is unavailable. Please refresh and try again.'
            }
          }));
          throw new Error('Centralized cart service is unavailable.');
        }

        if (immediateFeedback && addBtn) {
          addBtn.classList.add('loading');
          setTimeout(() => addBtn.classList.remove('loading'), 350);
        }
      } catch (err) {
        console.error('addToCartAction error', err);
      }
    }

    addBtn && addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });

    // Buy now: open modal and prefill values
    const modalEl = $1(SELECTORS.modal);
    const modalConfirm = $1(SELECTORS.modalConfirm);
    const modalQty = $1(SELECTORS.modalQtyInput);

    function openModal() {

  if (!modalEl) return;

  const selected = getSelected();

  $1('#modalProductImage').src =
    $1('.slider-image.active')?.src ||
    $1('.slider-image')?.src;

  $1('#modalProductName').textContent = selected.title;
  $1('#modalCurrentPrice').textContent = `Rwf ${selected.price}`;

  // Set quantity
  $1('#modalQuantity').value = selected.qty || 1;

  // Sync COLOR
  $('.modal-color-option').forEach(btn => {
    btn.classList.toggle(
      'active',
      btn.dataset.color === selected.color
    );
  });

  // Sync SIZE
  $('.modal-size-option').forEach(btn => {
    btn.classList.toggle(
      'active',
      btn.dataset.size === selected.size
    );
  });

  modalEl.classList.add('active');
  modalEl.setAttribute('aria-hidden', 'false');

  $1('#modalClose')?.focus();
}

    function closeModal() {
      if (!modalEl) return;
      modalEl.classList.remove('active');
      modalEl.setAttribute('aria-hidden', 'true');
    }

    // Close modal when clicking overlay or pressing Escape
    const modalOverlay = modalEl && modalEl.querySelector('.modal-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', () => closeModal());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    buyBtn && buyBtn.addEventListener('click', () => openModal());
    $1('#modalClose')?.addEventListener('click', () => closeModal());
    $1('#modalCancelBtn')?.addEventListener('click', () => closeModal());

    // Modal quantity buttons
    $1('#modalDecreaseQty')?.addEventListener('click', () => {
      const el = $1('#modalQuantity');
      if (!el) return;
      el.value = Math.max(Number(el.value) - 1, Number(el.min) || 1);
    });
    $1('#modalIncreaseQty')?.addEventListener('click', () => {
      const el = $1('#modalQuantity');
      if (!el) return;
      el.value = Math.min(Number(el.value) + 1, Number(el.max) || 999);
    });

  modalConfirm && modalConfirm.addEventListener('click', () => {

  try {

    const selected = getSelected();

    const directItem = {
      id: `${selected.title}-${selected.size}-${selected.color}`,
      name: selected.title,
      price: Number(selected.price),
      qty: selected.qty,
      image: selected.image,
      color: selected.color,
      size: selected.size,
      total: (Number(selected.price) || 0) * (Number(selected.qty) || 1)
    };

    window.ByoseStorefrontSync?.writeStateByKey?.('byose_direct_checkout', directItem);
    window.ByoseStorefrontSync?.removeStateByKey?.('byose_checkout_draft_v1');
    window.ByoseStorefrontSync?.removeStateByKey?.('byose_checkout_confirmation_v1');
    window.ByoseStorefrontSync?.syncPatch?.({
      directCheckout: directItem,
      checkoutDraft: null,
      checkoutConfirmation: null
    });

    closeModal();

    window.location.href = "orders/shipping.html";

  } catch (e) {
    console.error("Buy now error:", e);
  }

});
    // Wishlist toggle
    wishlist && wishlist.addEventListener('click', (e) => {
      const el = e.currentTarget;
      const pressed = el.getAttribute('aria-pressed') === 'true';
      el.setAttribute('aria-pressed', String(!pressed));
      el.classList.toggle('active', !pressed);
    });

    // Mobile action bar mapping: open modal to select options first
    $1('.mobile-add-to-cart-btn')?.addEventListener('click', () => openModal());
    $1('.mobile-buy-now-btn')?.addEventListener('click', () => openModal());

    // Connect modal "Add to Cart" button to the same addToCartAction used elsewhere
    const modalAddBtn = $1('#modalAddToCartBtn');
    if (modalAddBtn) {
      modalAddBtn.addEventListener('click', () => {
        // Validate required selections (color & size)
        const sel = getSelected();
        if (!sel.color || !sel.size) {
          alert('Please select both color and size');
          // ensure modal remains open for selection
          openModal();
          return;
        }

        // Add to cart using shared action
        addToCartAction({ immediateFeedback: true });

        // Close modal and show brief success feedback on the modal button
        closeModal();
        const prev = modalAddBtn.innerHTML;
        modalAddBtn.innerHTML = '\u2713 Added';
        modalAddBtn.disabled = true;
        setTimeout(() => {
          modalAddBtn.innerHTML = prev;
          modalAddBtn.disabled = false;
        }, 1500);
      });
    }
  }

  /* ----------------------- Initialization ----------------------- */
  function init() {
    try {
      initGallery();
      initQuantity();
      initOptions();
      initTabs();
      initCart();
      initReviews();
      // expose small API for tests
      window.__pd = { readCart, writeCart };
    } catch (e) {
      console.error('product-details init error', e);
    }
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


})();

