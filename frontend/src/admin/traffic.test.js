import test from 'node:test';
import assert from 'node:assert/strict';
import { annotate, markers } from './traffic.js';
import { cloudLayout } from '../three/subnetCloud.js';

const row = (subnet, over = {}) => ({
  subnet, entries: 1, devices: 1, payments: 1, excluded: 0, reasons: [],
  first_at: '2026-10-04T10:00:00Z', last_at: '2026-10-04T10:05:00Z', ...over
});

test('markers: shared device/payment amber, fired rule red, burst needs volume and speed', () => {
  assert.deepEqual(markers(row('a')), []);
  assert.deepEqual(markers(row('b', { entries: 3, devices: 1, payments: 3 })).map(m => m.text), ['shared device']);
  const bot = markers(row('c', { entries: 20, devices: 20, payments: 20, last_at: '2026-10-04T10:00:03Z' }));
  assert.deepEqual(bot.map(m => m.text), ['busy subnet (may be shared Wi-Fi)', 'burst']);
  const red = markers(row('d', { entries: 6, devices: 1, payments: 1, excluded: 6, reasons: ['sybil:device'] }));
  assert.equal(red[0].level, 'red');
  assert.match(red[0].text, /sybil:device/);
});

test('annotate sorts red before amber before ok, then by size', () => {
  const sorted = annotate([
    row('ok-big', { entries: 9, devices: 9, payments: 9 }),
    row('amber', { entries: 2 }),
    row('red', { excluded: 1 })
  ]);
  assert.deepEqual(sorted.map(r => r.subnet), ['red', 'amber', 'ok-big']);
});

test('cloud layout is deterministic and stays inside the point budget', () => {
  const rows = annotate([row('203.0.113.0/24', { entries: 50000 }), row('198.51.100.0/24', { entries: 3 })]);
  const first = cloudLayout(rows), second = cloudLayout(rows);
  assert.deepEqual(first.points, second.points);
  assert.ok(first.points.length <= 6002 && first.unit > 1);
  assert.equal(cloudLayout([]).points.length, 0);
});
