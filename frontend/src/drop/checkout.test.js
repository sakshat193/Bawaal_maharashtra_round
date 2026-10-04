import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { loadComponent } from '../testSupport.js';

const fixture=name=>JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/${name}.json`,import.meta.url)));
const {Results}=await loadComponent('./drop/StatusScreens.jsx');
const props=()=>({drop:fixture('getDrop.200.drawn'),me:fixture('getMe.200.payment_pending'),refresh:()=>{}});
const button=root=>root.root.findAllByType('button').find(row=>row.children.includes('Pay with Razorpay (test)'));

function install(t,fetchImpl) {
  const originals={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,storage:Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')};
  const values=new Map([['fd.jwt','identity'],[`fd.order.${props().me.offer.offer_id}`,'original-order']]);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}});
  globalThis.window={location:{href:'?lite=1'}};
  globalThis.fetch=fetchImpl;
  t.after(()=>{globalThis.fetch=originals.fetch;globalThis.window=originals.window;globalThis.document=originals.document;if(originals.storage)Object.defineProperty(globalThis,'sessionStorage',originals.storage);else delete globalThis.sessionStorage;});
  return values;
}

test('checkout loads once, opens producer options and pays using the stored Fair Drop order',async t=>{
  const requests=[];let options,opened=0,scripts=0,refreshed=0;
  install(t,async(path,init)=>{requests.push({path,init});return new Response(JSON.stringify(path.endsWith('/checkout')?fixture('createPaymentCheckout.200'):{status:'confirmed'}),{headers:{'Content-Type':'application/json'}});});
  globalThis.document={createElement:()=>({}),head:{appendChild:script=>{
    scripts++;assert.equal(script.src,'https://checkout.razorpay.com/v1/checkout.js');
    window.Razorpay=class {constructor(value){options=value;} open(){opened++;}};
    script.onload();
  }}};
  let root;
  try{
    await act(async()=>{root=create(React.createElement(Results,{...props(),refresh:()=>refreshed++}));});
    assert.ok(button(root),'checkout button exists');
    await act(async()=>{await button(root).props.onClick();});
    await act(async()=>{await button(root).props.onClick();});
    assert.equal(scripts,1);assert.equal(opened,2);
    const checkout=fixture('createPaymentCheckout.200');
    assert.equal(options.key,checkout.key_id);assert.equal(options.order_id,checkout.provider_order_id);
    assert.equal(options.amount,checkout.amount_paise);assert.equal(options.currency,checkout.currency);
    assert.equal(requests[0].init.body,undefined);
    assert.equal(requests[0].init.headers.get('Authorization'),'Bearer identity');
    const proof={razorpay_order_id:checkout.provider_order_id,razorpay_payment_id:'payment',razorpay_signature:'signature'};
    await act(async()=>{await options.handler(proof);});
    assert.deepEqual(JSON.parse(requests.at(-1).init.body),{order_id:'original-order',provider:'razorpay',...proof});
    assert.equal(refreshed,1);
  }finally{act(()=>root?.unmount());}
});

test('checkout error hides Razorpay for the session and keeps both mock buttons',async t=>{
  const values=install(t,async()=>new Response(JSON.stringify(fixture('createPaymentCheckout.503.payment_unavailable')),{status:503,headers:{'Content-Type':'application/json'}}));
  let root;
  try{
    await act(async()=>{root=create(React.createElement(Results,props()));});
    assert.ok(button(root),'checkout button exists');
    await act(async()=>{await button(root).props.onClick();});
    assert.equal(button(root),undefined);
    assert.match(JSON.stringify(root.toJSON()),/Card checkout isn't available right now. Use the payment buttons below./);
    assert.ok(values.get('fd.razorpay.unavailable'));
    for(const label of ['Succeed payment','Fail payment']) assert.ok(root.root.findAllByType('button').some(row=>row.children.includes(label)));
    act(()=>root.unmount());root=null;
    await act(async()=>{root=create(React.createElement(Results,props()));});
    assert.equal(button(root),undefined);
  }finally{act(()=>root?.unmount());}
});
