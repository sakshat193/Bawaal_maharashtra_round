const MAX_DOTS = 6000;

function count(value) {
  return Number.isSafeInteger(value) ? Math.max(0, value) : 0;
}

function profilesOf(mode) {
  return Object.entries(mode?.profiles || {}).map(([name, profile]) => ({
    name,
    bot: Boolean(profile.bot),
    group: Boolean(profile.group),
    identities: count(profile.identities),
    entries: count(profile.entries),
    tickets: count(profile.tickets)
  }));
}

export function summarizeMode(mode) {
  const profiles = profilesOf(mode);
  const summary = profiles.reduce((result, profile) => {
    result.identities += profile.identities;
    result.tickets += profile.tickets;
    if (profile.bot) {
      result.botIdentities += profile.identities;
      result.botTickets += profile.tickets;
    }
    if (profile.group) {
      result.groupIdentities += profile.identities;
      result.groupTickets += profile.tickets;
    } else {
      result.singleIdentities += profile.identities;
      result.singleTickets += profile.tickets;
    }
    return result;
  }, {
    identities: 0,
    botIdentities: 0,
    tickets: 0,
    botTickets: 0,
    groupIdentities: 0,
    singleIdentities: 0,
    groupTickets: 0,
    singleTickets: 0
  });
  summary.botTicketShare = summary.tickets ? summary.botTickets / summary.tickets : 0;
  summary.botIdentityShare = summary.identities ? summary.botIdentities / summary.identities : 0;
  summary.botShareRatio = summary.botIdentityShare ? summary.botTicketShare / summary.botIdentityShare : 0;
  summary.exclusions = Object.entries(mode?.exclusions_by_rule || {})
    .map(([rule, value]) => ({ rule, count: count(value) }))
    .sort((a, b) => a.rule.localeCompare(b.rule));
  return summary;
}

export function viewMode(mode) {
  const profiles = profilesOf(mode);
  const totalTickets = profiles.reduce((sum, profile) => sum + profile.tickets, 0);
  const unitSize = Math.max(1, Math.ceil(totalTickets / MAX_DOTS));
  return {
    unitSize,
    profiles: profiles.map(profile => ({
      ...profile,
      dots: Math.min(MAX_DOTS, Math.ceil(profile.tickets / unitSize))
    }))
  };
}

export function sceneCounts(mode) {
  return profilesOf(mode).reduce((totals, profile) => {
    totals[profile.bot ? 'bots' : 'honest'] += profile.entries;
    totals.seats += profile.tickets;
    return totals;
  }, { honest: 0, bots: 0, seats: 0 });
}

export function invariantFailures(invariants) {
  if (!invariants) return null;
  const failures = [];
  for (const tier of invariants.tiers || []) {
    if (tier.held > tier.capacity) failures.push(`${tier.tier_id}: held exceeds capacity`);
    if (tier.held !== tier.active_quantity) failures.push(`${tier.tier_id}: held differs from active quantity`);
  }
  if (invariants.entries_with_multiple_offers !== 0) failures.push('Multiple active offers exist');
  return failures;
}
