import { assertRequiredConfig, publicConfig } from './config.js';
assertRequiredConfig();
console.log(JSON.stringify({ ok: true, config: publicConfig() }, null, 2));
