import { useState } from 'react';
import { Link } from 'react-router-dom';
import Grain from '../../components/Grain.jsx';
import { useDrops } from '../../api/hooks.js';
import { messageForError } from '../../api/messages.js';
import { Home, Saved } from './Home.jsx';

export default function ConcertApp() {
  const { data, error } = useDrops();
  const [tab, setTab] = useState('home');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState({});
  const drops = Array.isArray(data?.drops) ? data.drops : [];
  const toggleSave = dropId => setSaved(current => ({ ...current, [dropId]: !current[dropId] }));

  return (
    <div className="c-shell">
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-tabs only-d" aria-label="Main navigation">
            <button className={`c-tab${tab === 'home' ? ' on' : ''}`} onClick={() => setTab('home')}>Home</button>
            <button className={`c-tab${tab === 'saved' ? ' on' : ''}`} onClick={() => setTab('saved')}>Saved</button>
          </nav>
          <label className="c-search only-d">
            <span className="lens" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search drops and venues" />
          </label>
          <div className="c-nav-r">
            <Link className="c-iconbtn" to="/demo">Demo</Link>
          </div>
        </div>
        <div className="c-search only-m" style={{ maxWidth: 'none', width: 'auto', margin: '0 var(--pad) 12px' }}>
          <span className="lens" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search drops and venues" />
        </div>
      </header>
      <main className="c-main">
        {error && !data && <p role="alert">{messageForError(error)}</p>}
        {!data && !error && <p role="status" style={{ padding: '40px 0' }}>Loading drops…</p>}
        {data && tab === 'home' && <Home drops={drops} saved={saved} onToggleSave={toggleSave} query={query} />}
        {data && tab === 'saved' && <Saved drops={drops} saved={saved} onToggleSave={toggleSave} query={query} />}
      </main>
      <nav className="c-tabbar only-m" aria-label="Main navigation">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}><i />Home</button>
        <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}><i />Saved</button>
      </nav>
      <Grain />
    </div>
  );
}
