function normName(s) { return String(s || '').trim().toLowerCase(); }
function dimsKey(l, w, h) {
  const vals = [Number(l || 0), Number(w || 0), Number(h || 0)].sort((a, b) => a - b);
  return vals.map(v => String(v)).join('x');
}

export function formatDims(p) {
  if (!p.length && !p.width && !p.height) return '';
  return `${p.length} x ${p.width} x ${p.height}`;
}

export function matchSupplyItem(pkg, supplyItems) {
  const packageName = normName(pkg.packageName);
  if (packageName) {
    const exact = supplyItems.find(i => normName(i.packageName) === packageName);
    if (exact) return { item: exact, method: 'Package Name', review: false, warning: '' };
  }

  if (pkg.packageId) {
    const byId = supplyItems.find(i => String(i.packageId || '') === String(pkg.packageId));
    if (byId) return { item: byId, method: 'Package Name', review: false, warning: '' };
  }

  const key = dimsKey(pkg.length, pkg.width, pkg.height);
  if (key !== '0x0x0') {
    const matches = supplyItems.filter(i => dimsKey(i.ssLength, i.ssWidth, i.ssHeight) === key);
    if (matches.length === 1) return { item: matches[0], method: 'Dimensions', review: false, warning: '' };
    if (matches.length > 1) return { item: null, method: 'Unknown', review: true, warning: `Multiple supply items match dimensions ${formatDims(pkg)}.` };
  }

  return { item: null, method: 'Unknown', review: true, warning: `No supply item matched package name "${pkg.packageName || '(blank)'}" and dimensions ${formatDims(pkg) || '(blank)'}.` };
}
