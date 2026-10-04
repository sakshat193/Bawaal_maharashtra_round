import * as T from 'three';

const MAX_POINTS = 50000;
const EMPTY = -1000;

function safeCount(value) {
  return Number.isSafeInteger(value) ? Math.max(0, value) : 0;
}

export function drumCounts(entries, winners = 0) {
  const accepted = safeCount(entries);
  const offered = safeCount(winners);
  const unitSize = Math.max(1, Math.ceil(accepted / MAX_POINTS));
  const entryPoints = Math.min(MAX_POINTS, Math.ceil(accepted / unitSize));
  const winnerPoints = Math.min(entryPoints, Math.ceil(offered / unitSize));
  return { unitSize, entryPoints, winnerPoints };
}

function valueAt(index, salt) {
  let value = Math.imul((index + 1) ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Server-counted entry drum. Counts change only through setCounts(). */
export function createDrum(el, { reduced = false, phase: initial = 'idle' } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
  const positions = new Float32Array(MAX_POINTS * 3);
  const spawns = new Float32Array(MAX_POINTS * 3);
  const fill = new Float32Array(MAX_POINTS).fill(EMPTY);
  const wins = new Float32Array(MAX_POINTS);
  const variation = new Float32Array(MAX_POINTS);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const radius = 1.6;

  for (let index = 0; index < MAX_POINTS; index++) {
    const y = 1 - 2 * (index + 0.5) / MAX_POINTS;
    const ring = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const radialScale = radius * (0.9 + 0.1 * Math.sqrt(valueAt(index, 0x417)));
    positions[index * 3] = Math.cos(angle) * ring * radialScale;
    positions[index * 3 + 1] = y * radialScale;
    positions[index * 3 + 2] = Math.sin(angle) * ring * radialScale;

    const spawnAngle = valueAt(index, 0x71a5) * Math.PI * 2;
    const spawnDistance = 5 + valueAt(index, 0x8e2f) * 4;
    spawns[index * 3] = Math.cos(spawnAngle) * spawnDistance;
    spawns[index * 3 + 1] = Math.sin(spawnAngle) * spawnDistance * 0.7;
    spawns[index * 3 + 2] = (valueAt(index, 0x10bc) - 0.5) * 3;
    variation[index] = valueAt(index, 0x50f1);
  }

  const order = Uint32Array.from({ length: MAX_POINTS }, (_, index) => index);
  let seed = 0x0417;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let index = MAX_POINTS - 1; index > 0; index--) {
    const swap = next() % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('aSpawn', new T.BufferAttribute(spawns, 3));
  const fillAttribute = new T.BufferAttribute(fill, 1);
  fillAttribute.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('aFill', fillAttribute);
  const winAttribute = new T.BufferAttribute(wins, 1);
  winAttribute.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('aWin', winAttribute);
  geometry.setAttribute('aVariation', new T.BufferAttribute(variation, 1));

  const colors = {
    idle: new T.Vector3(0.486, 0.227, 0.929),
    filling: new T.Vector3(0.486, 0.227, 0.929),
    sealed: new T.Vector3(0.486, 0.227, 0.929),
    draw: new T.Vector3(0.133, 0.827, 0.933),
    won: new T.Vector3(0.961, 0.62, 0.043),
    lost: new T.Vector3(0.36, 0.36, 0.42)
  };
  const uniforms = {
    uTime: { value: 0 },
    uTw: { value: 0 },
    uIgnite: { value: EMPTY },
    uPixelRatio: { value: pixelRatio },
    uScale: { value: 8 },
    uAccent: { value: colors.idle.clone() }
  };
  const material = new T.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
    vertexShader: `
      attribute vec3 aSpawn; attribute float aFill; attribute float aWin; attribute float aVariation;
      uniform float uTime, uTw, uIgnite, uPixelRatio, uScale; uniform vec3 uAccent;
      varying vec3 vColor;
      void main(){
        bool empty = aFill < -500.0;
        float f = empty ? 1.0 : clamp((uTime - aFill) / 1.6, 0.0, 1.0);
        float ef = 1.0 - pow(1.0 - f, 3.0);
        vec3 p = empty ? position : mix(aSpawn, position, ef);
        float on = uIgnite > -500.0 ? 1.0 : 0.0;
        float g = on * clamp((uTime - uIgnite - aVariation * 0.5) / 1.3, 0.0, 1.0);
        float eg = 1.0 - pow(1.0 - g, 4.0);
        float w = empty ? 0.0 : aWin;
        p *= 1.0 + w * eg * (0.18 + aVariation * 0.32);
        float tw = 0.72 + 0.28 * sin(uTw * (0.8 + aVariation * 2.2) + aVariation * 40.0);
        vec3 c; float sz;
        if (empty) { c = uAccent * (aVariation < 0.22 ? 0.85 : 0.0) * tw; sz = 1.7; }
        else {
          c = mix(uAccent, vec3(1.0), 0.18 + 0.35 * aVariation) * 0.4 * tw + vec3(0.85, 0.9, 1.0) * (1.0 - f) * 0.9;
          sz = 1.9 * (1.0 + (1.0 - f) * 1.6);
        }
        float gd = on * clamp((uTime - uIgnite) / 1.1, 0.0, 1.0);
        c = mix(c, c * 0.05, gd * (1.0 - w));
        c = mix(c, mix(vec3(1.7), uAccent * 1.8 + 0.6, 0.25), eg * w);
        sz = mix(sz, 5.5, eg * w);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = sz * uPixelRatio * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
        vColor = c;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float m = max(vColor.r, max(vColor.g, vColor.b));
        if (m < 0.004) discard;
        float k = smoothstep(0.5, 0.0, r); k *= k;
        gl_FragColor = vec4(vColor * k, clamp(m * k, 0.0, 1.0));
      }`
  });

  const points = new T.Points(geometry, material);
  const tilt = new T.Group();
  tilt.rotation.x = 0.28;
  tilt.rotation.z = 0.1;
  tilt.add(points);
  scene.add(tilt);

  let now = 0;
  let twinkle = 0;
  let phase = initial;
  let igniteAt = EMPTY;
  let counts = drumCounts(0, 0);
  let raf = 0;
  let last = performance.now();
  let active = true;

  const render = () => renderer.render(scene, camera);
  const resize = () => {
    const width = el.clientWidth || 1;
    const height = el.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(0, 0, 7.4 / Math.min(1, camera.aspect));
    camera.updateProjectionMatrix();
    uniforms.uScale.value = 8 * height / 700;
    if (reduced) render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();

  function setCounts(nextCounts = {}) {
    const next = drumCounts(nextCounts.entries, nextCounts.winners);
    const previousPoints = counts.entryPoints;
    for (let rank = 0; rank < MAX_POINTS; rank++) {
      const pointIndex = order[rank];
      if (rank < next.entryPoints) {
        if (fill[pointIndex] < EMPTY / 2) {
          fill[pointIndex] = reduced ? now - 5 : now + Math.min(0.15, Math.max(0, rank - previousPoints) * 0.00002);
        }
        wins[pointIndex] = rank < next.winnerPoints ? 1 : 0;
      } else {
        fill[pointIndex] = EMPTY;
        wins[pointIndex] = 0;
      }
    }
    counts = next;
    fillAttribute.needsUpdate = true;
    winAttribute.needsUpdate = true;
    if (reduced) {
      uniforms.uTime.value = 0;
      render();
    }
    return counts;
  }

  function setPhase(nextPhase) {
    if (!Object.hasOwn(colors, nextPhase)) return;
    phase = nextPhase;
    if (phase === 'draw') igniteAt = reduced ? -100 : now + 1.6;
    else if (phase === 'won' || phase === 'lost') igniteAt = reduced ? -100 : now - 5;
    else igniteAt = EMPTY;
    uniforms.uAccent.value.copy(colors[phase]);
    uniforms.uIgnite.value = igniteAt;
    if (reduced) render();
  }

  const animate = timestamp => {
    if (!active) return;
    const dt = Math.min(0.05, (timestamp - last) / 1000);
    last = timestamp;
    now += dt;
    if (phase === 'idle' || phase === 'filling') twinkle += dt;
    points.rotation.y += dt * (phase === 'filling' ? 0.14 : phase === 'idle' ? 0.06 : 0.01);
    uniforms.uAccent.value.lerp(colors[phase], 1 - Math.exp(-dt * 5));
    uniforms.uTime.value = now;
    uniforms.uTw.value = twinkle;
    uniforms.uIgnite.value = igniteAt;
    render();
    raf = requestAnimationFrame(animate);
  };

  setPhase(initial);
  if (!reduced) raf = requestAnimationFrame(animate);
  return {
    setCounts,
    setPhase,
    dispose() {
      active = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
