import dotenv from 'dotenv';
dotenv.config();

function bool(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'y'].includes(String(v).toLowerCase());
}

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number`);
  return n;
}

export const config = {
  port: num('PORT', 3000),
  jobSecret: process.env.JOB_SECRET || '',
  dryRun: bool('DRY_RUN', true),
  lookbackHours: num('LOOKBACK_HOURS', 72),
  pageSize: num('SHIPSTATION_PAGE_SIZE', 50),
  maxPages: num('MAX_PAGES', 5),
  onlyTracking: (process.env.ONLY_TRACKING || '').trim(),
  onlyShipmentId: (process.env.ONLY_SHIPMENT_ID || '').trim(),

  airtablePat: process.env.AIRTABLE_PAT || '',
  airtableBaseId: process.env.AIRTABLE_BASE_ID || '',
  supplyItemsTable: process.env.AIRTABLE_SUPPLY_ITEMS_TABLE || 'Supply Items',
  supplyMovementsTable: process.env.AIRTABLE_SUPPLY_MOVEMENTS_TABLE || 'Supply Movements',
  syncRunsTable: process.env.AIRTABLE_SYNC_RUNS_TABLE || 'Sync Runs',

  shipstationApiKey: process.env.SHIPSTATION_V2_API_KEY || process.env.SHIPSTATION_API_KEY || '',
  shipstationBaseUrl: (process.env.SHIPSTATION_V2_BASE_URL || 'https://api.shipstation.com/v2').replace(/\/$/, ''),
};

export function assertRequiredConfig() {
  const missing = [];
  for (const [key, val] of Object.entries({
    AIRTABLE_PAT: config.airtablePat,
    AIRTABLE_BASE_ID: config.airtableBaseId,
    SHIPSTATION_V2_API_KEY: config.shipstationApiKey,
  })) {
    if (!val) missing.push(key);
  }
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

export function publicConfig() {
  return {
    dryRun: config.dryRun,
    lookbackHours: config.lookbackHours,
    pageSize: config.pageSize,
    maxPages: config.maxPages,
    onlyTracking: config.onlyTracking || null,
    onlyShipmentId: config.onlyShipmentId || null,
    airtableBaseId: config.airtableBaseId,
    supplyItemsTable: config.supplyItemsTable,
    supplyMovementsTable: config.supplyMovementsTable,
    syncRunsTable: config.syncRunsTable,
    shipstationBaseUrl: config.shipstationBaseUrl,
    hasShipStationKey: Boolean(config.shipstationApiKey),
  };
}
