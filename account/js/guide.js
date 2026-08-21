(function initUserGuide() {
  const searchInput = document.getElementById('guideSearch');
  const faqList = document.getElementById('faqList');

  if (faqList) {
    faqList.querySelectorAll('.faq-question').forEach((button) => {
      button.addEventListener('click', () => {
        const item = button.closest('.faq-item');
        if (!item) return;
        const willOpen = !item.classList.contains('open');
        faqList.querySelectorAll('.faq-item.open').forEach((openItem) => {
          openItem.classList.remove('open');
          const openBtn = openItem.querySelector('.faq-question');
          if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
        });
        if (willOpen) {
          item.classList.add('open');
          button.setAttribute('aria-expanded', 'true');
        } else {
          button.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function filterGuide(query) {
    const q = normalize(query);
    document.querySelectorAll('.topic, .guide-block, .faq-item, #howToUse, #faqSection, #supportCard').forEach((el) => {
      if (!q) {
        el.classList.remove('is-hidden');
        return;
      }
      const keywords = normalize(el.getAttribute('data-keywords') || '');
      const text = normalize(el.textContent || '');
      const match = keywords.includes(q) || text.includes(q) || q.split(' ').every((part) => !part || text.includes(part) || keywords.includes(part));
      el.classList.toggle('is-hidden', !match);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => filterGuide(searchInput.value));
  }
})();
