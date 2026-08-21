(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
  const USER_KEYS = ['bm_current_user', 'bm_user', 'byose_market_user', 'user'];
  const CHANGE_EVENTS = ['byose:orders-changed', 'byose:admin-orders-changed'];

  function normalizeBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  function shouldUseProductionApi(hostname) {
    return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
  }

  function resolveApiOrigin() {
    const explicit = normalizeBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || '');
    if (explicit) {
      return explicit;
    }

    const protocol = String(global.location?.protocol || '').toLowerCase();
    const hostname = String(global.location?.hostname || '').trim();

    if (protocol === 'file:' || isLocalHost(hostname)) {
      return `http://${hostname || 'localhost'}:5000`;
    }

    if (shouldUseProductionApi(hostname)) {
      return PRODUCTION_API_ORIGIN;
    }

    return normalizeBase(global.location?.origin || '');
  }

  function getOrdersApiUrl() {
    const base = resolveApiOrigin();
    return `${base}/api/orders`;
  }

  function safeParse(value, fallbackValue) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallbackValue;
    }
  }

  function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('250') && digits.length === 12) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 10) return `+250${digits.slice(1)}`;
    if (digits.length === 9 && digits.startsWith('7')) return `+250${digits}`;
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function phoneVariants(value) {
    const normalized = normalizePhone(value);
    if (!normalized) return [];
    const bare = normalized.startsWith('+') ? normalized.slice(1) : normalized;
    const national = normalized.startsWith('+250') ? `0${normalized.slice(4)}` : '';
    return Array.from(new Set([normalized, bare, national, String(value || '').replace(/\s+/g, '').trim()].filter(Boolean)));
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getSiteRootHref() {
    const pathname = String(global.location?.pathname || '/').replace(/\\/g, '/');
    const marker = pathname.toLowerCase().indexOf('/account/');
    const rootPath = marker >= 0 ? pathname.slice(0, marker + 1) : '/';
    return new URL(rootPath, global.location?.origin || global.location?.href || '/').href;
  }

  function resolveImageSource(value) {
    const source = String(value || '').trim();
    if (!source) {
      return '';
    }

    if (/^(data:|blob:|https?:)/i.test(source)) {
      return source;
    }

    try {
      if (source.startsWith('/')) {
        return new URL(source, global.location.origin).href;
      }

      if (source.startsWith('./') || source.startsWith('../')) {
        const normalizedSource = source.replace(/^\.\//, '').replace(/^(\.\.\/)+/, '');
        return new URL(normalizedSource, getSiteRootHref()).href;
      }

      return new URL(source.replace(/^\/+/, ''), getSiteRootHref()).href;
    } catch (error) {
      return source;
    }
  }

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function readCurrentUser() {
    if (global.authService && typeof global.authService.getCurrentUser === 'function') {
      try {
        const authUser = global.authService.getCurrentUser();
        if (authUser && typeof authUser === 'object') {
          return normalizeCurrentUser(authUser);
        }
      } catch (error) {
        console.error('Unable to resolve current user from auth service:', error);
      }
    }

    for (const key of USER_KEYS) {
      const localValue = safeParse(global.localStorage.getItem(key), null);
      if (localValue && typeof localValue === 'object') {
        return normalizeCurrentUser(localValue);
      }
    }

    return null;
  }

  function normalizeCurrentUser(user) {
    return {
      ...user,
      id: String(user?.id || user?.userId || user?.uid || '').trim(),
      userId: String(user?.userId || user?.id || user?.uid || '').trim(),
      email: String(user?.email || user?.mail || '').trim().toLowerCase(),
      phone: normalizePhone(user?.phone || user?.phoneNumber || '')
    };
  }

  function normalizeStatus(status) {
    const normalized = String(status || '').toLowerCase().trim();
    if (normalized.includes('return') || normalized.includes('refund')) {
      return 'returned';
    }
    if (normalized.includes('cancel')) {
      return 'cancelled';
    }
    if (normalized.includes('deliver') || normalized.includes('complete')) {
      return 'delivered';
    }
    if (normalized.includes('ship')) {
      return 'shipping';
    }
    if (
      normalized.includes('awaiting_payment')
      || normalized.includes('awaiting_delivery_payment')
      || normalized === 'pending'
    ) {
      return 'pending';
    }
    if (normalized.includes('confirm') || normalized.includes('process') || normalized.includes('approve') || normalized.includes('pack')) {
      return 'confirmed';
    }
    return 'pending';
  }

  function getStatusMeta(status) {
    const key = normalizeStatus(status);
    if (key === 'shipping') {
      return { key, label: 'Shipping', tone: 'shipping', icon: 'fa-solid fa-truck-fast', message: 'On the way to you' };
    }
    if (key === 'delivered') {
      return { key, label: 'Delivered', tone: 'delivered', icon: 'fa-solid fa-circle-check', message: 'Completed purchases' };
    }
    if (key === 'returned') {
      return { key, label: 'Returned', tone: 'returned', icon: 'fa-solid fa-rotate-left', message: 'Returned or refunded orders' };
    }
    if (key === 'cancelled') {
      return { key, label: 'Cancelled', tone: 'cancelled', icon: 'fa-solid fa-ban', message: 'Order cancelled' };
    }
    if (key === 'confirmed') {
      return { key, label: 'Confirmed', tone: 'pending', icon: 'fa-solid fa-receipt', message: 'Awaiting confirmation' };
    }
    return { key: 'pending', label: 'Pending', tone: 'pending', icon: 'fa-solid fa-hourglass-half', message: 'Awaiting confirmation' };
  }

  function mapGroup(status) {
    const key = normalizeStatus(status);
    if (key === 'shipping') {
      return 'shipping';
    }
    if (key === 'delivered') {
      return 'delivered';
    }
    if (key === 'returned') {
      return 'returns';
    }
    if (key === 'cancelled') {
      return 'cancelled';
    }
    return 'pending';
  }

  function normalizeItem(item) {
    const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    const imageSource = (
      item?.image
      || item?.imageUrl
      || item?.productImage
      || item?.mainImage
      || item?.thumbnail
      || item?.img
      || ''
    );

    return {
      productId: String(item?.productId || item?.id || '').trim(),
      productName: String(item?.productName || item?.name || 'Product').trim() || 'Product',
      image: resolveImageSource(imageSource),
      imageUrl: resolveImageSource(imageSource),
      size: String(item?.size || attributes.Size || '').trim(),
      color: String(item?.color || attributes.Color || '').trim(),
      quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
      price: Number(item?.price || 0) || 0
    };
  }

  function normalizeOrder(order) {
    const statusMeta = getStatusMeta(order?.orderStatus || order?.status);
    const items = (Array.isArray(order?.items) ? order.items : Array.isArray(order?.products) ? order.products : []).map(normalizeItem);
    const shippingAddress = order?.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {};
    const fullAddress = order?.fullAddress && typeof order.fullAddress === 'object'
      ? order.fullAddress
      : {
          province: order?.fullAddress?.province || shippingAddress.province || shippingAddress.provinceCity || shippingAddress.city || '',
          district: shippingAddress.district || '',
          sector: shippingAddress.sector || '',
          cell: shippingAddress.cell || '',
          village: shippingAddress.village || '',
          street: shippingAddress.street || shippingAddress.line1 || '',
          note: shippingAddress.note || ''
        };
    const gpsLocation = order?.gpsLocation && typeof order.gpsLocation === 'object'
      ? order.gpsLocation
      : {
          latitude: shippingAddress.latitude || '',
          longitude: shippingAddress.longitude || '',
          googleMapsLink: shippingAddress.googleMapsLink || shippingAddress.mapLink || ''
        };

    return {
      id: String(order?.orderId || order?.id || '').trim(),
      orderId: String(order?.orderId || order?.id || '').trim(),
      userId: String(order?.userId || order?.customerId || order?.customer?.id || '').trim(),
      accountId: String(order?.accountId || order?.userId || order?.customerId || order?.customer?.id || '').trim(),
      userEmail: String(order?.userEmail || order?.customerEmail || order?.customer?.email || '').trim().toLowerCase(),
      customerName: String(order?.customerName || order?.customer?.name || '').trim(),
      customerEmail: String(order?.customerEmail || order?.customer?.email || '').trim().toLowerCase(),
      phoneNumber: String(order?.phoneNumber || order?.customerPhone || order?.customer?.phone || '').trim(),
      fullAddress,
      gpsLocation,
      items,
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      subtotal: Number(order?.subtotal || 0) || 0,
      deliveryFee: Number(order?.deliveryFee ?? order?.shippingFee ?? 0) || 0,
      totalAmount: Number(order?.totalAmount ?? order?.total ?? 0) || 0,
      paymentMethod: String(order?.paymentMethod || order?.payment?.method || '').trim(),
      paymentStatus: String(order?.paymentStatus || order?.payment?.status || '').trim().toLowerCase(),
      orderStatus: statusMeta.key,
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
      trackingMessage: statusMeta.message,
      statusIcon: statusMeta.icon,
      groupKey: mapGroup(statusMeta.key),
      createdAt: String(order?.createdAt || order?.date || order?.timestamp || '').trim(),
      updatedAt: String(order?.updatedAt || order?.createdAt || order?.date || '').trim(),
      date: String(order?.date || order?.createdAt || order?.timestamp || '').trim(),
      raw: order
    };
  }

  function orderBelongsToUser(order, userId, currentUser) {
    const resolvedUserId = String(userId || currentUser?.id || currentUser?.userId || '').trim();
    const resolvedEmail = normalizeEmail(currentUser?.email);
    const resolvedPhone = normalizePhone(currentUser?.phone);

    if (resolvedUserId) {
      const orderUserId = String(order?.userId || order?.accountId || '').trim();
      if (orderUserId && orderUserId === resolvedUserId) {
        return true;
      }
    }

    if (resolvedEmail) {
      const orderEmail = normalizeEmail(order?.userEmail || order?.customerEmail);
      if (orderEmail && orderEmail === resolvedEmail) {
        return true;
      }
    }

    if (resolvedPhone) {
      const orderPhone = normalizePhone(order?.phoneNumber || order?.customerPhone || order?.customer?.phone);
      const userPhones = new Set(phoneVariants(resolvedPhone));
      const orderPhones = phoneVariants(orderPhone);
      if (orderPhones.some((entry) => userPhones.has(entry))) {
        return true;
      }
    }

    return false;
  }

  function getAuthToken() {
    if (global.authService && typeof global.authService.getToken === 'function') {
      return String(global.authService.getToken() || '').trim();
    }

    return String(global.localStorage.getItem('bm_auth_token') || '').trim();
  }

  async function fetchApiOrders() {
    const orderApi = getOrdersApiUrl();
    if (!orderApi) {
      return [];
    }

    try {
      if (global.authService?.restoreSession) {
        await global.authService.restoreSession().catch(() => {});
      }
      const response = global.authService?.authFetch
        ? await global.authService.authFetch(orderApi, {
            method: 'GET',
            headers: { Accept: 'application/json' }
          })
        : await fetch(orderApi, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${getAuthToken()}`
            }
          });
      if (!response.ok) {
        throw new Error(`Order API request failed with status ${response.status}`);
      }
      const data = await response.json();
      return Array.isArray(data?.orders) ? data.orders : [];
    } catch (error) {
      console.error('Fetch Orders Error:', error);
      return [];
    }
  }

  async function getOrders(userId) {
    const currentUser = readCurrentUser();
    const resolvedUserId = String(userId || currentUser?.id || currentUser?.userId || '').trim();
    const hasResolvedIdentity = Boolean(
      resolvedUserId
      || normalizeEmail(currentUser?.email)
      || normalizePhone(currentUser?.phone)
    );

    if (!hasResolvedIdentity) {
      return [];
    }

    const apiOrders = await fetchApiOrders();
    const combined = apiOrders
      .map(normalizeOrder)
      .filter((order, index, list) => list.findIndex((entry) => entry.orderId === order.orderId) === index)
      .filter((order) => orderBelongsToUser(order, resolvedUserId, currentUser))
      .sort((left, right) => new Date(right.createdAt || right.date || 0) - new Date(left.createdAt || left.date || 0));

    return combined;
  }

  function groupOrders(orders) {
    return {
      pending: orders.filter((order) => order.groupKey === 'pending'),
      shipping: orders.filter((order) => order.groupKey === 'shipping'),
      delivered: orders.filter((order) => order.groupKey === 'delivered'),
      returns: orders.filter((order) => order.groupKey === 'returns'),
      cancelled: orders.filter((order) => order.groupKey === 'cancelled')
    };
  }

  async function getOrderHistory(userId) {
    return getOrders(userId);
  }

  async function getOrderById(orderId, userId) {
    const orders = await getOrders(userId);
    return orders.find((order) => String(order.orderId) === String(orderId || '')) || null;
  }

  async function cancelOrder(orderId, userId) {
    const currentUser = readCurrentUser();

    const targetOrder = await getOrderById(orderId, userId);
    if (!targetOrder || !orderBelongsToUser(targetOrder, userId, currentUser)) {
      return { success: false, message: 'Order not found.' };
    }

    const orderApi = getOrdersApiUrl();
    const token = getAuthToken();
    if (!orderApi || !token) {
      return { success: false, message: 'Authentication is required to cancel orders.' };
    }

    try {
      const response = await fetch(`${orderApi}/${encodeURIComponent(String(orderId || ''))}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'Cancelled' })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        return { success: false, message: (payload && payload.message) || 'Unable to cancel this order.' };
      }

      global.dispatchEvent(new CustomEvent('byose:orders-changed', { detail: { action: 'cancel', orderId } }));
    } catch (error) {
      return { success: false, message: 'Unable to reach the order service right now.' };
    }

    return { success: true, message: 'Order cancelled successfully.' };
  }

  function subscribe(listener) {
    const callback = typeof listener === 'function' ? listener : function () {};
    const handlers = CHANGE_EVENTS.map((eventName) => {
      const handler = function (event) {
        callback(event);
      };
      global.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return function unsubscribe() {
      handlers.forEach(({ eventName, handler }) => {
        global.removeEventListener(eventName, handler);
      });
    };
  }

  const service = {
    cancelOrder,
    formatCurrency,
    getCurrentUser: readCurrentUser,
    getOrderById,
    getOrderHistory,
    getOrders,
    getStatusMeta,
    groupOrders,
    normalizeStatus,
    subscribe
  };

  global.orderService = service;
  global.getOrders = getOrders;
  global.getOrderHistory = getOrderHistory;
  global.getOrderById = getOrderById;
  global.cancelOrder = cancelOrder;
})(window);