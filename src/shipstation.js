import { config } from './config.js';
import { httpJson } from './http.js';

function headers() {
  return { 'API-Key': config.shipstationApiKey, 'Content-Type': 'application/json' };
}

export async function listRecentShipments() {
  const all = [];
  const start = new Date(Date.now() - config.lookbackHours * 60 * 60 * 1000).toISOString();

  for (let page = 1; page <= config.maxPages; page++) {
    const params = new URLSearchParams({
      shipment_status: 'label_purchased',
      created_at_start: start,
      page: String(page),
      page_size: String(config.pageSize),
      sort_by: 'created_at',
      sort_dir: 'desc',
    });
    if (config.onlyShipmentId) params.set('shipment_id', config.onlyShipmentId);
    const body = await httpJson(`${config.shipstationBaseUrl}/shipments?${params}`, { headers: headers() });
    const shipments = body.shipments || body.data || body.results || [];
    all.push(...shipments);
    const totalPages = body.pages || body.total_pages || null;
    if (shipments.length < config.pageSize) break;
    if (totalPages && page >= totalPages) break;
  }

  if (config.onlyTracking) {
    return all.filter(s => getTrackingNumber(s) === config.onlyTracking || (s.packages || []).some(p => p.tracking_number === config.onlyTracking));
  }
  return all;
}

export async function fetchResourceUrl(resourceUrl) {
  return httpJson(resourceUrl, { headers: headers() });
}

function dimVal(dim, key) {
  if (!dim) return 0;
  const v = dim[key] ?? dim[key.charAt(0)] ?? dim[key.toUpperCase()];
  return Number(v || 0);
}

export function normalizeShipment(shipment) {
  const packages = shipment.packages && shipment.packages.length ? shipment.packages : [shipment];
  return packages.map((pkg, idx) => {
    const dimensions = pkg.dimensions || shipment.dimensions || {};
    const shipmentId = shipment.shipment_id || shipment.shipmentId || shipment.id || pkg.shipment_id || '';
    const trackingNumber = pkg.tracking_number || shipment.tracking_number || shipment.trackingNumber || '';
    const externalRecordId = pkg.shipment_package_id || pkg.package_id || shipmentId || trackingNumber;
    return {
      raw: shipment,
      packageRaw: pkg,
      shipmentId: String(shipmentId || ''),
      shipmentNumber: shipment.shipment_number || shipment.shipmentNumber || shipment.order_number || shipment.orderNumber || '',
      orderNumber: shipment.order_number || shipment.orderNumber || shipment.external_order_id || shipment.shipment_number || shipment.shipmentNumber || '',
      trackingNumber: String(trackingNumber || ''),
      packageName: pkg.package_name || pkg.packageName || pkg.package_code || pkg.packageCode || shipment.package_name || shipment.packageCode || '',
      packageId: pkg.package_id || pkg.packageId || pkg.shipment_package_id || '',
      carrier: shipment.carrier_code || shipment.carrierCode || shipment.carrier_id || shipment.carrier_id || '',
      service: shipment.service_code || shipment.serviceCode || shipment.service_name || shipment.serviceName || '',
      length: dimVal(dimensions, 'length'),
      width: dimVal(dimensions, 'width'),
      height: dimVal(dimensions, 'height'),
      createdAt: shipment.created_at || shipment.createDate || shipment.ship_date || new Date().toISOString(),
      recordUrl: shipment.href || shipment._links?.self?.href || '',
      externalRecordId: String(externalRecordId || `${shipmentId}-${idx}`),
    };
  });
}

export function getTrackingNumber(shipment) {
  return shipment.tracking_number || shipment.trackingNumber || shipment.packages?.[0]?.tracking_number || '';
}
