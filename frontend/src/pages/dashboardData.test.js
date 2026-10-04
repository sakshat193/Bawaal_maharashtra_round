import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import * as data from './dashboardData.js';
import * as scenes from '../three/judgeScenes.js';

const real = JSON.parse(execFileSync('git', ['show', 'origin/bhargavi:contracts/fixtures/results.json'], { encoding: 'utf8' }));
const valid = () => ({ tiers: [{tier_id:'section', held:2, active_offer_units:2, capacity:3}], oversell:0, held_mismatch:0, double_redemption:0 });
const panelText = readFileSync(new URL('./JudgeDashboard.jsx', import.meta.url), 'utf8');
const panel = panelText.slice(panelText.indexOf('function InvariantsPanel('), panelText.indexOf('export default function JudgeDashboard('));
const InvariantsPanel = new Function('React','invariantFailures','messageForError', transformSync(panel, {loader:'jsx'}).code + '\nreturn InvariantsPanel;')(React, data.invariantFailures, () => 'API error');
const render = props => renderToStaticMarkup(React.createElement(InvariantsPanel, props));

test('M3 invariants render and errors replace the last all-clear heading', () => {
  assert.match(render({invariants:valid()}), /All clear/);
  assert.match(render({invariants:valid()}), /2/);
  const html = render({invariants:valid(),error:new Error('offline')});
  assert.match(html, /Invariants unavailable/);
  assert.doesNotMatch(html, /All clear/);
});

test('missing and empty tier evidence is unavailable', () => {
  assert.equal(data.invariantFailures({}), null);
  assert.equal(data.invariantFailures({tiers:[]}), null);
  assert.equal(data.invariantFailures(null), null);
  assert.match(render({invariants:null}), /Invariants unavailable/);
  assert.match(render({invariants:null,loading:true}), /Loading/);
});

test('every conservation counter and tier mismatch fails', () => {
  assert.deepEqual(data.invariantFailures(valid()), []);
  for (const field of ['oversell','held_mismatch','double_redemption']) {
    assert.ok(data.invariantFailures({...valid(),[field]:1}).some(text => text.includes(field)));
  }
  const inv = valid(); inv.tiers[0].held=4;
  assert.equal(data.invariantFailures(inv).length, 2);
});

test('negative NaN string missing and fractional counts fail with renderable messages', () => {
  for (const field of ['held','capacity','active_offer_units','oversell','held_mismatch','double_redemption']) {
    for (const value of [-1,NaN,'2',undefined,0.5,Infinity]) {
      const inv=valid();
      if (field in inv) inv[field]=value; else inv.tiers[0][field]=value;
      assert.ok(data.invariantFailures(inv).length > 0, field);
      assert.doesNotThrow(() => render({invariants:inv}));
    }
  }
});

test('real M4 example validates and lottery summary keeps its published 58 tickets and metrics', () => {
  assert.equal(typeof data.validResults, 'function');
  assert.equal(data.validResults(real), true);
  const mode=real.modes.find(row=>row.mode==='lottery_wil');
  const summary=data.summarizeMode(mode);
  assert.equal(summary.tickets,58);
  assert.equal(summary.botTicketShare,mode.bot_ticket_share);
  assert.equal(summary.botShareRatio,mode.bot_share_ratio);
  assert.deepEqual(summary.groupsVsSingles,mode.groups_vs_singles);
});

test('results validation rejects wrong shapes with the failing field', () => {
  assert.equal(typeof data.resultsShapeError, 'function');
  assert.match(data.resultsShapeError({...real,modes:{}}), /modes/);
  for (const field of ['tickets_won','bot_ticket_share','profiles','groups_vs_singles','invariants']) {
    const value=structuredClone(real); delete value.modes[0][field];
    assert.equal(data.validResults(value),false);
    assert.match(data.resultsShapeError(value),new RegExp(field));
  }
  const value=structuredClone(real); value.modes[0].bot_ticket_share=2;
  assert.equal(data.validResults(value),false);
});

test('missing bot stays unknown in profile grids and entry scenes', () => {
  const mode={tickets_won:6,profiles:{unknown:{identities:1,entries:3,tickets_won:2}, bot:{bot:true,entries:4,tickets_won:1}, human:{bot:false,entries:5,tickets_won:3}}};
  const view=data.viewMode(mode);
  assert.equal(view.profiles[0].bot,undefined);
  assert.equal(view.profiles[0].classification,'unknown');
  assert.equal(data.summarizeMode(mode).unknownTickets,2);
  assert.deepEqual(data.sceneCounts(mode),{honest:5,bots:4,unknown:3,seats:6});
});

test('seat grids retain totals with a shared scale',()=>{
  const view=data.viewMode({profiles:{one:{bot:false,tickets_won:6001},two:{bot:true,tickets_won:3999}}});
  assert.equal(view.unitSize,2);
  assert.deepEqual(view.profiles.map(row=>row.dots),[3001,2000]);
});

test('three scene scale preserves unknown points separately', () => {
  assert.equal(typeof scenes.scaledWorld, 'function');
  const world = scenes.scaledWorld({honest:2,bots:3,unknown:4,seats:9});
  assert.equal(world.unknownPoints,4);
  assert.equal(world.honestPoints+world.botPoints+world.unknownPoints,9);
});
