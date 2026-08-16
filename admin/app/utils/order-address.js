/**
 * Shared order customer/delivery address resolver.
 * Review Information, View Invoice, and Admin order normalization all use this
 * so hierarchy fields (including Cell and Village) are never dropped just
 * because they share a name with a higher administrative level.
 */

function asObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if ((text.startsWith("{") || text.startsWith("["))) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch (_error) {
        return { addressLine: text };
      }
    }
    if (text) return { addressLine: text };
  }
  return {};
}

export function extractAddressText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const nested = extractAddressText(value[i]);
        if (nested) return nested;
      }
      return "";
    }
    return extractAddressText(
      value.name
      || value.label
      || value.value
      || value.title
      || value.text
      || value.displayName
      || value.fullName
    );
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "[object object]") return "";
  return raw;
}

function pickAddressText(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const text = extractAddressText(values[i]);
    if (text) return text;
  }
  return "";
}

function uniqueOptional(value, used) {
  const text = extractAddressText(value);
  if (!text) return "";
  const key = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || used.has(key)) return "";
  used.add(key);
  return text;
}

export function resolveOrderCustomer(order) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const customer = asObject(order?.customer);
  return {
    name: pickAddressText(ship.fullName, order?.customerName, customer.name, customer.fullName),
    phone: pickAddressText(ship.phone, order?.customerPhone, order?.phoneNumber, customer.phone),
    email: pickAddressText(order?.customerEmail, order?.userEmail, customer.email, ship.email),
    customerId: pickAddressText(order?.customerId, customer.id, customer.customerId)
  };
}

export function resolveOrderAddress(order) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const full = asObject(order?.fullAddress);

  const province = pickAddressText(
    ship.provinceCity, ship.province, ship.city, ship.provinceName, ship.cityName,
    full.provinceCity, full.province, full.city, full.provinceName,
    order?.provinceCity, order?.city
  );
  const district = pickAddressText(
    ship.district, ship.districtName, ship.district_name,
    full.district, full.districtName, full.district_name
  );
  const sector = pickAddressText(
    ship.sector, ship.sectorName, ship.sector_name,
    full.sector, full.sectorName, full.sector_name
  );
  const cell = pickAddressText(
    ship.cell, ship.cellName, ship.cell_name,
    full.cell, full.cellName, full.cell_name
  );
  const village = pickAddressText(
    ship.village, ship.villageName, ship.village_name,
    full.village, full.villageName, full.village_name
  );

  const usedOptional = new Set();
  const street = uniqueOptional(pickAddressText(ship.street, ship.line1, full.street, full.line1), usedOptional);
  const house = uniqueOptional(pickAddressText(ship.houseNumber, ship.houseNo, ship.house, full.houseNumber, full.house), usedOptional);
  const building = uniqueOptional(pickAddressText(ship.building, full.building), usedOptional);
  const apartment = uniqueOptional(pickAddressText(ship.apartment, ship.apt, full.apartment), usedOptional);
  const postal = uniqueOptional(pickAddressText(ship.postalCode, ship.postal, ship.zip, full.postalCode, full.postal), usedOptional);
  const additional = uniqueOptional(pickAddressText(
    ship.additionalAddress, ship.additional, full.additionalAddress, ship.addressLine, full.addressLine
  ), usedOptional);
  const landmark = uniqueOptional(pickAddressText(ship.note, full.note, ship.landmark, full.landmark), usedOptional);

  return {
    province,
    district,
    sector,
    cell,
    village,
    street,
    house,
    building,
    apartment,
    postal,
    additional,
    landmark,
    hasHierarchy: Boolean(province || district || sector || cell || village),
    hasAny: Boolean(province || district || sector || cell || village || street || house || building || apartment || postal || additional || landmark)
  };
}

export function resolveOrderLocation(order) {
  const gps = asObject(order?.gpsLocation);
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const latitude = pickAddressText(gps.latitude, gps.lat, ship.latitude, ship.lat, order?.latitude);
  const longitude = pickAddressText(gps.longitude, gps.lng, gps.lon, ship.longitude, ship.lng, order?.longitude);
  const explicitLink = pickAddressText(gps.googleMapsLink, gps.mapLink, ship.mapLink, ship.googleMapsLink);
  const locationName = pickAddressText(gps.name, gps.locationName, gps.displayName, ship.locationName);
  const accuracy = pickAddressText(gps.accuracy, ship.locationAccuracy, ship.accuracy);
  const capturedAt = pickAddressText(gps.capturedAt, ship.locationCapturedAt);
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const hasCoords = latitude !== "" && longitude !== ""
    && Number.isFinite(latNum)
    && Number.isFinite(lngNum)
    && !(latNum === 0 && lngNum === 0);
  const mapLink = explicitLink || (hasCoords
    ? `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`
    : "");
  return {
    latitude: hasCoords ? latitude : "",
    longitude: hasCoords ? longitude : "",
    mapLink,
    locationName,
    accuracy,
    capturedAt,
    hasAny: Boolean((hasCoords && latitude) || mapLink || locationName)
  };
}

export function resolveOrderNotes(order, address = resolveOrderAddress(order)) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const used = new Set();
  [address?.landmark, address?.additional].forEach((value) => {
    const key = extractAddressText(value).replace(/\s+/g, " ").trim().toLowerCase();
    if (key) used.add(key);
  });
  return {
    instructions: uniqueOptional(pickAddressText(
      ship.deliveryInstructions, order?.deliveryInstructions, ship.instructions
    ), used),
    notes: uniqueOptional(pickAddressText(
      order?.customerMessage, order?.orderNotes, order?.checkoutNotes, ship.customerNotes, order?.buyerNotes
    ), used)
  };
}

export function applyCanonicalAddress(order, address = resolveOrderAddress(order), location = resolveOrderLocation(order)) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const full = asObject(order?.fullAddress);
  const gps = asObject(order?.gpsLocation);
  return {
    shippingAddress: {
      ...ship,
      fullName: pickAddressText(ship.fullName, order?.customerName) || ship.fullName,
      phone: pickAddressText(ship.phone, order?.customerPhone, order?.phoneNumber) || ship.phone,
      provinceCity: address.province || ship.provinceCity || "",
      city: address.province || ship.city || "",
      province: address.province || ship.province || "",
      district: address.district || "",
      sector: address.sector || "",
      cell: address.cell || "",
      village: address.village || "",
      street: address.street || ship.street || "",
      houseNumber: address.house || ship.houseNumber || "",
      building: address.building || ship.building || "",
      apartment: address.apartment || ship.apartment || "",
      note: address.landmark || ship.note || "",
      additionalAddress: address.additional || ship.additionalAddress || "",
      latitude: location.latitude || ship.latitude || "",
      longitude: location.longitude || ship.longitude || "",
      mapLink: location.mapLink || ship.mapLink || ""
    },
    fullAddress: {
      ...full,
      province: address.province || full.province || "",
      provinceCity: address.province || full.provinceCity || "",
      district: address.district || "",
      sector: address.sector || "",
      cell: address.cell || "",
      village: address.village || "",
      street: address.street || full.street || "",
      note: address.landmark || full.note || ""
    },
    gpsLocation: {
      ...gps,
      latitude: location.latitude || "",
      longitude: location.longitude || "",
      googleMapsLink: location.mapLink || gps.googleMapsLink || "",
      mapLink: location.mapLink || gps.mapLink || "",
      accuracy: location.accuracy || gps.accuracy || "",
      capturedAt: location.capturedAt || gps.capturedAt || ""
    }
  };
}
