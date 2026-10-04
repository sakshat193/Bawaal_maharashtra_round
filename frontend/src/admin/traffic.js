// Operator hints only. The spec forbids weighting or publishing subnets (shared Wi-Fi is not one person),
// so nothing here feeds the draw; "red" is just a Sybil rule that already fired at seal.
export const BUSY_ENTRIES = 10;
export const BURST_SECONDS = 5;
const RANK = { red: 2, amber: 1, ok: 0 };

export function markers(row) {
  const out = [];
  if (row.excluded > 0) out.push({ level: 'red', text: `Sybil rule fired${row.reasons?.length ? ` (${row.reasons.join(', ')})` : ''}` });
  if (row.entries > row.devices) out.push({ level: 'amber', text: 'shared device' });
  if (row.entries > row.payments) out.push({ level: 'amber', text: 'shared payment' });
  if (row.entries >= BUSY_ENTRIES) out.push({ level: 'amber', text: 'busy subnet (may be shared Wi-Fi)' });
  const span = (Date.parse(row.last_at) - Date.parse(row.first_at)) / 1000;
  if (row.entries >= BUSY_ENTRIES && span <= BURST_SECONDS) out.push({ level: 'amber', text: 'burst' });
  return out;
}

export function severity(row) {
  return markers(row).reduce((worst, marker) => (RANK[marker.level] > RANK[worst] ? marker.level : worst), 'ok');
}

/** Rows with markers and severity, worst first, then biggest first. */
export function annotate(subnets = []) {
  return subnets
    .map(row => ({ ...row, markers: markers(row), level: severity(row) }))
    .sort((a, b) => RANK[b.level] - RANK[a.level] || b.entries - a.entries || a.subnet.localeCompare(b.subnet));
}
