import * as T from 'three';

const MAX_POINTS = 6000;
const CYAN = new T.Color('#67E8F9');
const AMBER = new T.Color('#F59E0B');
const NEUTRAL = new T.Color('#8A8A9A');

function safeCount(value) {
  return Number.isSafeInteger(value) ? Math.max(0, value) : 0;
}

export function scaledWorld(input = {}) {
  const honest = safeCount(input.honest);
  const bots = safeCount(input.bots);
  const unknown = safeCount(input.unknown);
  const seats = safeCount(input.seats);
  const unitSize = Math.max(1, Math.ceil(Math.max(honest + bots + unknown, seats) / MAX_POINTS));
  const entryPoints = Math.min(MAX_POINTS, Math.ceil((honest + bots + unknown) / unitSize));
  const exact = [honest / unitSize, bots / unitSize, unknown / unitSize];
  const points = exact.map(Math.floor);
  let remaining = entryPoints - points[0] - points[1] - points[2];
  if (remaining > 0) {
    const order = [0, 1, 2].sort((a, b) => (exact[b] - points[b]) - (exact[a] - points[a]) || a - b);
    for (let index = 0; index < remaining; index++) points[order[index % order.length]]++;
  }
  return {
    honest,
    bots,
    unknown,
    seats,
    unitSize,
    honestPoints: points[0],
    botPoints: points[1],
    unknownPoints: points[2],
    seatPoints: Math.min(MAX_POINTS, Math.ceil(seats / unitSize))
  };
}

function setup(el) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
  return { renderer, scene, camera };
}

function fit(surface, el, targetY) {
  const width = el.clientWidth || 1;
  const height = el.clientHeight || 1;
  surface.renderer.setSize(width, height, false);
  surface.camera.aspect = width / height;
  surface.camera.position.set(7.2 * Math.max(1, 1.2 / surface.camera.aspect), 5.1, 7.2);
  surface.camera.lookAt(0, targetY, 0);
  surface.camera.updateProjectionMatrix();
}

function addEntryCloud(scene, world) {
  const count = world.honestPoints + world.botPoints + world.unknownPoints;
  if (!count) return null;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index++) {
    const unknown = index >= world.honestPoints + world.botPoints;
    const bot = !unknown && index >= world.honestPoints;
    const localIndex = unknown ? index - world.honestPoints - world.botPoints : bot ? index - world.honestPoints : index;
    const localCount = unknown ? world.unknownPoints : bot ? world.botPoints : world.honestPoints;
    const y = 1 - 2 * (localIndex + 0.5) / Math.max(1, localCount);
    const ring = Math.sqrt(1 - y * y);
    const angle = goldenAngle * localIndex;
    const radius = bot ? 2.75 : 3.5;
    const offset = bot ? 0.9 : 0;
    positions[index * 3] = Math.cos(angle) * ring * radius + offset;
    positions[index * 3 + 1] = y * radius * 0.48 + (bot ? 0.25 : 0);
    positions[index * 3 + 2] = Math.sin(angle) * ring * radius - offset * 0.6;
    const color = unknown ? NEUTRAL : bot ? AMBER : CYAN;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  const material = new T.PointsMaterial({
    size: Math.max(1.3, 4.2 / Math.sqrt(Math.max(1, count / MAX_POINTS))),
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending
  });
  const points = new T.Points(geometry, material);
  scene.add(points);
  return points;
}

function addArena(scene, world) {
  if (!world.seatPoints) return null;
  const mesh = new T.InstancedMesh(
    new T.PlaneGeometry(0.12, 0.14),
    new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, depthWrite: false }),
    world.seatPoints
  );
  const helper = new T.Object3D();
  const color = new T.Color();
  const rows = Math.max(1, Math.ceil(Math.sqrt(world.seatPoints / 1.5)));
  let index = 0;
  for (let row = 0; row < rows && index < world.seatPoints; row++) {
    const radius = 1.4 + row * 0.15;
    const seatsInRow = Math.min(world.seatPoints - index, Math.max(1, Math.round(100 * radius / 1.4)));
    for (let column = 0; column < seatsInRow; column++, index++) {
      const angle = 0.24 + (column + 0.5) / seatsInRow * (Math.PI * 2 - 0.48);
      helper.position.set(Math.cos(angle) * radius, row * 0.1, Math.sin(angle) * radius);
      helper.lookAt(0, row * 0.1 + 1.2, 0);
      helper.updateMatrix();
      mesh.setMatrixAt(index, helper.matrix);
      mesh.setColorAt(index, color.copy(CYAN).multiplyScalar(0.72 + (index % 5) * 0.05));
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/** Decorative scenes sized from the published lottery results. */
export function createJudgeScenes(cloudEl, arenaEl, { reduced = false, data = {} } = {}) {
  const cloud = setup(cloudEl);
  const arena = setup(arenaEl);
  const cloudGrid = new T.PolarGridHelper(3.8, 12, 6, 64, 0x2a2540, 0x1a1828);
  cloudGrid.rotation.x = Math.PI / 2;
  cloud.scene.add(cloudGrid);

  const stage = new T.LineSegments(
    new T.EdgesGeometry(new T.BoxGeometry(0.9, 0.08, 0.42)),
    new T.LineBasicMaterial({ color: 0x5b4b8a })
  );
  stage.position.set(0, 0.04, -1.8);
  arena.scene.add(stage);
  for (let radius = 1.4; radius <= 2.7; radius += 0.45) {
    const points = [];
    for (let index = 0; index <= 96; index++) {
      const angle = index / 96 * Math.PI * 2;
      points.push(new T.Vector3(Math.cos(angle) * radius, Math.floor(radius * 10) * 0.015, Math.sin(angle) * radius));
    }
    const line = new T.LineLoop(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: 0x2a2540 }));
    arena.scene.add(line);
  }

  let cloudPoints = null;
  let arenaMesh = null;
  let world = scaledWorld(data);
  const clearDataMeshes = () => {
    for (const [surface, object] of [[cloud, cloudPoints], [arena, arenaMesh]]) {
      if (!object) continue;
      surface.scene.remove(object);
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material.dispose();
    }
  };
  const rebuild = next => {
    clearDataMeshes();
    world = scaledWorld(next);
    cloudPoints = addEntryCloud(cloud.scene, world);
    arenaMesh = addArena(arena.scene, world);
    redraw();
  };
  let angle = 0;
  let frame = 0;
  let last = performance.now();
  let active = true;
  const redraw = () => {
    cloud.renderer.render(cloud.scene, cloud.camera);
    arena.renderer.render(arena.scene, arena.camera);
  };
  fit(cloud, cloudEl, 0);
  fit(arena, arenaEl, 0.35);
  const observers = [
    new ResizeObserver(() => { fit(cloud, cloudEl, 0); redraw(); }),
    new ResizeObserver(() => { fit(arena, arenaEl, 0.35); redraw(); })
  ];
  observers[0].observe(cloudEl);
  observers[1].observe(arenaEl);

  const animate = now => {
    if (!active) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle += dt * 0.035;
    if (cloudPoints) cloudPoints.rotation.y = angle;
    if (arenaMesh) arenaMesh.rotation.y = angle * 0.7;
    redraw();
    frame = requestAnimationFrame(animate);
  };
  rebuild(data);
  if (!reduced) frame = requestAnimationFrame(animate);

  return {
    setData(next) { rebuild(next); },
    redraw,
    dispose() {
      active = false;
      cancelAnimationFrame(frame);
      observers.forEach(observer => observer.disconnect());
      clearDataMeshes();
      for (const surface of [cloud, arena]) {
        surface.scene.traverse(object => {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
          else object.material?.dispose();
        });
        surface.renderer.dispose();
        surface.renderer.domElement.remove();
      }
    }
  };
}
