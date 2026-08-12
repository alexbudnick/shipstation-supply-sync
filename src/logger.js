export const logger = {
  info(message, obj = {}) { console.log(`[INFO] ${message}`, Object.keys(obj).length ? JSON.stringify(obj, null, 2) : ''); },
  warn(message, obj = {}) { console.warn(`[WARN] ${message}`, Object.keys(obj).length ? JSON.stringify(obj, null, 2) : ''); },
  error(message, obj = {}) { console.error(`[ERROR] ${message}`, Object.keys(obj).length ? JSON.stringify(obj, null, 2) : ''); },
};
