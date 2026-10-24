import * as THREE from "../../../vendor/three/three.module.min.js";
import { GLTFLoader } from "../../../vendor/three/loaders/GLTFLoader.js";
import { partitionArtistCassette } from "./artist-cassette.js";
import {
  appendRouteTrace, BRANCH_POOL_GAP, BRANCH_POOL_MARGIN, branchPoolProgress,
  buildPath, CASSETTE, clamp, clampRoller, closestPoint, closestPointOnSplitLane,
  closestVisibleTape,
  copyHeads, copyNodes, EDIT_MAX, EDIT_MIN, forkTiming, isExposed,
  headDelaySeconds, makeSplit, MAX_DELAY_POOLS, MAX_GUIDE_POSTS,
  MAX_PLAY_HEADS, MAX_RECORD_HEADS, MIN_POOL_SECONDS, MAX_POOL_SECONDS,
  nextPartId, pointAtForkTime, pointOnPool, pointOnSplitLane, pointOnTape,
  poolCenter, razorSplitRange, ROLLER_BOUNDS, routeSegmentTimes, tapeTimeline,
  simplifyRouteTrace,
} from "./path.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import {
  TAPEZOID_FULL_PRESETS, TAPEZOID_MEMORY_DEFAULTS, captureTapezoidPreset,
  randomizeTapezoidPreset, validateTapezoidPreset,
} from "./full-presets.js";
import { ORIGINAL_TRACK_RATE, renderTapezoidTrack } from "./demo-material.js";

const $ = (id) => document.getElementById(id);
const stage = $("scene");
const colors = {
  yellow: 0xdafa72, pink: 0xff6686, blue: 0x7cdbed,
  metal: 0x82909b, dark: 0x202b35, tape: 0x9a5454,
};
const EXTRA_SLIPS = [.33, .67, .125, .375, .625, .875];
const BUNDLED_CASSETTE_URL = new URL("../../../assets/tapezoid/cassette-tape.glb", import.meta.url);
const MAX_CASSETTE_BYTES = 32 * 1024 * 1024;
const originalTrack = {
  name: "Afterimage · original track",
  samples: renderTapezoidTrack(),
  rate: ORIGINAL_TRACK_RATE,
};
let track = originalTrack;
let trackLoadGeneration = 0;
let cassetteLoadGeneration = 0;
let cassetteFetchController = null;
let cassetteShellWidth = 4.5;
function trackEnvelope(samples) {
  const bins = new Float32Array(512);
  for (let i = 0; i < bins.length; i += 1) {
    const start = Math.floor(i * samples.length / bins.length);
    const end = Math.floor((i + 1) * samples.length / bins.length);
    let power = 0;
    for (let j = start; j < end; j += 1) power += samples[j] * samples[j];
    bins[i] = Math.min(1, Math.sqrt(power / Math.max(1, end - start)) * 5);
  }
  return bins;
}
let trackPeaks = trackEnvelope(track.samples);
const trackDuration = () => track.samples.length / track.rate;
const state = {
  nodes: copyNodes(),
  heads: copyHeads(),
  pools: [],
  patches: [],
  split: null,
  speed: 1,
  phase: .04,
  trackTime: 0,
  phaseShiftTime: 0,
  extraPhaseTimes: Array(6).fill(0),
  feedback: TAPEZOID_MEMORY_DEFAULTS.feedback,
  phaseSlip: TAPEZOID_MEMORY_DEFAULTS.phaseSlip,
  printing: TAPEZOID_MEMORY_DEFAULTS.printing,
  echoReturn: TAPEZOID_MEMORY_DEFAULTS.echoReturn,
  returnHead: TAPEZOID_MEMORY_DEFAULTS.returnHead,
  monitorMix: TAPEZOID_MEMORY_DEFAULTS.monitorMix,
  voices: TAPEZOID_MEMORY_DEFAULTS.voices,
  tool: "route",
  showTimes: true,
  selectedId: "roller-3",
  history: [],
  path: null,
  timeline: null,
  segmentTimes: [],
  fork: null,
};
let drag = null;
let audio = null;
let tapeMemory = null;
let lastFrame = performance.now();
let nextVisualFrame = 0;
let tapeGeometryGroup = null;
let frameId = 0;
let sceneUpdateQueued = false;
let lastWavePaint = 0;
let lastClockSecond = -1;
let destroyed = false;
let presetMenu = null;
const audioSessions = new Set();
const listeners = new AbortController();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
// Keep the overhead model lit, but do not cast shadows onto the desk.
renderer.shadowMap.enabled = false;
renderer.domElement.setAttribute("aria-hidden", "true"); // #scene owns the accessible gesture surface.
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101722);
scene.fog = new THREE.FogExp2(0x101722, .013);
const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, .1, 100);
camera.up.set(0, 0, -1);
const raycaster = new THREE.Raycaster();
const workPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.42);
const pointer = new THREE.Vector2();
const intersection = new THREE.Vector3();

scene.add(new THREE.HemisphereLight(0xe5f7ff, 0x263244, 1.65));
const key = new THREE.DirectionalLight(0xffe6cc, 3.1);
key.position.set(-4, 11, 6);
scene.add(key);
const edgeLight = new THREE.PointLight(colors.pink, 28, 19, 2);
edgeLight.position.set(2, 4, -4);
scene.add(edgeLight);

function material(color, metalness = 0, roughness = .7, options = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...options });
}
const tapeMaterial = material(colors.tape, .35, .42, { side: THREE.DoubleSide, emissive: 0x461f2e, emissiveIntensity: .26 });
const tapeEdgeMaterial = material(0xef977e, .35, .35, { emissive: 0x9b3b3b, emissiveIntensity: .45 });
const tapeGrip = new THREE.Mesh(new THREE.RingGeometry(.115, .155, 24),
  new THREE.MeshBasicMaterial({
    color: colors.yellow, transparent: true, opacity: .8,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
tapeGrip.rotation.x = -Math.PI / 2;
tapeGrip.visible = false;
tapeGrip.renderOrder = 4;
scene.add(tapeGrip);
const pegBodyMaterial = material(0x778996, .78, .27);
const pegTopMaterial = material(0x222e35, .55, .35);
const yellowMaterial = material(colors.yellow, .15, .28, { emissive: 0x799e24, emissiveIntensity: .52 });
const blueMaterial = material(colors.blue, .35, .26, { emissive: 0x15697d, emissiveIntensity: .52 });
const pinkMaterial = material(colors.pink, .35, .26, { emissive: 0x9f284e, emissiveIntensity: .6 });
const poolMaterial = material(0xcf9fff, .38, .3, { emissive: 0x8051bb, emissiveIntensity: .62 });
const poolTapeMaterial = material(0xb76e78, .32, .44, { side: THREE.DoubleSide, emissive: 0x6a315d, emissiveIntensity: .33 });
const metalMaterial = material(0xa9b7b9, .84, .23);
const darkMaterial = material(colors.dark, .48, .5);
// Shared across rebuilds. Only geometry is recreated during a route gesture.
const clearPatchMaterial = material(0xc5ecf0, .11, .2, { transparent: true, opacity: .77, depthWrite: false });
const patchEdgeMaterial = material(0xe6ffff, .2, .18);

function box(w, h, d, shade, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shade);
  mesh.position.set(x, y, z);
  return mesh;
}
function cylinder(radius, height, shade, x = 0, y = 0, z = 0, sides = 32) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), shade);
  mesh.position.set(x, y, z);
  return mesh;
}
function torus(radius, tube, shade, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 9, 40), shade);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}
function lineOnBoard(points, color, opacity = .18) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, .091, z)));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function makeWorkbench() {
  const group = new THREE.Group();
  // One continuous desk, not a framed exhibit with corner hardware.
  const ground = box(200, .025, 200, material(0x1a2630, .12, .91), 0, .02, 0);
  group.add(ground);
  for (let x = -7.2; x <= 7.2; x += .48) group.add(lineOnBoard([[x, -4.13], [x, 4.13]], 0xa2b2b6, .035));
  for (let z = -3.95; z <= 3.95; z += .48) group.add(lineOnBoard([[-7.2, z], [7.2, z]], 0xa2b2b6, .035));
  scene.add(group);
}
makeWorkbench();

function labelCanvas({ title, subtitle, accent, light = false }) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 210;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = light ? "#e7e2c9" : "#27343d";
  ctx.fillRect(0, 0, 640, 210);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 640, 27);
  ctx.fillRect(0, 183, 640, 27);
  ctx.fillStyle = light ? "#18232b" : "#f2eee5";
  ctx.font = "900 75px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 33, 117);
  ctx.font = "600 27px monospace";
  ctx.fillText(subtitle, 38, 160);
  ctx.fillStyle = accent;
  ctx.fillRect(530, 54, 69, 74);
  return new THREE.CanvasTexture(canvas);
}

const spools = [];
const driveWheels = [];
let stockCassette = null;
let importedCassette = null;
function createCassette() {
  const group = new THREE.Group();
  group.position.set(CASSETTE.x, 0, CASSETTE.z);
  const ports = new THREE.Group();
  ports.position.copy(group.position);
  const shell = 0x775262;
  const baseMaterial = material(shell, .18, .37, { transparent: true, opacity: .95, depthWrite: true });
  group.add(box(4.5, .3, 2.16, material(0x121a22, .3, .66), 0, .23, 0));
  group.add(box(4.44, .17, 2.11, baseMaterial, 0, .42, 0));
  const face = box(4.33, .018, 2, material(shell, .22, .33, { transparent: true, opacity: .78 }), 0, .52, 0);
  group.add(face);
  const inner = box(3.35, .017, .87, material(0x10191f, .35, .6), 0, .54, -.35);
  group.add(inner);

  for (const reelX of [-CASSETTE.portX, CASSETTE.portX]) {
    const hub = new THREE.Group();
    hub.position.set(reelX, .562, -.35);
    hub.add(cylinder(.42, .048, metalMaterial, 0, 0, 0));
    hub.add(cylinder(.32, .058, material(0x252d35, .4, .3), 0, .012, 0));
    hub.add(torus(.335, .035, material(0xb5a99a, .6, .38), 0, .051, 0));
    for (let i = 0; i < 5; i += 1) {
      const spoke = box(.042, .01, .26, material(0xd9dfd6, .62, .3), 0, .047, .17);
      spoke.rotation.y = i * Math.PI * 2 / 5;
      spoke.position.x = Math.sin(spoke.rotation.y) * .15;
      spoke.position.z = Math.cos(spoke.rotation.y) * .15;
      hub.add(spoke);
    }
    hub.add(cylinder(.09, .069, material(0x151c21, .45, .42), 0, .052, 0));
    group.add(hub);
    spools.push(hub);
  }

  const labelTexture = labelCanvas({
    title: "TAPEZOID", subtitle: "AFTERIMAGE / SIDE A", accent: "#dafa72", light: true,
  });
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const label = new THREE.Mesh(new THREE.PlaneGeometry(3.97, .75), new THREE.MeshBasicMaterial({ map: labelTexture }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, .541, .59);
  group.add(label);

  // Two distinct mouths on the *bottom* (near) edge, lined up with the
  // external ribbon. The unseen connector runs between them inside this shell.
  for (const [x, accent] of [[-CASSETTE.portX, pinkMaterial], [CASSETTE.portX, blueMaterial]]) {
    ports.add(box(.53, .13, .085, darkMaterial, x, .402, 1.092));
    ports.add(box(.58, .019, .13, metalMaterial, x, .33, 1.125));
    ports.add(box(.48, .016, .12, accent, x, .479, 1.125));
    ports.add(box(.19, .012, .3, tapeMaterial, x, .397, 1.16));
  }
  // A simple capstan/pinch pair on the return side, following the tape-path
  // relationship shown in open-reel transport drawings. This cassette is
  // artistic, not a literal three-motor Revox mechanism.
  ports.add(box(.92, .04, .6, darkMaterial, 1.62, .12, 1.31));
  for (const [x, z, shade] of [
    [1.57, 1.16, metalMaterial], [1.67, 1.48, pegTopMaterial],
  ]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0, z);
    wheel.add(cylinder(.135, .15, shade, 0, .29, 0));
    wheel.add(torus(.095, .012, metalMaterial, 0, .377, 0));
    wheel.add(box(.06, .01, .025, yellowMaterial, .07, .383, 0));
    ports.add(wheel);
    driveWheels.push(wheel);
  }
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.44, .17, 2.11)), new THREE.LineBasicMaterial({ color: 0xb4bac1, transparent: true, opacity: .47 }));
  edge.position.y = .42;
  group.add(edge);
  scene.add(group);
  scene.add(ports);
  stockCassette = group;
  stage.dataset.cassetteModel = "stock";
}
createCassette();

// Both the attributed bundled GLB and a session-local file replace just the
// generated shell. The authored ports, drive pair and tape path stay put.
function validateLocalGlb(buffer) {
  if (buffer.byteLength < 20) throw new TypeError("Choose a glTF 2.0 .glb file.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength
    || view.getUint32(16, true) !== 0x4e4f534a
    || view.getUint32(12, true) > buffer.byteLength - 20) {
    throw new TypeError("Choose a complete glTF 2.0 .glb file.");
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
  if (json.asset?.version !== "2.0" || !Array.isArray(json.meshes) || !json.meshes.length) {
    throw new TypeError("The GLB must contain a glTF 2.0 mesh.");
  }
  if ([...(json.images ?? []), ...(json.buffers ?? [])].some(item => item.uri && !item.uri.startsWith("data:"))) {
    throw new TypeError("The GLB must contain its textures and geometry; external URLs are not loaded.");
  }
}

function disposeImportedCassette(entry) {
  if (!entry) return;
  entry.mount.removeFromParent();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  entry.model.traverse(item => {
    if (item.geometry) geometries.add(item.geometry);
    for (const shade of (Array.isArray(item.material) ? item.material : [item.material])) {
      if (!shade) continue;
      materials.add(shade);
      for (const value of Object.values(shade)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const shade of materials) shade.dispose();
}

function cassettePartGeometry(original, indices, pivot = { x: 0, y: 0, z: 0 }) {
  const vertices = [...new Set(indices)];
  const remap = new Map(vertices.map((vertex, offset) => [vertex, offset]));
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(original.attributes)) {
    const source = attribute.array ?? attribute.data.array;
    const values = new source.constructor(vertices.length * attribute.itemSize);
    for (const [offset, vertex] of vertices.entries()) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        values[offset * attribute.itemSize + component] = attribute.getComponent(vertex, component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  geometry.setIndex(indices.map(vertex => remap.get(vertex)));
  geometry.translate(-pivot.x, -pivot.y, -pivot.z);
  return geometry;
}

function prepareArtistCassette(model) {
  const mesh = model.getObjectByProperty("isMesh", true);
  const original = mesh?.geometry;
  const parts = original && partitionArtistCassette(original);
  if (!parts || Array.isArray(mesh.material)) return null;

  // The GLB uses BLEND for the *entire* shell, though almost all texels are
  // opaque. Write opaque plastic to the depth buffer first; draw its small
  // translucent windows over the hubs in a separate pass. Otherwise the
  // shell can be sorted behind the exposed ribbon like a sheet of glass.
  const glass = mesh.material;
  glass.transparent = true;
  glass.depthWrite = false;
  const opaque = glass.clone();
  opaque.transparent = false;
  opaque.alphaTest = .995;
  opaque.depthWrite = true;
  function addWindow(outer) {
    outer.add(new THREE.Mesh(outer.geometry, glass));
  }

  mesh.geometry = cassettePartGeometry(original, parts.body);
  mesh.material = opaque;
  addWindow(mesh);
  const reels = parts.reels.map(({ pivot, indices }, index) => {
    const hub = new THREE.Group();
    hub.position.set(pivot.x, pivot.y, pivot.z);
    hub.rotation.z = spools[index].rotation.y;
    const face = new THREE.Mesh(cassettePartGeometry(original, indices, pivot), opaque);
    addWindow(face);
    hub.add(face);
    mesh.add(hub);
    return hub;
  });
  original.dispose();
  return {
    reels, reelTriangles: parts.reels.map(part => part.indices.length / 3),
    opaque, glass,
  };
}

function installCassetteModel(model, name, source) {
  const mount = new THREE.Group();
  const initial = new THREE.Box3().setFromObject(model);
  const dimensions = initial.getSize(new THREE.Vector3());
  const axes = ["x", "y", "z"].sort((a, b) => dimensions[b] - dimensions[a]);
  if (initial.isEmpty() || !Number.isFinite(dimensions[axes[0]])
    || dimensions[axes[2]] < 1e-6) throw new TypeError("The cassette mesh has no usable dimensions.");
  let vertices = 0;
  model.traverse(item => { vertices += item.geometry?.attributes?.position?.count ?? 0; });
  if (!vertices || vertices > 300_000) throw new RangeError("Choose a cassette with at most 300,000 vertices.");

  // Map widest -> desk X, thinnest -> up (Y), remaining -> desk Z.
  // The sign of Z keeps the rotation right-handed for every axis order.
  const directions = {
    [axes[0]]: new THREE.Vector3(1, 0, 0),
    [axes[2]]: new THREE.Vector3(0, 1, 0),
    [axes[1]]: new THREE.Vector3(0, 0, 1),
  };
  const rotation = new THREE.Matrix4().makeBasis(directions.x, directions.y, directions.z);
  if (rotation.determinant() < 0) {
    directions[axes[1]].z = -1;
    rotation.makeBasis(directions.x, directions.y, directions.z);
  }
  model.applyMatrix4(rotation);
  const oriented = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const fit = Math.min(4.36 / oriented.x, .68 / oriented.y, 2.08 / oriented.z);
  model.scale.multiplyScalar(fit);
  const fitted = new THREE.Box3().setFromObject(model);
  const width = fitted.getSize(new THREE.Vector3()).x;
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y += .56 - fitted.max.y;
  model.position.z -= center.z;
  const artist = source === "bundled" ? prepareArtistCassette(model) : null;
  mount.add(model);
  mount.position.set(CASSETTE.x, 0, CASSETTE.z);
  disposeImportedCassette(importedCassette);
  importedCassette = { mount, model, vertices, artist };
  stockCassette.visible = false;
  scene.add(mount);
  cassetteShellWidth = width;
  stage.dataset.cassetteModel = source;
  $("cassetteName").textContent = name;
  $("cassetteError").hidden = true;
  resize();
}

function cancelCassetteLoad() {
  cassetteLoadGeneration += 1;
  cassetteFetchController?.abort();
  cassetteFetchController = null;
  return cassetteLoadGeneration;
}

function restoreStockCassette() {
  cancelCassetteLoad();
  disposeImportedCassette(importedCassette);
  importedCassette = null;
  stockCassette.visible = true;
  cassetteShellWidth = 4.5;
  $("cassetteName").textContent = "Generated shell";
  $("cassetteFile").value = "";
  $("cassetteError").hidden = true;
  stage.dataset.cassetteModel = "stock";
  resize();
}

async function loadBundledCassette() {
  const generation = cancelCassetteLoad();
  const controller = new AbortController();
  cassetteFetchController = controller;
  $("cassetteError").hidden = true;
  if (!importedCassette) $("cassetteName").textContent = "Loading artist cassette…";
  let gltf;
  try {
    const response = await fetch(BUNDLED_CASSETTE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (destroyed || generation !== cassetteLoadGeneration) return;
    if (buffer.byteLength > MAX_CASSETTE_BYTES) throw new RangeError("The model exceeds 32 MB.");
    validateLocalGlb(buffer);
    gltf = await new GLTFLoader().parseAsync(buffer, "");
    if (destroyed || generation !== cassetteLoadGeneration) return;
    installCassetteModel(gltf.scene, "Cassette Tape · joshtmc", "bundled");
    gltf = null; // The scene now owns its geometry, materials and textures.
    $("cassetteFile").value = "";
  } catch (error) {
    if (destroyed || generation !== cassetteLoadGeneration) return;
    if (!importedCassette) $("cassetteName").textContent = "Generated shell";
    $("cassetteError").hidden = false;
    $("cassetteError").textContent = `Artist cassette unavailable (${error.message}); ${
      stage.dataset.cassetteModel === "stock" ? "generated shell in use" : "previous cassette kept"
    }. Try Artist cassette again.`;
  } finally {
    if (gltf) disposeImportedCassette({ mount: new THREE.Group(), model: gltf.scene });
    if (cassetteFetchController === controller) cassetteFetchController = null;
  }
}

const rollerGroups = new Map();
function makeRoller(node, number) {
  const group = new THREE.Group();
  group.add(cylinder(.37, .045, darkMaterial, 0, .16, 0));
  group.add(cylinder(.245, .22, pegBodyMaterial, 0, .295, 0));
  group.add(torus(.239, .028, yellowMaterial, 0, .419, 0));
  group.add(cylinder(.17, .027, pegTopMaterial, 0, .433, 0));
  group.add(cylinder(.08, .04, metalMaterial, 0, .461, 0));
  group.add(box(.084, .01, .018, darkMaterial, 0, .486, 0));
  const led = cylinder(.029, .012, yellowMaterial, -.17, .447, 0, 12);
  group.add(led);
  group.position.set(node.x, 0, node.z);
  group.userData.number = number;
  scene.add(group);
  return group;
}
for (const [index, node] of state.nodes.filter((item) => item.kind === "roller").entries()) rollerGroups.set(node.id, makeRoller(node, index + 1));

const poolGroups = new Map();
function makePool(pool) {
  const group = new THREE.Group();
  const basin = new THREE.Group();
  basin.add(cylinder(.51, .055, darkMaterial, 0, .18, 0));
  basin.add(torus(.46, .035, poolMaterial, 0, .235, 0));
  basin.add(cylinder(.38, .045, pegTopMaterial, 0, .255, 0));
  group.add(basin);
  group.add(cylinder(.09, .08, poolMaterial, 0, .30, 0, 12));
  group.userData.basin = basin;
  scene.add(group);
  return group;
}

// The direct lane needs no post. The separating post pulls the second copy
// away; both tapes already meet at the next join, without Scotch or a gap.
const splitGuideGroups = new Map(["lane-a", "lane-b"].map(id => {
  const group = new THREE.Group();
  if (id === "lane-a") {
    // A shallow grip only appears while this lane is selected. Razor still
    // inserts just one physical separating post, on the blue lane.
    group.add(cylinder(.105, .019, yellowMaterial, 0, .42, 0));
    group.add(box(.13, .014, .026, darkMaterial, 0, .433, 0));
  } else {
    group.add(cylinder(.22, .055, darkMaterial, 0, .20, 0));
    group.add(cylinder(.14, .22, pegBodyMaterial, 0, .33, 0));
    group.add(torus(.17, .033, blueMaterial, 0, .451, 0));
    group.add(cylinder(.10, .025, pegTopMaterial, 0, .462, 0));
    group.add(box(.1, .012, .034, blueMaterial, 0, .48, 0));
  }
  group.visible = false;
  scene.add(group);
  return [id, group];
}));
// The second post is the movable end of the blue virtual ribbon. It starts
// where the original fork joins, then snaps to a later *intact* segment.
const junctionGroup = new THREE.Group();
junctionGroup.add(cylinder(.18, .024, darkMaterial, 0, .42, 0));
junctionGroup.add(torus(.155, .028, clearPatchMaterial, 0, .442, 0));
junctionGroup.add(cylinder(.068, .022, blueMaterial, 0, .455, 0));
junctionGroup.visible = false;
scene.add(junctionGroup);
const previewPositions = new Float32Array(6);
const junctionPreviewGeometry = new THREE.BufferGeometry();
junctionPreviewGeometry.setAttribute("position", new THREE.BufferAttribute(previewPositions, 3));
const junctionPreview = new THREE.Line(junctionPreviewGeometry,
  new THREE.LineBasicMaterial({ color: colors.blue, transparent: true, opacity: .68 }));
junctionPreview.visible = false;
scene.add(junctionPreview);
function previewJunction(position) {
  const guide = state.split?.guides[1];
  if (!guide) return;
  previewPositions.set([guide.x, .49, guide.z, position.x, .49, position.z]);
  junctionPreviewGeometry.attributes.position.needsUpdate = true;
  junctionPreview.visible = true;
}

function makeHead(head) {
  const group = new THREE.Group();
  const shade = head.kind === "record" ? pinkMaterial : blueMaterial;
  const dark = material(0x192731, .55, .5);
  group.add(box(.5, .1, .54, dark, 0, .37, 0));
  group.add(box(.3, .17, .42, shade, 0, .485, -.01));
  group.add(box(.42, .035, .13, metalMaterial, 0, .57, -.19));
  group.add(box(.07, .02, .13, material(0x0b161d, .3, .5), 0, .591, -.19));
  const needle = new THREE.Mesh(new THREE.ConeGeometry(.1, .25, 3), shade);
  needle.position.set(0, .481, .35);
  needle.rotation.x = Math.PI / 2;
  group.add(needle);
  if (head.kind === "record") {
    const lampShade = material(colors.pink, .12, .2, { emissive: colors.pink, emissiveIntensity: .08 });
    const lamp = cylinder(.052, .023, lampShade, .17, .588, .07, 16);
    group.add(lamp);
    group.userData.printLamp = lamp;
  }
  const labelTexture = labelCanvas({
    title: `${head.kind === "record" ? "REC" : "PLAY"} ${String(Number(head.id.split("-").at(-1)) || 1).padStart(2, "0")}`,
    subtitle: head.kind === "record" ? "PRINTS THE TAPE" : "READS THE STRIP",
    accent: head.kind === "record" ? "#ff6686" : "#7cdbed",
  });
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(.91, .3, 1);
  sprite.position.set(0, .84, .19);
  group.add(sprite);
  scene.add(group);
  return group;
}
const headGroups = new Map(state.heads.map((head) => [head.id, makeHead(head)]));

// A continuous ribbon strip and two thin edges.
function pathSegment(start, end, width, height, shade,
  sample = (position) => pointOnTape(state.path, position), pathLength = state.path.exposedLength) {
  if (end - start < .002) return null;
  // The tape can now visit dozens of turns. Cap GPU triangulation per strip;
  // the pure path and worklet keep the full geometry/timing.
  const count = Math.max(3, Math.min(560, Math.ceil((end - start) * pathLength * 5)));
  const vertices = [];
  const indices = [];
  const left = [], right = [];
  for (let i = 0; i <= count; i += 1) {
    const s = start + (end - start) * i / count;
    const position = sample(s);
    const nx = -position.tz, nz = position.tx;
    const x = position.x, z = position.z;
    const y = height;
    left.push(new THREE.Vector3(x + nx * width / 2, y, z + nz * width / 2));
    right.push(new THREE.Vector3(x - nx * width / 2, y, z - nz * width / 2));
    vertices.push(x + nx * width / 2, y, z + nz * width / 2);
    vertices.push(x - nx * width / 2, y, z - nz * width / 2);
    if (i < count) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, shade);
  const group = new THREE.Group();
  group.add(mesh);
  for (const edge of [left, right]) {
    const curve = new THREE.CatmullRomCurve3(edge, false, "centripetal", .1);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, count, .013, 3, false), tapeEdgeMaterial));
  }
  return group;
}

function adhesivePatch(position) {
  const p = pointOnTape(state.path, position);
  const group = new THREE.Group();
  group.position.set(p.x, .428, p.z);
  group.rotation.y = Math.atan2(p.tx, p.tz);
  const clear = box(.35, .018, .56, clearPatchMaterial, 0, .03, 0);
  group.add(clear);
  group.add(box(.33, .009, .026, patchEdgeMaterial, 0, .045, -.23));
  group.add(box(.33, .009, .026, patchEdgeMaterial, 0, .045, .23));
  return group;
}

function disposeGeometry(group) {
  group?.traverse((item) => item.geometry?.dispose());
  if (group) scene.remove(group);
}

const flecks = new THREE.InstancedMesh(
  new THREE.BoxGeometry(.07, .012, .019),
  new THREE.MeshBasicMaterial({ color: 0xfbd5aa }),
  130,
);
flecks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
flecks.frustumCulled = false;
scene.add(flecks);
const marker = new THREE.Mesh(new THREE.SphereGeometry(.095, 12, 8), material(colors.yellow, .05, .1, { emissive: colors.yellow, emissiveIntensity: 1.2 }));
scene.add(marker);
const splitMarker = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 8), blueMaterial);
splitMarker.visible = false;
scene.add(splitMarker);
const instanceDummy = new THREE.Object3D();

// The two waveform pairs follow the original track and its slipping virtual
// copy across the same ribbon. The recorded echo is stored on the audio thread.
// Only the coordinates change per frame; geometry and materials stay put.
const WAVE_STEPS = 176;
const wavePositions = new Float32Array((WAVE_STEPS - 1) * 2 * 2 * 3);
const phaseWavePositions = new Float32Array(wavePositions.length);
const waveGeometry = new THREE.BufferGeometry();
waveGeometry.setAttribute("position", new THREE.BufferAttribute(wavePositions, 3).setUsage(THREE.DynamicDrawUsage));
const phaseWaveGeometry = new THREE.BufferGeometry();
phaseWaveGeometry.setAttribute("position", new THREE.BufferAttribute(phaseWavePositions, 3).setUsage(THREE.DynamicDrawUsage));
const tapeWave = new THREE.LineSegments(waveGeometry, new THREE.LineBasicMaterial({ color: 0xffd5a5, transparent: true, opacity: .9 }));
const phaseWave = new THREE.LineSegments(phaseWaveGeometry, new THREE.LineBasicMaterial({ color: colors.blue, transparent: true, opacity: .78 }));
tapeWave.frustumCulled = false;
phaseWave.frustumCulled = false;
scene.add(tapeWave);
scene.add(phaseWave);
const SPLIT_WAVE_STEPS = 72;
const splitWave = [colors.yellow, colors.blue].map(color => {
  const positions = new Float32Array((SPLIT_WAVE_STEPS - 1) * 2 * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color, transparent: true, opacity: .9,
  }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { positions, geometry, line };
});

function drawTrackWave() {
  const path = state.path, timeline = state.timeline;
  const recordPosition = state.heads.find(head => head.kind === "record").position;
  const branches = state.fork;
  const duration = trackDuration();
  let index = 0;
  let previous = null;
  function wavePoint(s) {
    const p = pointOnTape(path, s);
    const afterAmber = branches && s > branches.end && recordPosition < branches.start;
    const afterBlue = branches && s > branches.join && recordPosition < branches.start;
    const travel = headDelaySeconds(path, state.pools, recordPosition, s, timeline);
    const time = ((state.trackTime - travel
      - (afterAmber ? branches.lanes[0].delaySeconds * timeline.scale : 0))
      % duration + duration) % duration;
    const phaseTime = ((state.trackTime - travel
      - (afterBlue ? branches.lanes[1].delaySeconds * timeline.scale
        : afterAmber ? branches.lanes[0].delaySeconds * timeline.scale : 0)
      + (state.voices > 1 ? state.phaseShiftTime : 0)) % duration + duration) % duration;
    return {
      p,
      amplitude: .01 + trackPeaks[Math.min(trackPeaks.length - 1, Math.floor(time / duration * trackPeaks.length))] * .071,
      phaseAmplitude: .006 + trackPeaks[Math.min(trackPeaks.length - 1, Math.floor(phaseTime / duration * trackPeaks.length))] * .052,
    };
  }
  for (let i = 0; i < WAVE_STEPS - 1; i += 1) {
    const start = i / (WAVE_STEPS - 1), end = (i + 1) / (WAVE_STEPS - 1);
    const visible = (!branches || end < branches.start || start > branches.end)
      && !timeline.pools.some(pool => start < pool.position + .015 && end > pool.position - .015);
    const first = previous ?? wavePoint(start), second = wavePoint(end);
    for (const side of [-1, 1]) {
      for (const { p, amplitude, phaseAmplitude } of [first, second]) {
        wavePositions[index++] = visible ? p.x - p.tz * amplitude * side : 0;
        wavePositions[index++] = visible ? .417 : -1;
        wavePositions[index++] = visible ? p.z + p.tx * amplitude * side : 0;
        phaseWavePositions[index - 3] = visible ? p.x - p.tz * phaseAmplitude * side : 0;
        phaseWavePositions[index - 2] = visible ? .424 : -1;
        phaseWavePositions[index - 1] = visible ? p.z + p.tx * phaseAmplitude * side : 0;
      }
    }
    previous = second;
  }
  waveGeometry.attributes.position.needsUpdate = true;
  phaseWaveGeometry.attributes.position.needsUpdate = true;
  for (const [laneIndex, visual] of splitWave.entries()) {
    visual.line.visible = Boolean(branches);
    if (!branches) continue;
    const lane = branches.lanes[laneIndex];
    let write = 0;
    for (let i = 0; i < SPLIT_WAVE_STEPS - 1; i += 1) {
      const start = i / (SPLIT_WAVE_STEPS - 1), end = (i + 1) / (SPLIT_WAVE_STEPS - 1);
      const visible = !lane.pools.some(pool =>
        start < pool.progress + .075 && end > pool.progress - .075);
      for (const side of [-1, 1]) {
        for (const s of [start, end]) {
          const p = pointOnSplitLane(lane, s);
          const travel = headDelaySeconds(path, state.pools, recordPosition, branches.start, timeline)
            + s * lane.physicalSeconds
            + lane.pools.reduce((seconds, pool) =>
              seconds + (pool.progress < s ? pool.storedSeconds : 0), 0);
          const time = ((state.trackTime - travel) % duration + duration) % duration;
          const amplitude = .009 + trackPeaks[Math.min(trackPeaks.length - 1,
            Math.floor(time / duration * trackPeaks.length))] * .038;
          visual.positions[write++] = visible ? p.x - p.tz * amplitude * side : 0;
          visual.positions[write++] = visible ? .421 : -1;
          visual.positions[write++] = visible ? p.z + p.tx * amplitude * side : 0;
        }
      }
    }
    visual.geometry.attributes.position.needsUpdate = true;
  }
}

function sendRoute() {
  if (!audio) return;
  const writePoint = state.heads.find(head => head.kind === "record").position;
  const timeline = state.timeline;
  const branches = state.fork;
  audio.node.port.postMessage({
    type: "route",
    seconds: timeline.seconds,
    heads: state.heads.filter((head) => head.kind === "play").map((head) => ({
      id: head.id,
      position: headDelaySeconds(state.path, state.pools, writePoint, head.position, timeline) / timeline.seconds,
      // Heads between amber's original join and a relocated blue splice hear
      // only amber; downstream heads hear the two independent arrivals.
      branchDelays: branches && writePoint < branches.start
        ? [
          head.position > branches.end ? branches.lanes[0].delaySeconds * timeline.scale : 0,
          head.position > branches.join ? branches.lanes[1].delaySeconds * timeline.scale
            : head.position > branches.end ? branches.lanes[0].delaySeconds * timeline.scale : 0,
        ] : [0, 0],
      ...(state.split?.join !== undefined && head.position > branches.join && writePoint < branches.start
        ? { branchMix: state.split.mix } : {}),
    })),
    records: state.heads.filter(head => head.kind === "record").map(head => ({
      id: head.id,
      position: headDelaySeconds(state.path, state.pools, writePoint, head.position, timeline) / timeline.seconds,
    })),
  });
}

function sendTapeParams(session = audio) {
  session?.node.port.postMessage({
    type: "tape-params", feedback: state.feedback, phaseSlip: state.phaseSlip, printing: state.printing,
    echoReturn: state.echoReturn, returnHead: state.returnHead,
    monitorMix: state.monitorMix, voices: state.voices,
  });
}

function paintTapeControls() {
  $("printTape").checked = state.printing;
  $("feedbackAmount").value = String(state.feedback);
  $("feedbackOut").textContent = `${Math.round(state.feedback * 100)}%`;
  $("phaseSlip").value = String(state.phaseSlip);
  $("phaseSlipOut").textContent = `${(state.phaseSlip * 100).toFixed(1)}%`;
  $("echoReturn").value = String(state.echoReturn);
  $("echoReturnOut").textContent = `${Math.round(state.echoReturn * 100)}%`;
  $("returnHead").value = state.returnHead;
  $("monitorMix").value = String(state.monitorMix);
  $("monitorMixOut").textContent = `${Math.round(state.monitorMix * 100)}% tape`;
  $("sourceVoices").value = String(state.voices);
}

function changeVoiceCount(next) {
  if (state.voices < 2 && next >= 2) state.phaseShiftTime = 0;
  if (state.voices < 4 && next >= 4) {
    state.extraPhaseTimes[0] = 0;
    state.extraPhaseTimes[1] = state.phaseShiftTime;
  }
  if (state.voices < 8 && next >= 8) {
    state.extraPhaseTimes[2] = 0;
    state.extraPhaseTimes[3] = state.phaseShiftTime;
    state.extraPhaseTimes[4] = state.extraPhaseTimes[0];
    state.extraPhaseTimes[5] = state.extraPhaseTimes[1];
  }
  state.voices = next;
}

function updateControls() {
  // Pointer selection need not rebuild the Three.js geometry just to show or
  // hide the amber lane's shallow keyboard/drag grip.
  splitGuideGroups.get("lane-a").visible = Boolean(state.split && state.selectedId === "lane-a");
  $("tapeStatus").textContent = state.split?.join !== undefined ? "PATCH MIX"
    : state.split ? "BIFURCATED" : state.pools.length ? "STORED"
    : state.patches.length ? "PATCHED" : "";
  $("speedValue").textContent = `${state.speed > 0 ? "+" : ""}${state.speed.toFixed(1)}×`;
  $("joinButton").disabled = !state.split;
  $("joinButton").textContent = "Scotch · restore one path";
  $("undoButton").disabled = state.history.length === 0;
  const plays = state.heads.filter(head => head.kind === "play");
  const selector = $("returnHead");
  if (selector.options.length !== plays.length
    || plays.some((head, index) => selector.options[index]?.value !== head.id)) {
    selector.replaceChildren(...plays.map(head => {
      const option = document.createElement("option");
      option.value = head.id;
      option.textContent = `PLAY ${head.id.split("-")[1].padStart(2, "0")}`;
      return option;
    }));
  }
  selector.value = state.returnHead;
  const firstRecord = state.heads.find(head => head.kind === "record");
  const firstPlay = plays[0];
  const headName = head => `${head.kind === "record" ? "REC" : "PLAY"} ${
    String(Number(head.id.split("-").at(-1)) || 1).padStart(2, "0")}`;
  $("firstReadHeads").textContent = `${headName(firstRecord)} → ${headName(firstPlay)}`;
  const readTime = headDelaySeconds(
    state.path, state.pools, firstRecord.position, firstPlay.position, state.timeline,
  );
  let readout = `${readTime.toFixed(2)} s`;
  let description = `Tape travel from ${headName(firstRecord)} to ${headName(firstPlay)} at 1×`;
  // Once Razor reaches this PLAY head, the sound has distinct arrival times.
  // A relocated Scotch join can leave PLAY 01 on amber alone while a later
  // PLAY head hears both halves through the mixer.
  if (state.fork && firstRecord.position < state.fork.start && firstPlay.position > state.fork.end) {
    const amber = readTime + state.fork.lanes[0].delaySeconds * state.timeline.scale;
    const blue = readTime + state.fork.lanes[1].delaySeconds * state.timeline.scale;
    const hasBlue = firstPlay.position > state.fork.join;
    readout = hasBlue ? `A ${amber.toFixed(2)} · B ${blue.toFixed(2)} s`
      : `A ${amber.toFixed(2)} s`;
    description = `${headName(firstRecord)} to ${headName(firstPlay)} at 1×: amber ${
      amber.toFixed(2)} seconds${hasBlue ? `, blue ${blue.toFixed(2)} seconds` : "; blue rejoins later"}`;
  }
  $("firstReadDelay").textContent = readout;
  $("firstReadDelay").setAttribute("aria-label", description);
  const selectedPool = state.pools.find(pool => pool.id === state.selectedId);
  $("poolAdjust").hidden = !selectedPool;
  if (selectedPool) {
    const branch = selectedPool.laneId === "lane-a" ? "AMBER BRANCH"
      : selectedPool.laneId === "lane-b" ? "BLUE BRANCH" : "STORAGE";
    $("poolLabel").textContent = `POOL ${selectedPool.id.split("-")[1]} · ${branch}`;
    $("poolSeconds").setAttribute("aria-label", `Selected ${branch.toLowerCase()} pool storage time in seconds`);
    $("poolSeconds").value = String(selectedPool.seconds);
    $("poolSecondsOut").textContent = `${selectedPool.seconds.toFixed(2)} s`;
  }
  $("junctionAdjust").hidden = state.split?.join === undefined;
  if (state.split?.join !== undefined) {
    $("junctionMix").value = String(state.split.mix);
    $("junctionMixOut").textContent = `${Math.round(state.split.mix * 100)}% B`;
  }
  if (state.fork) {
    const write = state.heads.find(head => head.kind === "record").position;
    const base = headDelaySeconds(state.path, state.pools, write, state.fork.join, state.timeline);
    const [amber, blue] = state.fork.lanes.map(lane => base + lane.delaySeconds * state.timeline.scale);
    $("junctionArrival").textContent = `A ${amber.toFixed(2)} s · B ${blue.toFixed(2)} s · Δ ${Math.abs(blue - amber).toFixed(2)} s`;
  }
  const records = state.heads.filter(head => head.kind === "record");
  const addedPosts = state.nodes.filter(node => node.id.startsWith("post-"));
  const counts = {
    "new-play": plays.length >= MAX_PLAY_HEADS,
    "new-record": records.length >= MAX_RECORD_HEADS,
    "new-post": addedPosts.length >= MAX_GUIDE_POSTS,
    "new-pool": state.pools.length >= MAX_DELAY_POOLS,
  };
  $("editCapacity").textContent = `On this desk: ${addedPosts.length}/${MAX_GUIDE_POSTS} added posts, `
    + `${state.pools.length}/${MAX_DELAY_POOLS} pools, ${plays.length}/${MAX_PLAY_HEADS} PLAY, `
    + `${records.length}/${MAX_RECORD_HEADS} REC. Posts and pool graphics have a performance budget; `
    + "pools share a 12-second loop, and PLAY/REC use fixed real-time audio contacts. "
    + "Erase an added part to free a place.";
  for (const button of document.querySelectorAll(".tapezoid-toolbar button")) {
    button.disabled = Boolean(counts[button.dataset.tool]);
  }
  for (const button of document.querySelectorAll("[data-speed]")) {
    const active = Number(button.dataset.speed) === state.speed;
    button.setAttribute("aria-pressed", String(active));
  }
  $("playButton").setAttribute("aria-label", state.speed === 1 ? "Pause forward tape" : "Play tape forward");
}

function updateTrackClock() {
  const second = Math.floor(((state.trackTime % trackDuration()) + trackDuration()) % trackDuration());
  if (second === lastClockSecond) return;
  lastClockSecond = second;
  $("trackClock").textContent = `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
}

function poolRibbon(pool) {
  return pathSegment(0, 1, pool.laneId ? .085 : .11, .4, poolTapeMaterial,
    fraction => pointOnPool(pool.track, fraction), pool.track.total);
}

function activePool(pool) {
  return pool.laneId
    ? state.fork?.lanes.find(lane => lane.id === pool.laneId)?.pools.find(item => item.id === pool.id)
    : state.timeline.pools.find(item => item.id === pool.id);
}

function paintTimeLabels() {
  const summary = $("segmentTiming"), overlay = $("timeLabels");
  if (!state.path || !state.timeline) return;
  const segments = state.segmentTimes;
  summary.textContent = segments.map((segment, index) =>
    `Stretch ${index + 1}, ${segment.from} to ${segment.to}: ${segment.seconds.toFixed(2)} seconds`
      + (segment.storageSeconds ? ` including ${segment.storageSeconds.toFixed(2)} seconds of storage` : "")
  ).join(". ");
  overlay.hidden = !state.showTimes;
  if (!state.showTimes) { overlay.replaceChildren(); return; }
  const width = stage.clientWidth, height = stage.clientHeight;
  if (!width || !height) return;
  const badges = [], placed = [];
  const pixelsPerUnit = height / (2 * camera.top);
  function badge(point, text, title, kind = "", dy = 0, minLength = 0) {
    if (minLength * pixelsPerUnit < 28) return;
    const p = new THREE.Vector3(point.x, .46, point.z).project(camera);
    const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2 + dy;
    if (x < 25 || x > width - 25 || y < 16 || y > height - 16
      || placed.some(other => Math.abs(other.x - x) < 48 && Math.abs(other.y - y) < 19)) return;
    const span = document.createElement("span");
    span.className = `tapezoid-time-label ${kind}`;
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    span.textContent = text;
    span.title = title;
    badges.push(span);
    placed.push({ x, y });
  }
  if (state.fork) {
    const fork = state.fork;
    for (const lane of fork.lanes) {
      const legFraction = lane.firstLength / lane.length;
      const firstWait = lane.pools.reduce((sum, pool) =>
        sum + (pool.progress <= legFraction ? pool.storedSeconds : 0), 0);
      for (const [leg, length, waiting, progress] of [
        ["first", lane.firstLength, firstWait, legFraction / 2],
        ["second", lane.length - lane.firstLength,
          lane.travelSeconds - lane.physicalSeconds - firstWait, (1 + legFraction) / 2],
      ]) {
        const seconds = length / lane.length * lane.physicalSeconds + waiting;
        badge(pointOnSplitLane(lane, progress), `${seconds.toFixed(2)} s`,
          `${lane.id} ${leg} stretch: ${seconds.toFixed(2)} seconds at 1×`
            + (waiting ? `, including ${waiting.toFixed(2)} seconds stored` : ""),
          "branch", 0, length);
      }
    }
    const write = state.heads.find(head => head.kind === "record").position;
    const base = headDelaySeconds(state.path, state.pools, write, fork.join, state.timeline);
    const [a, b] = fork.lanes.map(lane => base + lane.delaySeconds * state.timeline.scale);
    badge(pointOnTape(state.path, fork.join), `Δ ${Math.abs(b - a).toFixed(2)} s`,
      `At the join: amber ${a.toFixed(2)} seconds; blue ${b.toFixed(2)} seconds from REC`,
      "junction", -20);
    summary.textContent += `. Join: amber ${a.toFixed(2)} seconds, blue ${b.toFixed(2)} seconds from REC.`;
  }
  for (const segment of segments) {
    const spans = state.split ? [
      [segment.fromPosition, Math.min(segment.toPosition, state.split.start)],
      [Math.max(segment.fromPosition, state.split.end), segment.toPosition],
    ] : [[segment.fromPosition, segment.toPosition]];
    for (const [from, to] of spans) {
      if (to <= from + .001) continue;
      const seconds = state.split
        ? headDelaySeconds(state.path, state.pools, from, to, state.timeline)
        : segment.seconds;
      badge(state.split ? pointOnTape(state.path, (from + to) / 2) : segment.point,
        `${seconds.toFixed(2)} s`,
        `${segment.from} → ${segment.to}: this visible stretch takes ${seconds.toFixed(2)} seconds at 1×`
          + (!state.split && segment.storageSeconds
            ? ` (${segment.travelSeconds.toFixed(2)} travel + ${segment.storageSeconds.toFixed(2)} stored)` : ""),
        "", 0, (to - from) * state.path.exposedLength);
    }
  }
  overlay.replaceChildren(...badges);
}

function rebuildRibbon() {
  disposeGeometry(tapeGeometryGroup);
  tapeGeometryGroup = new THREE.Group();
  const ranges = state.split ? [[0, state.split.start], [state.split.end, 1]] : [[0, 1]];
  for (const [start, end] of ranges) {
    let nextStart = start;
    for (const pool of state.timeline.pools.filter(item => item.position > start + .025 && item.position < end - .025)
      .sort((a, b) => a.position - b.position)) {
      const before = pathSegment(nextStart, pool.position - .015, .19, .39, tapeMaterial);
      if (before) tapeGeometryGroup.add(before);
      tapeGeometryGroup.add(poolRibbon(pool));
      nextStart = pool.position + .015;
    }
    const strip = pathSegment(nextStart, end, .19, .39, tapeMaterial);
    if (strip) tapeGeometryGroup.add(strip);
  }
  if (state.fork) {
    for (const lane of state.fork.lanes) {
      let nextStart = 0;
      for (const pool of lane.pools) {
        const before = pathSegment(nextStart, pool.progress - .075, .09, .39, tapeMaterial,
          position => pointOnSplitLane(lane, position), lane.length);
        if (before) tapeGeometryGroup.add(before);
        tapeGeometryGroup.add(poolRibbon(pool));
        nextStart = pool.progress + .075;
      }
      const strip = pathSegment(nextStart, 1, .09, .39, tapeMaterial,
        position => pointOnSplitLane(lane, position), lane.length);
      if (strip) tapeGeometryGroup.add(strip);
    }
  }
  for (const position of state.patches) tapeGeometryGroup.add(adhesivePatch(position));
  scene.add(tapeGeometryGroup);
}

function updateSceneGeometry() {
  state.path = buildPath(state.nodes);
  state.timeline = tapeTimeline(state.path, state.pools);
  state.segmentTimes = routeSegmentTimes(state.path, state.nodes, state.pools, state.timeline);
  state.fork = forkTiming(state.path, state.pools, state.split, state.timeline);
  rebuildRibbon();
  for (const group of rollerGroups.values()) group.visible = false;
  for (const node of state.nodes) {
    if (node.kind !== "roller") continue;
    if (!rollerGroups.has(node.id)) rollerGroups.set(node.id, makeRoller(node, rollerGroups.size + 1));
    const group = rollerGroups.get(node.id);
    group.visible = true;
    group.position.set(node.x, 0, node.z);
  }
  for (const group of poolGroups.values()) group.visible = false;
  for (const stored of state.pools) {
    const pool = activePool(stored);
    if (!pool) continue;
    if (!poolGroups.has(pool.id)) poolGroups.set(pool.id, makePool(pool));
    const group = poolGroups.get(pool.id), { center, radius } = pool.track;
    group.visible = true;
    group.position.set(center.x, 0, center.z);
    group.userData.basin.scale.set(radius / .5, 1, radius / .5);
  }
  for (const [id, group] of splitGuideGroups) {
    const guide = state.split?.guides.find(item => item.id === id);
    group.visible = Boolean(guide && (id === "lane-b" || state.selectedId === id));
    if (guide) group.position.set(guide.x, 0, guide.z);
  }
  junctionGroup.visible = Boolean(state.split);
  if (state.split) {
    const join = pointOnTape(state.path, state.split.join ?? state.split.end);
    junctionGroup.position.set(join.x, 0, join.z);
  }
  for (const group of headGroups.values()) group.visible = false;
  for (const head of state.heads) {
    const p = pointOnTape(state.path, head.position);
    if (!headGroups.has(head.id)) headGroups.set(head.id, makeHead(head));
    const group = headGroups.get(head.id);
    group.visible = true;
    group.position.set(p.x, 0, p.z);
    group.rotation.y = Math.atan2(p.tx, p.tz);
  }
  sendRoute();
  updateControls();
  paintTimeLabels();
  presetMenu?.refresh();
}
function queueSceneGeometry() { sceneUpdateQueued = true; }
updateSceneGeometry();
updateTrackClock();
paintTapeControls();

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  const deck = document.querySelector(".tapezoid-deck");
  const wrap = stage.parentElement;
  const cassetteBack = CASSETTE.z - 1.08;
  const deskFront = Math.max(4.05, ...state.nodes.filter(node => node.kind === "roller")
    .map(node => node.z + .35), ...(state.split?.guides.map(guide => guide.z + .35) ?? []),
    ...(state.timeline?.pools.map(pool => pool.track.center.z + pool.track.radius + .2) ?? []),
    ...(state.fork?.lanes.flatMap(lane => lane.pools.map(pool =>
      pool.track.center.z + pool.track.radius + .2)) ?? []));
  const bottomSpace = 12;
  let deckHeight = deck.offsetHeight;
  // Reflowing the keys can change deck height *after* its cassette-width
  // update. Fit the camera again so the cassette stays just below every key
  // instead of letting the second/third row cover the model or the tape.
  for (let pass = 0; pass < 3; pass += 1) {
    const topSpace = deckHeight + 16; // 10px above the keys, 6px before the cassette.
    // Only the side dock occupies stage width. Give the *entire* canvas height
    // to tape gestures; on rotation, keep even a far-flung drawn bend visible.
    const halfHeight = Math.max(5, 7.9 * h / w,
      (deskFront - cassetteBack) * h / (2 * Math.max(1, h - topSpace - bottomSpace)));
    camera.left = -halfHeight * w / h;
    camera.right = halfHeight * w / h;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    const mostForward = deskFront - halfHeight * (1 - 2 * bottomSpace / h);
    const furthestBack = cassetteBack + halfHeight * (1 - 2 * topSpace / h);
    const centerZ = clamp(0, Math.min(mostForward, furthestBack), furthestBack);
    camera.position.set(0, 18, centerZ);
    camera.lookAt(0, .2, centerZ);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const center = new THREE.Vector3(CASSETTE.x, .52, CASSETTE.z).project(camera);
    const back = new THREE.Vector3(CASSETTE.x, .52, cassetteBack).project(camera);
    wrap.style.setProperty("--transport-width", `${cassetteShellWidth * h / (2 * halfHeight)}px`);
    wrap.style.setProperty("--transport-center-x", `${(center.x + 1) * w / 2}px`);
    const nextHeight = deck.offsetHeight;
    wrap.style.setProperty("--transport-height", `${nextHeight}px`);
    wrap.style.setProperty("--transport-top", `${Math.max(10, (1 - back.y) * h / 2 - nextHeight - 6)}px`);
    if (nextHeight === deckHeight) break;
    deckHeight = nextHeight;
  }
  paintTimeLabels();
}
const stageResizeObserver = new ResizeObserver(resize);
stageResizeObserver.observe(stage);
resize();

function worldPosition(event) {
  const rect = stage.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(workPlane, intersection)) return null;
  return { x: intersection.x, z: intersection.z };
}
function postReach(pointerType) {
  // A fixed world-space radius becomes a tiny tap target when the camera
  // zooms out on phones or on a pulled-forward maze.
  const pixelReach = pointerType === "touch" ? 20 : 16;
  return Math.max(pointerType === "touch" ? .82 : .64,
    pixelReach * (camera.top - camera.bottom) / stage.clientHeight);
}
function nearestNode(position, kind, threshold) {
  let nearest = null, distance = threshold;
  for (const node of (kind === "roller" ? state.nodes : state.heads)) {
    if (kind === "roller" && node.kind !== "roller") continue;
    const p = kind === "head" ? pointOnTape(state.path, node.position) : node;
    const d = Math.hypot(p.x - position.x, p.z - position.z);
    if (d < distance) { nearest = node; distance = d; }
  }
  return nearest;
}
function snapshot() {
  return {
    nodes: state.nodes.map((node) => ({ ...node })),
    heads: state.heads.map((head) => ({ ...head })),
    pools: state.pools.map(pool => ({ ...pool })),
    patches: [...state.patches],
    split: state.split && { ...state.split, guides: state.split.guides.map(guide => ({ ...guide })) },
    feedback: state.feedback,
    phaseSlip: state.phaseSlip,
    printing: state.printing,
    echoReturn: state.echoReturn,
    returnHead: state.returnHead,
    monitorMix: state.monitorMix,
    voices: state.voices,
  };
}
function remember() {
  state.history.push(snapshot());
  if (state.history.length > 30) state.history.shift();
}
function say(message) { $("feedback").textContent = message; }
function ensureSelection() {
  if (state.nodes.some(node => node.id === state.selectedId)
    || state.heads.some(head => head.id === state.selectedId)
    || state.pools.some(pool => pool.id === state.selectedId)
    || state.split && state.selectedId === "junction"
    || state.split?.guides.some(guide => guide.id === state.selectedId)) return;
  state.selectedId = "roller-3";
}
function setTool(tool) {
  const tools = ["route", "draw", "new-play", "new-record", "new-post", "new-pool", "razor", "tape", "erase"];
  if (!tools.includes(tool)) return;
  if (document.querySelector(`[data-tool="${tool}"]`)?.disabled) {
    say("This part is at capacity. Erase an added part to make room.");
    return;
  }
  state.tool = tool;
  tapeGrip.visible = false;
  stage.classList.toggle("drawing", tool === "draw");
  stage.classList.toggle("razor", tool === "razor");
  stage.classList.toggle("tape", tool === "tape");
  stage.classList.toggle("placing", tool.startsWith("new-"));
  stage.classList.toggle("erasing", tool === "erase");
  for (const button of document.querySelectorAll("[data-tool]")) {
    const active = button.dataset.tool === tool;
    button.setAttribute("aria-pressed", String(active));
  }
  const help = {
    route: "MOVE: drag an existing post to move only it. Pull bare tape for one new bend, or drag a PLAY head to change its delay. Fork lanes, pools and the blue Scotch join also move.",
    draw: "DRAW: grab bare intact tape and trace several turns without lifting your finger. A tap adds nothing; one stroke is one Undo. Choose MOVE to pull one bend or move a post.",
    "new-play": "Touch the exposed tape to add a blue PLAY head. It reads another delayed position on the recorded loop.",
    "new-record": "Touch exposed tape to add a red REC head. During forward Play, it writes the loaded track and optional PLAY-head return to the same loop as the other RECs. PLAY reads it into the monitor; REC is not a separate output or mic.",
    "new-post": "Touch the desk beside the ribbon to thread a new guide post into its nearest segment.",
    "new-pool": "Touch intact tape or either fork lane for a delay pool. Drag its circle along that route; its slider grows the stored zigzag.",
    razor: "Touch tape after REC and before PLAY. Razor creates two routes with different travel times and a movable blue join.",
    tape: "Touch a later intact segment before a PLAY head to Scotch the blue branch there as a mixer. At the original join, Scotch restores one route.",
    erase: "Touch a head, added post, separating fork post or pool to erase it. The last REC and PLAY heads and six factory guides stay.",
  };
  $("stageInstructions").textContent = help[tool];
  if (["route", "draw", "new-record"].includes(tool)) say(help[tool]);
}
function setSpeed(speed) {
  if (![-4, -1, 0, 1, 4].includes(speed)) return;
  state.speed = speed;
  audio?.node.port.postMessage({ type: "speed", speed });
  updateControls();
}
function splitTape(position) {
  if (state.split) {
    say("Use Scotch tape to remove the existing fork before using Razor again.");
    return;
  }
  const range = razorSplitRange(state.path, position, state.nodes, state.heads, state.pools);
  if (!range) {
    say("Choose intact tape after REC and before PLAY, with room before the next post, head or pool.");
    return;
  }
  remember();
  state.split = makeSplit(state.path, range.start, range.end);
  state.selectedId = "lane-b";
  updateSceneGeometry();
  resize();
  setTool("route");
  say("Two routes, two arrival times. Pull the blue join to a later stretch to make a Scotch mixer, or add a pool to either branch.");
}

function junctionTarget(position, reach) {
  if (!state.split) return null;
  const lastPlay = Math.max(...state.heads.filter(head => head.kind === "play").map(head => head.position));
  const end = Math.min(EDIT_MAX, lastPlay - .021);
  if (end <= state.split.end + .045) return null;
  const target = closestPoint(state.path, position.x, position.z,
    [[state.split.end + .04, end]]);
  if (target.distance > reach || state.pools.some(pool => !pool.laneId
    && Math.abs(pool.position - target.position) < .03)
    || state.heads.some(head => Math.abs(head.position - target.position) < .017)) return null;
  return target;
}

function connectBranchAt(position, reach = .4) {
  if (!state.split) return false;
  const target = junctionTarget(position, reach);
  if (!target) {
    say("Drop the blue end on a later intact stretch, away from heads and pools, before a PLAY head.");
    return false;
  }
  if (state.split.join !== undefined && Math.abs(target.position - state.split.join) < .004) {
    state.selectedId = "junction";
    updateControls();
    return true;
  }
  remember();
  const oldEnd = state.split.join ?? state.split.end;
  // Keep each blue pool on the same fractional part of its own ribbon while
  // the free end travels. Amber pools retain their original positions.
  state.pools = state.pools.map(pool => pool.laneId === "lane-b"
    ? { ...pool, position: state.split.start
      + (pool.position - state.split.start) / (oldEnd - state.split.start)
        * (target.position - state.split.start) } : pool);
  state.split.join = target.position;
  state.split.mix ??= .5;
  state.selectedId = "junction";
  updateSceneGeometry();
  resize();
  setTool("route");
  say("Scotch mixer connected. Earlier PLAY heads hear amber; later heads mix two out-of-sync arrivals. Adjust A / B mix.");
  return true;
}

function scotchAt(position, reach) {
  if (!state.split) {
    say("Use Razor to create a fork before applying Scotch tape.");
    return;
  }
  const old = pointOnTape(state.path, state.split.end);
  const joined = pointOnTape(state.path, state.split.join ?? state.split.end);
  if (state.split.join !== undefined
    && Math.hypot(joined.x - position.x, joined.z - position.z) < reach) {
    state.selectedId = "junction";
    updateControls();
    setTool("route");
    say("Scotch mixer selected. Move its blue end again, or adjust A / B mix in the control rail.");
  } else if (Math.hypot(old.x - position.x, old.z - position.z) < reach) {
    sealTape();
  } else connectBranchAt(position, reach);
}

function rejoinPools() {
  // The branch ribbons disappear on Scotch/Erase; retain their storage on
  // the surviving shared loop instead of leaving invisible, silent basins.
  const used = state.pools.filter(pool => !pool.laneId).map(pool => pool.position);
  state.pools = state.pools.map(pool => {
    if (!pool.laneId) return pool;
    let position = pool.position;
    for (let offset = 0; offset < 30; offset += 1) {
      const step = Math.ceil(offset / 2) * .056 * (offset % 2 ? 1 : -1);
      const candidate = clamp(pool.position + step, EDIT_MIN, EDIT_MAX);
      if (used.every(other => Math.abs(other - candidate) >= .055)
        && state.heads.every(head => Math.abs(head.position - candidate) >= .025)) {
        position = candidate;
        break;
      }
    }
    used.push(position);
    return { id: pool.id, position, seconds: pool.seconds };
  });
}

function sealTape() {
  if (!state.split) {
    say("Use Razor to create a fork before applying Scotch tape.");
    return;
  }
  remember();
  // Keep both the rendered workbench and complete-scene snapshots bounded.
  if (state.patches.length === 8) state.patches.shift();
  state.patches.push(state.split.join ?? state.split.end);
  rejoinPools();
  state.split = null;
  ensureSelection();
  updateSceneGeometry();
  resize();
  setTool("route");
  say("Scotch restored one route. Tape memory and transport remain.");
}
function undo() {
  const previous = state.history.pop();
  if (!previous) return;
  changeVoiceCount(previous.voices);
  Object.assign(state, previous);
  ensureSelection();
  updateSceneGeometry();
  resize();
  paintTapeControls();
  sendTapeParams();
  setTool("route");
  say("Undid the last scene edit. Recorded sound and transport kept their place.");
}
function reset() {
  remember();
  state.nodes = copyNodes();
  state.heads = copyHeads();
  state.pools = [];
  state.patches = [];
  state.split = null;
  state.phase = .04;
  state.trackTime = 0;
  state.phaseShiftTime = 0;
  state.extraPhaseTimes.fill(0);
  Object.assign(state, TAPEZOID_MEMORY_DEFAULTS);
  state.selectedId = "roller-3";
  updateSceneGeometry();
  resize();
  tapeMemory = null;
  audio?.node.port.postMessage({ type: "erase-tape" });
  audio?.node.port.postMessage({
    type: "seek", phase: state.phase, trackTime: state.trackTime,
    phaseShiftTime: state.phaseShiftTime, extraPhaseTimes: state.extraPhaseTimes,
  });
  paintTapeControls();
  sendTapeParams();
  updateTrackClock();
  setSpeed(1);
  setTool("route");
  say("Original route and tape memory restored.");
}

function applyTapezoidPreset(snapshot) {
  snapshot = validateTapezoidPreset(snapshot); // Reject before changing any live state.
  remember();
  const original = copyNodes();
  state.nodes = [original[0], ...snapshot.rollers.map(roller => ({ ...roller, kind: "roller" })),
    ...original.slice(-2)];
  state.heads = snapshot.heads.map(head => ({ ...head }));
  state.pools = snapshot.pools.map(pool => ({ ...pool }));
  state.patches = [...snapshot.patches];
  state.split = snapshot.split ? {
    ...snapshot.split, guides: snapshot.split.guides.map(guide => ({ ...guide })),
  } : null;
  ensureSelection();
  state.feedback = snapshot.feedback;
  state.phaseSlip = snapshot.phaseSlip;
  state.printing = snapshot.printing;
  state.echoReturn = snapshot.echoReturn;
  state.returnHead = snapshot.returnHead;
  state.monitorMix = snapshot.monitorMix;
  changeVoiceCount(snapshot.voices);
  updateSceneGeometry();
  resize();
  paintTapeControls();
  sendTapeParams();
  setTool("route");
  say("Tape maze recalled. The transport and Audio keep their current state.");
}

// A Razor stroke without tape contact does nothing. The final contacted point
// is the cut, not a random crossing along the pointer's route.
function recordRazorSweep(from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .08));
  for (let i = 0; i <= steps; i += 1) {
    const x = from.x + (to.x - from.x) * i / steps;
    const z = from.z + (to.z - from.z) * i / steps;
    const candidate = closestVisibleTape(state.path, state.fork, state.pools, x, z);
    if (candidate.laneId || candidate.distance > .19
      || candidate.position < EDIT_MIN || candidate.position > EDIT_MAX) {
      continue;
    }
    drag.touched = candidate.position;
  }
  drag.previous = to;
}

function nearestSplitGuide(position) {
  let best = null, distance = .46;
  for (const guide of state.split?.guides ?? []) {
    if (guide.id === "lane-a" && state.selectedId !== guide.id) continue;
    const next = Math.hypot(position.x - guide.x, position.z - guide.z);
    if (next < distance) { best = guide; distance = next; }
  }
  return { guide: best, distance };
}

function headOnIntactTape(position, head) {
  let next = clamp(position, EDIT_MIN, EDIT_MAX);
  for (const pool of state.pools.filter(item => !item.laneId)) {
    if (Math.abs(next - pool.position) < .02) {
      next = clamp(pool.position + (next < pool.position ? -.023 : .023), EDIT_MIN, EDIT_MAX);
    }
  }
  if (state.split) {
    if (head.kind === "record") next = Math.min(next, state.split.start - .02);
    else if (next >= state.split.start - .02 && next <= state.split.end + .02) {
      const middle = (state.split.start + state.split.end) / 2;
      next = next < middle ? state.split.start - .02 : state.split.end + .02;
    }
    if (state.split.join !== undefined && head.kind === "play"
      && !state.heads.some(other => other.kind === "play" && other.id !== head.id
        && other.position > state.split.join + .02)) {
      next = Math.max(next, state.split.join + .021);
    }
  }
  return next;
}

function poolOnIntactTape(position, ownId = null) {
  let next = clamp(position, EDIT_MIN, EDIT_MAX);
  if (state.split && next > state.split.start - .025 && next < state.split.end + .025) {
    const middle = (state.split.start + state.split.end) / 2;
    next = next < middle ? state.split.start - .03 : state.split.end + .03;
  }
  for (const pool of state.pools.filter(item => !item.laneId)) {
    if (pool.id !== ownId && Math.abs(next - pool.position) < .055) {
      return state.pools.find(item => item.id === ownId)?.position ?? next;
    }
  }
  return next;
}

function poolOnBranch(laneId, progress, ownId = null) {
  if (!state.fork?.lanes.some(lane => lane.id === laneId)) return null;
  const next = clamp(progress, BRANCH_POOL_MARGIN, 1 - BRANCH_POOL_MARGIN);
  if (state.pools.some(pool => pool.laneId === laneId && pool.id !== ownId
    && Math.abs(branchPoolProgress(state.fork, pool) - next) < BRANCH_POOL_GAP)) return null;
  const end = laneId === "lane-b" ? state.fork.join : state.fork.end;
  return state.fork.start + next * (end - state.fork.start);
}

function placePart(tool, position) {
  const isPost = tool === "new-post";
  const tape = isPost
    ? closestPoint(state.path, position.x, position.z)
    : closestVisibleTape(state.path, state.fork, state.pools, position.x, position.z);
  if (!isPost && (tape.distance > .53 || tape.position < EDIT_MIN || tape.position > EDIT_MAX)) {
    say("Touch the exposed ribbon to place this part.");
    return;
  }
  if (isPost && (position.x < ROLLER_BOUNDS.minX || position.x > ROLLER_BOUNDS.maxX
    || position.z < ROLLER_BOUNDS.minZ || position.z > ROLLER_BOUNDS.maxZ || tape.distance > 1.6)) {
    say("Place a guide post beside an exposed segment, away from the cassette.");
    return;
  }
  if (tool === "new-post") {
    const id = nextPartId(state.nodes, "post", 1, MAX_GUIDE_POSTS);
    if (!id) { say("This route is full. Erase a post or move an existing bend to keep drawing."); return; }
    if (state.split && tape.position >= state.split.start - .02
      && tape.position <= state.split.end + .02) {
      say("Place a guide before or after the fork, not between its two joins.");
      return;
    }
    remember();
    // Every node owns six path samples; insert into the nearest *exposed*
    // segment, never into the concealed cassette connector.
    const index = clamp(Math.floor(tape.segmentIndex / 6) + 1, 1,
      state.nodes.findIndex(node => node.id === "cassette-in"));
    state.nodes.splice(index, 0, { id, kind: "roller", ...clampRoller(position.x, position.z) });
    state.selectedId = id;
    updateSceneGeometry();
    resize();
    setTool("route");
    say("Guide post threaded into the route. Drag it to bend the tape and change the loop time.");
    return;
  }
  if (tool === "new-pool") {
    const id = nextPartId(state.pools, "pool", 1, MAX_DELAY_POOLS);
    if (!id) { say(`This desk has ${MAX_DELAY_POOLS} pools. Erase one to add another.`); return; }
    if (tape.laneId && (tape.progress < BRANCH_POOL_MARGIN || tape.progress > 1 - BRANCH_POOL_MARGIN)) {
      say("Touch the middle of a fork lane, leaving room beside its joins.");
      return;
    }
    const positionOnTape = tape.laneId
      ? poolOnBranch(tape.laneId, tape.progress)
      : state.pools.some(pool => !pool.laneId && Math.abs(pool.position - tape.position) < .055)
        ? null : tape.position;
    if (positionOnTape === null) { say("Leave room between pools on the same ribbon."); return; }
    remember();
    state.pools.push({
      id, ...(tape.laneId ? { laneId: tape.laneId } : {}),
      position: positionOnTape, seconds: 1,
    });
    state.selectedId = id;
    updateSceneGeometry();
    resize();
    setTool("route");
    say(tape.laneId
      ? `The ${tape.laneId === "lane-a" ? "amber" : "blue"} branch now waits in its pool for 1.00 s. Drag the circle or change its storage time.`
      : "Tape now collects in this pool for 1.00 s. Drag the circle or change its storage time.");
    return;
  }
  if (tape.laneId) {
    say("Place REC and PLAY on the intact ribbon before or after the fork; pool a branch instead.");
    return;
  }
  const kind = tool === "new-record" ? "record" : "play";
  const id = kind === "record"
    ? state.heads.some(head => head.id === "record")
      ? nextPartId(state.heads, "record", 2, MAX_RECORD_HEADS) : "record"
    : nextPartId(state.heads, "play", 1, MAX_PLAY_HEADS);
  if (!id) { say(`The ${kind === "record" ? "REC" : "PLAY"} contacts are full.`); return; }
  const newHead = { id, kind, position: headOnIntactTape(tape.position, { kind }) };
  if (state.split && kind === "record" && newHead.position > state.split.start - .02) {
    say("Place a new REC head before the split so it can print both half-width lanes.");
    return;
  }
  remember();
  state.heads.push(newHead);
  state.selectedId = id;
  updateSceneGeometry();
  setTool("route");
  say(kind === "record"
    ? "New REC writes the loaded track and optional PLAY return into the same tape loop during forward Play. Drag it to shift the overdub; PLAY sends the sound to the monitor."
    : "New blue head reads this part of the moving tape. Drag it to change its echo.");
}

function erasePart(id) {
  if (["lane-a", "lane-b", "junction"].includes(id) && state.split) {
    remember();
    rejoinPools();
    state.split = null;
    ensureSelection();
    updateSceneGeometry();
    resize();
    say("Separating post lifted. Scotch tape can leave a visible patch at the join instead.");
    return;
  }
  const head = state.heads.find(item => item.id === id);
  if (head) {
    if (state.heads.filter(item => item.kind === head.kind).length === 1) {
      say(`Keep at least one ${head.kind === "record" ? "REC" : "PLAY"} head on the tape.`);
      return;
    }
    if (state.split?.join !== undefined && head.kind === "play"
      && head.position > state.split.join + .02
      && !state.heads.some(other => other.kind === "play" && other.id !== head.id
        && other.position > state.split.join + .02)) {
      say("Keep a PLAY head downstream of the Scotch mixer; restore one path before removing it.");
      return;
    }
    remember();
    state.heads = state.heads.filter(item => item.id !== id);
    if (state.returnHead === id) state.returnHead = state.heads.find(item => item.kind === "play").id;
    ensureSelection();
    updateSceneGeometry();
    sendTapeParams();
    say(`${id.toUpperCase()} lifted. The recorded loop and motor keep going.`);
    return;
  }
  const pool = state.pools.find(item => item.id === id);
  if (pool) {
    remember();
    state.pools = state.pools.filter(item => item.id !== id);
    ensureSelection();
    updateSceneGeometry();
    resize();
    say("Storage pool removed. The tape's delay has shortened without erasing its recording.");
    return;
  }
  const post = state.nodes.find(item => item.id === id && item.kind === "roller");
  if (post?.id.startsWith("post-")) {
    remember();
    state.nodes = state.nodes.filter(item => item.id !== id);
    ensureSelection();
    updateSceneGeometry();
    resize();
    say("Added guide post removed; the tape takes the shorter route.");
  } else if (post) say("The six factory guides anchor the maze. Erase an added post instead.");
  else say("Select a head, added guide post, or delay pool to erase.");
}

function eraseAt(position, reach) {
  const choices = [
    ...(state.split ? [{ id: "junction",
      p: pointOnTape(state.path, state.split.join ?? state.split.end) }] : []),
    ...(state.split ? [{ id: "lane-b", p: state.split.guides[1] }] : []),
    ...state.heads.map(head => ({ id: head.id, p: pointOnTape(state.path, head.position) })),
    ...state.nodes.filter(node => node.kind === "roller").map(node => ({ id: node.id, p: node })),
    ...state.pools.map(pool => ({ id: pool.id, p: activePool(pool)?.track.center })),
  ].map(item => ({ id: item.id, distance: Math.hypot(item.p.x - position.x, item.p.z - position.z) }))
    .filter(item => item.distance < reach).sort((a, b) => a.distance - b.distance);
  if (!choices.length) say("Touch a head, a new post or a delay pool to erase it.");
  else erasePart(choices[0].id);
}

stage.addEventListener("pointerdown", (event) => {
  if (drag || event.pointerType === "mouse" && event.button !== 0) return;
  tapeGrip.visible = false;
  const position = worldPosition(event);
  if (!position) return;
  const reach = event.pointerType === "touch" ? .82 : .53;

  if (state.tool.startsWith("new-")) {
    placePart(state.tool, position);
    return;
  }
  if (state.tool === "erase") {
    eraseAt(position, reach);
    return;
  }
  if (state.tool === "route" || state.tool === "draw") {
    const head = nearestNode(position, "head", .5);
    const roller = nearestNode(position, "roller", postReach(event.pointerType));
    const splitGuide = nearestSplitGuide(position);
    const joined = state.split && pointOnTape(state.path, state.split.join ?? state.split.end);
    const jd = joined ? Math.hypot(joined.x - position.x, joined.z - position.z) : Infinity;
    const tape = closestVisibleTape(state.path, state.fork, state.pools, position.x, position.z);
    const pool = state.pools.map(item => ({
      id: item.id,
      distance: Math.hypot(position.x - activePool(item).track.center.x,
        position.z - activePool(item).track.center.z),
      reach: Math.max(.57, activePool(item).track.radius + .12),
    })).filter(item => item.distance < item.reach).sort((a, b) => a.distance - b.distance)[0];
    // Rollers occupy the path; pick whichever visible handle is nearer.
    const headPos = head && pointOnTape(state.path, head.position);
    const hd = headPos ? Math.hypot(headPos.x - position.x, headPos.z - position.z) : Infinity;
    const pd = roller ? Math.hypot(roller.x - position.x, roller.z - position.z) : Infinity;
    // A tiny first fork puts its amber ribbon very close to the join. Prefer
    // the actual tape under the finger unless the grip itself was touched;
    // otherwise pulling amber accidentally drags the blue connector.
    const onBranch = tape.laneId && tape.distance < (event.pointerType === "touch" ? .29 : .17)
      && tape.progress < .91;
    if (jd < (event.pointerType === "touch" ? .27 : .19)
      && (!onBranch || jd < .07)
      && jd < hd && jd < pd && jd < splitGuide.distance
      && (!pool || jd < pool.distance)) {
      drag = { kind: "junction", id: "junction", start: position, changed: false };
    } else if (pool && (pool.distance < .32 || tape.distance > .16)
      && pool.distance < hd && pool.distance < pd && pool.distance < splitGuide.distance) {
      const stored = state.pools.find(item => item.id === pool.id);
      const lane = state.fork?.lanes.find(item => item.id === stored.laneId);
      drag = {
        kind: "pool", id: pool.id, changed: false,
        originalPosition: stored.position,
        pickupPosition: lane
          ? closestPointOnSplitLane(lane, position.x, position.z).progress
          : closestPoint(state.path, position.x, position.z).position,
      };
    } else if (splitGuide.guide && splitGuide.distance < hd && splitGuide.distance < pd) {
      drag = { kind: "split-guide", id: splitGuide.guide.id, changed: false };
    } else if (head && hd < pd) drag = { kind: "head", id: head.id, changed: false };
    else if (roller) drag = { kind: "roller", id: roller.id, changed: false };
    else if (tape.distance < (event.pointerType === "touch" ? .38 : .24)
      && tape.position >= EDIT_MIN && tape.position <= EDIT_MAX) {
      drag = {
        kind: "tape", pointerId: event.pointerId, start: position, hit: tape,
        mode: state.tool, previousSelectedId: state.selectedId, changed: false,
      };
      stage.setPointerCapture(event.pointerId);
      say(tape.laneId ? "Pull this branch to stretch or squeeze its timing."
        : state.tool === "draw" ? "Trace the ribbon to draw several turns; a tap adds nothing."
          : "Pull the ribbon for one bend. Choose DRAW to trace several turns.");
      return;
    }
    if (drag) {
      drag.pointerId = event.pointerId;
      state.selectedId = drag.id;
      updateControls();
      stage.setPointerCapture(event.pointerId);
      say(drag.kind === "head" ? state.heads.find(head => head.id === drag.id)?.kind === "record"
        ? "Move REC's write point on the shared loop. It prints the loaded track and optional PLAY return; blue PLAY heads send their reads to the monitor."
        : "Move PLAY's read point on the shared loop; its delay changes live."
        : drag.kind === "split-guide" ? "Move this lane; the two arrivals stay out of sync after the join."
          : drag.kind === "junction" ? "Drag the blue end to a later intact segment, then drop to Scotch-mix it there."
          : drag.kind === "pool" ? "Move this storage pool along the strip or adjust its time in the control rail."
            : "Bend the route; longer travel lengthens the loop without changing pitch.");
    }
    return;
  }
  const candidate = closestVisibleTape(state.path, state.fork, state.pools, position.x, position.z);
  if (state.tool === "razor") {
    drag = {
      kind: "razor-stroke", pointerId: event.pointerId, previous: position,
      touched: candidate.distance < .19 ? candidate.position : null,
    };
    stage.setPointerCapture(event.pointerId);
    recordRazorSweep(position, position);
  } else if (state.tool === "tape" && state.split) {
    scotchAt(position, reach);
  } else say("Use Razor to make a fork first.");
}, { signal: listeners.signal });

function adjacentGuide(hit) {
  const index = clamp(Math.floor(hit.segmentIndex / 6) + 1, 1,
    state.nodes.findIndex(node => node.id === "cassette-in"));
  const near = [state.nodes[index - 1], state.nodes[index]]
    .filter(node => node?.kind === "roller");
  return (near.length ? near : state.nodes.filter(node => node.kind === "roller"))
    .sort((a, b) => Math.hypot(a.x - hit.x, a.z - hit.z)
      - Math.hypot(b.x - hit.x, b.z - hit.z))[0];
}

function beginTapePull(position) {
  const held = drag, lane = held.hit.laneId;
  if (lane) {
    const part = state.split?.guides.find(guide => guide.id === lane);
    if (!part) return false;
    remember();
    drag.kind = "split-guide";
    drag.id = part.id;
    drag.origin = { x: part.x, z: part.z };
    drag.fromTape = true;
    drag.changed = true;
    state.selectedId = part.id;
    say(`Pull the ${lane === "lane-a" ? "amber" : "blue"} lane longer or shorter; the other lane keeps its own timing.`);
  } else {
    const available = MAX_GUIDE_POSTS - state.nodes.filter(node => node.id.startsWith("post-")).length;
    if (available) {
      remember();
      const insertionIndex = clamp(Math.floor(held.hit.segmentIndex / 6) + 1, 1,
        state.nodes.findIndex(node => node.id === "cassette-in"));
      if (held.mode === "draw") {
        drag.kind = "tape-sketch";
        drag.insertionIndex = insertionIndex;
        drag.available = available;
        drag.trace = [{ x: held.hit.x, z: held.hit.z }];
        drag.addedIds = [];
        drag.fromTape = true;
        drag.changed = false;
        say("Keep dragging to draw a maze. All turns in this stroke share one Undo.");
      } else {
        const id = nextPartId(state.nodes, "post", 1, MAX_GUIDE_POSTS);
        drag.kind = "roller";
        drag.id = id;
        drag.origin = { x: held.hit.x, z: held.hit.z };
        drag.fromTape = true;
        drag.changed = true;
        state.nodes.splice(insertionIndex, 0, { id, kind: "roller",
          ...clampRoller(held.hit.x + position.x - held.start.x,
            held.hit.z + position.z - held.start.z) });
        state.selectedId = id;
        queueSceneGeometry();
        say("Pulled one bend. Drag this post to reshape it; choose DRAW for a multi-post stroke.");
      }
    } else if (held.mode === "draw") {
      if (!held.full) say("All guide-post places are used. Erase a post or MOVE an existing bend.");
      held.full = true;
      return false;
    } else {
      const part = adjacentGuide(held.hit);
      if (!part) return false;
      remember();
      drag.kind = "roller";
      drag.id = part.id;
      drag.origin = { x: part.x, z: part.z };
      drag.fromTape = true;
      drag.changed = true;
      state.selectedId = part.id;
      say("All guide-post places are used. This pull moves one nearby post; Eraser frees a place to draw more.");
    }
  }
  updateControls();
  return true;
}

function extendTapeSketch(position) {
  const held = drag;
  held.trace = appendRouteTrace(held.trace, position);
  const guides = simplifyRouteTrace(held.trace, held.available);
  if (!guides.length) return;
  const other = state.nodes.filter(node => !held.addedIds.includes(node.id));
  const added = [];
  for (const point of guides) {
    const id = held.addedIds[added.length] ?? nextPartId([...other, ...added], "post", 1, MAX_GUIDE_POSTS);
    added.push({ id, kind: "roller", ...point });
  }
  state.nodes.splice(held.insertionIndex, held.addedIds.length, ...added);
  held.addedIds = added.map(node => node.id);
  held.changed = true;
  state.selectedId = added.at(-1).id;
  tapeGrip.visible = true;
  tapeGrip.position.set(added.at(-1).x, .51, added.at(-1).z);
  queueSceneGeometry();
}

stage.addEventListener("pointermove", (event) => {
  if (!drag) {
    const position = ["route", "draw"].includes(state.tool) && worldPosition(event);
    const hit = position && closestVisibleTape(state.path, state.fork, state.pools, position.x, position.z);
    tapeGrip.visible = Boolean(hit && hit.distance < .18
      && hit.position >= EDIT_MIN && hit.position <= EDIT_MAX
      && !nearestNode(position, "roller", postReach(event.pointerType))
      && !nearestNode(position, "head", .5));
    if (tapeGrip.visible) tapeGrip.position.set(hit.x, .455, hit.z);
    return;
  }
  if (drag.pointerId !== event.pointerId) return;
  const position = worldPosition(event);
  if (!position) return;
  if (drag.kind === "razor-stroke") { recordRazorSweep(drag.previous, position); return; }
  if (drag.kind === "junction") {
    if (Math.hypot(position.x - drag.start.x, position.z - drag.start.z) > .16) {
      drag.changed = true;
      const target = junctionTarget(position, event.pointerType === "touch" ? .5 : .38);
      previewJunction(target ?? position);
      junctionPreview.material.color.setHex(target ? colors.blue : colors.pink);
    }
    return;
  }
  if (drag.kind === "tape") {
    const bounded = clampRoller(position.x, position.z);
    if (Math.hypot(bounded.x - drag.hit.x, bounded.z - drag.hit.z) < .23
      || !beginTapePull(position)) return;
  }
  if (drag.kind === "tape-sketch") { extendTapeSketch(position); return; }
  if (drag.kind === "roller") {
    const node = state.nodes.find((item) => item.id === drag.id);
    const next = drag.fromTape
      ? clampRoller(drag.origin.x + position.x - drag.start.x, drag.origin.z + position.z - drag.start.z)
      : clampRoller(position.x, position.z);
    if (Math.hypot(node.x - next.x, node.z - next.z) < .028) return;
    if (!drag.changed) remember();
    drag.changed = true;
    Object.assign(node, next);
  } else if (drag.kind === "split-guide") {
    const node = state.split?.guides.find((item) => item.id === drag.id);
    if (!node) return;
    const next = drag.fromTape
      ? clampRoller(drag.origin.x + position.x - drag.start.x, drag.origin.z + position.z - drag.start.z)
      : clampRoller(position.x, position.z);
    if (Math.hypot(node.x - next.x, node.z - next.z) < .028) return;
    if (!drag.changed) remember();
    drag.changed = true;
    Object.assign(node, next);
  } else if (drag.kind === "head") {
    const head = state.heads.find((item) => item.id === drag.id);
    const next = headOnIntactTape(closestPoint(state.path, position.x, position.z).position, head);
    if (Math.abs(head.position - next) < .002) return;
    if (!drag.changed) remember();
    drag.changed = true;
    head.position = next;
  } else if (drag.kind === "pool") {
    const pool = state.pools.find(item => item.id === drag.id);
    if (!pool) return;
    const lane = state.fork?.lanes.find(item => item.id === pool.laneId);
    const next = lane
      ? poolOnBranch(lane.id,
        branchPoolProgress(state.fork, { position: drag.originalPosition })
          + closestPointOnSplitLane(lane, position.x, position.z).progress - drag.pickupPosition, pool.id)
      : poolOnIntactTape(drag.originalPosition
        + closestPoint(state.path, position.x, position.z).position - drag.pickupPosition, pool.id);
    if (next === null) return;
    if (Math.abs(pool.position - next) < .002) return;
    if (!drag.changed) remember();
    drag.changed = true;
    pool.position = next;
  }
  queueSceneGeometry();
}, { signal: listeners.signal });
function finishDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const held = drag;
  if (event.type === "pointerup") {
    const position = worldPosition(event);
    if (position && held.kind === "razor-stroke") recordRazorSweep(held.previous, position);
    else if (position && held.kind === "tape-sketch") extendTapeSketch(position);
    if (position && held.kind === "junction" && held.changed) {
      connectBranchAt(position, event.pointerType === "touch" ? .5 : .38);
    }
    if (held.kind === "razor-stroke") {
      if (held.touched !== null) splitTape(held.touched);
      else say("Touch the ribbon with Razor.");
    }
  }
  drag = null;
  tapeGrip.visible = false;
  junctionPreview.visible = false;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  const canceledPull = event.type === "pointercancel" && held.fromTape && held.changed;
  if (canceledPull) {
    Object.assign(state, state.history.pop());
    state.selectedId = held.previousSelectedId;
    say("Tape pull canceled; the original route is still playing.");
  }
  if (["head", "roller", "split-guide", "pool", "tape-sketch"].includes(held.kind)
    && held.changed) {
    sceneUpdateQueued = false;
    updateSceneGeometry(); // Commit even if the next frame was throttled.
    resize(); // Fit the released route without moving the camera under a held finger.
  }
}
stage.addEventListener("pointerup", finishDrag, { signal: listeners.signal });
stage.addEventListener("pointercancel", finishDrag, { signal: listeners.signal });
stage.addEventListener("pointerleave", () => { tapeGrip.visible = false; }, { signal: listeners.signal });
stage.addEventListener("lostpointercapture", event => {
  if (drag?.pointerId === event.pointerId) finishDrag({ pointerId: event.pointerId, type: "pointercancel" });
}, { signal: listeners.signal });

stage.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === " ") { event.preventDefault(); setSpeed(state.speed ? 0 : 1); return; }
  if (key === "r") { setTool("razor"); return; }
  if (key === "t") { setTool("tape"); return; }
  if (key === "g") { setTool("route"); return; }
  if (key === "d") { setTool("draw"); return; }
  if (key === "e") { setTool("erase"); return; }
  if (key === "j" && state.split) {
    event.preventDefault();
    const lastPlay = Math.max(...state.heads.filter(head => head.kind === "play")
      .map(head => head.position));
    const next = (state.split.end + lastPlay) / 2;
    connectBranchAt(pointOnTape(state.path, next), .12);
    return;
  }
  if (key === "escape") { setTool("route"); return; }
  const placementKeys = { "1": "new-play", "2": "new-record", "3": "new-post", "4": "new-pool" };
  if (placementKeys[key]) { setTool(placementKeys[key]); return; }
  if ((key === "delete" || key === "backspace") && ["route", "erase"].includes(state.tool)) {
    event.preventDefault();
    erasePart(state.selectedId);
    return;
  }
  if (key === "enter" && state.tool === "erase") {
    event.preventDefault();
    erasePart(state.selectedId);
    return;
  }
  if (key === "enter" && state.tool.startsWith("new-")) {
    event.preventDefault();
    const selected = state.heads.find(head => head.id === state.selectedId)
      ?? state.pools.find(pool => pool.id === state.selectedId);
    const laneId = state.tool === "new-pool"
      ? (state.fork?.lanes.some(lane => lane.id === state.selectedId)
        ? state.selectedId : selected?.laneId) : null;
    const lane = state.fork?.lanes.find(item => item.id === laneId);
    if (lane) {
      const other = lane.pools[0];
      const progress = other?.progress < .5 ? .8 : .2;
      const p = pointOnSplitLane(lane, other ? progress : .5);
      placePart(state.tool, p);
      return;
    }
    const fraction = selected?.position ?? .57;
    const onTape = pointOnTape(state.path, fraction);
    const p = state.tool === "new-post"
      ? clampRoller(onTape.x - onTape.tz * .6, onTape.z + onTape.tx * .6)
      : onTape;
    placePart(state.tool, p);
    return;
  }
  if (key === "enter" && state.tool === "tape") { sealTape(); return; }
  if (key === "enter" && state.tool === "razor") {
    event.preventDefault();
    const firstPlay = Math.min(...state.heads.filter(head => head.kind === "play")
      .map(head => head.position));
    const lastRecord = Math.max(...state.heads.filter(head => head.kind === "record")
      .map(head => head.position));
    splitTape((lastRecord + firstPlay) / 2);
    return;
  }
  if (state.tool !== "route" && state.tool !== "erase") return;
  if (key === "[" || key === "]") {
    event.preventDefault();
    const handles = [...state.nodes.filter((item) => item.kind === "roller"),
      ...(state.split?.guides ?? []), ...(state.split ? [{ id: "junction" }] : []),
      ...state.heads, ...state.pools];
    const index = handles.findIndex((item) => item.id === state.selectedId);
    state.selectedId = handles[(index + (key === "]" ? 1 : -1) + handles.length) % handles.length].id;
    updateSceneGeometry();
    say(`Selected ${state.selectedId}. Arrow keys move it.`);
    return;
  }
  if (state.tool !== "route" || !["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) return;
  event.preventDefault();
  const step = event.shiftKey ? .04 : .16;
  const node = state.nodes.find((item) => item.id === state.selectedId && item.kind === "roller");
  const guide = state.split?.guides.find(item => item.id === state.selectedId);
  const head = state.heads.find((item) => item.id === state.selectedId);
  const pool = state.pools.find(item => item.id === state.selectedId);
  if (state.selectedId === "junction" && state.split) {
    const current = state.split.join ?? state.split.end;
    const stepOnTape = event.shiftKey ? .01 : .055;
    const next = current + (key === "arrowleft" || key === "arrowup" ? -stepOnTape : stepOnTape);
    connectBranchAt(pointOnTape(state.path, next), .12);
    return;
  }
  if (!node && !guide && !head && !pool) return;
  remember();
  if (node || guide) {
    const target = node ?? guide;
    const position = clampRoller(target.x + (key === "arrowleft" ? -step : key === "arrowright" ? step : 0),
      target.z + (key === "arrowup" ? -step : key === "arrowdown" ? step : 0));
    Object.assign(target, position);
  } else {
    if (pool) {
      if (key === "arrowup" || key === "arrowdown") {
        pool.seconds = clamp(Math.round((pool.seconds + (key === "arrowup" ? .1 : -.1)) * 20) / 20,
          MIN_POOL_SECONDS, MAX_POOL_SECONDS);
      } else if (pool.laneId) {
        const progress = branchPoolProgress(state.fork, pool)
          + (key === "arrowleft" ? -step / 2 : step / 2);
        pool.position = poolOnBranch(pool.laneId, progress, pool.id) ?? pool.position;
      } else pool.position = poolOnIntactTape(pool.position
        + (key === "arrowleft" ? -step / 12 : step / 12), pool.id);
    } else head.position = headOnIntactTape(head.position
      + (key === "arrowleft" || key === "arrowup" ? -step / 12 : step / 12), head);
  }
  updateSceneGeometry();
  resize();
  say(`Moved ${state.selectedId}.`);
}, { signal: listeners.signal });

for (const button of document.querySelectorAll("[data-speed]")) button.addEventListener("click", () => {
  const speed = Number(button.dataset.speed);
  setSpeed(button.id === "playButton" && state.speed === 1 ? 0 : speed);
}, { signal: listeners.signal });
for (const button of document.querySelectorAll("[data-tool]")) button.addEventListener("click", event => {
  setTool(button.dataset.tool);
  if (event.detail === 0) stage.focus({ preventScroll: true });
}, { signal: listeners.signal });
$("timeButton").addEventListener("click", () => {
  state.showTimes = !state.showTimes;
  $("timeButton").setAttribute("aria-pressed", String(state.showTimes));
  paintTimeLabels();
}, { signal: listeners.signal });
let poolEditStarted = false;
$("poolSeconds").addEventListener("input", event => {
  const pool = state.pools.find(item => item.id === state.selectedId);
  if (!pool) return;
  const seconds = clamp(Number(event.currentTarget.value), MIN_POOL_SECONDS, MAX_POOL_SECONDS);
  if (!Number.isFinite(seconds) || seconds === pool.seconds) return;
  if (!poolEditStarted) { remember(); poolEditStarted = true; }
  pool.seconds = seconds;
  queueSceneGeometry(); // Do not rebuild Three.js tubes on every slider event.
  $("poolSecondsOut").textContent = `${seconds.toFixed(2)} s`;
}, { signal: listeners.signal });
for (const eventName of ["change", "pointerup", "pointercancel", "blur"]) {
  $("poolSeconds").addEventListener(eventName, () => {
    if (sceneUpdateQueued) { sceneUpdateQueued = false; updateSceneGeometry(); resize(); }
    poolEditStarted = false;
  }, { signal: listeners.signal });
}
let mixEditStarted = false;
$("junctionMix").addEventListener("input", event => {
  if (state.split?.join === undefined) return;
  const mix = clamp(Number(event.currentTarget.value), 0, 1);
  if (!Number.isFinite(mix) || mix === state.split.mix) return;
  if (!mixEditStarted) { remember(); mixEditStarted = true; }
  state.split.mix = mix;
  $("junctionMixOut").textContent = `${Math.round(mix * 100)}% B`;
  sendRoute();
  presetMenu?.refresh();
}, { signal: listeners.signal });
for (const eventName of ["change", "pointerup", "pointercancel", "blur"]) {
  $("junctionMix").addEventListener(eventName, () => { mixEditStarted = false; },
    { signal: listeners.signal });
}
$("joinButton").addEventListener("click", sealTape, { signal: listeners.signal });
$("undoButton").addEventListener("click", undo, { signal: listeners.signal });
$("resetButton").addEventListener("click", reset, { signal: listeners.signal });
$("printTape").addEventListener("change", (event) => {
  state.printing = event.currentTarget.checked;
  sendTapeParams();
  presetMenu?.refresh();
  say(state.printing ? "Record head printing." : "Record head lifted; existing tape keeps playing.");
}, { signal: listeners.signal });
$("feedbackAmount").addEventListener("input", (event) => {
  state.feedback = clamp(Number(event.currentTarget.value), 0, .88);
  $("feedbackOut").textContent = `${Math.round(state.feedback * 100)}%`;
  sendTapeParams();
  presetMenu?.refresh();
}, { signal: listeners.signal });
$("phaseSlip").addEventListener("input", (event) => {
  state.phaseSlip = clamp(Number(event.currentTarget.value), 0, .06);
  $("phaseSlipOut").textContent = `${(state.phaseSlip * 100).toFixed(1)}%`;
  sendTapeParams();
  presetMenu?.refresh();
}, { signal: listeners.signal });
$("echoReturn").addEventListener("input", (event) => {
  state.echoReturn = clamp(Number(event.currentTarget.value), 0, .8);
  $("echoReturnOut").textContent = `${Math.round(state.echoReturn * 100)}%`;
  sendTapeParams();
  presetMenu?.refresh();
}, { signal: listeners.signal });
$("returnHead").addEventListener("change", (event) => {
  state.returnHead = event.currentTarget.value;
  sendTapeParams();
  presetMenu?.refresh();
  say(`${state.returnHead === "play-1" ? "PLAY 01" : "PLAY 02"} returns to REC.`);
}, { signal: listeners.signal });
$("monitorMix").addEventListener("input", (event) => {
  state.monitorMix = clamp(Number(event.currentTarget.value), 0, 1);
  $("monitorMixOut").textContent = `${Math.round(state.monitorMix * 100)}% tape`;
  sendTapeParams();
  presetMenu?.refresh();
}, { signal: listeners.signal });
$("sourceVoices").addEventListener("change", (event) => {
  changeVoiceCount(Number(event.currentTarget.value));
  sendTapeParams();
  presetMenu?.refresh();
  say(state.voices === 1 ? "Solo source motor." : `${state.voices} source motors drifting together.`);
}, { signal: listeners.signal });
$("syncMotors").addEventListener("click", () => {
  state.phaseShiftTime = 0;
  state.extraPhaseTimes.fill(0);
  audio?.node.port.postMessage({ type: "sync-motors" });
  say("Source motors back in unison. Slip can pull them apart again.");
}, { signal: listeners.signal });
$("eraseEcho").addEventListener("click", () => {
  tapeMemory = null;
  audio?.node.port.postMessage({ type: "erase-tape" });
  say("Tape memory erased; the loaded track keeps running.");
}, { signal: listeners.signal });

function sendMaterial(session = audio) {
  if (!session) return;
  // Retain PCM for Audio off/on and the moving waveform; transfer only a copy.
  const samples = track.samples.slice();
  session.node.port.postMessage({ type: "material", samples, rate: track.rate }, [samples.buffer]);
}
function putTrackOnTape(next) {
  track = next;
  trackPeaks = trackEnvelope(track.samples);
  state.trackTime %= trackDuration();
  state.phaseShiftTime %= trackDuration();
  state.extraPhaseTimes = state.extraPhaseTimes.map(time => time % trackDuration());
  lastClockSecond = -1;
  $("trackName").textContent = track.name;
  updateTrackClock();
  sendMaterial();
}
$("loadTrack").addEventListener("click", () => $("trackFile").click(), { signal: listeners.signal });
$("loadCassette").addEventListener("click", () => $("cassetteFile").click(), { signal: listeners.signal });
$("bundledCassette").addEventListener("click", () => { void loadBundledCassette(); }, { signal: listeners.signal });
$("stockCassette").addEventListener("click", () => {
  restoreStockCassette();
  say("Generated cassette shell restored.");
}, { signal: listeners.signal });
async function loadCassetteFile(file) {
  if (!file) return;
  const generation = cancelCassetteLoad();
  $("cassetteError").hidden = true;
  let gltf;
  try {
    if (!file.name.toLowerCase().endsWith(".glb") || file.size > MAX_CASSETTE_BYTES) {
      throw new RangeError("Choose a .glb cassette smaller than 32 MB.");
    }
    const buffer = await file.arrayBuffer();
    if (destroyed || generation !== cassetteLoadGeneration) return;
    validateLocalGlb(buffer);
    gltf = await new GLTFLoader().parseAsync(buffer, "");
    if (destroyed || generation !== cassetteLoadGeneration) return;
    installCassetteModel(gltf.scene, file.name, "local");
    gltf = null;
    say("Local cassette shell on the deck.");
  } catch (error) {
    if (destroyed || generation !== cassetteLoadGeneration) return;
    if (!importedCassette) $("cassetteName").textContent = "Generated shell";
    $("cassetteError").hidden = false;
    $("cassetteError").textContent = `Cassette could not load: ${error.message}`;
  } finally {
    if (gltf) disposeImportedCassette({ mount: new THREE.Group(), model: gltf.scene });
    if (generation === cassetteLoadGeneration && !destroyed) $("cassetteFile").value = "";
  }
}
$("cassetteFile").addEventListener("change", event => {
  void loadCassetteFile(event.currentTarget.files?.[0]);
}, { signal: listeners.signal });
stage.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  stage.classList.add("dragging-model");
}, { signal: listeners.signal });
stage.addEventListener("dragleave", event => {
  if (!stage.contains(event.relatedTarget)) stage.classList.remove("dragging-model");
}, { signal: listeners.signal });
stage.addEventListener("drop", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault(); // Never navigate to an untrusted model file.
  stage.classList.remove("dragging-model");
  void loadCassetteFile(event.dataTransfer.files[0]);
}, { signal: listeners.signal });
$("originalTrack").addEventListener("click", () => {
  trackLoadGeneration++;
  $("trackFile").value = "";
  $("audioError").hidden = true;
  putTrackOnTape(originalTrack);
  say("Original track on the tape.");
}, { signal: listeners.signal });
$("trackFile").addEventListener("change", async event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const generation = ++trackLoadGeneration;
  $("audioError").hidden = true;
  try {
    if (file.size > 24 * 1024 * 1024) throw new RangeError("Choose a file smaller than 24 MB.");
    if (!window.OfflineAudioContext) throw new Error("Local audio decoding is not available in this browser.");
    const decoder = new OfflineAudioContext(1, 1, ORIGINAL_TRACK_RATE);
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    if (destroyed || generation !== trackLoadGeneration) return;
    const length = Math.min(decoded.length, ORIGINAL_TRACK_RATE * 60);
    if (length < ORIGINAL_TRACK_RATE / 10 || !decoded.numberOfChannels) {
      throw new RangeError("Choose an audio track at least 0.1 seconds long.");
    }
    const samples = new Float32Array(length);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    for (let i = 0; i < length; i += 1) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      const fade = Math.min(1, i / 240, (length - 1 - i) / 240);
      samples[i] = clamp(value / channels.length, -1, 1) * Math.max(0, fade);
    }
    putTrackOnTape({
      name: `${file.name}${decoded.length > length ? " · first 60 s" : ""}`,
      samples, rate: ORIGINAL_TRACK_RATE,
    });
    say("Local track on the tape.");
  } catch (error) {
    if (destroyed || generation !== trackLoadGeneration) return;
    $("audioError").hidden = false;
    $("audioError").textContent = `Track could not load: ${error.message}`;
  }
}, { signal: listeners.signal });

function paintAudio(status) {
  const button = $("audioButton");
  button.setAttribute("aria-pressed", String(status === "on"));
  button.setAttribute("data-audio-state", status);
  $("audioState").textContent = status;
}

function closeSession(session, fade = true) {
  if (!session || session.closed) return;
  session.closed = true;
  session.node.port.onmessage = null;
  window.clearTimeout(session.snapshotTimer);
  const finish = () => {
    session.node.port.postMessage({ type: "dispose" });
    session.releaseOutput();
    session.node.disconnect();
    session.gain.disconnect();
    session.context.close().catch(() => {});
    audioSessions.delete(session);
  };
  if (fade && session.context.state === "running") {
    session.gain.gain.setTargetAtTime(0, session.context.currentTime, .012);
    session.timer = window.setTimeout(finish, 110);
  } else finish();
}

function snapshotTapeBeforeClosing(session) {
  return new Promise(resolve => {
    let settled = false;
    const done = snapshot => {
      if (settled) return;
      settled = true;
      window.clearTimeout(session.snapshotTimer);
      session.node.port.onmessage = null;
      session.resolveSnapshot = null;
      resolve(snapshot);
    };
    session.resolveSnapshot = done;
    session.snapshotTimer = window.setTimeout(() => done(null), 300);
    session.node.port.onmessage = ({ data }) => {
      if (data?.type === "tape-snapshot" && data.samples instanceof Float32Array
        && data.samples.length <= 12 * session.context.sampleRate + 2) {
        done({ samples: data.samples, rate: data.rate });
      }
    };
    session.node.port.postMessage({ type: "export-tape" });
  });
}

async function toggleAudio() {
  if (audio) {
    const previous = audio;
    audio = null;
    const button = $("audioButton");
    button.disabled = true;
    paintAudio("off");
    try {
      const saved = await snapshotTapeBeforeClosing(previous);
      if (!destroyed && saved) tapeMemory = saved;
    } finally {
      closeSession(previous);
      if (!destroyed) button.disabled = false;
    }
    say("Audio off.");
    return;
  }
  if (destroyed || !$("audioButton") || !window.AudioContext || !window.AudioWorkletNode) {
    $("audioError").hidden = false;
    $("audioError").textContent = "AudioWorklet is unavailable.";
    paintAudio("error");
    return;
  }
  const button = $("audioButton");
  button.disabled = true;
  paintAudio("starting");
  $("audioError").hidden = true;
  let context;
  let session;
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    // Resume during the actual Audio click. No transport, drag or preset creates
    // an AudioContext, and no unrelated await consumes mobile user activation.
    const resumed = context.resume();
    await context.audioWorklet.addModule(new URL("./tapezoid-processor.js", import.meta.url));
    if (destroyed) { await context.close(); return; }
    const node = new AudioWorkletNode(context, "morphazoid-tapezoid", { outputChannelCount: [2] });
    const gain = context.createGain();
    gain.gain.value = Number($("outputLevel").value);
    node.connect(gain);
    const releaseOutput = connectAudioOutput(context, gain);
    session = { context, node, gain, releaseOutput, closed: false, timer: null, snapshotTimer: null };
    audioSessions.add(session);
    audio = session;
    node.port.onmessage = ({ data }) => {
      if (audio !== session || !data) return;
      if (data.type === "transport") {
        if (Number.isFinite(data.phase)) state.phase = data.phase;
        if (Number.isFinite(data.trackTime)) state.trackTime = data.trackTime;
        if (Number.isFinite(data.phaseShiftTime)) state.phaseShiftTime = data.phaseShiftTime;
        if (Array.isArray(data.extraPhaseTimes) && data.extraPhaseTimes.length === 6
          && data.extraPhaseTimes.every(Number.isFinite)) {
          state.extraPhaseTimes = data.extraPhaseTimes;
        }
      }
    };
    sendMaterial(session);
    sendRoute();
    if (tapeMemory) {
      const samples = tapeMemory.samples.slice();
      node.port.postMessage({ type: "import-tape", samples, rate: tapeMemory.rate }, [samples.buffer]);
    }
    // Set the virtual motor count before restoring their individual phases:
    // doubling a pair initializes new cursors and would otherwise wipe them.
    sendTapeParams(session);
    node.port.postMessage({
      type: "seek", phase: state.phase, trackTime: state.trackTime,
      phaseShiftTime: state.phaseShiftTime, extraPhaseTimes: state.extraPhaseTimes,
    });
    node.port.postMessage({ type: "speed", speed: state.speed });
    await resumed;
    if (destroyed) { audio = null; closeSession(session, false); return; }
    paintAudio("on");
    say("Track playing through the tape heads.");
  } catch (error) {
    if (audio === session) audio = null;
    if (session) closeSession(session, false);
    else context?.close().catch(() => {});
    $("audioError").hidden = false;
    $("audioError").textContent = `Audio could not start: ${error.message}`;
    paintAudio("error");
  } finally {
    if (!destroyed) button.disabled = false;
  }
}
$("audioButton").addEventListener("click", toggleAudio, { signal: listeners.signal });
$("outputLevel").addEventListener("input", (event) => {
  const level = Number(event.currentTarget.value);
  $("outputLevelOut").textContent = `${Math.round(level * 100)}%`;
  if (audio) audio.gain.gain.setTargetAtTime(level, audio.context.currentTime, .012);
}, { signal: listeners.signal });

presetMenu = registerHeaderPresets({
  id: "tapezoid",
  presets: TAPEZOID_FULL_PRESETS,
  capture: () => captureTapezoidPreset(state),
  apply: applyTapezoidPreset,
  randomize: randomizeTapezoidPreset,
});

// A read-only, deliberately small seam for interaction and lifecycle QA.
window.__tapezoid = Object.freeze({
  snapshot: () => ({
    ...captureTapezoidPreset(state),
    // Keep the early QA readout's numeric positions while exposing full
    // identities separately for added/removed contacts.
    heads: state.heads.map(head => head.position),
    headParts: state.heads.map(head => ({ ...head })),
    selectedId: state.selectedId, phase: state.phase, speed: state.speed,
    tool: state.tool, showTimes: state.showTimes, seconds: state.timeline.seconds,
    segmentTimes: state.segmentTimes.map(({ id, length, seconds, travelSeconds,
      storageSeconds, arrivalSeconds }) => ({
      id, length, seconds, travelSeconds, storageSeconds, arrivalSeconds,
    })),
    junctionArrivals: state.fork ? (() => {
      const write = state.heads.find(head => head.kind === "record").position;
      const base = headDelaySeconds(state.path, state.pools, write, state.fork.join, state.timeline);
      return state.fork.lanes.map(lane => base + lane.delaySeconds * state.timeline.scale);
    })() : null,
    branchDelays: state.fork?.lanes.map(lane => lane.delaySeconds * state.timeline.scale) ?? null,
    poolShapes: state.pools.map(pool => {
      const track = activePool(pool).track;
      return {
        id: pool.id, laneId: pool.laneId ?? null,
        radius: track.radius, rows: track.rows, length: track.total,
        renderedRadius: (poolGroups.get(pool.id)?.userData.basin.scale.x ?? 0) * .5,
      };
    }),
    reelAngles: importedCassette
      ? (importedCassette.artist?.reels.map(reel => reel.rotation.z) ?? [])
      : spools.map(spool => spool.rotation.y),
    cameraFrame: { centerZ: camera.position.z, halfHeight: camera.top },
    trackTime: state.trackTime, trackSeconds: trackDuration(), trackName: track.name,
    phaseShiftTime: state.phaseShiftTime, extraPhaseTimes: [...state.extraPhaseTimes],
    phaseSlip: state.phaseSlip, voices: state.voices,
    feedback: state.feedback, printing: state.printing,
    echoReturn: state.echoReturn, returnHead: state.returnHead, monitorMix: state.monitorMix,
    cassetteModel: stage.dataset.cassetteModel,
    cassetteRender: {
      visible: importedCassette ? importedCassette.mount.parent === scene && !stockCassette.visible : stockCassette.visible,
      vertices: importedCassette?.vertices ?? 0,
      width: cassetteShellWidth,
      reelTriangles: importedCassette?.artist?.reelTriangles ?? [],
      opaqueDepthWrite: importedCassette?.artist?.opaque.depthWrite ?? false,
      windowDepthWrite: importedCassette?.artist?.glass.depthWrite ?? false,
    },
    audioOn: Boolean(audio),
    connections: audioSessions.size, history: state.history.length,
    memoryStored: Boolean(tapeMemory),
  }),
});

function destroy() {
  if (destroyed) return;
  destroyed = true;
  cancelCassetteLoad();
  listeners.abort();
  presetMenu?.destroy();
  stageResizeObserver.disconnect();
  cancelAnimationFrame(frameId);
  if (drag && stage.hasPointerCapture(drag.pointerId)) stage.releasePointerCapture(drag.pointerId);
  drag = null;
  for (const session of audioSessions) {
    session.resolveSnapshot?.(null);
    window.clearTimeout(session.timer);
    // A fading session may already be marked closed; finish it here.
    if (session.closed) {
      session.releaseOutput();
      session.node.disconnect();
      session.gain.disconnect();
      session.context.close().catch(() => {});
      audioSessions.delete(session);
    } else closeSession(session, false);
  }
  audio = null;
  disposeImportedCassette(importedCassette);
  importedCassette = null;
  tapeMemory = null;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(item => {
    if (item.geometry) geometries.add(item.geometry);
    for (const shade of (Array.isArray(item.material) ? item.material : [item.material])) {
      if (!shade) continue;
      materials.add(shade);
      if (shade.map) textures.add(shade.map);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const shade of materials) shade.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  delete window.__tapezoid;
}
window.addEventListener("pagehide", destroy, { signal: listeners.signal });
// A restored bfcache page must rebuild its disposed WebGL/audio resources.
window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });

function animate(now) {
  if (destroyed) return;
  frameId = requestAnimationFrame(animate);
  // Give pointer, DOM and AudioWorklet messages a turn *after* costly WebGL,
  // instead of rendering again immediately on a slower graphics device.
  if (now < nextVisualFrame) return;
  const frameStart = performance.now();
  const elapsed = Math.min(.5, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (sceneUpdateQueued) {
    sceneUpdateQueued = false;
    updateSceneGeometry();
  }
  if (state.speed !== 0) {
    state.trackTime = (state.trackTime + elapsed * state.speed + trackDuration()) % trackDuration();
  }
  if (!audio && state.speed !== 0) {
    if (state.voices > 1) {
      state.phaseShiftTime = (state.phaseShiftTime + elapsed * state.speed * state.phaseSlip + trackDuration())
        % trackDuration();
    }
    for (let i = 0; i < state.voices - 2; i += 1) {
      state.extraPhaseTimes[i] = (state.extraPhaseTimes[i]
        + elapsed * state.speed * state.phaseSlip * EXTRA_SLIPS[i] + trackDuration()) % trackDuration();
    }
    state.phase = (state.phase + elapsed * state.speed / state.timeline.seconds + 1) % 1;
  }
  if (now - lastWavePaint > 34) {
    drawTrackWave();
    lastWavePaint = now;
  }
  updateTrackClock();
  $("phaseSeparation").textContent = state.voices === 1 ? "SOLO" : `${state.phaseShiftTime.toFixed(2)} s apart`;
  phaseWave.visible = state.voices > 1 || Boolean(state.fork);
  for (const head of state.heads.filter(item => item.kind === "record")) {
    const lamp = headGroups.get(head.id)?.userData.printLamp?.material;
    if (lamp) lamp.emissiveIntensity = state.printing && audio && state.speed === 1 ? 1.6 : .08;
  }
  for (const spool of spools) spool.rotation.y += elapsed * state.speed * 2.25;
  for (const reel of importedCassette?.artist?.reels ?? []) reel.rotation.z += elapsed * state.speed * 2.25;
  for (const wheel of driveWheels) wheel.rotation.y += elapsed * state.speed * 5;
  const branches = state.fork;
  for (let i = 0; i < flecks.count; i += 1) {
    const s = (i / flecks.count + state.phase) % 1;
    const p = pointAtForkTime(state.path, state.pools, branches, i % 2, s, state.timeline);
    instanceDummy.position.set(p.x, .41, p.z);
    instanceDummy.rotation.set(0, Math.atan2(-p.tx, -p.tz), 0);
    const visible = p.poolId !== null || isExposed(state.path, p.basePhase);
    instanceDummy.scale.set(visible ? .5 + .55 * Math.abs(Math.sin(i * 6.42)) : 0, 1, 1);
    instanceDummy.updateMatrix();
    flecks.setMatrixAt(i, instanceDummy.matrix);
  }
  flecks.instanceMatrix.needsUpdate = true;
  const moving = pointAtForkTime(state.path, state.pools, branches, 0, state.phase, state.timeline);
  marker.position.set(moving.x, .51, moving.z);
  marker.visible = moving.poolId !== null || isExposed(state.path, moving.basePhase);
  const other = branches
    ? pointAtForkTime(state.path, state.pools, branches, 1, state.phase, state.timeline) : null;
  splitMarker.visible = Boolean(other && (other.poolId !== null || isExposed(state.path, other.basePhase))
    && state.phase * state.timeline.seconds >= branches.startTime);
  if (splitMarker.visible) {
    splitMarker.position.set(other.x, .51, other.z);
  }
  renderer.render(scene, camera);
  const finished = performance.now();
  nextVisualFrame = finished + (finished - frameStart > 35 ? 65 : 32);
}
// A missing or malformed artist asset leaves the authored generated shell
// playable; model loading never creates or arms an AudioContext.
void loadBundledCassette();
frameId = requestAnimationFrame(animate);
