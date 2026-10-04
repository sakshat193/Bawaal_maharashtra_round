import { Link } from 'react-router-dom';
import { useDrop, useInvariants } from '../../api/hooks.js';
import { messageForError } from '../../api/messages.js';
import { present } from './data.js';
import { formatPaise } from '../../drop/flow.js';
import Poster, { DateChip, Pill } from './Poster.jsx';

function DropCard({ drop, saved, onToggleSave }) {
  const detail = useDrop(drop.drop_id);
  const current = detail.data || drop;
  const inventory = useInvariants(drop.drop_id, current.phase);
  const view = present(current);
  const tiers = current.tiers || [];
  const minimum = tiers.length ? Math.min(...tiers.map(tier => tier.price_paise)) : null;
  const capacity = tiers.reduce((sum, tier) => sum + tier.capacity, 0);
  const held = tiers.reduce((sum, tier) => {
    const row = inventory.data?.tiers?.find(item => item.tier_id === tier.tier_id);
    return sum + (row?.held || 0);
  }, 0);

  // Valid only while confirmed offers remain included in held.
  const firstCome = current.phase === 'settled' && inventory.data?.tiers?.length
    ? inventory.data.tiers.reduce((sum,row) => sum + (row.general_sale_units ?? (row.capacity - row.held)),0)
    : null;

  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ position: 'relative' }}>
        <Link to={`/drops/${encodeURIComponent(drop.drop_id)}`} aria-label={`View ${drop.name}`}>
          <Poster d={view} className="c-card-poster">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <DateChip d={view} />
              <Pill d={view} short />
            </div>
            <div className="c-card-artist">{view.name}</div>
          </Poster>
        </Link>
        <button
          className="c-save"
          type="button"
          aria-label={saved ? `Remove ${drop.name} from saved` : `Save ${drop.name}`}
          aria-pressed={saved}
          onClick={() => onToggleSave(drop.drop_id)}
          style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, color: saved ? '#FB7185' : '#ECEBF3', background: 'rgba(10,10,15,.82)' }}
        >{saved ? '♥' : '♡'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{view.venue}</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)' }}>{view.dateLong}</div>
        <div style={{ color: 'var(--ink3)', fontSize: 14 }}>From {minimum === null ? 'Loading price' : formatPaise(minimum)}</div>
      </div>
      {inventory.data && capacity > 0 && (
        <div aria-label={`${held} of ${capacity} tickets held`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 3, background: 'rgba(255,255,255,.12)' }}>
            <div style={{ height: '100%', width: `${Math.min(100, held / capacity * 100)}%`, background: view.pillColor }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--ink4)' }}>{new Intl.NumberFormat('en-IN').format(held)} held of {new Intl.NumberFormat('en-IN').format(capacity)}</span>
        </div>
      )}
      {firstCome !== null && <span className="c-sub">{firstCome.toLocaleString('en-IN')} first-come tickets</span>}
      {detail.error && <span role="status" className="c-sub">{messageForError(detail.error)}</span>}
    </article>
  );
}

function DropGrid({ drops, saved, onToggleSave }) {
  if (!drops.length) return <p style={{ padding: '32px 0', color: 'var(--ink3)' }}>No drops match this search.</p>;
  return (
    <div className="c-grid">
      {drops.map(drop => (
        <DropCard key={drop.drop_id} drop={drop} saved={Boolean(saved[drop.drop_id])} onToggleSave={onToggleSave} />
      ))}
    </div>
  );
}

export function Home({ drops = [], saved = {}, onToggleSave = () => {}, query = '' }) {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = drops.filter(drop => `${drop.name} ${drop.venue}`.toLocaleLowerCase().includes(normalized));
  return (
    <div className="fade-in" data-screen="home">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', padding: 'clamp(28px,5vw,48px) 0 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="c-sub">Fair Drop</div>
          <h1 className="c-title">Live near you</h1>
        </div>
        <span className="c-sub">{filtered.length} {filtered.length === 1 ? 'drop' : 'drops'}</span>
      </div>
      <DropGrid drops={filtered} saved={saved} onToggleSave={onToggleSave} />
      <div className="c-proof">
        <span>Fair Drop</span>
        <Link to="/verify">Check a draw</Link>
        <Link to="/judges">Judge dashboard</Link>
        <Link to="/demo">Demo controls</Link>
      </div>
    </div>
  );
}

export function Saved({ drops = [], saved = {}, onToggleSave = () => {}, query = '' }) {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = drops.filter(drop => saved[drop.drop_id] && `${drop.name} ${drop.venue}`.toLocaleLowerCase().includes(normalized));
  return (
    <div className="fade-in" data-screen="saved" style={{ paddingTop: 'clamp(28px,5vw,48px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <h1 className="c-title">Saved</h1>
        <span className="c-sub">{filtered.length} {filtered.length === 1 ? 'drop' : 'drops'}</span>
      </div>
      <DropGrid drops={filtered} saved={saved} onToggleSave={onToggleSave} />
    </div>
  );
}
