export async function httpJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
