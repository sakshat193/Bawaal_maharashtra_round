import { Link } from 'react-router-dom';
import { CONCERTS, GENRES } from './data.js';
import Poster, { DateChip, Pill } from './Poster.jsx';

export function Home({ st }) {
  const { S, actions, describe } = st;
  const ql = S.q.trim().toLowerCase();
  const filtered = CONCERTS.filter(x => (S.genre === 'All' || x.genre === S.genre) && (!ql || `${x.artist} ${x.venue} ${x.city}`.toLowerCase().includes(ql))).map(describe);
  const onSale = CONCERTS.filter(x => x.status === 'onsale' || x.status === 'few').map(describe);
  const featured = describe(CONCERTS[0]);
  const noFilter = !ql && S.genre === 'All';

  return (
    <div className="fade-in" data-screen="home">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', padding: 'clamp(28px,5vw,48px) 0 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="c-sub">Good evening, Sam</div>
          <h1 className="c-title">Live near you</h1>
        </div>
        <div className="c-search only-m" style={{ maxWidth: 'none', width: '100%' }}>
          <span className="lens" />
          <input value={S.q} onChange={e => actions.setQuery(e.target.value)} placeholder="Search artists, venues, cities" />
        </div>
        <div className="c-chips">
          {GENRES.map(g => <button key={g} className={'c-chip' + (S.genre === g ? ' on' : '')} onClick={() => actions.setGenre(g)}>{g}</button>)}
        </div>
      </div>

      {noFilter && (
        <div className="c-hero">
          <Poster d={featured} as="button" className="c-featured" onClick={() => actions.openSheet(featured.id)}>
            <div style={{ position: 'absolute', top: 'clamp(18px,2.4vw,28px)', left: 'clamp(20px,3vw,36px)', right: 'clamp(20px,3vw,36px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pill d={featured} pulse />
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.14em', color: 'rgba(255,255,255,.7)' }}>FEATURED</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.75)' }}>{featured.tag}</div>
              <div className="c-artist-xl">{featured.artist}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingTop: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: '1 1 240px' }}>
                  <div style={{ fontSize: 17, color: 'rgba(255,255,255,.9)' }}>{featured.date} · {featured.venue}, {featured.city}</div>
                  <div style={{ height: 3, width: 320, maxWidth: '100%', background: 'rgba(255,255,255,.15)' }}><div style={{ height: '100%', width: featured.soldPct, background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,.7)' }} /></div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)' }}>{featured.soldLabel} · from {featured.fromFmt}</div>
                </div>
                <span className="btn btn-light" style={{ minHeight: 52 }}>Get tickets</span>
              </div>
            </div>
          </Poster>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 4 }}>
              <h2 className="c-h2">On sale now</h2>
              <span className="c-sub" style={{ fontSize: 13 }}>{onSale.length} shows</span>
            </div>
            {onSale.map(c => (
              <button key={c.id} className="c-row" onClick={() => actions.openSheet(c.id)}>
                <Poster d={c} className="c-thumb"><DateChip d={c} /></Poster>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 26, lineHeight: 1, textTransform: 'uppercase', color: '#F4F2FB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.artist}</div>
                  <div style={{ fontSize: 13, color: '#9A99A8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.venue}, {c.city}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.pillColor }}>{c.pill} <span style={{ color: '#7A7A8C', fontWeight: 400 }}>· from {c.fromFmt}</span></div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '56px 0 18px' }}>
        <h2 className="c-h2" style={{ fontSize: 'clamp(28px,3vw,36px)' }}>{noFilter ? 'All upcoming' : 'Results'}</h2>
        <span className="c-sub" style={{ fontSize: 14 }}>{filtered.length} {filtered.length === 1 ? 'show' : 'shows'}</span>
      </div>
      <div className="c-grid">
        {filtered.map(c => (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Poster d={c} as="button" className="c-card-poster" onClick={() => actions.openSheet(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <DateChip d={c} />
                <span style={{ padding: '6px 9px', borderRadius: 2, background: 'rgba(10,10,15,.72)', color: c.pillColor, fontSize: 12, fontWeight: 600 }}>{c.pillShort}</span>
              </div>
              <div className="c-card-artist">{c.artist}</div>
            </Poster>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{c.venue}</div>
                <div style={{ fontSize: 14, color: 'var(--ink3)' }}>{c.dow} · {c.city} · from {c.fromFmt}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.pillColor }}>{c.pill}</div>
              </div>
              <button className="c-save" aria-label={c.saved ? 'Remove from saved' : 'Save'} onClick={() => actions.toggleSave(c.id)} style={{ color: c.saved ? '#FB7185' : '#8A8A9A' }}>{c.saved ? '♥' : '♡'}</button>
            </div>
          </div>
        ))}
      </div>
      {!filtered.length && <div style={{ padding: '40px 0', fontSize: 16, color: 'var(--ink3)' }}>Nothing matches that yet. Try another artist or genre.</div>}

      <div className="c-proof">
        <span>How Fair Drop works:</span>
        <Link to="/drop">Live drop</Link>
        <Link to="/results">Your result</Link>
        <Link to="/verify">Check a draw</Link>
        <Link to="/judges">Judge dashboard</Link>
      </div>
    </div>
  );
}

export function Saved({ st }) {
  const { S, actions, describe } = st;
  const list = CONCERTS.filter(x => S.saved[x.id]).map(describe);
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 'clamp(28px,5vw,48px)' }}>
      <h1 className="c-title">Saved</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))', gap: 12 }}>
        {list.map(c => (
          <button key={c.id} className="c-row" onClick={() => actions.openSheet(c.id)}>
            <Poster d={c} className="c-thumb"><DateChip d={c} /></Poster>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 28, lineHeight: 1, textTransform: 'uppercase' }}>{c.artist}</div>
              <div style={{ fontSize: 14, color: '#9A99A8' }}>{c.venue} · <span style={{ color: c.pillColor }}>{c.pill}</span></div>
            </div>
          </button>
        ))}
      </div>
      {!list.length && <div style={{ fontSize: 16, color: 'var(--ink3)' }}>Tap ♡ on any show to keep it here. We'll remind you before it goes on sale.</div>}
    </div>
  );
}

export function TicketCard({ d, tk, big = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(245,158,11,.35)', boxShadow: big ? '0 0 40px rgba(245,158,11,.10)' : 'none' }}>
      <Poster d={d} style={{ border: 0, borderRadius: 0, minHeight: big ? 200 : 150 }}>
        <div style={{ marginTop: 'auto', padding: big ? 26 : 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: big ? 'clamp(44px,5vw,60px)' : 44, lineHeight: .86, textTransform: 'uppercase', color: '#fff' }}>{d.artist}</div>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,.88)' }}>{d.dateLong} · Doors {d.doors}</div>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,.88)' }}>{d.venue}, {d.city}</div>
        </div>
      </Poster>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, padding: '18px 22px', background: '#111019', borderBottom: big ? '1px dashed rgba(255,255,255,.15)' : 0 }}>
        {[['Section', tk.sec], ['Row', tk.row], ['Seats', tk.seats]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 12, color: '#7A7A8C' }}>{k}</span><span style={{ fontSize: 17, fontWeight: 600 }}>{v}</span></div>
        ))}
      </div>
      {big && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '20px 22px', background: '#111019' }}>
          <div style={{ flex: '0 0 104px', height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-linear-gradient(45deg,#ECEBF3 0 2px,#111019 2px 6px)' }}>
            <span className="mono" style={{ padding: '3px 5px', background: '#111019', fontSize: 10 }}>QR</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5, color: '#9A99A8' }}>
            <span>Scan at the door. Your ticket refreshes every 30 seconds, so screenshots won't work.</span>
            <span className="mono" style={{ fontSize: 12, color: '#7A7A8C' }}>{tk.order}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Tickets({ st }) {
  const { S, describe } = st;
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 'clamp(28px,5vw,48px)' }}>
      <h1 className="c-title">My tickets</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,380px),1fr))', gap: 16 }}>
        {S.tickets.map((tk, i) => <TicketCard key={tk.order + i} tk={tk} d={describe(CONCERTS.find(c => c.id === tk.cid) || CONCERTS[0])} />)}
      </div>
      {!S.tickets.length && <div style={{ fontSize: 16, color: 'var(--ink3)' }}>No tickets yet. When you buy, they'll show up here and in your phone's wallet.</div>}
    </div>
  );
}
