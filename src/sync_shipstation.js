import { assertRequiredConfig, config, publicConfig } from './config.js';
import { logger } from './logger.js';
import { fetchSupplyItems, movementExists, createMovement, createSyncRun, finishSyncRun } from './airtable.js';
import { listRecentShipments, normalizeShipment, fetchResourceUrl } from './shipstation.js';
import { matchSupplyItem, formatDims } from './match.js';

export async function runShipStationSync({ webhookPayload = null } = {}) {
  assertRequiredConfig();
  logger.info('Starting ShipStation supplies sync', publicConfig());

  const startedAt = new Date();
  let syncRun = null;
  const stats = { recordsChecked: 0, movementsCreated: 0, skipped: 0, warnings: [] };
  const debugPreview = [];

  if (!config.dryRun) {
    syncRun = await createSyncRun({
      'Sync Run ID': `SHIPSTATION-${startedAt.toISOString()}`,
      'Sync Type': 'ShipStation',
      'Started At': startedAt.toISOString(),
      'Status': 'Running',
    });
  }

  try {
    const supplyItems = await fetchSupplyItems();
    logger.info('Loaded Supply Items', { count: supplyItems.length });

    let shipments = [];
    if (webhookPayload?.resource_url) {
      logger.info('Fetching ShipStation webhook resource URL', { resource_url: webhookPayload.resource_url });
      const body = await fetchResourceUrl(webhookPayload.resource_url);
      shipments = body.shipments || body.data || body.results || (Array.isArray(body) ? body : [body]);
    } else {
      shipments = await listRecentShipments();
    }

    const packages = shipments.flatMap(normalizeShipment);
    logger.info('Loaded shipments/packages', { shipments: shipments.length, packages: packages.length });

    for (const pkg of packages) {
      stats.recordsChecked++;

      const already = await movementExists(pkg.externalRecordId, pkg.trackingNumber, pkg.shipmentId);
      if (already) {
        stats.skipped++;
        continue;
      }

      const match = matchSupplyItem(pkg, supplyItems);
      if (match.warning) stats.warnings.push(`${pkg.orderNumber || pkg.shipmentId || pkg.trackingNumber}: ${match.warning}`);

      const movementId = `SHIPSTATION-${pkg.externalRecordId || pkg.trackingNumber || pkg.shipmentId}`.slice(0, 255);
      const fields = {
        'Movement ID': movementId,
        'Movement Type': 'Label Created',
        'Quantity Change': match.item ? -1 : 0,
        'Movement Date': pkg.createdAt || new Date().toISOString(),
        'Source': 'ShipStation Automation',
        'ShipStation Shipment ID': pkg.shipmentId,
        'Order Number': String(pkg.orderNumber || pkg.shipmentNumber || ''),
        'Tracking Number': pkg.trackingNumber,
        'ShipStation Package Name': pkg.packageName,
        'Carrier': pkg.carrier,
        'Service': pkg.service,
        'Record URL': pkg.recordUrl,
        'External Record ID': pkg.externalRecordId,
        'Match Method': match.method,
        'Matched Dimensions': formatDims(pkg),
        'Needs Review': Boolean(match.review),
        'ShipStation Package ID': String(pkg.packageId || ''),
        'Notes': match.warning || '',
      };

      if (config.debugPreview && debugPreview.length < 50) {
        debugPreview.push({
          shipmentId: pkg.shipmentId || null,
          externalRecordId: pkg.externalRecordId || null,
          orderNumber: String(pkg.orderNumber || pkg.shipmentNumber || '') || null,
          trackingNumber: pkg.trackingNumber || null,
          packageName: pkg.packageName || null,
          packageId: pkg.packageId || null,
          dimensions: formatDims(pkg) || null,
          carrier: pkg.carrier || null,
          service: pkg.service || null,
          createdAt: pkg.createdAt || null,
          matchMethod: match.method,
          matchedSupplyItem: match.item ? match.item.name : null,
          needsReview: Boolean(match.review),
          warning: match.warning || null,
          rawShipmentKeys: Object.keys(pkg.raw || {}).slice(0, 60),
          rawPackageKeys: Object.keys(pkg.packageRaw || {}).slice(0, 60),
        });
      }
      if (match.item) fields['Supply Item'] = [{ id: match.item.id }];
      if (syncRun) fields['Sync Run'] = [{ id: syncRun.id }];

      if (config.dryRun) {
        logger.info('DRY RUN would create movement', fields);
      } else {
        await createMovement(fields);
      }
      stats.movementsCreated++;
    }

    const status = stats.warnings.length ? 'Complete With Warnings' : 'Complete';
    if (syncRun) {
      await finishSyncRun(syncRun.id, {
        'Finished At': new Date().toISOString(),
        'Status': status,
        'Records Checked': stats.recordsChecked,
        'Movements Created': stats.movementsCreated,
        'Skipped / Already Counted': stats.skipped,
        'Warnings': stats.warnings.join('\n'),
      });
    }

    logger.info('ShipStation supplies sync complete', { ...stats, dryRun: config.dryRun });
    return { ok: true, dryRun: config.dryRun, ...stats, debugPreview };
  } catch (err) {
    logger.error('ShipStation supplies sync failed', { message: err.message, status: err.status, body: err.body, stack: err.stack });
    if (syncRun) {
      await finishSyncRun(syncRun.id, {
        'Finished At': new Date().toISOString(),
        'Status': 'Failed',
        'Records Checked': stats.recordsChecked,
        'Movements Created': stats.movementsCreated,
        'Skipped / Already Counted': stats.skipped,
        'Warnings': stats.warnings.join('\n'),
        'Error Details': `${err.message}\n${err.body ? JSON.stringify(err.body, null, 2) : ''}`,
      });
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runShipStationSync().then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('FATAL_SYNC_ERROR_JSON=' + JSON.stringify({ message: err.message, status: err.status, body: err.body, stack: err.stack }, null, 2));
    process.exit(1);
  });
}
