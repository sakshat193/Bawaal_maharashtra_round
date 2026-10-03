export function createEntryBody({ tierId, quantity, turnstileToken, issuedAt, nonces }) {
  return {
    tier_id: tierId,
    quantity,
    ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    pow: { issued_at: issuedAt, nonces: [...nonces] }
  };
}

export function formatCountdown(deadline, now = Date.now()) {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return '00:00';
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatPaise(paise) {
  if (!Number.isSafeInteger(paise)) return '₹—';
  const wholeRupees = Math.trunc(paise / 100);
  const minorPaise = Math.abs(paise % 100);
  const grouped = new Intl.NumberFormat('en-IN').format(wholeRupees);
  return `₹${grouped}${minorPaise ? `.${String(minorPaise).padStart(2, '0')}` : ''}`;
}

function sessionStore() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function getOrCreateOrderId(offerId, storage = sessionStore(), createUuid = () => globalThis.crypto?.randomUUID?.()) {
  const key = `fd.order.${offerId}`;
  const existing = storage?.getItem(key);
  if (existing) return existing;
  if (!storage) throw new Error('Session storage is unavailable.');

  const orderId = createUuid();
  if (typeof orderId !== 'string' || !orderId) throw new Error('Secure order id generation is unavailable.');
  storage.setItem(key, orderId);
  return orderId;
}
