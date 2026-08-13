# ShipStation Supplies Sync — 1.0.2 linked record fix

This build fixes Airtable linked record writes for REST API. Linked fields now receive arrays of Airtable record ID strings instead of scripting-style `{ id: ... }` objects.

# ShipStation Supplies Sync

This Railway app checks ShipStation labels, matches the package/box to Airtable `Supply Items`, and creates `Supply Movements` rows so shipping supplies inventory updates automatically.

## What it does

1. Reads recent ShipStation V2 shipments with purchased labels.
2. Reads package name, package ID, dimensions, tracking, carrier, and service when available.
3. Matches to Airtable `Supply Items` by:
   - `ShipStation Package Name` first
   - `ShipStation Package ID` second
   - `ShipStation Length` / `ShipStation Width` / `ShipStation Height` third
4. Creates one `Supply Movements` row with `Quantity Change = -1`.
5. Creates a `Sync Runs` log row.
6. Skips labels already counted by `External Record ID`, `Tracking Number`, or `ShipStation Shipment ID`.
7. Marks unmatched labels as `Needs Review` with `Quantity Change = 0` so your inventory does not get reduced incorrectly.

## Railway start command

```bash
npm start
```

## Manual run URL

```text
https://YOUR-APP.up.railway.app/jobs/shipstation/supplies-sync?secret=YOUR_JOB_SECRET
```

## Webhook URL later

```text
https://YOUR-APP.up.railway.app/webhooks/shipstation/shipment?secret=YOUR_JOB_SECRET
```

## First test settings

Use these first:

```text
DRY_RUN=true
LOOKBACK_HOURS=72
MAX_PAGES=2
ONLY_TRACKING=PUT_ONE_RECENT_TRACKING_NUMBER_HERE
```

Once the dry-run log shows the right movement for the right box, change:

```text
DRY_RUN=false
```

Then run the same URL again.

## Required Airtable fields

### Supply Items

- Supply Name
- Active
- ShipStation Package Name
- ShipStation Package ID
- ShipStation Length
- ShipStation Width
- ShipStation Height

### Supply Movements

- Movement ID
- Supply Item
- Movement Type
- Quantity Change
- Movement Date
- Source
- ShipStation Shipment ID
- Order Number
- Tracking Number
- ShipStation Package Name
- Carrier
- Service
- Sync Run
- Record URL
- External Record ID
- Match Method
- Matched Dimensions
- Needs Review
- ShipStation Package ID
- Notes

### Sync Runs

- Sync Run ID
- Sync Type
- Started At
- Finished At
- Status
- Records Checked
- Movements Created
- Skipped / Already Counted
- Warnings
- Error Details

## Notes

This first version is ShipStation only. Reverb direct-label automation should be added after we confirm what Reverb exposes for purchased label dimensions.


## Debug update 1.0.1

This version adds `DEBUG_PREVIEW=true` by default. Dry-run responses include a `debugPreview` array showing shipment ID, order number, tracking number, package name, dimensions, match result, and raw key names from ShipStation.

It also applies `ONLY_TRACKING` and `ONLY_SHIPMENT_ID` filters client-side, because ShipStation may ignore some query filters.


## Reverb listing/category debug

Test an order's listing/category data:

```bash
https://YOUR-APP.up.railway.app/jobs/reverb/debug-listing?secret=YOUR_SECRET&store=main&order=26226710
```

Or test a listing directly:

```bash
https://YOUR-APP.up.railway.app/jobs/reverb/debug-listing?secret=YOUR_SECRET&store=main&listing=97003959
```
