import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { messageForError } from '../api/messages.js';
import { useDrop, useInvariants, useMe } from '../api/hooks.js';
import { screenFor } from './screen.js';

function hasToken() {
  try {
    return Boolean(globalThis.sessionStorage?.getItem('fd.jwt'));
  } catch {
    return false;
  }
}

function inr(paise) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(paise / 100)}`;
}

export default function DropPage() {
  const { dropId } = useParams();
  const [entering, setEntering] = useState(false);
  const drop = useDrop(dropId);
  const me = useMe(dropId, drop.data?.phase);
  const invariants = useInvariants(dropId, drop.data?.phase);

  if (drop.error && !drop.data) return <main className="c-main"><p role="alert">{messageForError(drop.error)}</p></main>;
  if (!drop.data) return <main className="c-main"><p role="status">Loading drop…</p></main>;

  const screen = screenFor(drop.data.phase, me.data, hasToken());
  return (
    <main className="c-main" data-screen={screen}>
      <Link to="/" className="c-sub">← Home</Link>
      <p className="c-sub">Fair Drop · {drop.data.phase}</p>
      <h1 className="c-title">{drop.data.name}</h1>
      <p>{drop.data.venue}</p>
      <p>{screen === 'detail' ? 'Choose a ticket tier to see the current drop details.' : `Your entry is ${screen.replaceAll('_', ' ')}.`}</p>
      {screen === 'detail' && (
        <button className="btn btn-light" type="button" onClick={() => setEntering(true)}>
          {entering ? 'Entry form' : 'Register interest'}
        </button>
      )}
      {entering && <p role="status">Entry details will appear here.</p>}
      <ul>
        {drop.data.tiers.map(tier => {
          const inventory = invariants.data?.tiers?.find(item => item.tier_id === tier.tier_id);
          return (
            <li key={tier.tier_id}>
              {tier.name} · {inr(tier.price_paise)} · {inventory ? `${tier.capacity - inventory.held} available` : 'Inventory loading'}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
