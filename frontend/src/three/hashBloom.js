import * as T from 'three';

/** HASH BLOOM — a deterministic form built from a hash's 32 bytes. Same bytes → same shape. */
export function createBloom(el, commitHex, { reduced = false } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(34, 1, 0.1, 50);
  cam.position.set(0, 0.6, 7.2); cam.lookAt(0, 0, 0);
  const tc = document.createElement('canvas'); tc.width = tc.height = 64;
  const g2 = tc.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const dot = new T.CanvasTexture(tc);

  const shape = hex => {
    const by = []; for (let i = 0; i < 32; i++) by.push(parseInt(hex.substr(i * 2, 2), 16));
    const lines = [], tips = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 32; i++) {
      const y = 1 - 2 * (i + 0.5) / 32, r = Math.sqrt(1 - y * y), th = ga * i + (by[i] / 255 - 0.5) * 0.9;
      const d = new T.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
      const perp = new T.Vector3().crossVectors(d, new T.Vector3(0, 1, 0.3)).normalize();
      const L = 0.55 + by[i] / 255 * 1.15, tw = (by[(i + 7) % 32] / 255 - 0.5) * 1.2;
      let prev = null;
      for (let k = 0; k <= 8; k++) {
        const s = k / 8, p = d.clone().multiplyScalar(L * s).addScaledVector(perp, Math.sin(s * Math.PI) * tw * L * 0.35);
        if (prev) lines.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
      tips.push(prev);
    }
    for (let i = 0; i < 32; i++) { const a = tips[i], b = tips[(i + 1 + (by[i] % 5)) % 32]; lines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const g = new T.Group();
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(lines, 3));
    const lm = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false });
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.Float32BufferAttribute(tips.flatMap(v => [v.x, v.y, v.z]), 3));
    const pm = new T.PointsMaterial({ size: 0.16, map: dot, transparent: true, blending: T.AdditiveBlending, depthWrite: false, color: 0xffffff });
    g.add(new T.LineSegments(lg, lm)); g.add(new T.Points(pg, pm));
    g.userData = { lm, pm, dispose: () => { lg.dispose(); pg.dispose(); lm.dispose(); pm.dispose(); } };
    return g;
  };
  const root = new T.Group(); scene.add(root);
  const commit = shape(commitHex); root.add(commit);
  const cV = new T.Color('#8B5CF6'), cC = new T.Color('#22D3EE'), cW = new T.Color('#ECFEFF');
  let input = null, u = 1, match = false, t = 0, last = performance.now(), raf = 0, flash = 0;
  const apply = dt => {
    t += dt;
    root.rotation.y += dt * (match ? 0.08 : 0.16);
    root.rotation.x = 0.18 + Math.sin(t * 0.3) * 0.05;
    if (input) {
      u = Math.min(1, u + dt / 1.3);
      const e = 1 - Math.pow(1 - u, 4);
      input.scale.setScalar(0.02 + 0.98 * e); input.rotation.y = (1 - e) * 2.4;
      const col = match ? cW : cC;
      input.userData.lm.color.copy(col); input.userData.pm.color.copy(col);
      input.userData.lm.opacity = match ? 0.9 : 0.75;
    }
    flash = Math.max(0, flash - dt * 0.6);
    const ce = match ? cC.clone().lerp(cW, flash * (u >= 1 ? 1 : 0)) : cV;
    commit.userData.lm.color.copy(ce); commit.userData.pm.color.copy(ce);
    commit.userData.lm.opacity = match ? 0.45 + 0.4 * flash : 0.75;
    renderer.render(scene, cam);
  };
  const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); if (reduced) apply(0); };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  const frame = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; apply(dt); raf = requestAnimationFrame(frame); };
  if (reduced) apply(0); else raf = requestAnimationFrame(frame);
  return {
    setInput(hex, m) {
      if (input) { root.remove(input); input.userData.dispose(); input = null; }
      match = m;
      if (hex) { input = shape(hex); root.add(input); u = reduced ? 1 : 0; }
      flash = m ? 1 : 0;
      if (reduced) apply(0);
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
