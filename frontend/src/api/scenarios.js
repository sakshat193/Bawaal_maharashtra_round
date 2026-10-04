export const MOCK_SCENARIOS = Object.freeze({
  none: { drop: 'open', me: 'none' },
  registered: { drop: 'open', me: 'registered' },
  sealed: { drop: 'sealed', me: 'registered' },
  excluded: { drop: 'sealed', me: 'excluded' },
  waitlisted: { drop: 'drawn', me: 'waitlisted' },
  offered: { drop: 'drawn', me: 'offered' },
  payment_pending: { drop: 'drawn', me: 'payment_pending' },
  confirmed: { drop: 'drawn', me: 'confirmed' },
  expired: { drop: 'drawn', me: 'expired' },
  declined: { drop: 'drawn', me: 'declined' },
  payment_failed: { drop: 'drawn', me: 'payment_failed' },
  not_selected: { drop: 'settled', me: 'not_selected' },
  scheduled: { drop: 'scheduled', me: 'none' }
});

export function initialScenario(stored, requested, knownScenarios) {
  const known = value => typeof value === 'string' && Object.hasOwn(knownScenarios, value);
  if (known(stored)) return { scenario: stored, seed: false };
  if (known(requested)) return { scenario: requested, seed: true };
  return { scenario: 'none', seed: false };
}
