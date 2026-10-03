import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlapString } from '../components/Flap.jsx';
import Grain from '../components/Grain.jsx';
import { COMMIT } from '../lib/constants.js';

/*
 * Consumer "You weren't drawn" screen (7B). Plain-language surface;
 * the mechanism (hashes, weights) lives only in the "How is this fair?" drawer.
 */
const KEY = 'fairdrop-fan-v1';
const D = "'Big Shoulders Display', sans-serif";

export default function FanResults() {
  const [wait, setWait] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}').wait || 1347; } catch { return 1347; } });
  const [moves, setMoves] = useState([]);
  const [fair, setFair] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setWait(w => { const n = Math.max(1, w - 1 - Math.floor(Math.random() * 2)); try { localStorage.setItem(KEY, JSON.stringify({ wait: n })); } catch { /* ignore */ } return n; });
      setMoves(m => [...m, Date.now()].filter(t => Date.now() - t < 600000));
    }, 6500);
    return () => clearInterval(id);
  }, []);

  const recent = moves.length;
  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0A0F', color: '#ECEBF3', fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 var(--pad) 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 0 0' }}>
          <Link to="/" className="link-back">← Concerts</Link>
          <span style={{ fontSize: 13, color: '#8A8A9A' }}>Results are in</span>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '24px 64px', alignItems: 'start', paddingTop: 'clamp(32px,6vw,64px)' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ position: 'absolute', inset: '-40px -40px auto', height: 520, pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 50% at 50% 50%, rgba(124,58,237,0.10), rgba(10,10,15,0) 70%)' }} />
            <div style={{ position: 'relative', fontFamily: D, fontWeight: 900, fontSize: 'clamp(76px,9vw,120px)', lineHeight: 0.86, textTransform: 'uppercase', color: '#F4F2FB' }}>Halcyon Array</div>
            <div style={{ position: 'relative', fontSize: 15, color: '#8A8A9A' }}>Pier Nine Arena, Oakland · Sat 14 Nov</div>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 48 }}>
              <div style={{ fontSize: 19, lineHeight: 1.45, color: '#D6D5E0' }}>You weren't drawn this time. Here's exactly where you landed.</div>
              <div>
                <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(72px,8vw,104px)', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', color: '#F5F2FF', textShadow: '-0.012em 0 rgba(255,46,99,0.5), 0.012em 0 rgba(34,211,238,0.5), 0 0 0.22em rgba(124,58,237,0.7)' }}>#1,847</div>
                <div style={{ fontSize: 16, color: '#B9B8C6', paddingTop: 6 }}>of 50,214 people in the draw</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 }}>
                <div style={{ position: 'relative', height: 30 }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 13, height: 4, background: 'repeating-linear-gradient(90deg, rgba(167,139,250,0.22) 0 1px, transparent 1px 4px)' }} />
                  <div style={{ position: 'absolute', left: 0, top: 9, width: 4, height: 12, background: '#F4F1FF', boxShadow: '0 0 10px rgba(237,233,254,0.9)' }} />
                  <div style={{ position: 'absolute', left: '3.68%', top: 2, width: 2, height: 26, background: '#C4B5FD', boxShadow: '0 0 10px #7C3AED' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#8A8A9A' }}><span><span style={{ color: '#F1EEFF' }}>500 tickets</span> · then you, close behind</span><span>Everyone</span></div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 22px 24px', background: '#101017', border: '1px solid rgba(167,139,250,0.22)', borderRadius: 3 }}>
              <div style={{ fontSize: 16, lineHeight: 1.5, color: '#B9B8C6' }}>If someone doesn't complete their purchase in time, we work down the list.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 15, color: '#D6D5E0' }}>You're</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', fontFamily: D, fontWeight: 800, fontSize: 'clamp(68px,7vw,96px)', lineHeight: 1 }}>
                  <span style={{ fontSize: '0.7em', color: '#A78BFA', padding: '0 0.06em 0.1em 0' }}>#</span>
                  <FlapString value={wait.toLocaleString('en-US')} tone="violet" />
                </div>
                <div style={{ fontSize: 15, color: '#D6D5E0' }}>on the waitlist</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#86EFAC' }}>
                <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#86EFAC' }} />
                {recent ? `The list is moving · ${recent} ${recent === 1 ? 'ticket' : 'tickets'} reopened recently` : 'The list is moving'}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: '#8A8A9A', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>If the list reaches you, we'll notify you straight away and hold a ticket for 2 minutes. Keep notifications on.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Link to="/verify" className="btn btn-ghost" style={{ minHeight: 52, fontWeight: 600, fontSize: 16, color: '#E4DEFF', borderColor: 'rgba(167,139,250,0.45)' }}>Check the draw yourself</Link>
              <button onClick={() => setFair(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 15, color: '#B9B8C6' }}><span>How is this fair?</span><span style={{ color: '#7A7A8C' }}>+</span></button>
            </div>
          </div>
        </div>
      </div>

      <div onClick={() => setFair(false)} className="c-scrim" style={{ opacity: fair ? 1 : 0, pointerEvents: fair ? 'auto' : 'none' }} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        <div role="dialog" aria-modal="true" aria-hidden={!fair} style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', pointerEvents: fair ? 'auto' : 'none', background: '#0E0E15', borderTop: '1px solid rgba(34,211,238,0.3)', borderRadius: '10px 10px 0 0', padding: '16px 24px 34px', transform: fair ? 'translateY(0)' : 'translateY(105%)', transition: 'transform 520ms cubic-bezier(.2,.8,.2,1)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={() => setFair(false)} style={{ fontSize: 15, color: '#B9B8C6', padding: '8px 0 8px 16px' }}>Close</button></div>
          <div style={{ fontFamily: D, fontWeight: 800, fontSize: 40, lineHeight: 0.95, textTransform: 'uppercase' }}>How is this fair?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '26px 0 30px' }}>
            {[
              ['Arriving early doesn’t help.', 'Everyone in the 90-second window goes into the same draw with the same chance. There’s no queue to be at the front of.'],
              ['One network can’t flood the draw.', 'Thousands of entries from one place count for about as much as a busy building. Your phone also does a quick check, so fake entries cost real money.'],
              ['Anyone can check the result afterwards.', 'We sealed the draw before anyone registered. Nobody can change it, including us. You can re-run it yourself and get the same 500 names.']
            ].map(([h, b]) => <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ fontSize: 17, fontWeight: 600 }}>{h}</div><div style={{ fontSize: 15, lineHeight: 1.5, color: '#9A99A8' }}>{b}</div></div>)}
          </div>
          <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid rgba(34,211,238,0.22)', paddingTop: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', color: '#67E8F9' }}>THE MECHANISM</div>
            <div style={{ fontSize: 12, lineHeight: 1.75, color: '#9A99A8' }}>ticket = SHA-256(seed : entry_id)<br />sort all tickets ascending · lowest 500 win<br />entry weight capped per /24 subnet · yours: 1.00<br />~1 s proof-of-work per entry (20-bit)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.16em', color: '#7A7A8C' }}>SEALED DRAW CODE</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: '#DDD6FE', wordBreak: 'break-all' }}>{COMMIT}</div>
              <div style={{ fontSize: 12, color: '#9A99A8' }}>We published this before anyone registered.</div>
            </div>
            <Link to="/verify" style={{ fontSize: 12, color: '#67E8F9' }}>Open the verifier →</Link>
          </div>
        </div>
      </div>
      <Grain />
    </div>
  );
}
