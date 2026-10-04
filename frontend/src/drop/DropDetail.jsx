import { useEffect, useMemo, useState } from 'react';
import { RULE_TEXT } from '../api/messages.js';
import { serverNow } from '../api/client.js';
import { formatPaise } from './flow.js';
import { present } from '../pages/concert/data.js';
import VenueCanvas from '../pages/concert/VenueCanvas.jsx';
import EntryForm from './EntryForm.jsx';

const PALETTE = ['#C4B5FD', '#A78BFA', '#F5D0FE', '#93C5FD'];

export default function DropDetail({ drop, invariants, entering, onEnter, onCloseEntry, refresh, onLogin }) {
  const tiers = Array.isArray(drop.tiers) ? drop.tiers : [];
  const ordered = useMemo(() => [...tiers].sort((a, b) => b.price_paise - a.price_paise || a.tier_id.localeCompare(b.tier_id)), [tiers]);
  const colors = new Map(ordered.map((tier, index) => [tier.tier_id, PALETTE[index % PALETTE.length]]));
  const [tierId, setTierId] = useState(ordered[0]?.tier_id || '');
  const [quantity, setQuantity] = useState(1);
  const [fairOpen, setFairOpen] = useState(false);
  const [now, setNow] = useState(serverNow());
  const selected = tiers.find(tier => tier.tier_id === tierId) || ordered[0];
  const inventory = invariants?.tiers || [];
  const heldByTier = useMemo(
    () => Object.fromEntries(inventory.map(item => [item.tier_id, item.held])),
    [inventory]
  );
  const capacity = tiers.reduce((sum, tier) => sum + tier.capacity, 0);
  const held = tiers.reduce((sum, tier) => sum + (inventory.find(row => row.tier_id === tier.tier_id)?.held || 0), 0);
  const availability = tier => {
    const row = inventory.find(item => item.tier_id === tier.tier_id);
    return row ? Math.max(0, tier.capacity - row.held) : null;
  };
  const closesIn = Math.max(0, Math.ceil((Date.parse(drop.closes_at) - now) / 1000));
  const phaseAllowsEntry = drop.phase === 'open' && selected && (availability(selected) ?? 0) > 0;
  const openLabel = drop.phase === 'scheduled'
    ? `Opens ${new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(drop.opens_at))}`
    : drop.phase === 'open' ? 'Enter the draw' : 'Registration closed';
  const view = present(drop);

  useEffect(() => {
    if (!ordered.some(tier => tier.tier_id === tierId)) setTierId(ordered[0]?.tier_id || '');
  }, [ordered, tierId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fade-in" data-screen="detail" style={{ paddingTop: 22, paddingBottom: 40 }}>
      <div className="c-split">
        <div className="fd-detail-poster" style={{ background: view.poster }}>
          <img src={view.photoUrl} alt="" />
          <div className="fd-detail-wash" style={{ background: view.tint }} />
          <span className="pill" style={{ background: view.pillBg, color: view.pillColor }}>{view.pill}</span>
          <h1>{drop.name}</h1>
          <p>{drop.venue} · {view.dateLong}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <p className="c-kicker">Ticket tiers</p>
            <h2 className="c-h2">Choose a section</h2>
          </div>
          <div className="fd-tier-list">
            {ordered.map(tier => {
              const left = availability(tier);
              const selectedTier = tier.tier_id === selected?.tier_id;
              const row = inventory.find(row => row.tier_id === tier.tier_id);
              // Valid only while confirmed offers remain included in held.
              const generalSale = row ? row.general_sale_units ?? (row.capacity - row.held) : null;
              return (
                <button
                  key={tier.tier_id}
                  type="button"
                  className={`fd-tier${selectedTier ? ' selected' : ''}`}
                  aria-pressed={selectedTier}
                  onClick={() => setTierId(tier.tier_id)}
                  style={{ '--tier-color': colors.get(tier.tier_id) }}
                >
                  <span className="fd-tier-main"><i />
                    <span><b>{tier.name}</b><small>{tier.capacity.toLocaleString('en-IN')} capacity{left === null ? '' : ` · ${left.toLocaleString('en-IN')} free`}</small></span>
                  </span>
                  <span className="fd-tier-price">{formatPaise(tier.price_paise)}</span>
                  {drop.phase === 'settled' && generalSale > 0 && <small className="fd-sale">{generalSale.toLocaleString('en-IN')} first-come tickets</small>}
                </button>
              );
            })}
          </div>

          <div className="fd-quantity">
            <label htmlFor="quantity">Quantity</label>
            <div>
              <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
              <output id="quantity" aria-live="polite">{quantity}</output>
              <button type="button" aria-label="Increase quantity" disabled={quantity >= drop.max_quantity} onClick={() => setQuantity(value => Math.min(drop.max_quantity, value + 1))}>+</button>
            </div>
            <span>Limit {drop.max_quantity} per entry</span>
          </div>

          <div className="fd-inventory" aria-label={`${held} of ${capacity} tickets held`}>
            <div><span>Held</span><b>{held.toLocaleString('en-IN')} / {capacity.toLocaleString('en-IN')}</b></div>
            <div className="fd-progress"><span style={{ width: `${capacity ? Math.min(100, held / capacity * 100) : 0}%` }} /></div>
          </div>

          {drop.phase === 'open' && <p className="c-sub">Registration closes in {Math.floor(closesIn / 60)}:{String(closesIn % 60).padStart(2, '0')} · Everyone has the same chance.</p>}
          <button className="btn btn-violet" type="button" disabled={!phaseAllowsEntry} onClick={onEnter}>{openLabel}</button>

          <div className="fd-facts">
            <div><span>Allocation</span><b>{drop.allocation_mode.replaceAll('_', ' ')}</b></div>
            <div><span>Proof of work</span><b>{drop.pow_required ? `${drop.pow_bits} bits · ${drop.pow_k} checks` : 'Not required'}</b></div>
            <div><span>Draw round</span><b>{drop.drand_round.toLocaleString('en-IN')}</b></div>
            <div><span>Draw time</span><b>{new Date(drop.drand_round_due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div>
          </div>

          <button type="button" className="fd-fair-toggle" aria-expanded={fairOpen} onClick={() => setFairOpen(value => !value)}>
            <span>How is this fair?</span><span>{fairOpen ? '−' : '+'}</span>
          </button>
          {fairOpen && (
            <section className="fd-fair">
              <p>Entries are sealed before the public randomness round. The server ranks eligible entries and offers tickets in that order.</p>
              <p><b>Configuration</b><br /><code>{drop.config_hash}</code></p>
              <p><b>Drand round</b><br />{drop.drand_round.toLocaleString('en-IN')} · {drop.drand_round_due_at}</p>
              {drop.snapshot?.canonical_hash && <p><b>Sealed snapshot</b><br /><code>{drop.snapshot.canonical_hash}</code></p>}
              <ul>{drop.sybil_rules.map(rule => <li key={rule.id}>{RULE_TEXT(rule)}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
      <VenueCanvas tiers={ordered} held={heldByTier} tier={selected?.tier_id} onPick={setTierId} />
      {entering && selected && <EntryForm drop={drop} tier={selected} quantity={quantity} onClose={onCloseEntry} refresh={refresh} onLogin={onLogin} />}
    </div>
  );
}
