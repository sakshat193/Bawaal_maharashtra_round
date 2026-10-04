import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { CONCERTS, TIERS, CITIES, CAPACITY, describe, dur, money } from './data.js';

/*
 * Single client-side state machine for the ticketing flow.
 * phase: home | event | queue | turn | checkout | done   (+ check overlay)
 * In production `phase`, queue position and hold timers come from the server;
 * this store simulates them and persists to localStorage so refresh resumes.
 */
const KEY = 'fairdrop-concerts-v1';
const KEEP = ['anchor', 'phase', 'tab', 'cid', 'tier', 'saved', 'tickets', 'queue', 'check', 'holdEnd', 'qty', 'pay', 'unread', 'city', 'feed'];
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const persist = s => { const o = {}; KEEP.forEach(k => (o[k] = s[k])); try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } };
const scrollTop = () => window.scrollTo(0, 0);

export function newCheck(mode, type, msg) {
  type = type || (Math.random() < 0.5 ? 'slide' : 'tap');
  const c = { mode, type, msg: msg || '', status: 'idle', deadline: Date.now() + (mode === 'queue' ? 30000 : 9e12), bad: 0 };
  if (type === 'slide') { c.target = 30 + Math.random() * 62; c.val = 0; }
  else {
    const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5).slice(0, 3);
    c.tiles = Array(9).fill(0); idx.forEach((v, i) => (c.tiles[v] = i + 1)); c.next = 1;
  }
  return c;
}

const conOf = s => CONCERTS.find(c => c.id === s.cid) || CONCERTS[0];
const progOf = s => s.phase === 'queue' && s.queue ? 1 - s.queue.ahead / s.queue.total : (s.phase === 'turn' || s.phase === 'checkout') ? 1 : 0;
export const soldOf = s => {
  const c = conOf(s), base = Math.min(1, (c.sold || 0) + progOf(s) * 0.17), m = {};
  TIERS.forEach(t => (m[t.id] = Math.max(0, Math.min(c.status === 'soldout' ? 1 : 0.985, base + t.bias))));
  return m;
};

export function useConcertStore({ queueSpeed = 1, humanChecks = 'normal', dropId = '', paymentTest = false } = {}) {
  const [S, setS] = useState(() => ({
    anchor: Date.now(), phase: 'home', tab: 'home', cid: 'halcyon', tier: null, saved: { mara: true }, tickets: [],
    queue: null, check: null, holdEnd: 0, qty: 2, pay: 'card', unread: true, city: CITIES[0], feed: [],
    apiDrop: null, apiDropError: '', apiEntryBusy: false, apiEntryError: '', entryId: '',
    ...load(), sheet: null, notif: false, q: '', genre: 'All', how: false,
    tier: load().tier || TIERS[0].id,
  }));
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');
  const ref = useRef(S); ref.current = S;
  const opts = useRef(); opts.current = { queueSpeed, freq: humanChecks === 'off' ? 0 : humanChecks === 'frequent' ? 4 : 2 };
  const timing = useRef({ last: performance.now(), lastFeed: 0 });
  const toastT = useRef();

  const set = useCallback(patch => setS(s => { const n = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }; persist(n); return n; }), []);
  const say = useCallback(m => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 2200); }, []);

  useEffect(() => {
    if (!dropId) {
      set({ apiDrop: null, apiDropError: 'No live drop is configured.' });
      return undefined;
    }
    let active = true;
    apiRequest(`/api/drops/${encodeURIComponent(dropId)}`)
      .then(drop => {
        if (!active) return;
        set(current => ({
          apiDrop: drop,
          apiDropError: '',
          tier: drop.tiers.some(tier => tier.tier_id === current.tier)
            ? current.tier : (drop.tiers[0]?.tier_id || null),
          qty: Math.min(current.qty, drop.max_quantity || 4),
        }));
      })
      .catch(error => {
        if (active) set({ apiDrop: null, apiDropError: error.message || 'Could not load the drop.' });
      });
    return () => { active = false; };
  }, [dropId, set]);

  useEffect(() => {
    const id = setInterval(() => {
      const nowMs = Date.now(), t = performance.now(), tm = timing.current;
      const dt = Math.min(1, (t - tm.last) / 1000); tm.last = t;
      const s = ref.current, patch = {}, { queueSpeed: sp, freq } = opts.current;
      if (s.phase === 'queue' && s.queue) {
        const q = { ...s.queue };
        if (s.check) {
          if (nowMs > s.check.deadline) { q.ahead = Math.min(q.total, q.ahead + 250); patch.check = newCheck('queue', null, 'Time ran out, so you moved back 250 places. One more try.'); }
        } else {
          q.ahead = Math.max(0, q.ahead - (50 + Math.random() * 45) * dt * sp);
          q.behind += Math.random() * 40 * dt;
          q.active += dt;
          if (freq > q.checks && q.active >= q.next && q.ahead > 300) { patch.check = newCheck('queue'); q.checks++; q.next = q.active + 12 + Math.random() * 14; }
          if (nowMs - tm.lastFeed > 1400) {
            tm.lastFeed = nowMs;
            const tr = TIERS[Math.floor(Math.random() * 4)];
            const sec = tr.id === 'floor' ? 'Floor' : tr.id === 'club' ? 'Club ' + (1 + Math.floor(Math.random() * 12)) : 'Section ' + ((tr.id === 'lower' ? 101 : 201) + Math.floor(Math.random() * 18));
            const n = 1 + Math.floor(Math.random() * 4);
            patch.feed = [{ text: `${sec} · ${n} ${n > 1 ? 'seats' : 'seat'} just sold`, at: nowMs }, ...(s.feed || [])].slice(0, 4);
          }
          if (q.ahead <= 0) {
            const sold = soldOf(s);
            Object.assign(patch, { phase: 'turn', holdEnd: nowMs + 600000, check: null, tier: s.tier && sold[s.tier] < 0.98 ? s.tier : 'lower' });
            setTimeout(scrollTop, 0);
          }
        }
        patch.queue = q;
      }
      if ((s.phase === 'turn' || s.phase === 'checkout') && s.holdEnd && nowMs > s.holdEnd) {
        Object.assign(patch, { phase: 'event', queue: null }); say('Your hold ran out. You can join again.');
      }
      if (Object.keys(patch).length) set(patch);
      setNow(nowMs);
    }, 200);
    return () => clearInterval(id);
  }, [set, say]);

  const go = useCallback((phase, extra) => { set({ phase, sheet: null, notif: false, ...extra }); scrollTop(); }, [set]);

  const registerEntry = useCallback(async () => {
    set({ apiEntryBusy: true, apiEntryError: '' });
    try {
      if (!dropId) throw new Error('This checkout is not connected to a live drop.');
      let token = '';
      try { token = sessionStorage.getItem('fairdrop.identity') || ''; } catch { /* unavailable */ }
      if (!token) throw new Error('Sign in before entering this drop.');

      const current = ref.current;
      const drop = current.apiDrop || await apiRequest(`/api/drops/${encodeURIComponent(dropId)}`);
      if (drop.phase !== 'open') throw new Error('Registration is not open for this drop.');
      if (drop.pow_required || drop.turnstile_required) {
        throw new Error('This drop requires a proof challenge that is not available in this frontend yet.');
      }
      const tier = drop.tiers.find(item => item.tier_id === current.tier);
      if (!tier) throw new Error('Choose a ticket section before entering.');

      const entry = await apiRequest(`/api/drops/${encodeURIComponent(dropId)}/entries`, {
        method: 'POST',
        token,
        body: { tier_id: tier.tier_id, quantity: Math.min(current.qty, drop.max_quantity || 4) },
      });
      sessionStorage.setItem('fairdrop.drop_id', dropId);
      sessionStorage.setItem('fairdrop.entry_id', entry.entry_id);
      set({ apiDrop: drop, apiDropError: '', entryId: entry.entry_id, check: null, phase: 'checkout', holdEnd: 0 });
      scrollTop();
    } catch (error) {
      set({ apiEntryError: error.message || 'Could not enter this drop.' });
      throw error;
    } finally {
      set({ apiEntryBusy: false });
    }
  }, [dropId, set]);

  const checkPass = useCallback(() => {
    set(s => ({ check: { ...s.check, status: 'ok', msg: 'Thanks, you’re verified.' } }));
    setTimeout(async () => {
      const c = ref.current.check; if (!c) return;
      if (c.mode === 'gate') {
        try {
          await registerEntry();
        } catch (error) {
          set({ check: null });
          say(error.message || 'Could not enter this drop.');
        }
      } else set({ check: null });
    }, 700);
  }, [set, registerEntry, say]);
  const checkFail = useCallback(text => set(s => ({ check: { ...newCheck(s.check.mode, s.check.type, text), deadline: s.check.deadline, bad: (s.check.bad || 0) + 1 } })), [set]);

  const actions = useMemo(() => ({
    go,
    enterPaymentTest: () => go('checkout'),
    setTab: id => { set(s => ({ tab: id, phase: s.phase === 'queue' ? 'queue' : 'home', sheet: null })); scrollTop(); },
    openSheet: id => set({ sheet: id, notif: false }),
    closeOverlays: () => set({ sheet: null, notif: false }),
    toggleNotif: () => set(s => ({ notif: !s.notif, unread: false })),
    cycleCity: () => set(s => ({ city: CITIES[(CITIES.indexOf(s.city) + 1) % CITIES.length] })),
    setQuery: q => set({ q }),
    setGenre: genre => set({ genre }),
    toggleSave: id => { const v = !ref.current.saved[id]; set(s => ({ saved: { ...s.saved, [id]: v } })); say(v ? 'Saved. We’ll remind you before sales open.' : 'Removed from saved'); },
    viewEvent: id => go('event', {
      cid: id,
      tier: ref.current.apiDrop?.tiers?.[0]?.tier_id || TIERS[0].id,
      how: false,
    }),
    pickTier: tier => set({ tier }),
    toggleHow: () => set(s => ({ how: !s.how })),
    joinQueue: () => registerEntry().catch(error => say(error.message || 'Could not enter this drop.')),
    waitlist: () => say('You’re on the waitlist. We’ll message you if seats open.'),
    leaveQueue: () => go('event', { queue: null, check: null }),
    slide: v => set(s => (s.check && s.check.status !== 'ok' ? { check: { ...s.check, val: v, msg: '' } } : {})),
    release: () => {
      const k = ref.current.check;
      if (!k || k.type !== 'slide' || k.status === 'ok' || !k.val) return;
      if (Math.abs(k.val - k.target) < 4.5) checkPass(); else checkFail('Not quite. Try again.');
    },
    tap: i => {
      const k = ref.current.check; if (!k || k.status === 'ok') return;
      const n = k.tiles[i];
      if (n === k.next) { set({ check: { ...k, next: k.next + 1 } }); if (n === 3) checkPass(); }
      else checkFail('That one’s out of order. New numbers.');
    },
    swapCheck: () => set(s => ({ check: { ...newCheck(s.check.mode, s.check.type === 'slide' ? 'tap' : 'slide'), deadline: s.check.deadline } })),
    cancelCheck: () => set({ check: null }),
    qty: d => set(s => ({ qty: Math.max(1, Math.min(s.apiDrop?.max_quantity || 4, s.qty + d)) })),
    setPay: pay => set({ pay }),
    toCheckout: () => go('checkout'),
    backToTurn: () => go('turn'),
    pay: () => {
      const s = ref.current, c = conOf(s), sel = s.tier || 'lower';
      const r = 'ABCDEFGHJKLM'[Math.floor(Math.random() * 12)], s0 = 4 + Math.floor(Math.random() * 18);
      const tk = {
        cid: c.id,
        sec: sel === 'floor' ? 'Floor' : sel === 'club' ? 'Club ' + (1 + Math.floor(Math.random() * 12)) : String((sel === 'lower' ? 101 : 201) + Math.floor(Math.random() * 18)),
        row: sel === 'floor' ? 'GA' : r,
        seats: sel === 'floor' ? `${s.qty} × GA` : s0 + (s.qty > 1 ? '–' + (s0 + s.qty - 1) : ''),
        order: 'FD-' + Math.random().toString(36).slice(2, 8).toUpperCase() + '-' + c.day + c.mon
      };
      go('done', { tickets: [tk, ...s.tickets], queue: null, holdEnd: 0 });
    },
    toTickets: () => go('home', { tab: 'tickets' }),
    goHome: () => go('home', { tab: 'home', queue: null })
  }), [go, set, say, checkPass, checkFail, registerEntry]);

  // derived
  const ctx = { now, anchor: S.anchor, saved: S.saved };
  const con = describe(conOf(S), ctx);
  const sold = soldOf(S);
  const tiers = S.apiDrop?.tiers?.length ? S.apiDrop.tiers.map((tier, index) => ({
    ...TIERS[index % TIERS.length],
    visualId: TIERS[index % TIERS.length].id,
    id: tier.tier_id,
    name: tier.name,
    price: tier.price_paise / 100,
    price_paise: tier.price_paise,
    priceFmt: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(tier.price_paise / 100),
    left: tier.capacity,
    leftFmt: `${tier.capacity.toLocaleString('en-IN')} capacity`,
    leftPct: '100%',
    on: S.tier === tier.tier_id,
  })) : TIERS.map(tier => {
    const left = Math.round(tier.cap * (1 - sold[tier.id]));
    return {
      ...tier,
      visualId: tier.id,
      price: Math.round(con.from * tier.mult),
      priceFmt: '$' + Math.round(con.from * tier.mult),
      left,
      leftFmt: `${left.toLocaleString('en-US')} preview seats`,
      leftPct: Math.round((1 - sold[tier.id]) * 100) + '%',
      on: S.tier === tier.id,
    };
  });
  const selectedTiers = tiers.map(t => {
    if (S.apiDrop) return t;
    return t;
  });
  const sel = selectedTiers.find(t => t.on) || selectedTiers[0];
  const subtotal = (sel?.price || 0) * S.qty, fees = 8.5 * S.qty;
  const holdLeft = Math.max(0, Math.ceil((S.holdEnd - now) / 1000));

  let buy = null;
  if (S.phase === 'event') {
    if (paymentTest) buy = { label: 'Test checkout', value: 'Razorpay Test Mode · ₹1', cta: 'Continue to test payment', tone: 'amber', disabled: !S.tier, onClick: actions.enterPaymentTest };
    else if (!dropId || !S.apiDrop) buy = { label: 'Live tickets', value: S.apiDropError || 'Connecting…', cta: 'Unavailable', tone: 'muted', disabled: true };
    else if (S.apiDrop.phase !== 'open') buy = { label: 'Registration', value: S.apiDrop.phase, cta: 'Closed', tone: 'muted', disabled: true };
    else if (S.apiDrop.pow_required || S.apiDrop.turnstile_required) buy = { label: 'Registration', value: 'Proof challenge required', cta: 'Unavailable', tone: 'muted', disabled: true };
    else buy = { label: S.tier ? sel?.name : 'Choose a section', value: S.tier ? sel?.priceFmt : '', cta: S.apiEntryBusy ? 'Entering…' : 'Enter the draw', tone: 'violet', disabled: !S.tier || S.apiEntryBusy, onClick: actions.joinQueue };
  } else if (S.phase === 'turn') {
    buy = { label: `${S.qty} × ${sel?.name || 'ticket'}`, value: money(subtotal + fees), cta: 'Continue', tone: 'amber', disabled: !sel?.left, onClick: actions.toCheckout };
  }

  return {
    S, now, toast, actions, con, sold, tiers: selectedTiers, sel, buy, prog: progOf(S), apiDrop: S.apiDrop, apiDropError: S.apiDropError, paymentTest,
    capacity: S.apiDrop?.tiers?.reduce((sum, tier) => sum + tier.capacity, 0) || CAPACITY,
    describe: c => describe(c, ctx),
    totals: { subtotal: money(subtotal), fees: money(fees), total: money(subtotal + fees) },
    hold: { left: holdLeft, str: String(Math.floor(holdLeft / 60)).padStart(2, '0') + ':' + String(holdLeft % 60).padStart(2, '0') },
    queueSpeed
  };
}
