export const CONCERTS = [
  { id: 'halcyon', artist: 'Halcyon Array', tag: 'The Afterglow Tour', venue: 'Pier Nine Arena', city: 'Oakland', day: '14', mon: 'NOV', dow: 'Sat', dateLong: 'Saturday 14 November', doors: '6:30 pm', show: '8:00 pm', genre: 'Electronic', from: 89, status: 'onsale', sold: 0.62, hue: 295, hue2: 210, age: 'All ages', photo: 47, lineup: [['DJ Okafor', '6:45 pm'], ['Pale Signal', '7:15 pm'], ['Halcyon Array', '8:30 pm']] },
  { id: 'vela', artist: 'Vela Moreno', tag: 'Corazón Abierto Tour', venue: 'Bayline Stadium', city: 'San Francisco', day: '20', mon: 'NOV', dow: 'Fri', dateLong: 'Friday 20 November', doors: '6:00 pm', show: '7:30 pm', genre: 'Pop', from: 65, status: 'soon', opens: 187920000, hue: 25, hue2: 340, age: 'All ages', photo: 44, lineup: [['Lila Grey', '7:30 pm'], ['Vela Moreno', '8:45 pm']] },
  { id: 'mara', artist: 'Mara Vell', tag: 'Small Hours, live', venue: 'Fox Hall', city: 'Oakland', day: '21', mon: 'NOV', dow: 'Sat', dateLong: 'Saturday 21 November', doors: '7:00 pm', show: '8:00 pm', genre: 'Indie', from: 54, status: 'few', sold: 0.91, hue: 165, hue2: 250, age: '18+', photo: 49, lineup: [['Copper Fen', '8:00 pm'], ['Mara Vell', '9:00 pm']] },
  { id: 'teo', artist: 'Teo Rask Trio', tag: 'Two nights only', venue: 'Blue Room', city: 'San Francisco', day: '25', mon: 'NOV', dow: 'Wed', dateLong: 'Wednesday 25 November', doors: '7:00 pm', show: '7:45 pm', genre: 'Jazz', from: 38, status: 'onsale', sold: 0.55, hue: 235, hue2: 280, age: '21+', photo: 12, lineup: [['Teo Rask Trio', '7:45 pm']] },
  { id: 'north', artist: 'Northbound Choir', tag: 'Winter Songs', venue: 'Greekside Amphitheatre', city: 'Berkeley', day: '03', mon: 'DEC', dow: 'Thu', dateLong: 'Thursday 3 December', doors: '5:30 pm', show: '7:00 pm', genre: 'Folk', from: 48, status: 'soon', opens: 470000000, hue: 130, hue2: 70, age: 'All ages', photo: 59, lineup: [['Hollis & May', '7:00 pm'], ['Northbound Choir', '8:15 pm']] },
  { id: 'juno', artist: 'Juno & the Lowlights', tag: 'Loud Kind of Quiet', venue: 'The Lantern', city: 'San Francisco', day: '12', mon: 'DEC', dow: 'Sat', dateLong: 'Saturday 12 December', doors: '8:00 pm', show: '9:00 pm', genre: 'Rock', from: 45, status: 'soldout', sold: 1, hue: 10, hue2: 40, age: '18+', photo: 25, lineup: [['Static Bloom', '9:00 pm'], ['Juno & the Lowlights', '10:00 pm']] },
  { id: 'oso', artist: 'Oso Grande', tag: 'Pan Dulce World Tour', venue: 'Bayline Stadium', city: 'San Francisco', day: '08', mon: 'JAN', dow: 'Fri', dateLong: 'Friday 8 January', doors: '6:00 pm', show: '8:00 pm', genre: 'Hip-hop', from: 79, status: 'onsale', sold: 0.41, hue: 65, hue2: 25, age: 'All ages', photo: 53, lineup: [['Ree Monday', '7:00 pm'], ['Oso Grande', '8:30 pm']] },
  { id: 'kite', artist: 'Kite Season', tag: 'Paper Weather', venue: 'Harbor Pavilion', city: 'San Jose', day: '16', mon: 'JAN', dow: 'Sat', dateLong: 'Saturday 16 January', doors: '6:30 pm', show: '8:00 pm', genre: 'Pop', from: 59, status: 'onsale', sold: 0.28, hue: 345, hue2: 285, age: 'All ages', photo: 32, lineup: [['June Harlow', '7:00 pm'], ['Kite Season', '8:15 pm']] }
];

export const TIERS = [
  { id: 'floor', name: 'Floor · standing', mult: 1.9, cap: 1200, bias: 0.15, color: '#C4B5FD' },
  { id: 'lower', name: 'Lower bowl', mult: 1.5, cap: 2000, bias: 0, color: '#A78BFA' },
  { id: 'upper', name: 'Upper bowl', mult: 1, cap: 2400, bias: -0.12, color: '#93C5FD' }
];

export const GENRES = ['All', 'Pop', 'Electronic', 'Indie', 'Hip-hop', 'Rock', 'Jazz', 'Folk'];
export const CITIES = ['Oakland, CA', 'San Francisco, CA', 'San Jose, CA'];
export const CAPACITY = TIERS.reduce((a, t) => a + t.cap, 0);

export const dur = ms => {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m % 60}m`;
};
export const money = v => '$' + v.toFixed(2).replace(/\.00$/, '');

const radial = (c, a1, a2) =>
  `radial-gradient(120% 85% at 85% 0%, oklch(0.62 0.19 ${c.hue} / ${a1}), oklch(0.3 0.12 ${c.hue} / 0) 62%), radial-gradient(90% 70% at 0% 100%, oklch(0.55 0.17 ${c.hue2} / ${a2}), oklch(0.3 0.1 ${c.hue2} / 0) 70%)`;

/** Everything a card / sheet / page needs to render a concert. */
export function describe(c, { now, anchor, saved }) {
  let pill;
  if (c.status === 'onsale') pill = { t: 'On sale now', s: 'On sale', bg: 'rgba(134,239,172,0.14)', col: '#86EFAC' };
  else if (c.status === 'few') pill = { t: 'Few tickets left', s: 'Few left', bg: 'rgba(251,191,36,0.15)', col: '#FCD34D' };
  else if (c.status === 'soon') pill = { t: 'On sale in ' + dur(anchor + c.opens - now), s: 'Soon', bg: 'rgba(124,58,237,0.18)', col: '#C4B5FD' };
  else pill = { t: 'Sold out · waitlist open', s: 'Sold out', bg: 'rgba(255,255,255,0.08)', col: '#9A99A8' };
  const isSaved = !!saved[c.id];
  return {
    ...c,
    date: `${c.dow} ${parseInt(c.day, 10)} ${c.mon[0]}${c.mon.slice(1).toLowerCase()}`,
    poster: radial(c, 0.85, 0.7) + ', #14121C',
    tint: radial(c, 0.9, 0.75),
    photoUrl: `https://i.pravatar.cc/1000?img=${c.photo}`,
    fromFmt: '$' + c.from,
    pill: pill.t, pillShort: pill.s, pillBg: pill.bg, pillColor: pill.col,
    soldPct: Math.round((c.sold || 0) * 100) + '%',
    soldLabel: c.status === 'soon' ? 'Not on sale yet' : c.status === 'soldout' ? 'Sold out' : Math.round(c.sold * 100) + '% sold',
    range: `$${c.from} – $${Math.round(c.from * 2.6)}`,
    support: c.lineup.filter(l => l[0] !== c.artist).map(l => l[0]).join(', ') || 'Headline set',
    saved: isSaved,
    canBuy: c.status === 'onsale' || c.status === 'few'
  };
}
