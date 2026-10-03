import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client.js';

function jitter([minimum, maximum]) {
  const low = Math.max(0, Math.floor(minimum));
  const high = Math.max(low, Math.floor(maximum));
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) return low;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return low + (bytes[0] % (high - low + 1));
}

export function usePoll(load, interval, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const dataRef = useRef(data);
  const intervalRef = useRef(interval);
  const shouldPoll = typeof enabled === 'function' ? enabled() : enabled;
  dataRef.current = data;
  intervalRef.current = interval;

  useEffect(() => {
    let active = true;
    let timer;
    let controller;
    if (!shouldPoll) {
      setData(null);
      setError(null);
      return undefined;
    }

    const poll = async () => {
      controller = new AbortController();
      try {
        const next = await load({ signal: controller.signal });
        if (!active) return;
        dataRef.current = next;
        setData(next);
        setError(null);
      } catch (reason) {
        if (!active) return;
        if (reason?.name !== 'AbortError') setError(reason);
      }

      if (active) {
        const currentInterval = intervalRef.current;
        const range = typeof currentInterval === 'function'
          ? currentInterval(dataRef.current)
          : currentInterval;
        timer = setTimeout(poll, jitter(range));
      }
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [shouldPoll, load, refreshKey]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  return { data, error, refresh };
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
  return usePoll(load, interval, Boolean(dropId));
}

function hasIdentity() {
  try {
    return Boolean(globalThis.sessionStorage?.getItem('fd.jwt'));
  } catch {
    return false;
  }
}

export function useMe(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/me`, { signal }), [dropId]);
  const interval = useCallback(me => {
    const status = me?.offer?.status;
    if (status === 'offered' || status === 'payment_pending') return [1000, 2000];
    return phaseInterval(phase || me?.phase);
  }, [phase]);
  return usePoll(load, interval, () => Boolean(dropId) && hasIdentity());
}

export function useInvariants(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/invariants`, { signal }), [dropId]);
  const interval = useCallback(() => phaseInterval(phase), [phase]);
  return usePoll(load, interval, Boolean(dropId));
}

export function useDraw(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/draw`, { signal }), [dropId]);
  return usePoll(load, [15000, 20000], Boolean(dropId) && (phase === 'drawn' || phase === 'settled'));
}

export function useSnapshot(dropId, phase) {
  const load = useCallback(({ signal }) => api(`/api/drops/${encodeURIComponent(dropId)}/snapshot`, { signal, includeHeaders: true }), [dropId]);
  return usePoll(load, [30000, 60000], Boolean(dropId) && ['sealed', 'drawn', 'settled'].includes(phase));
}
