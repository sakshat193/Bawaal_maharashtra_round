import * as T from 'three';
import { PALETTE } from '../pages/concert/data.js';

const MAX_DOTS = 6000;
const R0 = 2.7;
const R1 = 5.5;
const Y0 = 0.12;
const Y1 = 2.55;
const FRONT_GAP = 0.62;
const SEAT_GAP = 0.14;
const AMBER = new T.Color('#F59E0B');

function safeCapacity(value) {
  return Number.isSafeInteger(value) ? Math.max(0, value) : 0;
}

function compareTier(a, b) {
  return (b.price_paise || 0) - (a.price_paise || 0)
    || String(a.tier_id).localeCompare(String(b.tier_id));
}

function distribute(total, weights) {
  if (!weights.length || total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((value, weight) => value + weight, 0);
  const exact = weights.map(weight => total * weight / sum);
  const amounts = exact.map(Math.floor);
  let remaining = total - amounts.reduce((value, amount) => value + amount, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - amounts[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remaining; i++) amounts[order[i].index]++;
  return amounts;
}

function seedFor(text) {
  let seed = 2166136261;
  for (const character of text) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  return seed || 1;
}

function shuffleRanks(dots, tierId) {
  const order = Array.from({ length: dots.length }, (_, index) => index);
  let seed = seedFor(tierId);
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = order.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((dotIndex, rank) => { dots[dotIndex].shuffleIndex = rank; });
}

function placeFloor(section) {
  const count = section.dotCount;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * 1.5)));
  const rowCount = Math.ceil(count / columns);
  let nextIndex = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const rowSize = Math.min(columns, count - nextIndex);
    const row = { radius: 0, dots: [] };
    for (let column = 0; column < rowSize; column++) {
      const dot = {
        tier_id: section.tier_id,
        index: nextIndex++,
        row: rowIndex + 1,
        seat: column + 1,
        x: (column - (rowSize - 1) / 2) * SEAT_GAP,
        y: 0.08,
        z: 0.35 + rowIndex * SEAT_GAP,
        shuffleIndex: 0
      };
      row.dots.push(dot);
      section.dots.push(dot);
    }
    section.rows.push(row);
  }
  section.bounds = {
    width: columns * SEAT_GAP,
    depth: rowCount * SEAT_GAP,
    columns
  };
  shuffleRanks(section.dots, section.tier_id);
}

function placeRing(section, innerRadius, depth) {
  const outerRadius = innerRadius + depth;
  const rowCount = Math.max(1, Math.round(depth / 0.18));
  const radii = Array.from({ length: rowCount }, (_, index) =>
    innerRadius + depth * ((index + 0.5) / rowCount));
  const rowSizes = distribute(section.dotCount, radii);
  const yAt = radius => Y0 + ((radius - R0) / (R1 - R0)) * (Y1 - Y0);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const radius = radii[rowIndex];
    const size = rowSizes[rowIndex];
    const row = { radius, dots: [] };
    for (let column = 0; column < size; column++) {
      const angle = FRONT_GAP / 2 + (column + 0.5) / size * (Math.PI * 2 - FRONT_GAP);
      const dot = {
        tier_id: section.tier_id,
        index: section.dots.length,
        row: rowIndex + 1,
        seat: column + 1,
        x: Math.sin(angle) * radius * 1.3,
        y: yAt(radius),
        z: -Math.cos(angle) * radius,
        shuffleIndex: 0
      };
      row.dots.push(dot);
      section.dots.push(dot);
    }
    section.rows.push(row);
  }
  section.ring = { innerRadius, outerRadius, innerY: yAt(innerRadius), outerY: yAt(outerRadius) };
  shuffleRanks(section.dots, section.tier_id);
}

/** Pure ticket-dot placement. A scaled dot represents unitSize tickets.
 *  Pass { unitSize: 1 } for the seat map: then dot.index is the seat's 0-based seat_index
 *  (row-major), the number the seat API uses, and dot.row / dot.seat are its 1-based label. */
export function layout(tiers = [], { unitSize: forcedUnit } = {}) {
  const ordered = [...tiers].sort(compareTier);
  const totalCapacity = ordered.reduce((sum, tier) => sum + safeCapacity(tier.capacity), 0);
  const unitSize = forcedUnit || Math.max(1, Math.ceil(totalCapacity / MAX_DOTS));
  const sections = ordered.map((tier, index) => {
    const capacity = safeCapacity(tier.capacity);
    return {
      ...tier,
      tier_id: String(tier.tier_id),
      capacity,
      color: tier.color || PALETTE[index % PALETTE.length],
      unitSize,
      dotCount: Math.ceil(capacity / unitSize),
      dots: [],
      rows: []
    };
  });

  if (sections.length === 1) {
    sections[0].layout = 'floor';
    placeFloor(sections[0]);
  } else if (sections.length > 1) {
    sections[0].layout = 'floor';
    placeFloor(sections[0]);
    const bowl = sections.slice(1);
    const bowlDots = bowl.reduce((sum, section) => sum + section.dotCount, 0);
    let innerRadius = R0;
    for (const section of bowl) {
      section.layout = 'ring';
      const depth = bowlDots ? (R1 - R0) * section.dotCount / bowlDots : 0;
      placeRing(section, innerRadius, depth);
      innerRadius += depth;
    }
  }

  return { unitSize, totalCapacity, tiers: sections };
}

/** "Row 3 · Seat 12" for a 0-based seat_index in a tier, from the same layout the map draws. */
export function seatLabels(tiers, tierId) {
  const section = layout(tiers, { unitSize: 1 }).tiers.find(item => item.tier_id === String(tierId));
  const labels = [];
  for (const dot of section?.dots || []) labels[dot.index] = { row: dot.row, seat: dot.seat };
  return labels;
}

function tierKey(tiers) {
  return [...tiers]
    .map(tier => [String(tier.tier_id), safeCapacity(tier.capacity)])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, capacity]) => `${id}:${capacity}`)
    .join('|');
}

function disposeTree(object) {
  object.traverse(child => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else child.material?.dispose();
  });
}

export function createVenue(el, { tiers = [], reduced = false, onPick = () => {} } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
  const root = new T.Group();
  const sectionGroup = new T.Group();
  scene.add(root);
  root.add(sectionGroup);

  const stageGeometry = new T.BoxGeometry(2.8, 0.2, 0.8);
  const stageMaterial = new T.MeshBasicMaterial({ color: '#F4F0FF', transparent: true, opacity: 0.16 });
  const stage = new T.Mesh(stageGeometry, stageMaterial);
  stage.position.set(0, 0.05, -2.25);
  root.add(stage);

  const picks = [];
  const target = new T.Object3D();
  const dotGeometry = new T.PlaneGeometry(0.09, 0.09);
  const dotMaterial = new T.MeshBasicMaterial({
    color: 0xffffff,
    side: T.DoubleSide,
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false
  });
  let dotMesh = null;
  let model = { unitSize: 1, tiers: [] };
  let currentKey = null;
  let held = {};
  let selectedTier = null;
  let mode = 'event';
  let yaw = 0.22;
  let pitch = 0.46;
  let zoom = 1;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let frame = 0;
  let lastFrame = performance.now();
  let lastInteraction = -Infinity;
  let active = true;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const render = () => renderer.render(scene, camera);
  const fitCamera = () => {
    const width = el.clientWidth || 1;
    const height = el.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const distance = 12.5 * Math.max(1, 1.25 / camera.aspect) * zoom;
    camera.position.set(Math.sin(yaw) * distance, (5.6 + pitch * 2) * zoom, Math.cos(yaw) * distance);
    camera.lookAt(0, 0.55, 0);
  };

  function rebuild(nextTiers) {
    if (dotMesh) {
      sectionGroup.remove(dotMesh);
      dotMesh.dispose?.();
      dotMesh = null;
    }
    for (const child of [...sectionGroup.children]) {
      sectionGroup.remove(child);
      disposeTree(child);
    }
    picks.length = 0;
    model = layout(nextTiers);

    for (const section of model.tiers) {
      let geometry;
      if (section.layout === 'floor') {
        const { width, depth } = section.bounds;
        geometry = new T.PlaneGeometry(width + 0.2, depth + 0.2);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, 0.35 + (depth - SEAT_GAP) / 2);
      } else if (section.layout === 'ring' && section.dotCount > 0) {
        const ring = section.ring;
        geometry = new T.CylinderGeometry(
          ring.outerRadius,
          ring.innerRadius,
          Math.max(0.04, ring.outerY - ring.innerY),
          96,
          Math.max(1, section.rows.length),
          true,
          FRONT_GAP / 2,
          Math.PI * 2 - FRONT_GAP
        );
        geometry.scale(1.3, 1, 1);
      }
      if (geometry) {
        const material = new T.MeshBasicMaterial({
          color: section.color,
          transparent: true,
          opacity: 0.045,
          side: T.DoubleSide,
          depthWrite: false
        });
        const surface = new T.Mesh(geometry, material);
        surface.userData.tierId = section.tier_id;
        if (section.layout === 'ring') surface.position.y = (section.ring.innerY + section.ring.outerY) / 2;
        sectionGroup.add(surface);
        picks.push(surface);

        const edgeGeometry = new T.EdgesGeometry(geometry, 1);
        const edge = new T.LineSegments(edgeGeometry, new T.LineBasicMaterial({
          color: section.color,
          transparent: true,
          opacity: 0.22
        }));
        if (section.layout === 'ring') edge.position.y = surface.position.y;
        sectionGroup.add(edge);
      }
    }

    const dots = model.tiers.flatMap(section => section.dots.map(dot => ({ section, dot })));
    if (dots.length) {
      dotMesh = new T.InstancedMesh(dotGeometry, dotMaterial, dots.length);
      dotMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      dots.forEach(({ section, dot }, index) => {
        target.position.set(dot.x, dot.y, dot.z);
        if (section.layout === 'floor') target.rotation.set(-Math.PI / 2, 0, 0);
        else {
          target.rotation.set(0, 0, 0);
          target.lookAt(0, dot.y + 1, 0);
        }
        target.updateMatrix();
        dotMesh.setMatrixAt(index, target.matrix);
      });
      sectionGroup.add(dotMesh);
    }
    fitCamera();
    paintDots();
    render();
  }

  function paintDots() {
    const dots = model.tiers.flatMap(section => section.dots.map(dot => ({ section, dot })));
    if (!dotMesh || dots.length !== dotMesh.count) return;
    const color = new T.Color();
    const colors = new Map(model.tiers.map(section => [section.tier_id, new T.Color(section.color)]));
    dots.forEach(({ section, dot }, index) => {
      const heldCount = Number(held[section.tier_id]);
      const isHeld = Number.isFinite(heldCount) && dot.shuffleIndex < heldCount / section.unitSize;
      if (isHeld) color.copy(AMBER).multiplyScalar(mode === 'turn' ? 1 : 0.78);
      else {
        color.copy(colors.get(section.tier_id)).multiplyScalar(selectedTier === section.tier_id ? 1.1 : 0.55);
      }
      dotMesh.setColorAt(index, color);
    });
    dotMesh.instanceColor.needsUpdate = true;
    for (const section of model.tiers) {
      for (const child of sectionGroup.children) {
        if (child.userData.tierId !== section.tier_id) continue;
        const selected = selectedTier === section.tier_id;
        if (child.material) child.material.opacity = child.isLineSegments ? (selected ? 0.8 : 0.22) : (selected ? 0.11 : 0.045);
      }
    }
  }

  function setTiers(nextTiers = []) {
    const nextKey = tierKey(nextTiers);
    if (nextKey === currentKey) return;
    currentKey = nextKey;
    rebuild(nextTiers);
  }

  const resizeObserver = new ResizeObserver(() => { fitCamera(); render(); });
  resizeObserver.observe(el);
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  const down = event => {
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    lastInteraction = performance.now();
    canvas.setPointerCapture(event.pointerId);
  };
  const move = event => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * 0.008;
    pitch = clamp(pitch + dy * 0.006, 0.12, 1.1);
    lastInteraction = performance.now();
    fitCamera();
    render();
  };
  const pick = event => {
    const bounds = canvas.getBoundingClientRect();
    const pointer = new T.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    const ray = new T.Raycaster();
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(picks)[0];
    if (hit) onPick(hit.object.userData.tierId);
  };
  const up = event => {
    if (!dragging) return;
    dragging = false;
    if (moved < 8 && event.type === 'pointerup') pick(event);
  };
  const wheel = event => {
    event.preventDefault();
    zoom = clamp(zoom * Math.exp(event.deltaY * 0.0012), 0.55, 1.7);
    lastInteraction = performance.now();
    fitCamera();
    render();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });

  const animate = now => {
    if (!active) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!dragging && now - lastInteraction > 4000) yaw += dt * 0.035;
    fitCamera();
    render();
    frame = requestAnimationFrame(animate);
  };

  setTiers(tiers);
  if (!reduced) frame = requestAnimationFrame(animate);

  return {
    setTiers,
    setHeld(nextHeld = {}) { held = nextHeld instanceof Map ? Object.fromEntries(nextHeld) : nextHeld; paintDots(); render(); },
    setMode(nextMode) { if (nextMode === 'event' || nextMode === 'turn') { mode = nextMode; paintDots(); render(); } },
    setTier(nextTier) { selectedTier = nextTier; paintDots(); render(); },
    zoomBy(factor) { zoom = clamp(zoom * factor, 0.55, 1.7); fitCamera(); render(); },
    resetView() { yaw = 0.22; pitch = 0.46; zoom = 1; fitCamera(); render(); },
    dispose() {
      active = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      disposeTree(root);
      dotGeometry.dispose();
      dotMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    }
  };
}
