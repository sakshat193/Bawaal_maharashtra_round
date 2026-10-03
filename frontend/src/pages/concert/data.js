export const CONCERTS = Object.freeze([
  { hue: 295, hue2: 210, photo: 47 },
  { hue: 25, hue2: 340, photo: 44 },
  { hue: 165, hue2: 250, photo: 49 },
  { hue: 235, hue2: 280, photo: 12 },
  { hue: 130, hue2: 70, photo: 59 },
  { hue: 10, hue2: 40, photo: 25 },
  { hue: 65, hue2: 25, photo: 53 },
  { hue: 345, hue2: 285, photo: 32 }
]);

export const PALETTE = Object.freeze(['#C4B5FD', '#A78BFA', '#F5D0FE', '#93C5FD']);

const PHASE_STYLE = Object.freeze({
  scheduled: { pill: 'Scheduled', short: 'Scheduled', bg: 'rgba(124,58,237,0.18)', color: '#C4B5FD' },
  open: { pill: 'Registration open', short: 'Open', bg: 'rgba(134,239,172,0.14)', color: '#86EFAC' },
  sealed: { pill: 'Entries sealed', short: 'Sealed', bg: 'rgba(34,211,238,0.12)', color: '#67E8F9' },
  drawn: { pill: 'Draw complete', short: 'Drawn', bg: 'rgba(245,158,11,0.15)', color: '#FCD34D' },
  settled: { pill: 'Settled', short: 'Settled', bg: 'rgba(255,255,255,0.08)', color: '#D6D5E0' }
});

const radial = (style, first, second) =>
  `radial-gradient(120% 85% at 85% 0%, oklch(0.62 0.19 ${style.hue} / ${first}), oklch(0.3 0.12 ${style.hue} / 0) 62%), radial-gradient(90% 70% at 0% 100%, oklch(0.55 0.17 ${style.hue2} / ${second}), oklch(0.3 0.1 ${style.hue2} / 0) 70%)`;

function stableIndex(id) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % CONCERTS.length;
}

export function present(drop) {
  const style = CONCERTS[stableIndex(drop.drop_id)];
  const phase = PHASE_STYLE[drop.phase] || PHASE_STYLE.scheduled;
  const startsAt = new Date(drop.starts_at);
  const date = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'
  }).format(startsAt);
  const dateLong = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata'
  }).format(startsAt);

  return {
    ...drop,
    ...style,
    day: new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(startsAt),
    mon: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }).format(startsAt).toUpperCase(),
    date,
    dateLong,
    poster: `${radial(style, 0.85, 0.7)}, #14121C`,
    tint: radial(style, 0.9, 0.75),
    photoUrl: `https://i.pravatar.cc/1000?img=${style.photo}`,
    pill: phase.pill,
    pillShort: phase.short,
    pillBg: phase.bg,
    pillColor: phase.color
  };
}
