import express from 'express';
import { config, publicConfig } from './config.js';
import { runShipStationSync } from './sync_shipstation.js';
import { debugReverbOrder, debugReverbLabel } from './reverb_debug.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

function checkSecret(req, res) {
  if (!config.jobSecret) return true;
  const got = req.query.secret || req.headers['x-job-secret'];
  if (got !== config.jobSecret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'shipstation-supplies-sync', version: '1.0.4-reverb-label-debug', config: publicConfig() });
});

app.get('/jobs/shipstation/supplies-sync', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await runShipStationSync();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, status: err.status, body: err.body });
  }
});


app.get('/jobs/reverb/debug-order', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await debugReverbOrder({ store: req.query.store || 'main', order: req.query.order });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, status: err.status, body: err.body });
  }
});


app.get('/jobs/reverb/debug-label', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await debugReverbLabel({ store: req.query.store || 'main', order: req.query.order });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, status: err.status, body: err.body });
  }
});

app.post('/webhooks/shipstation/shipment', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await runShipStationSync({ webhookPayload: req.body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, status: err.status, body: err.body });
  }
});

app.listen(config.port, () => {
  console.log(`shipstation-supplies-sync listening on port ${config.port}`);
});
