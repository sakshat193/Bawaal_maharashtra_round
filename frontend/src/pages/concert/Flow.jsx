import VenueCanvas from './VenueCanvas.jsx';
import { Pill } from './Poster.jsx';
import { CAPACITY } from './data.js';
import { FlapString } from '../../components/Flap.jsx';
import { TicketCard } from './Home.jsx';

export function BuyBar({ buy, stickyMobile = true }) {
  if (!buy) return null;
  const tone = { violet: 'btn-violet', amber: 'btn-amber', muted: 'btn-muted' }[buy.tone];
  const line = buy.tone === 'amber' ? 'rgba(245,158,11,.3)' : 'rgba(167,139,250,.25)';
  return (
    <div className={'c-buy' + (stickyMobile ? ' sticky-m' : '')} style={{ borderColor: line }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{buy.label}</span>
        <span className="val">{buy.value}</span>
      </div>
      <button className={'btn ' + tone} disabled={buy.disabled} onClick={buy.onClick}>{buy.cta}</button>
    </div>
  );
}

function TierList({ st, compact }) {
  const { tiers, actions } = st;
  return tiers.map(t => (
    <button key={t.id} className="c-tier" onClick={() => actions.pickTier(t.id)} style={t.on ? { background: 'rgba(124,58,237,.12)', borderColor: t.color } : null}>
      <span className="sw" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 7, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t.name}</span>
        {compact ? <span style={{ fontSize: 13, color: '#9A99A8' }}>{t.leftFmt}</span> : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: '0 0 100px', height: 3, background: 'rgba(255,255,255,.1)' }}><span style={{ display: 'block', height: '100%', width: t.leftPct, background: t.color }} /></span>
            <span style={{ fontSize: 13, color: '#9A99A8' }}>{t.leftFmt}</span>
          </span>
        )}
      </span>
      <span className="price">{t.priceFmt}</span>
    </button>
  ));
}

export function Event({ st }) {
  const { S, con: ev, tiers, sel, sold, actions, buy } = st;
  return (
    <div className="fade-in" data-screen="event" style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0 16px' }}>
        <button className="link-back" onClick={actions.goHome}>← All concerts</button>
        <button className="c-iconbtn" onClick={() => actions.toggleSave(ev.id)} style={{ color: ev.saved ? '#FB7185' : '#8A8A9A' }}>{ev.saved ? '♥ Saved' : '♡ Save'}</button>
      </div>
      <div className="c-split">
        <div className="c-sticky">
          <VenueCanvas mode="event" tier={S.tier} sold={sold} onPick={actions.pickTier} controls>
            <div style={{ position: 'absolute', top: 18, left: 20, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{ev.venue}</span>
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Drag to rotate · scroll or pinch to zoom · tap a section</span>
            </div>
            <div className="only-d" style={{ position: 'absolute', top: 18, right: 20, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
              {tiers.map(t => <span key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, fontSize: 12, color: 'var(--ink2)' }}>{t.name}<span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, boxShadow: `0 0 8px ${t.color}` }} /></span>)}
            </div>
            {S.tier && (
              <div key={S.tier} style={{ position: 'absolute', left: 20, bottom: 18, display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', background: 'rgba(14,13,22,.92)', border: `1px solid ${sel.color}`, borderRadius: 3, pointerEvents: 'none', animation: 'fdPop 360ms var(--ease) both' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: sel.color }}>{sel.name}</span>
                <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 40, lineHeight: 1 }}>{sel.priceFmt}</span>
                <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{sel.leftFmt}</span>
              </div>
            )}
          </VenueCanvas>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Pill d={ev} />
          <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 'clamp(60px,7vw,96px)', lineHeight: .84, textTransform: 'uppercase', paddingTop: 16 }}>{ev.artist}</div>
          <div style={{ fontSize: 17, lineHeight: 1.5, color: 'var(--ink2)', paddingTop: 14 }}>{ev.tag}<br />{ev.dateLong} · {ev.venue}, {ev.city}</div>
          <div style={{ marginTop: 28 }}><BuyBar buy={buy} /></div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '36px 0 12px' }}>
            <h2 className="c-h2" style={{ fontSize: 30 }}>Choose a section</h2>
            <span style={{ fontSize: 13, color: 'var(--ink3)' }}>{CAPACITY.toLocaleString('en-US')} capacity</span>
          </div>
          <TierList st={st} />

          <div className="c-facts" style={{ marginTop: 28 }}>
            {[['Doors', ev.doors], ['Show', ev.show], ['Age', ev.age], ['Limit', '4 per person'], ['Tickets', 'Mobile only'], ['Resale', 'Face value only']].map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}
          </div>

          <h2 className="c-h2" style={{ fontSize: 30, padding: '36px 0 6px' }}>Line-up</h2>
          {ev.lineup.map(([n, t]) => <div key={n} className="kv" style={{ fontSize: 16 }}><span style={{ color: 'var(--ink)' }}>{n}</span><span style={{ color: 'var(--ink3)' }}>{t}</span></div>)}

          <button onClick={actions.toggleHow} style={{ width: '100%', minHeight: 56, marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', fontSize: 16, color: '#D6D5E0' }}>
            <span>How buying works</span><span style={{ color: 'var(--ink4)' }}>{S.how ? '−' : '+'}</span>
          </button>
          {S.how && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 0 4px', fontSize: 16, lineHeight: 1.5, color: 'var(--ink2)' }}>
              <div><b style={{ color: 'var(--ink)' }}>1. A quick check.</b> Proves you're a person before you join.</div>
              <div><b style={{ color: 'var(--ink)' }}>2. The queue.</b> Watch the venue fill while you wait. We may check in once or twice.</div>
              <div><b style={{ color: 'var(--ink)' }}>3. Your turn.</b> We hold seats for you for 10 minutes while you pay.</div>
            </div>
          )}
          <div className="only-m" style={{ height: 110 }} />
        </div>
      </div>
    </div>
  );
}

export function Queue({ st }) {
  const { S, con: ev, sold, prog, actions, now, tiers, queueSpeed } = st;
  const q = S.queue || { ahead: 0, total: 1, behind: 0 };
  const ahead = Math.ceil(q.ahead), secs = Math.ceil(ahead / 70 / queueSpeed);
  const pct = (Math.max(0, Math.min(1, 1 - q.ahead / q.total)) * 100).toFixed(1) + '%';
  const left = tiers.reduce((a, t) => a + t.left, 0);
  return (
    <div className="fade-in" data-screen="queue" style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 0 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'clamp(22px,2.4vw,30px)', textTransform: 'uppercase' }}>{ev.artist}</span>
          <span style={{ fontSize: 14, color: 'var(--ink3)' }}>{ev.dateLong} · {ev.venue}</span>
        </div>
        <button className="c-iconbtn" onClick={actions.leaveQueue}>Leave queue</button>
      </div>
      <div className="c-split">
        <VenueCanvas mode="queue" sold={sold} progress={prog} glow="rgba(34,211,238,0.12)">
          <div style={{ position: 'absolute', left: 20, bottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#9A99A8', pointerEvents: 'none' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i style={{ width: 9, height: 9, borderRadius: '50%', background: '#ECFEFF', boxShadow: '0 0 8px #22D3EE' }} />You</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i style={{ width: 9, height: 9, borderRadius: '50%', background: '#22D3EE' }} />Ahead of you</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i style={{ width: 9, height: 9, background: '#F59E0B' }} />Just sold</span>
          </div>
        </VenueCanvas>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--cyan-t)' }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />
            {S.check ? 'Paused while you answer' : 'Queue moving'}
          </div>
          <div className="c-flapbig" style={{ paddingTop: 14 }}><FlapString value={ahead.toLocaleString('en-US')} tone="cyan" /></div>
          <div style={{ fontSize: 18, color: '#D6D5E0', paddingTop: 12 }}>people ahead of you</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 26 }}>
            <div style={{ position: 'relative', height: 4, background: 'rgba(34,211,238,.12)' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct, background: 'var(--cyan-t)', boxShadow: '0 0 12px var(--cyan)', transition: 'width 300ms linear' }} />
              <div style={{ position: 'absolute', top: -5, left: pct, width: 14, height: 14, marginLeft: -7, borderRadius: '50%', background: '#ECFEFF', boxShadow: '0 0 12px var(--cyan)', transition: 'left 300ms linear' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink3)' }}><span>Joined</span><span>{secs > 60 ? `About ${Math.ceil(secs / 60)} min` : 'Under a minute'}</span><span>Your turn</span></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingTop: 28 }}>
            <div className="c-stat"><span>Seats left</span><span style={{ color: '#FDE68A' }}>{left.toLocaleString('en-US')}</span></div>
            <div className="c-stat"><span>Behind you</span><span>{Math.floor(q.behind).toLocaleString('en-US')}</span></div>
          </div>
          <div className="c-kicker" style={{ padding: '28px 0 6px' }}>Live at the venue</div>
          {(S.feed || []).map((f, i) => {
            const ago = Math.floor((now - f.at) / 1000);
            return <div key={f.at} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 15, opacity: 1 - i * 0.2 }}><span style={{ color: '#D6D5E0' }}>{f.text}</span><span style={{ color: 'var(--amber-t)', whiteSpace: 'nowrap' }}>{ago < 2 ? 'now' : ago + 's ago'}</span></div>;
          })}
          <div style={{ paddingTop: 22, fontSize: 14, lineHeight: 1.55, color: 'var(--ink3)' }}>Keep this tab open. Your place is saved if you refresh. We may ask a quick question while you wait to make sure you're still here.</div>
        </div>
      </div>
    </div>
  );
}

export function Turn({ st }) {
  const { S, con: ev, sold, actions, hold, buy } = st;
  return (
    <div className="fade-in c-split" data-screen="turn" style={{ paddingTop: 28, paddingBottom: 40 }}>
      <div className="c-sticky" style={{ order: 0 }}>
        <div className="only-m" style={{ paddingBottom: 18 }}><TurnHead ev={ev} hold={hold} /></div>
        <VenueCanvas mode="turn" tier={S.tier} sold={sold} onPick={actions.pickTier} controls glow="rgba(245,158,11,0.10)" hint="Drag to rotate · scroll to zoom · tap a section" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="only-d" style={{ paddingBottom: 24 }}><TurnHead ev={ev} hold={hold} /></div>
        <TierList st={st} compact />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0' }}>
          <span style={{ fontSize: 16, color: '#D6D5E0' }}>Tickets</span>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid rgba(255,255,255,.12)', borderRadius: 3 }}>
            <button aria-label="Fewer" onClick={() => actions.qty(-1)} style={{ width: 48, height: 48, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <span style={{ width: 44, textAlign: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 30 }}>{S.qty}</span>
            <button aria-label="More" onClick={() => actions.qty(1)} style={{ width: 48, height: 48, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>
        </div>
        <BuyBar buy={buy} />
        <div className="only-m" style={{ height: 110 }} />
      </div>
    </div>
  );
}

function TurnHead({ ev, hold }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--amber-t)' }}>
        <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', boxShadow: '0 0 8px var(--amber)' }} />It's your turn · {ev.artist}
      </div>
      <div className="c-flapbig" style={{ paddingTop: 14 }}><FlapString value={hold.str} tone="amber" /></div>
      <div style={{ fontSize: 17, lineHeight: 1.5, color: '#D6D5E0', paddingTop: 12 }}>We're holding seats for you. Pick a section and how many.</div>
    </div>
  );
}

export function Checkout({ st }) {
  const { S, con: ev, sel, totals, hold, actions } = st;
  const pays = [['card', 'Visa ending 4417'], ['wallet', 'Phone wallet']];
  return (
    <div className="fade-in" data-screen="checkout" style={{ maxWidth: 1040, margin: '0 auto', paddingTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button className="link-back" onClick={actions.backToTurn}>← Back to seats</button>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--amber-t)', fontVariantNumeric: 'tabular-nums' }}>Seats held for {hold.str}</span>
      </div>
      <h1 className="c-title" style={{ padding: '28px 0' }}>Checkout</h1>
      <div className="c-two">
        <div>
          <div style={{ padding: 26, borderRadius: 4, background: ev.poster, minHeight: 170, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 'clamp(40px,4.5vw,56px)', lineHeight: .88, textTransform: 'uppercase', color: '#fff' }}>{ev.artist}</span>
            <span style={{ fontSize: 15, color: 'rgba(255,255,255,.88)' }}>{ev.dateLong} · {ev.venue}, {ev.city}</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="kv" style={{ fontSize: 16 }}><span>{S.qty} × {sel.name}</span><span>{totals.subtotal}</span></div>
            <div className="kv" style={{ fontSize: 16 }}><span>Service fee</span><span>{totals.fees}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '18px 0' }}><span style={{ fontWeight: 600 }}>Total</span><span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 44 }}>{totals.total}</span></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 26, background: '#101017', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div className="c-kicker" style={{ paddingBottom: 12 }}>Pay with</div>
          {pays.map(([id, label]) => {
            const on = S.pay === id;
            return (
              <button key={id} onClick={() => actions.setPay(id)} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 58, padding: '0 16px', marginBottom: 8, borderRadius: 3, border: `1px solid ${on ? '#FBBF24' : 'rgba(255,255,255,.12)'}`, background: on ? 'rgba(245,158,11,.08)' : 'transparent' }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${on ? '#FBBF24' : 'rgba(255,255,255,.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FBBF24' }} />}</span>
                <span style={{ fontSize: 16 }}>{label}</span>
              </button>
            );
          })}
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink3)', padding: '12px 0 22px' }}>Tickets go to sam.r@mail.com and to My tickets. Face-value resale only.</div>
          <button className="btn btn-amber" onClick={actions.pay} style={{ minHeight: 60 }}>Pay {totals.total}</button>
        </div>
      </div>
    </div>
  );
}

export function Done({ st }) {
  const { S, con: ev, actions } = st;
  const tk = S.tickets[0] || { sec: '', row: '', seats: '', order: '' };
  return (
    <div className="fade-in c-two" data-screen="done" style={{ maxWidth: 1120, margin: '0 auto', paddingTop: 'clamp(32px,6vw,64px)', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--amber-t)' }}>Order confirmed</div>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 'clamp(84px,11vw,140px)', lineHeight: .82, textTransform: 'uppercase', color: '#FFF7E6', textShadow: '0 0 40px rgba(245,158,11,.45)' }}>You're going.</div>
        <div style={{ fontSize: 17, lineHeight: 1.5, color: 'var(--ink2)', maxWidth: 420 }}>Your tickets are in My tickets and on their way to your email.</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-amber" onClick={actions.toTickets}>View my tickets</button>
          <button className="btn btn-ghost" onClick={actions.goHome}>Back to home</button>
        </div>
      </div>
      <TicketCard d={ev} tk={tk} big />
    </div>
  );
}
