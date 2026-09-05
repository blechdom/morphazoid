import {
  createKarplusCarpetRandom,
  normalizeKarplusCarpetSamples,
} from "./karplus-carpet.js";
import {
  generateKarplusStrongSamples,
  sanitizeKarplusStrongSettings,
} from "./karplus-strong.js";
import {
  linearDrumFrequencyAtPosition,
  linearDrumKarplusStrongSettings,
} from "./linear-drums.js";
import { ouroborosWindow } from "./ouroboros.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (start, end, amount) => start + (end - start) * amount;
const wrap01 = (value) => ((value % 1) + 1) % 1;
const TAU = Math.PI * 2;

export const AUTOMATAPOEIA_FREQUENCY_MIN = 70;
export const AUTOMATAPOEIA_FREQUENCY_MAX = 6_400;
export const AUTOMATAPOEIA_DEFAULT_FAMILY = "elementary";
export const AUTOMATAPOEIA_DEFAULT_VOICE = "rattlesnake";
export const AUTOMATAPOEIA_DEFAULT_SONIFICATION_MODE = "row-events";
export const AUTOMATAPOEIA_DEFAULT_TRANSFORM = "none";
export const AUTOMATAPOEIA_DEFAULT_BOUNDARY = "fixed";
export const AUTOMATAPOEIA_DEFAULT_POLARITY = "one";
export const AUTOMATAPOEIA_DEFAULT_OBJECT_MODE = "runs";
export const AUTOMATAPOEIA_DEFAULT_PITCH_CURVE = "linear";
export const AUTOMATAPOEIA_DEFAULT_TIMBRE_SOURCE = "local-walls";
export const AUTOMATAPOEIA_DEFAULT_CONTOUR_SOURCE = "motion";
export const AUTOMATAPOEIA_DEFAULT_PHRASE_SHAPE = "bands";
export const AUTOMATAPOEIA_DEFAULT_ENVELOPE = Object.freeze({
  attack: 0.012,
  decay: 0.12,
  sustain: 0.72,
  release: 0.32,
});

export const AUTOMATAPOEIA_BOUNDARIES = Object.freeze([
  Object.freeze({ id: "fixed", label: "Fixed zero" }),
  Object.freeze({ id: "periodic", label: "Periodic wrap" }),
]);

export const AUTOMATAPOEIA_FAMILIES = Object.freeze([
  Object.freeze({ id: "elementary", label: "Elementary · radius 1", ruleCount: 256 }),
  Object.freeze({ id: "totalistic-r2", label: "Totalistic · radius 2", ruleCount: 64 }),
]);

export const AUTOMATAPOEIA_SONIFICATION_MODES = Object.freeze([
  Object.freeze({ id: "row-events", label: "Row events" }),
  Object.freeze({ id: "vertical-sine", label: "Vertical sine bank" }),
]);

export const AUTOMATAPOEIA_TRANSFORMS = Object.freeze([
  Object.freeze({ id: "none", label: "None" }),
  Object.freeze({ id: "shift-left", label: "Shift left" }),
  Object.freeze({ id: "shift-right", label: "Shift right" }),
  Object.freeze({ id: "reflect", label: "Reflect" }),
  Object.freeze({ id: "complement", label: "Complement" }),
]);

export const AUTOMATAPOEIA_POLARITIES = Object.freeze([
  Object.freeze({ id: "one", label: "Off-white · state 1", value: 1 }),
  Object.freeze({ id: "zero", label: "Black · state 0", value: 0 }),
]);

export const AUTOMATAPOEIA_OBJECT_MODES = Object.freeze([
  Object.freeze({ id: "runs", label: "Horizontal runs" }),
  Object.freeze({ id: "connected", label: "Down-connected forms" }),
]);

export const AUTOMATAPOEIA_PITCH_CURVES = Object.freeze([
  Object.freeze({ id: "linear", label: "Linear left → right" }),
  Object.freeze({ id: "early", label: "Early rise" }),
  Object.freeze({ id: "late", label: "Late rise" }),
  Object.freeze({ id: "smooth", label: "Smooth S-curve" }),
  Object.freeze({ id: "reverse", label: "Reverse right → left" }),
]);

export const AUTOMATAPOEIA_TIMBRE_SOURCES = Object.freeze([
  Object.freeze({ id: "run-length", label: "Live-run length" }),
  Object.freeze({ id: "local-walls", label: "Local domain walls" }),
  Object.freeze({ id: "row-density", label: "Row density" }),
  Object.freeze({ id: "row-walls", label: "Row domain walls" }),
  Object.freeze({ id: "activity", label: "Generation activity" }),
  Object.freeze({ id: "persistence", label: "Vertical persistence" }),
  Object.freeze({ id: "expansion", label: "Run expansion" }),
  Object.freeze({ id: "edge-flux", label: "Edge flux" }),
  Object.freeze({ id: "symmetry", label: "Mirror symmetry" }),
]);

export const AUTOMATAPOEIA_CONTOUR_SOURCES = Object.freeze([
  Object.freeze({ id: "motion", label: "Run motion" }),
  Object.freeze({ id: "expansion", label: "Run expansion" }),
  Object.freeze({ id: "edge-flux", label: "Edge flux" }),
  Object.freeze({ id: "persistence", label: "Vertical persistence" }),
  Object.freeze({ id: "birth-death", label: "Birth–death balance" }),
]);

export const AUTOMATAPOEIA_PHRASE_SHAPES = Object.freeze([
  Object.freeze({ id: "bands", label: "Object spans" }),
  Object.freeze({ id: "centers", label: "Object centers" }),
]);

export const AUTOMATAPOEIA_VOICES = Object.freeze([
  Object.freeze({
    id: "rattlesnake",
    label: "Rattlesnake × Carpet",
    caption: "rattlesnake morphs through a karplus carpet",
  }),
  Object.freeze({
    id: "karplus-carpet",
    label: "Karplus Carpet",
    caption: "short physical strings trace each live run",
  }),
  Object.freeze({
    id: "ouroboros",
    label: "Ouroboros Coil",
    caption: "octave-crossfaded strings keep eating their tails",
  }),
  Object.freeze({
    id: "modal-fm",
    label: "Modal-FM Strike",
    caption: "inharmonic modes bend under cellular pressure",
  }),
  Object.freeze({
    id: "cascade-pm",
    label: "Cascading PM",
    caption: "three bounded phase operators articulate each run",
  }),
  Object.freeze({
    id: "glass-lattice",
    label: "Glass Lattice",
    caption: "inharmonic additive modes reveal symmetry and spread",
  }),
  Object.freeze({
    id: "wavefold-ribbon",
    label: "Wavefold Ribbon",
    caption: "a folded oscillator follows cellular edge motion",
  }),
  Object.freeze({
    id: "formant-dust",
    label: "Formant Dust",
    caption: "seeded air excites two finite cellular resonances",
  }),
]);

const FAMILY_BY_ID = new Map(AUTOMATAPOEIA_FAMILIES.map((family) => [family.id, family]));
const VOICE_BY_ID = new Map(AUTOMATAPOEIA_VOICES.map((voice) => [voice.id, voice]));
const BOUNDARY_BY_ID = new Map(AUTOMATAPOEIA_BOUNDARIES.map((boundary) => [boundary.id, boundary]));
const SONIFICATION_MODE_BY_ID = new Map(
  AUTOMATAPOEIA_SONIFICATION_MODES.map((mode) => [mode.id, mode]),
);
const TRANSFORM_BY_ID = new Map(AUTOMATAPOEIA_TRANSFORMS.map((transform) => [transform.id, transform]));
const POLARITY_BY_ID = new Map(AUTOMATAPOEIA_POLARITIES.map((polarity) => [polarity.id, polarity]));
const OBJECT_MODE_BY_ID = new Map(AUTOMATAPOEIA_OBJECT_MODES.map((mode) => [mode.id, mode]));
const PITCH_CURVE_BY_ID = new Map(AUTOMATAPOEIA_PITCH_CURVES.map((curve) => [curve.id, curve]));
const TIMBRE_SOURCE_BY_ID = new Map(AUTOMATAPOEIA_TIMBRE_SOURCES.map((source) => [source.id, source]));
const CONTOUR_SOURCE_BY_ID = new Map(AUTOMATAPOEIA_CONTOUR_SOURCES.map((source) => [source.id, source]));
const PHRASE_SHAPE_BY_ID = new Map(AUTOMATAPOEIA_PHRASE_SHAPES.map((shape) => [shape.id, shape]));

export function sanitizeAutomatapoeiaFamily(value) {
  return FAMILY_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_FAMILY;
}

export function automatapoeiaFamilyLabel(value) {
  return FAMILY_BY_ID.get(sanitizeAutomatapoeiaFamily(value)).label;
}

export function sanitizeAutomatapoeiaBoundary(value) {
  return BOUNDARY_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_BOUNDARY;
}

export function automatapoeiaBoundaryLabel(value) {
  return BOUNDARY_BY_ID.get(sanitizeAutomatapoeiaBoundary(value)).label;
}

export function sanitizeAutomatapoeiaSonificationMode(value) {
  return SONIFICATION_MODE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_SONIFICATION_MODE;
}

export function automatapoeiaSonificationModeLabel(value) {
  return SONIFICATION_MODE_BY_ID.get(sanitizeAutomatapoeiaSonificationMode(value)).label;
}

export function sanitizeAutomatapoeiaTransform(value) {
  return TRANSFORM_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_TRANSFORM;
}

export function automatapoeiaTransformLabel(value) {
  return TRANSFORM_BY_ID.get(sanitizeAutomatapoeiaTransform(value)).label;
}

export function sanitizeAutomatapoeiaPolarity(value) {
  return POLARITY_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_POLARITY;
}

export function automatapoeiaPolarityLabel(value) {
  return POLARITY_BY_ID.get(sanitizeAutomatapoeiaPolarity(value)).label;
}

export function sanitizeAutomatapoeiaObjectMode(value) {
  return OBJECT_MODE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_OBJECT_MODE;
}

export function automatapoeiaObjectModeLabel(value) {
  return OBJECT_MODE_BY_ID.get(sanitizeAutomatapoeiaObjectMode(value)).label;
}

export function automatapoeiaRuleBits(rule, family = AUTOMATAPOEIA_DEFAULT_FAMILY) {
  const totalistic = sanitizeAutomatapoeiaFamily(family) === "totalistic-r2";
  const safeRule = Math.round(clamp(finiteOr(rule, 0), 0, totalistic ? 63 : 255));
  return safeRule.toString(2).padStart(totalistic ? 6 : 8, "0");
}

export function automatapoeiaTotalisticRuleBits(code) {
  return automatapoeiaRuleBits(code, "totalistic-r2");
}

function reverseNeighborhood(neighborhood) {
  return ((neighborhood & 1) << 2) | (neighborhood & 2) | ((neighborhood & 4) >> 2);
}

export function automatapoeiaReflectRule(rule) {
  const safeRule = Math.round(clamp(finiteOr(rule, 0), 0, 255));
  let reflected = 0;
  for (let neighborhood = 0; neighborhood < 8; neighborhood += 1) {
    reflected |= ((safeRule >> reverseNeighborhood(neighborhood)) & 1) << neighborhood;
  }
  return reflected;
}

export function automatapoeiaConjugateRule(rule) {
  const safeRule = Math.round(clamp(finiteOr(rule, 0), 0, 255));
  let conjugate = 0;
  for (let neighborhood = 0; neighborhood < 8; neighborhood += 1) {
    conjugate |= (1 - ((safeRule >> (7 - neighborhood)) & 1)) << neighborhood;
  }
  return conjugate;
}

export function automatapoeiaRuleOrbit(rule) {
  const safeRule = Math.round(clamp(finiteOr(rule, 0), 0, 255));
  return Object.freeze([...new Set([
    safeRule,
    automatapoeiaReflectRule(safeRule),
    automatapoeiaConjugateRule(safeRule),
    automatapoeiaReflectRule(automatapoeiaConjugateRule(safeRule)),
  ])].sort((left, right) => left - right));
}

export function automatapoeiaTotalisticConjugateRule(code) {
  const safeCode = Math.round(clamp(finiteOr(code, 0), 0, 63));
  let conjugate = 0;
  for (let total = 0; total <= 5; total += 1) {
    conjugate |= (1 - ((safeCode >> (5 - total)) & 1)) << total;
  }
  return conjugate;
}

export function automatapoeiaTotalisticRuleOrbit(code) {
  const safeCode = Math.round(clamp(finiteOr(code, 0), 0, 63));
  return Object.freeze([...new Set([
    safeCode,
    automatapoeiaTotalisticConjugateRule(safeCode),
  ])].sort((left, right) => left - right));
}

export function automatapoeiaCellAt(cells = [], index = 0, boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY) {
  if (!cells.length) return 0;
  const safeIndex = Math.trunc(finiteOr(index, 0));
  if (sanitizeAutomatapoeiaBoundary(boundary) === "periodic") {
    const wrappedIndex = ((safeIndex % cells.length) + cells.length) % cells.length;
    return cells[wrappedIndex] ? 1 : 0;
  }
  return safeIndex >= 0 && safeIndex < cells.length && cells[safeIndex] ? 1 : 0;
}

export function automatapoeiaTotalisticNextRow(
  cells = [],
  code = 20,
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
) {
  const safeCode = Math.round(clamp(finiteOr(code, 20), 0, 63));
  if (!cells.length) return [];
  return cells.map((_, index) => {
    let total = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      total += automatapoeiaCellAt(cells, index + offset, boundary);
    }
    return (safeCode >> total) & 1;
  });
}

export function automatapoeiaNextRow(
  cells = [],
  rule = 30,
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
  family = AUTOMATAPOEIA_DEFAULT_FAMILY,
) {
  if (sanitizeAutomatapoeiaFamily(family) === "totalistic-r2") {
    return automatapoeiaTotalisticNextRow(cells, rule, boundary);
  }
  const safeRule = Math.round(clamp(finiteOr(rule, 30), 0, 255));
  const length = cells.length;
  if (!length) return [];
  const periodic = sanitizeAutomatapoeiaBoundary(boundary) === "periodic";
  const next = new Array(length);
  let left = periodic && cells[length - 1] ? 1 : 0;
  let center = cells[0] ? 1 : 0;
  for (let index = 0; index < length; index += 1) {
    const right = index + 1 < length
      ? (cells[index + 1] ? 1 : 0)
      : (periodic && cells[0] ? 1 : 0);
    const neighborhood = (left << 2) | (center << 1) | right;
    next[index] = (safeRule >> neighborhood) & 1;
    left = center;
    center = right;
  }
  return next;
}

export function automatapoeiaResizeRow(cells = [], width = cells?.length ?? 0) {
  const source = Array.from(cells ?? [], (cell) => (cell ? 1 : 0));
  const targetWidth = Math.max(0, Math.trunc(finiteOr(width, source.length)));
  const resized = new Array(targetWidth).fill(0);
  const copyLength = Math.min(source.length, targetWidth);
  const sourceStart = Math.max(0, Math.floor((source.length - targetWidth) / 2));
  const targetStart = Math.max(0, Math.floor((targetWidth - source.length) / 2));
  for (let offset = 0; offset < copyLength; offset += 1) {
    resized[targetStart + offset] = source[sourceStart + offset];
  }
  return resized;
}

export function automatapoeiaTransformRow(
  cells = [],
  transform = AUTOMATAPOEIA_DEFAULT_TRANSFORM,
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
) {
  const row = Array.from(cells ?? [], (cell) => (cell ? 1 : 0));
  if (!row.length) return row;
  switch (sanitizeAutomatapoeiaTransform(transform)) {
    case "shift-left":
      return [...row.slice(1), sanitizeAutomatapoeiaBoundary(boundary) === "periodic" ? row[0] : 0];
    case "shift-right":
      return [sanitizeAutomatapoeiaBoundary(boundary) === "periodic" ? row.at(-1) : 0, ...row.slice(0, -1)];
    case "reflect":
      return row.reverse();
    case "complement":
      return row.map((cell) => 1 - cell);
    default:
      return row;
  }
}

function automatapoeiaLatticeKey(index, width) {
  return index * 2 - width + 1;
}

export function automatapoeiaColumnTransitions(previousCells = [], currentCells = [], options = {}) {
  const previous = Array.from(previousCells ?? [], (cell) => (cell ? 1 : 0));
  const current = Array.from(currentCells ?? [], (cell) => (cell ? 1 : 0));
  const polarity = sanitizeAutomatapoeiaPolarity(options.polarity);
  const selectedValue = POLARITY_BY_ID.get(polarity).value;
  const previousByKey = new Map();
  const currentByKey = new Map();
  previous.forEach((cell, index) => {
    if (cell === selectedValue) previousByKey.set(automatapoeiaLatticeKey(index, previous.length), index);
  });
  current.forEach((cell, index) => {
    if (cell === selectedValue) currentByKey.set(automatapoeiaLatticeKey(index, current.length), index);
  });

  const attacks = [];
  const holds = [];
  const releases = [];
  const transition = (key, previousIndex, currentIndex) => Object.freeze({
    currentIndex,
    index: currentIndex ?? previousIndex,
    key,
    previousIndex,
  });
  const keys = [...new Set([...previousByKey.keys(), ...currentByKey.keys()])]
    .sort((left, right) => left - right);
  for (const key of keys) {
    const previousIndex = previousByKey.get(key) ?? null;
    const currentIndex = currentByKey.get(key) ?? null;
    const event = transition(key, previousIndex, currentIndex);
    if (previousIndex === null) attacks.push(event);
    else if (currentIndex === null) releases.push(event);
    else holds.push(event);
  }
  const active = [...attacks, ...holds].sort((left, right) => left.key - right.key);
  return Object.freeze({
    active: Object.freeze(active),
    attacks: Object.freeze(attacks),
    currentWidth: current.length,
    holds: Object.freeze(holds),
    polarity,
    previousWidth: previous.length,
    releases: Object.freeze(releases),
  });
}

export function automatapoeiaRowStats(
  cells = [],
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
) {
  if (!cells.length) return Object.freeze({ density: 0, transitions: 0 });
  const periodic = sanitizeAutomatapoeiaBoundary(boundary) === "periodic";
  let live = 0;
  let transitions = 0;
  if (periodic) {
    let previous = cells[0] ? 1 : 0;
    live += previous;
    for (let index = 1; index < cells.length; index += 1) {
      const cell = cells[index] ? 1 : 0;
      live += cell;
      if (cell !== previous) transitions += 1;
      previous = cell;
    }
    if (previous !== (cells[0] ? 1 : 0)) transitions += 1;
  } else {
    let previous = 0;
    for (const value of cells) {
      const cell = value ? 1 : 0;
      live += cell;
      if (cell !== previous) transitions += 1;
      previous = cell;
    }
    if (previous !== 0) transitions += 1;
  }
  return Object.freeze({ density: live / cells.length, transitions });
}

export const AUTOMATAPOEIA_RULES = Object.freeze(Array.from({ length: 256 }, (_, rule) => {
  const orbit = automatapoeiaRuleOrbit(rule);
  return Object.freeze({
    rule,
    bits: automatapoeiaRuleBits(rule),
    reflection: automatapoeiaReflectRule(rule),
    conjugate: automatapoeiaConjugateRule(rule),
    orbit,
    representative: orbit[0],
    symmetric: automatapoeiaReflectRule(rule) === rule,
    quiescentZero: (rule & 1) === 0,
    quiescentOne: ((rule >> 7) & 1) === 1,
  });
}));

export const AUTOMATAPOEIA_TOTALISTIC_RULES = Object.freeze(Array.from({ length: 64 }, (_, code) => {
  const orbit = automatapoeiaTotalisticRuleOrbit(code);
  const activeTotals = Object.freeze(Array.from({ length: 6 }, (_, total) => total)
    .filter((total) => (code >> total) & 1));
  return Object.freeze({
    activeTotals,
    bits: automatapoeiaTotalisticRuleBits(code),
    code,
    conjugate: automatapoeiaTotalisticConjugateRule(code),
    orbit,
    quiescentOne: ((code >> 5) & 1) === 1,
    quiescentZero: (code & 1) === 0,
    reflection: code,
    representative: orbit[0],
    rule: code,
    symmetric: true,
  });
}));

export function automatapoeiaPreviewRows(rule, options = {}) {
  const family = sanitizeAutomatapoeiaFamily(options.family);
  const width = Math.round(clamp(finiteOr(options.width, 31), 9, 127));
  const height = Math.round(clamp(finiteOr(options.height, 18), 2, 96));
  let seed = Math.trunc(finiteOr(options.seed, 0x9e3779b9)) >>> 0;
  let row = Array.from({ length: width }, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 31) & 1;
  });
  const rows = [Object.freeze(row)];
  for (let index = 1; index < height; index += 1) {
    row = automatapoeiaNextRow(row, rule, "periodic", family);
    rows.push(Object.freeze(row));
  }
  return Object.freeze(rows);
}

export function automatapoeiaRowsPath(rows = []) {
  const commands = [];
  rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x += 1) {
      if (row[x] && start < 0) start = x;
      if ((!row[x] || x === row.length) && start >= 0) {
        const length = x - start;
        commands.push(`M${start} ${y}h${length}v1h-${length}z`);
        start = -1;
      }
    }
  });
  return commands.join("");
}

export function writeAutomatapoeiaRaster(rows, startRow, rowCount, target, targetWidth) {
  const safeStartRow = Math.max(0, Math.min(Math.trunc(startRow) || 0, rows?.length ?? 0));
  const count = Math.max(0, Math.min(Math.trunc(rowCount) || 0, (rows?.length ?? 0) - safeStartRow));
  const selectedRows = Array.from({ length: count }, (_, offset) => rows[safeStartRow + offset] ?? []);
  const inferredWidth = selectedRows.reduce((maximum, row) => Math.max(maximum, row?.length ?? 0), 0);
  const requestedWidth = typeof targetWidth === "object" && targetWidth !== null
    ? targetWidth.width ?? targetWidth.targetWidth
    : targetWidth;
  const width = requestedWidth === undefined
    ? inferredWidth
    : Math.max(0, Math.trunc(finiteOr(requestedWidth, inferredWidth)));
  const requiredLength = width * count * 4;
  if (!(target instanceof Uint8ClampedArray) || target.length !== requiredLength) {
    throw new TypeError(`Automatapoeia raster target must contain ${requiredLength} RGBA bytes.`);
  }
  target.fill(0);
  for (let rowOffset = 0; rowOffset < count; rowOffset += 1) {
    const row = selectedRows[rowOffset];
    const copyLength = Math.min(row.length, width);
    const sourceStart = Math.max(0, Math.floor((row.length - width) / 2));
    const targetStart = Math.max(0, Math.floor((width - row.length) / 2));
    for (let offset = 0; offset < copyLength; offset += 1) {
      if (!row[sourceStart + offset]) continue;
      const pixel = (rowOffset * width + targetStart + offset) * 4;
      target[pixel] = 219;
      target[pixel + 1] = 228;
      target[pixel + 2] = 224;
      target[pixel + 3] = 240;
    }
  }
  return target;
}

export function sanitizeAutomatapoeiaVoice(value) {
  return VOICE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_VOICE;
}

export function sanitizeAutomatapoeiaPitchCurve(value) {
  return PITCH_CURVE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_PITCH_CURVE;
}

export function automatapoeiaPitchCurveLabel(value) {
  return PITCH_CURVE_BY_ID.get(sanitizeAutomatapoeiaPitchCurve(value)).label;
}

export function sanitizeAutomatapoeiaTimbreSource(value) {
  return TIMBRE_SOURCE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_TIMBRE_SOURCE;
}

export function automatapoeiaTimbreSourceLabel(value) {
  return TIMBRE_SOURCE_BY_ID.get(sanitizeAutomatapoeiaTimbreSource(value)).label;
}

export function sanitizeAutomatapoeiaContourSource(value) {
  return CONTOUR_SOURCE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_CONTOUR_SOURCE;
}

export function automatapoeiaContourSourceLabel(value) {
  return CONTOUR_SOURCE_BY_ID.get(sanitizeAutomatapoeiaContourSource(value)).label;
}

export function sanitizeAutomatapoeiaPhraseShape(value) {
  return PHRASE_SHAPE_BY_ID.has(value) ? value : AUTOMATAPOEIA_DEFAULT_PHRASE_SHAPE;
}

export function automatapoeiaPhraseShapeLabel(value) {
  return PHRASE_SHAPE_BY_ID.get(sanitizeAutomatapoeiaPhraseShape(value)).label;
}

export function automatapoeiaVoiceLabel(value) {
  return VOICE_BY_ID.get(sanitizeAutomatapoeiaVoice(value)).label;
}

export function automatapoeiaVoiceCaption(value) {
  return VOICE_BY_ID.get(sanitizeAutomatapoeiaVoice(value)).caption;
}

export function automatapoeiaFrequencyAtPosition(
  position,
  minimum = AUTOMATAPOEIA_FREQUENCY_MIN,
  maximum = AUTOMATAPOEIA_FREQUENCY_MAX,
) {
  return linearDrumFrequencyAtPosition(
    clamp(finiteOr(position, 0), 0, 1),
    minimum,
    maximum,
  );
}

export function automatapoeiaPitchResponse(position, curve = AUTOMATAPOEIA_DEFAULT_PITCH_CURVE) {
  const value = clamp(finiteOr(position, 0), 0, 1);
  switch (sanitizeAutomatapoeiaPitchCurve(curve)) {
    case "early": return Math.sqrt(value);
    case "late": return value * value;
    case "smooth": return value * value * (3 - 2 * value);
    case "reverse": return 1 - value;
    default: return value;
  }
}

export function automatapoeiaSwingPosition(position, amount = 0) {
  const value = clamp(finiteOr(position, 0), 0, 1);
  const swing = clamp(finiteOr(amount, 0), -0.5, 0.5);
  const pairCount = 4;
  const scaled = value * pairCount;
  const pair = Math.min(pairCount - 1, Math.floor(scaled));
  const withinPair = scaled - pair;
  const midpoint = 0.5 + swing / 3;
  const warped = withinPair <= 0.5
    ? (withinPair / 0.5) * midpoint
    : midpoint + ((withinPair - 0.5) / 0.5) * (1 - midpoint);
  return (pair + warped) / pairCount;
}

export function automatapoeiaSwingInterval(generation, rate = 8, amount = 0) {
  const safeRate = clamp(finiteOr(rate, 8), 1, 24);
  const swing = clamp(finiteOr(amount, 0), -0.5, 0.5);
  const parity = Math.abs(Math.trunc(finiteOr(generation, 0))) % 2;
  return (1 / safeRate) * (parity ? 1 - swing : 1 + swing);
}

export function automatapoeiaRetimedAccumulator(
  accumulator,
  generation,
  previousRate,
  previousSwing,
  nextRate,
  nextSwing,
) {
  const previousInterval = automatapoeiaSwingInterval(
    generation,
    previousRate,
    previousSwing,
  );
  const nextInterval = automatapoeiaSwingInterval(generation, nextRate, nextSwing);
  const phase = clamp(finiteOr(accumulator, 0) / previousInterval, 0, 0.999999);
  return phase * nextInterval;
}

export function automatapoeiaLiveRuns(
  cells = [],
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
) {
  const width = cells.length;
  const runs = [];
  let runStart = -1;
  for (let index = 0; index <= width; index += 1) {
    if (cells[index] && runStart < 0) runStart = index;
    if ((!cells[index] || index === width) && runStart >= 0) {
      const end = index - 1;
      runs.push({
        start: runStart,
        end,
        center: (runStart + end) / 2,
        full: runStart === 0 && end === width - 1,
        length: end - runStart + 1,
        wraps: false,
      });
      runStart = -1;
    }
  }
  if (
    sanitizeAutomatapoeiaBoundary(boundary) === "periodic"
    && runs.length > 1
    && cells[0]
    && cells[width - 1]
  ) {
    const first = runs.shift();
    const last = runs.pop();
    const length = last.length + first.length;
    const center = wrap01((last.start + (length - 1) / 2) / width) * width;
    runs.push({
      start: last.start,
      end: first.end,
      center,
      full: false,
      length,
      wraps: true,
    });
    runs.sort((left, right) => left.center - right.center);
  }
  return Object.freeze(runs.map((run) => Object.freeze(run)));
}

export function automatapoeiaPolarityMask(
  cells = [],
  polarity = AUTOMATAPOEIA_DEFAULT_POLARITY,
) {
  const selectedValue = POLARITY_BY_ID.get(sanitizeAutomatapoeiaPolarity(polarity)).value;
  return Object.freeze(Array.from(cells, (cell) => ((cell ? 1 : 0) === selectedValue ? 1 : 0)));
}

export function automatapoeiaPolarityRuns(
  cells = [],
  {
    boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
    polarity = AUTOMATAPOEIA_DEFAULT_POLARITY,
  } = {},
) {
  return automatapoeiaLiveRuns(automatapoeiaPolarityMask(cells, polarity), boundary);
}

function runCellIndices(run, width) {
  return Array.from({ length: run.length }, (_, offset) => (run.start + offset) % width);
}

function runCenterForCells(cells, width, periodic) {
  if (!cells.length || !width) return (Math.max(1, width) - 1) / 2;
  if (!periodic) return cells.reduce((sum, cell) => sum + cell, 0) / cells.length;
  let x = 0;
  let y = 0;
  for (const cell of cells) {
    const angle = TAU * cell / width;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.hypot(x, y) < 1e-9) return (width - 1) / 2;
  return wrap01(Math.atan2(y, x) / TAU) * width;
}

function pathNumber(value) {
  return `${Number(value.toFixed(4))}`;
}

export function automatapoeiaConnectedForms(rows = [], options = {}) {
  if (!Array.isArray(rows)) throw new TypeError("Automatapoeia rows must be an array.");
  const height = rows.length;
  const width = height ? rows[0]?.length ?? 0 : 0;
  rows.forEach((row, index) => {
    if (!row || typeof row.length !== "number" || row.length !== width) {
      throw new RangeError(`Automatapoeia row ${index} has width ${row?.length ?? "unknown"}; expected ${width}.`);
    }
  });
  const polarity = sanitizeAutomatapoeiaPolarity(options.polarity);
  const fallbackBoundary = sanitizeAutomatapoeiaBoundary(options.boundary);
  const boundaries = Object.freeze(Array.from({ length: height }, (_, row) => (
    sanitizeAutomatapoeiaBoundary(options.boundaryByRow?.[row] ?? fallbackBoundary)
  )));
  const rowOffset = Math.trunc(finiteOr(options.rowOffset, 0));
  const selectedRows = rows.map((row) => automatapoeiaPolarityMask(row, polarity));
  const nodes = [];
  const rowNodeIds = [];
  for (let row = 0; row < height; row += 1) {
    const ids = [];
    for (const run of automatapoeiaLiveRuns(selectedRows[row], boundaries[row])) {
      const id = nodes.length;
      nodes.push({
        ...run,
        childEdgeIds: [],
        componentId: -1,
        generation: rowOffset + row,
        id,
        parentEdgeIds: [],
        row,
      });
      ids.push(id);
    }
    rowNodeIds.push(ids);
  }

  const parents = Array.from({ length: nodes.length }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    while (parents[value] !== value) {
      const next = parents[value];
      parents[value] = root;
      value = next;
    }
    return root;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };

  const edges = [];
  for (let row = 1; row < height; row += 1) {
    const periodic = boundaries[row] === "periodic";
    const previousOwners = new Int32Array(width);
    previousOwners.fill(-1);
    for (const nodeId of rowNodeIds[row - 1]) {
      for (const cell of runCellIndices(nodes[nodeId], width)) previousOwners[cell] = nodeId;
    }
    for (const nodeId of rowNodeIds[row]) {
      const node = nodes[nodeId];
      const matches = new Map();
      for (const cell of runCellIndices(node, width)) {
        const supportedHere = new Set();
        for (let delta = -1; delta <= 1; delta += 1) {
          const rawNeighbor = cell + delta;
          if (!periodic && (rawNeighbor < 0 || rawNeighbor >= width)) continue;
          const neighbor = ((rawNeighbor % width) + width) % width;
          const previousId = previousOwners[neighbor];
          if (previousId < 0 || supportedHere.has(previousId)) continue;
          supportedHere.add(previousId);
          const match = matches.get(previousId) ?? {
            crossedSeam: false,
            supportCells: 0,
            verticalOverlap: 0,
          };
          match.supportCells += 1;
          if (delta === 0) match.verticalOverlap += 1;
          if (rawNeighbor !== neighbor) match.crossedSeam = true;
          matches.set(previousId, match);
        }
      }
      const orderedMatches = [...matches.entries()].sort(([leftId, left], [rightId, right]) => {
        if (left.supportCells !== right.supportCells) return right.supportCells - left.supportCells;
        const leftDelta = periodic
          ? circularDifference(node.center, nodes[leftId].center, width)
          : node.center - nodes[leftId].center;
        const rightDelta = periodic
          ? circularDifference(node.center, nodes[rightId].center, width)
          : node.center - nodes[rightId].center;
        return Math.abs(leftDelta) - Math.abs(rightDelta) || leftDelta - rightDelta || leftId - rightId;
      });
      orderedMatches.forEach(([previousId, match], matchIndex) => {
        const previousNode = nodes[previousId];
        const centerDelta = periodic
          ? circularDifference(node.center, previousNode.center, width)
          : node.center - previousNode.center;
        const edge = {
          centerDelta,
          from: previousId,
          id: edges.length,
          principal: matchIndex === 0,
          supportCells: match.supportCells,
          to: nodeId,
          verticalOverlap: match.verticalOverlap,
          wraps: match.crossedSeam || (periodic && Math.abs(node.center - previousNode.center) > width / 2),
        };
        edges.push(edge);
        previousNode.childEdgeIds.push(edge.id);
        node.parentEdgeIds.push(edge.id);
        unite(previousId, nodeId);
      });
    }
  }

  const componentGroups = new Map();
  nodes.forEach((node) => {
    const root = find(node.id);
    if (!componentGroups.has(root)) componentGroups.set(root, []);
    componentGroups.get(root).push(node.id);
  });
  const orderedGroups = [...componentGroups.values()].sort((left, right) => left[0] - right[0]);
  const components = orderedGroups.map((nodeIds, componentId) => {
    nodeIds.forEach((nodeId) => { nodes[nodeId].componentId = componentId; });
    const nodeIdSet = new Set(nodeIds);
    const nodesByRow = new Map();
    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      if (!nodesByRow.has(node.row)) nodesByRow.set(node.row, []);
      nodesByRow.get(node.row).push(nodeId);
    }
    const profile = [...nodesByRow.entries()].sort(([left], [right]) => left - right).map(([row, ids]) => {
      const rowNodes = ids.map((id) => nodes[id]);
      const cells = rowNodes.flatMap((node) => runCellIndices(node, width));
      const periodic = boundaries[row] === "periodic";
      const center = runCenterForCells(cells, width, periodic);
      const wrappingNode = rowNodes.find((node) => node.wraps);
      const start = wrappingNode?.start ?? Math.min(...rowNodes.map((node) => node.start));
      const end = wrappingNode?.end ?? Math.max(...rowNodes.map((node) => node.end));
      return Object.freeze({
        cellCount: cells.length,
        center,
        centroid: width ? clamp((center + 0.5) / width, 0, 1) : 0.5,
        end,
        generation: rowOffset + row,
        nodeIds: Object.freeze([...ids]),
        row,
        runCount: ids.length,
        start,
        wraps: rowNodes.some((node) => node.wraps),
      });
    });
    const rowStart = profile[0].row;
    const rowEnd = profile.at(-1).row;
    const rowSpan = rowEnd - rowStart + 1;
    const cellCount = profile.reduce((sum, row) => sum + row.cellCount, 0);
    let unwrappedCenterSum = 0;
    let previousCenter = profile[0].center;
    for (const row of profile) {
      const center = boundaries[row.row] === "periodic"
        ? previousCenter + circularDifference(row.center, wrap01(previousCenter / Math.max(1, width)) * width, width)
        : row.center;
      unwrappedCenterSum += center * row.cellCount;
      previousCenter = center;
    }
    const rawCenter = unwrappedCenterSum / Math.max(1, cellCount);
    const edgeIds = edges
      .filter((edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to))
      .map((edge) => edge.id);
    const wraps = nodeIds.some((nodeId) => nodes[nodeId].wraps)
      || edgeIds.some((edgeId) => edges[edgeId].wraps);
    const center = wraps && width ? wrap01(rawCenter / width) * width : rawCenter;
    const touchesLeft = nodeIds.some((nodeId) => runCellIndices(nodes[nodeId], width).includes(0));
    const touchesRight = nodeIds.some((nodeId) => runCellIndices(nodes[nodeId], width).includes(width - 1));
    const touchesTop = rowStart === 0;
    const touchesBottom = rowEnd === height - 1;
    const touchesFixedSide = nodeIds.some((nodeId) => {
      const node = nodes[nodeId];
      if (boundaries[node.row] !== "fixed") return false;
      const cells = runCellIndices(node, width);
      return cells.includes(0) || cells.includes(width - 1);
    });
    const enclosed = !touchesTop && !touchesBottom && !touchesFixedSide;
    return Object.freeze({
      active: touchesBottom,
      activeStream: touchesBottom && rowSpan >= 2,
      cellCount,
      center,
      centroid: width ? clamp((center + 0.5) / width, 0, 1) : 0.5,
      closedThisStep: height > 1 && rowEnd === height - 2 && !touchesTop && !touchesFixedSide,
      edgeIds: Object.freeze(edgeIds),
      enclosed,
      endGeneration: rowOffset + rowEnd,
      id: componentId,
      nodeIds: Object.freeze([...nodeIds]),
      profile: Object.freeze(profile),
      rowCount: profile.length,
      rowEnd,
      rowSpan,
      rowStart,
      runCount: nodeIds.length,
      startGeneration: rowOffset + rowStart,
      touches: Object.freeze({
        bottom: touchesBottom,
        fixedSide: touchesFixedSide,
        left: touchesLeft,
        right: touchesRight,
        top: touchesTop,
      }),
      truncatedTop: touchesTop,
      wraps,
    });
  });

  const frozenNodes = Object.freeze(nodes.map((node) => Object.freeze({
    ...node,
    childEdgeIds: Object.freeze([...node.childEdgeIds]),
    parentEdgeIds: Object.freeze([...node.parentEdgeIds]),
  })));
  const frozenEdges = Object.freeze(edges.map((edge) => Object.freeze(edge)));
  return Object.freeze({
    activeStreamCount: components.filter((component) => component.activeStream).length,
    boundaries,
    boundary: fallbackBoundary,
    components: Object.freeze(components),
    edges: frozenEdges,
    enclosedIslandCount: components.filter((component) => component.enclosed).length,
    height,
    newlyClosedIslandCount: components.filter((component) => component.closedThisStep).length,
    nodes: frozenNodes,
    polarity,
    rowNodeIds: Object.freeze(rowNodeIds.map((ids) => Object.freeze([...ids]))),
    rowOffset,
    width,
  });
}

export function automatapoeiaConnectedSoundUnits(forms) {
  if (!forms?.components?.length) return Object.freeze([]);
  const units = forms.components.filter((component) => (
    component.activeStream || component.closedThisStep
  )).map((component) => {
    const latest = component.profile.at(-1);
    const previous = component.profile.at(-2);
    const boundary = forms.boundaries[latest.row] ?? forms.boundary;
    const periodic = boundary === "periodic";
    const centerDifference = previous
      ? (periodic
        ? circularDifference(latest.center, previous.center, forms.width)
        : latest.center - previous.center)
      : 0;
    const latestNodes = latest.nodeIds.map((id) => forms.nodes[id]);
    const incomingEdges = latestNodes.flatMap((node) => (
      node.parentEdgeIds.map((edgeId) => forms.edges[edgeId])
    ));
    const overlap = incomingEdges.reduce((sum, edge) => sum + edge.verticalOverlap, 0);
    const spanPersistence = 1 - 1 / Math.max(1, component.rowSpan);
    return Object.freeze({
      born: component.rowSpan === 1,
      center: latest.center,
      centerDrift: centerDifference / Math.max(1, periodic ? forms.width : forms.width - 1),
      componentArea: component.cellCount,
      componentFill: component.cellCount / Math.max(1, component.rowSpan * forms.width),
      componentHeight: component.rowSpan,
      componentId: component.id,
      end: latest.end,
      expansion: previous ? (latest.cellCount - previous.cellCount) / Math.max(1, forms.width) : 0,
      full: latest.cellCount === forms.width,
      length: latest.cellCount,
      localWallDensity: clamp(latest.runCount / Math.max(1, latest.cellCount), 0, 1),
      mergeCount: incomingEdges.length,
      objectKind: component.closedThisStep ? "island" : "stream",
      start: latest.start,
      verticalPersistence: clamp(Math.max(
        spanPersistence,
        overlap / Math.max(1, latest.cellCount),
      ), 0, 1),
      wraps: latest.wraps,
    });
  });
  units.sort((left, right) => left.center - right.center || left.componentId - right.componentId);
  return Object.freeze(units);
}

export function automatapoeiaConnectedPaths(forms) {
  if (!forms?.nodes?.length || !forms.width) {
    return Object.freeze({
      islandCellCount: 0,
      islandPath: "",
      islandsPath: "",
      linkPath: "",
      linksPath: "",
      streamLinkCount: 0,
    });
  }
  const activeComponents = new Set(
    forms.components.filter((component) => component.activeStream).map((component) => component.id),
  );
  const enclosedComponents = new Set(
    forms.components.filter((component) => component.enclosed).map((component) => component.id),
  );
  const linkCommands = [];
  let streamLinkCount = 0;
  for (const edge of forms.edges) {
    const from = forms.nodes[edge.from];
    const to = forms.nodes[edge.to];
    if (!activeComponents.has(from.componentId)) continue;
    const x1 = from.center + 0.5;
    const y1 = from.row + 0.5;
    const y2 = to.row + 0.5;
    const periodic = forms.boundaries[to.row] === "periodic";
    const delta = periodic
      ? circularDifference(to.center, from.center, forms.width)
      : to.center - from.center;
    const unwrappedX2 = x1 + delta;
    if (periodic && unwrappedX2 < 0) {
      const amount = (0 - x1) / (unwrappedX2 - x1);
      const seamY = lerp(y1, y2, amount);
      linkCommands.push(
        `M${pathNumber(x1)} ${pathNumber(y1)}L0 ${pathNumber(seamY)}`,
        `M${forms.width} ${pathNumber(seamY)}L${pathNumber(unwrappedX2 + forms.width)} ${pathNumber(y2)}`,
      );
    } else if (periodic && unwrappedX2 > forms.width) {
      const amount = (forms.width - x1) / (unwrappedX2 - x1);
      const seamY = lerp(y1, y2, amount);
      linkCommands.push(
        `M${pathNumber(x1)} ${pathNumber(y1)}L${forms.width} ${pathNumber(seamY)}`,
        `M0 ${pathNumber(seamY)}L${pathNumber(unwrappedX2 - forms.width)} ${pathNumber(y2)}`,
      );
    } else {
      linkCommands.push(`M${pathNumber(x1)} ${pathNumber(y1)}L${pathNumber(unwrappedX2)} ${pathNumber(y2)}`);
    }
    streamLinkCount += 1;
  }
  const islandCommands = [];
  let islandCellCount = 0;
  for (const node of forms.nodes) {
    if (!enclosedComponents.has(node.componentId)) continue;
    islandCellCount += node.length;
    if (node.wraps) {
      const rightLength = forms.width - node.start;
      const leftLength = node.end + 1;
      if (rightLength) islandCommands.push(`M${node.start} ${node.row}h${rightLength}v1h-${rightLength}z`);
      if (leftLength) islandCommands.push(`M0 ${node.row}h${leftLength}v1h-${leftLength}z`);
    } else {
      islandCommands.push(`M${node.start} ${node.row}h${node.length}v1h-${node.length}z`);
    }
  }
  const linksPath = linkCommands.join("");
  const islandsPath = islandCommands.join("");
  return Object.freeze({
    islandCellCount,
    islandPath: islandsPath,
    islandsPath,
    linkPath: linksPath,
    linksPath,
    streamLinkCount,
  });
}

function rowMoments(cells, boundary) {
  const width = cells.length;
  const periodic = sanitizeAutomatapoeiaBoundary(boundary) === "periodic";
  const denominator = Math.max(1, width - 1);
  let live = 0;
  let sum = 0;
  let squareSum = 0;
  let circularX = 0;
  let circularY = 0;
  for (let index = 0; index < width; index += 1) {
    if (!cells[index]) continue;
    const position = width > 1 ? index / denominator : 0.5;
    live += 1;
    sum += position;
    squareSum += position * position;
    if (periodic && width) {
      const angle = Math.PI * 2 * (index + 0.5) / width;
      circularX += Math.cos(angle);
      circularY += Math.sin(angle);
    }
  }
  if (periodic) {
    const confidence = live ? Math.hypot(circularX, circularY) / live : 0;
    const centroidDefined = live > 0 && confidence > 1e-9;
    const centroid = centroidDefined
      ? wrap01(Math.atan2(circularY, circularX) / (Math.PI * 2))
      : 0.5;
    return {
      centroid,
      centroidConfidence: confidence,
      centroidDefined,
      live,
      spread: live ? 1 - confidence : 0,
    };
  }
  const centroid = live ? sum / live : 0.5;
  const variance = live ? Math.max(0, squareSum / live - centroid * centroid) : 0;
  return {
    centroid,
    centroidConfidence: live ? 1 : 0,
    centroidDefined: live > 0,
    live,
    spread: clamp(Math.sqrt(variance) / 0.5, 0, 1),
  };
}

function circularDifference(current, previous, period) {
  if (!period) return current - previous;
  return wrap01((current - previous) / period + 0.5) * period - period / 2;
}

function runOwners(runs, width) {
  const owners = new Int16Array(width);
  owners.fill(-1);
  runs.forEach((run, runIndex) => {
    for (let offset = 0; offset < run.length; offset += 1) {
      owners[(run.start + offset) % width] = runIndex;
    }
  });
  return owners;
}

function matchPreviousRun(run, previousRuns, previousOwners, width, periodic) {
  const votes = new Map();
  for (let offset = 0; offset < run.length; offset += 1) {
    const index = (run.start + offset) % width;
    const nearbyOwners = new Set();
    for (let delta = -1; delta <= 1; delta += 1) {
      const neighbor = index + delta;
      if (!periodic && (neighbor < 0 || neighbor >= width)) continue;
      const previousOwner = previousOwners[(neighbor + width) % width];
      if (previousOwner >= 0) nearbyOwners.add(previousOwner);
    }
    for (const previousOwner of nearbyOwners) {
      votes.set(previousOwner, (votes.get(previousOwner) ?? 0) + 1);
    }
  }
  let best = null;
  let bestIndex = -1;
  let bestVote = 0;
  let bestDistance = Infinity;
  let bestSignedDistance = Infinity;
  for (const [previousIndex, vote] of votes) {
    const previous = previousRuns[previousIndex];
    const signedDistance = periodic
      ? circularDifference(run.center, previous.center, width)
      : run.center - previous.center;
    const distance = Math.abs(signedDistance);
    if (vote > bestVote
      || (vote === bestVote && distance < bestDistance)
      || (vote === bestVote && distance === bestDistance && signedDistance < bestSignedDistance)) {
      best = previous;
      bestIndex = previousIndex;
      bestVote = vote;
      bestDistance = distance;
      bestSignedDistance = signedDistance;
    }
  }
  return {
    best,
    bestIndex,
    centerDifference: best ? bestSignedDistance : 0,
    mergeCount: votes.size,
  };
}

export function automatapoeiaContourStats(
  cells = [],
  previousCells = [],
  boundary = AUTOMATAPOEIA_DEFAULT_BOUNDARY,
) {
  const width = cells.length;
  const hasPrevious = previousCells?.length === width;
  const previous = hasPrevious ? previousCells : [];
  const safeBoundary = sanitizeAutomatapoeiaBoundary(boundary);
  const periodic = safeBoundary === "periodic";
  const currentMoments = rowMoments(cells, safeBoundary);
  const previousMoments = rowMoments(previous, safeBoundary);
  let births = 0;
  let deaths = 0;
  let intersection = 0;
  let union = 0;
  let mirrorDifferences = 0;
  for (let index = 0; index < width; index += 1) {
    const current = cells[index] ? 1 : 0;
    const prior = hasPrevious && previous[index] ? 1 : 0;
    if (current && !prior) births += 1;
    if (!current && prior) deaths += 1;
    if (current && prior) intersection += 1;
    if (current || prior) union += 1;
    if (current !== (cells[width - 1 - index] ? 1 : 0)) mirrorDifferences += 1;
  }

  const wallCount = safeBoundary === "periodic" ? width : width + 1;
  let changedWalls = 0;
  if (hasPrevious) {
    for (let edge = 0; edge < wallCount; edge += 1) {
      const leftIndex = safeBoundary === "periodic" ? edge : edge - 1;
      const rightIndex = safeBoundary === "periodic" ? edge + 1 : edge;
      const currentWall = automatapoeiaCellAt(cells, leftIndex, safeBoundary)
        !== automatapoeiaCellAt(cells, rightIndex, safeBoundary);
      const previousWall = automatapoeiaCellAt(previous, leftIndex, safeBoundary)
        !== automatapoeiaCellAt(previous, rightIndex, safeBoundary);
      if (currentWall !== previousWall) changedWalls += 1;
    }
  }

  const previousRuns = hasPrevious ? automatapoeiaLiveRuns(previous, safeBoundary) : [];
  const previousOwners = runOwners(previousRuns, width);
  const runs = automatapoeiaLiveRuns(cells, safeBoundary).map((run) => {
    const {
      best,
      bestIndex,
      centerDifference,
      mergeCount,
    } = matchPreviousRun(run, previousRuns, previousOwners, width, periodic);
    let verticalOverlap = 0;
    if (best) {
      for (let offset = 0; offset < run.length; offset += 1) {
        const index = (run.start + offset) % width;
        if (previousOwners[index] === bestIndex) verticalOverlap += 1;
      }
    }
    const leftDifference = best
      ? (periodic
        ? circularDifference(run.start, best.start, width)
        : run.start - best.start)
      : 0;
    const rightDifference = best
      ? (periodic
        ? circularDifference(run.end, best.end, width)
        : run.end - best.end)
      : 0;
    return Object.freeze({
      ...run,
      born: !best,
      centerDrift: best
        ? centerDifference / Math.max(1, periodic ? width : width - 1)
        : 0,
      expansion: best ? (run.length - best.length) / Math.max(1, width) : 0,
      leftVelocity: leftDifference / Math.max(1, periodic ? width : width - 1),
      mergeCount,
      rightVelocity: rightDifference / Math.max(1, periodic ? width : width - 1),
      verticalPersistence: verticalOverlap / Math.max(1, run.length),
    });
  });
  const rowStats = automatapoeiaRowStats(cells, safeBoundary);
  const centroidDelta = hasPrevious
    && currentMoments.centroidDefined
    && previousMoments.centroidDefined
    ? (periodic
      ? circularDifference(currentMoments.centroid, previousMoments.centroid, 1)
      : currentMoments.centroid - previousMoments.centroid)
    : 0;
  return Object.freeze({
    activity: width && hasPrevious ? (births + deaths) / width : 0,
    births,
    centroid: currentMoments.centroid,
    centroidConfidence: currentMoments.centroidConfidence,
    centroidDefined: currentMoments.centroidDefined,
    centroidDelta,
    deaths,
    density: rowStats.density,
    densityDelta: width && hasPrevious ? (births - deaths) / width : 0,
    persistence: hasPrevious ? (union ? intersection / union : 1) : 0,
    runCount: runs.length,
    runCountDelta: hasPrevious ? runs.length - previousRuns.length : 0,
    runs: Object.freeze(runs),
    spread: currentMoments.spread,
    spreadDelta: hasPrevious ? currentMoments.spread - previousMoments.spread : 0,
    symmetry: width ? 1 - mirrorDifferences / width : 1,
    transitions: rowStats.transitions,
    wallFlux: hasPrevious && wallCount ? changedWalls / wallCount : 0,
  });
}

function selectedRuns(allRuns, detail) {
  const maximumEvents = Math.max(1, Math.round(clamp(finiteOr(detail, 6), 1, 16)));
  if (allRuns.length <= maximumEvents) return allRuns;
  return Object.freeze(Array.from({ length: maximumEvents }, (_, index) => (
    allRuns[Math.min(
      allRuns.length - 1,
      Math.floor((index + 0.5) * allRuns.length / maximumEvents),
    )]
  )));
}

function localWallDensity(cells, run, boundary) {
  if (Number.isFinite(run.localWallDensity)) return clamp(run.localWallDensity, 0, 1);
  let walls = 0;
  let pairs = 0;
  for (let offset = -1; offset < run.length; offset += 1) {
    const index = run.start + offset;
    if (automatapoeiaCellAt(cells, index, boundary)
      !== automatapoeiaCellAt(cells, index + 1, boundary)) walls += 1;
    pairs += 1;
  }
  return walls / Math.max(1, pairs);
}

function eventTimbreValue(source, context) {
  switch (sanitizeAutomatapoeiaTimbreSource(source)) {
    case "run-length": return Math.sqrt(context.runLength / Math.max(1, context.width));
    case "row-density": return context.analysis.density;
    case "row-walls": return context.analysis.transitions / Math.max(1, context.maximumWalls);
    case "activity": return context.analysis.activity;
    case "persistence": return context.run.verticalPersistence;
    case "expansion": return clamp(0.5 + context.run.expansion * 6, 0, 1);
    case "edge-flux": return context.analysis.wallFlux;
    case "symmetry": return context.analysis.symmetry;
    default: return localWallDensity(context.cells, context.run, context.boundary);
  }
}

function eventContourValue(source, analysis, run) {
  switch (sanitizeAutomatapoeiaContourSource(source)) {
    case "expansion": return clamp(0.5 + run.expansion * 6, 0, 1);
    case "edge-flux": return analysis.wallFlux;
    case "persistence": return run.verticalPersistence;
    case "birth-death": return clamp(0.5 + analysis.densityDelta * 3, 0, 1);
    default: return clamp(0.5 + run.centerDrift * 8, 0, 1);
  }
}

export function buildAutomatapoeiaEvents(cells = [], rateOrOptions = 8) {
  const options = rateOrOptions && typeof rateOrOptions === "object"
    ? rateOrOptions
    : { rate: rateOrOptions };
  const safeRate = clamp(finiteOr(options.rate, 8), 1, 24);
  const sampleRate = clamp(finiteOr(options.sampleRate, 48_000), 8_000, 384_000);
  const frameCount = Math.max(1, Math.round(sampleRate / safeRate));
  const duration = frameCount / sampleRate;
  const minimumFrequency = clamp(finiteOr(options.frequencyMin, AUTOMATAPOEIA_FREQUENCY_MIN), 20, 16_000);
  const maximumFrequency = clamp(
    Math.max(minimumFrequency * 1.01, finiteOr(options.frequencyMax, AUTOMATAPOEIA_FREQUENCY_MAX)),
    minimumFrequency * 1.01,
    16_000,
  );
  const boundary = sanitizeAutomatapoeiaBoundary(options.boundary);
  const polarity = sanitizeAutomatapoeiaPolarity(options.polarity);
  const objectMode = sanitizeAutomatapoeiaObjectMode(options.objectMode);
  const pitchCurve = sanitizeAutomatapoeiaPitchCurve(options.pitchCurve);
  const timbreSource = sanitizeAutomatapoeiaTimbreSource(options.timbreSource);
  const contourSource = sanitizeAutomatapoeiaContourSource(options.contourSource);
  const phraseShape = sanitizeAutomatapoeiaPhraseShape(options.phraseShape);
  const timbreAmount = clamp(finiteOr(options.timbreAmount, 0.8), 0, 1);
  const contourAmount = clamp(finiteOr(options.contourAmount, 0.42), 0, 1);
  const pitchTrace = clamp(finiteOr(options.pitchTrace, 0.7), 0, 1);
  const strikeLength = clamp(finiteOr(options.strikeLength, 1.15), 0.1, 2);
  const timeSpread = clamp(finiteOr(options.timeSpread, 0.76), 0, 1);
  const swing = clamp(finiteOr(options.swing, 0), -0.5, 0.5);
  const envelope = Object.freeze({
    attack: clamp(finiteOr(options.attack, AUTOMATAPOEIA_DEFAULT_ENVELOPE.attack), 0.001, 0.4),
    decay: clamp(finiteOr(options.decay, AUTOMATAPOEIA_DEFAULT_ENVELOPE.decay), 0.005, 1.5),
    release: clamp(finiteOr(options.release, AUTOMATAPOEIA_DEFAULT_ENVELOPE.release), 0.005, 2),
    sustain: clamp(finiteOr(options.sustain, AUTOMATAPOEIA_DEFAULT_ENVELOPE.sustain), 0, 1),
  });
  const selectedCells = automatapoeiaPolarityMask(cells, polarity);
  const previousSelectedCells = automatapoeiaPolarityMask(options.previousCells ?? [], polarity);
  const analysis = options.analysis?.runs
    ? options.analysis
    : automatapoeiaContourStats(selectedCells, previousSelectedCells, boundary);
  const connectedUnits = Array.isArray(options.connectedUnits)
    ? options.connectedUnits
    : options.connectedForms
      ? automatapoeiaConnectedSoundUnits(options.connectedForms)
      : null;
  const allRuns = objectMode === "connected" && connectedUnits
    ? connectedUnits
    : analysis.runs;
  const requestedDetail = Math.max(1, Math.round(clamp(finiteOr(options.detail, 8), 1, 16)));
  const eventBudget = Math.max(3, Math.min(16, Math.floor(72 / safeRate)));
  const runs = selectedRuns(allRuns, Math.min(requestedDetail, eventBudget));
  const releaseLimit = Math.min(2, duration * 6);
  const maximumWalls = boundary === "periodic" ? selectedCells.length : selectedCells.length + 1;
  const events = runs.map((run, index) => {
    const position = clamp((run.center + 0.5) / Math.max(1, selectedCells.length), 0, 1);
    const runStartPosition = run.start / Math.max(1, selectedCells.length);
    const runEndPosition = (run.end + 1) / Math.max(1, selectedCells.length);
    const mapTime = (value) => automatapoeiaSwingPosition(
      0.5 + (value - 0.5) * timeSpread * 0.9,
      swing,
    );
    const linearOnset = phraseShape === "bands" && !run.wraps
      ? runStartPosition
      : position;
    const onset = mapTime(linearOnset);
    const bandEnd = mapTime(runEndPosition);
    const startFrame = Math.min(frameCount - 1, Math.max(0, Math.round(frameCount * onset)));
    const runFraction = run.length / Math.max(1, selectedCells.length);
    const centerIndex = Math.round(run.center);
    const left = automatapoeiaCellAt(selectedCells, centerIndex - 1, boundary);
    const center = automatapoeiaCellAt(selectedCells, centerIndex, boundary);
    const right = automatapoeiaCellAt(selectedCells, centerIndex + 1, boundary);
    const neighborhood = (left << 2) | (center << 1) | right;
    const rawTimbre = eventTimbreValue(timbreSource, {
      analysis,
      boundary,
      cells: selectedCells,
      maximumWalls,
      run,
      runLength: run.length,
      width: selectedCells.length,
    });
    const rawContour = eventContourValue(contourSource, analysis, run);
    const contour = lerp(0.5, rawContour, contourAmount);
    const contourSigned = (rawContour - 0.5) * 2;
    const sculpt = clamp(
      0.5 + (rawTimbre - 0.5) * timbreAmount + contourSigned * contourAmount * 0.22,
      0,
      1,
    );
    const contourPitch = clamp(position + contourSigned * 0.28, 0, 1);
    const pitchInput = lerp(position, contourPitch, contourAmount);
    const pitchPosition = automatapoeiaPitchResponse(pitchInput, pitchCurve);
    const previousPosition = boundary === "periodic"
      ? wrap01(position - run.centerDrift)
      : clamp(position - run.centerDrift, 0, 1);
    const pitchStartPosition = automatapoeiaPitchResponse(
      lerp(pitchInput, previousPosition, pitchTrace),
      pitchCurve,
    );
    const gateScale = lerp(
      1,
      0.65 + run.verticalPersistence * 0.85 + Math.max(0, run.expansion) * 5,
      contourAmount,
    );
    const componentHeight = Math.max(1, finiteOr(run.componentHeight, 1));
    const componentArea = Math.max(run.length, finiteOr(run.componentArea, run.length));
    const connectedDurationScale = objectMode === "connected"
      ? clamp(
        0.82
          + Math.log2(componentHeight + 1) * 0.24
          + Math.sqrt(componentArea / Math.max(1, selectedCells.length)) * 0.3,
        0.82,
        2,
      )
      : 1;
    const baseGateFrames = phraseShape === "bands"
      ? Math.max(
        Math.round(frameCount * 0.12),
        Math.round(frameCount * (run.wraps
          ? runFraction * timeSpread * 0.9
          : Math.max(0, bandEnd - onset))),
      )
      : frameCount;
    const gateFrames = Math.max(1, Math.min(
      Math.round(frameCount * 2),
      Math.round(baseGateFrames * strikeLength * gateScale * connectedDurationScale),
    ));
    const islandScale = run.objectKind === "island" ? 1.24 : 1;
    const attackScale = lerp(1, run.born ? 0.48 : 1.16, contourAmount) * islandScale;
    const decayScale = lerp(1, 0.72 + run.verticalPersistence * 0.72, contourAmount);
    const releaseScale = lerp(
      1,
      0.62 + run.verticalPersistence * 1.08 + Math.max(0, run.expansion) * 6,
      contourAmount,
    ) * (objectMode === "connected" ? clamp(0.9 + componentHeight * 0.06, 0.9, 1.65) : 1);
    const attackFrames = Math.max(1, Math.round(sampleRate * envelope.attack * attackScale));
    const decayFrames = Math.max(1, Math.round(sampleRate * envelope.decay * decayScale));
    const requestedRelease = envelope.release * releaseScale;
    const releaseDuration = Math.min(releaseLimit, requestedRelease);
    const releaseFrames = Math.max(1, Math.round(sampleRate * releaseDuration));
    const eventFrameCount = gateFrames + releaseFrames;
    const sustain = clamp(
      envelope.sustain * lerp(1, 0.68 + run.verticalPersistence * 0.58, contourAmount),
      0,
      1,
    );
    return Object.freeze({
      ...run,
      attackFrames,
      contour,
      decayFrames,
      frameCount: eventFrameCount,
      gateFrames,
      index,
      position,
      pitchPosition,
      frequency: automatapoeiaFrequencyAtPosition(pitchPosition, minimumFrequency, maximumFrequency),
      frequencyStart: automatapoeiaFrequencyAtPosition(
        pitchStartPosition,
        minimumFrequency,
        maximumFrequency,
      ),
      neighborhood,
      rawContour,
      releaseCapped: releaseDuration + 1 / sampleRate < requestedRelease,
      releaseFrames,
      sculpt,
      startFrame,
      sustain,
      at: startFrame / sampleRate,
      duration: eventFrameCount / sampleRate,
      gateDuration: gateFrames / sampleRate,
      velocity: clamp(
        (0.56 + Math.sqrt(runFraction) * 0.48)
          * lerp(1, 0.82 + rawContour * 0.36, contourAmount),
        0.42,
        0.96,
      ),
    });
  });
  const bufferFrameCount = events.reduce(
    (maximum, event) => Math.max(maximum, event.startFrame + event.frameCount),
    frameCount,
  );
  return Object.freeze({
    activity: analysis.activity,
    analysis,
    activeStreams: objectMode === "connected"
      ? allRuns.filter((run) => run.objectKind === "stream").length
      : 0,
    audibleRuns: events.length,
    bufferFrameCount,
    contourSource,
    detailCapped: requestedDetail > eventBudget && allRuns.length > eventBudget,
    duration,
    envelope,
    eventBudget,
    events: Object.freeze(events),
    frameCount,
    frequencyMax: maximumFrequency,
    frequencyMin: minimumFrequency,
    newlyClosedIslands: objectMode === "connected"
      ? allRuns.filter((run) => run.objectKind === "island").length
      : 0,
    objectMode,
    pitchCurve,
    pitchTrace,
    polarity,
    phraseShape,
    releaseCapped: events.some((event) => event.releaseCapped),
    releaseLimit,
    renderDuration: bufferFrameCount / sampleRate,
    requestedDetail,
    sampleRate,
    swing,
    timbreSource,
    timeSpread,
    totalRuns: allRuns.length,
    totalObjects: allRuns.length,
  });
}

const CARPET_SETTINGS = Object.freeze({
  decay: 0.2,
  damping: 0.58,
  brightness: 0.76,
  hardness: 0.82,
  excitationColor: 0.8,
  excitationShape: 0.2,
  burstLength: 0.55,
  pickPosition: 0.24,
  pickWidth: 0.78,
  dispersion: 0.18,
  lowCut: 0.18,
  drive: 0.2,
  chorusDepth: 0,
  roughness: 0.045,
  pickupPosition: 0.66,
  pickupMix: 0.2,
  body: 0.46,
  bodyTune: 2.3,
  bodyQ: 4.5,
  coupling: 0.05,
  spread: 0,
});

const RATTLESNAKE_SETTINGS = Object.freeze({
  rangeMin: AUTOMATAPOEIA_FREQUENCY_MIN,
  rangeMax: AUTOMATAPOEIA_FREQUENCY_MAX,
  model: "karplus-strong",
  decay: 0.24,
  strikeNoise: 1.15,
  brightness: 0.64,
  inharmonicity: 0.7,
  hardness: 0.75,
});

function rattlesnakeSettings(frequency, event) {
  const settings = linearDrumKarplusStrongSettings(
    frequency,
    RATTLESNAKE_SETTINGS,
    { vertical: clamp(0.18 + event.sculpt * 0.72, 0, 1) },
  );
  return {
    ...settings,
    decay: 0.2,
    chorusDepth: 0,
    coupling: settings.coupling * 0.18,
    spread: 0,
  };
}

function carpetSettings(event) {
  return {
    ...CARPET_SETTINGS,
    damping: 0.44 + (1 - event.sculpt) * 0.3,
    brightness: 0.34 + event.sculpt * 0.62,
    hardness: 0.42 + event.sculpt * 0.54,
    dispersion: 0.05 + event.sculpt * 0.46,
    body: 0.28 + (1 - event.sculpt) * 0.32,
  };
}

function grainLayers(voice, event, options) {
  const tracedFrequency = Math.sqrt(event.frequencyStart * event.frequency);
  if (voice === "karplus-carpet") {
    return [{ frequency: tracedFrequency, gain: 1, settings: carpetSettings(event) }];
  }
  if (voice === "rattlesnake") {
    return [{
      frequency: tracedFrequency,
      gain: 1,
      settings: rattlesnakeSettings(tracedFrequency, event),
    }];
  }

  const phase = wrap01(options.generation * 0.085 + event.sculpt * 0.21);
  const maximumFrequency = Math.min(8_000, options.sampleRate * 0.42);
  const candidates = [];
  for (let octave = -2; octave <= 2; octave += 1) {
    const octaveOffset = octave + phase;
    const frequency = tracedFrequency * 2 ** octaveOffset;
    const gain = ouroborosWindow(octaveOffset, 3.5);
    if (frequency >= 35 && frequency <= maximumFrequency && gain > 0.035) {
      candidates.push({ frequency, gain });
    }
  }
  candidates.sort((left, right) => right.gain - left.gain);
  const layers = candidates.slice(0, 3);
  if (!layers.length) {
    return [{
      frequency: tracedFrequency,
      gain: 1,
      settings: rattlesnakeSettings(tracedFrequency, event),
    }];
  }
  const power = Math.sqrt(layers.reduce((sum, layer) => sum + layer.gain ** 2, 0)) || 1;
  return layers.map((layer) => ({
    ...layer,
    gain: layer.gain / power,
    settings: rattlesnakeSettings(layer.frequency, event),
  }));
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function eventSeed(options, event, layerIndex = 0) {
  let seed = Math.trunc(finiteOr(options.seed, 1)) >>> 0;
  seed ^= Math.imul(Math.trunc(finiteOr(options.rule, 30)) + 1, 0x9e3779b1);
  if (sanitizeAutomatapoeiaFamily(options.family) !== AUTOMATAPOEIA_DEFAULT_FAMILY) {
    seed ^= hashString(options.family);
  }
  seed ^= Math.imul(Math.trunc(finiteOr(options.generation, 0)) + 1, 0x85ebca6b);
  seed ^= Math.imul(event.start + 1, 0xc2b2ae35);
  seed ^= Math.imul(event.end + 1, 0x27d4eb2f);
  seed ^= Math.imul(layerIndex + 1, 0x165667b1);
  seed ^= hashString(options.voice);
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 0x7feb352d);
  seed ^= seed >>> 15;
  return seed >>> 0;
}

function generateAutomatapoeiaKarplusSamples(event, layer, options, duration) {
  const timbre = clamp(event.sculpt * 2 - 1, -1, 1);
  const base = sanitizeKarplusStrongSettings({
    ...layer.settings,
    decay: Math.max(0.2, duration),
    frequency: layer.frequency,
  });
  const settings = sanitizeKarplusStrongSettings({
    ...base,
    brightness: base.brightness + timbre * 0.06,
    coupling: base.coupling * 0.28,
    hardness: base.hardness + timbre * 0.08,
    pickPosition: base.pickPosition + timbre * 0.035,
    roughness: base.roughness + Math.abs(timbre) * 0.035,
    spread: 0,
  });
  return normalizeKarplusCarpetSamples(
    generateKarplusStrongSamples({
      ...settings,
      duration,
      random: createKarplusCarpetRandom(eventSeed(options, event, options.layerIndex)),
      sampleRate: options.sampleRate,
    }),
    options.sampleRate,
  );
}

function adsLevel(frame, event) {
  if (frame < event.attackFrames) {
    const progress = frame / Math.max(1, event.attackFrames);
    return progress * progress * (3 - 2 * progress);
  }
  if (frame < event.attackFrames + event.decayFrames) {
    const progress = (frame - event.attackFrames) / Math.max(1, event.decayFrames);
    return lerp(1, event.sustain, progress);
  }
  return event.sustain;
}

export function automatapoeiaEnvelopeAmplitude(frame, event) {
  const index = Math.max(0, Math.trunc(finiteOr(frame, 0)));
  if (index >= event.frameCount) return 0;
  if (index < event.gateFrames) return adsLevel(index, event);
  const releaseProgress = (index - event.gateFrames) / Math.max(1, event.releaseFrames - 1);
  const releaseShape = 1 - clamp(releaseProgress, 0, 1);
  return adsLevel(Math.max(0, event.gateFrames - 1), event)
    * releaseShape
    * releaseShape;
}

function mixKarplusGrain(output, startFrame, frameCount, event, layer, options) {
  const renderDuration = Math.max(0.08, frameCount / options.sampleRate);
  const samples = generateAutomatapoeiaKarplusSamples(
    event,
    layer,
    options,
    renderDuration,
  );
  const count = Math.min(frameCount, samples.length, output.length - startFrame);
  const level = event.velocity * layer.gain * options.rowGain;
  for (let index = 0; index < count; index += 1) {
    output[startFrame + index] += samples[index]
      * automatapoeiaEnvelopeAmplitude(index, event)
      * level;
  }
}

function mixFilteredRattle(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const cutoff = Math.min(options.sampleRate * 0.38, event.frequency * (1.4 + event.sculpt * 4.6));
  const coefficient = 1 - Math.exp(-Math.PI * 2 * cutoff / options.sampleRate);
  let low = 0;
  let previousBand = 0;
  let seed = eventSeed(options, event, 9) || 1;
  const level = event.velocity * options.rowGain * (0.08 + event.sculpt * 0.16);
  for (let index = 0; index < count; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0x80000000) - 1;
    low += coefficient * (noise - low);
    const band = (noise - low) * 0.72 + previousBand * 0.28;
    previousBand = band;
    const progress = index / Math.max(1, count - 1);
    output[startFrame + index] += band
      * automatapoeiaEnvelopeAmplitude(index, event)
      * Math.exp(-progress * (1.2 + event.sculpt * 3.8))
      * level;
  }
}

function eventGlide(event) {
  const start = Math.max(1, finiteOr(event.frequencyStart, event.frequency));
  const end = Math.max(1, finiteOr(event.frequency, start));
  return {
    frequency: start,
    multiplier: (end / start) ** (1 / Math.max(1, event.gateFrames)),
  };
}

function mixModalFmStrike(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const ratios = [1, 1.43 + event.sculpt * 0.24, 2.07 + event.position * 0.38, 3.16 + event.neighborhood * 0.025];
  const phases = new Float64Array(ratios.length);
  const maximumFrequency = options.sampleRate * 0.44;
  ratios.forEach((ratio, index) => {
    phases[index] = wrap01(eventSeed(options, event, index) / 0x100000000) * Math.PI * 2;
  });
  const modulationRatio = 0.47 + event.neighborhood / 14;
  const modulationIndex = 0.2 + event.sculpt * 4.8;
  const glide = eventGlide(event);
  let modulationPhase = 0;
  const level = event.velocity * options.rowGain * 0.42;
  for (let frame = 0; frame < count; frame += 1) {
    const progress = frame / Math.max(1, count - 1);
    const modulator = Math.sin(modulationPhase)
      * modulationIndex
      * (0.18 + Math.exp(-progress * 6) * 0.82);
    let signal = 0;
    let weight = 0;
    for (let mode = 0; mode < phases.length; mode += 1) {
      const modeWeight = 1 / (1 + mode * (0.65 + (1 - event.sculpt) * 0.7));
      const modeDamping = mode === 0
        ? 0.72 + Math.exp(-progress * 3.5) * 0.28
        : 0.12 + Math.exp(-progress * (2.2 + mode * 1.7)) * 0.88;
      signal += Math.sin(phases[mode] + modulator / (mode + 1))
        * modeWeight
        * modeDamping;
      weight += modeWeight;
      phases[mode] += Math.PI * 2
        * Math.min(maximumFrequency, glide.frequency * ratios[mode])
        / options.sampleRate;
      if (phases[mode] >= Math.PI * 2) phases[mode] -= Math.PI * 2;
    }
    modulationPhase += Math.PI * 2
      * Math.min(maximumFrequency, glide.frequency * modulationRatio)
      / options.sampleRate;
    if (modulationPhase >= Math.PI * 2) modulationPhase -= Math.PI * 2;
    if (frame < event.gateFrames) glide.frequency *= glide.multiplier;
    output[startFrame + frame] += (signal / Math.max(1, weight))
      * automatapoeiaEnvelopeAmplitude(frame, event)
      * level;
  }
}

function mixCascadingPm(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const maximumFrequency = options.sampleRate * 0.42;
  const ratios = [
    0.19 + event.neighborhood / 42,
    0.53 + event.sculpt * 0.41,
    1,
  ];
  const phases = new Float64Array(3);
  phases.forEach((_, index) => {
    phases[index] = wrap01(eventSeed(options, event, index + 12) / 0x100000000) * Math.PI * 2;
  });
  const glide = eventGlide(event);
  const firstIndex = 0.3 + event.sculpt * 5.7;
  const secondIndex = 0.2 + event.sculpt * 4.1;
  const level = event.velocity * options.rowGain * 0.38;
  for (let frame = 0; frame < count; frame += 1) {
    const progress = frame / Math.max(1, count - 1);
    const pressure = 0.16 + Math.exp(-progress * (1.6 + event.sculpt * 3.5)) * 0.84;
    const first = Math.sin(phases[0]);
    const second = Math.sin(phases[1] + first * firstIndex * pressure);
    const signal = Math.sin(phases[2] + second * secondIndex * pressure);
    output[startFrame + frame] += signal
      * automatapoeiaEnvelopeAmplitude(frame, event)
      * level;
    for (let operator = 0; operator < phases.length; operator += 1) {
      phases[operator] += Math.PI * 2
        * Math.min(maximumFrequency, glide.frequency * ratios[operator])
        / options.sampleRate;
      if (phases[operator] >= Math.PI * 2) phases[operator] -= Math.PI * 2;
    }
    if (frame < event.gateFrames) glide.frequency *= glide.multiplier;
  }
}

function mixGlassLattice(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const maximumFrequency = options.sampleRate * 0.44;
  const inharmonicity = 0.015 + event.sculpt * 0.18 + Math.abs(event.expansion) * 2;
  const ratios = [
    1,
    2 + inharmonicity,
    3.01 + inharmonicity * 2.3,
    4.72 + event.contour * 0.82,
    6.18 + event.neighborhood * 0.047,
  ];
  const phases = new Float64Array(ratios.length);
  const glide = eventGlide(event);
  ratios.forEach((ratio, index) => {
    phases[index] = wrap01(eventSeed(options, event, index + 20) / 0x100000000) * Math.PI * 2;
  });
  const level = event.velocity * options.rowGain * 0.34;
  for (let frame = 0; frame < count; frame += 1) {
    const progress = frame / Math.max(1, count - 1);
    let signal = 0;
    let weight = 0;
    for (let partial = 0; partial < phases.length; partial += 1) {
      const partialWeight = (1 / (1 + partial * (0.62 + (1 - event.sculpt) * 0.45)))
        * Math.exp(-progress * partial * 0.42);
      signal += Math.sin(phases[partial]) * partialWeight;
      weight += partialWeight;
      phases[partial] += Math.PI * 2
        * Math.min(maximumFrequency, glide.frequency * ratios[partial])
        / options.sampleRate;
      if (phases[partial] >= Math.PI * 2) phases[partial] -= Math.PI * 2;
    }
    if (frame < event.gateFrames) glide.frequency *= glide.multiplier;
    output[startFrame + frame] += (signal / Math.max(1, weight))
      * automatapoeiaEnvelopeAmplitude(frame, event)
      * level;
  }
}

function foldSignal(value) {
  const wrapped = ((value + 1) % 4 + 4) % 4;
  return wrapped < 2 ? wrapped - 1 : 3 - wrapped;
}

function mixWavefoldRibbon(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const maximumFrequency = options.sampleRate * 0.42;
  const modulatorRatio = 0.23 + event.neighborhood / 18;
  const drive = 1.05 + event.sculpt * 4.8;
  const cutoff = Math.min(
    options.sampleRate * 0.4,
    event.frequency * (2.5 + event.contour * 10),
  );
  const coefficient = 1 - Math.exp(-Math.PI * 2 * cutoff / options.sampleRate);
  let carrierPhase = wrap01(eventSeed(options, event, 30) / 0x100000000) * Math.PI * 2;
  let modulatorPhase = wrap01(eventSeed(options, event, 31) / 0x100000000) * Math.PI * 2;
  const glide = eventGlide(event);
  let low = 0;
  const level = event.velocity * options.rowGain * 0.38;
  for (let frame = 0; frame < count; frame += 1) {
    const modulator = Math.sin(modulatorPhase) * (0.08 + event.contour * 0.42);
    const folded = foldSignal((Math.sin(carrierPhase + modulator) + modulator * 0.5) * drive);
    low += coefficient * (folded - low);
    output[startFrame + frame] += low
      * automatapoeiaEnvelopeAmplitude(frame, event)
      * level;
    carrierPhase += Math.PI * 2 * Math.min(maximumFrequency, glide.frequency) / options.sampleRate;
    modulatorPhase += Math.PI * 2
      * Math.min(maximumFrequency, glide.frequency * modulatorRatio)
      / options.sampleRate;
    if (carrierPhase >= Math.PI * 2) carrierPhase -= Math.PI * 2;
    if (modulatorPhase >= Math.PI * 2) modulatorPhase -= Math.PI * 2;
    if (frame < event.gateFrames) glide.frequency *= glide.multiplier;
  }
}

function resonatorSettings(frequency, bandwidth, sampleRate) {
  const safeFrequency = Math.min(sampleRate * 0.44, Math.max(20, frequency));
  const radius = Math.exp(-Math.PI * Math.max(24, bandwidth) / sampleRate);
  return {
    feed: 1 - radius,
    first: 2 * radius * Math.cos(Math.PI * 2 * safeFrequency / sampleRate),
    second: -(radius * radius),
  };
}

function mixFormantDust(output, startFrame, frameCount, event, options) {
  const count = Math.min(frameCount, output.length - startFrame);
  const tracedFrequency = Math.sqrt(event.frequencyStart * event.frequency);
  const firstFormant = tracedFrequency * (1.5 + event.sculpt * 2.4);
  const secondFormant = tracedFrequency * (3.2 + event.contour * 4.8);
  const first = resonatorSettings(firstFormant, 90 + (1 - event.sculpt) * 260, options.sampleRate);
  const second = resonatorSettings(secondFormant, 140 + event.sculpt * 420, options.sampleRate);
  const pulseIncrement = Math.PI * 2
    * Math.min(options.sampleRate * 0.4, tracedFrequency * 0.5)
    / options.sampleRate;
  let firstY1 = 0;
  let firstY2 = 0;
  let secondY1 = 0;
  let secondY2 = 0;
  let pulsePhase = 0;
  let seed = eventSeed(options, event, 40) || 1;
  const level = event.velocity * options.rowGain * 0.44;
  for (let frame = 0; frame < count; frame += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0x80000000) - 1;
    const source = noise * (0.72 + event.sculpt * 0.2) + Math.sin(pulsePhase) * 0.18;
    const firstOutput = first.feed * source + first.first * firstY1 + first.second * firstY2;
    const secondOutput = second.feed * source + second.first * secondY1 + second.second * secondY2;
    firstY2 = firstY1;
    firstY1 = firstOutput;
    secondY2 = secondY1;
    secondY1 = secondOutput;
    const signal = Math.tanh((firstOutput * 0.78 + secondOutput * 0.56) * 1.5);
    output[startFrame + frame] += signal
      * automatapoeiaEnvelopeAmplitude(frame, event)
      * level;
    pulsePhase += pulseIncrement;
    if (pulsePhase >= Math.PI * 2) pulsePhase -= Math.PI * 2;
  }
}

function finishRowBuffer(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0.78) return samples;
  const gain = 0.78 / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
  return samples;
}

export function renderAutomatapoeiaRow(cells = [], options = {}) {
  const sampleRate = clamp(finiteOr(options.sampleRate, 48_000), 8_000, 384_000);
  const voice = sanitizeAutomatapoeiaVoice(options.voice);
  const generation = Math.max(0, Math.trunc(finiteOr(options.generation, 0)));
  const plan = buildAutomatapoeiaEvents(cells, { ...options, sampleRate });
  const samples = new Float32Array(plan.bufferFrameCount);
  const overlapRows = Math.max(1, Math.ceil(plan.bufferFrameCount / plan.frameCount));
  const rowGain = 1 / Math.sqrt(Math.max(1, plan.events.length) * overlapRows);

  for (const event of plan.events) {
    const renderOptions = { ...options, generation, rowGain, sampleRate, voice };
    if (voice === "modal-fm") {
      mixModalFmStrike(samples, event.startFrame, event.frameCount, event, renderOptions);
      continue;
    }
    if (voice === "cascade-pm") {
      mixCascadingPm(samples, event.startFrame, event.frameCount, event, renderOptions);
      continue;
    }
    if (voice === "glass-lattice") {
      mixGlassLattice(samples, event.startFrame, event.frameCount, event, renderOptions);
      continue;
    }
    if (voice === "wavefold-ribbon") {
      mixWavefoldRibbon(samples, event.startFrame, event.frameCount, event, renderOptions);
      continue;
    }
    if (voice === "formant-dust") {
      mixFormantDust(samples, event.startFrame, event.frameCount, event, renderOptions);
      continue;
    }
    const layers = grainLayers(voice, event, renderOptions);
    layers.forEach((layer, layerIndex) => {
      mixKarplusGrain(samples, event.startFrame, event.frameCount, event, layer, {
        ...renderOptions,
        layerIndex,
      });
    });
    if (voice === "rattlesnake") {
      mixFilteredRattle(samples, event.startFrame, event.frameCount, event, renderOptions);
    }
  }

  return Object.freeze({
    activity: plan.activity,
    analysis: plan.analysis,
    activeStreams: plan.activeStreams,
    audibleRuns: plan.audibleRuns,
    detailCapped: plan.detailCapped,
    duration: plan.duration,
    eventBudget: plan.eventBudget,
    events: plan.events,
    newlyClosedIslands: plan.newlyClosedIslands,
    objectMode: plan.objectMode,
    releaseCapped: plan.releaseCapped,
    releaseLimit: plan.releaseLimit,
    renderDuration: plan.renderDuration,
    sampleRate,
    samples: finishRowBuffer(samples),
    totalRuns: plan.totalRuns,
    totalObjects: plan.totalObjects,
    voice,
  });
}
