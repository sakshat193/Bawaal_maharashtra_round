import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { messageForError } from '../api/messages.js';
import { solvePow } from '../pow/index.js';
import Turnstile from './Turnstile.jsx';
import { createEntryBody } from './flow.js';

const powKey = dropId => `fd.pow.${dropId}`;

function readPow(dropId) {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(powKey(dropId)) || 'null');
    if (value && typeof value.challenge === 'string' && Array.isArray(value.nonces)) return value;
  } catch {
    // A broken saved progress record can be replaced by a fresh challenge.
  }
  return null;
}

function hasToken() {
  try {
    return Boolean(globalThis.sessionStorage?.getItem('fd.jwt'));
  } catch {
    return false;
  }
}

function savePow(dropId, value) {
  try {
    globalThis.sessionStorage?.setItem(powKey(dropId), JSON.stringify(value));
  } catch {
    // The form remains usable if storage is disabled; reload recovery needs it.
  }
}

function clearPow(dropId) {
  try {
    globalThis.sessionStorage?.removeItem(powKey(dropId));
  } catch {
    // Entry submission remains authoritative.
  }
}

export default function EntryForm({ drop, tier, quantity, onClose, refresh, onLogin }) {
  const [username, setUsername] = useState('');
  const [signedIn, setSignedIn] = useState(hasToken);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [powState, setPowState] = useState(() => readPow(drop.drop_id));
  const [solved, setSolved] = useState(() => readPow(drop.drop_id)?.nonces?.length || 0);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const controller = useRef(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api('/platform/login', { method: 'POST', body: { username: username.trim() } });
      globalThis.sessionStorage?.setItem('fd.jwt', result.token);
      setSignedIn(true);
      onLogin?.();
    } catch (reason) {
      setError(messageForError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runPow() {
    setBusy(true);
    setError(null);
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    try {
      const challenge = await api(`/api/drops/${encodeURIComponent(drop.drop_id)}/pow-challenge`, { signal: activeController.signal });
      const saved = readPow(drop.drop_id);
      const prior = saved?.challenge === challenge.challenge && saved?.issued_at === challenge.issued_at
        ? saved.nonces.slice(0, challenge.k)
        : [];
      const initial = { challenge: challenge.challenge, issued_at: challenge.issued_at, nonces: prior };
      setPowState(initial);
      setSolved(prior.length);
      savePow(drop.drop_id, initial);
      const nonces = await solvePow({ ...challenge, startIndex: prior.length, prior }, progress => {
        const next = { challenge: challenge.challenge, issued_at: challenge.issued_at, nonces: progress.nonces };
        savePow(drop.drop_id, next);
        setPowState(next);
        setSolved(progress.solved);
      }, activeController.signal);
      const complete = { challenge: challenge.challenge, issued_at: challenge.issued_at, nonces };
      savePow(drop.drop_id, complete);
      setPowState(complete);
      setSolved(nonces.length);
    } catch (reason) {
      if (reason?.name !== 'AbortError') setError(messageForError(reason));
    } finally {
      if (controller.current === activeController) controller.current = null;
      setBusy(false);
    }
  }

  async function submitEntry() {
    setBusy(true);
    setError(null);
    try {
      const request = createEntryBody({
        tierId: tier.tier_id,
        quantity,
        turnstileToken: drop.turnstile_required ? turnstileToken : null,
        issuedAt: powState?.issued_at,
        nonces: powState?.nonces || []
      });
      const receipt = await api(`/api/drops/${encodeURIComponent(drop.drop_id)}/entries`, {
        method: 'POST',
        body: request
      });
      globalThis.sessionStorage?.setItem(`fd.receipt.${drop.drop_id}`, JSON.stringify(receipt));
      clearPow(drop.drop_id);
      setSubmitted(true);
      refresh();
    } catch (reason) {
      setError(messageForError(reason));
    } finally {
      setBusy(false);
    }
  }

  const powReady = !drop.pow_required || solved >= (drop.pow_k || 0);
  const turnstileReady = !drop.turnstile_required || Boolean(turnstileToken);
  const canSubmit = signedIn && turnstileReady && powReady && !busy && !submitted;

  return (
    <section className="fd-entry" aria-labelledby="entry-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <h2 id="entry-title" className="c-h2">Enter the draw</h2>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="c-sub">{quantity} × {tier.name}. Everyone who wants a ticket enters individually.</p>

      {!signedIn && (
        <form onSubmit={login} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
          <label className="fd-label">Mock sign in
            <input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="Your username" />
          </label>
          <button className="btn btn-light" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
        </form>
      )}

      {signedIn && drop.turnstile_required && <Turnstile onToken={setTurnstileToken} />}

      {signedIn && drop.pow_required && (
        <div className="fd-check">
          <span>Proof of work · {solved}/{drop.pow_k} ticks</span>
          <div role="progressbar" aria-label="Proof of work progress" aria-valuemin="0" aria-valuemax={drop.pow_k} aria-valuenow={solved} className="fd-progress">
            <span style={{ width: `${drop.pow_k ? Math.min(100, solved / drop.pow_k * 100) : 0}%` }} />
          </div>
          <button type="button" className="btn btn-ghost" disabled={busy || powReady} onClick={runPow}>
            {busy ? 'Working…' : powReady ? 'Proof complete' : solved ? 'Resume proof of work' : 'Start proof of work'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="fd-error">{error}</p>}
      {submitted && <p role="status">Entry submitted. Waiting for the server receipt…</p>}
      <button type="button" className="btn btn-violet" disabled={!canSubmit} onClick={submitEntry}>
        {busy ? 'Submitting…' : 'Submit entry'}
      </button>
    </section>
  );
}
