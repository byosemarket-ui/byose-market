const HOME_CATEGORY_PILL_SELECTOR = '.home-category-pill';

export function scrollHomeCategoryPillIntoView(filter) {
  const track = document.getElementById('filterPills');
  if (!track) {
    return;
  }

  const normalizedFilter = String(filter || 'all').trim() || 'all';
  const activePill = track.querySelector(
    `${HOME_CATEGORY_PILL_SELECTOR}[data-filter="${normalizedFilter}"]`
  ) || track.querySelector(`${HOME_CATEGORY_PILL_SELECTOR}.is-active`);

  if (!activePill) {
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  activePill.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    inline: 'center',
    block: 'nearest'
  });
}

export function initHomeCategoryNav() {
  const track = document.getElementById('filterPills');
  if (!track) {
    return () => {};
  }

  const onResize = () => {
    const active = track.querySelector(`${HOME_CATEGORY_PILL_SELECTOR}.is-active`);
    if (active && window.innerWidth <= 1024) {
      scrollHomeCategoryPillIntoView(active.dataset.filter || 'all');
    }
  };

  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    window.removeEventListener('resize', onResize);
  };
}
