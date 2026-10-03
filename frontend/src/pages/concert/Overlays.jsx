import { CONCERTS } from './data.js';
import Poster, { Pill } from './Poster.jsx';

export function TopNav({ st }) {
  const { S, actions, describe } = st;
  const tabs = [['home', 'Home'], ['saved', 'Saved'], ['tickets', 'My tickets' + (S.tickets.length ? ' · ' + S.tickets.length : '')]];
  const notifs = [
    { id: 'halcyon', title: 'Halcyon Array is on sale now', sub: 'Pier Nine Arena · from $89', color: '#86EFAC' },
    { id: 'mara', title: 'Mara Vell is almost sold out', sub: 'You saved this show', color: '#FCD34D' },
    { id: 'vela', title: 'Vela Moreno goes on sale soon', sub: describe(CONCERTS[1]).pill, color: '#C4B5FD' }
  ];
  return (
    <header className="c-nav">
      <div className="c-nav-in">
        <button className="c-brand" onClick={actions.goHome}><i /><b>FAIR DROP</b></button>
        <nav className="c-tabs only-d">
          {tabs.map(([id, label]) => <button key={id} className={'c-tab' + (S.phase === 'home' && S.tab === id ? ' on' : '')} onClick={() => actions.setTab(id)}>{label}</button>)}
        </nav>
        <div className="c-search only-d">
          <span className="lens" />
          <input value={S.q} onChange={e => actions.setQuery(e.target.value)} onFocus={() => S.phase !== 'home' && S.phase !== 'queue' && actions.goHome()} placeholder="Search artists, venues, cities" />
        </div>
        <div className="c-nav-r">
          <button className="c-iconbtn" onClick={actions.cycleCity}>{S.city} <span style={{ color: 'var(--ink4)' }}>▾</span></button>
          <button className="c-iconbtn" aria-label="Notifications" onClick={actions.toggleNotif}><span className="c-bell" />{S.unread && <span className="c-unread" />}</button>
          <div className="c-avatar only-d">SR</div>
        </div>
      </div>
      {S.notif && (
        <div className="c-notif">
          <div className="c-kicker" style={{ padding: '16px 18px 8px' }}>Notifications</div>
          {notifs.map(n => (
            <button key={n.id} onClick={() => actions.openSheet(n.id)}>
              <span style={{ flexShrink: 0, width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: n.color, boxShadow: `0 0 8px ${n.color}` }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 15 }}>{n.title}</span><span style={{ fontSize: 13, color: 'var(--ink3)' }}>{n.sub}</span></span>
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

export function TabBar({ st }) {
  const { S, actions } = st;
  const tabs = [['home', 'Home'], ['saved', 'Saved'], ['tickets', 'My tickets' + (S.tickets.length ? ' · ' + S.tickets.length : '')]];
  return (
    <nav className="c-tabbar only-m">
      {tabs.map(([id, label]) => <button key={id} className={S.tab === id ? 'on' : ''} onClick={() => actions.setTab(id)}><i />{label}</button>)}
    </nav>
  );
}

/** Desktop: centered modal. Mobile: bottom sheet. */
export function QuickView({ st }) {
  const { S, actions, describe } = st;
  const open = !!S.sheet;
  const d = describe(CONCERTS.find(c => c.id === S.sheet) || CONCERTS.find(c => c.id === QuickView.last) || CONCERTS[0]);
  if (S.sheet) QuickView.last = S.sheet;
  return (
    <>
      <div className="c-scrim" onClick={actions.closeOverlays} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} />
      <div className="c-modal-wrap">
        <div className={'c-modal' + (open ? '' : ' closed')} style={{ pointerEvents: open ? 'auto' : 'none' }} role="dialog" aria-modal="true" aria-hidden={!open}>
          <Poster d={d}>
            <div style={{ marginTop: 'auto', padding: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.8)', paddingBottom: 10 }}>{d.tag}</div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 'clamp(54px,6vw,76px)', lineHeight: .84, textTransform: 'uppercase', color: '#fff' }}>{d.artist}</div>
            </div>
          </Poster>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 26px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Pill d={d} />
              <button onClick={actions.closeOverlays} style={{ fontSize: 14, color: 'var(--ink3)', padding: '6px 0 6px 12px' }}>Close</button>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="kv"><span>When</span><span>{d.dateLong} · {d.show}</span></div>
              <div className="kv"><span>Where</span><span>{d.venue}, {d.city}</span></div>
              <div className="kv"><span>Genre</span><span>{d.genre} · {d.age}</span></div>
              <div className="kv"><span>Prices</span><span>{d.range}</span></div>
              <div className="kv"><span>With</span><span>{d.support}</span></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 0 22px' }}>
              <div style={{ height: 3, background: 'rgba(255,255,255,.1)' }}><div style={{ height: '100%', width: d.soldPct, background: d.pillColor, boxShadow: `0 0 8px ${d.pillColor}` }} /></div>
              <span style={{ fontSize: 13, color: '#9A99A8' }}>{d.soldLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
              <button className="btn btn-ghost" onClick={() => actions.toggleSave(d.id)} style={{ color: d.saved ? '#FB7185' : '#8A8A9A' }}>{d.saved ? '♥ Saved' : '♡ Save'}</button>
              <button className="btn btn-violet" style={{ flex: 1 }} onClick={() => actions.viewEvent(d.id)}>View event &amp; seats</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function HumanCheck({ st }) {
  const { S, now, actions } = st;
  const ck = S.check;
  const gate = ck.mode === 'gate', ok = ck.status === 'ok';
  const map = v => (7 + v * 0.86).toFixed(2) + '%';
  const shake = ck.bad ? 'fdShake 360ms ease' : 'none';
  return (
    <div className="c-check-wrap" style={{ background: gate ? 'rgba(10,10,15,.97)' : 'rgba(5,5,8,.82)' }} role="dialog" aria-modal="true">
      <div className="c-check" style={{ border: `1px solid ${ok ? 'rgba(34,211,238,.6)' : 'rgba(167,139,250,.3)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: ok ? 'var(--cyan-t)' : 'var(--violet-l)' }}>{gate ? 'Before you join the queue' : 'You’re still in the queue'}</span>
          {!gate && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--amber-t)', fontVariantNumeric: 'tabular-nums' }}>{Math.max(0, Math.ceil((ck.deadline - now) / 1000))}s to answer</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'clamp(44px,5vw,56px)', lineHeight: .92, textTransform: 'uppercase' }}>{ok ? 'Verified' : gate ? 'Quick check' : 'Still there?'}</div>
          <div style={{ fontSize: 17, lineHeight: 1.45, color: '#D6D5E0' }}>{ck.type === 'slide' ? 'Slide the light into the gap.' : 'Tap the numbers in order: 1, 2, 3.'}</div>
        </div>
        {ck.type === 'slide' ? (
          <div key={ck.bad} className="c-slide" style={{ animation: shake }}>
            <div className="rail" />
            <div className="gap" style={{ left: map(ck.target) }} />
            <div className="piece" style={{ left: map(ck.val || 0), background: ok ? 'var(--cyan-t)' : 'var(--violet-t)', boxShadow: `0 0 18px ${ok ? 'rgba(34,211,238,.8)' : 'rgba(124,58,237,.7)'}` }} />
            <input type="range" min="0" max="100" step="0.5" value={ck.val || 0} aria-label="Slide the light into the gap"
              onChange={e => actions.slide(parseFloat(e.target.value))} onPointerUp={actions.release} onTouchEnd={actions.release} onKeyUp={actions.release} />
          </div>
        ) : (
          <div key={ck.bad} className="c-tiles" style={{ animation: shake }}>
            {ck.tiles.map((n, i) => {
              const done = n && n < ck.next;
              return <button key={i} onClick={() => actions.tap(i)} style={{ background: done ? 'rgba(34,211,238,.22)' : n ? 'rgba(124,58,237,.16)' : '#0B0B11', border: `1px solid ${done ? '#22D3EE' : n ? 'rgba(167,139,250,.4)' : 'rgba(255,255,255,.07)'}`, color: done ? '#ECFEFF' : '#E4DEFF' }}>{n || ''}</button>;
            })}
          </div>
        )}
        <div style={{ minHeight: 20, fontSize: 15, fontWeight: 500, color: ok ? 'var(--cyan-t)' : '#FCA5A5' }} aria-live="polite">{ck.msg}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ink3)', maxWidth: 300 }}>{gate ? 'This keeps bots out of the line. It takes about three seconds.' : 'Your place is held while you answer.'}</span>
          <button onClick={actions.swapCheck} style={{ fontSize: 14, color: 'var(--violet-l)', whiteSpace: 'nowrap', padding: '8px 0' }}>Try another</button>
        </div>
        {gate && <button onClick={actions.cancelCheck} style={{ alignSelf: 'center', fontSize: 14, color: 'var(--ink3)', padding: '6px 10px' }}>Cancel</button>}
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  return <div className="c-toast" style={{ opacity: msg ? 1 : 0, transform: `translateX(-50%) translateY(${msg ? 0 : 10}px)` }}>{msg}</div>;
}
