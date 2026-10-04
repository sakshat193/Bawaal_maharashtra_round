import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { loadComponent } from '../testSupport.js';

const fixture=name=>JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/${name}.json`,import.meta.url)));
const {default:DropDetail}=await loadComponent('./drop/DropDetail.jsx');
const {Home}=await loadComponent('./pages/concert/Home.jsx');
const wrap=element=>React.createElement(MemoryRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},element);
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : '';

test('settled detail uses server capacity minus held or explicit general sale units',t=>{
  const oldWindow=globalThis.window;globalThis.window={location:{href:'?lite=1'}};t.after(()=>{globalThis.window=oldWindow;});
  const drop=fixture('getDrop.200.settled');const invariants=fixture('getInvariants.200.settled');
  const render=()=>renderToStaticMarkup(React.createElement(DropDetail,{drop,invariants})).replace(/<!--.*?-->/g,'');
  const tier=drop.tiers.find(tier=>invariants.tiers.find(row=>row.tier_id===tier.tier_id).held<tier.capacity);
  const row=invariants.tiers.find(row=>row.tier_id===tier.tier_id);
  assert.match(render(),new RegExp(`${tier.capacity-row.held} first-come tickets`));
  row.general_sale_units=17;
  assert.match(render(),/17 first-come tickets/);
  drop.phase='drawn';assert.doesNotMatch(render(),/first-come tickets/);
});

test('home first-come count follows settled inventory and hides in other phases',async t=>{
  const oldFetch=globalThis.fetch;
  const drop=fixture('getDrop.200.settled');const inv=fixture('getInvariants.200.settled');
  globalThis.fetch=async path=>new Response(JSON.stringify(String(path).endsWith('/invariants')?inv:drop),{headers:{'Content-Type':'application/json'}});
  t.after(()=>{globalThis.fetch=oldFetch;});
  let root;
  try{
    await act(async()=>{root=create(wrap(React.createElement(Home,{drops:[drop]})));});
    const free=inv.tiers.reduce((sum,row)=>sum+row.capacity-row.held,0);
    assert.match(text(root.toJSON()),new RegExp(`${free} first-come tickets`));
    act(()=>root.unmount());root=null;
    drop.phase='drawn';
    await act(async()=>{root=create(wrap(React.createElement(Home,{drops:[drop]})));});
    assert.doesNotMatch(text(root.toJSON()),/first-come tickets/);
  }finally{act(()=>root?.unmount());}
});
