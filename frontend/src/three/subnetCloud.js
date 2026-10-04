import * as T from 'three';

const MAX_POINTS = 6000;
const COLORS = { ok: '#67E8F9', amber: '#F59E0B', red: '#F87171' };

function hash(text) {
  let h = 2166136261;
  for (const character of text) h = Math.imul(h ^ character.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Pure placement: one cluster per subnet at a stable spot, spike height grows with log(entries). */
export function cloudLayout(rows = []) {
  const total = rows.reduce((sum, row) => sum + row.entries, 0);
  const unit = Math.max(1, Math.ceil(total / MAX_POINTS));
  const points = [];
  for (const row of rows) {
    const seed = hash(row.subnet);
    const angle = (seed % 3600) / 3600 * Math.PI * 2;
    const radius = 0.4 + ((seed >>> 12) % 1000) / 1000 * 2.8;
    const cx = Math.cos(angle) * radius, cz = Math.sin(angle) * radius;
    const height = 0.15 + Math.log2(1 + row.entries) * 0.35;
    const count = Math.max(1, Math.ceil(row.entries / unit));
    let s = seed || 1;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 0.12;
      points.push({ x: cx + Math.cos(a) * d, y: Math.pow(rnd(), 0.8) * height, z: cz + Math.sin(a) * d, level: row.level });
    }
  }
  return { unit, points };
}

export function createSubnetCloud(el, { reduced = false } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
  const scene = new T.Scene();
  scene.add(new T.PolarGridHelper(3.6, 12, 6, 64, 0x2a2540, 0x1a1828));
  let cloud = null, t = 0, last = performance.now(), raf = 0;

  const fit = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const observer = new ResizeObserver(fit);
  observer.observe(el);

  function dropCloud() {
    if (!cloud) return;
    scene.remove(cloud);
    cloud.geometry.dispose();
    cloud.material.dispose();
    cloud = null;
  }

  function setData(rows) {
    dropCloud();
    const { points } = cloudLayout(rows);
    const position = new Float32Array(points.length * 3), color = new Float32Array(points.length * 3);
    const c = new T.Color();
    points.forEach((p, i) => {
      position.set([p.x, p.y, p.z], i * 3);
      c.set(COLORS[p.level]).toArray(color, i * 3);
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3));
    geometry.setAttribute('color', new T.BufferAttribute(color, 3));
    cloud = new T.Points(geometry, new T.PointsMaterial({
      size: 0.06, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending
    }));
    scene.add(cloud);
    draw();
  }

  function draw() {
    const angle = t * 0.07, dist = 8 * Math.max(1, 1.2 / camera.aspect);
    camera.position.set(Math.cos(angle) * dist, dist * 0.52, Math.sin(angle) * dist);
    camera.lookAt(0, 0.7, 0);
    renderer.render(scene, camera);
  }
  const frame = now => {
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  };
  if (!reduced) raf = requestAnimationFrame(frame);
  fit();

  return {
    setData,
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      dropCloud();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
