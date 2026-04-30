(function (global) {
  'use strict';

  const ORDER_API = '/api/orders';
  const ORDER_KEYS = ['byose_orders', 'orders'];
  const USER_KEYS = ['bm_current_user', 'bm_user', 'byose_market_user', 'user'];
  const CHANGE_EVENTS = ['storage', 'byose:orders-changed', 'byose:admin-orders-changed'];

  function safeParse(value, fallbackValue) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallbackValue;
    }
  }

  function readArrayFromKeys(keys) {
    const unique = new Map();

    keys.forEach((key) => {
      const raw = global.localStorage.getItem(key);
      if (!raw) {
        return;
      }

      const parsed = safeParse(raw, []);
      if (!Array.isArray(parsed)) {
        return;
      }

      parsed.forEach((entry) => {
        const identifier = String(entry?.orderId || entry?.id || '').trim();
        if (!identifier || unique.has(identifier)) {
          return;
        }

        unique.set(identifier, entry);
      });
    });

    return Array.from(unique.values());
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\s+/g, '').trim();
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
    if (normalized.includes('return')) {
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
    if (normalized.includes('confirm') || normalized.includes('process') || normalized.includes('approve') || normalized.includes('payment')) {
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
      if (orderPhone && orderPhone === resolvedPhone) {
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
    const token = getAuthToken();
    if (!ORDER_API || !token) {
      return [];
    }

    try {
      const response = await fetch(ORDER_API, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
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
    const localOrders = readArrayFromKeys(ORDER_KEYS);
    const combined = [...apiOrders, ...localOrders]
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
      returns: orders.filter((order) => order.groupKey === 'returns')
    };
  }

  async function getOrderHistory(userId) {
    return getOrders(userId);
  }

  async function getOrderById(orderId, userId) {
    const orders = await getOrders(userId);
    return orders.find((order) => String(order.orderId) === String(orderId || '')) || null;
  }

  function writeOrders(orders) {
    const serialized = JSON.stringify(Array.isArray(orders) ? orders : []);
    ORDER_KEYS.forEach((key) => {
      global.localStorage.setItem(key, serialized);
    });
  }

  async function cancelOrder(orderId, userId) {
    const orders = readArrayFromKeys(ORDER_KEYS);
    const currentUser = readCurrentUser();
    const index = orders.findIndex((order) => {
      const normalizedOrder = normalizeOrder(order);
      return normalizedOrder.orderId === String(orderId || '') && orderBelongsToUser(normalizedOrder, userId, currentUser);
    });

    if (index === -1) {
      return { success: false, message: 'Order not found.' };
    }

    orders[index] = {
      ...orders[index],
      orderStatus: 'cancelled',
      status: 'Cancelled',
      updatedAt: new Date().toISOString()
    };
    writeOrders(orders);
    global.dispatchEvent(new CustomEvent('byose:orders-changed', { detail: { action: 'cancel', orderId } }));

    return { success: true, message: 'Order cancelled successfully.' };
  }

  function subscribe(listener) {
    const callback = typeof listener === 'function' ? listener : function () {};
    const handlers = CHANGE_EVENTS.map((eventName) => {
      const handler = function (event) {
        if (eventName === 'storage' && event && event.key && !ORDER_KEYS.includes(event.key)) {
          return;
        }
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