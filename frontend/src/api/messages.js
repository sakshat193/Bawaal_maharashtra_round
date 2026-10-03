export const ERROR_MESSAGES = Object.freeze({
  payment_unavailable: "Card checkout isn't available right now. Use the payment buttons below.",
  invalid_request: 'The request could not be processed. Check the details and try again.',
  window_closed: 'The registration window is closed.',
  entry_exists_different_terms: 'An entry for this drop already exists with different terms.',
  turnstile_failed: 'The human check could not be verified. Please try again.',
  unknown_tier: 'That ticket tier is not available.',
  quantity_exceeds_max: 'The requested quantity is above the limit for this drop.',
  unauthorized: 'Your session has expired. Please sign in again.',
  offer_not_yours: 'This offer belongs to another account.',
  offer_expired: 'This offer has expired.',
  already_redeemed_other_order: 'This offer was already redeemed with another order.',
  not_offered: 'This entry does not have an active offer.',
  payment_window_closed: "Your payment arrived after the window closed. You won't be charged; any charge is refunded.",
  not_payment_pending: 'This offer is not waiting for payment.'
});

export function messageForError(error) {
  const code = typeof error === 'string' ? error : error?.code || error?.data?.error;
  return ERROR_MESSAGES[code] || 'Something went wrong. Please try again.';
}

export function RULE_TEXT(rule) {
  if (rule?.kind === 'max_per_device') {
    return `No more than ${rule.limit ?? 'the permitted number of'} entries can use the same device.`;
  }
  if (rule?.kind === 'max_per_payment') {
    return `No more than ${rule.limit ?? 'the permitted number of'} entries can share a payment method.`;
  }
  if (rule?.kind === 'min_account_age_s') {
    const seconds = Number(rule.value);
    const age = Number.isFinite(seconds) && seconds % 86400 === 0
      ? `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
      : `${rule.value} seconds`;
    return `The account must be at least ${age} old.`;
  }
  return 'This entry did not meet the drop’s published eligibility rules.';
}
