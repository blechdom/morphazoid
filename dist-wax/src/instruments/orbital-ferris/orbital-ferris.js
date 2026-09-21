const TAU = Math.PI * 2;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;

export const ORBITAL_FERRIS_MAX_LEVELS = 5;
export const ORBITAL_FERRIS_MAX_LEAVES = 128;
export const ORBITAL_FERRIS_LEVEL_SHAPES = Object.freeze([
  "circle",
  "triangle",
  "square",
  "line",
  "star",
]);
export const ORBITAL_FERRIS_GESTURE_SHAPES = Object.freeze([
  "circle",
  "triangle",
  "square",
  "star",
]);
export const ORBITAL_FERRIS_PROCESSORS = Object.freeze([
  "pass",
  "modulator",
  "delay",
]);

const ORBITAL_FERRIS_SHAPE_VERTICES = Object.freeze({
  triangle: Object.freeze([
    Object.freeze({ x: 0, y: -1 }),
    Object.freeze({ x: Math.sqrt(3) / 2, y: 0.5 }),
    Object.freeze({ x: -Math.sqrt(3) / 2, y: 0.5 }),
  ]),
  square: Object.freeze([
    Object.freeze({ x: -1, y: -1 }),
    Object.freeze({ x: 1, y: -1 }),
    Object.freeze({ x: 1, y: 1 }),
    Object.freeze({ x: -1, y: 1 }),
  ]),
  star: Object.freeze(Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? 1 : 0.43;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    return Object.freeze({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  })),
});

export const ORBITAL_FERRIS_DEFAULTS = Object.freeze({
  gestures: 1,
  levels: 3,
  outerRate: 0.1,
  ratio: 3,
  pitchSpan: 4,
  zoom: 0,
  tone: 110,
  gestureSeconds: 4,
  gestureMode: "loop",
  playing: false,
  levelEnabled: Object.freeze([true, true, true, true, true]),
  levelShapes: Object.freeze(["circle", "triangle", "square", "line", "star"]),
  levelProcessors: Object.freeze(["voice", "modulator", "delay", "pass", "pass"]),
});

function safeOrbitalFerrisShape(shape) {
  return ORBITAL_FERRIS_LEVEL_SHAPES.includes(shape) ? shape : "circle";
}

function safeOrbitalFerrisGestureShape(shape) {
  return ORBITAL_FERRIS_GESTURE_SHAPES.includes(shape) ? shape : "circle";
}

function samplePolygon(vertices, progress) {
  const wrapped = positiveModulo(Number(progress) || 0, 1);
  const scaled = wrapped * vertices.length;
  const index = Math.floor(scaled) % vertices.length;
  const amount = scaled - Math.floor(scaled);
  const start = vertices[index];
  const end = vertices[(index + 1) % vertices.length];
  return Object.freeze({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
}

export function orbitalFerrisShapeSample(shape, progress) {
  const safeShape = safeOrbitalFerrisShape(shape);
  if (safeShape === "circle") {
    const angle = positiveModulo(Number(progress) || 0, 1) * TAU;
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
  }
  if (safeShape === "line") {
    const amount = clamp(Number(progress) || 0, 0, 1);
    return Object.freeze({ x: amount * 2 - 1, y: 0 });
  }
  return samplePolygon(ORBITAL_FERRIS_SHAPE_VERTICES[safeShape], progress);
}

export function orbitalFerrisOrbitSample(shape, progress) {
  const safeShape = safeOrbitalFerrisShape(shape);
  if (safeShape !== "line") return orbitalFerrisShapeSample(safeShape, progress);
  const cycle = positiveModulo(Number(progress) || 0, 1);
  const amount = cycle <= 0.5 ? cycle * 2 : (1 - cycle) * 2;
  return orbitalFerrisShapeSample("line", amount);
}

export function orbitalFerrisLeafCount(
  gestures,
  levels,
  maximum = ORBITAL_FERRIS_MAX_LEAVES,
) {
  const safeGestures = clamp(Math.round(Number(gestures) || 1), 1, 6);
  const safeLevels = clamp(Math.round(Number(levels) || 1), 1, ORBITAL_FERRIS_MAX_LEVELS);
  return Math.min(maximum, safeGestures ** Math.max(0, safeLevels - 1));
}

export function orbitalFerrisLevelRate(baseRate, ratio, levels, level) {
  const safeLevels = clamp(Math.round(Number(levels) || 1), 1, ORBITAL_FERRIS_MAX_LEVELS);
  if (safeLevels < 2) return 0;
  const safeLevel = clamp(Math.round(Number(level) || 2), 2, safeLevels);
  const safeRate = Math.max(0, Number(baseRate) || 0);
  const safeRatio = Math.max(1, Number(ratio) || 1);
  return safeRate * safeRatio ** (safeLevels - safeLevel);
}

export function orbitalFerrisContourProgress(distance, mode = "loop") {
  const safeDistance = Number.isFinite(distance) ? distance : 0;
  if (mode === "bounce") {
    const cycle = positiveModulo(safeDistance, 2);
    return cycle <= 1 ? cycle : 2 - cycle;
  }
  return positiveModulo(safeDistance, 1);
}

export function orbitalFerrisContourSample(
  distance,
  mode = "loop",
  offset = 0,
  shape = "circle",
) {
  const position = (Number.isFinite(distance) ? distance : 0)
    + (Number.isFinite(offset) ? offset : 0);
  const progress = orbitalFerrisContourProgress(position, mode);
  const bounceCycle = positiveModulo(position, 2);
  const direction = mode === "bounce" && bounceCycle > 1 ? -1 : 1;
  const safeShape = safeOrbitalFerrisGestureShape(shape);
  const angle = -Math.PI / 2 + progress * TAU;
  const point = safeShape === "circle"
    ? { x: Math.cos(angle), y: Math.sin(angle) }
    : orbitalFerrisShapeSample(safeShape, progress);
  return Object.freeze({
    progress,
    direction,
    angle,
    x: point.x,
    y: point.y,
  });
}

export function orbitalFerrisScene({
  gestures,
  levels,
  ratio,
  levelPhases,
  levelEnabled,
  levelShapes,
  gestureTravel,
  gestureMode,
  maximum = ORBITAL_FERRIS_MAX_LEAVES,
}) {
  const safeGestures = clamp(Math.round(Number(gestures) || 1), 1, 6);
  const safeLevels = clamp(
    Math.round(Number(levels) || 1),
    1,
    ORBITAL_FERRIS_MAX_LEVELS,
  );
  const carrierLevels = safeLevels - 1;
  const safeRatio = Math.max(1.01, Number(ratio) || 1.01);
  const leafTarget = orbitalFerrisLeafCount(safeGestures, safeLevels, maximum);
  const innerRadius = carrierLevels > 0
    ? 1 / safeRatio ** Math.max(0, safeLevels - 2)
    : 1;
  const gestureRadius = innerRadius * 0.44;
  const safeGestureShape = safeOrbitalFerrisGestureShape(levelShapes?.[0]);
  const gestureExtent = safeGestureShape === "square" ? Math.sqrt(2) : 1;
  let extent = gestureRadius * gestureExtent;
  for (let level = 2; level <= safeLevels; level += 1) {
    const shape = safeOrbitalFerrisShape(levelShapes?.[level - 1]);
    const shapeExtent = shape === "square" ? Math.sqrt(2) : 1;
    extent += shapeExtent / safeRatio ** (safeLevels - level);
  }

  const rings = [];
  const spokes = [];
  const leafGestures = [];
  let leafIndex = 0;

  const normalizePoint = (x, y) => ({ x: x / extent, y: y / extent });

  function addLeaf(nodeX, nodeY, ancestors) {
    if (leafIndex >= leafTarget) return;
    const index = leafIndex;
    leafIndex += 1;
    const node = normalizePoint(nodeX, nodeY);
    const sample = orbitalFerrisContourSample(
      gestureTravel,
      gestureMode,
      index / Math.max(1, leafTarget),
      safeGestureShape,
    );
    const playhead = normalizePoint(
      nodeX + sample.x * gestureRadius,
      nodeY + sample.y * gestureRadius,
    );
    leafGestures.push(Object.freeze({
      index,
      level: 1,
      enabled: Boolean(levelEnabled?.[0]),
      x: node.x,
      y: node.y,
      radius: gestureRadius / extent,
      shape: safeGestureShape,
      playheadX: playhead.x,
      playheadY: playhead.y,
      sample,
      ancestors: Object.freeze(ancestors),
    }));
  }

  function visit(centerX, centerY, level, ancestors) {
    if (leafIndex >= leafTarget) return;
    const radius = 1 / safeRatio ** (safeLevels - level);
    const phase = positiveModulo(Number(levelPhases?.[level - 2]) || 0, 1);
    const enabled = Boolean(levelEnabled?.[level - 1]);
    const shape = safeOrbitalFerrisShape(levelShapes?.[level - 1]);
    const center = normalizePoint(centerX, centerY);
    rings.push(Object.freeze({
      ...center,
      radius: radius / extent,
      level,
      enabled,
      shape,
    }));

    for (let gesture = 0; gesture < safeGestures; gesture += 1) {
      if (leafIndex >= leafTarget) break;
      const pathProgress = phase + gesture / safeGestures;
      const pathPoint = orbitalFerrisOrbitSample(shape, pathProgress);
      const nodeX = centerX + pathPoint.x * radius;
      const nodeY = centerY + pathPoint.y * radius;
      const node = normalizePoint(nodeX, nodeY);
      const nextAncestors = [...ancestors, Object.freeze({
        level,
        shape,
        localX: pathPoint.x,
        localY: pathPoint.y,
        x: node.x,
        y: node.y,
      })];
      spokes.push(Object.freeze({
        x1: center.x,
        y1: center.y,
        x2: node.x,
        y2: node.y,
        level,
        enabled,
      }));

      if (level > 2) {
        visit(nodeX, nodeY, level - 1, nextAncestors);
        continue;
      }
      addLeaf(nodeX, nodeY, nextAncestors);
    }
  }

  if (carrierLevels > 0) visit(0, 0, safeLevels, []);
  else addLeaf(0, 0, []);
  return Object.freeze({
    extent,
    rings: Object.freeze(rings),
    spokes: Object.freeze(spokes),
    gestures: Object.freeze(leafGestures),
  });
}

export function orbitalFerrisVoiceModulation(
  gesture,
  levelProcessors,
  levelEnabled,
) {
  let gain = 1;
  for (const ancestor of gesture?.ancestors ?? []) {
    if (!levelEnabled?.[ancestor.level - 1]) continue;
    if (levelProcessors?.[ancestor.level - 1] !== "modulator") continue;
    const inheritedHeight = clamp((1 - ancestor.y) / 2, 0, 1);
    gain *= 0.52 + inheritedHeight * 0.48;
  }
  return clamp(gain, 0.12, 1);
}

export function orbitalFerrisDelayForScene(
  scene,
  levelProcessors,
  levelEnabled,
) {
  const positions = [];
  for (const gesture of scene?.gestures ?? []) {
    for (const ancestor of gesture.ancestors ?? []) {
      if (!levelEnabled?.[ancestor.level - 1]) continue;
      if (levelProcessors?.[ancestor.level - 1] !== "delay") continue;
      positions.push(ancestor);
    }
  }
  if (!positions.length) {
    return Object.freeze({ delayTime: 0.18, feedback: 0, wet: 0 });
  }
  const averageX = positions.reduce((total, position) => total + position.x, 0)
    / positions.length;
  const averageY = positions.reduce((total, position) => total + position.y, 0)
    / positions.length;
  const inheritedX = clamp((averageX + 1) / 2, 0, 1);
  const inheritedY = clamp((averageY + 1) / 2, 0, 1);
  return Object.freeze({
    delayTime: 0.07 + inheritedX * 0.43,
    feedback: 0.15 + (1 - inheritedY) * 0.4,
    wet: 0.3,
  });
}

export function orbitalFerrisPitchAtY(y, centerFrequency, spanOctaves) {
  const position = clamp(Number(y) || 0, -1, 1);
  const center = clamp(Number(centerFrequency) || 110, 18, 16_000);
  const span = clamp(Number(spanOctaves) || 0, 0, 8);
  return clamp(center * 2 ** (-position * span / 2), 18, 16_000);
}

export function advanceOrbitalFerrisMotion({
  dt,
  levelPhases,
  levelEnabled,
  levels,
  outerRate,
  ratio,
  rotationPlaying,
  gestureTravel,
  gestureSeconds,
  gesturePlaying,
}) {
  const seconds = clamp(Number(dt) || 0, 0, 0.1);
  const safeLevels = clamp(Math.round(Number(levels) || 1), 1, ORBITAL_FERRIS_MAX_LEVELS);
  const nextLevelPhases = Array.from(
    { length: ORBITAL_FERRIS_MAX_LEVELS - 1 },
    (_, index) => positiveModulo(Number(levelPhases?.[index]) || 0, 1),
  );

  if (rotationPlaying) {
    for (let level = 2; level <= safeLevels; level += 1) {
      if (!levelEnabled?.[level - 1]) continue;
      nextLevelPhases[level - 2] = positiveModulo(
        nextLevelPhases[level - 2]
          + seconds * orbitalFerrisLevelRate(outerRate, ratio, safeLevels, level),
        1,
      );
    }
  }

  const safeTravel = Number(gestureTravel) || 0;
  const travelSeconds = Math.max(0.1, Number(gestureSeconds) || 0.1);
  return Object.freeze({
    levelPhases: Object.freeze(nextLevelPhases),
    gestureTravel: gesturePlaying ? safeTravel + seconds / travelSeconds : safeTravel,
  });
}
