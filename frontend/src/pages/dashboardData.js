const MAX_DOTS = 6000;
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function resultsShapeError(value) {
  if (!object(value)) return 'results';
  if (value.schema_version !== 1) return 'schema_version';
  if (typeof value.source !== 'string' || !value.source) return 'source';
  if (!Array.isArray(value.modes) || !value.modes.length) return 'modes';
  const ids = new Set();
  for (const [index, mode] of value.modes.entries()) {
    const path = `modes[${index}]`;
    if (!object(mode) || typeof mode.mode !== 'string' || !mode.mode || ids.has(mode.mode)) return `${path}.mode`;
    ids.add(mode.mode);
    for (const field of ['entries', 'identities', 'tickets_won']) if (!isCount(mode[field])) return `${path}.${field}`;
    for (const field of ['bot_ticket_share','bot_identity_share','bot_share_ratio']) {
      if (!Number.isFinite(mode[field]) || mode[field] < 0 || (field !== 'bot_share_ratio' && mode[field] > 1)) return `${path}.${field}`;
    }
    if (!object(mode.profiles)) return `${path}.profiles`;
    for (const [name, profile] of Object.entries(mode.profiles)) {
      if (!object(profile)) return `${path}.profiles.${name}`;
      for (const field of ['identities','entries','tickets_won']) if (!isCount(profile[field])) return `${path}.profiles.${name}.${field}`;
      if (profile.bot !== undefined && typeof profile.bot !== 'boolean') return `${path}.profiles.${name}.bot`;
      if (profile.cohort !== undefined && typeof profile.cohort !== 'string') return `${path}.profiles.${name}.cohort`;
    }
    if (!object(mode.groups_vs_singles)) return `${path}.groups_vs_singles`;
    for (const field of ['group_members','singles']) if (!isCount(mode.groups_vs_singles[field])) return `${path}.groups_vs_singles.${field}`;
    const ratio = mode.groups_vs_singles.ratio;
    if (ratio !== null && (!Number.isFinite(ratio) || ratio < 0)) return `${path}.groups_vs_singles.ratio`;
    if (!object(mode.exclusions_per_rule) || Object.values(mode.exclusions_per_rule).some(n => !isCount(n))) return `${path}.exclusions_per_rule`;
    if (!object(mode.invariants)) return `${path}.invariants`;
    for (const field of ['held_within_capacity','held_matches_active_offers']) if (typeof mode.invariants[field] !== 'boolean') return `${path}.invariants.${field}`;
    for (const field of ['oversell','double_redemption']) if (!isCount(mode.invariants[field])) return `${path}.invariants.${field}`;
    for (const [owner, checks] of [['mode',mode.attack_checks], ...Object.entries(mode.profiles).map(([name,p]) => [name,p.attack_checks])]) {
      if (checks === undefined) continue;
      if (!object(checks) || Object.values(checks).some(check => !object(check) || typeof check.passed !== 'boolean')) return `${path}.${owner}.attack_checks`;
    }
  }
  for (const id of ['naive_fcfs','hardened_fcfs','lottery_wil']) if (!ids.has(id)) return `modes.${id}`;
  return null;
}

export const validResults = value => resultsShapeError(value) === null;

function profilesOf(mode) {
  return Object.entries(mode?.profiles || {}).map(([name, profile]) => ({
    name, bot: profile.bot, classification: profile.bot === true ? 'bot' : profile.bot === false ? 'honest' : 'unknown',
    group: profile.cohort === 'group_members', identities: profile.identities || 0,
    entries: profile.entries || 0, tickets: profile.tickets_won || 0
  }));
}

export function summarizeMode(mode) {
  const unknown = profilesOf(mode).filter(profile => profile.classification === 'unknown');
  return {
    tickets: mode?.tickets_won || 0,
    botTicketShare: mode?.bot_ticket_share ?? 0,
    botIdentityShare: mode?.bot_identity_share ?? 0,
    botShareRatio: mode?.bot_share_ratio ?? 0,
    groupsVsSingles: mode?.groups_vs_singles,
    unknownTickets: unknown.reduce((sum,p) => sum+p.tickets,0),
    unknownEntries: unknown.reduce((sum,p) => sum+p.entries,0),
    exclusions: Object.entries(mode?.exclusions_per_rule || {}).map(([rule,count]) => ({rule,count})).sort((a,b)=>a.rule.localeCompare(b.rule))
  };
}

export function viewMode(mode) {
  const profiles = profilesOf(mode);
  const totalTickets = profiles.reduce((sum, profile) => sum + profile.tickets, 0);
  const unitSize = Math.max(1, Math.ceil(totalTickets / MAX_DOTS));
  return { unitSize, profiles: profiles.map(profile => ({...profile,dots:Math.ceil(profile.tickets/unitSize)})) };
}

export function sceneCounts(mode) {
  return profilesOf(mode).reduce((totals,profile) => {
    totals[profile.classification === 'bot' ? 'bots' : profile.classification] += profile.entries;
    totals.seats += profile.tickets;
    return totals;
  }, {honest:0,bots:0,unknown:0,seats:0});
}

export function invariantFailures(inv) {
  if (!Array.isArray(inv?.tiers) || !inv.tiers.length) return null;
  const failures = [];
  for (const tier of inv.tiers) {
    const name = tier?.tier_id || 'Unnamed tier';
    for (const field of ['held','capacity','active_offer_units']) {
      if (!isCount(tier?.[field])) failures.push(`${name}: invalid ${field}`);
    }
    if (isCount(tier?.held) && isCount(tier?.capacity) && tier.held > tier.capacity) failures.push(`${name}: held exceeds capacity`);
    if (isCount(tier?.held) && isCount(tier?.active_offer_units) && tier.held !== tier.active_offer_units) failures.push(`${name}: held differs from active offer units`);
  }
  for (const field of ['oversell','held_mismatch','double_redemption']) {
    if (!isCount(inv[field])) failures.push(`Invalid ${field}`);
    else if (inv[field] !== 0) failures.push(`${field}: ${inv[field]}`);
  }
  return failures;
}
