document.addEventListener('DOMContentLoaded', () => {
  setupContactForm();
  setupMapScroll();
});

const CONTACT_MESSAGES_KEY = 'byose_market_messages';

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveMessagesApiUrl() {
  const runtimeBase = normalizeApiBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '');
  if (runtimeBase) {
    return runtimeBase.endsWith('/api') ? `${runtimeBase}/messages` : `${runtimeBase}/api/messages`;
  }

  const protocol = String(window.location?.protocol || '').toLowerCase();
  const hostname = String(window.location?.hostname || '').trim();
  if (protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return `http://${hostname || 'localhost'}:5000/api/messages`;
  }

  const origin = normalizeApiBase(window.location?.origin || '');
  return origin ? `${origin}/api/messages` : '';
}

async function persistContactMessage(entry) {
  const endpoint = resolveMessagesApiUrl();
  if (!endpoint) {
    saveContactMessage(entry);
    return entry;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    });

    if (!response.ok) {
      throw new Error(`Message API failed with status ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const saved = payload?.message || entry;
    saveContactMessage(saved);
    return saved;
  } catch (error) {
    console.warn('Unable to persist contact message to the API. Falling back to local storage.', error);
    saveContactMessage(entry);
    return entry;
  }
}

function setupContactForm() {
  const form = document.getElementById('form-message');
  const feedback = document.getElementById('formFeedback');

  if (!form || !feedback) {
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const name = document.getElementById('name')?.value.trim() || '';
    const email = document.getElementById('email')?.value.trim() || '';
    const phone = document.getElementById('phone')?.value.trim() || '';
    const message = document.getElementById('message')?.value.trim() || '';

    if (!name || !email || !phone || !message) {
      renderFeedback(feedback, 'Nyamuneka wuzuze ibibura byose.', 'error');
      return;
    }

    if (!isValidEmail(email)) {
      renderFeedback(feedback, 'Email wanditse siyo.', 'error');
      return;
    }

    if (phone.replace(/\D/g, '').length < 9) {
      renderFeedback(feedback, 'Numero ya telefone siyo.', 'error');
      return;
    }

    const textMessage = [
      `Muraho, nitwa *${name}*`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      '',
      'Ubutumwa:',
      message,
    ].join('\n');

    const whatsappUrl = `https://wa.me/250780430710?text=${encodeURIComponent(textMessage)}`;
    const emailSubject = `Ubutumwa bushya buvuye kuri ${name}`;
    const mailtoUrl = `mailto:kwizeraevode266@gmail.com?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(textMessage)}`;

    await persistContactMessage({
      id: `msg-${Date.now()}`,
      createdAt: new Date().toISOString(),
      name,
      email,
      phone,
      message,
      status: 'new',
      source: 'contact-form'
    });

    window.open(whatsappUrl, '_blank', 'noopener');
    window.setTimeout(() => {
      window.location.href = mailtoUrl;
    }, 350);

    renderFeedback(feedback, 'Ubutumwa bwoherejwe neza. WhatsApp na email birafunguka.', 'success');
    form.reset();
  });
}

function setupMapScroll() {
  const mapSection = document.getElementById('map');

  if (!mapSection) {
    return;
  }

  document.querySelectorAll('a[href="#map"]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function isValidEmail(email) {
  return /\S+@\S+\.\S+/.test(email);
}

function renderFeedback(node, message, type) {
  node.textContent = message;
  node.className = `form-feedback is-${type}`;
}

function saveContactMessage(entry) {
  try {
    const current = JSON.parse(localStorage.getItem(CONTACT_MESSAGES_KEY) || '[]');
    const next = Array.isArray(current) ? current : [];
    next.unshift(entry);
    localStorage.setItem(CONTACT_MESSAGES_KEY, JSON.stringify(next));
  } catch (error) {
    console.error('Failed to save contact message', error);
  }
}