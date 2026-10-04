import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { usePoll } from './hooks.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve=yes; reject=no; });
  return { promise, resolve, reject };
};

test('poll switches keys immediately and ignores a late old-drop response', async () => {
  const requests=[];
  const load=({signal}) => { const pending=deferred(); requests.push({...pending,signal}); return pending.promise; };
  let value;
  const seen=[];
  function Probe({resource}) { value=usePoll(load,[60000,60000],true,resource); seen.push({resource,data:value.data}); return null; }
  let root;
  try {
    await act(async()=>{root=create(React.createElement(Probe,{resource:'old'}));});
    await act(async()=>{root.update(React.createElement(Probe,{resource:'new'}));});
    assert.equal(value.data,null);
    assert.equal(value.error,null);
    assert.equal(requests[0].signal.aborted,true);
    assert.equal(requests.length,2);
    await act(async()=>{requests[1].resolve({drop:'new'});});
    await act(async()=>{requests[0].resolve({drop:'old'});});
    assert.deepEqual(value.data,{drop:'new'});
    assert.ok(seen.filter(row=>row.resource==='new').every(row=>row.data?.drop !== 'old'));
  } finally { act(()=>root?.unmount()); }
});

test('changing the load function masks prior data on the first new render', async () => {
  const next=deferred();
  const first=async()=>({drop:'old'});
  const second=()=>next.promise;
  const seen=[];
  function Probe({load}) { const value=usePoll(load,[60000,60000],true,'same'); seen.push({load,data:value.data,error:value.error}); return null; }
  let root;
  try {
    await act(async()=>{root=create(React.createElement(Probe,{load:first}));});
    assert.deepEqual(seen.at(-1).data,{drop:'old'});
    await act(async()=>{root.update(React.createElement(Probe,{load:second}));});
    assert.ok(seen.filter(row=>row.load===second).every(row=>row.data===null));
    await act(async()=>{next.resolve({drop:'new'});});
    assert.deepEqual(seen.at(-1).data,{drop:'new'});
  } finally { act(()=>root?.unmount()); }
});

test('resource change resets old error while the new request is pending', async () => {
  const next=deferred();
  const bad=async()=>{throw new Error('old failure');};
  const good=()=>next.promise;
  let value;
  function Probe({load,keyId}) {value=usePoll(load,[60000,60000],true,keyId);return null;}
  let root;
  try {
    await act(async()=>{root=create(React.createElement(Probe,{load:bad,keyId:'old'}));});
    assert.equal(value.error.message,'old failure');
    await act(async()=>{root.update(React.createElement(Probe,{load:good,keyId:'new'}));});
    assert.equal(value.error,null);
    assert.equal(value.data,null);
  } finally { act(()=>root?.unmount()); }
});
