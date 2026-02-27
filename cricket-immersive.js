import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { gsap } from "gsap";

const DATA_PATH = "./test_cricket_records.csv";

const dom = {
  vizRoot: document.getElementById("vizRoot"),
  hoverTag: document.getElementById("hoverTag"),
  hudBadge: document.getElementById("hudBadge"),
  tourBtn: document.getElementById("tourBtn"),
  playerName: document.getElementById("playerName"),
  playerSummary: document.getElementById("playerSummary"),
  statDebut: document.getElementById("statDebut"),
  statSR: document.getElementById("statSR"),
  statCareer: document.getElementById("statCareer"),
  statEra: document.getElementById("statEra"),
  filterButtons: Array.from(document.querySelectorAll("[data-filter]")),
};

const state = {
  players: [],
  points: [],
  pickables: [],
  filter: "all",
  hovered: null,
  selected: null,
  keys: new Set(),
  touring: false,
  tourTimer: null,
  focusTween: null,
};

const bounds = {
  yearMin: 0,
  yearMax: 0,
  srMin: 0,
  srMax: 0,
  durationMin: 0,
  durationMax: 0,
};

let scene;
let camera;
let renderer;
let composer;
let controls;
let labelRenderer;
let raycaster;
let mouse;
let clock;

const WORLD = {
  xMin: -250,
  xMax: 250,
  yMin: 18,
  yMax: 245,
  zMin: -170,
  zMax: 170,
};

init().catch((error) => {
  console.error(error);
  dom.hudBadge.textContent = "Unable to load dataset";
});

async function init() {
  state.players = await loadPlayers(DATA_PATH);
  if (!state.players.length) {
    dom.hudBadge.textContent = "No valid players found";
    return;
  }

  calculateBounds(state.players);
  setupScene();
  buildArena();
  buildPoints(state.players);
  wireUi();
  applyFilter("all");
  flyInCamera();
  animate();
}

async function loadPlayers(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  const text = await response.text();
  const rows = parseCsv(text);
  const players = [];

  for (const row of rows) {
    const runs = parseInteger(row.Runs);
    const strikeRate = Number.parseFloat((row["Strike Rate"] || "").trim());
    const span = parseSpanYears(row.Span || "");
    if (!span) continue;
    const { debutYear, lastYear } = span;
    if (!Number.isFinite(runs) || !Number.isFinite(strikeRate)) {
      continue;
    }
    if (runs < 6000) continue;

    players.push({
      name: (row.Player || "").trim(),
      country: (row.Country || "").trim(),
      debutYear,
      lastYear,
      careerDurationYears: Math.max(0, lastYear - debutYear),
      strikeRate,
      runs,
      legacy: debutYear < 1990,
    });
  }

  players.sort((a, b) => a.debutYear - b.debutYear || b.strikeRate - a.strikeRate);
  return players;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines.shift() || "");

  return lines.map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header.trim()] = (values[i] || "").trim();
    });
    return row;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseInteger(value) {
  const cleaned = (value || "").replace(/[^0-9-]/g, "");
  if (!cleaned) return Number.NaN;
  return Number.parseInt(cleaned, 10);
}

function parseSpanYears(spanText) {
  const matches = String(spanText).match(/\d{4}/g);
  if (!matches || matches.length < 2) return null;
  const debutYear = Number.parseInt(matches[0], 10);
  const lastYear = Number.parseInt(matches[matches.length - 1], 10);
  if (!Number.isFinite(debutYear) || !Number.isFinite(lastYear)) return null;
  return { debutYear, lastYear };
}

function calculateBounds(players) {
  bounds.yearMin = Math.min(...players.map((p) => p.debutYear)) - 1;
  bounds.yearMax = Math.max(...players.map((p) => p.debutYear)) + 1;
  bounds.srMin = Math.floor(Math.min(...players.map((p) => p.strikeRate)) / 5) * 5;
  bounds.srMax = Math.ceil(Math.max(...players.map((p) => p.strikeRate)) / 5) * 5;
  bounds.durationMin = Math.min(...players.map((p) => p.careerDurationYears));
  bounds.durationMax = Math.max(...players.map((p) => p.careerDurationYears));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function toWorldPosition(player) {
  return new THREE.Vector3(
    mapRange(player.debutYear, bounds.yearMin, bounds.yearMax, WORLD.xMin, WORLD.xMax),
    mapRange(player.strikeRate, bounds.srMin, bounds.srMax, WORLD.yMin, WORLD.yMax),
    mapRange(player.careerDurationYears, bounds.durationMin, bounds.durationMax, WORLD.zMin, WORLD.zMax),
  );
}

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050913);
  scene.fog = new THREE.Fog(0x050913, 340, 980);

  camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 2200);
  camera.position.set(420, 230, 360);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  dom.vizRoot.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = "fixed";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  labelRenderer.domElement.style.zIndex = "4";
  dom.vizRoot.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 920;
  controls.minDistance = 95;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.target.set(0, 90, 0);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.8, 0.18));

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2(-10, -10);
  clock = new THREE.Clock();

  const hemi = new THREE.HemisphereLight(0x81d5ff, 0x11141d, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xd0f8ff, 0.8);
  key.position.set(180, 360, 160);
  scene.add(key);
  const fill = new THREE.PointLight(0xff5d9e, 0.7, 900);
  fill.position.set(-280, 170, -120);
  scene.add(fill);

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("click", onPointerClick);
  renderer.domElement.addEventListener("pointerdown", () => stopTour());
}

function buildArena() {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(315, 96),
    new THREE.MeshStandardMaterial({
      color: 0x092032,
      metalness: 0.6,
      roughness: 0.4,
      transparent: true,
      opacity: 0.88,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  scene.add(floor);

  const grid = new THREE.GridHelper(620, 28, 0x2b89b0, 0x18455a);
  grid.material.opacity = 0.22;
  grid.material.transparent = true;
  scene.add(grid);

  for (let i = 0; i < 3; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(120 + i * 78, 0.65, 14, 180),
      new THREE.MeshBasicMaterial({
        color: 0x2a6b89,
        transparent: true,
        opacity: 0.25 - i * 0.05,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2 + i * 0.08;
    scene.add(ring);
  }

  const stars = new THREE.BufferGeometry();
  const starCount = 1700;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 1800;
    positions[i * 3 + 1] = Math.random() * 1100 + 50;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1800;
  }
  stars.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starField = new THREE.Points(
    stars,
    new THREE.PointsMaterial({
      color: 0xd9f4ff,
      size: 1.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    }),
  );
  scene.add(starField);

  addAxis(
    new THREE.Vector3(WORLD.xMin, 0.01, WORLD.zMin),
    new THREE.Vector3(WORLD.xMax, 0.01, WORLD.zMin),
    0x56def4,
  );
  addAxis(
    new THREE.Vector3(WORLD.xMin, WORLD.yMax, WORLD.zMin),
    new THREE.Vector3(WORLD.xMin, 0.01, WORLD.zMin),
    0x56def4,
  );
  addAxis(
    new THREE.Vector3(WORLD.xMin, 0.01, WORLD.zMin),
    new THREE.Vector3(WORLD.xMin, 0.01, WORLD.zMax),
    0x56def4,
  );

  for (let year = Math.ceil(bounds.yearMin / 5) * 5; year <= bounds.yearMax; year += 5) {
    const x = mapRange(year, bounds.yearMin, bounds.yearMax, WORLD.xMin, WORLD.xMax);
    addTick(new THREE.Vector3(x, 0.01, WORLD.zMin), 0x215a75);
    addAxisLabel(`${year}`, new THREE.Vector3(x, 2.2, WORLD.zMin - 8), "axis-label");
  }
  for (let sr = bounds.srMin; sr <= bounds.srMax; sr += 5) {
    const y = mapRange(sr, bounds.srMin, bounds.srMax, WORLD.yMin, WORLD.yMax);
    addTick(new THREE.Vector3(WORLD.xMin - 4.8, y, WORLD.zMin), 0x1f5e7d, true);
    addAxisLabel(`${sr}`, new THREE.Vector3(WORLD.xMin - 12, y, WORLD.zMin), "axis-label");
  }
  const durationRange = bounds.durationMax - bounds.durationMin;
  const durationStep = durationRange <= 12 ? 2 : 5;
  for (
    let years = Math.ceil(bounds.durationMin / durationStep) * durationStep;
    years <= bounds.durationMax;
    years += durationStep
  ) {
    const z = mapRange(years, bounds.durationMin, bounds.durationMax, WORLD.zMin, WORLD.zMax);
    addTick(new THREE.Vector3(WORLD.xMin, 0.01, z), 0x1f5e7d, true);
    addAxisLabel(`${years}y`, new THREE.Vector3(WORLD.xMin - 12, 2.2, z), "axis-label");
  }
  addAxisLabel("Debut Year", new THREE.Vector3(0, 2.2, WORLD.zMin - 22), "axis-label");
  addAxisLabel("Strike Rate", new THREE.Vector3(WORLD.xMin - 26, WORLD.yMax + 4, WORLD.zMin), "axis-label");
  addAxisLabel("Career Duration", new THREE.Vector3(WORLD.xMin - 2, 2.2, WORLD.zMax + 16), "axis-label");
}

function addAxis(start, end, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
    }),
  );
  scene.add(line);
}

function addTick(position, color, vertical = false) {
  const tickGeom = new THREE.BufferGeometry().setFromPoints([
    position,
    vertical
      ? position.clone().setX(position.x + 3.2)
      : position.clone().setZ(position.z - 3.2),
  ]);
  const tick = new THREE.Line(
    tickGeom,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
    }),
  );
  scene.add(tick);
}

function addAxisLabel(text, position, className) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.copy(position);
  scene.add(label);
}

function buildPoints(players) {
  const modernColor = new THREE.Color(0x41efff);
  const legacyColor = new THREE.Color(0xffad42);

  players.forEach((player, index) => {
    const world = toWorldPosition(player);
    const group = new THREE.Group();
    group.position.set(world.x, 0, world.z);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, world.y, 10),
      new THREE.MeshStandardMaterial({
        color: player.legacy ? 0x8b5d20 : 0x1c6270,
        emissive: player.legacy ? 0x3e270f : 0x123a45,
        transparent: true,
        opacity: 0.68,
        roughness: 0.35,
        metalness: 0.45,
      }),
    );
    pillar.position.y = world.y / 2;
    group.add(pillar);

    const orbMat = new THREE.MeshStandardMaterial({
      color: player.legacy ? legacyColor : modernColor,
      emissive: player.legacy ? 0x6a380f : 0x0f5b67,
      emissiveIntensity: 1.05,
      roughness: 0.2,
      metalness: 0.55,
    });

    const orb = new THREE.Mesh(
      player.legacy ? new THREE.OctahedronGeometry(6.2, 0) : new THREE.IcosahedronGeometry(5.6, 1),
      orbMat,
    );
    orb.position.y = world.y;
    orb.userData.pointIndex = index;
    group.add(orb);

    let ring = null;
    if (player.legacy) {
      ring = new THREE.Mesh(
        new THREE.TorusGeometry(8.8, 0.42, 12, 42),
        new THREE.MeshBasicMaterial({
          color: 0xffad42,
          transparent: true,
          opacity: 0.8,
        }),
      );
      ring.position.y = world.y;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }

    const labelEl = document.createElement("div");
    labelEl.className = "point-label";
    labelEl.textContent = player.name;
    const labelObj = new CSS2DObject(labelEl);
    labelObj.position.set(0, world.y + 9, 0);
    group.add(labelObj);

    scene.add(group);

    const point = { player, group, orb, ring, pillar, labelEl, labelObj, world };
    state.points.push(point);
    state.pickables.push(orb);
  });
}

function wireUi() {
  dom.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      stopTour();
      applyFilter(button.dataset.filter || "all");
    });
  });
  dom.tourBtn.addEventListener("click", () => {
    if (state.touring) {
      stopTour();
    } else {
      startTour();
    }
  });
}

function applyFilter(filter) {
  state.filter = filter;
  let visibleCount = 0;

  state.points.forEach((point) => {
    const visible =
      filter === "all" ||
      (filter === "modern" && !point.player.legacy) ||
      (filter === "legacy" && point.player.legacy);
    point.group.visible = visible;
    point.labelEl.style.display = visible ? "block" : "none";
    if (visible) visibleCount += 1;
  });

  if (state.selected && !state.selected.group.visible) {
    selectPoint(null);
  }

  dom.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });

  dom.hudBadge.textContent =
    `${visibleCount} players visible | Debut ${bounds.yearMin + 1}-${bounds.yearMax - 1} | SR ${bounds.srMin}-${bounds.srMax} | Career ${bounds.durationMin}-${bounds.durationMax}y`;
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  updateHover(event.clientX, event.clientY);
}

function onPointerLeave() {
  mouse.x = -10;
  mouse.y = -10;
  setHoveredPoint(null);
}

function onPointerClick() {
  stopTour();
  if (!state.hovered) return;
  selectPoint(state.hovered, { focus: true });
}

function updateHover(clientX, clientY) {
  raycaster.setFromCamera(mouse, camera);
  const intersections = raycaster.intersectObjects(state.pickables, false);
  const hit = intersections.find((entry) => {
    const point = state.points[entry.object.userData.pointIndex];
    return point && point.group.visible;
  });
  const nextHovered = hit ? state.points[hit.object.userData.pointIndex] : null;
  setHoveredPoint(nextHovered, clientX, clientY);
}

function setHoveredPoint(point, clientX, clientY) {
  if (state.hovered === point && point) {
    positionHoverTag(clientX, clientY);
    return;
  }

  if (state.hovered && state.hovered !== state.selected) {
    state.hovered.orb.material.emissiveIntensity = 1.05;
    state.hovered.orb.scale.setScalar(1);
  }

  state.hovered = point;

  if (!point) {
    dom.hoverTag.hidden = true;
    return;
  }

  if (point !== state.selected) {
    point.orb.material.emissiveIntensity = 1.65;
    point.orb.scale.setScalar(1.2);
  }
  dom.hoverTag.textContent = `${point.player.name} | SR ${point.player.strikeRate.toFixed(2)} | Career ${point.player.careerDurationYears}y`;
  dom.hoverTag.hidden = false;
  positionHoverTag(clientX, clientY);
}

function positionHoverTag(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  dom.hoverTag.style.left = `${clientX}px`;
  dom.hoverTag.style.top = `${clientY}px`;
}

function selectPoint(point, options = { focus: false }) {
  if (state.selected && state.selected !== point) {
    state.selected.orb.material.emissiveIntensity = 1.05;
  }
  state.selected = point;

  if (!point) {
    dom.playerName.textContent = "Click a player orb";
    dom.playerSummary.textContent = "Hover or click any point to inspect player details.";
    dom.statDebut.textContent = "-";
    dom.statSR.textContent = "-";
    dom.statCareer.textContent = "-";
    dom.statEra.textContent = "-";
    return;
  }

  point.orb.material.emissiveIntensity = 2.15;
  dom.playerName.textContent = point.player.name;
  dom.playerSummary.textContent = `${point.player.country || "Test Player"} | ${point.player.runs.toLocaleString()} runs`;
  dom.statDebut.textContent = `${point.player.debutYear}-${point.player.lastYear}`;
  dom.statSR.textContent = point.player.strikeRate.toFixed(2);
  dom.statCareer.textContent = `${point.player.careerDurationYears} years`;
  dom.statEra.textContent = point.player.legacy ? "Pre-1990 (incomplete SR era)" : "1990+";

  if (options.focus) {
    focusOnPoint(point);
  }
}

function focusOnPoint(point) {
  const destination = point.world.clone().add(new THREE.Vector3(56, 32, 56));
  const camPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const targetPos = { x: controls.target.x, y: controls.target.y, z: controls.target.z };

  if (state.focusTween) state.focusTween.kill();
  state.focusTween = gsap.timeline();
  state.focusTween.to(
    camPos,
    {
      duration: 1.15,
      x: destination.x,
      y: destination.y,
      z: destination.z,
      ease: "power2.inOut",
      onUpdate: () => camera.position.set(camPos.x, camPos.y, camPos.z),
    },
    0,
  );
  state.focusTween.to(
    targetPos,
    {
      duration: 1.15,
      x: point.world.x,
      y: point.world.y - 8,
      z: point.world.z,
      ease: "power2.inOut",
      onUpdate: () => controls.target.set(targetPos.x, targetPos.y, targetPos.z),
    },
    0,
  );
}

function startTour() {
  const queue = state.points
    .filter((point) => point.group.visible)
    .sort((a, b) => b.player.strikeRate - a.player.strikeRate);

  if (!queue.length) return;
  stopTour();
  state.touring = true;
  dom.tourBtn.textContent = "Stop Tour";
  dom.tourBtn.classList.add("is-active");

  let idx = 0;
  const step = () => {
    if (!state.touring) return;
    const point = queue[idx % queue.length];
    selectPoint(point, { focus: true });
    idx += 1;
    state.tourTimer = window.setTimeout(step, 2400);
  };
  step();
}

function stopTour() {
  if (!state.touring && !state.tourTimer) return;
  state.touring = false;
  if (state.tourTimer) {
    window.clearTimeout(state.tourTimer);
    state.tourTimer = null;
  }
  dom.tourBtn.textContent = "Start Tour";
  dom.tourBtn.classList.remove("is-active");
}

function onKeyDown(event) {
  state.keys.add(event.code);
  if (event.code === "Escape") stopTour();
}

function onKeyUp(event) {
  state.keys.delete(event.code);
}

function updateKeyboardNavigation(deltaSeconds) {
  if (!state.keys.size) return;
  const baseSpeed = state.keys.has("ShiftLeft") || state.keys.has("ShiftRight") ? 210 : 120;
  const move = new THREE.Vector3();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() > 0) forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  if (state.keys.has("KeyW")) move.add(forward);
  if (state.keys.has("KeyS")) move.add(forward.clone().multiplyScalar(-1));
  if (state.keys.has("KeyA")) move.add(right.clone().multiplyScalar(-1));
  if (state.keys.has("KeyD")) move.add(right);

  if (move.lengthSq() > 0) move.normalize().multiplyScalar(baseSpeed * deltaSeconds);
  camera.position.add(move);
  controls.target.add(move);

  if (state.keys.has("KeyQ")) {
    camera.position.y += baseSpeed * deltaSeconds * 0.8;
    controls.target.y += baseSpeed * deltaSeconds * 0.8;
  }
  if (state.keys.has("KeyE")) {
    camera.position.y -= baseSpeed * deltaSeconds * 0.8;
    controls.target.y -= baseSpeed * deltaSeconds * 0.8;
  }
}

function animate() {
  const elapsed = performance.now() * 0.001;
  const delta = clock.getDelta();

  updateKeyboardNavigation(delta);

  state.points.forEach((point, idx) => {
    if (!point.group.visible) return;
    const selectedBoost = point === state.selected ? 1.34 : 1;
    const pulse = 1 + Math.sin(elapsed * 2.5 + idx * 0.42) * 0.08;
    point.orb.scale.setScalar(selectedBoost * pulse);
    if (point.ring) {
      point.ring.rotation.y += 0.014;
      point.ring.scale.setScalar(1 + Math.sin(elapsed * 2.0 + idx) * 0.06);
    }
    point.labelEl.style.opacity = point === state.selected ? "1" : "0.88";
  });

  controls.update();
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function flyInCamera() {
  const from = { x: 620, y: 360, z: 580 };
  camera.position.set(from.x, from.y, from.z);
  gsap.to(from, {
    duration: 1.8,
    x: 360,
    y: 190,
    z: 330,
    ease: "power3.out",
    onUpdate: () => camera.position.set(from.x, from.y, from.z),
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
