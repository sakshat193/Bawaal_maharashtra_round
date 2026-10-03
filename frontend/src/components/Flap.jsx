import { useEffect, useState } from 'react';

const TONES = {
  violet: { c: '#F4F1FF', g: 'rgba(124,58,237,0.75)', o: 'rgba(167,139,250,0.12)' },
  cyan: { c: '#ECFEFF', g: 'rgba(34,211,238,0.7)', o: 'rgba(34,211,238,0.16)' },
  amber: { c: '#FFF4DC', g: 'rgba(245,158,11,0.75)', o: 'rgba(251,191,36,0.16)' }
};

function Half({ which, v, tn, extra }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, height: '50%', overflow: 'hidden', [which]: 0, background: which === 'top' ? '#181725' : '#13121D', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', ...extra }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: which === 'top' ? 0 : '-100%', height: '200%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tn.c, textShadow: `-0.012em 0 rgba(255,46,99,0.5), 0.012em 0 rgba(34,211,238,0.5), 0 0 0.16em ${tn.g}` }}>{v}</div>
    </div>
  );
}

/** One split-flap character. Flips top-then-bottom when `v` changes. */
export function Flap({ v, tone = 'violet' }) {
  const tn = TONES[tone] || TONES.violet;
  const [st, set] = useState({ cur: v, prev: v, k: 0 });
  useEffect(() => { if (v !== st.cur) set(s => ({ cur: v, prev: s.cur, k: s.k + 1 })); }, [v]); // eslint-disable-line
  return (
    <div style={{ position: 'relative', width: '0.58em', height: '1em', perspective: '2.4em', borderRadius: '0.04em', outline: `1px solid ${tn.o}` }}>
      <Half which="top" v={st.cur} tn={tn} />
      <Half which="bottom" v={st.k ? st.prev : st.cur} tn={tn} />
      {st.k > 0 && <Half key={'t' + st.k} which="top" v={st.prev} tn={tn} extra={{ transformOrigin: '50% 100%', animation: 'fdFlapTop 190ms cubic-bezier(.55,0,.85,.35) both', zIndex: 2 }} />}
      {st.k > 0 && <Half key={'b' + st.k} which="bottom" v={st.cur} tn={tn} extra={{ transformOrigin: '50% 0%', animation: 'fdFlapBot 280ms 180ms cubic-bezier(.2,.8,.25,1) both', zIndex: 2 }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(50% - 0.006em)', height: '0.012em', background: '#0A0A0F', zIndex: 3 }} />
    </div>
  );
}

/** A string of flaps; digits flip, separators (":" ",") render static. Keys are right-aligned so digits stay stable. */
export function FlapString({ value, tone }) {
  const chars = String(value).split(''), n = chars.length;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.05em' }}>
      {chars.map((ch, i) => /[0-9]/.test(ch)
        ? <Flap key={'p' + (n - i)} v={ch} tone={tone} />
        : <span key={'p' + (n - i)} style={{ color: '#7A7A8C', width: ch === ':' ? '0.22em' : '0.16em', textAlign: 'center', alignSelf: ch === ':' ? 'center' : 'flex-end' }}>{ch}</span>)}
    </div>
  );
}
