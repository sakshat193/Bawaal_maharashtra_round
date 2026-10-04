import { useEffect, useMemo, useRef, useState } from 'react';
import { api, serverNow } from '../api/client.js';
import { useOfferSeats, useSeatMap } from '../api/hooks.js';
import { messageForError } from '../api/messages.js';
import { isLite } from '../lib/constants.js';
import { layout, seatLabels } from '../three/venue.js';
import { SEAT_COLORS, createSeatMap, seatState } from '../three/seatMap.js';
import { labelFor, nextSelection, untilText } from './selection.js';

const STATE_TEXT = { available: 'available', locked: 'locked by someone else', booked: 'booked', mine: 'your seat' };

function useTick(ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), ms); return () => clearInterval(id); }, [ms]);
}

/** Accessible 2D seat grid: the lite-mode view, and a list view anywhere. */
function SeatGrid({ section, sets, readOnly, onToggle }) {
  return (
    <div className="fd-seatgrid" role="group" aria-label={`${section.name} seats`}>
      {section.rows.map((row, r) => (
        <div className="fd-seatgrid-row" key={r}>
          <span className="fd-seatgrid-label">R{r + 1}</span>
          {row.dots.map(dot => {
            const s = seatState(dot.index, sets);
            const disabled = readOnly || s === 'booked' || s === 'locked';
            return (
              <button key={dot.index} type="button" className={`fd-seat ${s}`} disabled={disabled}
                aria-pressed={s === 'mine'} onClick={() => onToggle(dot.index)}
                aria-label={`Row ${dot.row} seat ${dot.seat}, ${STATE_TEXT[s]}`} title={`Row ${dot.row} · Seat ${dot.seat}`} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Seat3D({ tiers, tierId, sets, readOnly, onToggle, onHover }) {
  const host = useRef(null);
  const engine = useRef(null);
  const toggleRef = useRef(onToggle);
  const hoverRef = useRef(onHover);
  toggleRef.current = onToggle;
  hoverRef.current = onHover;
  useEffect(() => {
    const map = createSeatMap(host.current, {
      tiers, tierId, onToggle: i => toggleRef.current(i), onHover: dot => hoverRef.current(dot)
    });
    engine.current = map;
    return () => { map.dispose(); engine.current = null; };
  }, [tiers, tierId]);
  useEffect(() => {
    engine.current?.setState({ booked: [...sets.booked], locked: [...sets.locked], mine: [...sets.mine], readOnly });
  }, [sets, readOnly]);
  return (
    <div className="fd-seat3d">
      <div ref={host} className="fd-seat3d-canvas" role="img" aria-label="3D seat map. Use the list view for a keyboard-accessible seat list." />
      <div className="fd-venue-controls fd-seat3d-controls">
        <button type="button" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(0.8)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(1.25)}>−</button>
        <button type="button" aria-label="Reset view" onClick={() => engine.current?.resetView()}>Reset</button>
      </div>
    </div>
  );
}

/**
 * Seat choice for a lottery winner, BookMyShow-style but without a race: the server only
 * accepts changes while this winner's rank-ordered wave window is open, and the database
 * guarantees a seat can be locked by one offer at a time.
 */
export default function SeatPicker({ drop, offer, editable = true, onSeatsChange = () => {} }) {
  useTick();
  const map = useSeatMap(drop.drop_id);
  const mineQ = useOfferSeats(offer.offer_id);
  const [view, setView] = useState(isLite() ? 'grid' : '3d');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [hover, setHover] = useState(null);
  const [optimistic, setOptimistic] = useState(null);

  // drop.tiers is a new array on every poll; key it by content so the 3D scene isn't rebuilt.
  const tiersKey = JSON.stringify(drop.tiers.map(t => [t.tier_id, t.name, t.capacity, t.price_paise]));
  const tiers = useMemo(() => drop.tiers, [tiersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const section = useMemo(() => layout(tiers, { unitSize: 1 }).tiers.find(t => t.tier_id === offer.tier_id), [tiers, offer.tier_id]);
  const labels = useMemo(() => seatLabels(tiers, offer.tier_id), [tiers, offer.tier_id]);
  const tierMap = map.data?.tiers?.find(t => t.tier_id === offer.tier_id);
  const mine = optimistic ?? mineQ.data?.seats ?? [];
  const sets = useMemo(() => {
    const m = new Set(mine);
    return {
      mine: m,
      booked: new Set((tierMap?.booked || []).filter(i => !m.has(i))),
      locked: new Set((tierMap?.locked || []).filter(i => !m.has(i)))
    };
  }, [tierMap, mine]);

  useEffect(() => { onSeatsChange(mine); }, [mine.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const win = mineQ.data;
  const now = serverNow();
  const notYet = win && Date.parse(win.window_opens_at) > now;
  const closed = win && Date.parse(win.window_closes_at) <= now;
  const readOnly = !editable || !win || notYet || closed || offer.status !== 'offered';

  async function toggle(index) {
    if (readOnly || busy) return;
    const next = nextSelection(index, { mine, locked: [...sets.locked], booked: [...sets.booked], quantity: offer.quantity });
    if (next.blocked) { setNotice(next.blocked === 'booked' ? 'That seat is already booked.' : 'Someone else is holding that seat right now.'); return; }
    setBusy(true);
    setNotice(null);
    setOptimistic(next.seats);
    try {
      await api(`/api/offers/${encodeURIComponent(offer.offer_id)}/seats`, { method: 'PUT', body: { seats: next.seats } });
    } catch (error) {
      setNotice(messageForError(error));
    } finally {
      mineQ.refresh();
      map.refresh();
      setOptimistic(null);
      setBusy(false);
    }
  }

  if (!section) return null;
  return (
    <section className="fd-seatpicker" aria-label="Choose your seats">
      <div className="fd-seatpicker-head">
        <div>
          <p className="c-kicker">{section.name} · choose {offer.quantity} seat{offer.quantity === 1 ? '' : 's'}</p>
          {editable && offer.status === 'offered' && (
            notYet
              ? <p className="fd-seat-turn wait">Your turn to choose opens in <b className="mono">{untilText(win.window_opens_at, now)}</b>. Seats are chosen in draw-rank order, so nobody can out-click you.</p>
              : closed ? <p className="fd-seat-turn">Your seat window has closed.</p>
                : win ? <p className="fd-seat-turn open">It's your turn. Tap seats on the map. <b className="mono">{untilText(win.window_closes_at, now)}</b> left to choose and press Buy.</p>
                  : <p className="fd-seat-turn">Loading your seat window…</p>
          )}
        </div>
        <div className="fd-seat-viewtoggle" role="group" aria-label="Seat map view">
          {!isLite() && <button type="button" className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D stadium</button>}
          <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Seat list</button>
        </div>
      </div>

      {view === '3d' && !isLite()
        ? <Seat3D tiers={tiers} tierId={offer.tier_id} sets={sets} readOnly={readOnly} onToggle={toggle} onHover={setHover} />
        : <SeatGrid section={section} sets={sets} readOnly={readOnly} onToggle={toggle} />}

      <div className="fd-seat-legend" aria-hidden="true">
        <span><i style={{ background: SEAT_COLORS.available }} /> Available</span>
        <span><i style={{ background: SEAT_COLORS.locked }} /> Locked</span>
        <span><i style={{ background: SEAT_COLORS.booked }} /> Booked</span>
        <span><i className="mine" style={{ background: SEAT_COLORS.mine }} /> Your seats</span>
        {view === '3d' && <span className="fd-seat-hover">{hover ? `Row ${hover.row} · Seat ${hover.seat} · ${STATE_TEXT[seatState(hover.index, sets)]}` : 'Drag to rotate · scroll to zoom'}</span>}
      </div>

      <p className="fd-seat-chosen" role="status">
        {mine.length
          ? <>Your seats ({mine.length}/{offer.quantity}): <b>{[...mine].sort((a, b) => a - b).map(i => labelFor(labels, i)).join(', ')}</b></>
          : `No seats chosen yet (0/${offer.quantity}).`}
      </p>
      {notice && <p role="alert" className="fd-error">{notice}</p>}
      {map.error && !map.data && <p role="alert" className="fd-error">{messageForError(map.error)}</p>}
    </section>
  );
}

/** Read-only "Row r · Seat s" list for payment and confirmation screens. */
export function SeatSummary({ drop, offer }) {
  const mineQ = useOfferSeats(offer?.offer_id, Boolean(offer && drop.seat_selection));
  const labels = useMemo(() => offer ? seatLabels(drop.tiers, offer.tier_id) : [], [drop.tiers, offer?.tier_id]);
  const seats = mineQ.data?.seats || [];
  if (!drop.seat_selection || !seats.length) return null;
  return <p className="fd-seat-chosen">Seats: <b>{seats.map(i => labelFor(labels, i)).join(', ')}</b></p>;
}
