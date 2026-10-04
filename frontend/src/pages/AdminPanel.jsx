import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDrops, usePoll } from '../api/hooks.js';
import { messageForError } from '../api/messages.js';
import { annotate } from '../admin/traffic.js';
import { createSubnetCloud } from '../three/subnetCloud.js';
import { isLite, prefersReduced } from '../lib/constants.js';

// A valid key answers 200 even for an unknown drop; a wrong key answers 401.
const PROBE = '/api/admin/drops/00000000-0000-0000-0000-000000000000/outcomes';
const NEXT = { scheduled: 'open', open: 'seal', sealed: 'draw' };
const LEVEL_COLOR = { red: '#F87171', amber: '#F59E0B', ok: '#67E8F9' };

const readKey = () => { try { return globalThis.sessionStorage?.getItem('fd.admin') || ''; } catch { return ''; } };
const writeKey = value => {
  try {
    if (value) globalThis.sessionStorage?.setItem('fd.admin', value);
    else globalThis.sessionStorage?.removeItem('fd.admin');
  } catch { /* storage blocked: the key just stays in memory for this tab */ }
};
const errorText = error => error?.data?.message || messageForError(error);

const localInput = date => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
};
const toIso = local => new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z');

function defaultForm() {
  const now = Date.now();
  return {
    name: '', venue: '',
    opens_at: localInput(new Date(now + 60_000)),
    closes_at: localInput(new Date(now + 3 * 86_400_000)),
    starts_at: localInput(new Date(now + 10 * 86_400_000)),
    allocation_mode: 'lottery_wil', pow_required: true, pow_bits: 8, turnstile_required: false,
    max_quantity: 4, offer_ttl_s: 600, pay_deadline_s: 300, max_promotion_rounds: 6,
    device: { on: true, limit: 2 }, payment: { on: true, limit: 2 }, age: { on: false, days: 1 },
    tiers: [
      { tier_id: 'general', name: 'General admission', price: 499, capacity: 300 },
      { tier_id: 'vip', name: 'VIP', price: 1999, capacity: 30 }
    ]
  };
}

function formToBody(f) {
  const rules = [];
  if (f.device.on) rules.push({ id: 'device', kind: 'max_per_device', limit: Number(f.device.limit) });
  if (f.payment.on) rules.push({ id: 'payment', kind: 'max_per_payment', limit: Number(f.payment.limit) });
  if (f.age.on) rules.push({ id: 'fresh', kind: 'min_account_age_s', value: Number(f.age.days) * 86400 });
  return {
    name: f.name, venue: f.venue,
    starts_at: toIso(f.starts_at), opens_at: toIso(f.opens_at), closes_at: toIso(f.closes_at),
    allocation_mode: f.allocation_mode, pow_required: f.pow_required, pow_bits: Number(f.pow_bits),
    turnstile_required: f.turnstile_required, max_quantity: Number(f.max_quantity),
    offer_ttl_s: Number(f.offer_ttl_s), pay_deadline_s: Number(f.pay_deadline_s),
    max_promotion_rounds: Number(f.max_promotion_rounds), sybil_rules: rules,
    tiers: f.tiers.map(t => ({
      tier_id: t.tier_id, name: t.name, price_paise: Math.round(Number(t.price) * 100), capacity: Number(t.capacity)
    }))
  };
}

function KeyGate({ onUnlock }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  async function submit(event) {
    event.preventDefault();
    writeKey(value);
    setState({ busy: true, error: '' });
    try {
      await api(PROBE, { admin: true });
      onUnlock();
    } catch (error) {
      writeKey('');
      setState({ busy: false, error: error?.status === 401 ? 'Admin key rejected by this server.' : errorText(error) });
    }
  }
  return (
    <form className="fd-demo-card" onSubmit={submit}>
      <h2 className="c-h2">Admin key</h2>
      <label className="fd-label">Key
        <input type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste the server's ADMIN_KEY" />
      </label>
      <div className="fd-actions">
        <button type="submit" className="btn btn-light" disabled={!value || state.busy}>{state.busy ? 'Checking…' : 'Unlock'}</button>
      </div>
      {state.error && <p role="alert" className="fd-error">{state.error}</p>}
    </form>
  );
}

function Traffic({ dropId }) {
  const load = useCallback(({ signal }) => api(`/api/admin/drops/${encodeURIComponent(dropId)}/traffic`, { signal }), [dropId]);
  const traffic = usePoll(load, [3000, 3000], Boolean(dropId), dropId);
  const rows = useMemo(() => annotate(traffic.data?.subnets), [traffic.data]);
  const host = useRef(null);
  const engine = useRef(null);
  const lite = isLite();

  useEffect(() => {
    if (lite) return undefined;
    engine.current = createSubnetCloud(host.current, { reduced: prefersReduced() });
    return () => { engine.current?.dispose(); engine.current = null; };
  }, [lite]);
  useEffect(() => { engine.current?.setData(rows); }, [rows]);

  return (
    <section className="fd-demo-card">
      <h2 className="c-h2">Traffic by subnet</h2>
      <p className="c-sub">Admin-only hint: each cluster is one /24 (IPv6 /48). Shared Wi-Fi looks like a cluster too, so nothing here changes the draw.</p>
      {!lite && <div ref={host} className="fd-judge-canvas" role="img" aria-label={`${rows.length} subnets, ${traffic.data?.total ?? 0} entries`} />}
      {traffic.error && <p role="alert" className="fd-error">{errorText(traffic.error)}</p>}
      {traffic.data && (
        <p className="c-sub">{traffic.data.total} entries · {rows.length} subnets · {traffic.data.sealed ? 'sealed (red = rule fired)' : 'live (red appears after the seal)'}</p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Subnet</th><th>Entries</th><th>Devices</th><th>Payments</th><th>Excluded</th><th>Markers</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.subnet}>
                <td style={{ color: LEVEL_COLOR[row.level] }}>{row.subnet}</td>
                <td>{row.entries}</td><td>{row.devices}</td><td>{row.payments}</td><td>{row.excluded}</td>
                <td>{row.markers.map(m => <span key={m.text} style={{ color: LEVEL_COLOR[m.level], marginRight: 8 }}>{m.text}</span>)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="6">No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CreateForm({ onCreated }) {
  const [form, setForm] = useState(defaultForm);
  const [state, setState] = useState({ busy: false, error: '' });
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const setNested = (key, patch) => setForm(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const setTier = (index, patch) => set('tiers', form.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true, error: '' });
    try {
      const drop = await api('/api/admin/drops', { method: 'POST', body: formToBody(form), admin: true });
      setState({ busy: false, error: '' });
      onCreated(drop);
      setForm(defaultForm());
    } catch (error) {
      setState({ busy: false, error: errorText(error) });
    }
  }

  const num = (key, label) => (
    <label className="fd-label">{label}
      <input type="number" min="0" value={form[key]} onChange={e => set(key, e.target.value)} />
    </label>
  );

  return (
    <form className="fd-demo-card" onSubmit={submit}>
      <h2 className="c-h2">Create a drop</h2>
      <label className="fd-label">Name<input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
      <label className="fd-label">Venue<input required value={form.venue} onChange={e => set('venue', e.target.value)} /></label>
      <label className="fd-label">Registration opens<input type="datetime-local" required value={form.opens_at} onChange={e => set('opens_at', e.target.value)} /></label>
      <label className="fd-label">Registration closes<input type="datetime-local" required value={form.closes_at} onChange={e => set('closes_at', e.target.value)} /></label>
      <label className="fd-label">Event starts<input type="datetime-local" required value={form.starts_at} onChange={e => set('starts_at', e.target.value)} /></label>
      <label className="fd-label">Allocation
        <select value={form.allocation_mode} onChange={e => set('allocation_mode', e.target.value)}>
          <option value="lottery_wil">Fair lottery</option>
          <option value="fcfs">First come, first served</option>
        </select>
      </label>
      {num('max_quantity', 'Max tickets per person')}
      {num('offer_ttl_s', 'Offer time limit (s)')}
      {num('pay_deadline_s', 'Payment window (s)')}
      {num('max_promotion_rounds', 'Promotion rounds')}
      <label className="fd-label"><span><input type="checkbox" checked={form.pow_required} onChange={e => set('pow_required', e.target.checked)} /> Proof of work</span>
        <input type="number" min="1" value={form.pow_bits} disabled={!form.pow_required} onChange={e => set('pow_bits', e.target.value)} aria-label="Proof of work bits" />
      </label>
      <label className="fd-label"><span><input type="checkbox" checked={form.turnstile_required} onChange={e => set('turnstile_required', e.target.checked)} /> Human check (Turnstile)</span></label>

      <fieldset>
        <legend className="fd-label">Sybil rules</legend>
        <label className="fd-label"><span><input type="checkbox" checked={form.device.on} onChange={e => setNested('device', { on: e.target.checked })} /> Max entries per device</span>
          <input type="number" min="1" value={form.device.limit} onChange={e => setNested('device', { limit: e.target.value })} /></label>
        <label className="fd-label"><span><input type="checkbox" checked={form.payment.on} onChange={e => setNested('payment', { on: e.target.checked })} /> Max entries per payment method</span>
          <input type="number" min="1" value={form.payment.limit} onChange={e => setNested('payment', { limit: e.target.value })} /></label>
        <label className="fd-label"><span><input type="checkbox" checked={form.age.on} onChange={e => setNested('age', { on: e.target.checked })} /> Minimum account age (days)</span>
          <input type="number" min="0" value={form.age.days} onChange={e => setNested('age', { days: e.target.value })} /></label>
      </fieldset>

      <fieldset>
        <legend className="fd-label">Tiers</legend>
        {form.tiers.map((tier, index) => (
          <div className="fd-actions" key={index}>
            <input required placeholder="id" aria-label="Tier id" value={tier.tier_id} onChange={e => setTier(index, { tier_id: e.target.value })} />
            <input required placeholder="name" aria-label="Tier name" value={tier.name} onChange={e => setTier(index, { name: e.target.value })} />
            <input required type="number" min="0" step="0.01" aria-label="Price in rupees" value={tier.price} onChange={e => setTier(index, { price: e.target.value })} />
            <input required type="number" min="1" aria-label="Capacity" value={tier.capacity} onChange={e => setTier(index, { capacity: e.target.value })} />
            <button type="button" className="btn btn-ghost" disabled={form.tiers.length < 2} onClick={() => set('tiers', form.tiers.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => set('tiers', [...form.tiers, { tier_id: '', name: '', price: 0, capacity: 100 }])}>Add tier</button>
      </fieldset>

      <div className="fd-actions">
        <button type="submit" className="btn btn-light" disabled={state.busy}>{state.busy ? 'Creating…' : 'Create drop'}</button>
      </div>
      {state.error && <p role="alert" className="fd-error">{state.error}</p>}
    </form>
  );
}

function Console({ onLock }) {
  const drops = useDrops();
  const list = drops.data?.drops || [];
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [trafficId, setTrafficId] = useState('');

  async function run(label, path, method = 'POST') {
    setBusy(label);
    setNotice('');
    setError('');
    try {
      const result = await api(path, { method, admin: true });
      drops.refresh();
      return result;
    } catch (failure) {
      if (failure?.status === 401) onLock();
      setError(errorText(failure));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function seed() {
    const r = await run('seed', '/api/admin/catalog');
    if (r) setNotice(`Catalog: ${r.created} created, ${r.skipped} already there, ${r.opened} opened.`);
  }

  async function step(drop) {
    if (drop.phase === 'drawn') {
      const r = await run(drop.drop_id, `/api/admin/drops/${drop.drop_id}/outcomes`, 'GET');
      if (r) setNotice(`${drop.name}: ${r.outcomes?.length ?? 0} outcomes.`);
      return;
    }
    const action = NEXT[drop.phase];
    const r = await run(drop.drop_id, `/api/admin/drops/${drop.drop_id}/${action}`);
    if (r) setNotice(`${drop.name}: ${action} done.`);
  }

  return (
    <>
      <section className="fd-demo-card">
        <h2 className="c-h2">Catalog</h2>
        <p className="c-sub">Seeds the same 60 demo events as scripts/seed_catalog.py. Safe to repeat.</p>
        <div className="fd-actions">
          <button type="button" className="btn btn-light" disabled={Boolean(busy)} onClick={seed}>{busy === 'seed' ? 'Seeding…' : 'Seed catalog'}</button>
          <button type="button" className="btn btn-ghost" onClick={onLock}>Lock</button>
        </div>
        {notice && <p role="status" className="fd-demo-notice">{notice}</p>}
        {error && <p role="alert" className="fd-error">{error}</p>}
      </section>

      <section className="fd-demo-card">
        <h2 className="c-h2">Drops ({list.length})</h2>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Phase</th><th>Action</th><th>Links</th></tr></thead>
            <tbody>
              {list.map(drop => (
                <tr key={drop.drop_id}>
                  <td>{drop.name}</td>
                  <td>{drop.phase}</td>
                  <td>
                    {(NEXT[drop.phase] || drop.phase === 'drawn') && (
                      <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => step(drop)}>
                        {busy === drop.drop_id ? '…' : drop.phase === 'drawn' ? 'Outcomes' : NEXT[drop.phase]}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => setTrafficId(drop.drop_id)}>Traffic</button>
                  </td>
                  <td><Link to={`/drops/${drop.drop_id}`}>Open</Link> · <Link to={`/verify/${drop.drop_id}`}>Verify</Link></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan="4">No drops yet. Seed the catalog or create one below.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {trafficId && <Traffic dropId={trafficId} />}
      <CreateForm onCreated={drop => { drops.refresh(); setTrafficId(drop.drop_id); setNotice(`Created ${drop.name}.`); }} />
    </>
  );
}

export default function AdminPanel() {
  const [unlocked, setUnlocked] = useState(null);

  // A key kept in this tab's sessionStorage is re-checked once; a stale one just shows the gate.
  useEffect(() => {
    if (!readKey()) { setUnlocked(false); return; }
    api(PROBE, { admin: true }).then(() => setUnlocked(true), () => { writeKey(''); setUnlocked(false); });
  }, []);

  const lock = () => { writeKey(''); setUnlocked(false); };

  return (
    <div className="c-shell">
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-nav-r" aria-label="Fair Drop links">
            <Link className="c-iconbtn" to="/demo">Demo</Link>
            <Link className="c-iconbtn" to="/verify">Verify</Link>
          </nav>
        </div>
      </header>
      <main className="c-main fd-demo">
        <div className="fd-dashboard-title">
          <div><p className="c-kicker">Operator console</p><h1 className="c-title">Admin</h1></div>
        </div>
        {unlocked === null && <p role="status">Checking admin key…</p>}
        {unlocked === false && <KeyGate onUnlock={() => setUnlocked(true)} />}
        {unlocked && <Console onLock={lock} />}
      </main>
    </div>
  );
}
