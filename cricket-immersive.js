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
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchChip: document.getElementById("searchChip"),
  searchChipText: document.getElementById("searchChipText"),
  searchChipClear: document.getElementById("searchChipClear"),
  volumeBtn: document.getElementById("volumeBtn"),
  volumeAxisButtons: Array.from(document.querySelectorAll("[data-volume-axis]")),
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
  volumeVisible: true,
  volumeAxes: { x: true, y: false, z: false },
  volumeSceneObjects: [],
  occlusionCheckAccumulator: 0,
  isolatedPoint: null,
  singleClickTimer: null,
  searchQuery: "",
};

const bounds = {
  yearMin: 0,
  yearMax: 0,
  lastYearMin: 0,
  lastYearMax: 0,
  calendarYearMin: 0,
  calendarYearMax: 0,
  runsMin: 0,
  runsMax: 0,
  srMin: 0,
  srMax: 0,
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
const occlusionRaycaster = new THREE.Raycaster();
const cameraWorldPos = new THREE.Vector3();
const pointWorldPos = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const projectedPoint = new THREE.Vector3();

const WORLD = {
  xMin: -250,
  xMax: 250,
  yMin: 18,
  yMax: 245,
  zMin: -170,
  zMax: 170,
};

const VOLUME_THICKNESS = {
  x: 6.5,
  y: 10,
  z: 6.5,
};

const AXIS_LABEL_PAD = {
  x: 32,
  y: 36,
  z: 24,
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
  setVolumeVisibility(state.volumeVisible);
  syncSearchUi();
  applyFilter("all");
  updatePointOcclusionVisibility(true);
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
  bounds.lastYearMin = Math.min(...players.map((p) => p.lastYear)) - 1;
  bounds.lastYearMax = Math.max(...players.map((p) => p.lastYear)) + 1;
  bounds.calendarYearMin = Math.min(bounds.yearMin, bounds.lastYearMin);
  bounds.calendarYearMax = Math.max(bounds.yearMax, bounds.lastYearMax);
  bounds.runsMin = Math.floor(Math.min(...players.map((p) => p.runs)) / 1000) * 1000;
  bounds.runsMax = Math.ceil(Math.max(...players.map((p) => p.runs)) / 1000) * 1000;
  bounds.srMin = Math.floor(Math.min(...players.map((p) => p.strikeRate)) / 5) * 5;
  bounds.srMax = Math.ceil(Math.max(...players.map((p) => p.strikeRate)) / 5) * 5;
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function toWorldPosition(player) {
  return new THREE.Vector3(
    mapRange(player.lastYear, bounds.calendarYearMin, bounds.calendarYearMax, WORLD.xMax, WORLD.xMin),
    mapRange(player.runs, bounds.runsMin, bounds.runsMax, WORLD.yMin, WORLD.yMax),
    mapRange(player.strikeRate, bounds.srMin, bounds.srMax, WORLD.zMin, WORLD.zMax),
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
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;
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
  renderer.domElement.addEventListener("dblclick", onPointerDoubleClick);
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

  // Transparent bounding volume so the chart reads as a true 3D data block.
  const cubeWidth = WORLD.xMax - WORLD.xMin;
  const cubeHeight = WORLD.yMax - 0.01;
  const cubeDepth = WORLD.zMax - WORLD.zMin;
  const cubeGeometry = new THREE.BoxGeometry(cubeWidth, cubeHeight, cubeDepth);
  const cubeCenter = new THREE.Vector3(
    (WORLD.xMin + WORLD.xMax) / 2,
    cubeHeight / 2,
    (WORLD.zMin + WORLD.zMax) / 2,
  );
  const cube = new THREE.Mesh(
    cubeGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x123447,
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  cube.position.copy(cubeCenter);
  scene.add(cube);
  state.volumeSceneObjects.push({ obj: cube, kind: "cube" });

  const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cubeGeometry),
    new THREE.LineBasicMaterial({
      color: 0x2a6f8d,
      transparent: true,
      opacity: 0.22,
    }),
  );
  cubeEdges.position.copy(cubeCenter);
  scene.add(cubeEdges);
  state.volumeSceneObjects.push({ obj: cubeEdges, kind: "cube" });

  const yearRange = bounds.calendarYearMax - bounds.calendarYearMin;
  const yearStep = yearRange <= 16 ? 2 : 5;
  for (
    let year = Math.ceil(bounds.calendarYearMin / yearStep) * yearStep;
    year <= bounds.calendarYearMax;
    year += yearStep
  ) {
    const x = mapRange(year, bounds.calendarYearMin, bounds.calendarYearMax, WORLD.xMax, WORLD.xMin);
    addTick(new THREE.Vector3(x, 0.01, WORLD.zMin), 0x215a75);
    addAxisLabel(`${year}`, new THREE.Vector3(x, 7, WORLD.zMin - AXIS_LABEL_PAD.x), "axis-label");
    addAxisLabel(`${year}`, new THREE.Vector3(x, 7, WORLD.zMax + AXIS_LABEL_PAD.x), "axis-label");

    const yearsSlice = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.zMax - WORLD.zMin, WORLD.yMax - WORLD.yMin),
      new THREE.MeshBasicMaterial({
        color: 0x1f5e7d,
        transparent: true,
        opacity: 0.028,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    yearsSlice.position.set(x, (WORLD.yMin + WORLD.yMax) / 2, (WORLD.zMin + WORLD.zMax) / 2);
    yearsSlice.rotation.y = Math.PI / 2;
    scene.add(yearsSlice);
    state.volumeSceneObjects.push({ obj: yearsSlice, kind: "slice", axis: "x" });
  }
  const runsRange = bounds.runsMax - bounds.runsMin;
  const runsStep = runsRange <= 6000 ? 1000 : 2000;
  for (
    let runs = Math.ceil(bounds.runsMin / runsStep) * runsStep;
    runs <= bounds.runsMax;
    runs += runsStep
  ) {
    const y = mapRange(runs, bounds.runsMin, bounds.runsMax, WORLD.yMin, WORLD.yMax);
    addTick(new THREE.Vector3(WORLD.xMin - 4.8, y, WORLD.zMin), 0x1f5e7d, true);
    addAxisLabel(
      `${Math.round(runs / 1000)}k`,
      new THREE.Vector3(WORLD.xMin - AXIS_LABEL_PAD.y, y, WORLD.zMin - AXIS_LABEL_PAD.z),
      "axis-label",
    );

    const runsSlice = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.xMax - WORLD.xMin, WORLD.zMax - WORLD.zMin),
      new THREE.MeshBasicMaterial({
        color: 0x225f75,
        transparent: true,
        opacity: 0.026,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    runsSlice.position.set((WORLD.xMin + WORLD.xMax) / 2, y, (WORLD.zMin + WORLD.zMax) / 2);
    runsSlice.rotation.x = Math.PI / 2;
    scene.add(runsSlice);
    state.volumeSceneObjects.push({ obj: runsSlice, kind: "slice", axis: "y" });
  }
  for (
    let sr = Math.ceil(bounds.srMin / 5) * 5;
    sr <= bounds.srMax;
    sr += 5
  ) {
    const z = mapRange(sr, bounds.srMin, bounds.srMax, WORLD.zMin, WORLD.zMax);
    addTick(new THREE.Vector3(WORLD.xMin, 0.01, z), 0x1f5e7d, true);
    addAxisLabel(`${sr}`, new THREE.Vector3(WORLD.xMax + AXIS_LABEL_PAD.z, 7, z), "axis-label");
    addAxisLabel(`${sr}`, new THREE.Vector3(WORLD.xMin - AXIS_LABEL_PAD.y, 7, z), "axis-label");

    const srSlice = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.xMax - WORLD.xMin, WORLD.yMax - WORLD.yMin),
      new THREE.MeshBasicMaterial({
        color: 0x1f5e7d,
        transparent: true,
        opacity: 0.032,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    srSlice.position.set((WORLD.xMin + WORLD.xMax) / 2, (WORLD.yMin + WORLD.yMax) / 2, z);
    scene.add(srSlice);
    state.volumeSceneObjects.push({ obj: srSlice, kind: "slice", axis: "z" });
  }
  addAxisLabel(
    "YEARS ACTIVE",
    new THREE.Vector3((WORLD.xMin + WORLD.xMax) / 2, -10, WORLD.zMin - AXIS_LABEL_PAD.x - 16),
    "axis-label axis-title",
  );
  addAxisLabel(
    "YEARS ACTIVE",
    new THREE.Vector3((WORLD.xMin + WORLD.xMax) / 2, -10, WORLD.zMax + AXIS_LABEL_PAD.x + 16),
    "axis-label axis-title",
  );
  addAxisLabel(
    "RUNS",
    new THREE.Vector3(WORLD.xMin - AXIS_LABEL_PAD.y - 16, WORLD.yMax + 10, WORLD.zMin - AXIS_LABEL_PAD.z),
    "axis-label axis-title",
  );
  addAxisLabel(
    "STRIKE RATE",
    new THREE.Vector3(WORLD.xMax + AXIS_LABEL_PAD.z + 18, -10, (WORLD.zMin + WORLD.zMax) / 2),
    "axis-label axis-title",
  );
  addAxisLabel(
    "STRIKE RATE",
    new THREE.Vector3(WORLD.xMin - AXIS_LABEL_PAD.y - 18, -10, (WORLD.zMin + WORLD.zMax) / 2),
    "axis-label axis-title",
  );
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

    const volumeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const volume = new THREE.Mesh(
      volumeGeometry,
      new THREE.MeshStandardMaterial({
        color: player.legacy ? 0xae6b1d : 0x1f6f84,
        emissive: player.legacy ? 0x40250d : 0x103b45,
        emissiveIntensity: 0.62,
        roughness: 0.5,
        metalness: 0.34,
        transparent: false,
        opacity: 1,
      }),
    );
    group.add(volume);

    const volumeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(volumeGeometry),
      new THREE.LineBasicMaterial({
        color: player.legacy ? 0xffc16b : 0x8aefff,
        transparent: false,
        opacity: 1,
      }),
    );
    group.add(volumeEdges);

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

    const point = {
      player,
      group,
      orb,
      ring,
      pillar,
      volume,
      volumeEdges,
      labelEl,
      labelObj,
      world,
    };
    updatePointVolumeGeometry(point);
    state.points.push(point);
    state.pickables.push(orb);
  });
}

function getActiveVolumeAxisCount() {
  return (state.volumeAxes.x ? 1 : 0) + (state.volumeAxes.y ? 1 : 0) + (state.volumeAxes.z ? 1 : 0);
}

function getActiveVolumeAxisLabels() {
  return ["x", "y", "z"].filter((axis) => state.volumeAxes[axis]).map((axis) => axis.toUpperCase());
}

function ensureIntervalSize(start, end, minSize, anchorToEnd = false) {
  let a = start;
  let b = end;
  if (b < a) {
    a = end;
    b = start;
  }
  const size = b - a;
  if (size >= minSize) {
    return { start: a, end: b };
  }
  if (anchorToEnd) {
    return { start: b - minSize, end: b };
  }
  const mid = (a + b) / 2;
  return { start: mid - minSize / 2, end: mid + minSize / 2 };
}

function updatePointVolumeGeometry(point) {
  const { world } = point;

  let xInterval;
  if (state.volumeAxes.x) {
    const debutYearOnX = mapRange(
      point.player.debutYear,
      bounds.calendarYearMin,
      bounds.calendarYearMax,
      WORLD.xMax,
      WORLD.xMin,
    );
    xInterval = ensureIntervalSize(debutYearOnX - world.x, 0, 1.5, true);
  } else {
    xInterval = ensureIntervalSize(-VOLUME_THICKNESS.x / 2, VOLUME_THICKNESS.x / 2, VOLUME_THICKNESS.x, false);
  }

  let yInterval;
  if (state.volumeAxes.y) {
    yInterval = ensureIntervalSize(0, world.y, 1.8, true);
  } else {
    yInterval = ensureIntervalSize(world.y - VOLUME_THICKNESS.y / 2, world.y + VOLUME_THICKNESS.y / 2, VOLUME_THICKNESS.y, false);
  }

  let zInterval;
  if (state.volumeAxes.z) {
    zInterval = ensureIntervalSize(WORLD.zMin - world.z, 0, 1.5, true);
  } else {
    zInterval = ensureIntervalSize(-VOLUME_THICKNESS.z / 2, VOLUME_THICKNESS.z / 2, VOLUME_THICKNESS.z, false);
  }

  const sizeX = Math.max(1, xInterval.end - xInterval.start);
  const sizeY = Math.max(1, yInterval.end - yInterval.start);
  const sizeZ = Math.max(1, zInterval.end - zInterval.start);
  const centerX = (xInterval.start + xInterval.end) / 2;
  const centerY = (yInterval.start + yInterval.end) / 2;
  const centerZ = (zInterval.start + zInterval.end) / 2;

  const volumeGeometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  point.volume.geometry.dispose();
  point.volume.geometry = volumeGeometry;
  point.volume.position.set(centerX, centerY, centerZ);

  point.volumeEdges.geometry.dispose();
  point.volumeEdges.geometry = new THREE.EdgesGeometry(volumeGeometry);
  point.volumeEdges.position.copy(point.volume.position);
}

function refreshAllPointVolumes() {
  state.points.forEach((point) => {
    updatePointVolumeGeometry(point);
  });

  applyVolumeHighlightState();
}

function resetPointVolumeStyle(point) {
  point.volume.material.emissiveIntensity = 0.62;
  point.volumeEdges.material.color.set(point.player.legacy ? 0xffc16b : 0x8aefff);
}

function applyPointVolumeHoverStyle(point) {
  point.volume.material.emissiveIntensity = 0.9;
  point.volumeEdges.material.color.set(point.player.legacy ? 0xffd08e : 0xbaf8ff);
}

function applyPointVolumeSelectedStyle(point) {
  point.volume.material.emissiveIntensity = 1.2;
  point.volumeEdges.material.color.set(0xffffff);
}

function applyVolumeHighlightState() {
  state.points.forEach((point) => {
    resetPointVolumeStyle(point);
  });

  if (state.hovered && state.hovered !== state.selected) {
    applyPointVolumeHoverStyle(state.hovered);
  }
  if (state.selected) {
    applyPointVolumeSelectedStyle(state.selected);
  }
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
  dom.volumeBtn.addEventListener("click", () => {
    setVolumeVisibility(!state.volumeVisible);
  });
  dom.volumeAxisButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const axis = button.dataset.volumeAxis;
      if (!axis) return;
      toggleVolumeAxis(axis);
    });
  });
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setSearchQuery(dom.searchInput.value.trim());
  });
  dom.searchInput.addEventListener("input", () => {
    setSearchQuery(dom.searchInput.value);
  });
  dom.searchChipClear.addEventListener("click", () => {
    setSearchQuery("");
    dom.searchInput.value = "";
    dom.searchInput.focus();
  });
}

function applyFilter(filter) {
  state.filter = filter;
  dom.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });
  refreshPointVisibilityAndHud();
  updatePointOcclusionVisibility(true);
}

function isPointAllowedByFilter(point) {
  return (
    state.filter === "all" ||
    (state.filter === "modern" && !point.player.legacy) ||
    (state.filter === "legacy" && point.player.legacy)
  );
}

function pointMatchesSearch(point, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const p = point.player;

  const haystack = [
    p.name,
    p.country,
    `${p.debutYear}`,
    `${p.lastYear}`,
    `${p.debutYear}-${p.lastYear}`,
    `${p.runs}`,
    `${Math.round(p.runs / 1000)}k`,
    `${p.strikeRate.toFixed(2)}`,
    `${Math.round(p.strikeRate)}`,
    p.legacy ? "pre-1990" : "1990+",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function refreshPointVisibilityAndHud() {
  let visibleCount = 0;
  const isolating = Boolean(state.isolatedPoint);
  const searching = Boolean(state.searchQuery);

  state.points.forEach((point) => {
    const byFilter = isPointAllowedByFilter(point);
    const bySearch = pointMatchesSearch(point, state.searchQuery);
    const byIsolation = !isolating || point === state.isolatedPoint;
    const visible = byFilter && bySearch && byIsolation;
    point.group.visible = visible;
    point.labelEl.style.display = visible ? "block" : "none";
    if (visible) visibleCount += 1;
  });

  if (state.selected && !state.selected.group.visible) {
    selectPoint(null);
  }

  const isolateBadge = isolating ? ` | Isolated: ${state.isolatedPoint.player.name}` : "";
  const searchBadge = searching ? ` | Search: "${state.searchQuery}"` : "";
  dom.hudBadge.textContent =
    `${visibleCount} players visible | Years ${bounds.calendarYearMin + 1}-${bounds.calendarYearMax - 1} | Runs ${Math.round(
      bounds.runsMin / 1000,
    )}k-${Math.round(bounds.runsMax / 1000)}k | SR ${bounds.srMin}-${bounds.srMax}${searchBadge}${isolateBadge}`;
}

function setIsolatedPoint(point) {
  state.isolatedPoint = point;
  refreshPointVisibilityAndHud();
  updatePointOcclusionVisibility(true);
}

function setSearchQuery(query) {
  state.searchQuery = query.trim();

  // Search reset clears one-point isolation to avoid conflicting filters.
  if (state.searchQuery && state.isolatedPoint) {
    state.isolatedPoint = null;
  }

  syncSearchUi();
  refreshPointVisibilityAndHud();
  updatePointOcclusionVisibility(true);
}

function syncSearchUi() {
  const hasSearch = Boolean(state.searchQuery);
  dom.searchChip.hidden = !hasSearch;
  if (!hasSearch) return;
  dom.searchChipText.textContent = `Filtered: ${state.searchQuery}`;
}

function setVolumeVisibility(enabled) {
  state.volumeVisible = enabled;
  syncVolumeSceneVisibility();

  if (enabled) {
    applyVolumeHighlightState();
  }

  syncVolumeControlUi();
  updatePointOcclusionVisibility(true);
}

function toggleVolumeAxis(axis) {
  if (!Object.prototype.hasOwnProperty.call(state.volumeAxes, axis)) return;
  if (state.volumeAxes[axis] && getActiveVolumeAxisCount() === 1) {
    return;
  }

  state.volumeAxes[axis] = !state.volumeAxes[axis];
  refreshAllPointVolumes();
  syncVolumeSceneVisibility();
  syncVolumeControlUi();
  updatePointOcclusionVisibility(true);
}

function syncVolumeSceneVisibility() {
  const activeCount = getActiveVolumeAxisCount();
  const hasActiveAxis = activeCount > 0;

  state.volumeSceneObjects.forEach((entry) => {
    let visible = state.volumeVisible && hasActiveAxis;
    if (visible && entry.kind === "cube") {
      visible = activeCount >= 2;
    } else if (visible && entry.kind === "slice") {
      visible = Boolean(state.volumeAxes[entry.axis]);
    }
    entry.obj.visible = visible;
  });

  state.points.forEach((point) => {
    point.volume.visible = state.volumeVisible && hasActiveAxis;
    point.volumeEdges.visible = state.volumeVisible && hasActiveAxis;
  });
}

function updatePointOcclusionVisibility(force = false) {
  const shouldOcclude = state.volumeVisible && getActiveVolumeAxisCount() > 0;
  const intervalReached = force || state.occlusionCheckAccumulator >= 0.11;
  if (!intervalReached) return;
  state.occlusionCheckAccumulator = 0;

  if (!shouldOcclude) {
    state.points.forEach((point) => {
      const visible = point.group.visible;
      point.orb.visible = visible;
      point.labelEl.style.display = visible ? "block" : "none";
    });
    return;
  }

  const visibleVolumes = state.points
    .filter((point) => point.group.visible && point.volume.visible)
    .map((point) => point.volume);

  if (!visibleVolumes.length) {
    state.points.forEach((point) => {
      const visible = point.group.visible;
      point.orb.visible = visible;
      point.labelEl.style.display = visible ? "block" : "none";
    });
    return;
  }

  camera.getWorldPosition(cameraWorldPos);
  for (const point of state.points) {
    if (!point.group.visible) {
      point.orb.visible = false;
      point.labelEl.style.display = "none";
      continue;
    }

    point.orb.getWorldPosition(pointWorldPos);
    rayDirection.copy(pointWorldPos).sub(cameraWorldPos);
    const distanceToPoint = rayDirection.length();

    if (distanceToPoint < 1e-3) {
      point.orb.visible = true;
      point.labelEl.style.display = "block";
      continue;
    }

    rayDirection.multiplyScalar(1 / distanceToPoint);
    occlusionRaycaster.set(cameraWorldPos, rayDirection);
    occlusionRaycaster.near = 0.1;
    occlusionRaycaster.far = Math.max(0.1, distanceToPoint - 0.25);

    const blocked = occlusionRaycaster.intersectObjects(visibleVolumes, false).length > 0;
    point.orb.visible = !blocked;
    point.labelEl.style.display = blocked ? "none" : "block";
  }

  // Extra front-surface culling so interior/overlapped points do not show in volume mode.
  applyFrontSurfaceCulling();
}

function applyFrontSurfaceCulling() {
  const width = renderer.domElement.clientWidth || window.innerWidth;
  const height = renderer.domElement.clientHeight || window.innerHeight;
  const cellSize = 34;
  const candidates = [];

  camera.getWorldPosition(cameraWorldPos);

  for (const point of state.points) {
    if (!point.group.visible || !point.orb.visible) continue;

    point.orb.getWorldPosition(pointWorldPos);
    projectedPoint.copy(pointWorldPos).project(camera);
    if (projectedPoint.z < -1 || projectedPoint.z > 1) {
      point.orb.visible = false;
      point.labelEl.style.display = "none";
      continue;
    }

    const sx = (projectedPoint.x * 0.5 + 0.5) * width;
    const sy = (-projectedPoint.y * 0.5 + 0.5) * height;
    const dist2 = cameraWorldPos.distanceToSquared(pointWorldPos);
    candidates.push({ point, sx, sy, dist2 });
  }

  candidates.sort((a, b) => a.dist2 - b.dist2);
  const occupied = new Set();

  for (const item of candidates) {
    const gx = Math.floor(item.sx / cellSize);
    const gy = Math.floor(item.sy / cellSize);
    const isPriority = item.point === state.selected || item.point === state.hovered;

    let blockedByFront = false;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (occupied.has(`${gx + dx},${gy + dy}`)) {
          blockedByFront = true;
          break;
        }
      }
      if (blockedByFront) break;
    }

    if (blockedByFront && !isPriority) {
      item.point.orb.visible = false;
      item.point.labelEl.style.display = "none";
      continue;
    }

    occupied.add(`${gx},${gy}`);
  }
}

function syncVolumeControlUi() {
  const axes = getActiveVolumeAxisLabels();
  const axisDisplay = axes.join("+");
  dom.volumeBtn.textContent = state.volumeVisible ? `Volume On (${axisDisplay})` : "Volume Off";
  dom.volumeBtn.classList.toggle("is-active", state.volumeVisible);

  dom.volumeAxisButtons.forEach((button) => {
    const axis = button.dataset.volumeAxis;
    const isActiveAxis = Boolean(axis && state.volumeAxes[axis]);
    button.classList.toggle("is-active", isActiveAxis);
    button.disabled = !state.volumeVisible;
    button.style.opacity = state.volumeVisible ? "1" : "0.45";
  });
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
  if (state.singleClickTimer) {
    window.clearTimeout(state.singleClickTimer);
    state.singleClickTimer = null;
  }

  const clickedPoint = state.hovered;
  state.singleClickTimer = window.setTimeout(() => {
    state.singleClickTimer = null;

    if (!clickedPoint) {
      setIsolatedPoint(null);
      return;
    }

    selectPoint(clickedPoint, { focus: false });
    if (state.isolatedPoint === clickedPoint) {
      setIsolatedPoint(null);
    } else {
      setIsolatedPoint(clickedPoint);
    }
  }, 220);
}

function onPointerDoubleClick() {
  stopTour();
  if (state.singleClickTimer) {
    window.clearTimeout(state.singleClickTimer);
    state.singleClickTimer = null;
  }
  if (!state.hovered) return;

  setIsolatedPoint(null);
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
    resetPointVolumeStyle(state.hovered);
  }

  state.hovered = point;

  if (!point) {
    dom.hoverTag.hidden = true;
    return;
  }

  if (point !== state.selected) {
    point.orb.material.emissiveIntensity = 1.65;
    point.orb.scale.setScalar(1.2);
    applyPointVolumeHoverStyle(point);
  }
  dom.hoverTag.textContent = `${point.player.name} | SR ${point.player.strikeRate.toFixed(2)} | Career ${point.player.debutYear}-${point.player.lastYear}`;
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
    resetPointVolumeStyle(state.selected);
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
  applyPointVolumeSelectedStyle(point);
  dom.playerName.textContent = point.player.name;
  dom.playerSummary.textContent = `${point.player.country || "Test Player"} | ${point.player.runs.toLocaleString()} runs`;
  dom.statDebut.textContent = `${point.player.debutYear}-${point.player.lastYear}`;
  dom.statSR.textContent = point.player.strikeRate.toFixed(2);
  dom.statCareer.textContent = `${point.player.debutYear}-${point.player.lastYear} (${point.player.careerDurationYears} years)`;
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
  state.occlusionCheckAccumulator += delta;

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
  updatePointOcclusionVisibility(false);
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
