import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createDrum } from '../three/drum.js';
import { Flap } from '../components/Flap.jsx';
import Grain from '../components/Grain.jsx';
import { sha256 } from '../lib/sha256.js';
import { COMMIT, SEED, pad2, prefersReduced } from '../lib/constants.js';

/*
 * The proof layer, screens 1–6: pre-open → open (90 s) → sealed → draw → won | lost.
 * URL: ?outcome=won|lost · ?autoplay=0 · ?opensIn=30 (seconds) · ?reduced=1
 */
const PHASE = { pre: 'idle', open: 'filling', sealed: 'sealed', draw: 'draw', won: 'won', lost: 'lost' };
const ACC = {
  violet: { text: '#A78BFA', solid: '#7C3AED', glow: 'rgba(124,58,237,0.6)', bg: 'rgba(124,58,237,0.11)', line: 'rgba(124,58,237,0.35)' },
  cyan: { text: '#67E8F9', solid: '#22D3EE', glow: 'rgba(34,211,238,0.55)', bg: 'rgba(34,211,238,0.09)', line: 'rgba(34,211,238,0.35)' },
  amber: { text: '#FBBF24', solid: '#F59E0B', glow: 'rgba(245,158,11,0.55)', bg: 'rgba(245,158,11,0.10)', line: 'rgba(245,158,11,0.35)' }
};
const D = "'Big Shoulders Display', sans-serif";
const label = { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7A8C' };
const fadeIn = { animation: 'fdIn 540ms cubic-bezier(.2,.8,.2,1) both' };

const Pair = ({ s, tone }) => <div style={{ display: 'flex', gap: '0.05em' }}><Flap v={s[0]} tone={tone} /><Flap v={s[1]} tone={tone} /></div>;
const Colon = ({ c, g }) => (
  <div style={{ height: '1em', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.16em', padding: '0 0.03em' }}>
    <div style={{ width: '0.07em', height: '0.07em', background: c, boxShadow: `0 0 0.12em ${g}` }} />
    <div style={{ width: '0.07em', height: '0.07em', background: c, boxShadow: `0 0 0.12em ${g}` }} />
  </div>
);
const Stat = ({ k, v, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ ...label, fontSize: 10 }}>{k}</div>
    <div style={{ fontFamily: D, fontWeight: 700, fontSize: 30, lineHeight: 1, color: accent || '#ECEBF3', textShadow: accent ? '0 0 14px rgba(124,58,237,0.5)' : 'none' }}>{v}</div>
  </div>
);

export default function FairDrop() {
  const [params] = useSearchParams();
  const outcome = params.get('outcome') === 'lost' ? 'lost' : 'won';
  const autoplay = params.get('autoplay') !== '0';
  const opensIn = Math.max(5, Math.min(3599, parseInt(params.get('opensIn'), 10) || 872));
  const reduced = prefersReduced() || params.get('reduced') === '1';

  const [st, setSt] = useState(() => ({ screen: 'pre', stamp: Date.now(), t0: Date.now(), pow: 'idle', powStart: 0, claimedAt: 0 }));
  const [now, setNow] = useState(Date.now());
  const [entries, setEntries] = useState(0);
  const [copied, setCopied] = useState(false);
  const [notified, setNotified] = useState(false);
  const drumEl = useRef(), drum = useRef(), stRef = useRef(st);
  stRef.current = st;

  const go = useCallback(s => {
    const n = Date.now();
    setSt(p => ({ ...p, screen: s, stamp: n, ...(s === 'pre' ? { t0: n, pow: 'idle' } : {}), ...(s === 'open' ? { pow: 'idle' } : {}), ...(s === 'won' ? { claimedAt: 0 } : {}) }));
    drum.current?.setPhase(PHASE[s]);
  }, []);

  useEffect(() => {
    drum.current = createDrum(drumEl.current, { reduced, onEntries: setEntries, phase: PHASE[stRef.current.screen] });
    return () => drum.current.dispose();
  }, [reduced]);

  useEffect(() => {
    const id = setInterval(() => {
      const n = Date.now(), s = stRef.current, el = (n - s.stamp) / 1000;
      setNow(n);
      if (autoplay) {
        if (s.screen === 'pre' && opensIn - Math.floor((n - s.t0) / 1000) <= 0) return go('open');
        if (s.screen === 'open' && el >= 90) return go('sealed');
        if (s.screen === 'sealed' && el >= 4) return go('draw');
        if (s.screen === 'draw' && el >= 7) return go(outcome);
      }
      if (s.pow === 'solving' && n - s.powStart > 1070) setSt(p => ({ ...p, pow: 'done' }));
    }, 100);
    return () => clearInterval(id);
  }, [autoplay, opensIn, outcome, go]);

  const { screen, stamp, pow, powStart, claimedAt } = st;
  const el = (now - stamp) / 1000;
  const acc = screen === 'draw' ? ACC.cyan : screen === 'won' ? ACC.amber : ACC.violet;
  const rem = Math.max(0, opensIn - Math.floor((now - st.t0) / 1000));
  const openLeft = Math.max(0, Math.ceil(90 - el));
  const wonLeft = Math.max(0, Math.ceil(120 - (claimedAt ? (claimedAt - stamp) / 1000 : el)));
  const userId = outcome === 'won' ? 'fd0417-26525' : 'fd0417-31337';
  const ticket = useMemo(() => sha256(SEED + ':' + userId), [userId]);
  const shown = screen === 'draw' ? Math.min(64, Math.floor(el / 1.3 * 64)) : 64;
  const powEl = Math.min(1.07, (now - powStart) / 1000);

  const order = ['pre', 'open', 'sealed', 'draw', 'result'];
  const ci = order.indexOf(screen === 'won' || screen === 'lost' ? 'result' : screen);
  const railLabels = { pre: 'Pre-open', open: 'Open · 90 s', sealed: 'Sealed', draw: 'Draw', result: 'Result' };
  const readout = {
    pre: ['Entries in the drum', entries.toLocaleString('en-US')], open: ['Entries in the drum', entries.toLocaleString('en-US')],
    sealed: ['Sealed · entries', '49,812'], draw: [el > 1.8 ? 'Selected' : 'Drawing', el > 1.8 ? '500' : '—'], won: ['Selected', '500'], lost: ['Selected', '500']
  }[screen];
  const caption = {
    pre: 'Every point is one entry. When the window seals, 500 of them ignite.',
    open: 'Each new point is a person entering. Watch it fill.',
    sealed: 'Frozen. The set of entries is now fixed and public.',
    draw: 'The seed decides. 500 points light up; nobody picks them.',
    won: 'One of those white points is you.',
    lost: 'Your point stayed in the drum. Same rules, same odds as everyone.'
  }[screen];
  const copyHash = () => { navigator.clipboard?.writeText(COMMIT).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0A0F', color: '#ECEBF3', fontFamily: "'JetBrains Mono', ui-monospace, monospace", overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse 55% 65% at 74% 46%, ${acc.bg}, rgba(10,10,15,0) 70%)`, transition: 'background 600ms' }} />

      <header style={{ position: 'relative', zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px 32px', padding: '22px clamp(20px,4vw,56px)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 9, height: 9, background: acc.solid, boxShadow: `0 0 10px ${acc.glow}`, transition: 'background 500ms' }} />
          <div style={{ fontFamily: D, fontWeight: 800, fontSize: 22, letterSpacing: '0.1em', color: '#F1EEFF' }}>FAIR DROP</div>
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
          {order.map((k, i) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => go(k === 'result' ? outcome : k)} style={{ display: 'flex', alignItems: 'center', gap: 8, letterSpacing: 'inherit', textTransform: 'inherit', fontSize: 11, padding: '6px 0', color: i === ci ? acc.text : i < ci ? '#8A8A9A' : '#6E6E80', textShadow: i === ci ? `0 0 10px ${acc.glow}` : 'none', transition: 'color 400ms' }}>
                <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: i === ci ? 1 : 0 }} />{railLabels[k]}
              </button>
              {i < order.length - 1 && <div style={{ width: 18, height: 1, background: 'rgba(255,255,255,0.12)' }} />}
            </div>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', color: '#8A8A9A' }}>
          <Link to="/verify" style={{ color: '#8A8A9A' }}>Verify</Link>
          <Link to="/judges" style={{ color: '#8A8A9A' }}>Judges</Link>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>UTC {new Date(now).toISOString().slice(11, 19)}</span>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '24px 40px', padding: '0 clamp(20px,4vw,56px)' }}>
        <section style={{ flex: '1 1 560px', minWidth: 0, padding: 'clamp(32px,6vh,72px) 0' }}>
          {screen === 'pre' && (
            <div key="pre" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(28px,5vh,52px)', ...fadeIn }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={label}>Drop 0417 · On sale tonight</div>
                <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(36px,4vw,56px)', lineHeight: 0.95, textTransform: 'uppercase', color: '#F1EEFF' }}>Halcyon Array</div>
                <div style={{ fontSize: 13, color: '#8A8A9A' }}>Pier Nine Arena · Sat 14 Nov 2026 · General admission</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ ...label, color: '#A78BFA' }}>Registration opens in</div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.08em', fontFamily: D, fontWeight: 800, fontSize: 'clamp(104px,15vw,240px)', lineHeight: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Pair s={pad2(Math.floor(rem / 60))} /><div style={{ ...label, fontSize: 11, fontFamily: 'inherit' }}>MIN</div></div>
                  <Colon c="#A78BFA" g="#7C3AED" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Pair s={pad2(rem % 60)} /><div style={{ ...label, fontSize: 11 }}>SEC</div></div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '20px 28px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, maxWidth: 640 }}>
                <Stat k="WINDOW" v="90 sec" /><Stat k="SEATS" v="500" /><Stat k="EXPECTED" v="~50,000" /><Stat k="ARRIVAL ORDER" v="Irrelevant" accent="#A78BFA" />
              </div>
            </div>
          )}

          {screen === 'open' && (
            <div key="open" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(24px,4.5vh,44px)', ...fadeIn }}>
              <div style={{ ...label, color: '#A78BFA', display: 'flex', alignItems: 'center', gap: 10 }}><span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA' }} />Registration open · window closes in</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, fontFamily: D, fontWeight: 800, fontSize: 'clamp(120px,16vw,250px)', lineHeight: 1 }}>
                <Pair s={pad2(openLeft)} />
                <div style={{ ...label, lineHeight: 1.8, paddingBottom: '0.1em', fontFamily: 'inherit' }}>SECONDS<br />OF 90</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
                <div style={{ position: 'relative', height: 3, background: 'rgba(167,139,250,0.12)' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (Math.max(0, 90 - el) / 90 * 100).toFixed(2) + '%', background: '#A78BFA', boxShadow: '0 0 12px #7C3AED' }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', ...label, fontSize: 10 }}><span>Closed</span><span>Opened 20:00:00Z</span></div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 48px', maxWidth: 680 }}>
                <div style={{ flex: '0 1 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ ...label, fontSize: 10 }}>Entries so far</div>
                  <div style={{ fontFamily: D, fontWeight: 800, fontSize: 64, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>{entries.toLocaleString('en-US')}</div>
                  <div style={{ fontSize: 11, lineHeight: 1.6, color: '#8A8A9A' }}>Entering at second 1 or second 89 changes nothing.</div>
                </div>
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14, borderLeft: '1px solid rgba(167,139,250,0.25)', paddingLeft: 24 }}>
                  <div style={{ ...label, fontSize: 10, color: '#A78BFA' }}>Your entry</div>
                  {pow === 'idle' && (<>
                    <button onClick={() => setSt(p => ({ ...p, pow: 'solving', powStart: Date.now() }))} style={{ alignSelf: 'flex-start', fontFamily: D, fontWeight: 800, fontSize: 24, letterSpacing: '0.06em', textTransform: 'uppercase', background: '#A78BFA', color: '#0A0A0F', padding: '16px 28px', boxShadow: '0 0 24px rgba(124,58,237,0.5)' }}>Enter the drum</button>
                    <div style={{ fontSize: 12, lineHeight: 1.65, color: '#8A8A9A' }}>Your device does about one second of work first, so that 50,000 fake entries would cost real money.</div>
                  </>)}
                  {pow === 'solving' && (<div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...fadeIn }}>
                    <div style={{ fontFamily: D, fontWeight: 700, fontSize: 26, textTransform: 'uppercase' }}>Solving proof-of-work</div>
                    <div style={{ position: 'relative', height: 2, background: 'rgba(255,255,255,0.08)' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.min(96, powEl / 1.07 * 92) + '%', background: '#ECEBF3' }} /></div>
                    <div style={{ fontSize: 11, color: '#C4B5FD', fontVariantNumeric: 'tabular-nums' }}>{Math.floor(powEl * 958000).toLocaleString('en-US')} hashes · ~1,048,576 expected · {powEl.toFixed(2)} s</div>
                    <div style={{ fontSize: 11, lineHeight: 1.6, color: '#7A7A8C' }}>The bar is an estimate. The answer can land a little early or a little late. That's how the puzzle works.</div>
                  </div>)}
                  {pow === 'done' && (<div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...fadeIn }}>
                    <div style={{ fontFamily: D, fontWeight: 800, fontSize: 34, lineHeight: 1, textTransform: 'uppercase', color: '#F1EEFF' }}>You're in the drum.</div>
                    <div style={{ fontSize: 15, color: '#DDD6FE' }}>{userId}</div>
                    <div style={{ fontSize: 11, color: '#7A7A8C' }}>nonce 0x3f1a9c · 20-bit difficulty · solved in 1.07 s</div>
                    <div style={{ fontSize: 12, lineHeight: 1.6, color: '#8A8A9A' }}>Nothing else to do. Close the tab if you like — the draw doesn't need you here.</div>
                  </div>)}
                </div>
              </div>
            </div>
          )}

          {screen === 'sealed' && (
            <div key="sealed" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(24px,4.5vh,44px)', ...fadeIn }}>
              <div style={{ ...label, color: '#A78BFA' }}>Window closed · 20:01:30Z</div>
              <div style={{ fontFamily: D, fontWeight: 900, fontSize: 'clamp(110px,14vw,230px)', lineHeight: 0.82, textTransform: 'uppercase', color: '#F4F1FF', textShadow: '0 0 30px rgba(124,58,237,0.45)' }}>Sealed</div>
              <div style={{ fontFamily: D, fontWeight: 700, fontSize: 'clamp(28px,3vw,42px)', lineHeight: 1.08, textTransform: 'uppercase', maxWidth: 560 }}>Nobody can enter now.<br />Nobody can change the seed.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '20px 28px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, maxWidth: 640 }}>
                <Stat k="FINAL ENTRIES" v="49,812" /><Stat k="YOUR ENTRY" v={<span style={{ fontFamily: 'inherit', fontSize: 14, color: '#DDD6FE' }}>{userId}</span>} /><Stat k="SEED REVEAL IN" v={Math.max(0, Math.ceil(4 - el)) + ' s'} />
              </div>
            </div>
          )}

          {screen === 'draw' && (
            <div key="draw" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(28px,5vh,56px)', ...fadeIn }}>
              <div style={{ ...label, color: '#67E8F9' }}>Drawing · seed revealed</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,auto)', justifyContent: 'start', gap: '8px 0.8em', fontSize: 'clamp(15px,1.9vw,28px)', letterSpacing: '0.06em' }}>
                {Array.from({ length: 8 }, (_, g) => { const n = Math.max(0, Math.min(8, shown - g * 8)); return <span key={g}><span style={{ color: '#CFFAFE', textShadow: '0 0 14px rgba(34,211,238,0.8)' }}>{SEED.slice(g * 8, g * 8 + n)}</span><span style={{ color: '#2A3A44' }}>{'·'.repeat(8 - n)}</span></span>; })}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.9, color: '#8A8A9A' }}>ticket = SHA-256(seed : entry_id)<br />sort all 49,812 tickets ascending<br />the lowest 500 win</div>
              <div style={{ minHeight: 80 }}>{el > 1.8 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, ...fadeIn }}>
                  <div style={{ fontFamily: D, fontWeight: 900, fontSize: 'clamp(72px,8vw,120px)', lineHeight: 0.9, color: '#F4FEFF', textShadow: '-0.014em 0 rgba(255,46,99,0.55), 0.014em 0 rgba(34,211,238,0.65), 0 0 0.2em rgba(34,211,238,0.6)' }}>500</div>
                  <div style={{ ...label, color: '#A5F3FC', lineHeight: 1.7 }}>Ignited<br />of 49,812</div>
                </div>)}</div>
            </div>
          )}

          {screen === 'won' && (
            <div key="won" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(24px,4.5vh,44px)', ...fadeIn }}>
              <div style={{ ...label, color: '#FBBF24' }}>Selected · rank 212 of 500</div>
              {!claimedAt && wonLeft > 0 && (<>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.08em', fontFamily: D, fontWeight: 800, fontSize: 'clamp(110px,15vw,240px)', lineHeight: 1 }}>
                    <Flap v={String(Math.floor(wonLeft / 60))} tone="amber" /><Colon c="#FBBF24" g="#F59E0B" /><Pair s={pad2(wonLeft % 60)} tone="amber" />
                  </div>
                  <div style={{ ...label, color: '#8A8A9A' }}>Your seat is held · two minutes is plenty</div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px 32px' }}>
                  <button onClick={() => setSt(p => ({ ...p, claimedAt: Date.now() }))} style={{ fontFamily: D, fontWeight: 800, fontSize: 30, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F59E0B', color: '#0A0A0F', padding: '20px 40px', boxShadow: '0 0 32px rgba(245,158,11,0.45)' }}>Claim seat · $85</button>
                  <div style={{ fontSize: 11, lineHeight: 1.7, color: '#8A8A9A' }}>Card on file ending 4417<br />One seat per verified entry</div>
                </div>
              </>)}
              {!!claimedAt && <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn }}>
                <div style={{ fontFamily: D, fontWeight: 900, fontSize: 'clamp(96px,12vw,200px)', lineHeight: 0.85, textTransform: 'uppercase', color: '#FFF7E6', textShadow: '0 0 30px rgba(245,158,11,0.5)' }}>Yours.</div>
                <div style={{ fontSize: 14, lineHeight: 1.7 }}>Seat claimed. Tile 212, floor. Ticket sent to your wallet.</div>
              </div>}
              {!claimedAt && wonLeft === 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn }}>
                <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(64px,8vw,120px)', lineHeight: 0.9, textTransform: 'uppercase' }}>Hold released</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: '#8A8A9A', maxWidth: 520 }}>The seat passed to the next ticket in sorted order, as published. Nobody chose who.</div>
              </div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(245,158,11,0.25)', paddingTop: 18, maxWidth: 640 }}>
                <div style={{ ...label, fontSize: 10 }}>Your ticket · {userId}</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: '#FDE68A', wordBreak: 'break-all' }}>{ticket}</div>
              </div>
            </div>
          )}

          {screen === 'lost' && (
            <div key="lost" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(26px,4.5vh,44px)', ...fadeIn }}>
              <div style={{ ...label, color: '#A78BFA' }}>Drop 0417 · Draw complete</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(64px,7.5vw,116px)', lineHeight: 0.88, textTransform: 'uppercase', color: '#F1EEFF' }}>Not this time.</div>
                <div style={{ fontSize: 15, lineHeight: 1.7, color: '#C9C8D4', maxWidth: 540 }}>Your ticket came in at position 36,617 of 49,812. The lowest 500 won seats. Every entry went through the same seed and the same math, bots included. Nobody had better odds than you.</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
                <div style={{ ...label, fontSize: 10 }}>Where your ticket fell · all 49,812, sorted</div>
                <div style={{ position: 'relative', marginTop: 30, height: 44, background: 'repeating-linear-gradient(90deg, rgba(167,139,250,0.16) 0 1px, transparent 1px 4px)', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '1.004%', minWidth: 3, background: '#F4F1FF', boxShadow: '0 0 14px rgba(237,233,254,0.9)' }} />
                  <div style={{ position: 'absolute', left: 0, top: -26, ...label, fontSize: 10, color: '#F1EEFF', whiteSpace: 'nowrap' }}>500 seats</div>
                  <div style={{ position: 'absolute', left: '73.51%', top: -12, bottom: -12, width: 2, background: '#C4B5FD', boxShadow: '0 0 12px #7C3AED' }} />
                  <div style={{ position: 'absolute', left: '73.51%', top: -28, transform: 'translateX(-50%)', ...label, fontSize: 10, color: '#C4B5FD', whiteSpace: 'nowrap' }}>You · #36,617</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6E6E80' }}><span>1</span><span>10k</span><span>20k</span><span>30k</span><span>40k</span><span>49,812</span></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '20px 32px', maxWidth: 680 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ ...label, fontSize: 10 }}>Your ticket · {userId}</div><div style={{ fontSize: 12, lineHeight: 1.6, color: '#8A8A9A', wordBreak: 'break-all' }}><span style={{ color: '#DDD6FE' }}>{ticket.slice(0, 4)}</span>{ticket.slice(4)}</div></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ ...label, fontSize: 10 }}>Cutoff · ticket #500</div><div style={{ fontSize: 12, lineHeight: 1.6, color: '#8A8A9A', wordBreak: 'break-all' }}><span style={{ color: '#F1EEFF' }}>026f</span>213b5ebcde9d75637c… <Link to="/verify">recompute</Link></div></div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px' }}>
                <Link to="/verify" style={{ fontFamily: D, fontWeight: 700, fontSize: 22, letterSpacing: '0.05em', textTransform: 'uppercase', border: '1px solid rgba(167,139,250,0.5)', padding: '14px 24px', color: '#DDD6FE' }}>Check the draw yourself</Link>
                <button onClick={() => setNotified(true)} style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8A8A9A', padding: '8px 0' }}>{notified ? 'We’ll tell you about the next drop' : 'Notify me for the next drop'}</button>
              </div>
            </div>
          )}
        </section>

        <section style={{ flex: '1 1 420px', minWidth: 0, position: 'relative', aspectRatio: '1 / 1', maxHeight: 860 }}>
          <div ref={drumEl} style={{ position: 'absolute', inset: '-12%', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: '6%', right: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ ...label, fontSize: 10 }}>{readout[0]}</div>
            <div style={{ fontFamily: D, fontWeight: 700, fontSize: 44, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{readout[1]}</div>
          </div>
          <div style={{ position: 'absolute', bottom: '6%', left: 0, maxWidth: 280, fontSize: 11, lineHeight: 1.6, color: '#8A8A9A' }}>{caption}</div>
        </section>
      </main>

      {(screen === 'pre' || screen === 'open' || screen === 'sealed') ? (
        <footer style={{ position: 'relative', zIndex: 2, margin: '0 clamp(20px,4vw,56px)', padding: '28px 0 32px', borderTop: '1px solid rgba(124,58,237,0.35)', display: 'flex', flexWrap: 'wrap', gap: '24px 56px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...label, fontSize: 10, color: '#A78BFA' }}>Commitment · SHA-256(seed)</div>
            <div style={{ fontFamily: D, fontWeight: 700, fontSize: 28, lineHeight: 1.05, textTransform: 'uppercase', color: '#F1EEFF' }}>We locked this in before anyone entered.</div>
            <div style={{ fontSize: 12, lineHeight: 1.65, color: '#8A8A9A' }}>The seed that decides the draw is already chosen. This is its fingerprint. After the window seals we reveal the seed. Hash it yourself and it matches, character for character.</div>
          </div>
          <div style={{ flex: '1 1 480px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,auto)', gap: '6px 0.9em', fontSize: 'clamp(12px,1.4vw,21px)', letterSpacing: '0.06em', color: '#DDD6FE', textShadow: '0 0 12px rgba(124,58,237,0.65)' }}>
              {COMMIT.match(/.{8}/g).map((g, i) => <span key={i}>{g}</span>)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 22px', ...label, letterSpacing: '0.12em' }}>
              <span>Committed 18:00:00Z · before open</span>
              <button onClick={copyHash} style={{ fontSize: 11, letterSpacing: 'inherit', textTransform: 'inherit', border: '1px solid rgba(167,139,250,0.35)', color: '#C4B5FD', padding: '7px 12px' }}>{copied ? 'Copied' : 'Copy hash'}</button>
              <Link to="/verify">How to verify →</Link>
            </div>
          </div>
        </footer>
      ) : (screen !== 'draw' || el > 1.6) && (
        <footer style={{ position: 'relative', zIndex: 2, margin: '0 clamp(20px,4vw,56px)', padding: '24px 0 30px', borderTop: `1px solid ${acc.line}`, display: 'flex', flexWrap: 'wrap', gap: '16px 40px', alignItems: 'center', justifyContent: 'space-between', ...fadeIn }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', fontSize: 12 }}>
            <span style={{ ...label, fontSize: 10 }}>SHA-256(seed)</span><span>0656a5fc…5ec65129</span>
            <span style={{ ...label, fontSize: 10 }}>= committed 18:00Z</span><span>0656a5fc…5ec65129</span>
            <span style={{ ...label, fontSize: 10, padding: '6px 10px', border: `1px solid ${acc.solid}`, color: acc.text, boxShadow: `0 0 12px ${acc.glow}` }}>Match</span>
          </div>
          <Link to="/verify" style={{ ...label, color: acc.text }}>Recompute every ticket →</Link>
        </footer>
      )}
      <Grain vignette opacity={0.07} />
    </div>
  );
}
