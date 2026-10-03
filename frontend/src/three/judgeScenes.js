import * as T from 'three';

/** SUBNET CLUSTERING point cloud + THE ARENA seat bowl for the judge dashboard. */
export function createJudgeScenes(cloudEl, arenaEl, { reduced = false, getCap = () => true, onClaimed = () => {} } = {}) {
  const mk = el => {
    const r = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setClearColor(0, 0);
    r.domElement.style.cssText = 'width:100%;height:100%;display:block;'; el.appendChild(r.domElement);
    const cam = new T.PerspectiveCamera(36, 1, 0.1, 100);
    const fit = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(() => { fit(); if (reduced) redraw(); }); ro.observe(el); fit();
    return { r, cam, scene: new T.Scene(), ro };
  };
  let s = 0xc10d; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;

  const A = mk(cloudEl);
  const H = 11000, B = 4812, NB = 600, tot = H + B + NB;
  const p = new Float32Array(tot * 3), bot = new Float32Array(tot), rr = new Float32Array(tot);
  let k = 0;
  for (let c = 0; c < 550; c++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 3.2, cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    for (let j = 0; j < 20 && k < H; j++, k++) { p[k * 3] = cx + (rnd() - 0.5) * 0.18; p[k * 3 + 1] = rnd() * 0.12 * (1 + rnd()); p[k * 3 + 2] = cz + (rnd() - 0.5) * 0.18; rr[k] = rnd(); }
  }
  const spikes = [[1.3, -0.6, B, 2.8], [-1.6, 1.1, NB * 0.6, 0.9], [-0.4, -2.1, NB * 0.4, 0.6]];
  for (const [x, z, n, hgt] of spikes) for (let j = 0; j < n; j++, k++) { const a = rnd() * 6.283, d = rnd() * 0.09; p[k * 3] = x + Math.cos(a) * d; p[k * 3 + 1] = Math.pow(rnd(), 0.8) * hgt; p[k * 3 + 2] = z + Math.sin(a) * d; bot[k] = 1; rr[k] = rnd(); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(p.subarray(0, k * 3), 3));
  g.setAttribute('aBot', new T.BufferAttribute(bot.subarray(0, k), 1));
  g.setAttribute('aR', new T.BufferAttribute(rr.subarray(0, k), 1));
  const uc = { uCap: { value: getCap() ? 1 : 0 }, uPR: { value: A.r.getPixelRatio() } };
  const m = new T.ShaderMaterial({
    uniforms: uc, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute float aBot; attribute float aR; uniform float uCap, uPR; varying vec3 vC;
      void main(){ vec3 q = position; q.y *= mix(1.0, 0.06, uCap * aBot);
        vC = aBot > 0.5 ? mix(vec3(0.96,0.62,0.05)*0.55, vec3(0.96,0.62,0.05)*0.25, uCap) : vec3(0.13,0.83,0.93) * (0.6 + 0.3 * aR);
        vec4 mv = modelViewMatrix * vec4(q,1.0); gl_PointSize = (aBot > 0.5 ? 2.6 : 2.8) * uPR * 7.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ float r = length(gl_PointCoord-0.5); if(r>0.5) discard; float k = smoothstep(0.5,0.0,r); gl_FragColor = vec4(vC*k*k, k); }`
  });
  A.scene.add(new T.Points(g, m));
  A.scene.add(new T.PolarGridHelper(3.6, 12, 6, 64, 0x2a2540, 0x1a1828));

  const Bn = mk(arenaEl);
  const rings = 10, rad = [], cnt = [];
  let sum = 0; for (let i = 0; i < rings; i++) { rad.push(1.3 + i * 0.22); sum += rad[i]; }
  let acc = 0; for (let i = 0; i < rings; i++) { const c = i === rings - 1 ? 500 - acc : Math.round(500 * rad[i] / sum); cnt.push(c); acc += c; }
  const inst = new T.InstancedMesh(new T.PlaneGeometry(0.13, 0.15), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, blending: T.AdditiveBlending, depthWrite: false }), 500);
  const dmy = new T.Object3D(), dark = new T.Color('#1d1b2c'), amber = new T.Color('#F59E0B'), hot = new T.Color('#FFF4DC');
  let idx = 0;
  for (let i = 0; i < rings; i++) {
    const y = i * 0.17, gap = 0.5;
    for (let j = 0; j < cnt[i]; j++, idx++) {
      const a = gap / 2 + (j / cnt[i]) * (Math.PI * 2 - gap);
      dmy.position.set(Math.cos(a) * rad[i], y, Math.sin(a) * rad[i]);
      dmy.lookAt(0, y + rad[i] * 0.8, 0); dmy.updateMatrix();
      inst.setMatrixAt(idx, dmy.matrix); inst.setColorAt(idx, dark);
    }
  }
  Bn.scene.add(inst);
  for (let i = 0; i < rings; i += 3) {
    const pts = []; for (let j = 0; j <= 96; j++) { const a = j / 96 * Math.PI * 2; pts.push(new T.Vector3(Math.cos(a) * (rad[i] - 0.12), i * 0.17 - 0.02, Math.sin(a) * (rad[i] - 0.12))); }
    Bn.scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x2a2540 })));
  }
  const stage = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(0.9, 0.5)), new T.LineBasicMaterial({ color: 0x5b4b8a }));
  stage.rotation.x = -Math.PI / 2; stage.position.set(0.4, 0, 0); Bn.scene.add(stage);
  const order = Array.from({ length: 500 }, (_, i) => i);
  for (let i = 499; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const claimT = new Float32Array(500).fill(-1);

  let t = 0, last = performance.now(), raf = 0, cap = uc.uCap.value, claimed = 0, cycle = 0, lastRep = -1;
  const C = new T.Color();
  function redraw() { uc.uCap.value = getCap() ? 1 : 0; A.r.render(A.scene, A.cam); Bn.r.render(Bn.scene, Bn.cam); }
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    cap += ((getCap() ? 1 : 0) - cap) * (1 - Math.exp(-dt * 6)); uc.uCap.value = cap;
    const oa = t * 0.07;
    const ad = 8 * Math.max(1, 1.2 / A.cam.aspect);
    A.cam.position.set(Math.cos(oa) * ad, ad * 0.52, Math.sin(oa) * ad); A.cam.lookAt(0, 0.7, 0);
    const bd = 8.8 * Math.max(1, 1.45 / Bn.cam.aspect);
    Bn.cam.position.set(Math.cos(-oa * 0.8) * bd, bd * 0.64, Math.sin(-oa * 0.8) * bd); Bn.cam.lookAt(0, 0.5, 0);
    cycle += dt;
    const target = Math.min(500, Math.floor(500 * (1 - Math.pow(1 - Math.min(1, cycle / 50), 1.6))));
    while (claimed < target) { claimT[order[claimed]] = t; claimed++; }
    if (cycle > 58) { cycle = 0; claimed = 0; claimT.fill(-1); }
    for (let i = 0; i < 500; i++) {
      if (claimT[i] < 0) C.copy(dark); else { const f = Math.min(1, (t - claimT[i]) / 0.6); C.copy(hot).lerp(amber, f).multiplyScalar(0.9 + 0.6 * (1 - f)); }
      inst.setColorAt(i, C);
    }
    inst.instanceColor.needsUpdate = true;
    if (claimed !== lastRep && Math.floor(t * 4) !== Math.floor((t - dt) * 4)) { lastRep = claimed; onClaimed(claimed); }
    A.r.render(A.scene, A.cam); Bn.r.render(Bn.scene, Bn.cam);
    raf = requestAnimationFrame(frame);
  };
  if (reduced) {
    A.cam.position.set(6, 4.2, 5); A.cam.lookAt(0, 0.7, 0); Bn.cam.position.set(6.6, 5.6, 5.4); Bn.cam.lookAt(0, 0.5, 0);
    for (let i = 0; i < 312; i++) inst.setColorAt(order[i], amber);
    onClaimed(312); redraw();
  } else raf = requestAnimationFrame(frame);
  return {
    redraw,
    dispose() { cancelAnimationFrame(raf); [A, Bn].forEach(x => { x.ro.disconnect(); x.r.dispose(); x.r.domElement.remove(); }); g.dispose(); m.dispose(); }
  };
}
