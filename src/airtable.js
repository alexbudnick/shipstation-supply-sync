import { config } from './config.js';
import { httpJson } from './http.js';

function enc(x) { return encodeURIComponent(x); }
function baseUrl(table) { return `https://api.airtable.com/v0/${config.airtableBaseId}/${enc(table)}`; }
function headers() { return { Authorization: `Bearer ${config.airtablePat}`, 'Content-Type': 'application/json' }; }

export async function listRecords(table, { filterByFormula = '', pageSize = 100 } = {}) {
  const all = [];
  let offset = '';
  do {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (filterByFormula) params.set('filterByFormula', filterByFormula);
    if (offset) params.set('offset', offset);
    const body = await httpJson(`${baseUrl(table)}?${params}`, { headers: headers() });
    all.push(...(body.records || []));
    offset = body.offset || '';
  } while (offset);
  return all;
}

export async function createRecord(table, fields) {
  const body = await httpJson(baseUrl(table), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  return body;
}

export async function updateRecord(table, recordId, fields) {
  const body = await httpJson(`${baseUrl(table)}/${recordId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  return body;
}

function q(s) { return String(s || '').replace(/'/g, "\\'"); }

export async function fetchSupplyItems() {
  const records = await listRecords(config.supplyItemsTable);
  return records
    .filter(r => r.fields['Active'] !== false)
    .map(r => ({
      id: r.id,
      name: r.fields['Supply Name'] || r.fields['Name'] || r.fields['Box Code'] || r.id,
      packageName: r.fields['ShipStation Package Name'] || '',
      packageId: r.fields['ShipStation Package ID'] || '',
      ssLength: Number(r.fields['ShipStation Length'] || 0),
      ssWidth: Number(r.fields['ShipStation Width'] || 0),
      ssHeight: Number(r.fields['ShipStation Height'] || 0),
    }));
}

export async function movementExists(externalRecordId, trackingNumber, shipmentId) {
  const checks = [];
  if (externalRecordId) checks.push(`{External Record ID}='${q(externalRecordId)}'`);
  if (trackingNumber) checks.push(`{Tracking Number}='${q(trackingNumber)}'`);
  if (shipmentId) checks.push(`{ShipStation Shipment ID}='${q(shipmentId)}'`);
  if (!checks.length) return false;
  const formula = `OR(${checks.join(',')})`;
  const existing = await listRecords(config.supplyMovementsTable, { filterByFormula: formula, pageSize: 10 });
  return existing.length > 0;
}

export async function createSyncRun(fields) {
  return createRecord(config.syncRunsTable, fields);
}

export async function finishSyncRun(recordId, fields) {
  return updateRecord(config.syncRunsTable, recordId, fields);
}

export async function createMovement(fields) {
  return createRecord(config.supplyMovementsTable, fields);
}
