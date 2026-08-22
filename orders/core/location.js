export const COD_PAYMENT_HINT_RW = 'Kwishyura inkweto zikugezeho';
export const COD_RESTRICTION_RW = 'Kwishyura ugezwaho biboneka i Kigali gusa.';

function normalizeLocationText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compactLocationText(value) {
  return normalizeLocationText(value).replace(/[^a-z0-9]+/g, '');
}

function locationValueMatchesKigali(value) {
  const normalized = normalizeLocationText(value);
  const compact = compactLocationText(value);
  if (!normalized && !compact) return false;
  if (normalized === 'kigali' || compact === 'kigali') return true;
  if (/\bkigali\b/.test(normalized)) return true;
  if (compact.includes('kigali')) return true;
  return false;
}

export function isKigaliDeliveryLocation(source) {
  if (!source) return false;
  const values = typeof source === 'string'
    ? [source]
    : [
        source.provinceCity,
        source.city,
        source.province
      ];
  return values.some((value) => locationValueMatchesKigali(value));
}
