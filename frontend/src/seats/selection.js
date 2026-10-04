// Pure seat-click rules, shared by the 3D map and the grid (tested in selection.test.js).

/** What happens when a winner clicks seat `index`. Returns { seats } to send, or { blocked } with a reason. */
export function nextSelection(index, { mine = [], locked = [], booked = [], quantity = 1 }) {
  if (mine.includes(index)) return { seats: mine.filter(seat => seat !== index) };      // unselect
  if (booked.includes(index)) return { blocked: 'booked' };
  if (locked.includes(index)) return { blocked: 'locked' };
  if (mine.length < quantity) return { seats: [...mine, index] };
  // Already holding `quantity` seats: swap out the earliest choice, so one click moves you.
  return { seats: [...mine.slice(1), index] };
}

/** Countdown text "m:ss" to an ISO time, given the server-corrected clock. */
export function untilText(iso, now) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function labelFor(labels, index) {
  const l = labels[index];
  return l ? `Row ${l.row} · Seat ${l.seat}` : `Seat ${index + 1}`;
}
