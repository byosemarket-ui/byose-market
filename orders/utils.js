export const STORAGE_KEYS = {
  cart: 'byose_market_cart_v1',
  directCheckout: 'byose_direct_checkout',
  orders: 'byose_orders',
  draft: 'byose_checkout_draft_v1',
  confirmation: 'byose_checkout_confirmation_v1',
  currentUser: 'bm_current_user',
  legacyUser: 'bm_user',
  storefrontUser: 'byose_market_user',
  users: 'bm_users',
  legacyUsers: 'byose_market_users'
};

export const PAYMENT_ACCOUNTS = [
  {
    id: 'mtn',
    label: 'MTN Mobile Money',
    number: '0780430710',
    accountName: 'Vestine Uwifashije'
  },
  {
    id: 'airtel',
    label: 'Airtel Money',
    number: '0723137250',
    accountName: 'Kwizera Byose Market'
  }
];

export function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

export function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export function writeStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeStorage(key) {
  window.localStorage.removeItem(key);
}

export function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function formatCurrency(value) {
  return `RWF ${(Number(value) || 0).toLocaleString('en-US')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('250') && digits.length === 12) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `+250${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `+250${digits}`;
  }

  return digits.startsWith('+') ? digits : `+${digits}`;
}

export function isValidPhone(value) {
  const normalized = normalizePhone(value);
  return /^\+250\d{9}$/.test(normalized);
}

export function normalizeAttributes(item) {
  if (item && item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
    return Object.fromEntries(
      Object.entries(item.attributes).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  const attributes = {};
  if (item?.color) {
    attributes.Color = item.color;
  }
  if (item?.size) {
    attributes.Size = item.size;
  }
  return attributes;
}

export function buildVariantKey(attributes) {
  return Object.entries(attributes || {})
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

export function describeAttributes(item) {
  const entries = Object.entries(normalizeAttributes(item));
  if (!entries.length) {
    return 'Standard option';
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(' | ');
}

export function resolveOrderItemImage(item) {
  const galleryImage = Array.isArray(item?.gallery) ? item.gallery.find((entry) => String(entry || '').trim()) : '';
  return String(
    item?.image
    || item?.img
    || item?.imageUrl
    || item?.productImage
    || item?.mainImage
    || item?.thumbnail
    || galleryImage
    || 'img/logo.png'
  ).trim();
}

export function normalizeCartItem(item) {
  const attributes = normalizeAttributes(item);
  const variantKey = item?.variantKey || buildVariantKey(attributes);
  const image = resolveOrderItemImage(item);
  const qty = Math.max(1, Number(item?.qty || 1) || 1);
  const price = Number(item?.price || 0) || 0;

  return {
    id: String(item?.id || `${item?.name || 'item'}-${variantKey || 'default'}`),
    name: String(item?.name || 'Product').trim() || 'Product',
    price,
    qty,
    image,
    img: image,
    imageUrl: image,
    productImage: image,
    mainImage: image,
    thumbnail: image,
    attributes,
    attributeSummary: item?.attributeSummary || describeAttributes({ attributes }),
    variantKey,
    color: String(item?.color || attributes.Color || '').trim(),
    size: String(item?.size || attributes.Size || '').trim(),
    total: price * qty
  };
}

export function readCartItems() {
  return readStorage(STORAGE_KEYS.cart, []).map(normalizeCartItem);
}

export function writeCartItems(items) {
  writeStorage(STORAGE_KEYS.cart, items.map(normalizeCartItem));
}

export function readDirectCheckout() {
  const item = readStorage(STORAGE_KEYS.directCheckout, null);
  return item ? normalizeCartItem(item) : null;
}

export function writeDirectCheckout(item) {
  if (!item) {
    removeStorage(STORAGE_KEYS.directCheckout);
    return;
  }

  writeStorage(STORAGE_KEYS.directCheckout, normalizeCartItem(item));
}

export function readCurrentUser() {
  try {
    if (window.authService && typeof window.authService.getCurrentUser === 'function') {
      return window.authService.getCurrentUser() || null;
    }
  } catch (error) {
    console.error(error);
  }

  return (
    readStorage(STORAGE_KEYS.currentUser, null)
    || readStorage(STORAGE_KEYS.legacyUser, null)
    || readStorage(STORAGE_KEYS.storefrontUser, null)
  );
}

export function getUserAddress(user) {
  const address = user?.address && typeof user.address === 'object' ? user.address : {};
  const [firstName, ...rest] = String(user?.name || '').trim().split(/\s+/).filter(Boolean);

  return {
    firstName: String(address.firstName || firstName || '').trim(),
    lastName: String(address.lastName || rest.join(' ') || '').trim(),
    phone: String(address.phone || user?.phone || '').trim(),
    city: String(address.city || '').trim(),
    district: String(address.district || '').trim(),
    sector: String(address.sector || '').trim(),
    cell: String(address.cell || '').trim(),
    village: String(address.village || '').trim(),
    street: String(address.street || address.line1 || '').trim()
  };
}

export function persistUserAddress(address) {
  const currentUser = readCurrentUser();
  if (!currentUser || !currentUser.id) {
    return;
  }

  const nextUser = {
    ...currentUser,
    phone: normalizePhone(address.phone) || currentUser.phone || '',
    address: {
      ...(currentUser.address || {}),
      ...clone(address),
      phone: normalizePhone(address.phone) || currentUser.phone || '',
      line1: address.street || currentUser.address?.line1 || ''
    }
  };

  writeStorage(STORAGE_KEYS.currentUser, nextUser);
  writeStorage(STORAGE_KEYS.legacyUser, nextUser);
  if (window.localStorage.getItem(STORAGE_KEYS.storefrontUser)) {
    writeStorage(STORAGE_KEYS.storefrontUser, nextUser);
  }

  const keys = [STORAGE_KEYS.users, STORAGE_KEYS.legacyUsers];
  keys.forEach((key) => {
    const users = readStorage(key, []);
    if (!Array.isArray(users)) {
      return;
    }

    const nextUsers = users.map((user) => {
      const sameUser = String(user?.id || '') === String(nextUser.id)
        || (user?.email && nextUser.email && String(user.email).toLowerCase() === String(nextUser.email).toLowerCase())
        || (user?.phone && nextUser.phone && normalizePhone(user.phone) === normalizePhone(nextUser.phone));

      return sameUser ? { ...user, ...nextUser, address: { ...(user.address || {}), ...(nextUser.address || {}) } } : user;
    });

    writeStorage(key, nextUsers);
  });

  if (window.authService && typeof window.authService.updateProfile === 'function') {
    window.authService.updateProfile({
      name: nextUser.name || currentUser.name || '',
      phone: nextUser.phone || currentUser.phone || '',
      avatar: nextUser.avatar || currentUser.avatar || '',
      address: nextUser.address || {}
    }).catch((error) => {
      console.warn('Unable to sync the customer address to the API.', error);
    });
  }
}

export function readOrders() {
  const sources = [
    readStorage(STORAGE_KEYS.orders, []),
    readStorage('orders', [])
  ];
  const unique = new Map();

  sources.forEach((source) => {
    if (!Array.isArray(source)) {
      return;
    }

    source.forEach((order) => {
      const key = getOrderIdentifier(order);
      if (!key || unique.has(key)) {
        return;
      }

      unique.set(key, clone(order));
    });
  });

  return Array.from(unique.values());
}

export function readOrderById(orderId) {
  return readOrders().find((order) => String(order?.id || '') === String(orderId || '')) || null;
}

export function saveOrder(order) {
  validateOrder(order);

  const orders = readOrders();
  const orderKey = getOrderIdentifier(order);
  if (orders.some((existingOrder) => getOrderIdentifier(existingOrder) === orderKey)) {
    throw new Error('This order has already been saved.');
  }

  const nextOrders = orders.concat([clone(order)]);

  writeStorage(STORAGE_KEYS.orders, nextOrders);
  writeStorage('orders', nextOrders);
  window.dispatchEvent(new CustomEvent('byose:orders-changed', { detail: { order } }));
}

export function saveCheckoutConfirmation(payload) {
  writeStorage(STORAGE_KEYS.confirmation, payload);
}

export function readCheckoutConfirmation() {
  return readStorage(STORAGE_KEYS.confirmation, null);
}

export function emitCartUpdated() {
  window.dispatchEvent(new Event('cart:updated'));
  window.dispatchEvent(new Event('kcart:updated'));
}

export function createOrderId() {
  const nextSequence = readOrders().reduce((highest, order, index) => {
    const identifier = String(order?.orderId || order?.id || '').trim();
    const match = identifier.match(/^BM(\d+)$/i);
    if (match) {
      return Math.max(highest, Number(match[1]) || 0);
    }

    return Math.max(highest, index + 1);
  }, 0) + 1;

  return `BM${String(nextSequence).padStart(13, '0')}`;
}

function getOrderIdentifier(order) {
  return String(order?.orderId || order?.id || '').trim();
}

function validateOrder(order) {
  const requiredFields = [
    ['orderId', order?.orderId || order?.id],
    ['customerName', order?.customerName],
    ['phoneNumber', order?.phoneNumber || order?.customerPhone],
    ['province', order?.fullAddress?.province || order?.shippingAddress?.provinceCity],
    ['district', order?.fullAddress?.district || order?.shippingAddress?.district],
    ['sector', order?.fullAddress?.sector || order?.shippingAddress?.sector],
    ['cell', order?.fullAddress?.cell || order?.shippingAddress?.cell],
    ['village', order?.fullAddress?.village || order?.shippingAddress?.village],
    ['paymentMethod', order?.paymentMethod],
    ['paymentStatus', order?.paymentStatus],
    ['orderStatus', order?.orderStatus || order?.status],
    ['createdAt', order?.createdAt || order?.date]
  ];

  const missingField = requiredFields.find(([, value]) => !String(value || '').trim());
  if (missingField) {
    throw new Error(`Order is missing required field: ${missingField[0]}`);
  }

  const hasLinkedUser = Boolean(String(order?.userId || order?.customerId || '').trim());
  if (!hasLinkedUser && order?.isGuest !== true) {
    throw new Error('Order must be linked to a user or explicitly marked as a guest order.');
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    throw new Error('Order is missing required field: items');
  }

  const hasInvalidItem = items.some((item) => {
    const image = resolveOrderItemImage(item);
    const requiredItemFields = [
      item?.productId,
      item?.productName,
      image,
      item?.quantity,
      item?.price
    ];

    return requiredItemFields.some((value) => value === undefined || value === null || String(value).trim() === '');
  });

  if (hasInvalidItem) {
    throw new Error('Order items are incomplete.');
  }
}
