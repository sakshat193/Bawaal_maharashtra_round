import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDraw, useDrop, useInvariants, useMe, useSnapshot } from '../api/hooks.js';
import { messageForError } from '../api/messages.js';
import { screenFor } from './screen.js';
import DropDetail from './DropDetail.jsx';
import { Registered, Results, Sealed } from './StatusScreens.jsx';

function hasToken() {
  try {
    return Boolean(globalThis.sessionStorage?.getItem('fd.jwt'));
  } catch {
    return false;
  }
}

export default function DropPage() {
  const { dropId } = useParams();
  const [entering, setEntering] = useState(false);
  const drop = useDrop(dropId);
  const me = useMe(dropId, drop.data?.phase);
  const invariants = useInvariants(dropId, drop.data?.phase);
  const draw = useDraw(dropId, drop.data?.phase);
  const snapshot = useSnapshot(dropId, drop.data?.phase);
  const screen = screenFor(drop.data?.phase, me.data, hasToken());

  function refreshAll() {
    drop.refresh();
    me.refresh();
    invariants.refresh();
    draw.refresh();
    snapshot.refresh();
  }

  if (drop.error && !drop.data) {
    return <main className="c-main"><p role="alert">{messageForError(drop.error)}</p></main>;
  }
  if (!drop.data) return <main className="c-main"><p role="status" style={{ paddingTop: 40 }}>Loading drop…</p></main>;

  const data = drop.data;
  const entry = me.data?.entry;
  const inventoryError = invariants.error && !invariants.data ? messageForError(invariants.error) : null;

  return (
    <div className="c-shell" data-screen={screen}>
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-nav-r" aria-label="Fair Drop links">
            <Link className="c-iconbtn" to={`/verify/${encodeURIComponent(dropId)}`}>Verify</Link>
            <Link className="c-iconbtn" to="/judges">Judges</Link>
          </nav>
        </div>
      </header>
      <main className="c-main">
        <Link to="/" className="link-back">← All drops</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingTop: 14 }}>
          <span className="c-kicker">{data.phase} · {data.allocation_mode.replaceAll('_', ' ')}</span>
          <Link className="c-sub" to={`/verify/${encodeURIComponent(dropId)}`}>Published evidence</Link>
        </div>

        {screen === 'detail' && (
          <DropDetail
            drop={data}
            invariants={invariants.data}
            entering={entering}
            onEnter={() => setEntering(true)}
            onCloseEntry={() => setEntering(false)}
            refresh={refreshAll}
            onLogin={me.refresh}
          />
        )}
        {screen === 'registered' && <Registered drop={data} />}
        {screen === 'sealed' && <Sealed drop={data} snapshot={snapshot.data} />}
        {!['detail', 'registered', 'sealed'].includes(screen) && me.data?.entry && (
          <Results
            drop={data}
            me={me.data}
            draw={draw.data}
            refresh={refreshAll}
          />
        )}
        {inventoryError && screen === 'detail' && <p role="status" className="fd-error">{inventoryError}</p>}
        {me.error && !me.data && hasToken() && <p role="alert" className="fd-error">{messageForError(me.error)}</p>}
      </main>
    </div>
  );
}
