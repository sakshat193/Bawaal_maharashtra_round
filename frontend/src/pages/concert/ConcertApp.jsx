import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client.js';
import { useConcertStore } from './store.js';
import { Home, Saved, Tickets } from './Home.jsx';
import { Event, Queue, Turn, Checkout, Done } from './Flow.jsx';
import { TopNav, TabBar, QuickView, HumanCheck, Toast } from './Overlays.jsx';
import Grain from '../../components/Grain.jsx';

/**
 * Consumer ticketing app. Responsive: top nav + split layouts ≥900px,
 * bottom tab bar, bottom sheets and sticky buy bar below.
 * URL options: ?speed=2 (queue speed) · ?checks=off|normal|frequent · ?lite=1 (no 3D)
 */
export default function ConcertApp() {
  const [params] = useSearchParams();
  const paymentTest = params.get('paymentTest') === '1';
  const explicitDropId = params.get('drop') || import.meta.env.VITE_DROP_ID || '';
  const [discoveredDropId, setDiscoveredDropId] = useState(() => {
    try { return sessionStorage.getItem('fairdrop.drop_id') || ''; } catch { return ''; }
  });
  const [dropDiscoveryError, setDropDiscoveryError] = useState('');
  const dropId = explicitDropId || discoveredDropId;

  useEffect(() => {
    if (paymentTest) return undefined;
    if (explicitDropId) {
      setDiscoveredDropId(explicitDropId);
      return undefined;
    }
    if (discoveredDropId) return undefined;

    let active = true;
    apiRequest('/api/drops')
      .then(result => {
        const drops = result.drops || [];
        const selected = drops.find(drop => drop.phase === 'open') || drops.find(drop => drop.phase === 'scheduled');
        if (!selected) {
          setDropDiscoveryError('There are no active ticket drops right now.');
          return;
        }
        try { sessionStorage.setItem('fairdrop.drop_id', selected.drop_id); } catch { /* optional cache */ }
        if (active) {
          setDropDiscoveryError('');
          setDiscoveredDropId(selected.drop_id);
        }
      })
      .catch(error => {
        if (active) setDropDiscoveryError(error.message || 'Could not connect to ticket drops.');
      });
    return () => { active = false; };
  }, [explicitDropId, discoveredDropId, paymentTest]);

  const st = useConcertStore({ queueSpeed: parseFloat(params.get('speed')) || 1, humanChecks: params.get('checks') || 'normal', dropId, paymentTest });
  const { S } = st;
  const viewState = dropDiscoveryError && !dropId
    ? { ...st, apiDropError: dropDiscoveryError }
    : st;
  const home = S.phase === 'home';
  return (
    <div className="c-shell">
      <TopNav st={st} />
      <main className="c-main">
        {home && S.tab === 'home' && <Home st={st} />}
        {home && S.tab === 'saved' && <Saved st={st} />}
        {home && S.tab === 'tickets' && <Tickets st={st} />}
        {S.phase === 'event' && <Event st={viewState} />}
        {S.phase === 'queue' && <Queue st={viewState} />}
        {S.phase === 'turn' && <Turn st={viewState} />}
        {S.phase === 'checkout' && <Checkout st={viewState} />}
        {S.phase === 'done' && <Done st={viewState} />}
      </main>
      {home && <TabBar st={st} />}
      <QuickView st={st} />
      {S.check && <HumanCheck st={st} />}
      <Toast msg={st.toast} />
      <Grain />
    </div>
  );
}
