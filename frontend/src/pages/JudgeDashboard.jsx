import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createJudgeScenes } from '../three/judgeScenes.js';
import Grain from '../components/Grain.jsx';
import { prefersReduced } from '../lib/constants.js';

const D = "'Big Shoulders Display', sans-serif";
const label = { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7A8C' };

/** Screen 8 — naive FIFO vs Fair Drop under the same attack. Figures are a simulated replay. */
function useScenario() {
  return useMemo(() => {
    let s = 0x5eed; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const fifoBots = Array.from({ length: 500 }, (_, i) => (i < 440 ? r() < 0.985 : r() < 0.8));
    const fb = new Set(); while (fb.size < 14) fb.add(Math.floor(r() * 500));
    const fairBots = Array.from({ length: 500 }, (_, i) => fb.has(i));
    const fairOrder = Array.from({ length: 500 }, (_, i) => i);
    for (let i = 499; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fairOrder[i], fairOrder[j]] = [fairOrder[j], fairOrder[i]]; }
    const lat = Array.from({ length: 48 }, (_, i) => 150 + 25 * Math.sin(i * 0.7) + r() * 30 + (i > 2 && i < 8 ? 60 - (i - 2) * 9 : 0));
    const spark = lat.map((v, i) => (i * 480 / 47).toFixed(1) + ',' + (80 - (v - 50) / 250 * 60).toFixed(1)).join(' ');
    return { fifoBots, fairBots, fairOrder, spark };
  }, []);
}

function SeatGrid({ cells }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(50,minmax(0,1fr))', gap: 2, maxWidth: 560 }}>
      {cells.map((c, i) => <div key={i} style={{ aspectRatio: '1 / 1', background: c }} />)}
    </div>
  );
}

export default function JudgeDashboard() {
  const sc = useScenario();
  const [p, setP] = useState(0);
  const [cap, setCap] = useState(true);
  const [claimed, setClaimed] = useState(0);
  const capRef = useRef(cap); capRef.current = cap;
  const cloudEl = useRef(), arenaEl = useRef(), eng = useRef(), rep = useRef();

  const replay = () => {
    clearInterval(rep.current);
    const t0 = Date.now();
    rep.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / 3200);
      setP(1 - Math.pow(1 - k, 2));
      if (k >= 1) clearInterval(rep.current);
    }, 60);
  };

  useEffect(() => {
    replay();
    eng.current = createJudgeScenes(cloudEl.current, arenaEl.current, { reduced: prefersReduced(), getCap: () => capRef.current, onClaimed: setClaimed });
    return () => { clearInterval(rep.current); eng.current.dispose(); };
  }, []);
  useEffect(() => { eng.current?.redraw(); }, [cap]);

  const n = Math.round(p * 500);
  const fairFilled = new Set(sc.fairOrder.slice(0, n));
  let fb = 0, rb = 0;
  const fifoCells = [], fairCells = [];
  for (let i = 0; i < 500; i++) {
    const f = i < n; if (f && sc.fifoBots[i]) fb++;
    fifoCells.push(!f ? 'rgba(255,255,255,0.06)' : sc.fifoBots[i] ? '#F59E0B' : '#67E8F9');
    const g = fairFilled.has(i); if (g && sc.fairBots[i]) rb++;
    fairCells.push(!g ? 'rgba(255,255,255,0.06)' : sc.fairBots[i] ? '#F59E0B' : '#67E8F9');
  }
  const pct = a => (n ? (a / n * 100).toFixed(1) + '%' : '—');
  const big = (glow) => ({ fontFamily: D, fontWeight: 900, fontSize: 'clamp(96px,11vw,180px)', lineHeight: 0.85, fontVariantNumeric: 'tabular-nums', textShadow: `-0.012em 0 rgba(255,46,99,0.5), 0.012em 0 rgba(34,211,238,0.5), 0 0 0.16em ${glow}` });

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0A0F', color: '#ECEBF3', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden' }}>
      <header style={{ position: 'relative', zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px 32px', padding: '22px clamp(20px,4vw,56px)', borderBottom: '1px solid rgba(255,255,255,0.06)', ...label, color: '#ECEBF3', letterSpacing: '0.16em' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 9, height: 9, background: '#7C3AED', boxShadow: '0 0 10px rgba(124,58,237,0.9)' }} />
          <div style={{ fontFamily: D, fontWeight: 800, fontSize: 22, letterSpacing: '0.1em', color: '#F1EEFF' }}>FAIR DROP</div>
          <div style={{ color: '#7A7A8C' }}>Judges · Attack replay</div>
        </Link>
        <div style={{ display: 'flex', gap: 22 }}><Link to="/drop" style={{ color: '#8A8A9A' }}>The drop</Link><Link to="/verify" style={{ color: '#8A8A9A' }}>Verify</Link></div>
      </header>

      <main style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 56, padding: '40px clamp(20px,4vw,56px) 64px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={label}>Scenario · 49,812 people · 12 bot operators · 180,000 scripted requests · 500 seats</div>
            <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(44px,5.5vw,84px)', lineHeight: 0.9, textTransform: 'uppercase', color: '#F1EEFF' }}>Same attack. Two systems.</div>
          </div>
          <button onClick={replay} style={{ fontFamily: D, fontWeight: 800, fontSize: 22, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#DDD6FE', border: '1px solid rgba(167,139,250,0.5)', padding: '14px 26px', whiteSpace: 'nowrap' }}>Replay attack</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px 56px' }}>
          {[
            { title: 'Naive FIFO · fastest wins', color: '#FBBF24', line: 'rgba(245,158,11,0.35)', val: pct(fb), cells: fifoCells, ink: '#FFF4DC', glow: 'rgba(245,158,11,0.6)', note: 'First request wins. The bots fire 180,000 requests in the first 40 ms. Most people are still loading the page.', verb: 'sold' },
            { title: 'Fair Drop · sealed lottery', color: '#67E8F9', line: 'rgba(34,211,238,0.4)', val: pct(rb), cells: fairCells, ink: '#F4FEFF', glow: 'rgba(34,211,238,0.55)', note: "Arrival time is ignored and each subnet's weight is capped. The bots win about as often as a few dozen honest people would.", verb: 'drawn' }
          ].map(c => (
            <section key={c.title} style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, borderTop: `1px solid ${c.line}`, paddingTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...label, color: c.color }}><span>{c.title}</span><span style={{ color: '#7A7A8C' }}>{n} / 500 {c.verb}</span></div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                <div style={{ ...big(c.glow), color: c.ink }}>{c.val}</div>
                <div style={{ ...label, lineHeight: 1.7, color: '#8A8A9A' }}>of seats<br />to bots</div>
              </div>
              <SeatGrid cells={c.cells} />
              <div style={{ fontSize: 12, lineHeight: 1.65, color: '#8A8A9A', maxWidth: 520 }}>{c.note}</div>
            </section>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', ...label, fontSize: 10, color: '#8A8A9A', marginTop: -32 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, background: '#F59E0B' }} />Bot-held seat</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, background: '#67E8F9' }} />Person</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: '32px 48px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...label, fontSize: 10 }}>Gini · seats per /24 subnet</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
              <div style={{ fontFamily: D, fontWeight: 900, fontSize: 'clamp(96px,9vw,150px)', lineHeight: 0.85, color: '#F4FEFF', textShadow: '0 0 0.16em rgba(34,211,238,0.45)' }}>{p < 0.01 ? '—' : (0.06 + 0.91 * (1 - p)).toFixed(2)}</div>
              <div style={{ ...label, lineHeight: 1.7, color: '#8A8A9A' }}>FIFO<br /><span style={{ color: '#FBBF24' }}>{(0.97 * p).toFixed(2)}</span></div>
            </div>
            <div style={{ fontSize: 11, color: '#7A7A8C' }}>0 = perfectly even · 1 = one subnet takes everything</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...label, fontSize: 10 }}>Oversell</div>
            <div style={{ fontFamily: D, fontWeight: 900, fontSize: 'clamp(96px,9vw,150px)', lineHeight: 0.85, color: '#F1EEFF' }}>0</div>
            <div style={{ fontSize: 11, color: '#7A7A8C' }}>Pinned at 0 across 2,000 replays · 50k concurrent claims</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...label, fontSize: 10 }}>p99 latency · registration</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><div style={{ fontFamily: D, fontWeight: 800, fontSize: 64, lineHeight: 0.9, color: '#F1EEFF' }}>182</div><div style={{ fontSize: 12, color: '#8A8A9A' }}>ms</div></div>
            <svg viewBox="0 0 480 80" preserveAspectRatio="none" style={{ width: '100%', height: 80, overflow: 'visible' }}>
              <line x1="0" y1="20" x2="480" y2="20" stroke="rgba(245,158,11,0.4)" strokeDasharray="3 5" strokeWidth="1" />
              <polyline points={sc.spark} fill="none" stroke="#C4B5FD" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 4px rgba(124,58,237,0.9))' }} />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...label, fontSize: 10 }}><span>Open</span><span style={{ color: '#FBBF24' }}>SLO 300 ms</span><span>Sealed</span></div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px' }}>
          <section style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ ...label, color: '#ECEBF3' }}>Entries by IP subnet</div>
              <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.12)' }}>
                <button onClick={() => setCap(false)} style={{ ...label, fontSize: 10, letterSpacing: '0.14em', padding: '8px 12px', background: !cap ? 'rgba(245,158,11,0.14)' : 'transparent', color: !cap ? '#FBBF24' : '#8A8A9A' }}>No cap</button>
                <button onClick={() => setCap(true)} style={{ ...label, fontSize: 10, letterSpacing: '0.14em', padding: '8px 12px', background: cap ? 'rgba(34,211,238,0.14)' : 'transparent', color: cap ? '#67E8F9' : '#8A8A9A' }}>Weight cap on</button>
              </div>
            </div>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 11', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div ref={cloudEl} style={{ position: 'absolute', inset: 0 }} />
              <div style={{ position: 'absolute', left: 16, bottom: 14, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, pointerEvents: 'none' }}>
                <span style={{ color: '#FBBF24' }}>45.133.x.x/16 · 4,812 entries</span>
                <span style={{ color: '#8A8A9A' }}>{cap ? 'Capped · counts as weight 32' : 'Uncapped · counts as 4,812 entries'}</span>
              </div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: '#8A8A9A' }}>A Sybil attack shows up as a spike: thousands of entries from one place. With the cap on, the whole spike counts for about as much as a busy apartment block.</div>
          </section>
          <section style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 34 }}>
              <div style={{ ...label, color: '#ECEBF3' }}>The arena · live redemptions</div>
              <div style={{ ...label, color: '#FBBF24', fontVariantNumeric: 'tabular-nums' }}>{claimed} / 500 claimed</div>
            </div>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 11', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div ref={arenaEl} style={{ position: 'absolute', inset: 0 }} />
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: '#8A8A9A' }}>Each tile is one of the 500 seats. A tile lights up when its winner claims it. Holds that expire pass to the next ticket in the published order.</div>
          </section>
        </div>
      </main>
      <Grain opacity={0.07} />
    </div>
  );
}
