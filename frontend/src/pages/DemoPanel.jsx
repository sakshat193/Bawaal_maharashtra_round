import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDrop, useDrops } from '../api/hooks.js';
import { messageForError, RULE_TEXT } from '../api/messages.js';
import { MOCK_SCENARIOS } from '../api/scenarios.js';
import { isLite } from '../lib/constants.js';

const PHASE_AFTER = { open: 'open', seal: 'sealed', draw: 'drawn' };
const ERROR_FIXTURES = Object.keys(import.meta.glob('../../../contracts/fixtures/*.4??.*.json'))
  .map(path => path.slice(path.lastIndexOf('/') + 1))
  .filter(name => Number(name.match(/\.(\d{3})\./)?.[1]) >= 400)
  .sort();

function sessionValue(key) {
  try { return globalThis.sessionStorage?.getItem(key) || ''; } catch { return ''; }
}

function saveSession(key, value) {
  try {
    if (value) globalThis.sessionStorage?.setItem(key, value);
    else globalThis.sessionStorage?.removeItem(key);
  } catch {
    // Demo controls can still be read when this browser blocks storage.
  }
}

export default function DemoPanel() {
  const drops = useDrops();
  const dropList = drops.data?.drops || [];
  const [dropId, setDropId] = useState('');
  const selectedDropId = dropId || dropList[0]?.drop_id || '';
  const drop = useDrop(selectedDropId);
  const [adminKey, setAdminKey] = useState(() => sessionValue('fd.admin'));
  const [scenario, setScenario] = useState(() => sessionValue('fd.scenario') || 'none');
  const [nextError, setNextError] = useState(() => sessionValue('fd.nextError'));
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const lite = isLite();

  async function run(action) {
    if (!selectedDropId && action !== 'reset') return;
    setBusy(action);
    setNotice(null);
    setRequestError(null);
    const endpoint = action === 'reset'
      ? '/api/admin/reset'
      : `/api/admin/drops/${encodeURIComponent(selectedDropId)}/${action}`;
    try {
      const result = await api(endpoint, { method: 'POST', admin: true });
      const message = action === 'reset'
        ? 'The demo drop was reset.'
        : `${result.name || drop.data?.name || 'The drop'} is now ${result.phase || PHASE_AFTER[action]}.`;
      setNotice(message);
      if (action === 'reset') setScenario('none');
      drop.refresh();
      drops.refresh();
    } catch (error) {
      setRequestError(messageForError(error));
    } finally {
      setBusy('');
    }
  }

  function changeScenario(value) {
    setScenario(value);
    saveSession('fd.scenario', value);
    drop.refresh();
    drops.refresh();
  }

  function changeNextError(value) {
    setNextError(value);
    saveSession('fd.nextError', value);
  }

  return (
    <div className="c-shell">
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-nav-r" aria-label="Fair Drop links">
            <Link className="c-iconbtn" to="/judges">Judges</Link>
            <Link className="c-iconbtn" to="/verify">Verify</Link>
          </nav>
        </div>
      </header>
      <main className="c-main fd-demo">
        <div className="fd-dashboard-title">
          <div><p className="c-kicker">Presenter controls</p><h1 className="c-title">Demo panel</h1></div>
          <Link to={`/demo${lite ? '' : '?lite=1'}`} className="btn btn-ghost">{lite ? 'Enable 3D scenes' : 'Use lite scenes'}</Link>
        </div>

        <section className="fd-demo-card">
          <h2 className="c-h2">Drop controls</h2>
          <label className="fd-label">Drop
            <select value={selectedDropId} onChange={event => setDropId(event.target.value)} disabled={!dropList.length}>
              {dropList.map(item => <option key={item.drop_id} value={item.drop_id}>{item.name} · {item.phase}</option>)}
            </select>
          </label>
          <label className="fd-label">Admin key
            <input type="password" autoComplete="off" value={adminKey} onChange={event => {
              setAdminKey(event.target.value);
              saveSession('fd.admin', event.target.value);
            }} placeholder="Paste the admin key" />
          </label>
          <div className="fd-actions">
            {['open', 'seal', 'draw'].map(action => (
              <button key={action} type="button" className="btn btn-light" disabled={!adminKey || !selectedDropId || Boolean(busy)} onClick={() => run(action)}>
                {busy === action ? `${action}…` : action[0].toUpperCase() + action.slice(1)}
              </button>
            ))}
            <button type="button" className="btn btn-ghost" disabled={!adminKey || Boolean(busy)} onClick={() => run('reset')}>
              {busy === 'reset' ? 'Resetting…' : 'Reset'}
            </button>
          </div>
          {notice && <p role="status" className="fd-demo-notice">{notice}</p>}
          {requestError && <p role="alert" className="fd-error">{requestError}</p>}
          {drop.error && !drop.data && <p role="alert" className="fd-error">{messageForError(drop.error)}</p>}
        </section>

        <section className="fd-demo-card">
          <h2 className="c-h2">Live settings</h2>
          {drop.data ? (
            <>
              <div className="fd-facts">
                <div><span>Offer time limit</span><b>{drop.data.offer_ttl_s} seconds</b></div>
                <div><span>Payment window</span><b>{drop.data.pay_deadline_s} seconds</b></div>
                <div><span>Promotion rounds</span><b>{drop.data.max_promotion_rounds}</b></div>
                <div><span>Proof of work</span><b>{drop.data.pow_required ? `${drop.data.pow_bits} bits · k=${drop.data.pow_k} · ${drop.data.pow_memory_kib} KiB` : 'Not required'}</b></div>
              </div>
              <div className="fd-fair">
                <h3>Published Sybil rules</h3>
                <ul>{drop.data.sybil_rules.map(rule => <li key={rule.id}>{RULE_TEXT(rule)}</li>)}</ul>
              </div>
            </>
          ) : <p role="status">Loading drop settings…</p>}
        </section>

        {import.meta.env.VITE_MSW === '1' && (
          <section className="fd-demo-card">
            <h2 className="c-h2">Mock scenarios</h2>
            <p className="c-sub">Choose a server fixture state or inject one error into the next matching request.</p>
            <label className="fd-label">Scenario
              <select value={scenario} onChange={event => changeScenario(event.target.value)}>
                {Object.keys(MOCK_SCENARIOS).map(name => <option key={name} value={name}>{name.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
            <label className="fd-label">Next error
              <select value={nextError} onChange={event => changeNextError(event.target.value)}>
                <option value="">No injected error</option>
                {ERROR_FIXTURES.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </section>
        )}
      </main>
    </div>
  );
}
