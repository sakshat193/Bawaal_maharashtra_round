import * as T from 'three';
import { TIERS } from '../pages/concert/data.js';

/**
 * Schematic stadium bowl (< 3k triangles). Modes:
 *  event — selectable tiers, drag to orbit, wheel/pinch to zoom
 *  turn  — same, sold seats glow amber
 *  queue — seats light up as they sell; a stream of people flows to the gate, you are the bright point
 */
export function createVenue(el, { reduced = false, onPick = () => {} } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(38, 1, 0.1, 100);
  const root = new T.Group(); scene.add(root);
  const P = (r, a, y) => new T.Vector3(Math.sin(a) * r * 1.3, y, -Math.cos(a) * r);
  const TD = {
    lower: { r0: 2.7, r1: 3.7, y0: 0.12, y1: 0.95, a0: 0.62, n: 14, rows: 4, per: 64 },
    club: { r0: 3.82, r1: 4.1, y0: 1.05, y1: 1.18, a0: 0.62, n: 12, rows: 1, per: 70 },
    upper: { r0: 4.25, r1: 5.5, y0: 1.32, y1: 2.55, a0: 0.42, n: 18, rows: 5, per: 86 }
  };
  const COL = {}; TIERS.forEach(t => (COL[t.id] = new T.Color(t.color)));
  const fills = {}, lines = {}, picks = [], disposables = [];
  TIERS.forEach(t => {
    fills[t.id] = new T.MeshBasicMaterial({ color: COL[t.id], transparent: true, opacity: 0.05, side: T.DoubleSide, depthWrite: false });
    lines[t.id] = new T.LineBasicMaterial({ color: COL[t.id], transparent: true, opacity: 0.35 });
    disposables.push(fills[t.id], lines[t.id]);
  });
  const addMesh = (geo, id) => {
    const m = new T.Mesh(geo, fills[id]); m.userData.tier = id; root.add(m); picks.push(m);
    const eg = new T.EdgesGeometry(geo, 1); root.add(new T.LineSegments(eg, lines[id])); disposables.push(geo, eg);
  };
  Object.keys(TD).forEach(id => {
    const d = TD[id], span = (Math.PI * 2 - 2 * d.a0) / d.n;
    for (let i = 0; i < d.n; i++) {
      const v = [], idx = [], sub = 3;
      for (let j = 0; j <= sub; j++) {
        const a = d.a0 + span * i + 0.025 + (span - 0.05) * j / sub, pi = P(d.r0, a, d.y0), po = P(d.r1, a, d.y1);
        v.push(pi.x, pi.y, pi.z, po.x, po.y, po.z);
        if (j) { const b = (j - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3)); g.setIndex(idx);
      addMesh(g, id);
    }
  });
  const fg = new T.PlaneGeometry(3.4, 2.9); fg.rotateX(-Math.PI / 2); fg.translate(0, 0.01, 0.55); addMesh(fg, 'floor');
  const stage = new T.BoxGeometry(2.6, 0.22, 0.7); stage.translate(0, 0.11, -2.15);
  root.add(new T.LineSegments(new T.EdgesGeometry(stage), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
  root.add(new T.Mesh(stage, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false })));

  const seats = [];
  let s = 0xbeef; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  Object.keys(TD).forEach(id => {
    const d = TD[id];
    for (let k = 0; k < d.rows; k++) {
      const f = (k + 0.5) / d.rows, r = d.r0 + (d.r1 - d.r0) * f, y = d.y0 + (d.y1 - d.y0) * f + 0.03;
      for (let j = 0; j < d.per; j++) { const a = d.a0 + (Math.PI * 2 - 2 * d.a0) * (j + 0.5) / d.per; seats.push({ id, p: P(r, a, y), thr: rnd(), st: -1 }); }
    }
  });
  for (let i = 0; i < 12; i++) for (let j = 0; j < 10; j++) seats.push({ id: 'floor', p: new T.Vector3(-1.5 + i * 3 / 11, 0.03, -0.75 + j * 2.6 / 9), thr: rnd(), st: -1, flat: true });
  const inst = new T.InstancedMesh(new T.PlaneGeometry(0.1, 0.1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }), seats.length);
  const dm = new T.Object3D(), C = new T.Color();
  seats.forEach((st, i) => {
    dm.position.copy(st.p); dm.rotation.set(0, 0, 0);
    if (st.flat) dm.rotation.x = -Math.PI / 2; else dm.lookAt(0, st.p.y + 3, 0);
    dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); inst.setColorAt(i, C.set(0x000000));
  });
  root.add(inst);

  const dc = document.createElement('canvas'); dc.width = dc.height = 64;
  const g2 = dc.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const dot = new T.CanvasTexture(dc);
  const curve = new T.QuadraticBezierCurve3(new T.Vector3(9, 0.05, 11), new T.Vector3(7.5, 0.05, 6.5), new T.Vector3(0, 0.05, 6.4));
  const QN = 150, qpos = new Float32Array(QN * 3), qcol = new Float32Array(QN * 3);
  const qg = new T.BufferGeometry(); qg.setAttribute('position', new T.BufferAttribute(qpos, 3)); qg.setAttribute('color', new T.BufferAttribute(qcol, 3));
  const qPts = new T.Points(qg, new T.PointsMaterial({ size: 0.22, map: dot, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  const yg = new T.BufferGeometry(); yg.setAttribute('position', new T.BufferAttribute(new Float32Array(3), 3));
  const yMat = new T.PointsMaterial({ size: 0.75, map: dot, color: 0xecfeff, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
  const gate = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(1.1, 0.6)), new T.LineBasicMaterial({ color: 0x67e8f9 }));
  gate.position.set(0, 0.3, 6.2);
  const qGroup = new T.Group(); qGroup.add(qPts, new T.Points(yg, yMat), gate); root.add(qGroup);

  let raf = 0, t = 0, last = performance.now(), mode = 'event', tier = null, sold = {}, prog = 0;
  let yaw = 0.6, pitch = 0.42, zoom = 1, dragging = false, lastUser = -1e9;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const amber = new T.Color('#F59E0B'), hot = new T.Color('#FFF4DC'), dark = new T.Color('#16151F'), cyan = new T.Color('#22D3EE'), dim = new T.Color('#0E3A44');
  const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const draw = dt => {
    t += dt;
    if (mode === 'queue') {
      const a = 0.55 + Math.sin(t * 0.12) * 0.35, R = 14.5 * Math.max(1, 1.25 / cam.aspect);
      cam.position.set(Math.sin(a) * R, 7.5, Math.cos(a) * R); cam.lookAt(1.2, 0.6, 2.4);
    } else {
      if (!reduced && !dragging && performance.now() - lastUser > 4000) yaw += dt * 0.06;
      const R = 15 * Math.max(1, 1.5 / cam.aspect) * zoom;
      cam.position.set(Math.sin(yaw) * Math.cos(pitch) * R, Math.sin(pitch) * R, Math.cos(yaw) * Math.cos(pitch) * R); cam.lookAt(0, 0.7, 0);
    }
    TIERS.forEach(tr => {
      const on = tier === tr.id && mode !== 'queue';
      fills[tr.id].opacity += ((on ? 0.22 : 0.04) - fills[tr.id].opacity) * Math.min(1, dt * 8 + (reduced ? 1 : 0));
      lines[tr.id].opacity = on ? 0.95 : mode === 'queue' ? 0.22 : 0.4;
    });
    const pulse = 0.8 + 0.2 * Math.sin(t * 4);
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i], isSold = st.thr < (sold[st.id] || 0);
      if (isSold && st.st < 0) st.st = t; if (!isSold) st.st = -1;
      if (mode === 'queue') {
        if (isSold) { const f = Math.min(1, (t - st.st) / 0.9); C.copy(hot).lerp(amber, f).multiplyScalar(0.6 + 0.9 * (1 - f)); }
        else C.copy(COL[st.id]).multiplyScalar(0.12);
      } else if (isSold) C.copy(mode === 'turn' ? amber : dark).multiplyScalar(mode === 'turn' ? 0.22 : 1);
      else C.copy(COL[st.id]).multiplyScalar(tier === st.id ? pulse : tier ? 0.18 : 0.45);
      inst.setColorAt(i, C);
    }
    inst.instanceColor.needsUpdate = true;
    qGroup.visible = mode === 'queue';
    if (mode === 'queue') {
      const ty = 0.06 + 0.88 * prog, v = new T.Vector3();
      for (let i = 0; i < QN; i++) {
        const u = ((i / QN) + t * 0.018) % 1; curve.getPoint(u, v);
        qpos[i * 3] = v.x + Math.sin(i * 12.9898) * 0.18; qpos[i * 3 + 1] = v.y; qpos[i * 3 + 2] = v.z + Math.cos(i * 4.1) * 0.18;
        const c = u > ty ? cyan : dim; qcol[i * 3] = c.r; qcol[i * 3 + 1] = c.g; qcol[i * 3 + 2] = c.b;
      }
      qg.attributes.position.needsUpdate = true; qg.attributes.color.needsUpdate = true;
      curve.getPoint(ty, v); const yp = yg.attributes.position.array; yp[0] = v.x; yp[1] = v.y + 0.12; yp[2] = v.z; yg.attributes.position.needsUpdate = true;
      yMat.size = 0.65 + 0.15 * Math.sin(t * 5);
    }
    renderer.render(scene, cam);
  };
  const loop = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; draw(dt); raf = requestAnimationFrame(loop); };
  const redraw = () => { if (reduced) draw(0); };

  // interaction: drag = orbit, wheel / pinch = zoom, tap = pick section
  const ray = new T.Raycaster(), mv = new T.Vector2(), cv = renderer.domElement, ptrs = new Map();
  let moved = 0, pinch0 = 1, zoom0 = 1;
  cv.style.touchAction = 'none'; cv.style.cursor = 'grab';
  const pick = e => {
    const r = cv.getBoundingClientRect();
    mv.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mv, cam);
    const hit = ray.intersectObjects(picks)[0];
    if (hit) onPick(hit.object.userData.tier);
  };
  const dist = () => { const p = [...ptrs.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1; };
  const down = e => {
    if (mode === 'queue') return;
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) moved = 0;
    if (ptrs.size === 2) { pinch0 = dist(); zoom0 = zoom; }
    dragging = true; lastUser = performance.now(); cv.style.cursor = 'grabbing';
  };
  const move = e => {
    if (!ptrs.has(e.pointerId)) return;
    const pr = ptrs.get(e.pointerId), dx = e.clientX - pr[0], dy = e.clientY - pr[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1) { yaw -= dx * 0.008; pitch = clamp(pitch + dy * 0.006, 0.12, 1.35); }
    else if (ptrs.size === 2) zoom = clamp(zoom0 * pinch0 / dist(), 0.4, 1.7);
    lastUser = performance.now(); redraw();
  };
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!ptrs.size) { dragging = false; cv.style.cursor = 'grab'; if (e.type === 'pointerup' && moved < 8) pick(e); }
    lastUser = performance.now();
  };
  const wheel = e => { if (mode === 'queue') return; e.preventDefault(); zoom = clamp(zoom * Math.exp(e.deltaY * 0.0012), 0.4, 1.7); lastUser = performance.now(); redraw(); };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', wheel, { passive: false });

  const ro = new ResizeObserver(() => { resize(); redraw(); }); ro.observe(el); resize();
  if (reduced) draw(0); else raf = requestAnimationFrame(loop);

  return {
    setMode(m) { mode = m; redraw(); },
    setTier(id) { tier = id; redraw(); },
    setSold(m) { sold = m; redraw(); },
    setProgress(p) { prog = p; },
    zoomBy(k) { zoom = clamp(zoom * k, 0.4, 1.7); lastUser = performance.now(); redraw(); },
    resetView() { yaw = 0.6; pitch = 0.42; zoom = 1; lastUser = -1e9; redraw(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); disposables.forEach(d => d.dispose()); renderer.dispose(); cv.remove(); }
  };
}
