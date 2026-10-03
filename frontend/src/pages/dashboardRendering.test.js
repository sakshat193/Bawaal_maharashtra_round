import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadComponent } from '../testSupport.js';

const {default:JudgeDashboard}=await loadComponent('./pages/JudgeDashboard.jsx');
const fixture=name=>JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/${name}.json`,import.meta.url)));
const real=JSON.parse(execFileSync('git',['show','origin/bhargavi:contracts/fixtures/results.json'],{encoding:'utf8'}));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.children?text(node.children):'';

async function mount(t,result,status=200) {
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(180*180*4)}),putImageData:()=>{}}),toDataURL:()=>'data:image/png;base64,'})};
  globalThis.window={location:{href:'?lite=1'}};
  globalThis.fetch=async path=>new Response(JSON.stringify(String(path).endsWith('results.json')?result:String(path).endsWith('/invariants')?fixture('getInvariants.200.open'):fixture('listDrops.200')),{status:String(path).endsWith('results.json')?status:200,headers:{'Content-Type':'application/json'}});
  let root;
  t.after(()=>{act(()=>root?.unmount());globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.document=oldDocument;});
  await act(async()=>{root=create(React.createElement(MemoryRouter,{future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(JudgeDashboard)),{createNodeMock:()=>({style:{}})});});
  return root;
}

test('whole dashboard renders real M4 example as illustrative with neutral profiles',async t=>{
  const root=await mount(t,real);
  assert.match(text(root.toJSON()),/Results source: results.json \| illustrative/);
  assert.match(text(root.toJSON()),/58 tickets/);
  assert.match(text(root.toJSON()),/cannot be classified/);
  assert.ok(root.root.findAll(node=>node.type==='i'&&node.props.className==='unknown').length>0);
});

test('live harness shows supplied per-mode and per-profile attack checks',async t=>{
  const result=structuredClone(real);result.source='live_harness';
  result.modes[0].attack_checks={replay:{passed:true}};
  result.modes[0].profiles.replay.attack_checks={entry_retry:{passed:false}};
  const root=await mount(t,result);
  const content=text(root.toJSON());
  assert.match(content,/replay: Pass/);
  assert.match(content,/entry_retry: Fail/);
  assert.doesNotMatch(content,/illustrative/);
});

test('missing and invalid results explain their illustrative fallback',async t=>{
  const root=await mount(t,{},404);
  assert.match(text(root.toJSON()),/Results source: fixture \| illustrative \| results.json not found/);
});

test('invalid results identify the rejected field',async t=>{
  const result=structuredClone(real);result.modes[0].tickets_won='58';
  const root=await mount(t,result);
  assert.match(text(root.toJSON()),/invalid shape: modes\[0\].tickets_won/);
});
