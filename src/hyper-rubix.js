/**
 * Pure state and geometry helpers for a 3 x 3 x 3 x 3 twisty puzzle on the
 * boundary of a tesseract.
 *
 * A tesseract has eight cubical boundary cells. Each cell owns a 3 x 3 x 3
 * field of coloured surface records, giving 8 * 27 = 216 records. A move
 * selects one boundary cell and rotates its outer hyper-layer by an exact
 * quarter turn in one of the cell's three tangent coordinate planes.
 *
 * Puzzle coordinates are always integers in {-1, 0, 1}. View rotation and
 * perspective projection are deliberately separate and never mutate state.
 */

export const HYPER_RUBIX_SIZE = 3;
export const HYPER_RUBIX_RADIUS = 1;
export const HYPER_RUBIX_STICKERS_PER_CELL = HYPER_RUBIX_SIZE ** 3;
export const HYPER_RUBIX_STICKER_COUNT = 8 * HYPER_RUBIX_STICKERS_PER_CELL;
export const HYPER_RUBIX_AXES = Object.freeze(["x", "y", "z", "w"]);
export const HYPER_RUBIX_LAYERS = Object.freeze([-1, 0, 1]);
export const HYPER_RUBIX_PLANES = Object.freeze([
  "xy",
  "xz",
  "xw",
  "yz",
  "yw",
  "zw",
]);
export const HYPER_RUBIX_SEQUENCE_LENGTH = 16;

/** Drum identity assigned to each of the six coordinate planes. */
export const HYPER_RUBIX_PLANE_DRUMS = Object.freeze({
  xy: Object.freeze({ id: "kick", family: "kick", label: "Kick" }),
  xz: Object.freeze({ id: "snare", family: "snare", label: "Snare" }),
  yz: Object.freeze({ id: "hat", family: "hat", label: "Hat" }),
  xw: Object.freeze({ id: "tom", family: "tom", label: "Tom" }),
  yw: Object.freeze({ id: "clap", family: "clap", label: "Clap" }),
  zw: Object.freeze({ id: "metal", family: "metal", label: "Metal" }),
});

/** Stable UI metadata for the built-in 16-step move patterns. */
export const HYPER_RUBIX_SEQUENCE_PATTERNS = Object.freeze({
  "axis-break": Object.freeze({
    id: "axis-break",
    label: "Axis break",
    description: "A broken XYZ backbeat punctured by three fourth-axis turns.",
    stochastic: false,
  }),
  "straight-xyz": Object.freeze({
    id: "straight-xyz",
    label: "Straight XYZ",
    description: "An even cycle through the three ordinary-space coordinate planes.",
    stochastic: false,
  }),
  "w-pressure": Object.freeze({
    id: "w-pressure",
    label: "W pressure",
    description: "A fourth-axis pattern built from XW, YW, and ZW turns.",
    stochastic: false,
  }),
  "random-walk": Object.freeze({
    id: "random-walk",
    label: "Random walk",
    description: "A reproducible-friendly walk across legal boundary-cell slices.",
    stochastic: true,
  }),
});

export const HYPER_RUBIX_COLORS = Object.freeze({
  red: "#ff645f",
  orange: "#ffad52",
  white: "#edf6ee",
  yellow: "#f5d85c",
  green: "#70e06f",
  blue: "#458cff",
  violet: "#c79bff",
  cyan: "#62dbff",
});

const axisIndex = new Map(HYPER_RUBIX_AXES.map((axis, index) => [axis, index]));
const zeroVector = () => ({ x: 0, y: 0, z: 0, w: 0 });
const vector4 = (x, y, z, w) => Object.freeze({ x, y, z, w });
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const cleanZero = (value) => (
  Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
);

function canonicalPlane(first, second) {
  if (!axisIndex.has(first) || !axisIndex.has(second) || first === second) {
    throw new RangeError(`Invalid 4D coordinate plane: ${String(first)}${String(second)}`);
  }
  return axisIndex.get(first) < axisIndex.get(second)
    ? `${first}${second}`
    : `${second}${first}`;
}

function tangentAxesFor(axis) {
  return HYPER_RUBIX_AXES.filter((candidate) => candidate !== axis);
}

function tangentPlanesFor(axis) {
  const tangent = tangentAxesFor(axis);
  return Object.freeze([
    canonicalPlane(tangent[0], tangent[1]),
    canonicalPlane(tangent[0], tangent[2]),
    canonicalPlane(tangent[1], tangent[2]),
  ]);
}

function boundaryCell(id, axis, sign, color) {
  const normal = zeroVector();
  normal[axis] = sign;
  return Object.freeze({
    id,
    axis,
    sign,
    color,
    fill: HYPER_RUBIX_COLORS[color],
    normal: Object.freeze(normal),
    tangentAxes: Object.freeze(tangentAxesFor(axis)),
    tangentPlanes: tangentPlanesFor(axis),
  });
}

/** The eight cubical facets of a tesseract, in stable display order. */
export const HYPER_RUBIX_BOUNDARY_CELLS = Object.freeze({
  "x+": boundaryCell("x+", "x", 1, "red"),
  "x-": boundaryCell("x-", "x", -1, "orange"),
  "y+": boundaryCell("y+", "y", 1, "white"),
  "y-": boundaryCell("y-", "y", -1, "yellow"),
  "z+": boundaryCell("z+", "z", 1, "green"),
  "z-": boundaryCell("z-", "z", -1, "blue"),
  "w+": boundaryCell("w+", "w", 1, "violet"),
  "w-": boundaryCell("w-", "w", -1, "cyan"),
});

export const HYPER_RUBIX_CELL_ORDER = Object.freeze(
  Object.keys(HYPER_RUBIX_BOUNDARY_CELLS),
);

const cellByNormalKey = new Map(HYPER_RUBIX_CELL_ORDER.map((id) => {
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[id];
  return [`${cell.axis}:${cell.sign}`, cell];
}));

export function hyperRubixBoundaryCell(id) {
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[id];
  if (!cell) throw new RangeError(`Unknown Hyper Rubix boundary cell: ${String(id)}`);
  return cell;
}

function finiteVector4(source, label = "4D point") {
  if (!source || typeof source !== "object") {
    throw new TypeError(`${label} must be an object with finite x, y, z, and w coordinates.`);
  }
  const result = zeroVector();
  for (const axis of HYPER_RUBIX_AXES) {
    const value = Number(source[axis]);
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must have a finite ${axis} coordinate.`);
    }
    result[axis] = cleanZero(value);
  }
  return result;
}

function normalDescriptor(normal) {
  const source = finiteVector4(normal, "4D normal");
  const nonzero = HYPER_RUBIX_AXES.filter((axis) => source[axis] !== 0);
  if (nonzero.length !== 1 || Math.abs(source[nonzero[0]]) !== 1) return null;
  return { axis: nonzero[0], sign: source[nonzero[0]] };
}

export function hyperRubixCellForNormal(normal) {
  const descriptor = normalDescriptor(normal);
  if (!descriptor) return null;
  return cellByNormalKey.get(`${descriptor.axis}:${descriptor.sign}`) ?? null;
}

function freezeSticker(sticker) {
  return Object.freeze({
    ...sticker,
    homeAddress: Object.freeze([...sticker.homeAddress]),
    homePosition: vector4(
      sticker.homePosition.x,
      sticker.homePosition.y,
      sticker.homePosition.z,
      sticker.homePosition.w,
    ),
    homeNormal: vector4(
      sticker.homeNormal.x,
      sticker.homeNormal.y,
      sticker.homeNormal.z,
      sticker.homeNormal.w,
    ),
    position: vector4(
      sticker.position.x,
      sticker.position.y,
      sticker.position.z,
      sticker.position.w,
    ),
    normal: vector4(
      sticker.normal.x,
      sticker.normal.y,
      sticker.normal.z,
      sticker.normal.w,
    ),
  });
}

function freezePuzzle(stickers) {
  return Object.freeze({
    size: HYPER_RUBIX_SIZE,
    radius: HYPER_RUBIX_RADIUS,
    stickers: Object.freeze(stickers),
  });
}

/** Construct the canonical solved 216-record tesseract surface. */
export function createSolvedHyperRubix() {
  const stickers = [];
  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const cell = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    const [first, second, third] = cell.tangentAxes;
    for (let firstIndex = 0; firstIndex < HYPER_RUBIX_SIZE; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < HYPER_RUBIX_SIZE; secondIndex += 1) {
        for (let thirdIndex = 0; thirdIndex < HYPER_RUBIX_SIZE; thirdIndex += 1) {
          const position = zeroVector();
          position[cell.axis] = cell.sign * HYPER_RUBIX_RADIUS;
          position[first] = HYPER_RUBIX_LAYERS[firstIndex];
          position[second] = HYPER_RUBIX_LAYERS[secondIndex];
          position[third] = HYPER_RUBIX_LAYERS[thirdIndex];
          stickers.push(freezeSticker({
            id: `${cellId}:${firstIndex}:${secondIndex}:${thirdIndex}`,
            color: cell.color,
            homeCell: cellId,
            homeAddress: [firstIndex, secondIndex, thirdIndex],
            homePosition: position,
            homeNormal: cell.normal,
            position,
            normal: cell.normal,
          }));
        }
      }
    }
  }
  return freezePuzzle(stickers);
}

/**
 * Validate the exact surface representation used by the move engine.
 * Reachability is intentionally not inferred; this checks structural and
 * geometric invariants only.
 */
export function assertHyperRubixPuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== "object") {
    throw new TypeError("A Hyper Rubix puzzle must be an object.");
  }
  if (puzzle.size !== HYPER_RUBIX_SIZE || puzzle.radius !== HYPER_RUBIX_RADIUS) {
    throw new RangeError("Hyper Rubix state must use the fixed 3 x 3 x 3, radius-1 model.");
  }
  if (!Array.isArray(puzzle.stickers) || puzzle.stickers.length !== HYPER_RUBIX_STICKER_COUNT) {
    throw new TypeError(
      `Hyper Rubix state must contain exactly ${HYPER_RUBIX_STICKER_COUNT} stickers.`,
    );
  }

  const ids = new Set();
  const slotsByCell = new Map(HYPER_RUBIX_CELL_ORDER.map((id) => [id, new Set()]));
  for (const sticker of puzzle.stickers) {
    if (!sticker || typeof sticker.id !== "string" || ids.has(sticker.id)) {
      throw new TypeError("Hyper Rubix sticker IDs must be unique strings.");
    }
    ids.add(sticker.id);
    if (!Object.hasOwn(HYPER_RUBIX_COLORS, sticker.color)) {
      throw new RangeError(`Sticker ${sticker.id} has an unknown color.`);
    }

    const position = finiteVector4(sticker.position, `Sticker ${sticker.id} position`);
    if (HYPER_RUBIX_AXES.some((axis) => !HYPER_RUBIX_LAYERS.includes(position[axis]))) {
      throw new RangeError(`Sticker ${sticker.id} is outside the exact puzzle lattice.`);
    }
    const cell = hyperRubixCellForNormal(sticker.normal);
    if (!cell || position[cell.axis] !== cell.sign * HYPER_RUBIX_RADIUS) {
      throw new RangeError(`Sticker ${sticker.id} is not outward-facing on a boundary cell.`);
    }
    const slotKey = HYPER_RUBIX_AXES.map((axis) => position[axis]).join(":");
    const slots = slotsByCell.get(cell.id);
    if (slots.has(slotKey)) {
      throw new TypeError(`Boundary cell ${cell.id} contains duplicate sticker slots.`);
    }
    slots.add(slotKey);
  }

  for (const [cellId, slots] of slotsByCell) {
    if (slots.size !== HYPER_RUBIX_STICKERS_PER_CELL) {
      throw new TypeError(
        `Boundary cell ${cellId} must contain ${HYPER_RUBIX_STICKERS_PER_CELL} stickers.`,
      );
    }
  }
  return puzzle;
}

function normalizedQuarterTurns(value) {
  const turns = Number(value);
  if (!Number.isInteger(turns)) {
    throw new TypeError("Hyper Rubix quarterTurns must be an integer.");
  }
  const wrapped = ((turns % 4) + 4) % 4;
  if (wrapped === 3) return -1;
  return wrapped;
}

export function normalizeHyperRubixMove(move) {
  if (!move || typeof move !== "object") {
    throw new TypeError("A Hyper Rubix move must be an object.");
  }
  const cell = hyperRubixBoundaryCell(move.cell);
  const plane = String(move.plane ?? "").toLowerCase();
  if (!HYPER_RUBIX_PLANES.includes(plane) || !cell.tangentPlanes.includes(plane)) {
    throw new RangeError(
      `${String(move.plane)} is not a tangent plane of boundary cell ${cell.id}.`,
    );
  }
  const quarterTurns = normalizedQuarterTurns(move.quarterTurns ?? move.turns ?? 1);
  return Object.freeze({ cell: cell.id, plane, quarterTurns });
}

export function hyperRubixMoveKey(move) {
  const normalized = normalizeHyperRubixMove(move);
  const sign = normalized.quarterTurns > 0 ? "+" : "";
  return `${normalized.cell}:${normalized.plane}:${sign}${normalized.quarterTurns}`;
}

export function invertHyperRubixMove(move) {
  const normalized = normalizeHyperRubixMove(move);
  return normalizeHyperRubixMove({
    ...normalized,
    quarterTurns: -normalized.quarterTurns,
  });
}

export function invertHyperRubixMoves(moves) {
  if (!Array.isArray(moves)) throw new TypeError("Hyper Rubix moves must be an array.");
  return Object.freeze([...moves].reverse().map(invertHyperRubixMove));
}

/** The 48 directed face-plane quarter turns, in deterministic order. */
export const HYPER_RUBIX_BASIC_MOVES = Object.freeze(HYPER_RUBIX_CELL_ORDER.flatMap(
  (cellId) => HYPER_RUBIX_BOUNDARY_CELLS[cellId].tangentPlanes.flatMap((plane) => [
    Object.freeze({ cell: cellId, plane, quarterTurns: 1 }),
    Object.freeze({ cell: cellId, plane, quarterTurns: -1 }),
  ]),
));

const AXIS_BREAK_PLANES = Object.freeze([
  "xy", "yz", null, "yz",
  "xz", "yz", "xy", "yw",
  "xy", "yz", "xw", "yz",
  "xz", "yz", "xy", "zw",
]);
const STRAIGHT_XYZ_PLANES = Object.freeze([
  "xy", "yz", "xz", "yz",
  "xy", "yz", "xz", "yz",
  "xy", "yz", "xz", "yz",
  "xy", "yz", "xz", "yz",
]);
const W_PRESSURE_PLANES = Object.freeze([
  "xw", "yw", null, "zw",
  "xw", "yw", "zw", "yw",
  "xw", "yw", null, "zw",
  "xw", "yw", "zw", "yw",
]);
const SEQUENCE_PLANES_BY_PATTERN = Object.freeze({
  "axis-break": AXIS_BREAK_PLANES,
  "straight-xyz": STRAIGHT_XYZ_PLANES,
  "w-pressure": W_PRESSURE_PLANES,
});
const DENSITY_THRESHOLD_BY_PHASE = Object.freeze([0, 0.5, 0.25, 1]);
const SEQUENCE_INDEX_MODES = Object.freeze(["forward", "reverse", "pendulum", "random"]);

function assertFiniteSequenceNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function assertSequenceRandom(random) {
  if (typeof random !== "function") {
    throw new TypeError("Hyper Rubix sequence random source must be a function.");
  }
  return random;
}

function sequenceRandomValue(random) {
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Hyper Rubix sequence random source must return values in [0, 1).");
  }
  return value;
}

function sequenceDensity(value) {
  const density = assertFiniteSequenceNumber(value, "Hyper Rubix sequence density");
  if (density < 0 || density > 1) {
    throw new RangeError("Hyper Rubix sequence density must be between 0 and 1.");
  }
  return density;
}

function sequenceCellAxisForPlane(plane) {
  if (!plane.includes("w")) return "w";
  return HYPER_RUBIX_AXES.find((axis) => !plane.includes(axis));
}

function deterministicSequenceMoves(patternId) {
  const planes = SEQUENCE_PLANES_BY_PATTERN[patternId];
  let moveOrdinal = 0;
  return planes.map((plane) => {
    if (plane === null) return null;
    const sign = moveOrdinal % 2 === 0 ? "+" : "-";
    const cellAxis = sequenceCellAxisForPlane(plane);
    const move = normalizeHyperRubixMove({
      cell: `${cellAxis}${sign}`,
      plane,
      quarterTurns: moveOrdinal % 2 === 0 ? 1 : -1,
    });
    moveOrdinal += 1;
    return move;
  });
}

function randomWalkSequenceMoves(random) {
  const moves = [];
  let previousSlice = null;
  for (let index = 0; index < HYPER_RUBIX_SEQUENCE_LENGTH; index += 1) {
    const candidates = previousSlice === null
      ? HYPER_RUBIX_BASIC_MOVES
      : HYPER_RUBIX_BASIC_MOVES.filter(
        (move) => `${move.cell}:${move.plane}` !== previousSlice,
      );
    const move = candidates[Math.floor(sequenceRandomValue(random) * candidates.length)];
    const normalized = normalizeHyperRubixMove(move);
    moves.push(normalized);
    previousSlice = `${normalized.cell}:${normalized.plane}`;
  }
  return moves;
}

/**
 * Build one immutable 16-step move score. Density gates fixed rhythmic phases,
 * so reducing it never changes a step's authored move or drum identity.
 */
export function createHyperRubixSequence(
  patternId = "axis-break",
  density = 1,
  random = Math.random,
) {
  const pattern = HYPER_RUBIX_SEQUENCE_PATTERNS[patternId];
  if (!pattern) throw new RangeError(`Unknown Hyper Rubix sequence pattern: ${String(patternId)}`);
  const safeDensity = sequenceDensity(density);
  const randomSource = assertSequenceRandom(random);
  const moves = pattern.stochastic
    ? randomWalkSequenceMoves(randomSource)
    : deterministicSequenceMoves(pattern.id);

  return Object.freeze(moves.map((move, index) => {
    const accent = index % 4 === 0;
    const active = Boolean(
      move
      && (accent || safeDensity >= DENSITY_THRESHOLD_BY_PHASE[index % 4]),
    );
    return Object.freeze({
      index,
      move,
      active,
      accent,
      drum: move ? HYPER_RUBIX_PLANE_DRUMS[move.plane] : null,
    });
  }));
}

/** Resolve a transport position through one of the four 16-step traversal modes. */
export function hyperRubixSequenceIndex(
  mode = "forward",
  transportStep = 0,
  length = HYPER_RUBIX_SEQUENCE_LENGTH,
  random = Math.random,
) {
  if (!SEQUENCE_INDEX_MODES.includes(mode)) {
    throw new RangeError(`Unknown Hyper Rubix sequence mode: ${String(mode)}`);
  }
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("Hyper Rubix sequence length must be a positive integer.");
  }
  if (!Number.isInteger(transportStep)) {
    throw new TypeError("Hyper Rubix transport step must be an integer.");
  }
  if (mode === "random") {
    return Math.floor(sequenceRandomValue(assertSequenceRandom(random)) * length);
  }

  const wrapped = ((transportStep % length) + length) % length;
  if (mode === "forward") return wrapped;
  if (mode === "reverse") return length - 1 - wrapped;
  if (length === 1) return 0;
  const period = 2 * (length - 1);
  const pendulumStep = ((transportStep % period) + period) % period;
  return pendulumStep < length ? pendulumStep : period - pendulumStep;
}

/** Return a long/short swung duration for one sequencer subdivision. */
export function hyperRubixStepDurationSeconds(
  tempo = 112,
  subdivisionsPerBeat = 2,
  swing = 0.08,
  swingStep = 0,
) {
  const safeTempo = clamp(
    assertFiniteSequenceNumber(tempo, "Hyper Rubix tempo"),
    30,
    300,
  );
  const subdivisions = Number(subdivisionsPerBeat);
  if (![1, 2, 4].includes(subdivisions)) {
    throw new RangeError("Hyper Rubix subdivisions per beat must be 1, 2, or 4.");
  }
  const safeSwing = clamp(
    assertFiniteSequenceNumber(swing, "Hyper Rubix swing"),
    0,
    0.42,
  );
  if (!Number.isInteger(swingStep)) {
    throw new TypeError("Hyper Rubix swing step must be an integer.");
  }
  const straight = 60 / safeTempo / subdivisions;
  return straight * (Math.abs(swingStep) % 2 === 0 ? 1 + safeSwing : 1 - safeSwing);
}

/** Rotate a vector exactly in one of the six coordinate planes. */
export function rotateHyperRubixQuarterVector(source, plane, quarterTurns = 1) {
  const result = finiteVector4(source, "4D vector");
  const planeId = String(plane ?? "").toLowerCase();
  if (!HYPER_RUBIX_PLANES.includes(planeId)) {
    throw new RangeError(`Unknown 4D coordinate plane: ${String(plane)}`);
  }
  const turns = normalizedQuarterTurns(quarterTurns);
  const iterations = turns < 0 ? turns + 4 : turns;
  const [first, second] = planeId;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const firstValue = result[first];
    result[first] = cleanZero(-result[second]);
    result[second] = cleanZero(firstValue);
  }
  return result;
}

export function hyperRubixMoveAffectsSticker(sticker, move) {
  const normalized = normalizeHyperRubixMove(move);
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[normalized.cell];
  const position = finiteVector4(sticker?.position, "Sticker position");
  return position[cell.axis] === cell.sign * HYPER_RUBIX_RADIUS;
}

/** Apply one exact outer-cell turn and return a new immutable puzzle. */
export function turnHyperRubixBoundaryCell(puzzle, move) {
  assertHyperRubixPuzzle(puzzle);
  const normalized = normalizeHyperRubixMove(move);
  if (normalized.quarterTurns === 0) return puzzle;
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[normalized.cell];
  const slice = cell.sign * HYPER_RUBIX_RADIUS;
  const stickers = puzzle.stickers.map((sticker) => {
    if (sticker.position[cell.axis] !== slice) return sticker;
    return freezeSticker({
      ...sticker,
      position: rotateHyperRubixQuarterVector(
        sticker.position,
        normalized.plane,
        normalized.quarterTurns,
      ),
      normal: rotateHyperRubixQuarterVector(
        sticker.normal,
        normalized.plane,
        normalized.quarterTurns,
      ),
    });
  });
  return freezePuzzle(stickers);
}

export function applyHyperRubixMoves(puzzle, moves) {
  if (!Array.isArray(moves)) throw new TypeError("Hyper Rubix moves must be an array.");
  return moves.reduce(turnHyperRubixBoundaryCell, puzzle);
}

export function hyperRubixDisorderCount(puzzle) {
  assertHyperRubixPuzzle(puzzle);
  return puzzle.stickers.reduce((count, sticker) => {
    const currentCell = hyperRubixCellForNormal(sticker.normal);
    return count + Number(currentCell?.color !== sticker.color);
  }, 0);
}

/** Fraction of stickers on a cell whose solved colour differs, from 0 through 1. */
export function hyperRubixDisorder(puzzle) {
  return hyperRubixDisorderCount(puzzle) / HYPER_RUBIX_STICKER_COUNT;
}

export function isHyperRubixSolved(puzzle) {
  return hyperRubixDisorderCount(puzzle) === 0;
}

/** Small deterministic PRNG suitable for reproducible UI scrambles and tests. */
export function createSeededHyperRubixRandom(seed = 0x48595045) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Produce a reproducible-friendly move list. Pass an injected random function;
 * consecutive moves never target the same cell-plane slice.
 */
export function createHyperRubixScramble(length = 24, random = Math.random) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError("Hyper Rubix scramble length must be a non-negative integer.");
  }
  if (typeof random !== "function") {
    throw new TypeError("Hyper Rubix scramble random source must be a function.");
  }
  const moves = [];
  let previousSlice = null;
  while (moves.length < length) {
    const value = Number(random());
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("Hyper Rubix random source must return values in [0, 1).");
    }
    const candidates = previousSlice === null
      ? HYPER_RUBIX_BASIC_MOVES
      : HYPER_RUBIX_BASIC_MOVES.filter(
        (move) => `${move.cell}:${move.plane}` !== previousSlice,
      );
    const candidate = candidates[Math.floor(value * candidates.length)];
    const slice = `${candidate.cell}:${candidate.plane}`;
    moves.push(candidate);
    previousSlice = slice;
  }
  return Object.freeze(moves);
}

function rotatePlaneDegrees(point, plane, degrees) {
  const angle = degrees * Math.PI / 180;
  if (angle === 0) return point;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const [first, second] = plane;
  const firstValue = point[first];
  const secondValue = point[second];
  return {
    ...point,
    [first]: cleanZero(firstValue * cosine - secondValue * sine),
    [second]: cleanZero(firstValue * sine + secondValue * cosine),
  };
}

/** Apply all six 4D plane rotations, in stable xy/xz/xw/yz/yw/zw order. */
export function rotateHyperRubixPoint4(point, rotation = {}) {
  let result = finiteVector4(point);
  for (const plane of HYPER_RUBIX_PLANES) {
    const degrees = Number(rotation?.[plane] ?? 0);
    if (!Number.isFinite(degrees)) {
      throw new TypeError(`4D rotation ${plane} must be finite degrees.`);
    }
    result = rotatePlaneDegrees(result, plane, degrees);
  }
  return result;
}

/** Perspective-project a 4D point into 3D, looking toward decreasing W. */
export function projectHyperRubixPoint4(point, distance = 4) {
  const source = finiteVector4(point);
  const cameraDistance = Number(distance);
  if (!Number.isFinite(cameraDistance) || cameraDistance <= 0) {
    throw new RangeError("4D projection distance must be a positive finite number.");
  }
  const depth = cameraDistance - source.w;
  if (depth <= 1e-9) {
    throw new RangeError("4D point must remain in front of the projection camera.");
  }
  const factor = cameraDistance / depth;
  return {
    x: source.x * factor,
    y: source.y * factor,
    z: source.z * factor,
    w: source.w,
    depth,
    factor,
  };
}

function freezeWireframeCell(cell) {
  return Object.freeze({
    ...cell,
    vertexIndices: Object.freeze(cell.vertexIndices),
    edgeIndices: Object.freeze(cell.edgeIndices),
  });
}

/** Generate the exact 16-vertex, 32-edge wireframe and its eight cubical cells. */
export function buildHyperRubixTesseractWireframe(radius = HYPER_RUBIX_RADIUS) {
  const safeRadius = Number(radius);
  if (!Number.isFinite(safeRadius) || safeRadius <= 0) {
    throw new RangeError("Tesseract radius must be a positive finite number.");
  }
  const vertices = Array.from({ length: 16 }, (_, index) => Object.freeze({
    id: index,
    x: index & 1 ? safeRadius : -safeRadius,
    y: index & 2 ? safeRadius : -safeRadius,
    z: index & 4 ? safeRadius : -safeRadius,
    w: index & 8 ? safeRadius : -safeRadius,
  }));
  const edges = [];
  for (let index = 0; index < vertices.length; index += 1) {
    HYPER_RUBIX_AXES.forEach((axis, bit) => {
      const neighbor = index ^ (1 << bit);
      if (index < neighbor) {
        edges.push(Object.freeze({
          id: edges.length,
          a: index,
          b: neighbor,
          axis,
        }));
      }
    });
  }
  const cells = HYPER_RUBIX_CELL_ORDER.map((cellId) => {
    const definition = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    const vertexIndices = vertices
      .filter((vertex) => vertex[definition.axis] === definition.sign * safeRadius)
      .map((vertex) => vertex.id);
    const vertexSet = new Set(vertexIndices);
    const edgeIndices = edges
      .filter((edge) => vertexSet.has(edge.a) && vertexSet.has(edge.b))
      .map((edge) => edge.id);
    return freezeWireframeCell({
      id: cellId,
      axis: definition.axis,
      sign: definition.sign,
      color: definition.color,
      fill: definition.fill,
      vertexIndices,
      edgeIndices,
    });
  });
  return Object.freeze({
    radius: safeRadius,
    vertices: Object.freeze(vertices),
    edges: Object.freeze(edges),
    cells: Object.freeze(cells),
  });
}
