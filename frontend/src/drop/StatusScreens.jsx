import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, serverNow } from '../api/client.js';
import { messageForError, RULE_TEXT } from '../api/messages.js';
import { formatCountdown, formatPaise, getOrCreateOrderId, readAcceptedEntry, razorpayPaymentBody } from './flow.js';
import DrumHero from '../three/DrumHero.jsx';

let razorpayScript;
let checkoutUnavailable = false;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScript) return razorpayScript;
  razorpayScript = new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not initialize.'));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
    document.head.appendChild(script);
  }).catch(reason => { razorpayScript = null; throw reason; });
  return razorpayScript;
}

function isCheckoutUnavailable() {
  try { return checkoutUnavailable || Boolean(globalThis.sessionStorage?.getItem('fd.razorpay.unavailable')); }
  catch { return checkoutUnavailable; }
}

function useCountdown(deadline) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  return formatCountdown(deadline, now);
}

function ScreenFrame({ eyebrow, title, children }) {
  return (
    <section className="fd-state fade-in">
      <p className="c-kicker">{eyebrow}</p>
      <h1 className="c-title">{title}</h1>
      {children}
    </section>
  );
}

export function Registered({ drop, receiptResponse = readAcceptedEntry(drop.drop_id) }) {
  const receipt = receiptResponse?.receipt;
  const signature = receiptResponse?.receipt_sig || '';
  const closesIn = useCountdown(drop.closes_at);
  const [copied, setCopied] = useState(false);

  async function copyReceipt() {
    if (!receiptResponse) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(receiptResponse));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <ScreenFrame eyebrow="Entry received" title="You're in the draw.">
      <p className="fd-lead">Everyone who wants a ticket enters individually.</p>
      <div className="fd-state-grid">
        <div><span>Entries received</span><b>{drop.counts.entries.toLocaleString('en-IN')}</b></div>
        <div><span>Registration closes in</span><b className="mono">{closesIn}</b></div>
      </div>
      {receipt && (
        <div className="fd-receipt">
          <div className="fd-state-grid">
            <div><span>Tier</span><b>{receipt.tier_id} × {receipt.quantity}</b></div>
            <div><span>Accepted</span><b>{new Date(receipt.accepted_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div>
          </div>
          <div><span>Signed receipt</span><code>{signature ? `${signature.slice(0, 18)}…${signature.slice(-10)}` : 'Receipt signature unavailable on this device'}</code></div>
          <button type="button" className="btn btn-ghost" onClick={copyReceipt} disabled={!receiptResponse}>{copied ? 'Copied' : 'Copy receipt'}</button>
        </div>
      )}
      <DrumHero entries={drop.counts.entries} phase="filling" />
    </ScreenFrame>
  );
}

export function Sealed({ drop, snapshot }) {
  const countdown = useCountdown(drop.drand_round_due_at);
  const headers = snapshot?.headers;
  const timestampedAt = headers?.get('X-Fairdrop-Timestamped-At');
  const timestampProof = headers?.get('X-Fairdrop-Timestamp-Proof');
  return (
    <ScreenFrame eyebrow="Entries sealed" title="The list is locked.">
      <div className="fd-state-grid">
        <div><span>Excluded entries</span><b>{drop.counts.excluded === null ? 'Not published' : drop.counts.excluded.toLocaleString('en-IN')}</b></div>
        <div><span>Drand round {drop.drand_round.toLocaleString('en-IN')} in</span><b className="mono">{countdown}</b></div>
      </div>
      <div className="fd-proof">
        <div><span>Snapshot SHA-256</span><code>{headers?.get('X-Fairdrop-Snapshot-Sha256') || 'Loading proof…'}</code></div>
        <div><span>Exclusions SHA-256</span><code>{headers?.get('X-Fairdrop-Exclusions-Sha256') || 'Loading proof…'}</code></div>
        <div><span>Sealed at</span><code>{headers?.get('X-Fairdrop-Sealed-At') || 'Loading proof…'}</code></div>
        <div><span>Timestamped at</span><code>{timestampedAt || 'Not timestamped yet'}</code></div>
        {timestampProof && <details><summary>Timestamp proof</summary><code>{timestampProof}</code></details>}
      </div>
      <DrumHero entries={drop.counts.entries} phase="sealed" label="Sealed entry pool" />
      <Link className="btn btn-ghost" to={`/verify/${encodeURIComponent(drop.drop_id)}`}>Verify published evidence</Link>
    </ScreenFrame>
  );
}

const STATUS_COPY = Object.freeze({
  expired: 'Your offer expired before it was redeemed. Those tickets moved to the next eligible entry.',
  declined: 'You declined this offer. Those tickets moved to the next eligible entry.',
  not_selected: 'This entry was not selected in the draw.',
  payment_failed: 'Your payment did not complete. Those tickets moved to the next eligible entry.'
});

export function Results({ drop, me, draw, refresh }) {
  const [hideRazorpay, setHideRazorpay] = useState(isCheckoutUnavailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const entry = me.entry;
  const offer = me.offer;
  const offerCountdown = useCountdown(offer?.expires_at);
  const payCountdown = useCountdown(offer?.pay_deadline);
  const tier = drop.tiers.find(item => item.tier_id === entry.tier_id);
  let orderId = null;
  try { orderId = offer ? offer.order_id || globalThis.sessionStorage?.getItem(`fd.order.${offer.offer_id}`) : null; } catch { /* Use the supported device-recovery screen. */ }
  const winners = draw?.allocation?.length || 0;

  async function mutate(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (reason) {
      setError(messageForError(reason));
    } finally {
      setBusy(false);
    }
  }

  const buy = () => mutate(async () => {
    const id = getOrCreateOrderId(offer.offer_id);
    await api(`/api/offers/${encodeURIComponent(offer.offer_id)}/redeem`, { method: 'POST', body: { order_id: id } });
  });
  const decline = () => mutate(() => api(`/api/offers/${encodeURIComponent(offer.offer_id)}/decline`, { method: 'POST' }));
  const pay = result => mutate(async () => {
    const id = orderId || globalThis.sessionStorage?.getItem(`fd.order.${offer.offer_id}`);
    if (!id) throw new Error('order_not_available');
    await api(`/api/offers/${encodeURIComponent(offer.offer_id)}/pay`, { method: 'POST', body: { order_id: id, result } });
  });

  async function startRazorpay() {
    setBusy(true);
    setError(null);
    let checkout;
    try {
      checkout = await api(`/api/offers/${encodeURIComponent(offer.offer_id)}/checkout`, {method:'POST'});
    } catch (reason) {
      checkoutUnavailable = true;
      setHideRazorpay(true);
      try { globalThis.sessionStorage?.setItem('fd.razorpay.unavailable','1'); } catch { /* Memory preserves the session flag. */ }
      setError(messageForError(reason));
      setBusy(false);
      return;
    }
    try {
      await loadRazorpay();
      const payment = new window.Razorpay({
        key:checkout.key_id, order_id:checkout.provider_order_id, amount:checkout.amount_paise, currency:checkout.currency,
        handler: result => mutate(async () => {
          const id = orderId || globalThis.sessionStorage?.getItem(`fd.order.${offer.offer_id}`);
          await api(`/api/offers/${encodeURIComponent(offer.offer_id)}/pay`, {method:'POST',body:razorpayPaymentBody(id,result)});
        }),
        modal:{ondismiss:()=>setBusy(false)}
      });
      payment.on?.('payment.failed',()=>{setError('Card payment did not complete. You can try again within the payment window.');setBusy(false);});
      payment.open();
    } catch (reason) {
      setError(messageForError(reason));
      setBusy(false);
    }
  }

  if (entry.status === 'offered') {
    return (
      <ScreenFrame eyebrow={`Round ${offer?.round ?? '—'} · Rank ${entry.rank?.toLocaleString('en-IN') ?? '—'}`} title="A ticket is held for you.">
        <div className="fd-state-grid">
          <div><span>{tier?.name || offer?.tier_id} · {offer?.quantity} ticket(s)</span><b>{formatPaise(offer?.amount_paise)}</b></div>
          <div><span>Offer expires in</span><b className="mono">{offerCountdown}</b></div>
        </div>
        <div className="fd-actions">
          <button className="btn btn-amber" disabled={busy} onClick={buy}>{busy ? 'Opening checkout…' : 'Buy tickets'}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={decline}>Decline offer</button>
        </div>
        <p className="c-sub">Payment must finish within {drop.pay_deadline_s} seconds after you press Buy.</p>
        {error && <p role="alert" className="fd-error">{error}</p>}
        <DrawSummary entries={drop.counts.entries} winners={winners} phase="draw" />
      </ScreenFrame>
    );
  }

  if (entry.status === 'payment_pending') {
    if (!orderId) {
      return <ScreenFrame eyebrow="Payment pending" title="Finish paying on the device where you pressed Buy."><p className="fd-lead">This offer is tied to the order id stored on that device.</p></ScreenFrame>;
    }
    return (
      <ScreenFrame eyebrow="Payment pending" title="Complete your payment.">
        <div className="fd-state-grid"><div><span>Payment deadline</span><b className="mono">{payCountdown}</b></div><div><span>Order</span><b className="mono">{orderId}</b></div></div>
        <div className="fd-actions">
          <button className="btn btn-amber" disabled={busy} onClick={() => pay('success')}>Succeed payment</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => pay('fail')}>Fail payment</button>
          {!hideRazorpay && <button className="btn btn-ghost" disabled={busy} onClick={startRazorpay}>Pay with Razorpay (test)</button>}
        </div>
        {error && <p role="alert" className="fd-error">{error}</p>}
        <DrawSummary entries={drop.counts.entries} winners={winners} phase="won" />
      </ScreenFrame>
    );
  }

  if (entry.status === 'confirmed') {
    const order = orderId || 'Order id unavailable on this device';
    return (
      <ScreenFrame eyebrow="Payment confirmed" title="Your ticket is confirmed.">
        <article className="fd-ticket">
          <span>{tier?.name || entry.tier_id}</span>
          <b>{entry.quantity} ticket{entry.quantity === 1 ? '' : 's'}</b>
          <small>Order {order}</small>
        </article>
        <DrawSummary entries={drop.counts.entries} winners={winners} phase="won" />
      </ScreenFrame>
    );
  }

  if (entry.status === 'waitlisted') {
    return <ScreenFrame eyebrow="Draw result" title="You're on the waitlist."><div className="fd-state-grid"><div><span>Rank</span><b>#{entry.rank.toLocaleString('en-IN')}</b></div><div><span>Live waitlist position</span><b>#{entry.waitlist_position.toLocaleString('en-IN')}</b></div></div><DrawSummary entries={drop.counts.entries} winners={winners} phase="lost" /></ScreenFrame>;
  }

  if (entry.status === 'excluded') {
    const reason = entry.exclusion_reason || '';
    let explanation = 'This entry did not meet the published eligibility rules.';
    if (reason === 'pow_missing') explanation = 'The required proof of work was missing from this entry.';
    else if (reason === 'pow_invalid') explanation = 'The submitted proof of work could not be verified.';
    else if (reason.startsWith('sybil:')) {
      const rule = drop.sybil_rules.find(item => item.id === reason.slice('sybil:'.length));
      explanation = rule ? RULE_TEXT(rule) : 'This entry did not meet a published account eligibility rule.';
    }
    return <ScreenFrame eyebrow="Entry excluded" title="This entry was not eligible."><p className="fd-lead">{explanation}</p><p className="c-sub">Reason code: {reason}</p></ScreenFrame>;
  }

  return (
    <ScreenFrame eyebrow="Draw result" title={STATUS_COPY[entry.status] ? 'The draw is complete.' : 'Your result is being updated.'}>
      {STATUS_COPY[entry.status] && <p className="fd-lead">{STATUS_COPY[entry.status]}</p>}
      {entry.status === 'not_selected' && <p className="c-sub">Rank #{entry.rank.toLocaleString('en-IN')}</p>}
      <DrawSummary entries={drop.counts.entries} winners={winners} phase="lost" />
    </ScreenFrame>
  );
}

export function DrawSummary({ entries, winners, phase }) {
  return <DrumHero entries={entries} winners={winners} phase={phase} label="Draw allocation" />;
}
