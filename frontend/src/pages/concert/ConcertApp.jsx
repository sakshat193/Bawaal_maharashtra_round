import { useSearchParams } from 'react-router-dom';
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
  const st = useConcertStore({ queueSpeed: parseFloat(params.get('speed')) || 1, humanChecks: params.get('checks') || 'normal' });
  const { S } = st;
  const home = S.phase === 'home';
  return (
    <div className="c-shell">
      <TopNav st={st} />
      <main className="c-main">
        {home && S.tab === 'home' && <Home st={st} />}
        {home && S.tab === 'saved' && <Saved st={st} />}
        {home && S.tab === 'tickets' && <Tickets st={st} />}
        {S.phase === 'event' && <Event st={st} />}
        {S.phase === 'queue' && <Queue st={st} />}
        {S.phase === 'turn' && <Turn st={st} />}
        {S.phase === 'checkout' && <Checkout st={st} />}
        {S.phase === 'done' && <Done st={st} />}
      </main>
      {home && <TabBar st={st} />}
      <QuickView st={st} />
      {S.check && <HumanCheck st={st} />}
      <Toast msg={st.toast} />
      <Grain />
    </div>
  );
}
