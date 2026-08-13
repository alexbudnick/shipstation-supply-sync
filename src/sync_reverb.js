import { assertRequiredConfig, config, publicConfig } from './config.js';
import { logger } from './logger.js';
import {
  fetchSupplyItems,
  createMovement,
  createSyncRun,
  finishSyncRun,
  listRecords,
  updateRecord,
} from './airtable.js';
import { httpJson } from './http.js';

function tokenForStore(store) {
  const normalized = String(store || 'main').toLowerCase();
  if (['warehouse', 'wh', 'deals', 'reverb-warehouse', 'warehouse-reverb'].includes(normalized)) {
    return { token: config.reverbWarehouseToken, store: 'warehouse', syncType: 'Reverb Warehouse' };
  }
  return { token: config.reverbMainToken, store: 'main', syncType: 'Reverb Main' };
}

function reverbHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/hal+json',
    'Accept-Version': '3.0',
    'Content-Type': 'application/hal+json',
    'User-Agent': 'shipstation-supplies-sync/1.0.6-reverb-category-sync',
  };
}

function extractHref(linkish) {
  if (!linkish) return null;
  if (typeof linkish === 'string') return linkish;
  if (typeof linkish.href === 'string') return linkish.href;
  if (linkish.web && typeof linkish.web.href === 'string') return linkish.web.href;
  return null;
}

function extractCollection(data) {
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

async function fetchReverbOrder(token, order) {
  const url = `${config.reverbBaseUrl}/my/orders/selling/${encodeURIComponent(order)}`;
  return httpJson(url, { headers: reverbHeaders(token) });
}

async function listRecentReverbOrders(token, { onlyOrder = '' } = {}) {
  if (onlyOrder) return [await fetchReverbOrder(token, onlyOrder)];

  const all = [];
  const cutoff = Date.now() - config.lookbackHours * 60 * 60 * 1000;

  for (let page = 1; page <= config.maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(config.pageSize),
      page: String(page),
    });
    const data = await httpJson(`${config.reverbBaseUrl}/my/orders/selling/all?${params}`, { headers: reverbHeaders(token) });
    const orders = extractCollection(data);
    all.push(...orders);
    if (orders.length < config.pageSize) break;
  }

  return all.filter(order => {
    const status = String(order.status || order.shipment_status || '').toLowerCase();
    const shippedLike = Boolean(order.shipping_code || order.tracking_number || order.shipped_at || order.shipping_date || status.includes('shipped') || status.includes('transit'));
    const dateRaw = order.shipped_at || order.updated_at || order.shipping_date || order.paid_at || order.created_at;
    const t = dateRaw ? new Date(dateRaw).getTime() : 0;
    return shippedLike && (!t || t >= cutoff);
  });
}

async function fetchListingForOrder(token, order) {
  let listingUrl = extractHref(order?._links?.listing);
  if (!listingUrl && order.product_id) listingUrl = `${config.reverbBaseUrl}/listings/${encodeURIComponent(order.product_id)}`;
  if (!listingUrl) return null;
  return httpJson(listingUrl, { headers: reverbHeaders(token) });
}

function categoryNames(listing) {
  const cats = Array.isArray(listing?.categories) ? listing.categories : [];
  return cats.map(c => c.full_name || c.name || c.slug || '').filter(Boolean);
}

function boxCodeForListing(listing) {
  const haystack = [
    ...categoryNames(listing),
    listing?.shipping_profile?.name || '',
    listing?.title || '',
  ].join(' | ').toLowerCase();

  // More specific first.
  if (/\bbass\b|basses/.test(haystack)) return { boxCode: 'Box R', reason: 'Bass category/title' };
  if (/semi[\s-]?hollow|hollowbody|hollow body|archtop|acoustic guitar|classical guitar|resonator/.test(haystack)) return { boxCode: 'Box Q', reason: 'Acoustic/hollow/semi-hollow category/title' };
  if (/electric guitar|solid body/.test(haystack)) return { boxCode: 'Box P', reason: 'Electric guitar category' };

  return { boxCode: '', reason: 'No category rule matched' };
}

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function findSupplyByBoxCode(supplyItems, boxCode) {
  const wanted = normalize(boxCode);
  if (!wanted) return null;
  return supplyItems.find(i =>
    normalize(i.boxCode) === wanted ||
    normalize(i.name) === wanted ||
    normalize(i.name).startsWith(`${wanted} `) ||
    normalize(i.packageName).startsWith(`${wanted} `) ||
    normalize(i.packageName) === wanted
  ) || null;
}

function q(s) { return String(s || '').replace(/'/g, "\\'"); }

async function findExistingMovement({ movementId, reverbOrderId, orderNumber, trackingNumber }) {
  const checks = [];
  if (movementId) checks.push(`{Movement ID}='${q(movementId)}'`);
  if (reverbOrderId) checks.push(`{Reverb Order ID}='${q(reverbOrderId)}'`);
  if (orderNumber) checks.push(`{Order Number}='${q(orderNumber)}'`);
  if (trackingNumber) checks.push(`{Tracking Number}='${q(trackingNumber)}'`);
  if (!checks.length) return [];
  return listRecords(config.supplyMovementsTable, { filterByFormula: `OR(${checks.join(',')})`, pageSize: 20 });
}

function existingAlreadyCounted(records) {
  return records.some(r => {
    const f = r.fields || {};
    const hasSupplyItem = Array.isArray(f['Supply Item']) && f['Supply Item'].length > 0;
    const qty = Number(f['Quantity Change'] || 0);
    const needsReview = Boolean(f['Needs Review']);
    return hasSupplyItem && qty < 0 && !needsReview;
  });
}

function pickUpdateCandidate(records) {
  return records.find(r => {
    const f = r.fields || {};
    const hasSupplyItem = Array.isArray(f['Supply Item']) && f['Supply Item'].length > 0;
    const qty = Number(f['Quantity Change'] || 0);
    return Boolean(f['Needs Review']) || !hasSupplyItem || qty === 0;
  }) || null;
}

function orderNumberOf(order) {
  return String(order.order_number || order.orderNumber || order.id || '').trim();
}

function trackingOf(order) {
  return String(order.shipping_code || order.tracking_number || order.trackingNumber || '').trim();
}

function webUrlOf(order) {
  return extractHref(order?._links?.web) || '';
}

export async function runReverbSupplySync({ store = 'main', onlyOrder = '', dryRunOverride = null } = {}) {
  assertRequiredConfig();
  const { token, store: normalizedStore, syncType } = tokenForStore(store);
  if (!token) throw new Error(`Missing Reverb token for ${normalizedStore}. Set ${normalizedStore === 'main' ? 'REVERB_MAIN_TOKEN' : 'REVERB_WAREHOUSE_TOKEN'}.`);

  const dryRun = dryRunOverride === null ? config.dryRun : Boolean(dryRunOverride);
  logger.info('Starting Reverb supplies sync', { ...publicConfig(), store: normalizedStore, dryRun, onlyOrder: onlyOrder || null });

  const startedAt = new Date();
  let syncRun = null;
  const stats = { recordsChecked: 0, movementsCreated: 0, movementsUpdated: 0, skipped: 0, warnings: [] };
  const debugPreview = [];

  if (!dryRun) {
    syncRun = await createSyncRun({
      'Sync Run ID': `${syncType.toUpperCase().replace(/\s+/g, '-')}-${startedAt.toISOString()}`,
      'Sync Type': syncType,
      'Started At': startedAt.toISOString(),
      'Status': 'Running',
    });
  }

  try {
    const supplyItems = await fetchSupplyItems();
    const orders = await listRecentReverbOrders(token, { onlyOrder });

    for (const order of orders) {
      stats.recordsChecked++;
      const orderNumber = orderNumberOf(order);
      const trackingNumber = trackingOf(order);
      const reverbOrderId = orderNumber;
      const movementId = `REVERB-${normalizedStore.toUpperCase()}-${orderNumber || order.uuid || trackingNumber}`.slice(0, 255);

      if (!trackingNumber) {
        stats.warnings.push(`${orderNumber || order.uuid || '(unknown order)'}: No tracking number; skipped.`);
        stats.skipped++;
        continue;
      }

      const existing = await findExistingMovement({ movementId, reverbOrderId, orderNumber, trackingNumber });
      if (existingAlreadyCounted(existing)) {
        stats.skipped++;
        continue;
      }

      const listing = await fetchListingForOrder(token, order);
      const categories = categoryNames(listing);
      const { boxCode, reason } = boxCodeForListing(listing || {});
      const matchedItem = findSupplyByBoxCode(supplyItems, boxCode);
      const warning = matchedItem
        ? ''
        : `${orderNumber || trackingNumber}: Reverb category could not be matched to a supply item. Categories: ${categories.join(', ') || '(blank)'}. Rule result: ${boxCode || '(none)'}.`;
      if (warning) stats.warnings.push(warning);

      const fields = {
        'Movement ID': movementId,
        'Movement Type': 'Label Created',
        'Quantity Change': matchedItem ? -1 : 0,
        'Movement Date': order.shipped_at || order.shipping_date || order.updated_at || order.created_at || new Date().toISOString(),
        'Source': 'Reverb Automation',
        'Order Number': orderNumber,
        'Tracking Number': trackingNumber,
        'Carrier': order.shipping_provider || '',
        'Service': order.shipping_method || '',
        'Record URL': webUrlOf(order),
        'External Record ID': String(order.uuid || order.id || orderNumber || trackingNumber),
        'Match Method': matchedItem ? 'Reverb Category' : 'Unknown',
        'Matched Dimensions': '',
        'Needs Review': !matchedItem,
        'Reverb Order ID': reverbOrderId,
        'Notes': matchedItem
          ? `Matched from Reverb listing category: ${categories.join(', ') || '(blank)'}. Rule: ${reason}.`
          : (warning || 'Reverb category unavailable or unmatched. Select Supply Item manually.'),
      };
      if (matchedItem) fields['Supply Item'] = [matchedItem.id];
      if (syncRun) fields['Sync Run'] = [syncRun.id];

      const updateCandidate = pickUpdateCandidate(existing);
      const action = updateCandidate ? 'update' : 'create';

      if (config.debugPreview && debugPreview.length < 50) {
        debugPreview.push({
          action,
          existingRecordId: updateCandidate?.id || null,
          orderNumber,
          trackingNumber,
          carrier: order.shipping_provider || null,
          listingId: listing?.id || order.product_id || null,
          listingTitle: listing?.title || order.title || null,
          categories,
          shippingProfile: listing?.shipping_profile?.name || null,
          boxRule: boxCode || null,
          ruleReason: reason,
          matchedSupplyItem: matchedItem ? matchedItem.name : null,
          matchMethod: fields['Match Method'],
          needsReview: fields['Needs Review'],
          warning: warning || null,
        });
      }

      if (dryRun) {
        logger.info(`DRY RUN would ${action} Reverb movement`, fields);
      } else if (updateCandidate) {
        await updateRecord(config.supplyMovementsTable, updateCandidate.id, fields);
        stats.movementsUpdated++;
      } else {
        await createMovement(fields);
        stats.movementsCreated++;
      }
    }

    const status = stats.warnings.length ? 'Complete With Warnings' : 'Complete';
    if (syncRun) {
      await finishSyncRun(syncRun.id, {
        'Finished At': new Date().toISOString(),
        'Status': status,
        'Records Checked': stats.recordsChecked,
        'Movements Created': stats.movementsCreated + stats.movementsUpdated,
        'Skipped / Already Counted': stats.skipped,
        'Warnings': stats.warnings.join('\n'),
      });
    }

    logger.info('Reverb supplies sync complete', { ...stats, dryRun, store: normalizedStore });
    return { ok: true, dryRun, store: normalizedStore, ...stats, debugPreview };
  } catch (err) {
    logger.error('Reverb supplies sync failed', { message: err.message, status: err.status, body: err.body, stack: err.stack });
    if (syncRun) {
      await finishSyncRun(syncRun.id, {
        'Finished At': new Date().toISOString(),
        'Status': 'Failed',
        'Records Checked': stats.recordsChecked,
        'Movements Created': stats.movementsCreated + stats.movementsUpdated,
        'Skipped / Already Counted': stats.skipped,
        'Warnings': stats.warnings.join('\n'),
        'Error Details': `${err.message}\n${err.body ? JSON.stringify(err.body, null, 2) : ''}`,
      });
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReverbSupplySync().then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('FATAL_REVERB_SYNC_ERROR_JSON=' + JSON.stringify({ message: err.message, status: err.status, body: err.body, stack: err.stack }, null, 2));
    process.exit(1);
  });
}
