import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDrop, useDrops } from '../api/hooks.js';
import { createBloom } from '../three/hashBloom.js';
import { isLite, prefersReduced } from '../lib/constants.js';
import Verifier from '../verify/index.js';

function EvidenceBloom({ hash }) {
  const host = useRef(null);
  const lite = isLite();

  useEffect(() => {
    if (lite || !hash || !host.current) return undefined;
    const bloom = createBloom(host.current, hash, { reduced: prefersReduced() });
    bloom.setInput(hash, true);
    return () => bloom.dispose();
  }, [hash, lite]);

  if (lite) return <div className="fd-verify-bloom-lite" aria-hidden="true"><i /></div>;
  return <div ref={host} className="fd-verify-bloom" aria-hidden="true" />;
}

export default function Verify() {
  const { dropId } = useParams();
  const drops = useDrops();
  const defaultDropId = drops.data?.drops?.[0]?.drop_id;
  const selectedDropId = dropId || defaultDropId;
  const drop = useDrop(selectedDropId);
  const hash = drop.data?.snapshot?.canonical_hash || drop.data?.config_hash;

  return (
    <div className="c-shell">
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-nav-r" aria-label="Fair Drop links">
            {selectedDropId && <Link className="c-iconbtn" to={`/drops/${encodeURIComponent(selectedDropId)}`}>The drop</Link>}
            <Link className="c-iconbtn" to="/judges">Judges</Link>
          </nav>
        </div>
      </header>
      <main className="c-main fd-verify-page">
        <EvidenceBloom hash={hash} />
        <div className="fd-verify-content">
          <p className="c-kicker">Public evidence</p>
          {selectedDropId
            ? <Verifier dropId={selectedDropId} />
            : <p role="status">Loading drops…</p>}
        </div>
      </main>
    </div>
  );
}
