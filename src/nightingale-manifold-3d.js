import * as THREE from "../vendor/three/three.module.min.js";

const BACKGROUND = 0x020807;
const SIMILARITY = new THREE.Color("#58d5c9");
const SEQUENCE = new THREE.Color("#e9b85d");
const ROUTE = new THREE.Color("#b9e56b");
const SELECTION = new THREE.Color("#fffdf4");
const LOW_TONE = new THREE.Color("#efbe67");
const MID_TONE = new THREE.Color("#58d6d1");
const HIGH_TONE = new THREE.Color("#64aee8");
const FAMILY_COLOURS = Object.freeze([
  "#58d5c9",
  "#e9b85d",
  "#b9dc68",
  "#72b7e8",
  "#9ea8ef",
  "#72d6a2",
]);

const DEFAULT_VIEW = Object.freeze({
  // This oblique side view separates repeated near-neighbor occurrences in
  // the default demo while keeping the graph clear of the explanatory title.
  yaw: 1.84,
  pitch: 0.24,
  distance: 5.75,
});

const DEFAULT_OPTIONS = Object.freeze({
  showSimilarity: true,
  showSequence: true,
  showTrajectories: true,
  autoRotate: false,
});

const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_RENDER_PIXELS = 3_000_000;
const MAX_TRAJECTORY_POINTS = 96;
const RELATIVE_LEVEL_FLOOR_DB = -36;
const POINTER_DRAG_THRESHOLD = 4;
const MIN_CAMERA_DISTANCE = 2.25;
const MAX_CAMERA_DISTANCE = 10;
const MAX_CAMERA_PITCH = Math.PI * 0.46;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

function positionFrom(value) {
  const position = value?.position ?? value;
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function normalizedAnalysis(source) {
  const analysis = source && typeof source === "object" ? source : {};
  return {
    strophes: Array.isArray(analysis.strophes) ? analysis.strophes : [],
    tones: Array.isArray(analysis.tones) ? analysis.tones : [],
    frames: Array.isArray(analysis.frames) ? analysis.frames : [],
    similarityEdges: Array.isArray(analysis.similarityEdges) ? analysis.similarityEdges : [],
    sequenceEdges: Array.isArray(analysis.sequenceEdges) ? analysis.sequenceEdges : [],
    spectralRange: analysis.spectralRange && typeof analysis.spectralRange === "object"
      ? analysis.spectralRange
      : {},
  };
}

function robustUpper(values, quantile = 0.9) {
  const sorted = values
    .map((value) => Math.max(0, finite(value)))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 1;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function relativeLevel(value, reference) {
  if (!(value > 0) || !(reference > 0)) return 0;
  const decibels = 20 * Math.log10(value / reference);
  return clamp(
    (decibels - RELATIVE_LEVEL_FLOOR_DB) / -RELATIVE_LEVEL_FLOOR_DB,
    0,
    1,
  );
}

function toneColour(frequencyHz, minimumHz, maximumHz, level) {
  const minimum = Math.max(1, finite(minimumHz, 1));
  const maximum = Math.max(minimum + 1, finite(maximumHz, minimum + 1));
  const amount = clamp(
    (Math.log(Math.max(minimum, finite(frequencyHz, minimum))) - Math.log(minimum))
      / Math.max(1e-9, Math.log(maximum) - Math.log(minimum)),
    0,
    1,
  );
  const colour = amount < 0.5
    ? LOW_TONE.clone().lerp(MID_TONE, amount * 2)
    : MID_TONE.clone().lerp(HIGH_TONE, (amount - 0.5) * 2);
  return colour.multiplyScalar(0.38 + clamp(level, 0, 1, 0) * 0.62);
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const candidates = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of candidates) if (material) materials.add(material);
  });
  root?.clear?.();
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

function setGroupVisible(group, visible) {
  if (group) group.visible = Boolean(visible);
}

/**
 * Create the self-contained 3D renderer used by the Nightingale manifold page.
 * Analysis, playback, and synthesis remain outside this module; the renderer
 * only owns WebGL resources and interaction with the supplied canvas.
 */
export function createNightingaleManifoldRenderer(canvas, { onSelect } = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createNightingaleManifoldRenderer requires a canvas");
  }

  const documentObject = canvas.ownerDocument ?? globalThis.document;
  const windowObject = documentObject?.defaultView ?? globalThis;
  const requestFrame = windowObject.requestAnimationFrame?.bind(windowObject)
    ?? ((callback) => windowObject.setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = windowObject.cancelAnimationFrame?.bind(windowObject)
    ?? windowObject.clearTimeout?.bind(windowObject);
  const reducedMotionQuery = windowObject.matchMedia?.("(prefers-reduced-motion: reduce)")
    ?? { matches: false };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(BACKGROUND, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const target = new THREE.Vector3(0, 0, 0);
  const content = new THREE.Group();
  const trajectories = new THREE.Group();
  const similarity = new THREE.Group();
  const sequence = new THREE.Group();
  const route = new THREE.Group();
  const nodes = new THREE.Group();
  const selection = new THREE.Group();
  content.add(trajectories, similarity, sequence, route, nodes, selection);
  scene.add(content);

  const grid = new THREE.GridHelper(3.8, 12, 0x1d4a44, 0x102b28);
  grid.position.y = -1.62;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.material.depthWrite = false;
  scene.add(grid);

  let analysis = normalizedAnalysis();
  let options = { ...DEFAULT_OPTIONS };
  let view = { ...DEFAULT_VIEW };
  let selectedIndex = null;
  let selectedMesh = null;
  let routeIndices = [];
  let nodeMeshes = [];
  let stropheByReference = new Map();
  let transformedPositions = new Map();
  let selectedRing = null;
  let frameHandle = 0;
  let lastFrameTime = null;
  let resizeObserver = null;
  let pointerGesture = null;
  const activePointers = new Map();
  let familyColours = new Map();
  let disposed = false;
  let contextLost = false;
  let renderWidth = 0;
  let renderHeight = 0;
  let renderedSimilarityEdges = 0;
  let renderedSequenceEdges = 0;
  let renderedTrajectories = 0;
  let renderedToneFrames = 0;
  let renderedToneCandidates = 0;
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  function updateCamera() {
    const horizontal = Math.cos(view.pitch) * view.distance;
    camera.position.set(
      Math.sin(view.yaw) * horizontal,
      Math.sin(view.pitch) * view.distance,
      Math.cos(view.yaw) * horizontal,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    if (selectedRing) selectedRing.quaternion.copy(camera.quaternion);
    for (const glyph of trajectories.children) {
      if (glyph.userData.billboard) glyph.quaternion.copy(camera.quaternion);
    }
  }

  function resize() {
    if (disposed || contextLost) return false;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || canvas.clientWidth || 1));
    const height = Math.max(1, Math.round(bounds.height || canvas.clientHeight || 1));
    if (width === renderWidth && height === renderHeight) return false;
    renderWidth = width;
    renderHeight = height;
    const requestedRatio = Math.min(
      MAX_DEVICE_PIXEL_RATIO,
      Math.max(1, finite(windowObject.devicePixelRatio, 1)),
    );
    const budgetRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
    renderer.setPixelRatio(Math.max(0.75, Math.min(requestedRatio, budgetRatio)));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return true;
  }

  function handleWindowResize() {
    resize();
    scheduleRender();
  }

  function renderFrame(time = 0) {
    frameHandle = 0;
    if (disposed || contextLost || documentObject?.hidden) return;
    const now = finite(time, lastFrameTime ?? 0);
    if (options.autoRotate && !reducedMotionQuery.matches && lastFrameTime !== null) {
      const delta = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1_000));
      view.yaw += delta * 0.16;
    }
    lastFrameTime = now;
    resize();
    updateCamera();
    renderer.render(scene, camera);
    if (options.autoRotate && !reducedMotionQuery.matches) scheduleRender();
  }

  function scheduleRender() {
    if (frameHandle || disposed || contextLost || documentObject?.hidden) return;
    frameHandle = requestFrame(renderFrame);
  }

  function clearAnalysisObjects() {
    for (const group of [trajectories, similarity, sequence, route, nodes, selection]) {
      disposeObject(group);
    }
    nodeMeshes = [];
    selectedMesh = null;
    selectedRing = null;
    stropheByReference = new Map();
    transformedPositions = new Map();
    familyColours = new Map();
    renderedSimilarityEdges = 0;
    renderedSequenceEdges = 0;
    renderedTrajectories = 0;
    renderedToneFrames = 0;
    renderedToneCandidates = 0;
  }

  function colourForFamily(family) {
    const key = family === undefined || family === null
      ? "unclassified"
      : `${typeof family}:${String(family)}`;
    if (!familyColours.has(key)) {
      familyColours.set(key, FAMILY_COLOURS[familyColours.size % FAMILY_COLOURS.length]);
    }
    return familyColours.get(key);
  }

  function analysisTransform() {
    // The map is a projection of occurrence centroids. Frame-level detail is
    // rendered as a compact glyph around each centroid, so outlier frames (and
    // inactive frames at the origin) must not shrink the occurrence map.
    const sourcePositions = analysis.strophes.map(positionFrom).filter(Boolean);
    if (!sourcePositions.length) {
      return (position) => new THREE.Vector3(
        finite(position?.x),
        finite(position?.y),
        finite(position?.z),
      );
    }
    const minimum = { x: Infinity, y: Infinity, z: Infinity };
    const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const position of sourcePositions) {
      minimum.x = Math.min(minimum.x, position.x);
      minimum.y = Math.min(minimum.y, position.y);
      minimum.z = Math.min(minimum.z, position.z);
      maximum.x = Math.max(maximum.x, position.x);
      maximum.y = Math.max(maximum.y, position.y);
      maximum.z = Math.max(maximum.z, position.z);
    }
    const center = {
      x: (minimum.x + maximum.x) * 0.5,
      y: (minimum.y + maximum.y) * 0.5,
      z: (minimum.z + maximum.z) * 0.5,
    };
    const extent = Math.max(
      maximum.x - minimum.x,
      maximum.y - minimum.y,
      maximum.z - minimum.z,
      1e-6,
    );
    const scale = 3.05 / extent;
    return (position) => new THREE.Vector3(
      (finite(position?.x) - center.x) * scale,
      (finite(position?.y) - center.y) * scale,
      (finite(position?.z) - center.z) * scale,
    );
  }

  function registerStrophe(strophe, arrayIndex, position) {
    const reference = {
      strophe,
      arrayIndex,
      index: strophe?.index ?? arrayIndex,
      position,
    };
    stropheByReference.set(arrayIndex, reference);
    stropheByReference.set(String(arrayIndex), reference);
    if (strophe?.index !== undefined && strophe?.index !== null) {
      stropheByReference.set(strophe.index, reference);
      stropheByReference.set(String(strophe.index), reference);
    }
    if (strophe?.id !== undefined && strophe?.id !== null) {
      stropheByReference.set(strophe.id, reference);
      stropheByReference.set(String(strophe.id), reference);
    }
    transformedPositions.set(arrayIndex, position);
    transformedPositions.set(reference.index, position);
    if (strophe?.id !== undefined) transformedPositions.set(strophe.id, position);
    return reference;
  }

  function resolveReference(value) {
    if (value && typeof value === "object") {
      if (value.index !== undefined && stropheByReference.has(value.index)) {
        return stropheByReference.get(value.index);
      }
      if (value.id !== undefined && stropheByReference.has(value.id)) {
        return stropheByReference.get(value.id);
      }
    }
    return stropheByReference.get(value) ?? stropheByReference.get(String(value));
  }

  function makeEdgeSegments(edges, colour, dashed = false) {
    const positions = [];
    const colours = [];
    let count = 0;
    for (const edge of edges) {
      const from = resolveReference(edge?.source ?? edge?.from);
      const to = resolveReference(edge?.target ?? edge?.to);
      if (!from || !to || from === to) continue;
      positions.push(
        from.position.x, from.position.y, from.position.z,
        to.position.x, to.position.y, to.position.z,
      );
      const strength = clamp(edge?.weight, 0, 1, 0.5);
      const shade = colour.clone().multiplyScalar(0.38 + strength * 0.62);
      colours.push(shade.r, shade.g, shade.b, shade.r, shade.g, shade.b);
      count += 1;
    }
    if (!positions.length) return { object: null, count };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    const material = dashed
      ? new THREE.LineDashedMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        dashSize: 0.018,
        gapSize: 0.035,
        depthWrite: false,
      })
      : new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      });
    const object = new THREE.LineSegments(geometry, material);
    if (dashed) object.computeLineDistances();
    object.renderOrder = dashed ? 1 : 2;
    return { object, count };
  }

  function buildEdges() {
    const similarityLines = makeEdgeSegments(analysis.similarityEdges, SIMILARITY, true);
    const visibleSequenceEdges = analysis.sequenceEdges.filter(
      (edge) => edge.withinConfiguredSequence !== false,
    );
    const sequenceLines = makeEdgeSegments(visibleSequenceEdges, SEQUENCE, false);
    if (similarityLines.object) similarity.add(similarityLines.object);
    if (sequenceLines.object) sequence.add(sequenceLines.object);
    if (sequenceLines.count) {
      let geometry = null;
      let material = null;
      const up = new THREE.Vector3(0, 1, 0);
      for (const edge of visibleSequenceEdges) {
        const from = resolveReference(edge?.source ?? edge?.from);
        const to = resolveReference(edge?.target ?? edge?.to);
        if (!from || !to || from === to) continue;
        const direction = to.position.clone().sub(from.position);
        const length = direction.length();
        if (length < 1e-6) continue;
        direction.multiplyScalar(1 / length);
        geometry ??= new THREE.ConeGeometry(1, 1, 10, 1, false);
        material ??= new THREE.MeshBasicMaterial({
          color: SEQUENCE,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        });
        const headLength = clamp(length * 0.11, 0.045, 0.105, 0.065);
        const arrowhead = new THREE.Mesh(geometry, material);
        arrowhead.position.copy(from.position).lerp(to.position, 0.76);
        arrowhead.quaternion.setFromUnitVectors(up, direction);
        arrowhead.scale.set(headLength * 0.34, headLength, headLength * 0.34);
        arrowhead.renderOrder = 4;
        sequence.add(arrowhead);
      }
    }
    renderedSimilarityEdges = similarityLines.count;
    renderedSequenceEdges = sequenceLines.count;
  }

  function trajectoryFrames(strophe) {
    const maximum = Math.max(0, analysis.frames.length - 1);
    const start = Math.round(clamp(strophe?.frameStart, 0, maximum, 0));
    const end = Math.round(clamp(strophe?.frameEnd, start, maximum, start));
    const active = [];
    let run = -1;
    let previousWasActive = false;
    for (let frameIndex = start; frameIndex <= end; frameIndex += 1) {
      const frame = analysis.frames[frameIndex];
      const isActive = frame?.active === true
        || (frame?.active === undefined && finite(frame?.peakHz) > 0);
      if (!isActive) {
        previousWasActive = false;
        continue;
      }
      if (!previousWasActive) run += 1;
      active.push({ frame, frameIndex, run });
      previousWasActive = true;
    }
    if (active.length <= MAX_TRAJECTORY_POINTS) return active;
    return Array.from({ length: MAX_TRAJECTORY_POINTS }, (_, index) => (
      active[Math.round(index / (MAX_TRAJECTORY_POINTS - 1) * (active.length - 1))]
    )).filter((entry, index, sampled) => (
      index === 0 || entry.frameIndex !== sampled[index - 1].frameIndex
    ));
  }

  function buildTrajectories() {
    const rmsReference = robustUpper(analysis.frames.map((frame) => frame?.rms), 0.95);
    const minimumHz = finite(analysis.spectralRange.minimumHz, 1);
    const maximumHz = finite(analysis.spectralRange.maximumHz, minimumHz + 1);
    for (const strophe of analysis.strophes) {
      const reference = resolveReference(strophe);
      if (!reference) continue;
      const node = nodeMeshes.find((mesh) => mesh.userData.arrayIndex === reference.arrayIndex);
      const radius = Math.max(0.06, finite(node?.userData.radius, 0.08));
      const glyphWidth = Math.max(0.17, radius * 2.3);
      const glyphHeight = Math.max(0.055, radius * 0.82);
      const frameSpan = Math.max(1, finite(strophe.frameEnd) - finite(strophe.frameStart));
      const frequencyAmount = (frequencyHz) => clamp(
        (Math.log(Math.max(1, finite(frequencyHz, minimumHz))) - Math.log(Math.max(1, minimumHz)))
          / Math.max(1e-9, Math.log(Math.max(minimumHz + 1, maximumHz)) - Math.log(Math.max(1, minimumHz))),
        0,
        1,
      );
      const localPoint = (frameIndex, frequencyHz, depth = 0) => new THREE.Vector3(
        (clamp((frameIndex - finite(strophe.frameStart)) / frameSpan, 0, 1) - 0.5) * glyphWidth,
        radius * 1.12 + 0.014 + frequencyAmount(frequencyHz) * glyphHeight,
        depth,
      );
      const sampled = trajectoryFrames(strophe);
      if (!sampled.length) continue;
      const glyph = new THREE.Group();
      glyph.position.copy(reference.position);
      glyph.quaternion.copy(camera.quaternion);
      glyph.userData.billboard = true;

      const beadPositions = [];
      const beadColours = [];
      const segmentPositions = [];
      const segmentColours = [];
      sampled.forEach((entry, index) => {
        const level = relativeLevel(finite(entry.frame?.rms), rmsReference);
        const colour = toneColour(entry.frame?.peakHz, minimumHz, maximumHz, level);
        const point = localPoint(entry.frameIndex, entry.frame?.peakHz);
        beadPositions.push(point.x, point.y, point.z);
        beadColours.push(colour.r, colour.g, colour.b);
        const previous = sampled[index - 1];
        if (!previous || previous.run !== entry.run) return;
        const previousLevel = relativeLevel(finite(previous.frame?.rms), rmsReference);
        const previousColour = toneColour(
          previous.frame?.peakHz,
          minimumHz,
          maximumHz,
          previousLevel,
        );
        const previousPoint = localPoint(previous.frameIndex, previous.frame?.peakHz);
        segmentPositions.push(
          previousPoint.x, previousPoint.y, previousPoint.z,
          point.x, point.y, point.z,
        );
        segmentColours.push(
          previousColour.r, previousColour.g, previousColour.b,
          colour.r, colour.g, colour.b,
        );
      });
      if (segmentPositions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(segmentPositions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(segmentColours, 3));
        const material = new THREE.LineBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: true,
          opacity: 0.48,
          depthTest: false,
          depthWrite: false,
        });
        const line = new THREE.LineSegments(geometry, material);
        line.renderOrder = 5;
        glyph.add(line);
      }
      const beadGeometry = new THREE.BufferGeometry();
      beadGeometry.setAttribute("position", new THREE.Float32BufferAttribute(beadPositions, 3));
      beadGeometry.setAttribute("color", new THREE.Float32BufferAttribute(beadColours, 3));
      const beads = new THREE.Points(
        beadGeometry,
        new THREE.PointsMaterial({
          size: 0.024,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.94,
          depthTest: false,
          depthWrite: false,
        }),
      );
      beads.renderOrder = 6;
      glyph.add(beads);

      const toneMarkers = [];
      for (const tone of strophe.tones ?? []) {
        const point = localPoint(
          (finite(tone.startFrame) + finite(tone.endFrame)) * 0.5,
          tone.medianPeakHz,
          0.008,
        );
        const level = relativeLevel(finite(tone.energy), rmsReference);
        const colour = toneColour(tone.medianPeakHz, minimumHz, maximumHz, level);
        toneMarkers.push({ point, colour });
      }
      if (toneMarkers.length) {
        // A distinct diamond makes a silence-gated tone candidate legible
        // against the smaller square frame samples in the same ribbon.
        const markerGeometry = new THREE.CircleGeometry(1, 4);
        const markerMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
        });
        const markers = new THREE.InstancedMesh(
          markerGeometry,
          markerMaterial,
          toneMarkers.length,
        );
        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Quaternion();
        const markerScale = new THREE.Vector3(0.034, 0.034, 0.034);
        toneMarkers.forEach(({ point, colour }, index) => {
          matrix.compose(point, rotation, markerScale);
          markers.setMatrixAt(index, matrix);
          markers.setColorAt(index, colour);
        });
        markers.instanceMatrix.needsUpdate = true;
        if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
        markers.renderOrder = 7;
        glyph.add(markers);
        renderedToneCandidates += toneMarkers.length;
      }
      trajectories.add(glyph);
      renderedTrajectories += 1;
      renderedToneFrames += beadPositions.length / 3;
    }
  }

  function buildNodes(transform) {
    const validDurations = analysis.strophes
      .map((strophe) => Math.max(0, finite(strophe?.durationSeconds)))
      .filter((duration) => duration > 0);
    const maximumDuration = Math.max(0.001, ...validDurations);
    const energyReference = robustUpper(
      analysis.strophes.map((strophe) => strophe?.energy),
    );
    const sphereGeometry = new THREE.SphereGeometry(1, 18, 12);
    const shellGeometry = new THREE.IcosahedronGeometry(1, 1);
    const coreMaterials = new Map();
    const shellMaterials = new Map();
    for (let arrayIndex = 0; arrayIndex < analysis.strophes.length; arrayIndex += 1) {
      const strophe = analysis.strophes[arrayIndex];
      const sourcePosition = positionFrom(strophe);
      if (!sourcePosition) continue;
      const position = transform(sourcePosition);
      const reference = registerStrophe(strophe, arrayIndex, position);
      const colour = colourForFamily(strophe?.family);
      let coreMaterial = coreMaterials.get(colour);
      if (!coreMaterial) {
        coreMaterial = new THREE.MeshBasicMaterial({ color: colour });
        coreMaterials.set(colour, coreMaterial);
      }
      let shellMaterial = shellMaterials.get(colour);
      if (!shellMaterial) {
        shellMaterial = new THREE.MeshBasicMaterial({
          color: colour,
          wireframe: true,
          transparent: true,
          opacity: 0.54,
          depthWrite: false,
        });
        shellMaterials.set(colour, shellMaterial);
      }
      const durationAmount = Math.sqrt(
        clamp(finite(strophe?.durationSeconds) / maximumDuration, 0, 1),
      );
      // Keep the shell visually comparable with the recording-order meters:
      // this is linear RMS relative to a robust local reference, not dB SPL.
      const amplitudeAmount = clamp(finite(strophe?.energy) / energyReference, 0, 1);
      const coreRadius = 0.045 + durationAmount * 0.04;
      const shellRadius = coreRadius + 0.015 + amplitudeAmount * 0.065;
      const core = new THREE.Mesh(sphereGeometry, coreMaterial);
      core.position.copy(position);
      core.scale.setScalar(coreRadius);
      core.renderOrder = 3;
      const shell = new THREE.Mesh(shellGeometry, shellMaterial);
      shell.position.copy(position);
      shell.scale.setScalar(shellRadius);
      shell.userData.stropheIndex = reference.index;
      shell.userData.arrayIndex = arrayIndex;
      shell.userData.radius = shellRadius;
      shell.userData.relativeAmplitude = amplitudeAmount;
      shell.userData.energy = finite(strophe?.energy);
      shell.renderOrder = 4;
      nodes.add(core, shell);
      nodeMeshes.push(shell);
    }
  }

  function paintSelection() {
    disposeObject(selection);
    selectedRing = null;
    selectedMesh = null;
    const reference = selectedIndex === null ? null : resolveReference(selectedIndex);
    if (!reference) return;
    selectedMesh = nodeMeshes.find(
      (mesh) => mesh.userData.arrayIndex === reference.arrayIndex,
    ) ?? null;
    if (!selectedMesh) return;
    const radius = finite(selectedMesh.userData.radius, 0.08) * 1.55;
    const geometry = new THREE.TorusGeometry(radius, Math.max(0.008, radius * 0.085), 8, 48);
    const material = new THREE.MeshBasicMaterial({
      color: SELECTION,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    });
    selectedRing = new THREE.Mesh(geometry, material);
    selectedRing.position.copy(reference.position);
    selectedRing.quaternion.copy(camera.quaternion);
    selectedRing.renderOrder = 10;
    selection.add(selectedRing);
  }

  function paintRoute() {
    disposeObject(route);
    const points = routeIndices
      .map(resolveReference)
      .filter(Boolean)
      .map((reference) => reference.position);
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const glow = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: ROUTE,
        transparent: true,
        opacity: 0.24,
        depthTest: false,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(1.002);
    glow.renderOrder = 7;
    const line = new THREE.Line(
      geometry.clone(),
      new THREE.LineBasicMaterial({
        color: ROUTE,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      }),
    );
    line.renderOrder = 8;
    route.add(glow, line);

    const headGeometry = new THREE.ConeGeometry(1, 1, 10, 1, false);
    const headMaterial = new THREE.MeshBasicMaterial({
      color: ROUTE,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    });
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const direction = to.clone().sub(from);
      const length = direction.length();
      if (length < 1e-6) continue;
      direction.multiplyScalar(1 / length);
      const headLength = clamp(length * 0.1, 0.04, 0.09, 0.055);
      const arrowhead = new THREE.Mesh(headGeometry, headMaterial);
      arrowhead.position.copy(from).lerp(to, 0.72);
      arrowhead.quaternion.setFromUnitVectors(up, direction);
      arrowhead.scale.set(headLength * 0.34, headLength, headLength * 0.34);
      arrowhead.renderOrder = 9;
      route.add(arrowhead);
    }
  }

  function setAnalysis(nextAnalysis) {
    if (disposed) return snapshot();
    analysis = normalizedAnalysis(nextAnalysis);
    clearAnalysisObjects();
    const transform = analysisTransform();
    buildNodes(transform);
    buildEdges();
    buildTrajectories();
    paintRoute();
    if (selectedIndex !== null && !resolveReference(selectedIndex)) selectedIndex = null;
    paintSelection();
    setGroupVisible(similarity, options.showSimilarity);
    setGroupVisible(sequence, options.showSequence);
    setGroupVisible(trajectories, options.showTrajectories);
    canvas.dataset.nightingaleStrophes = String(nodeMeshes.length);
    canvas.dataset.nightingaleSimilarityEdges = String(renderedSimilarityEdges);
    canvas.dataset.nightingaleSequenceEdges = String(renderedSequenceEdges);
    canvas.dataset.nightingaleToneFrames = String(renderedToneFrames);
    canvas.dataset.nightingaleToneCandidates = String(renderedToneCandidates);
    canvas.dataset.nightingaleNodeEncoding = "core-duration-shell-gap-relative-rms";
    scheduleRender();
    return snapshot();
  }

  function setSelected(index) {
    if (disposed) return selectedIndex;
    const reference = index === null || index === undefined ? null : resolveReference(index);
    selectedIndex = reference?.index ?? null;
    paintSelection();
    scheduleRender();
    return selectedIndex;
  }

  function setRoute(indices) {
    if (disposed) return routeIndices.slice();
    routeIndices = Array.isArray(indices) ? indices.slice() : [];
    paintRoute();
    scheduleRender();
    return routeIndices.slice();
  }

  function setOptions(nextOptions = {}) {
    if (disposed) return snapshot();
    if (!nextOptions || typeof nextOptions !== "object") return snapshot();
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
      if (nextOptions[key] !== undefined) options[key] = Boolean(nextOptions[key]);
    }
    setGroupVisible(similarity, options.showSimilarity);
    setGroupVisible(sequence, options.showSequence);
    setGroupVisible(trajectories, options.showTrajectories);
    lastFrameTime = null;
    scheduleRender();
    return snapshot();
  }

  function resetView() {
    if (disposed) return Object.freeze({ ...view });
    view = { ...DEFAULT_VIEW };
    lastFrameTime = null;
    scheduleRender();
    return Object.freeze({ ...view });
  }

  function pick(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !nodeMeshes.length) return null;
    pointerNdc.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    updateCamera();
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.intersectObjects(nodeMeshes, false)[0]?.object ?? null;
  }

  function handlePointerDown(event) {
    if (disposed || contextLost || activePointers.size >= 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.nightingaleDragging = "true";
    if (activePointers.size === 1) {
      pointerGesture = {
        mode: "drag",
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        yaw: view.yaw,
        pitch: view.pitch,
        moved: false,
      };
      return;
    }
    const entries = [...activePointers.entries()];
    pointerGesture = {
      mode: "pinch",
      ids: entries.map(([id]) => id),
      startDistance: Math.max(
        1,
        Math.hypot(entries[0][1].x - entries[1][1].x, entries[0][1].y - entries[1][1].y),
      ),
      distance: view.distance,
      moved: true,
    };
  }

  function handlePointerMove(event) {
    const point = activePointers.get(event.pointerId);
    if (!point || !pointerGesture) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pointerGesture.mode === "pinch") {
      const first = activePointers.get(pointerGesture.ids[0]);
      const second = activePointers.get(pointerGesture.ids[1]);
      if (!first || !second) return;
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      view.distance = clamp(
        pointerGesture.distance * pointerGesture.startDistance / distance,
        MIN_CAMERA_DISTANCE,
        MAX_CAMERA_DISTANCE,
        DEFAULT_VIEW.distance,
      );
      scheduleRender();
      return;
    }
    if (pointerGesture.id !== event.pointerId) return;
    const totalDistance = Math.hypot(
      event.clientX - pointerGesture.startX,
      event.clientY - pointerGesture.startY,
    );
    if (totalDistance >= POINTER_DRAG_THRESHOLD) pointerGesture.moved = true;
    if (!pointerGesture.moved) return;
    view.yaw = pointerGesture.yaw - (event.clientX - pointerGesture.startX) * 0.007;
    view.pitch = clamp(
      pointerGesture.pitch + (event.clientY - pointerGesture.startY) * 0.006,
      -MAX_CAMERA_PITCH,
      MAX_CAMERA_PITCH,
      DEFAULT_VIEW.pitch,
    );
    scheduleRender();
  }

  function finishPointer(event, cancelled = false) {
    if (!activePointers.has(event.pointerId)) return;
    if (!cancelled) handlePointerMove(event);
    const gesture = pointerGesture;
    activePointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (gesture?.mode === "pinch") {
      const remaining = activePointers.entries().next().value;
      if (remaining) {
        pointerGesture = {
          mode: "drag",
          id: remaining[0],
          startX: remaining[1].x,
          startY: remaining[1].y,
          yaw: view.yaw,
          pitch: view.pitch,
          moved: true,
        };
      } else {
        pointerGesture = null;
        canvas.removeAttribute("data-nightingale-dragging");
      }
      return;
    }
    if (!gesture || gesture.id !== event.pointerId) return;
    pointerGesture = null;
    if (!activePointers.size) canvas.removeAttribute("data-nightingale-dragging");
    if (cancelled || gesture.moved) return;
    const mesh = pick(event.clientX, event.clientY);
    if (!mesh) return;
    const reference = resolveReference(mesh.userData.stropheIndex);
    setSelected(reference?.index ?? null);
    if (reference && typeof onSelect === "function") {
      try {
        onSelect(reference.index, reference.strophe);
      } catch {
        // Selection rendering must survive a consumer callback failure.
      }
    }
  }

  function handleWheel(event) {
    if (disposed || contextLost) return;
    event.preventDefault();
    view.distance = clamp(
      view.distance * Math.exp(finite(event.deltaY) * 0.0012),
      MIN_CAMERA_DISTANCE,
      MAX_CAMERA_DISTANCE,
      DEFAULT_VIEW.distance,
    );
    scheduleRender();
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    if (frameHandle) cancelFrame?.(frameHandle);
    frameHandle = 0;
    canvas.dataset.nightingaleRenderer = "context-lost";
  }

  function handleContextRestored() {
    if (disposed) return;
    contextLost = false;
    renderWidth = 0;
    renderHeight = 0;
    canvas.dataset.nightingaleRenderer = "webgl";
    scheduleRender();
  }

  function handleVisibilityChange() {
    if (documentObject?.hidden) {
      if (frameHandle) cancelFrame?.(frameHandle);
      frameHandle = 0;
      lastFrameTime = null;
      return;
    }
    scheduleRender();
  }

  function handleReducedMotionChange() {
    lastFrameTime = null;
    scheduleRender();
  }

  function snapshot() {
    return Object.freeze({
      ready: !disposed && !contextLost,
      disposed,
      contextLost,
      reducedMotion: Boolean(reducedMotionQuery.matches),
      stropheCount: nodeMeshes.length,
      similarityEdgeCount: renderedSimilarityEdges,
      sequenceEdgeCount: renderedSequenceEdges,
      trajectoryCount: renderedTrajectories,
      toneFrameCount: renderedToneFrames,
      toneCandidateCount: renderedToneCandidates,
      routeLength: routeIndices.filter((index) => resolveReference(index)).length,
      selectedIndex,
      showSimilarity: options.showSimilarity,
      showSequence: options.showSequence,
      showTrajectories: options.showTrajectories,
      autoRotate: options.autoRotate,
      autoRotateActive: options.autoRotate && !reducedMotionQuery.matches,
      yaw: view.yaw,
      pitch: view.pitch,
      distance: view.distance,
      renderWidth,
      renderHeight,
      drawCalls: renderer.info?.render?.calls ?? 0,
      triangles: renderer.info?.render?.triangles ?? 0,
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frameHandle) cancelFrame?.(frameHandle);
    frameHandle = 0;
    resizeObserver?.disconnect?.();
    windowObject.removeEventListener?.("resize", handleWindowResize);
    documentObject?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    reducedMotionQuery.removeEventListener?.("change", handleReducedMotionChange);
    reducedMotionQuery.removeListener?.(handleReducedMotionChange);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", finishPointer);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
    canvas.removeEventListener("wheel", handleWheel);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    for (const pointerId of activePointers.keys()) {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    }
    activePointers.clear();
    pointerGesture = null;
    canvas.removeAttribute("data-nightingale-dragging");
    canvas.style.touchAction = previousTouchAction;
    clearAnalysisObjects();
    grid.geometry?.dispose?.();
    grid.material?.dispose?.();
    renderer.dispose();
    canvas.dataset.nightingaleRenderer = "disposed";
  }

  const handlePointerCancel = (event) => finishPointer(event, true);
  const handleLostPointerCapture = (event) => finishPointer(event, true);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", handleContextLost);
  canvas.addEventListener("webglcontextrestored", handleContextRestored);
  documentObject?.addEventListener?.("visibilitychange", handleVisibilityChange);
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else {
    reducedMotionQuery.addListener?.(handleReducedMotionChange);
  }
  const ResizeObserverConstructor = windowObject.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof ResizeObserverConstructor === "function") {
    resizeObserver = new ResizeObserverConstructor(handleWindowResize);
    resizeObserver.observe(canvas);
  } else {
    windowObject.addEventListener?.("resize", handleWindowResize);
  }

  canvas.dataset.nightingaleRenderer = "webgl";
  updateCamera();
  resize();
  renderer.render(scene, camera);

  return Object.freeze({
    setAnalysis,
    setSelected,
    setRoute,
    setOptions,
    resetView,
    snapshot,
    dispose,
  });
}
