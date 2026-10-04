import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useIdentity } from './client.js';

function jitter([minimum, maximum]) {
  const low = Math.max(0, Math.floor(minimum));
  const high = Math.max(low, Math.floor(maximum));
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) return low;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return low + (bytes[0] % (high - low + 1));
}

export function usePoll(load, interval, enabled = true, key = load) {
  const [state, setState] = useState({ load, key, data: null, error: null, loading: true });
  const [refreshKey, setRefreshKey] = useState(0);
  const dataRef = useRef(null);
  const intervalRef = useRef(interval);
  const resourceRef = useRef({load,key});
  const shouldPoll = typeof enabled === 'function' ? enabled() : enabled;
  resourceRef.current = {load,key};
  intervalRef.current = interval;

  useEffect(() => {
    let active = true;
    let timer;
    let controller;
    dataRef.current = null;
    setState({load,key,data:null,error:null,loading:Boolean(shouldPoll)});
    if (!shouldPoll) return undefined;
    const current = () => active && resourceRef.current.load === load && resourceRef.current.key === key;
    const poll = async () => {
      controller = new AbortController();
      try {
        const next = await load({signal:controller.signal});
        if (!current()) return;
        dataRef.current = next;
        setState({load,key,data:next,error:null,loading:false});
      } catch (reason) {
        if (!current()) return;
        if (reason?.name !== 'AbortError') setState({load,key,data:dataRef.current,error:reason,loading:false});
      }
      if (current()) {
        const range = typeof intervalRef.current === 'function' ? intervalRef.current(dataRef.current) : intervalRef.current;
        timer = setTimeout(poll,jitter(range));
      }
    };
    poll();
    return () => { active=false; clearTimeout(timer); controller?.abort(); };
  }, [shouldPoll,load,key,refreshKey]);

  const refresh = useCallback(() => setRefreshKey(value => value+1), []);
  // Mask the previous resource during render, before effect cleanup can run.
  const matches = shouldPoll && state.load === load && state.key === key;
  return {data:matches ? state.data : null,error:matches ? state.error : null,loading:matches ? state.loading : Boolean(shouldPoll),refresh};
}

const phaseInterval = phase => phase === 'scheduled' || phase === 'open'
  ? [5000, 10000]
  : [2000, 4000];

export function useDrops() {
  const load = useCallback(({ signal }) => api('/api/drops', { signal }), []);
  return usePoll(load, [10000, 15000]);
}

export function useDrop(dropId) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}`, { signal }), [dropId]);
  const interval = useCallback(drop => phaseInterval(drop?.phase), []);
  return usePoll(load, interval, Boolean(dropId), dropId);
}

export function useMe(dropId, phase) {
  const identity = useIdentity();
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/me`, { signal }), [dropId]);
  const interval = useCallback(me => {
    const status = me?.offer?.status;
    if (status === 'offered' || status === 'payment_pending') return [1000, 2000];
    return phaseInterval(phase || me?.phase);
  }, [phase]);
  return usePoll(load, interval, Boolean(dropId && identity), `${dropId}:${identity || ''}`);
}

export function useInvariants(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/invariants`, { signal }), [dropId]);
  const interval = useCallback(() => phaseInterval(phase), [phase]);
  return usePoll(load, interval, Boolean(dropId), dropId);
}

export function useDraw(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/draw`, { signal }), [dropId]);
  return usePoll(load, [15000, 20000], Boolean(dropId) && (phase === 'drawn' || phase === 'settled'), dropId);
}

export function useSnapshot(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/snapshot`, { signal, includeHeaders: true }), [dropId]);
  return usePoll(load, [30000, 60000], Boolean(dropId) && ['sealed', 'drawn', 'settled'].includes(phase), dropId);
}
