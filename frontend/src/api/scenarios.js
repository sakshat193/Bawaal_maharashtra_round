export function initialScenario(stored, requested, knownScenarios) {
  const known = value => typeof value === 'string' && Object.hasOwn(knownScenarios, value);
  if (known(stored)) return { scenario: stored, seed: false };
  if (known(requested)) return { scenario: requested, seed: true };
  return { scenario: 'none', seed: false };
}
