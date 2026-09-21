const TAU = Math.PI * 2;
const EPSILON = 1e-9;

const freezePalette = (id, label, background, ink, colors) => Object.freeze({
  id,
  label,
  background,
  ink,
  colors: Object.freeze(colors),
});

export const ESCHER_TESSELLATION_PALETTES = Object.freeze([
  freezePalette("woodcut", "Woodcut", "#090a09", "#f4ead0", [
    "#f4ead0", "#171817", "#c88a54", "#66766d", "#a8473d", "#d4b56f",
  ]),
  freezePalette("day-night", "Day / night", "#080a0d", "#f4f0df", [
    "#f4f0df", "#11151b", "#7d94a0", "#d9a85d", "#4a5964", "#c95f4e",
  ]),
  freezePalette("mineral", "Mineral", "#07100f", "#e9e2c6", [
    "#65d8c2", "#e9e2c6", "#df8665", "#6e91c8", "#b79ad7", "#c7b45c",
  ]),
  freezePalette("alhambra", "Alhambra", "#100b09", "#f1d9ae", [
    "#d8844e", "#477c75", "#e3c27f", "#8e4b3f", "#46627d", "#efe1c6",
  ]),
]);

const preset = (configuration) => Object.freeze({
  model: "euclidean",
  palette: "woodcut",
  tilingType: null,
  edgeCurves: Object.freeze([]),
  parameters: null,
  colors: 3,
  intervals: Object.freeze([0, 5, 9, 12]),
  ...configuration,
  edgeCurves: Object.freeze(configuration.edgeCurves ?? []),
  parameters: configuration.parameters
    ? Object.freeze(configuration.parameters)
    : null,
  intervals: Object.freeze(configuration.intervals ?? [0, 5, 9, 12]),
  generators: Object.freeze(configuration.generators),
});

export const ESCHER_TESSELLATION_PRESETS = Object.freeze([
  preset({
    id: "counterform-current",
    label: "Counterform current",
    referenceWork: "Sky and Water I",
    referenceYear: "1938",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/escher-today/sky-and-water",
    surface: "Euclidean plane",
    symmetry: "translation + counterchange",
    generators: ["two translations", "shared figure / ground boundary"],
    orbit: "2 complementary motifs",
    description: "A vertical figure-ground exchange: one original current motif gains detail while its exact counterform recedes.",
    motif: "counterform",
    tilingType: 20,
    edgeCurves: [0.54, -0.34, 0.42],
    colors: 2,
    palette: "day-night",
    intervals: [0, 5, 10, 14],
  }),
  preset({
    id: "night-flight",
    label: "Night flight",
    referenceWork: "Day and Night",
    referenceYear: "1938",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/masterpieces/day-and-night",
    surface: "Euclidean plane",
    symmetry: "bilateral counterchange",
    generators: ["horizontal translation", "opposed half-turn fields"],
    orbit: "2 directions · 2 tones",
    description: "Opposed fields trade light and dark around a central flight path, using new pennant-like silhouettes.",
    motif: "night-flight",
    tilingType: 47,
    edgeCurves: [0.48, -0.38, 0.26],
    colors: 2,
    palette: "day-night",
    intervals: [0, 7, 12, 19],
  }),
  preset({
    id: "triple-orbit",
    label: "Triple orbit",
    referenceWork: "Reptiles",
    referenceYear: "1943 · after the 1939 study",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/masterpieces/reptiles",
    surface: "Euclidean plane",
    symmetry: "p3 · order-3 rotation",
    generators: ["a = (s, 0)", "b = (s/2, √3s/2)", "R³ = I"],
    orbit: "3 rotations · 3 colors",
    description: "Three original articulated reptile-like figures—with heads, tails, and four walking limbs—circulate around 120° centers without reflections.",
    motif: "triple",
    tilingType: 7,
    edgeCurves: [0.52, -0.46, 0.34],
    colors: 3,
    palette: "mineral",
    intervals: [0, 4, 8, 12],
  }),
  preset({
    id: "glide-parade",
    label: "Glide parade",
    referenceWork: "Horseman",
    referenceYear: "1946",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/escher-today/horseman?lang=en",
    surface: "Euclidean plane",
    symmetry: "pg · glide reflection",
    generators: ["G(x,y) = (x + w, −y)", "G² = translation by 2w"],
    orbit: "2 mirrored rows",
    description: "Alternating rows of original courier forms are reflected, shifted, and repeated by one glide generator.",
    motif: "glide",
    tilingType: 50,
    edgeCurves: [0.62, -0.28, 0.45],
    colors: 4,
    palette: "alhambra",
    intervals: [0, 2, 7, 9, 14],
  }),
  preset({
    id: "metamorphosis-band",
    label: "Metamorphosis band",
    referenceWork: "Metamorphosis II",
    referenceYear: "1939–1940",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/masterpieces/metamorphose-ii",
    surface: "Euclidean transition band",
    symmetry: "local periodicity · changing motif",
    generators: ["translation within each band", "P(u) = (1−u)A + uB"],
    orbit: "square → seed → current",
    description: "A horizontal chain moves from strict cells through seed-like forms into flowing counterforms.",
    motif: "metamorphosis",
    tilingType: 36,
    edgeCurves: [0.45, -0.5],
    colors: 6,
    palette: "woodcut",
    intervals: [0, 3, 7, 10, 14],
  }),
  preset({
    id: "inward-infinity",
    label: "Inward infinity",
    referenceWork: "Smaller and Smaller",
    referenceYear: "1956",
    referenceUrl: "https://escherinhetpaleis.nl/en/about-escher/escher-today/repeating-reptiles",
    surface: "Euclidean similarity recursion",
    symmetry: "S(z) = e^(iπ/4)z / √2",
    generators: ["45° rotation", "scale by 1/√2", "S²(z) = iz/2"],
    orbit: "4 sectors · infinite limit",
    description: "Alternating squares and diamonds recurse toward the center, carrying original bent-arrow motifs below pixel scale.",
    motif: "similarity",
    model: "similarity",
    colors: 4,
    palette: "alhambra",
    intervals: [0, 3, 6, 9, 12],
  }),
  preset({
    id: "hyperbolic-current",
    label: "Hyperbolic current",
    referenceWork: "Circle Limit III",
    referenceYear: "1959",
    referenceUrl: "https://www.ams.org/samplings/feature-column/fcarc-circle-limit",
    surface: "Poincaré disk",
    symmetry: "{8,3} · octagons, 3 per vertex",
    generators: ["π/2, π/8, π/3 triangle", "geodesic side reflections"],
    orbit: "octagonal reflection group",
    description: "A true {8,3} hyperbolic scaffold carries fresh comet forms that shrink toward the finite disk boundary.",
    motif: "hyperbolic-flow",
    model: "hyperbolic",
    p: 8,
    q: 3,
    colors: 4,
    palette: "mineral",
    intervals: [0, 3, 7, 10, 15],
  }),
  preset({
    id: "dual-horizon",
    label: "Dual horizon",
    referenceWork: "Circle Limit IV",
    referenceYear: "1960",
    referenceUrl: "https://escherinhetpaleis.nl/en/escher-today/circle-limit-iv-heaven-and-hell",
    surface: "Poincaré disk",
    symmetry: "{6,4} · hexagons, 4 per vertex",
    generators: ["π/2, π/6, π/4 triangle", "geodesic side reflections"],
    orbit: "light / dark BFS parity",
    description: "A true {6,4} reflection tiling alternates original flare and bloom counterforms toward infinity.",
    motif: "hyperbolic-dual",
    model: "hyperbolic",
    p: 6,
    q: 4,
    colors: 2,
    palette: "woodcut",
    intervals: [0, 6, 10, 13, 18],
  }),
]);

export const DEFAULT_ESCHER_TESSELLATION_PRESET = "counterform-current";

export function escherTessellationPreset(id) {
  return ESCHER_TESSELLATION_PRESETS.find((candidate) => candidate.id === id)
    ?? ESCHER_TESSELLATION_PRESETS[0];
}

export function escherTessellationPalette(id) {
  return ESCHER_TESSELLATION_PALETTES.find((candidate) => candidate.id === id)
    ?? ESCHER_TESSELLATION_PALETTES[0];
}

export function clampEscherValue(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const amount = clampEscherValue((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

export function rotateEscherPoint(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function glideEscherPoint(point, width = 1) {
  return { x: point.x + width, y: -point.y };
}

export function similarityEscherPoint(point, level = 1) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const scale = 2 ** (-safeLevel / 2);
  const rotated = rotateEscherPoint(point, safeLevel * Math.PI / 4);
  return { x: rotated.x * scale, y: rotated.y * scale };
}

export function createSimilarityOrbit(levels = 12) {
  const safeLevels = Math.max(1, Math.min(32, Math.floor(Number(levels) || 1)));
  return Object.freeze(Array.from({ length: safeLevels }, (_, level) => Object.freeze({
    level,
    scale: 2 ** (-level / 2),
    rotation: level * Math.PI / 4,
    innerScale: 2 ** (-(level + 1) / 2),
  })));
}

export function hyperbolicDistance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const numerator = 2 * (dx * dx + dy * dy);
  const firstDenominator = Math.max(EPSILON, 1 - first.x * first.x - first.y * first.y);
  const secondDenominator = Math.max(EPSILON, 1 - second.x * second.x - second.y * second.y);
  return Math.acosh(Math.max(1, 1 + numerator / (firstDenominator * secondDenominator)));
}

export function regularHyperbolicPolygon(p = 6, q = 4) {
  const sides = Math.max(3, Math.floor(Number(p) || 3));
  const aroundVertex = Math.max(3, Math.floor(Number(q) || 3));
  if ((sides - 2) * (aroundVertex - 2) <= 4) {
    throw new RangeError(`{${sides},${aroundVertex}} is not hyperbolic`);
  }
  const hyperbolicRadius = Math.acosh(
    (1 / Math.tan(Math.PI / sides)) * (1 / Math.tan(Math.PI / aroundVertex)),
  );
  const diskRadius = Math.tanh(hyperbolicRadius / 2);
  const offset = Math.PI / sides;
  return Object.freeze(Array.from({ length: sides }, (_, index) => Object.freeze({
    x: Math.cos(offset + index * TAU / sides) * diskRadius,
    y: Math.sin(offset + index * TAU / sides) * diskRadius,
  })));
}

function finitePoincarePoint(point) {
  const rawX = Number(point?.x);
  const rawY = Number(point?.y);
  const x = Number.isFinite(rawX) ? rawX : 0;
  const y = Number.isFinite(rawY) ? rawY : 0;
  const magnitude = Math.hypot(x, y);
  if (magnitude < 1) return { x, y };

  if (Number.isFinite(magnitude) && magnitude > 0) {
    const scale = (1 - EPSILON) / magnitude;
    return { x: x * scale, y: y * scale };
  }

  const largestComponent = Math.max(Math.abs(x), Math.abs(y), 1);
  const normalizedX = x / largestComponent;
  const normalizedY = y / largestComponent;
  const normalizedMagnitude = Math.hypot(normalizedX, normalizedY) || 1;
  const scale = (1 - EPSILON) / normalizedMagnitude;
  return { x: normalizedX * scale, y: normalizedY * scale };
}

/**
 * Sample the Poincare-disk geodesic between two points.
 *
 * The third argument is the number of line segments, so the returned frozen
 * array contains `segments + 1` points. Inputs outside the open unit disk are
 * projected just inside it, which keeps malformed interactive input finite.
 */
export function samplePoincareGeodesic(first, second, segments = 24) {
  const start = finitePoincarePoint(first);
  const end = finitePoincarePoint(second);
  const numericSegments = Number(segments);
  const safeSegments = Math.max(1, Math.min(
    2048,
    Number.isFinite(numericSegments) ? Math.floor(numericSegments) : 24,
  ));
  const determinant = start.x * end.y - start.y * end.x;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  let points;

  // Every geodesic through the origin is a Euclidean diameter. This branch
  // also avoids an ill-conditioned orthogonal circle for nearly radial pairs.
  if (distance < EPSILON || Math.abs(determinant) < EPSILON) {
    points = Array.from({ length: safeSegments + 1 }, (_, index) => {
      const amount = index / safeSegments;
      return {
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      };
    });
  } else {
    const startRight = (start.x * start.x + start.y * start.y + 1) / 2;
    const endRight = (end.x * end.x + end.y * end.y + 1) / 2;
    const center = {
      x: (startRight * end.y - start.y * endRight) / determinant,
      y: (start.x * endRight - startRight * end.x) / determinant,
    };
    const radiusSquared = center.x * center.x + center.y * center.y - 1;
    const radius = Math.sqrt(Math.max(0, radiusSquared));
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    const angleDelta = Math.atan2(
      Math.sin(endAngle - startAngle),
      Math.cos(endAngle - startAngle),
    );

    points = Array.from({ length: safeSegments + 1 }, (_, index) => {
      const angle = startAngle + angleDelta * index / safeSegments;
      return {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };
    });
  }

  // Preserve valid endpoints exactly instead of exposing trigonometric drift.
  points[0] = start;
  points[points.length - 1] = end;
  return Object.freeze(points.map((point) => Object.freeze(point)));
}

function geodesicReflection(first, second) {
  const firstRight = (first.x * first.x + first.y * first.y + 1) / 2;
  const secondRight = (second.x * second.x + second.y * second.y + 1) / 2;
  const determinant = first.x * second.y - first.y * second.x;
  if (Math.abs(determinant) < EPSILON) {
    const guide = Math.hypot(first.x, first.y) > EPSILON ? first : second;
    const angle = Math.atan2(guide.y, guide.x);
    return (point) => {
      const local = rotateEscherPoint(point, -angle);
      return rotateEscherPoint({ x: local.x, y: -local.y }, angle);
    };
  }
  const center = {
    x: (firstRight * second.y - first.y * secondRight) / determinant,
    y: (first.x * secondRight - firstRight * second.x) / determinant,
  };
  const radiusSquared = Math.max(EPSILON, center.x * center.x + center.y * center.y - 1);
  return (point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const scale = radiusSquared / Math.max(EPSILON, dx * dx + dy * dy);
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  };
}

function pointKey(point, precision = 100_000) {
  return `${Math.round(point.x * precision)},${Math.round(point.y * precision)}`;
}

export function reflectHyperbolicPoint(point, edgeStart, edgeEnd) {
  return geodesicReflection(edgeStart, edgeEnd)(point);
}

export function createHyperbolicTiling({
  p = 6,
  q = 4,
  layers = 4,
  maxTiles = 720,
} = {}) {
  const rootPoints = regularHyperbolicPolygon(p, q);
  const root = {
    id: "0",
    depth: 0,
    color: 0,
    center: { x: 0, y: 0 },
    points: rootPoints.map((point) => ({ ...point })),
  };
  const safeLayers = Math.max(0, Math.min(8, Math.floor(Number(layers) || 0)));
  const safeMaximum = Math.max(1, Math.min(4000, Math.floor(Number(maxTiles) || 1)));
  const tiles = [root];
  const queue = [root];
  const seen = new Set([pointKey(root.center)]);

  while (queue.length && tiles.length < safeMaximum) {
    const tile = queue.shift();
    if (tile.depth >= safeLayers) continue;
    for (let edgeIndex = 0; edgeIndex < tile.points.length; edgeIndex += 1) {
      const first = tile.points[edgeIndex];
      const second = tile.points[(edgeIndex + 1) % tile.points.length];
      const reflect = geodesicReflection(first, second);
      const center = reflect(tile.center);
      const radiusSquared = center.x * center.x + center.y * center.y;
      if (!Number.isFinite(radiusSquared) || radiusSquared >= 1 - 1e-10) continue;
      const key = pointKey(center);
      if (seen.has(key)) continue;
      seen.add(key);
      const next = {
        id: `${tile.id}.${edgeIndex}`,
        depth: tile.depth + 1,
        color: (tile.color + 1) % 2,
        center,
        points: tile.points.map(reflect),
      };
      tiles.push(next);
      queue.push(next);
      if (tiles.length >= safeMaximum) break;
    }
  }

  return Object.freeze(tiles.map((tile) => Object.freeze({
    ...tile,
    center: Object.freeze(tile.center),
    points: Object.freeze(tile.points.map((point) => Object.freeze(point))),
  })));
}

export function escherPresetFrequencies(presetId, baseFrequency = 82.5) {
  const current = escherTessellationPreset(presetId);
  const base = clampEscherValue(baseFrequency, 24, 880);
  return current.intervals.map((semitones) => base * 2 ** (semitones / 12));
}
