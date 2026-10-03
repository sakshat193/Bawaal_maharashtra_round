import * as T from 'three';

/**
 * THE DRUM — 50,000 shader points, one per entry.
 * phases: idle | filling | sealed | draw | won | lost
 */
export function createDrum(el, { reduced = false, onEntries = () => {}, phase: initial = 'idle' } = {}) {
  const N = 50000, FMAX = 49812, W = 500, EMPTY = -1000, DUR = 90;
  const renderer = new T.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr); renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(32, 1, 0.1, 100);
  const pos = new Float32Array(N * 3), spawn = new Float32Array(N * 3), fill = new Float32Array(N), win = new Float32Array(N), rnd = new Float32Array(N);
  let s = 0x0417; const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const R = 1.6, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = ga * i, rr = R * (0.9 + 0.1 * Math.sqrt(rand()));
    pos[i * 3] = Math.cos(th) * r * rr; pos[i * 3 + 1] = y * rr; pos[i * 3 + 2] = Math.sin(th) * r * rr;
    const a = rand() * Math.PI * 2, d = 5 + rand() * 4;
    spawn[i * 3] = Math.cos(a) * d; spawn[i * 3 + 1] = Math.sin(a) * d * 0.7; spawn[i * 3 + 2] = (rand() - 0.5) * 3;
    fill[i] = EMPTY; rnd[i] = rand();
  }
  const order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (let k = 0; k < W; k++) win[order[Math.floor(k * FMAX / W + rand() * FMAX / W)]] = 1;

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aSpawn', new T.BufferAttribute(spawn, 3));
  const fillAttr = new T.BufferAttribute(fill, 1); fillAttr.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('aFill', fillAttr);
  geo.setAttribute('aWin', new T.BufferAttribute(win, 1));
  geo.setAttribute('aRnd', new T.BufferAttribute(rnd, 1));
  const COL = { idle: new T.Vector3(0.486, 0.227, 0.929), draw: new T.Vector3(0.133, 0.827, 0.933), won: new T.Vector3(0.961, 0.62, 0.043) };
  const uniforms = { uTime: { value: 0 }, uTw: { value: 0 }, uIgnite: { value: EMPTY }, uPR: { value: pr }, uScale: { value: 8 }, uAccent: { value: COL.idle.clone() } };
  const mat = new T.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
    vertexShader: `
      attribute vec3 aSpawn; attribute float aFill; attribute float aWin; attribute float aRnd;
      uniform float uTime, uTw, uIgnite, uPR, uScale; uniform vec3 uAccent;
      varying vec3 vCol;
      void main(){
        bool empty = aFill < -500.0;
        float f = empty ? 1.0 : clamp((uTime - aFill) / 1.6, 0.0, 1.0);
        float ef = 1.0 - pow(1.0 - f, 3.0);
        vec3 p = empty ? position : mix(aSpawn, position, ef);
        float on = uIgnite > -500.0 ? 1.0 : 0.0;
        float g = on * clamp((uTime - uIgnite - aRnd * 0.5) / 1.3, 0.0, 1.0);
        float eg = 1.0 - pow(1.0 - g, 4.0);
        float w = empty ? 0.0 : aWin;
        p *= 1.0 + w * eg * (0.18 + aRnd * 0.32);
        float tw = 0.72 + 0.28 * sin(uTw * (0.8 + aRnd * 2.2) + aRnd * 40.0);
        vec3 c; float sz;
        if (empty) { c = uAccent * (aRnd < 0.22 ? 0.85 : 0.0) * tw; sz = 1.7; }
        else {
          c = mix(uAccent, vec3(1.0), 0.18 + 0.35 * aRnd) * 0.4 * tw + vec3(0.85, 0.9, 1.0) * (1.0 - f) * 0.9;
          sz = 1.9 * (1.0 + (1.0 - f) * 1.6);
        }
        float gd = on * clamp((uTime - uIgnite) / 1.1, 0.0, 1.0);
        c = mix(c, c * 0.05, gd * (1.0 - w));
        c = mix(c, mix(vec3(1.7), uAccent * 1.8 + 0.6, 0.25), eg * w);
        sz = mix(sz, 5.5, eg * w);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = sz * uPR * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
        vCol = c;
      }`,
    fragmentShader: `
      varying vec3 vCol;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float m = max(vCol.r, max(vCol.g, vCol.b));
        if (m < 0.004) discard;
        float k = smoothstep(0.5, 0.0, r); k *= k;
        gl_FragColor = vec4(vCol * k, clamp(m * k, 0.0, 1.0));
      }`
  });
  const pts = new T.Points(geo, mat);
  const tilt = new T.Group(); tilt.rotation.x = 0.28; tilt.rotation.z = 0.1;
  tilt.add(pts); scene.add(tilt);

  let t = 0, tw = 0, rot = 0.6, speed = 0.06, alive = reduced ? 0 : 1, phase = 'idle', fillStart = 0, filled = 0, igniteAt = EMPTY, lastReport = -1, raf = 0, last = performance.now();
  const report = n => { if (n !== lastReport) { lastReport = n; onEntries(n); } };
  const fillAll = () => { for (let k = filled; k < FMAX; k++) fill[order[k]] = t - 5; filled = FMAX; fillAttr.needsUpdate = true; };
  const reset = () => { for (let i = 0; i < N; i++) fill[i] = EMPTY; filled = 0; fillAttr.needsUpdate = true; };
  const render = () => renderer.render(scene, cam);
  const accentFor = p => p === 'draw' ? COL.draw : p === 'won' ? COL.won : COL.idle;
  const setPhase = p => {
    if (p === 'idle' || p === 'filling') { reset(); fillStart = t; } else fillAll();
    if (p === 'draw') igniteAt = reduced ? -100 : t + 1.6;
    else if (p === 'won' || p === 'lost') { if (igniteAt <= EMPTY) igniteAt = t - 5; }
    else igniteAt = EMPTY;
    phase = p;
    if (reduced) {
      uniforms.uAccent.value.copy(accentFor(p)); uniforms.uIgnite.value = igniteAt === EMPTY ? EMPTY : -100;
      if (p === 'idle' || p === 'filling') fillAll();
      uniforms.uTime.value = 0; render();
    }
    report(p === 'idle' ? 0 : p === 'filling' ? (reduced ? 0 : filled) : FMAX);
  };
  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.position.set(0, 0, 7.4 / Math.min(1, cam.aspect)); cam.updateProjectionMatrix();
    uniforms.uScale.value = 8 * h / 700;
    if (reduced) render();
  };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const speedT = { idle: 0.06, filling: 0.14 }[phase] || 0;
    const aliveT = (phase === 'idle' || phase === 'filling') ? 1 : 0;
    const k = 1 - Math.exp(-dt * 4);
    speed += (speedT - speed) * k; alive += (aliveT - alive) * k;
    rot += speed * dt; tw += dt * alive;
    pts.rotation.y = rot;
    if (phase === 'filling' && filled < FMAX) {
      const x = Math.min(1, (t - fillStart) / DUR), target = Math.floor(FMAX * (1 - Math.pow(1 - x, 2.2)));
      if (target > filled) { for (let j = filled; j < target; j++) fill[order[j]] = t + Math.random() * 0.15; filled = target; fillAttr.needsUpdate = true; }
      if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) report(filled);
    }
    uniforms.uAccent.value.lerp(accentFor(phase), 1 - Math.exp(-dt * 5));
    uniforms.uTime.value = t; uniforms.uTw.value = tw; uniforms.uIgnite.value = igniteAt;
    render();
    raf = requestAnimationFrame(frame);
  };

  setPhase(initial);
  if (!reduced) raf = requestAnimationFrame(frame);
  return {
    setPhase,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); geo.dispose(); mat.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
