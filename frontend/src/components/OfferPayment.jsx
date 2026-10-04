import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

const TOKEN_KEY = 'fairdrop.identity';
const DROP_KEY = 'fairdrop.drop_id';
const orderKey = offerId => `fairdrop.order.${offerId}`;
const checkoutKey = offerId => `fairdrop.checkout.${offerId}`;

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    throw new Error('Session storage is unavailable in this browser.');
  }
}

function removeSession(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    return;
  }
}

function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not initialize.'));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
    document.head.appendChild(script);
  });
}

export default function OfferPayment({ demoMode = false }) {
  const [token, setToken] = useState(() => readSession(TOKEN_KEY) || '');
  const [dropId] = useState(() => readSession(DROP_KEY) || import.meta.env.VITE_DROP_ID || '');
  const [offer, setOffer] = useState(null);
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (demoMode) {
      setOffer({
        offer_id: 'local-razorpay-test',
        quantity: 1,
        amount_paise: 100,
        status: 'offered',
        pay_deadline: null,
      });
      setOrderId('');
      setMessage('Razorpay Test Mode · ₹1 test payment. No ticket is reserved.');
      setError('');
      setBusy(false);
      return undefined;
    }
    if (!token) {
      setMessage('Sign in and enter the draw before checkout.');
      return undefined;
    }
    if (!dropId) {
      setMessage('No active drop is configured for this checkout.');
      return undefined;
    }

    let active = true;
    let timer;
    let firstLoad = true;
    setBusy(true);
    setError('');
    setMessage('');
    const refresh = async () => {
      try {
        const me = await apiRequest(`/api/drops/${encodeURIComponent(dropId)}/me`, { token });
        if (!active) return;
        setOffer(me.offer);
        const savedOrder = me.offer ? readSession(orderKey(me.offer.offer_id)) || '' : '';
        setOrderId(savedOrder);
        if (!me.offer) {
          setMessage(me.phase === 'settled'
            ? 'This drop has settled without a ticket for this account.'
            : me.entry ? 'Waiting for your ticket allocation.' : 'Enter the draw before checkout.');
          if (me.phase === 'settled' && timer) clearInterval(timer);
        } else if (me.offer.status === 'payment_pending' && !savedOrder) {
          setMessage('Resume checkout in the browser session where it started.');
          if (timer) clearInterval(timer);
        } else {
          const messages = {
            confirmed: 'Payment is already confirmed.',
            expired: 'This ticket is no longer available for payment.',
            declined: 'This ticket is no longer available for payment.',
            payment_failed: 'Payment failed. This ticket is no longer held.',
          };
          setMessage(messages[me.offer.status] || '');
          if (timer) clearInterval(timer);
        }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Could not load your tickets.');
      } finally {
        if (active && firstLoad) setBusy(false);
        firstLoad = false;
      }
    };
    refresh();
    timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [dropId, token, demoMode]);

  async function startPayment() {
    if (!offer || (!demoMode && !token)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let activeOrderId = orderId;
      let checkout;
      if (demoMode) {
        checkout = await apiRequest('/demo-payment/order', { method: 'POST' });
        activeOrderId = checkout.test_offer_id;
      } else {
        if (offer.status === 'offered') {
          if (!activeOrderId) {
            activeOrderId = crypto.randomUUID();
            sessionStorage.setItem(orderKey(offer.offer_id), activeOrderId);
            setOrderId(activeOrderId);
          }
          await apiRequest(`/api/offers/${offer.offer_id}/redeem`, {
            method: 'POST',
            token,
            body: { order_id: activeOrderId },
          });
        }
        if (!activeOrderId) throw new Error('This pending checkout must be resumed in the browser session where it started.');

        const cached = readSession(checkoutKey(offer.offer_id));
        if (cached) {
          try {
            const saved = JSON.parse(cached);
            if (saved.order_id === activeOrderId && Date.parse(saved.pay_deadline) > Date.now()) checkout = saved;
          } catch {
            removeSession(checkoutKey(offer.offer_id));
          }
        }
        if (!checkout) {
          checkout = await apiRequest(`/api/offers/${offer.offer_id}/checkout`, { method: 'POST', token });
          writeSession(checkoutKey(offer.offer_id), JSON.stringify({ ...checkout, order_id: activeOrderId }));
        }
      }

      await loadRazorpay();
      const payment = new window.Razorpay({
        key: checkout.key_id,
        amount: checkout.amount_paise,
        currency: checkout.currency,
        order_id: checkout.provider_order_id,
        name: 'Fair Drop',
        description: `${offer.quantity} ticket${offer.quantity === 1 ? '' : 's'} · ${formatINR(checkout.amount_paise)}`,
        handler: async result => {
          setBusy(true);
          try {
            if (demoMode) {
              await apiRequest('/demo-payment/verify', {
                method: 'POST',
                body: {
                  test_offer_id: activeOrderId,
                  razorpay_order_id: result.razorpay_order_id,
                  razorpay_payment_id: result.razorpay_payment_id,
                  razorpay_signature: result.razorpay_signature,
                },
              });
            } else {
              await apiRequest(`/api/offers/${offer.offer_id}/pay`, {
                method: 'POST',
                token,
                body: {
                  order_id: activeOrderId,
                  provider: 'razorpay',
                  razorpay_order_id: result.razorpay_order_id,
                  razorpay_payment_id: result.razorpay_payment_id,
                  razorpay_signature: result.razorpay_signature,
                },
              });
            }
            setOffer(current => ({ ...current, status: 'confirmed' }));
            setMessage(demoMode ? 'Razorpay test payment verified.' : 'Payment confirmed. Your ticket is secured.');
            if (!demoMode) {
              removeSession(orderKey(offer.offer_id));
              removeSession(checkoutKey(offer.offer_id));
            }
          } catch (requestError) {
            setError(requestError.message || 'Payment verification failed.');
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setMessage('Checkout closed. Your payment window is still running.') },
        theme: { color: '#F59E0B' },
      });
      payment.on('payment.failed', response => {
        setError(response.error?.description || 'Payment failed. The offer remains subject to its payment deadline.');
      });
      payment.open();
    } catch (requestError) {
      setError(requestError.message || 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  async function declineTicket() {
    if (!offer || !token || offer.status !== 'offered') return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest(`/api/offers/${offer.offer_id}/decline`, { method: 'POST', token });
      setOffer(current => ({ ...current, status: 'declined' }));
      setMessage('Ticket released.');
    } catch (requestError) {
      setError(requestError.message || 'Could not release this ticket.');
    } finally {
      setBusy(false);
    }
  }

  const canPay = offer && (demoMode || token) && ['offered', 'payment_pending'].includes(offer.status)
    && (offer.status !== 'payment_pending' || Boolean(orderId));
  const ticketStatus = offer ? ({
    offered: 'Ready to pay',
    payment_pending: 'Payment pending',
    confirmed: 'Confirmed',
    expired: 'Expired',
    declined: 'Unavailable',
    payment_failed: 'Payment failed',
  }[offer.status] || 'Unavailable') : '';

  return (
    <section style={{ width: '100%', maxWidth: 680, padding: 24, background: '#101017', border: '1px solid var(--line)', borderRadius: 4 }}>
      {offer && (
        <div style={{ display: 'grid', gap: 12, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><span>Ticket status</span><strong>{ticketStatus}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><span>Tickets</span><strong>{offer.quantity}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><span>Total</span><strong>{formatINR(offer.amount_paise)}</strong></div>
          {offer.pay_deadline && <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Payment deadline: {new Date(offer.pay_deadline).toLocaleString()}</div>}
          {canPay && <button className="btn btn-amber" type="button" onClick={startPayment} disabled={busy}>
            {busy ? 'Opening Razorpay…' : `Pay ${formatINR(offer.amount_paise)}`}
          </button>}
          {!demoMode && offer.status === 'offered' && <button className="btn btn-ghost" type="button" onClick={declineTicket} disabled={busy}>
            Release ticket
          </button>}
        </div>
      )}

      {message && <p role="status" aria-live="polite" style={{ margin: '16px 0 0', color: 'var(--ink2)', lineHeight: 1.5 }}>{message}</p>}
      {error && <p role="alert" style={{ margin: '16px 0 0', color: '#FDA4AF', lineHeight: 1.5 }}>{error}</p>}
    </section>
  );
}