import {
  productImagesMatch,
  resolveProductDisplayImage,
  toProductCardImageUrl
} from '../services/storefront-asset-url.js';

const FALLBACK_IMAGE = '../img/logo.png';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uniqueImages(mainImage, gallery) {
  return Array.from(new Set([
    mainImage,
    ...(Array.isArray(gallery) ? gallery : [])
  ].filter(Boolean)));
}

function uniqueImageEntries(mainImage, gallery, cardImage, galleryCardImages) {
  const originals = uniqueImages(mainImage, gallery);
  const cards = Array.isArray(galleryCardImages) ? galleryCardImages : [];
  const seen = new Set();
  const entries = [];

  originals.forEach((original, index) => {
    const display = resolveProductDisplayImage(original, cards[index] || (index === 0 ? cardImage : ''));
    const key = String(display.original || display.preview || '').split('?')[0].split('/').pop()?.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    if (key && seen.has(key)) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    entries.push(display);
  });

  return entries.length ? entries : [resolveProductDisplayImage(mainImage, cardImage)];
}

function wrapIndex(index, length) {
  if (!length) {
    return 0;
  }

  return (index + length) % length;
}

function bindGalleryImageFallback(container) {
  if (!container || container.dataset.galleryFallbackBound === 'true') {
    return;
  }

  container.dataset.galleryFallbackBound = 'true';
  container.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallbackApplied === 'true') {
      return;
    }

    const full = String(img.getAttribute('data-full') || '').trim();
    const current = String(img.currentSrc || img.getAttribute('src') || '').trim();
    if (full && current !== full && img.dataset.retried !== 'true') {
      img.dataset.retried = 'true';
      img.removeAttribute('srcset');
      img.src = full;
      return;
    }

    img.dataset.fallbackApplied = 'true';
    img.removeAttribute('srcset');
    img.src = FALLBACK_IMAGE;
  }, true);
}

function buildMainSlides(entries, name) {
  const productName = String(name || 'Product').trim() || 'Product';

  return entries.map((entry, index) => {
    const preview = entry.preview || entry.original || FALLBACK_IMAGE;
    const original = entry.original || preview;
    const alt = index === 0 ? productName : `${productName} — image ${index + 1}`;
    const isMain = index === 0;
    const srcset = isMain && preview && original && preview !== original
      ? `srcset="${escapeHtml(preview)} 640w"`
      : '';
    const sizes = isMain
      ? 'sizes="(max-width: 599px) 92vw, (max-width: 1023px) 46vw, 480px"'
      : '';

    return `
    <div class="gallery-slide" data-index="${index}" aria-hidden="${isMain ? 'false' : 'true'}">
      <button type="button" class="gallery-slide__button" data-gallery-open="${index}" aria-label="Open ${escapeHtml(productName)} image ${index + 1} fullscreen">
        <div class="gallery-slide__media">
          <img
            ${isMain ? `src="${escapeHtml(preview)}"` : ""}
            data-src="${escapeHtml(preview)}"
            ${srcset}
            ${sizes}
            data-full="${escapeHtml(original)}"
            alt="${escapeHtml(alt)}"
            width="640"
            height="640"
            draggable="false"
            loading="${isMain ? 'eager' : 'lazy'}"
            decoding="async"
            ${isMain ? 'fetchpriority="high"' : 'fetchpriority="low"'}
          >
        </div>
      </button>
    </div>
  `;
  }).join('');
}

function buildThumbs(entries, name) {
  const productName = String(name || 'Product').trim() || 'Product';

  return entries.map((entry, index) => {
    const thumb = entry.thumb || entry.preview || entry.original || FALLBACK_IMAGE;
    const original = entry.original || thumb;

    return `
    <button
      type="button"
      class="gallery-thumb${index === 0 ? ' is-active' : ''}"
      data-index="${index}"
      aria-label="Show ${escapeHtml(productName)} image ${index + 1}"
      aria-pressed="${index === 0 ? 'true' : 'false'}"
    >
      <img
        src="${escapeHtml(thumb)}"
        data-full="${escapeHtml(original)}"
        alt="${escapeHtml(productName)} thumbnail ${index + 1}"
        width="80"
        height="80"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      >
    </button>
  `;
  }).join('');
}

function buildLightboxSlides(entries, name) {
  const productName = String(name || 'Product').trim() || 'Product';

  return `
    <div class="lightbox-viewport" id="lightboxViewport">
      <div class="lightbox-track" id="lightboxTrack">
        ${entries.map((entry, index) => `
          <div class="lightbox-slide" data-index="${index}" aria-hidden="${index === 0 ? 'false' : 'true'}">
            <button type="button" class="lightbox-slide__button" data-lightbox-zoom="${index}" aria-label="Tap to zoom ${escapeHtml(productName)} image ${index + 1}">
              <div class="lightbox-slide__media"></div>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function createSlider({ viewport, track, getCount, getIndex, onCommit, getLocked }) {
  let pointerId = null;
  let startX = 0;
  let deltaX = 0;
  let dragging = false;
  let clickBlocked = false;
  let frameId = 0;

  function getWidth() {
    return viewport?.clientWidth || 1;
  }

  function setTranslate(value, animate) {
    if (!track) {
      return;
    }

    track.style.transition = animate ? 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    track.style.transform = `translate3d(${value}px, 0, 0)`;
  }

  function renderDrag() {
    frameId = 0;
    const width = getWidth();
    const count = getCount();
    const index = getIndex();
    const minTranslate = -(Math.max(count - 1, 0) * width);
    let nextTranslate = -(index * width) + deltaX;

    if (nextTranslate > 0) {
      nextTranslate *= 0.35;
    }

    if (nextTranslate < minTranslate) {
      nextTranslate = minTranslate + (nextTranslate - minTranslate) * 0.35;
    }

    setTranslate(nextTranslate, false);
  }

  function commit(delta) {
    const width = getWidth();
    const threshold = Math.max(48, Math.min(120, width * 0.16));

    if (Math.abs(delta) > threshold) {
      onCommit(delta < 0 ? 1 : -1);
      return;
    }

    onCommit(0);
  }

  function onPointerDown(event) {
    if (!viewport || !track || getCount() < 2 || getLocked() || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    deltaX = 0;
    dragging = true;
    clickBlocked = false;
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(pointerId);
    setTranslate(-(getIndex() * getWidth()), false);
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }

    deltaX = event.clientX - startX;
    if (Math.abs(deltaX) > 8) {
      clickBlocked = true;
    }

    if (!frameId) {
      frameId = window.requestAnimationFrame(renderDrag);
    }
  }

  function releasePointer(event) {
    if (!dragging || (event && event.pointerId !== pointerId)) {
      return;
    }

    dragging = false;
    viewport?.classList.remove('is-dragging');
    if (viewport?.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    commit(deltaX);
    pointerId = null;
    startX = 0;
    deltaX = 0;
    window.setTimeout(() => {
      clickBlocked = false;
    }, 0);
  }

  viewport?.addEventListener('pointerdown', onPointerDown);
  viewport?.addEventListener('pointermove', onPointerMove);
  viewport?.addEventListener('pointerup', releasePointer);
  viewport?.addEventListener('pointercancel', releasePointer);
  viewport?.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') {
      return;
    }

    releasePointer(event);
  });

  return {
    snap(animate = true) {
      setTranslate(-(getIndex() * getWidth()), animate);
    },
    shouldBlockClick() {
      return clickBlocked;
    },
    destroy() {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    }
  };
}

export function initProductGallery(options) {
  const {
    mainImage,
    gallery,
    cardImage,
    galleryCardImages,
    name,
    root,
    track,
    thumbs,
    prevButton,
    nextButton,
    counter,
    zoomButton,
    lightbox,
    lightboxStage,
    lightboxCounter,
    lightboxPrev,
    lightboxNext,
    lightboxClose,
    viewport
  } = options;

  const entries = uniqueImageEntries(mainImage, gallery, cardImage, galleryCardImages);
  if (!track || !thumbs || !viewport || !lightbox || !lightboxStage || !entries.length) {
    return { getActiveIndex: () => 0 };
  }

  const images = entries.map((entry) => entry.original || entry.preview);
  bindGalleryImageFallback(root || track);
  bindGalleryImageFallback(thumbs);
  bindGalleryImageFallback(lightboxStage);

  track.innerHTML = buildMainSlides(entries, name);
  thumbs.innerHTML = buildThumbs(entries, name);

  const thumbButtons = Array.from(thumbs.querySelectorAll('.gallery-thumb'));
  const mainSlides = Array.from(track.children);

  function hydrateMainSlide(index) {
    const slideIndex = wrapIndex(index, mainSlides.length);
    const img = mainSlides[slideIndex]?.querySelector('img');
    const preview = img?.getAttribute('data-src');
    if (!img || !preview || img.getAttribute('src')) {
      return;
    }
    img.src = preview;
  }
  let lightboxViewport = null;
  let lightboxTrack = null;
  let lightboxSlides = [];
  let lightboxSlider = {
    snap() {},
    shouldBlockClick() {
      return false;
    },
    destroy() {}
  };
  let lightboxBuilt = false;

  let activeIndex = 0;
  let isLightboxOpen = false;
  let zoomedIndex = null;

  function hydrateLightboxImage(index) {
    const slide = lightboxSlides[index];
    const media = slide?.querySelector('.lightbox-slide__media');
    if (!media) {
      return;
    }

    let image = media.querySelector('img');
    const full = String(entries[index]?.original || entries[index]?.preview || FALLBACK_IMAGE).trim();
    if (!image) {
      image = document.createElement('img');
      image.alt = `${String(name || 'Product').trim() || 'Product'} fullscreen image ${index + 1}`;
      image.decoding = 'async';
      image.draggable = false;
      image.width = 1200;
      image.height = 1200;
      image.setAttribute('data-full', full);
      media.appendChild(image);
    }

    if (full && image.getAttribute('src') !== full) {
      image.loading = index === activeIndex ? 'eager' : 'lazy';
      image.src = full;
    }
  }

  function ensureLightbox() {
    if (lightboxBuilt) {
      return;
    }

    lightboxStage.innerHTML = buildLightboxSlides(entries, name);
    lightboxViewport = lightboxStage.querySelector('#lightboxViewport');
    lightboxTrack = lightboxStage.querySelector('#lightboxTrack');
    lightboxSlides = Array.from(lightboxTrack?.children || []);
    lightboxSlider = createSlider({
      viewport: lightboxViewport,
      track: lightboxTrack,
      getCount: () => entries.length,
      getIndex: () => activeIndex,
      onCommit: direction => {
        resetZoom();
        setActiveIndex(activeIndex + direction);
      },
      getLocked: () => zoomedIndex !== null
    });
    lightboxBuilt = true;
  }

  function syncCounters() {
    const label = `${activeIndex + 1} / ${images.length}`;
    if (counter) {
      counter.textContent = label;
    }
    if (lightboxCounter) {
      lightboxCounter.textContent = label;
    }
  }

  function syncSlides() {
    mainSlides.forEach((slide, index) => {
      slide.setAttribute('aria-hidden', String(index !== activeIndex));
    });
    lightboxSlides.forEach((slide, index) => {
      slide.setAttribute('aria-hidden', String(index !== activeIndex));
      slide.classList.toggle('is-zoomed', index === zoomedIndex);
    });
  }

  function syncThumbs() {
    thumbButtons.forEach((button, index) => {
      const isActive = index === activeIndex;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function resetZoom() {
    zoomedIndex = null;
    lightboxSlides.forEach(slide => {
      slide.classList.remove('is-zoomed');
      const image = slide.querySelector('img');
      if (image) {
        image.style.transform = 'scale(1)';
        image.style.transformOrigin = 'center center';
      }
    });
  }

  function preloadNearby() {
    const nextIndex = wrapIndex(activeIndex + 1, entries.length);
    if (nextIndex === activeIndex) {
      return;
    }

    const preview = entries[nextIndex]?.preview;
    if (!preview) {
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = preview;
  }

  function updateNavigationVisibility() {
    const hidden = images.length < 2;
    prevButton?.toggleAttribute('hidden', hidden);
    nextButton?.toggleAttribute('hidden', hidden);
    lightboxPrev?.toggleAttribute('hidden', hidden);
    lightboxNext?.toggleAttribute('hidden', hidden);
  }

  function setActiveIndex(index, options = {}) {
    const nextIndex = wrapIndex(index, images.length);
    const { immediate = false } = options;

    activeIndex = nextIndex;
    if (isLightboxOpen === false) {
      resetZoom();
    }

    mainSlider.snap(!immediate);
    if (lightboxBuilt) {
      hydrateLightboxImage(activeIndex);
      lightboxSlider.snap(!immediate);
    }
    syncCounters();
    syncSlides();
    syncThumbs();
    hydrateMainSlide(activeIndex);
    hydrateMainSlide(activeIndex + 1);
    hydrateMainSlide(activeIndex - 1);
    preloadNearby();
  }

  function openLightbox(index = activeIndex) {
    ensureLightbox();
    activeIndex = wrapIndex(index, images.length);
    isLightboxOpen = true;
    hydrateLightboxImage(activeIndex);
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    resetZoom();
    setActiveIndex(activeIndex, { immediate: true });
    lightboxClose?.focus();
  }

  function closeLightbox() {
    isLightboxOpen = false;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    resetZoom();
    viewport.focus();
  }

  function toggleZoom(index, event) {
    if (!isLightboxOpen || index !== activeIndex) {
      return;
    }

    const slide = lightboxSlides[index];
    const image = slide?.querySelector('img');
    if (!slide || !image) {
      return;
    }

    if (zoomedIndex === index) {
      resetZoom();
      syncSlides();
      return;
    }

    const rect = image.getBoundingClientRect();
    const originX = ((event.clientX - rect.left) / rect.width) * 100;
    const originY = ((event.clientY - rect.top) / rect.height) * 100;
    resetZoom();
    zoomedIndex = index;
    slide.classList.add('is-zoomed');
    image.style.transformOrigin = `${originX}% ${originY}%`;
    image.style.transform = 'scale(2.1)';
    syncSlides();
  }

  const mainSlider = createSlider({
    viewport,
    track,
    getCount: () => images.length,
    getIndex: () => activeIndex,
    onCommit: direction => setActiveIndex(activeIndex + direction),
    getLocked: () => false
  });

  thumbs.addEventListener('click', event => {
    const button = event.target.closest('.gallery-thumb');
    if (!button) {
      return;
    }

    setActiveIndex(Number(button.dataset.index || 0));
  });

  track.addEventListener('click', event => {
    const trigger = event.target.closest('[data-gallery-open]');
    if (!trigger || mainSlider.shouldBlockClick()) {
      return;
    }

    openLightbox(Number(trigger.dataset.galleryOpen || activeIndex));
  });

  lightboxStage.addEventListener('click', event => {
    const trigger = event.target.closest('[data-lightbox-zoom]');
    if (!trigger || lightboxSlider.shouldBlockClick()) {
      return;
    }

    toggleZoom(Number(trigger.dataset.lightboxZoom || activeIndex), event);
  });

  prevButton?.addEventListener('click', () => setActiveIndex(activeIndex - 1));
  nextButton?.addEventListener('click', () => setActiveIndex(activeIndex + 1));
  zoomButton?.addEventListener('click', () => openLightbox(activeIndex));
  lightboxPrev?.addEventListener('click', () => {
    resetZoom();
    setActiveIndex(activeIndex - 1);
  });
  lightboxNext?.addEventListener('click', () => {
    resetZoom();
    setActiveIndex(activeIndex + 1);
  });
  lightboxClose?.addEventListener('click', closeLightbox);

  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  viewport.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActiveIndex(activeIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveIndex(activeIndex + 1);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLightbox(activeIndex);
    }
  });

  const onKeyDown = event => {
    if (event.key === 'Escape' && isLightboxOpen) {
      closeLightbox();
      return;
    }

    if (!isLightboxOpen) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resetZoom();
      setActiveIndex(activeIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      resetZoom();
      setActiveIndex(activeIndex + 1);
    }
  };

  document.addEventListener('keydown', onKeyDown);

  const onResize = () => {
    mainSlider.snap(false);
    lightboxSlider.snap(false);
  };

  window.addEventListener('resize', onResize, { passive: true });

  root?.style.setProperty('--gallery-image-count', String(images.length));
  updateNavigationVisibility();
  setActiveIndex(0, { immediate: true });

  return {
    getActiveIndex: () => activeIndex,
    showImage(url) {
      const target = String(url || '').trim();
      if (!target) {
        return;
      }

      const index = entries.findIndex((entry) => (
        productImagesMatch(entry.original, target)
        || productImagesMatch(entry.preview, target)
        || String(entry.original || '').trim() === target
        || String(entry.preview || '').trim() === target
      ));

      if (index >= 0) {
        setActiveIndex(index);
        return;
      }

      const activeSlide = mainSlides[activeIndex];
      const image = activeSlide?.querySelector('img');
      if (image) {
        const display = resolveProductDisplayImage(target, toProductCardImageUrl(target));
        image.dataset.retried = '';
        image.dataset.fallbackApplied = '';
        image.setAttribute('data-full', display.original || target);
        image.src = display.preview || target;
      }
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
      mainSlider.destroy();
      lightboxSlider.destroy();
    }
  };
}