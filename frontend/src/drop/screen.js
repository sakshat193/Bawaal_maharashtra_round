export function screenFor(phase, me, hasToken) {
  if (!hasToken || !me?.entry) return 'detail';
  if (me.entry.status === 'registered' && phase === 'open') return 'registered';
  if (me.entry.status === 'registered' && phase === 'sealed') return 'sealed';
  return me.entry.status;
}
