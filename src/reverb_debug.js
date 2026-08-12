import { config } from './config.js';
import { httpJson } from './http.js';

function tokenForStore(store) {
  const normalized = String(store || 'main').toLowerCase();
  if (['warehouse', 'wh', 'deals', 'reverb-warehouse', 'warehouse-reverb'].includes(normalized)) {
    return { token: config.reverbWarehouseToken, store: 'warehouse' };
  }
  return { token: config.reverbMainToken, store: 'main' };
}

function maskToken(token) {
  if (!token) return null;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

function findDimensionLikeValues(value, path = '', hits = [], depth = 0) {
  if (depth > 8 || value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findDimensionLikeValues(v, `${path}[${i}]`, hits, depth + 1));
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, val] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    const lower = key.toLowerCase();
    const looksUseful = /(dimension|length|width|height|package|parcel|shipping|shipment|tracking|carrier|label|weight|ship)/.test(lower);
    if (looksUseful && (typeof val !== 'object' || val === null)) {
      hits.push({ path: nextPath, value: val });
    }
    if (typeof val === 'object' && val !== null) findDimensionLikeValues(val, nextPath, hits, depth + 1);
  }
  return hits;
}

function summarizeOrder(order) {
  const keys = Object.keys(order || {});
  const links = order?._links ? Object.fromEntries(Object.entries(order._links).map(([k, v]) => [k, v?.href || v])) : null;
  const dimensionLikeValues = findDimensionLikeValues(order).slice(0, 200);

  return {
    topLevelKeys: keys,
    basic: pick(order, [
      'order_number', 'order_id', 'id', 'uuid', 'status', 'created_at', 'updated_at', 'paid_at',
      'shipping_provider', 'tracking_number', 'tracking_numbers', 'shipping', 'shipment', 'shipments',
      'shipping_method', 'shipping_address', 'buyer', 'seller', 'total', 'subtotal'
    ]),
    links,
    dimensionLikeValues,
    rawOrder: order,
  };
}

export async function debugReverbOrder({ store, order }) {
  const { token, store: normalizedStore } = tokenForStore(store);
  if (!token) {
    throw new Error(`Missing Reverb token for ${normalizedStore}. Set ${normalizedStore === 'main' ? 'REVERB_MAIN_TOKEN' : 'REVERB_WAREHOUSE_TOKEN'}.`);
  }
  if (!order) throw new Error('Missing order. Use ?order=26226710');

  const url = `${config.reverbBaseUrl}/my/orders/selling/${encodeURIComponent(order)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/hal+json',
    'Accept-Version': '3.0',
    'User-Agent': 'shipstation-supplies-sync/1.0.3-reverb-debug',
  };

  const raw = await httpJson(url, { headers });
  return {
    ok: true,
    store: normalizedStore,
    order,
    url,
    tokenPresent: Boolean(token),
    tokenPreview: maskToken(token),
    ...summarizeOrder(raw),
  };
}
