import test from 'node:test';
import assert from 'node:assert/strict';
import { invariantFailures, sceneCounts, summarizeMode, viewMode } from './dashboardData.js';

const sample = {
  profiles: {
    singles: { bot: false, group: false, identities: 10, entries: 12, tickets: 8 },
    botnet: { bot: true, group: false, identities: 2, entries: 20, tickets: 4 },
    group: { bot: false, group: true, identities: 3, entries: 3, tickets: 6 }
  },
  exclusions_by_rule: { device: 2 }
};

test('dashboard summaries derive ticket, bot, group and single counts from profiles', () => {
  assert.deepEqual(summarizeMode(sample), {
    identities: 15,
    botIdentities: 2,
    tickets: 18,
    botTickets: 4,
    groupIdentities: 3,
    singleIdentities: 12,
    groupTickets: 6,
    singleTickets: 12,
    botTicketShare: 4 / 18,
    botIdentityShare: 2 / 15,
    botShareRatio: (4 / 18) / (2 / 15),
    exclusions: [{ rule: 'device', count: 2 }]
  });
});

test('dashboard seat view uses one shared ticket unit and retains profile totals', () => {
  const mode = {
    profiles: {
      one: { bot: false, tickets: 6001 },
      two: { bot: true, tickets: 3999 }
    }
  };
  const view = viewMode(mode);
  assert.equal(view.unitSize, 2);
  assert.deepEqual(view.profiles.map(profile => profile.dots), [3001, 2000]);
});

test('judge scene inputs use lottery entry and ticket totals from profiles', () => {
  assert.deepEqual(sceneCounts(sample), { honest: 15, bots: 20, seats: 18 });
});

test('invariants panel reports every conservation failure and accepts a valid world', () => {
  assert.deepEqual(invariantFailures({
    entries_with_multiple_offers: 0,
    tiers: [{ tier_id: 'gold', held: 2, active_quantity: 2, capacity: 3 }]
  }), []);
  assert.deepEqual(invariantFailures({
    entries_with_multiple_offers: 1,
    tiers: [{ tier_id: 'gold', held: 4, active_quantity: 3, capacity: 3 }]
  }), [
    'gold: held exceeds capacity',
    'gold: held differs from active quantity',
    'Multiple active offers exist'
  ]);
});
