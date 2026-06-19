const CATEGORY_SLIDE_INTERVAL_MS = 10000;
const CATEGORY_CAROUSEL_MAX_WIDTH = 1024;
const CATEGORY_VISIBLE_COUNT = 3;
const CATEGORY_SWIPE_THRESHOLD = 48;

export function initHomeCategorySlider() {
  const slider = document.getElementById('categorySlider');
  const viewport = document.getElementById('categorySliderViewport');
  const track = document.getElementById('categoryGrid');
  const dotsRoot = document.getElementById('categorySliderDots');

  if (!slider || !viewport || !track) {
    return () => {};
  }

  const cards = Array.from(track.querySelectorAll('.category-card'));
  if (!cards.length) {
    return () => {};
  }

  let activePage = 0;
  let timerId = 0;
  let resizeTimerId = 0;
  let isCarouselMode = false;
  let pageCount = 1;
  let pointerId = null;
  let startX = 0;
  let deltaX = 0;
  let isDragging = false;
  let suppressClick = false;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  function prefersReducedMotion() {
    return reducedMotionQuery.matches;
  }

  function getVisibleCount() {
    return window.innerWidth > CATEGORY_CAROUSEL_MAX_WIDTH
      ? cards.length
      : CATEGORY_VISIBLE_COUNT;
  }

  function computePageCount() {
    const visible = getVisibleCount();
    return Math.max(1, Math.ceil(cards.length / visible));
  }

  function getPageWidth() {
    return viewport.clientWidth || 1;
  }

  function measureCards() {
    const gap = 8;
    const visible = getVisibleCount();
    const pageWidth = getPageWidth();
    const cardWidth = Math.max(88, (pageWidth - gap * (visible - 1)) / visible);

    cards.forEach((card) => {
      card.style.flexBasis = `${cardWidth}px`;
      card.style.width = `${cardWidth}px`;
    });
  }

  function buildDots() {
    if (!dotsRoot) {
      return;
    }

    dotsRoot.innerHTML = '';
    if (!isCarouselMode || pageCount <= 1) {
      dotsRoot.setAttribute('aria-hidden', 'true');
      return;
    }

    dotsRoot.setAttribute('aria-hidden', 'false');
    for (let index = 0; index < pageCount; index += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `category-slider__dot${index === activePage ? ' is-active' : ''}`;
      dot.setAttribute('aria-label', `Show category page ${index + 1}`);
      dot.addEventListener('click', () => {
        stopAutoSlide();
        goToPage(index, true);
        startAutoSlide();
      });
      dotsRoot.appendChild(dot);
    }
  }

  function updateDots() {
    if (!dotsRoot) {
      return;
    }

    Array.from(dotsRoot.querySelectorAll('.category-slider__dot')).forEach((dot, index) => {
      dot.classList.toggle('is-active', index === activePage);
    });
  }

  function applyTransform(animate = true) {
    const offset = isCarouselMode ? activePage * getPageWidth() : 0;
    const useTransition = animate && !prefersReducedMotion() && !isDragging;
    track.style.transition = useTransition
      ? 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none';
    track.style.transform = `translate3d(-${offset}px, 0, 0)`;
    updateDots();
  }

  function goToPage(page, animate = true) {
    pageCount = computePageCount();
    activePage = ((page % pageCount) + pageCount) % pageCount;
    applyTransform(animate);
  }

  function nextPage() {
    goToPage(activePage + 1, true);
  }

  function stopAutoSlide() {
    window.clearInterval(timerId);
    timerId = 0;
  }

  function startAutoSlide() {
    stopAutoSlide();
    if (!isCarouselMode || pageCount <= 1 || prefersReducedMotion()) {
      return;
    }

    timerId = window.setInterval(nextPage, CATEGORY_SLIDE_INTERVAL_MS);
  }

  function updateMode() {
    pageCount = computePageCount();
    isCarouselMode = window.innerWidth <= CATEGORY_CAROUSEL_MAX_WIDTH && pageCount > 1;
    slider.classList.toggle('category-slider--carousel', isCarouselMode);
    slider.classList.toggle('category-slider--desktop', !isCarouselMode);

    if (isCarouselMode) {
      measureCards();
      if (activePage >= pageCount) {
        activePage = 0;
      }
      applyTransform(false);
      buildDots();
      startAutoSlide();
      return;
    }

    activePage = 0;
    track.style.transition = 'none';
    track.style.transform = 'none';
    cards.forEach((card) => {
      card.style.flexBasis = '';
      card.style.width = '';
    });
    buildDots();
    stopAutoSlide();
  }

  function onPointerDown(event) {
    if (!isCarouselMode || event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    deltaX = 0;
    isDragging = true;
    suppressClick = false;
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(pointerId);
    stopAutoSlide();
    track.style.transition = 'none';
  }

  function onPointerMove(event) {
    if (!isDragging || event.pointerId !== pointerId) {
      return;
    }

    deltaX = event.clientX - startX;
    if (Math.abs(deltaX) > 8) {
      suppressClick = true;
    }

    const offset = activePage * getPageWidth() - deltaX;
    track.style.transform = `translate3d(-${offset}px, 0, 0)`;
  }

  function onPointerEnd(event) {
    if (!isDragging || (event && event.pointerId !== pointerId)) {
      return;
    }

    isDragging = false;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }

    const threshold = Math.max(CATEGORY_SWIPE_THRESHOLD, getPageWidth() * 0.14);
    if (deltaX <= -threshold) {
      goToPage(activePage + 1, true);
    } else if (deltaX >= threshold) {
      goToPage(activePage - 1, true);
    } else {
      applyTransform(true);
    }

    pointerId = null;
    startX = 0;
    deltaX = 0;
    startAutoSlide();
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
  }

  function onTrackClick(event) {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      stopAutoSlide();
      return;
    }

    startAutoSlide();
  }

  function onReducedMotionChange() {
    if (prefersReducedMotion()) {
      stopAutoSlide();
      applyTransform(false);
      return;
    }

    startAutoSlide();
  }

  const onResize = () => {
    window.clearTimeout(resizeTimerId);
    resizeTimerId = window.setTimeout(updateMode, 120);
  };

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') {
      onPointerEnd(event);
    }
  });
  track.addEventListener('click', onTrackClick, true);
  slider.addEventListener('mouseenter', stopAutoSlide);
  slider.addEventListener('mouseleave', startAutoSlide);
  slider.addEventListener('focusin', stopAutoSlide);
  slider.addEventListener('focusout', startAutoSlide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotionQuery.addEventListener('change', onReducedMotionChange);
  window.addEventListener('resize', onResize, { passive: true });

  updateMode();

  return () => {
    stopAutoSlide();
    window.clearTimeout(resizeTimerId);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
    viewport.removeEventListener('pointerdown', onPointerDown);
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerup', onPointerEnd);
    viewport.removeEventListener('pointercancel', onPointerEnd);
    track.removeEventListener('click', onTrackClick, true);
  };
}
