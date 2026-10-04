import * as T from 'three';
import { layout } from './venue.js';

// Red-Amber-Green seat states. "mine" is amber too (it is locked), drawn larger with a light core.
export const SEAT_COLORS = Object.freeze({
  available: '#22C55E',
  locked: '#F59E0B',
  booked: '#EF4444',
  mine: '#FCD34D'
});
const PICK_RADIUS_PX = 14;

export function seatState(index, { booked, locked, mine }) {
  if (mine.has(index)) return 'mine';
  if (booked.has(index)) return 'booked';
  if (locked.has(index)) return 'locked';
  return 'available';
}

/**
 * 3D seat picker over the same stadium model as the venue view. Only the winner's tier is
 * clickable; other tiers are drawn dim for context. One dot = one seat (unitSize 1), and
 * dot.index is the seat_index the seat API uses.
 */
export function createSeatMap(el, { tiers = [], tierId, onToggle = () => {}, onHover = () => {} } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab;';
  el.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.05, 100);
  const root = new T.Group();
  scene.add(root);

  const stage = new T.Mesh(new T.BoxGeometry(2.8, 0.2, 0.8),
    new T.MeshBasicMaterial({ color: '#F4F0FF', transparent: true, opacity: 0.16 }));
  stage.position.set(0, 0.05, -2.25);
  root.add(stage);

  const model = layout(tiers, { unitSize: 1 });
  const section = model.tiers.find(item => item.tier_id === String(tierId)) || { dots: [], layout: 'floor' };
  const seats = section.dots;
  const disposables = [stage.geometry, stage.material];

  const target = new T.Object3D();
  const orient = (dot, isFloor) => {
    target.position.set(dot.x, dot.y, dot.z);
    if (isFloor) target.rotation.set(-Math.PI / 2, 0, 0);
    else { target.rotation.set(0, 0, 0); target.lookAt(0, dot.y + 1, 0); }
  };

  // Context: faint outlines of the other sections (their seats aren't clickable here).
  for (const other of model.tiers) {
    if (other === section) continue;
    const material = new T.LineBasicMaterial({ color: other.color, transparent: true, opacity: 0.28 });
    disposables.push(material);
    if (other.layout === 'ring' && other.ring) {
      for (const [radius, y] of [[other.ring.innerRadius, other.ring.innerY], [other.ring.outerRadius, other.ring.outerY]]) {
        const points = Array.from({ length: 97 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new T.Vector3(Math.sin(a) * radius * 1.3, y, -Math.cos(a) * radius);
        });
        const geometry = new T.BufferGeometry().setFromPoints(points);
        disposables.push(geometry);
        root.add(new T.Line(geometry, material));
      }
    } else if (other.bounds) {
      const { width, depth } = other.bounds;
      const geometry = new T.EdgesGeometry(new T.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(0, 0.08, 0.35 + depth / 2));
      disposables.push(geometry);
      root.add(new T.LineSegments(geometry, material));
    }
  }

  // The winner's tier: one clickable dot per seat.
  const seatGeometry = new T.CircleGeometry(0.06, 16);
  const seatMaterial = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide });
  const seatMesh = new T.InstancedMesh(seatGeometry, seatMaterial, Math.max(1, seats.length));
  seatMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  root.add(seatMesh);
  disposables.push(seatGeometry, seatMaterial);

  let state = { booked: new Set(), locked: new Set(), mine: new Set(), readOnly: false };
  let hovered = -1;
  const isFloor = section.layout === 'floor';

  function paint() {
    const color = new T.Color();
    seats.forEach((dot, i) => {
      const s = seatState(dot.index, state);
      const scale = (s === 'mine' ? 1.45 : 1) * (i === hovered ? 1.35 : 1);
      orient(dot, isFloor);
      target.scale.setScalar(scale);
      target.updateMatrix();
      seatMesh.setMatrixAt(i, target.matrix);
      color.set(SEAT_COLORS[s]);
      if (state.readOnly && s === 'available') color.multiplyScalar(0.55);
      seatMesh.setColorAt(i, color);
    });
    seatMesh.instanceMatrix.needsUpdate = true;
    if (seatMesh.instanceColor) seatMesh.instanceColor.needsUpdate = true;
    render();
  }

  // Camera: orbit around the chosen tier, starting close enough to pick single seats.
  const focus = new T.Vector3();
  if (seats.length) {
    seats.forEach(dot => focus.add(new T.Vector3(dot.x, dot.y, dot.z)));
    focus.divideScalar(seats.length);
    if (!isFloor) focus.set(0, focus.y, 0);
  }
  // Frame the tier: start close enough that one seat is a comfortable click target.
  let extent = 0.4;
  seats.forEach(dot => { extent = Math.max(extent, Math.hypot(dot.x - focus.x, dot.z - focus.z)); });
  let yaw = 0.22;
  let pitch = isFloor ? 0.95 : 0.55;
  let zoom = null;                       // computed on first fit from the tier's extent
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const render = () => renderer.render(scene, camera);
  const fit = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const base = 12.5 * Math.max(1, 1.25 / camera.aspect);
    if (zoom === null) zoom = clamp((extent * (isFloor ? 2.6 : 2.2) + 0.8) / base, 0.08, 1.7);
    const d = base * zoom;
    camera.position.set(focus.x + Math.sin(yaw) * d, focus.y + (4.2 + pitch * 3) * zoom, focus.z + Math.cos(yaw) * d);
    camera.lookAt(focus);
  };

  // Pick the seat nearest the pointer on screen, within PICK_RADIUS_PX.
  const projected = new T.Vector3();
  function nearestSeat(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    let best = -1;
    let bestD = PICK_RADIUS_PX * PICK_RADIUS_PX;
    seats.forEach((dot, i) => {
      projected.set(dot.x, dot.y, dot.z).project(camera);
      if (projected.z > 1) return;
      const sx = (projected.x + 1) / 2 * r.width + r.left;
      const sy = (1 - projected.y) / 2 * r.height + r.top;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  const down = e => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
  const move = e => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.008;
      pitch = clamp(pitch + dy * 0.006, 0.1, 1.3);
      fit();
      render();
      return;
    }
    const i = nearestSeat(e.clientX, e.clientY);
    if (i !== hovered) {
      hovered = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      onHover(i >= 0 ? seats[i] : null);
      paint();
    }
  };
  const up = e => {
    if (!dragging) return;
    dragging = false;
    if (moved < 8 && e.type === 'pointerup') {
      const i = nearestSeat(e.clientX, e.clientY);
      if (i >= 0) onToggle(seats[i].index);
    }
  };
  const leave = () => { if (hovered !== -1) { hovered = -1; onHover(null); paint(); } };
  const wheel = e => { e.preventDefault(); zoom = clamp(zoom * Math.exp(e.deltaY * 0.0012), 0.08, 1.7); fit(); render(); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  const resizeObserver = new ResizeObserver(() => { fit(); render(); });
  resizeObserver.observe(el);

  fit();
  paint();

  return {
    setState(next) {
      state = { booked: new Set(next.booked || []), locked: new Set(next.locked || []),
        mine: new Set(next.mine || []), readOnly: Boolean(next.readOnly) };
      paint();
    },
    zoomBy(factor) { zoom = clamp(zoom * factor, 0.08, 1.7); fit(); render(); },
    resetView() { yaw = 0.22; pitch = isFloor ? 0.95 : 0.55; zoom = null; fit(); render(); },
    dispose() {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      disposables.forEach(item => item.dispose());
      renderer.dispose();
      canvas.remove();
    }
  };
}
