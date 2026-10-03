import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBloom } from '../three/hashBloom.js';
import Grain from '../components/Grain.jsx';
import { sha256 } from '../lib/sha256.js';
import { COMMIT, ENTRIES, ROOT, SEED, entryId, prefersReduced } from '../lib/constants.js';

const D = "'Big Shoulders Display', sans-serif";
const label = { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7A8C' };

/** Screen 7 — paste the revealed seed, compare to the commitment, recompute all tickets in-browser. */
export default function Verify() {
  const [seed, setSeedRaw] = useState('');
  const [hash, setHash] = useState('');
  const [run, setRun] = useState({ state: 'idle', hashed: 0, top: [], root: '', ranks: null });
  const [findId, setFindId] = useState('fd0417-31337');
  const bloomEl = useRef(), bloom = useRef(), raf = useRef();
  const isMatch = hash === COMMIT;

  useEffect(() => {
    bloom.current = createBloom(bloomEl.current, COMMIT, { reduced: prefersReduced() });
    return () => { bloom.current.dispose(); cancelAnimationFrame(raf.current); };
  }, []);

  const setSeed = v => {
    v = v.trim();
    const h = v ? sha256(v) : '';
    cancelAnimationFrame(raf.current);
    setSeedRaw(v); setHash(h); setRun({ state: 'idle', hashed: 0, top: [], root: '', ranks: null });
    bloom.current?.setInput(h, h === COMMIT);
  };

  const recompute = () => {
    if (!isMatch || run.state === 'running') return;
    const all = new Array(ENTRIES); let i = 0, top = [];
    setRun({ state: 'running', hashed: 0, top: [], root: '', ranks: null });
    const step = () => {
      const end = Math.min(ENTRIES, i + 650);
      for (; i < end; i++) {
        const id = entryId(i), t = sha256(seed + ':' + id);
        all[i] = [t, id];
        if (top.length < 10 || t < top[top.length - 1][0]) { top.push([t, id]); top.sort((a, b) => (a[0] < b[0] ? -1 : 1)); if (top.length > 10) top.pop(); }
      }
      if (i < ENTRIES) { setRun(r => ({ ...r, hashed: i, top: top.slice() })); raf.current = requestAnimationFrame(step); return; }
      all.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const ranks = {}; all.forEach((x, r) => (ranks[x[1]] = r + 1));
      setRun({ state: 'done', hashed: ENTRIES, top: top.slice(), root: sha256(all.slice(0, 500).map(x => x[1]).join('\n')), ranks });
    };
    raf.current = requestAnimationFrame(step);
  };

  let matchCount = 0;
  const chars = Array.from({ length: 64 }, (_, i) => {
    const ok = hash && hash[i] === COMMIT[i]; if (ok) matchCount++;
    return <span key={i} style={{ color: !hash ? '#3A3A48' : ok ? '#CFFAFE' : '#5A5A6A', textShadow: ok ? '0 0 10px rgba(34,211,238,0.7)' : 'none', transition: 'color 300ms' }}>{hash ? hash[i] : '·'}</span>;
  });
  const rank = run.ranks && run.ranks[findId.trim()];
  const rootOk = run.root === ROOT;

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0A0F', color: '#ECEBF3', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 50% 60% at 74% 40%, rgba(34,211,238,0.08), rgba(10,10,15,0) 70%)' }} />
      <header style={{ position: 'relative', zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px 32px', padding: '22px clamp(20px,4vw,56px)', borderBottom: '1px solid rgba(255,255,255,0.06)', ...label, color: '#ECEBF3', letterSpacing: '0.16em' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 9, height: 9, background: '#22D3EE', boxShadow: '0 0 10px rgba(34,211,238,0.8)' }} />
          <div style={{ fontFamily: D, fontWeight: 800, fontSize: 22, letterSpacing: '0.1em', color: '#F1EEFF' }}>FAIR DROP</div>
          <div style={{ color: '#7A7A8C' }}>Verify · Drop 0417</div>
        </Link>
        <div style={{ display: 'flex', gap: 22 }}><Link to="/drop" style={{ color: '#8A8A9A' }}>← The drop</Link><Link to="/judges" style={{ color: '#8A8A9A' }}>Judges</Link></div>
      </header>

      <main style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexWrap: 'wrap', gap: '24px 48px', padding: '0 clamp(20px,4vw,56px)' }}>
        <section style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 40, padding: 'clamp(32px,6vh,64px) 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ ...label, color: '#67E8F9' }}>Step 1 · does the seed match what was locked in?</div>
            <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(64px,7vw,112px)', lineHeight: 0.88, textTransform: 'uppercase', color: isMatch ? '#ECFEFF' : '#F1EEFF', textShadow: isMatch ? '0 0 30px rgba(34,211,238,0.6)' : 'none', transition: 'color 500ms, text-shadow 500ms' }}>{!hash ? 'Paste the seed.' : isMatch ? 'Match.' : 'No match.'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 20px' }}>
              <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="Paste the 64-character seed" spellCheck="false" aria-label="Seed" style={{ flex: '1 1 380px', minWidth: 0, fontFamily: 'inherit', fontSize: 15, color: '#ECFEFF', background: 'transparent', border: 0, borderBottom: '1px solid rgba(34,211,238,0.4)', padding: '12px 0', outline: 'none' }} />
              <button onClick={() => setSeed(SEED)} style={{ ...label, letterSpacing: '0.14em', border: '1px solid rgba(34,211,238,0.35)', color: '#A5F3FC', padding: '9px 14px' }}>Use published seed</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderLeft: `1px solid ${isMatch ? 'rgba(34,211,238,0.8)' : 'rgba(255,255,255,0.1)'}`, paddingLeft: 22, transition: 'border-color 500ms' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ ...label, fontSize: 10 }}>SHA-256(your input)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 'clamp(12px,1.25vw,17px)', letterSpacing: '0.05em', lineHeight: 1.6 }}>{chars}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ ...label, fontSize: 10 }}>Committed 18:00:00Z · before anyone entered</div>
              <div style={{ fontSize: 'clamp(12px,1.25vw,17px)', letterSpacing: '0.05em', lineHeight: 1.6, color: '#C4B5FD', wordBreak: 'break-all' }}>{COMMIT}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...label, color: '#8A8A9A', letterSpacing: '0.14em' }}>
              <span style={{ padding: '6px 10px', border: `1px solid ${isMatch ? '#22D3EE' : 'rgba(255,255,255,0.15)'}`, color: isMatch ? '#67E8F9' : '#8A8A9A', boxShadow: isMatch ? '0 0 14px rgba(34,211,238,0.5)' : 'none', transition: 'all 500ms' }}>{!hash ? 'Waiting' : isMatch ? 'Locked · identical' : 'Different'}</span>
              <span>{matchCount} / 64 characters agree</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, opacity: isMatch ? 1 : 0.35, transition: 'opacity 500ms' }}>
            <div style={{ ...label, color: '#67E8F9' }}>Step 2 · recompute every ticket from the seed</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '20px 36px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <div style={{ fontFamily: D, fontWeight: 800, fontSize: 'clamp(56px,6vw,88px)', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', color: '#F4FEFF' }}>{run.hashed.toLocaleString('en-US')}</div>
                <div style={{ ...label, lineHeight: 1.7, color: '#8A8A9A' }}>of 49,812<br />tickets hashed</div>
              </div>
              <button onClick={recompute} disabled={!isMatch || run.state === 'running'} style={{ fontFamily: D, fontWeight: 800, fontSize: 22, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#22D3EE', color: '#0A0A0F', padding: '14px 26px', boxShadow: '0 0 22px rgba(34,211,238,0.4)' }}>{run.state === 'running' ? 'Hashing…' : run.state === 'done' ? 'Run again' : 'Recompute draw'}</button>
            </div>
            <div style={{ position: 'relative', height: 2, background: 'rgba(34,211,238,0.12)', maxWidth: 640 }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (run.hashed / ENTRIES * 100).toFixed(1) + '%', background: '#67E8F9', boxShadow: '0 0 10px #22D3EE' }} /></div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: '#8A8A9A', maxWidth: 600 }}>For each entry: SHA-256(seed : entry_id). Sort ascending. The lowest 500 win. This runs in your browser, not on our servers.</div>
            {run.state === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid rgba(34,211,238,0.25)', paddingTop: 18, animation: 'fdIn 520ms cubic-bezier(.2,.8,.2,1) both' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px 28px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ ...label, fontSize: 10 }}>Winners root · your browser</div><div style={{ fontSize: 12, lineHeight: 1.6, color: '#CFFAFE', wordBreak: 'break-all' }}>{run.root}</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ ...label, fontSize: 10 }}>Winners root · published</div><div style={{ fontSize: 12, lineHeight: 1.6, color: '#C4B5FD', wordBreak: 'break-all' }}>{ROOT}</div></div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', ...label, letterSpacing: '0.14em' }}>
                  <span style={{ padding: '6px 10px', border: `1px solid ${rootOk ? '#22D3EE' : '#F59E0B'}`, color: rootOk ? '#67E8F9' : '#FBBF24' }}>{rootOk ? 'Winner list matches' : 'Mismatch'}</span>
                  <span style={{ color: '#8A8A9A' }}>Find an entry</span>
                  <input value={findId} onChange={e => setFindId(e.target.value)} spellCheck="false" aria-label="Entry id" style={{ width: 150, fontFamily: 'inherit', fontSize: 13, color: '#ECFEFF', background: 'transparent', border: 0, borderBottom: '1px solid rgba(34,211,238,0.4)', padding: '6px 0', outline: 'none', textTransform: 'none', letterSpacing: 0 }} />
                  <span style={{ color: '#ECEBF3', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>{rank ? `#${rank.toLocaleString('en-US')} · ${rank <= 500 ? 'selected' : 'not selected'}` : 'not found'}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(24px,4vh,48px) 0' }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', maxHeight: 620 }}>
            <div ref={bloomEl} style={{ position: 'absolute', inset: 0 }} />
            <div style={{ position: 'absolute', top: 0, left: 0, display: 'flex', flexDirection: 'column', gap: 8, ...label, fontSize: 10, letterSpacing: '0.16em' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#C4B5FD' }}><span style={{ width: 14, height: 1, background: '#A78BFA' }} />Commitment</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#A5F3FC' }}><span style={{ width: 14, height: 1, background: '#67E8F9' }} />Your hash</div>
            </div>
            <div style={{ position: 'absolute', bottom: 0, right: 0, maxWidth: 260, textAlign: 'right', fontSize: 11, lineHeight: 1.6, color: '#8A8A9A' }}>Each shape is built from its hash's 32 bytes. Same bytes, same shape. If one character differs, the shapes don't line up.</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...label, fontSize: 10 }}>{run.state === 'idle' ? 'Lowest tickets · run step 2 to fill' : run.state === 'running' ? 'Lowest tickets so far · live' : 'First 10 of 500 winners'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {run.top.map((x, i) => (
                <div key={x[1]} style={{ display: 'grid', gridTemplateColumns: '48px 130px minmax(0,1fr)', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: '#7A7A8C' }}>{String(i + 1).padStart(3, '0')}</span><span>{x[1]}</span><span style={{ color: '#67E8F9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Grain opacity={0.07} />
    </div>
  );
}
