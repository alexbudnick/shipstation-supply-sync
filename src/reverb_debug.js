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
      'shipping_provider', 'shipping_code', 'tracking_number', 'tracking_numbers', 'shipping', 'shipment', 'shipments',
      'shipping_method', 'shipping_address', 'buyer', 'seller', 'total', 'subtotal'
    ]),
    links,
    dimensionLikeValues,
    rawOrder: order,
  };
}

async function fetchReverbOrder({ store, order }) {
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
    'User-Agent': 'shipstation-supplies-sync/1.0.5-reverb-listing-debug',
  };

  const raw = await httpJson(url, { headers });
  return { raw, url, token, normalizedStore };
}

function extractDimensionText(text) {
  if (!text) return [];
  const snippets = new Set();
  const cleaned = text.replace(/&times;|×/g, ' x ').replace(/&nbsp;/g, ' ');

  const patterns = [
    /(?:L\s*)?(\d+(?:\.\d+)?)\s*(?:in|inch|inches)?\s*[xX]\s*(?:W\s*)?(\d+(?:\.\d+)?)\s*(?:in|inch|inches)?\s*[xX]\s*(?:H\s*)?(\d+(?:\.\d+)?)\s*(?:in|inch|inches)?/gi,
    /L\s*(\d+(?:\.\d+)?)\s*in\s*[xX]\s*W\s*(\d+(?:\.\d+)?)\s*in\s*[xX]\s*H\s*(\d+(?:\.\d+)?)\s*in/gi,
    /label(?:’s|'s)? dimensions[\s\S]{0,160}?(\d+(?:\.\d+)?)\s*in[\s\S]{0,30}?(\d+(?:\.\d+)?)\s*in[\s\S]{0,30}?(\d+(?:\.\d+)?)\s*in/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(cleaned)) !== null) {
      snippets.add(`${m[1]} x ${m[2]} x ${m[3]}`);
    }
  }
  return Array.from(snippets);
}

function findTextSnippets(text, terms) {
  if (!text) return [];
  const out = [];
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 250);
      const end = Math.min(text.length, idx + 600);
      out.push({ term, snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
}

async function fetchText(url, { token } = {}) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 shipstation-supplies-sync/1.0.5-reverb-listing-debug',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    finalUrl: res.url,
    contentType: res.headers.get('content-type'),
    text,
  };
}

export async function debugReverbOrder({ store, order }) {
  const { raw, url, token, normalizedStore } = await fetchReverbOrder({ store, order });
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

export async function debugReverbLabel({ store, order }) {
  const { raw, token, normalizedStore } = await fetchReverbOrder({ store, order });
  const links = raw?._links || {};
  const labelUrl = links?.shipping_label?.href || links?.shipping_label?.web?.href || null;
  if (!labelUrl) {
    return {
      ok: false,
      store: normalizedStore,
      order,
      error: 'No shipping_label link returned by Reverb order API.',
      availableLinks: Object.keys(links),
    };
  }

  const withAuth = await fetchText(labelUrl, { token });
  const dimsWithAuth = extractDimensionText(withAuth.text);
  const snippetsWithAuth = findTextSnippets(withAuth.text, ['dimension', 'Your label', '46', 'weight', 'UPS', 'tracking']);

  // Sometimes reverb.com ignores API bearer auth. Also try without auth to see if it redirects/blocks differently.
  const withoutAuth = await fetchText(labelUrl, { token: null });
  const dimsWithoutAuth = extractDimensionText(withoutAuth.text);
  const snippetsWithoutAuth = findTextSnippets(withoutAuth.text, ['dimension', 'Your label', '46', 'weight', 'UPS', 'tracking', 'sign in', 'login']);

  return {
    ok: true,
    store: normalizedStore,
    order,
    orderNumber: raw.order_number,
    tracking: raw.shipping_code || raw.tracking_number || null,
    shippingLabelUrl: labelUrl,
    withAuth: {
      ok: withAuth.ok,
      status: withAuth.status,
      statusText: withAuth.statusText,
      finalUrl: withAuth.finalUrl,
      contentType: withAuth.contentType,
      textLength: withAuth.text.length,
      dimensionsFound: dimsWithAuth,
      snippets: snippetsWithAuth.slice(0, 8),
      first500: withAuth.text.slice(0, 500),
    },
    withoutAuth: {
      ok: withoutAuth.ok,
      status: withoutAuth.status,
      statusText: withoutAuth.statusText,
      finalUrl: withoutAuth.finalUrl,
      contentType: withoutAuth.contentType,
      textLength: withoutAuth.text.length,
      dimensionsFound: dimsWithoutAuth,
      snippets: snippetsWithoutAuth.slice(0, 8),
      first500: withoutAuth.text.slice(0, 500),
    },
  };
}


function extractHref(linkish) {
  if (!linkish) return null;
  if (typeof linkish === 'string') return linkish;
  if (typeof linkish.href === 'string') return linkish.href;
  if (linkish.web && typeof linkish.web.href === 'string') return linkish.web.href;
  return null;
}

function listingIdFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/listings\/(\d+)/) || String(url).match(/\/item\/(\d+)/);
  return m ? m[1] : null;
}

function findCategoryLikeValues(value, path = '', hits = [], depth = 0) {
  if (depth > 8 || value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findCategoryLikeValues(v, `${path}[${i}]`, hits, depth + 1));
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, val] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    const lower = key.toLowerCase();
    const looksUseful = /(category|categories|product_type|producttype|taxonomy|instrument|make|model|title|slug|name|type|classification|subtype)/.test(lower);
    if (looksUseful && (typeof val !== 'object' || val === null)) {
      hits.push({ path: nextPath, value: val });
    }
    if (typeof val === 'object' && val !== null) findCategoryLikeValues(val, nextPath, hits, depth + 1);
  }
  return hits;
}

function summarizeListing(listing) {
  const links = listing?._links ? Object.fromEntries(Object.entries(listing._links).map(([k, v]) => [k, extractHref(v) || v])) : null;
  return {
    topLevelKeys: Object.keys(listing || {}),
    basic: pick(listing, [
      'id', 'uuid', 'title', 'make', 'model', 'year', 'sku', 'slug', 'status', 'condition',
      'categories', 'category', 'product_type', 'productType', 'taxonomy', 'listing_type', 'inventory'
    ]),
    links,
    categoryLikeValues: findCategoryLikeValues(listing).slice(0, 250),
    rawListing: listing,
  };
}

async function fetchReverbListing({ store, order, listing }) {
  const { token, store: normalizedStore } = tokenForStore(store);
  if (!token) {
    throw new Error(`Missing Reverb token for ${normalizedStore}. Set ${normalizedStore === 'main' ? 'REVERB_MAIN_TOKEN' : 'REVERB_WAREHOUSE_TOKEN'}.`);
  }

  let listingUrl = null;
  let orderNumber = null;
  let orderTracking = null;
  let orderTitle = null;
  let orderSku = null;

  if (listing) {
    const clean = String(listing).trim();
    if (/^https?:\/\//i.test(clean)) listingUrl = clean;
    else listingUrl = `${config.reverbBaseUrl}/listings/${encodeURIComponent(clean)}`;
  } else if (order) {
    const { raw } = await fetchReverbOrder({ store, order });
    orderNumber = raw.order_number || order;
    orderTracking = raw.shipping_code || raw.tracking_number || null;
    orderTitle = raw.title || null;
    orderSku = raw.sku || null;
    listingUrl = extractHref(raw?._links?.listing) || null;
  }

  if (!listingUrl) throw new Error('Missing listing. Use ?listing=97003959 or ?order=26226710');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/hal+json',
    'Accept-Version': '3.0',
    'User-Agent': 'shipstation-supplies-sync/1.0.5-reverb-listing-debug',
  };

  const raw = await httpJson(listingUrl, { headers });
  return { raw, listingUrl, token, normalizedStore, orderNumber, orderTracking, orderTitle, orderSku };
}

export async function debugReverbListing({ store, order, listing }) {
  const { raw, listingUrl, token, normalizedStore, orderNumber, orderTracking, orderTitle, orderSku } = await fetchReverbListing({ store, order, listing });
  return {
    ok: true,
    store: normalizedStore,
    order: order || null,
    listing: listing || listingIdFromUrl(listingUrl),
    listingUrl,
    tokenPresent: Boolean(token),
    tokenPreview: maskToken(token),
    orderContext: {
      orderNumber,
      tracking: orderTracking,
      title: orderTitle,
      sku: orderSku,
    },
    ...summarizeListing(raw),
  };
}
