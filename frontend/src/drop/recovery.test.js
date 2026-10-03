import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadComponent } from '../testSupport.js';
import { readFileSync } from 'node:fs';

const fixture = name => JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/${name}.json`, import.meta.url)));
const { default: EntryForm } = await loadComponent('./drop/EntryForm.jsx');
const { Results } = await loadComponent('./drop/StatusScreens.jsx');
const text = root => JSON.stringify(root.toJSON());

function install(t, fetchImpl, failingStorage = false) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  globalThis.window = {location:{href:'http://localhost/?lite=1'}};
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const values = new Map([['fd.jwt','identity']]);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{
    getItem:key=>values.get(key) || null,
    setItem:(key,value)=>{if(failingStorage && (key.startsWith('fd.receipt.') || key.startsWith('fd.pow.'))) throw new Error('storage blocked');values.set(key,value);},
    removeItem:key=>{if(failingStorage && key.startsWith('fd.pow.')) throw new Error('storage blocked');values.delete(key);}
  }});
  globalThis.fetch=fetchImpl;
  t.after(()=>{globalThis.window=oldWindow;globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'sessionStorage',oldStorage);else delete globalThis.sessionStorage;});
}

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const props=()=>{const drop=fixture('getDrop.200');return{drop:{...drop,pow_required:false,turnstile_required:false},tier:drop.tiers[0],quantity:1,onClose:()=>{},refresh:()=>{}};};

test('EntryForm offers sign-in again after a 401 clears the identity',async t=>{
  install(t,async()=>json({error:'unauthorized'},401));
  let root;
  try {
    await act(async()=>{root=create(React.createElement(EntryForm,props()));});
    await act(async()=>{await root.root.findAllByType('button').find(button=>button.children.includes('Submit entry')).props.onClick();});
    assert.ok(root.root.findAllByType('input').some(input=>input.props.autoComplete==='username'));
  }finally{act(()=>root?.unmount());}
});

test('accepted entry survives receipt and proof storage failures and shows registration',async t=>{
  install(t,async()=>json(fixture('createEntry.201')),true);
  let root;
  try {
    await act(async()=>{root=create(React.createElement(EntryForm,props()));});
    await act(async()=>{await root.root.findAllByType('button').find(button=>button.children.includes('Submit entry')).props.onClick();});
    assert.match(text(root),/You're in the draw/);
    assert.equal(root.root.findAll(node=>node.props.role==='alert').length,0);
    assert.match(text(root),/Signed receipt/);
  }finally{act(()=>root?.unmount());}
});

test('pending payment without local order keeps the supported device-recovery sentence',async t=>{
  install(t,async()=>json({}));
  let root;
  try{
    await act(async()=>{root=create(React.createElement(Results,{drop:fixture('getDrop.200.drawn'),me:fixture('getMe.200.payment_pending'),refresh:()=>{}}));});
    assert.match(text(root),/Finish paying on the device where you pressed Buy/);
  }finally{act(()=>root?.unmount());}
});
