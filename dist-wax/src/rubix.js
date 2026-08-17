/**
 * Pure N x N Rubix cube state, projection, and sequencer mappings.
 *
 * Cube moves only rotate exact integer or half-integer sticker positions and
 * integer normals. Camera helpers are deliberately separate, so dragging the
 * view never mutates the puzzle.
 */

export const RUBIX_SIZE = 3;
export const RUBIX_AXES = Object.freeze(["x", "y", "z"]);
export const RUBIX_LAYERS = Object.freeze([-1, 0, 1]);
export const RUBIX_COLOR_ORDER = Object.freeze([
  "white",
  "yellow",
  "green",
  "blue",
  "red",
  "orange",
]);

const vector = (x, y, z) => Object.freeze({ x, y, z });
const layerCache = new Map([[RUBIX_SIZE, RUBIX_LAYERS]]);

function assertRubixSize(size) {
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Rubix size must be an integer of at least 2.");
  }
  return size;
}

/** Return the exact, centered layer coordinates for an N x N cube. */
export function rubixLayersForSize(size = RUBIX_SIZE) {
  const safeSize = assertRubixSize(size);
  const cached = layerCache.get(safeSize);
  if (cached) return cached;
  const radius = (safeSize - 1) / 2;
  const layers = Object.freeze(Array.from(
    { length: safeSize },
    (_, index) => index - radius,
  ));
  layerCache.set(safeSize, layers);
  return layers;
}

/**
 * Face-local right/down vectors describe a face as seen from outside the cube.
 * A sticker at row/column is `normal * radius + right * layer[column]
 * + down * layer[row]`.
 */
export const RUBIX_FACE_DEFINITIONS = Object.freeze({
  up: Object.freeze({
    id: "up",
    color: "white",
    normal: vector(0, 1, 0),
    right: vector(1, 0, 0),
    down: vector(0, 0, 1),
  }),
  down: Object.freeze({
    id: "down",
    color: "yellow",
    normal: vector(0, -1, 0),
    right: vector(1, 0, 0),
    down: vector(0, 0, -1),
  }),
  front: Object.freeze({
    id: "front",
    color: "green",
    normal: vector(0, 0, 1),
    right: vector(1, 0, 0),
    down: vector(0, -1, 0),
  }),
  back: Object.freeze({
    id: "back",
    color: "blue",
    normal: vector(0, 0, -1),
    right: vector(-1, 0, 0),
    down: vector(0, -1, 0),
  }),
  right: Object.freeze({
    id: "right",
    color: "red",
    normal: vector(1, 0, 0),
    right: vector(0, 0, -1),
    down: vector(0, -1, 0),
  }),
  left: Object.freeze({
    id: "left",
    color: "orange",
    normal: vector(-1, 0, 0),
    right: vector(0, 0, 1),
    down: vector(0, -1, 0),
  }),
});

export const RUBIX_FACE_ORDER = Object.freeze(Object.keys(RUBIX_FACE_DEFINITIONS));

export const RUBIX_SEQUENCE_ROLES = Object.freeze(["acid", "drumLeft", "drumRight"]);
export const RUBIX_ROW_MAJOR_ORDER = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]);
export const RUBIX_SNAKE_ORDER = Object.freeze([0, 1, 2, 5, 4, 3, 6, 7, 8]);

/** Declarative read paths consumed by the Rubix transport and UI. */
export const RUBIX_READ_MODES = Object.freeze({
  parallel: Object.freeze({
    id: "parallel",
    label: "Rows together",
    summary: "all 3 faces · 9 steps",
    stepCount: 9,
    subdivisionsPerBeat: 1,
    roleMode: "all",
    roleOrder: RUBIX_SEQUENCE_ROLES,
    cellOrder: RUBIX_ROW_MAJOR_ORDER,
    path: "row-major",
  }),
  snake: Object.freeze({
    id: "snake",
    label: "Snake together",
    summary: "all 3 faces · 9 steps",
    stepCount: 9,
    subdivisionsPerBeat: 1,
    roleMode: "all",
    roleOrder: RUBIX_SEQUENCE_ROLES,
    cellOrder: RUBIX_SNAKE_ORDER,
    path: "snake",
  }),
  face: Object.freeze({
    id: "face",
    label: "Alternate faces",
    summary: "3 face subdivisions · 9 beats",
    stepCount: 27,
    subdivisionsPerBeat: RUBIX_SEQUENCE_ROLES.length,
    roleMode: "alternating",
    roleOrder: RUBIX_SEQUENCE_ROLES,
    cellOrder: RUBIX_SNAKE_ORDER,
    path: "snake",
  }),
});

/** A conventional isometric view: white above, green left, and red right. */
export const DEFAULT_RUBIX_CAMERA = Object.freeze({ x: 30, y: -45, z: 0 });

/** Acid notes remain inside the WebGPU 303 default note-number window. */
export const RUBIX_ACID_NOTE_SPAN = 38;
export const RUBIX_ACID_MIDI_BY_COLOR = Object.freeze({
  white: 40,
  yellow: 28,
  green: 35,
  blue: 33,
  red: 38,
  orange: 31,
});

/** Front/left screen lane: a compact, softened kick/snare/tom/hat kit. */
export const RUBIX_DRUM_LEFT_VOICE_BY_COLOR = Object.freeze({
  white: 6,
  yellow: 7,
  green: 2,
  blue: 5,
  red: 0,
  orange: 4,
});

/** Right screen lane: complementary kit voices, avoiding same-step doubling. */
export const RUBIX_DRUM_RIGHT_VOICE_BY_COLOR = Object.freeze({
  white: 4,
  yellow: 8,
  green: 3,
  blue: 6,
  red: 1,
  orange: 5,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const dot = (first, second) => (
  first.x * second.x + first.y * second.y + first.z * second.z
);
const sameVector = (first, second) => (
  first.x === second.x && first.y === second.y && first.z === second.z
);
const cleanZero = (value) => (Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value);

function assertFace(face) {
  const definition = RUBIX_FACE_DEFINITIONS[face];
  if (!definition) throw new RangeError(`Unknown Rubix face: ${String(face)}`);
  return definition;
}

function assertColor(color) {
  if (!RUBIX_COLOR_ORDER.includes(color)) {
    throw new RangeError(`Unknown Rubix color: ${String(color)}`);
  }
  return color;
}

function assertCube(cube) {
  if (!cube || typeof cube !== "object") {
    throw new TypeError("A Rubix cube must be an object with a size and stickers.");
  }
  const size = assertRubixSize(cube.size);
  const expectedStickerCount = 6 * size * size;
  if (!Array.isArray(cube.stickers) || cube.stickers.length !== expectedStickerCount) {
    throw new TypeError(
      `A ${size} x ${size} Rubix cube must contain exactly ${expectedStickerCount} stickers.`,
    );
  }

  const layers = rubixLayersForSize(size);
  const radius = layers.at(-1);
  const ids = new Set();
  const faceCells = Object.fromEntries(RUBIX_FACE_ORDER.map((face) => [face, new Set()]));
  for (const sticker of cube.stickers) {
    if (!sticker || typeof sticker.id !== "string" || ids.has(sticker.id)) {
      throw new TypeError("Rubix sticker IDs must be unique strings.");
    }
    ids.add(sticker.id);
    assertColor(sticker.color);

    const position = sticker.position;
    const normal = sticker.normal;
    if (!position || !normal || !RUBIX_AXES.every((axis) => layers.includes(position[axis]))) {
      throw new TypeError(`Sticker ${sticker.id} does not occupy a valid cube layer.`);
    }
    const face = RUBIX_FACE_ORDER.find((candidate) => (
      sameVector(RUBIX_FACE_DEFINITIONS[candidate].normal, normal)
    ));
    if (!face || dot(position, normal) !== radius) {
      throw new TypeError(`Sticker ${sticker.id} does not occupy an outward cube face.`);
    }
    const definition = RUBIX_FACE_DEFINITIONS[face];
    const row = dot(position, definition.down) + radius;
    const column = dot(position, definition.right) + radius;
    const cell = `${row}:${column}`;
    if (
      !Number.isInteger(row)
      || !Number.isInteger(column)
      || row < 0
      || row >= size
      || column < 0
      || column >= size
      || faceCells[face].has(cell)
    ) {
      throw new TypeError(`Sticker ${sticker.id} does not occupy a unique ${face} face cell.`);
    }
    faceCells[face].add(cell);
  }
  if (Object.values(faceCells).some((cells) => cells.size !== size * size)) {
    throw new TypeError(`Every ${size} x ${size} Rubix face must contain ${size * size} stickers.`);
  }
  return cube;
}

function freezeSticker(sticker) {
  return Object.freeze({
    ...sticker,
    position: vector(sticker.position.x, sticker.position.y, sticker.position.z),
    normal: vector(sticker.normal.x, sticker.normal.y, sticker.normal.z),
  });
}

function freezeCube(stickers, size = RUBIX_SIZE) {
  return Object.freeze({
    size,
    stickers: Object.freeze(stickers),
  });
}

function solvedSticker(face, row, column, size, layers) {
  const definition = assertFace(face);
  const radius = layers.at(-1);
  const across = layers[column];
  const down = layers[row];
  const middle = Math.floor(size / 2);
  return freezeSticker({
    id: `${face}:${row}:${column}`,
    color: definition.color,
    homeFace: face,
    homeRow: row,
    homeColumn: column,
    isCenter: size % 2 === 1 && row === middle && column === middle,
    position: {
      x: definition.normal.x * radius + definition.right.x * across + definition.down.x * down,
      y: definition.normal.y * radius + definition.right.y * across + definition.down.y * down,
      z: definition.normal.z * radius + definition.right.z * across + definition.down.z * down,
    },
    normal: definition.normal,
  });
}

/** Return a fresh, deeply frozen solved cube with 6 * size^2 stable sticker IDs. */
export function createSolvedRubixCube(size = RUBIX_SIZE) {
  const safeSize = assertRubixSize(size);
  const layers = rubixLayersForSize(safeSize);
  const stickers = [];
  for (const face of RUBIX_FACE_ORDER) {
    for (let row = 0; row < safeSize; row += 1) {
      for (let column = 0; column < safeSize; column += 1) {
        stickers.push(solvedSticker(face, row, column, safeSize, layers));
      }
    }
  }
  return freezeCube(stickers, safeSize);
}

/**
 * Rotate an exact integer/half-integer cube vector by one right-handed quarter turn.
 * `direction` is +1 for +90 degrees and -1 for -90 degrees.
 */
export function rotateRubixQuarterVector(source, axis, direction = 1) {
  if (!RUBIX_AXES.includes(axis)) {
    throw new RangeError(`Rubix turn axis must be x, y, or z; received ${String(axis)}.`);
  }
  if (direction !== 1 && direction !== -1) {
    throw new RangeError("Rubix turn direction must be +1 or -1.");
  }
  const x = Number(source?.x);
  const y = Number(source?.y);
  const z = Number(source?.z);
  if (![x, y, z].every((value) => Number.isFinite(value) && Number.isInteger(value * 2))) {
    throw new TypeError("Rubix quarter-turn vectors must use integer or half-integer coordinates.");
  }

  let rotated;
  if (axis === "x") {
    rotated = direction > 0 ? { x, y: -z, z: y } : { x, y: z, z: -y };
  } else if (axis === "y") {
    rotated = direction > 0 ? { x: z, y, z: -x } : { x: -z, y, z: x };
  } else {
    rotated = direction > 0 ? { x: -y, y: x, z } : { x: y, y: -x, z };
  }
  return vector(cleanZero(rotated.x), cleanZero(rotated.y), cleanZero(rotated.z));
}

/**
 * Immutably turn one x/y/z layer. On odd cubes, face centers belong to the
 * fixed core and therefore do not travel when the selected layer is the
 * middle slice. Even cubes have no fixed center sticker.
 */
export function turnRubixLayer(cube, {
  axis,
  layer,
  direction = 1,
} = {}) {
  const source = assertCube(cube);
  if (!RUBIX_AXES.includes(axis)) {
    throw new RangeError(`Rubix turn axis must be x, y, or z; received ${String(axis)}.`);
  }
  const layers = rubixLayersForSize(source.size);
  if (!layers.includes(layer)) {
    throw new RangeError(
      `Rubix turn layer must be one of ${layers.join(", ")} for size ${source.size}.`,
    );
  }
  if (direction !== 1 && direction !== -1) {
    throw new RangeError("Rubix turn direction must be +1 or -1.");
  }

  const stickers = source.stickers.map((sticker) => {
    const selected = sticker.position[axis] === layer;
    const fixedOddCenter = source.size % 2 === 1 && layer === 0 && sticker.isCenter;
    if (!selected || fixedOddCenter) return sticker;
    return freezeSticker({
      ...sticker,
      position: rotateRubixQuarterVector(sticker.position, axis, direction),
      normal: rotateRubixQuarterVector(sticker.normal, axis, direction),
    });
  });
  return freezeCube(stickers, source.size);
}

/** Resolve the world face currently addressed by an outward integer normal. */
export function rubixFaceForNormal(normal) {
  return RUBIX_FACE_ORDER.find((face) => (
    sameVector(RUBIX_FACE_DEFINITIONS[face].normal, normal)
  )) ?? null;
}

/**
 * Extract one outward face as size^2 stickers in face-local row-major order.
 * The returned array is frozen; its sticker objects remain shared and frozen.
 */
export function extractRubixFace(cube, face) {
  const source = assertCube(cube);
  const definition = assertFace(face);
  const size = source.size;
  const radius = (size - 1) / 2;
  const cells = Array(size * size).fill(null);
  for (const sticker of source.stickers) {
    if (!sameVector(sticker.normal, definition.normal)) continue;
    const row = dot(sticker.position, definition.down) + radius;
    const column = dot(sticker.position, definition.right) + radius;
    if (!Number.isInteger(row) || !Number.isInteger(column)) {
      throw new Error(`Sticker ${sticker.id} does not occupy an integer ${face} cell.`);
    }
    const index = row * size + column;
    if (row < 0 || row >= size || column < 0 || column >= size || cells[index]) {
      throw new Error(`Rubix face ${face} contains an invalid or duplicate cell.`);
    }
    cells[index] = sticker;
  }
  if (cells.some((sticker) => !sticker)) {
    throw new Error(`Rubix face ${face} is incomplete.`);
  }
  return Object.freeze(cells);
}

function cameraAngles(camera = DEFAULT_RUBIX_CAMERA) {
  const degrees = {
    x: Number.isFinite(Number(camera?.x)) ? Number(camera.x) : DEFAULT_RUBIX_CAMERA.x,
    y: Number.isFinite(Number(camera?.y)) ? Number(camera.y) : DEFAULT_RUBIX_CAMERA.y,
    z: Number.isFinite(Number(camera?.z)) ? Number(camera.z) : DEFAULT_RUBIX_CAMERA.z,
  };
  const radians = Math.PI / 180;
  return {
    x: degrees.x * radians,
    y: degrees.y * radians,
    z: degrees.z * radians,
  };
}

/** Return the row-major Rz * Ry * Rx matrix for Euler angles in degrees. */
export function rubixEulerMatrix(camera = DEFAULT_RUBIX_CAMERA) {
  const angles = cameraAngles(camera);
  const cx = Math.cos(angles.x);
  const sx = Math.sin(angles.x);
  const cy = Math.cos(angles.y);
  const sy = Math.sin(angles.y);
  const cz = Math.cos(angles.z);
  const sz = Math.sin(angles.z);
  return Object.freeze([
    Object.freeze([cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx].map(cleanZero)),
    Object.freeze([sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx].map(cleanZero)),
    Object.freeze([-sy, cy * sx, cy * cx].map(cleanZero)),
  ]);
}

/** Rotate a point or normal through a degree-based X/Y/Z Euler camera. */
export function rotateRubixVector(source, camera = DEFAULT_RUBIX_CAMERA) {
  const matrix = rubixEulerMatrix(camera);
  const point = {
    x: Number(source?.x) || 0,
    y: Number(source?.y) || 0,
    z: Number(source?.z) || 0,
  };
  return Object.freeze({
    x: cleanZero(matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2] * point.z),
    y: cleanZero(matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2] * point.z),
    z: cleanZero(matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2] * point.z),
  });
}

/** Orthographically project a cube point; positive depth faces the viewer. */
export function projectRubixPoint(source, camera = DEFAULT_RUBIX_CAMERA) {
  const rotated = rotateRubixVector(source, camera);
  return Object.freeze({ x: rotated.x, y: rotated.y, depth: rotated.z });
}

const faceRank = (face) => RUBIX_FACE_ORDER.indexOf(face);

function projectedFace(face, camera) {
  const definition = assertFace(face);
  return {
    face,
    color: definition.color,
    center: definition.normal,
    projectedCenter: projectRubixPoint(definition.normal, camera),
  };
}

function roleFace(candidate, role) {
  return Object.freeze({
    ...candidate,
    role,
  });
}

/**
 * Pick one outward face from each opposite axis pair, then classify the three
 * projected centers as acid/top, drum-left, and drum-right.
 */
export function visibleRubixFaces(camera = DEFAULT_RUBIX_CAMERA) {
  const axisPairs = [
    ["right", "left"],
    ["up", "down"],
    ["front", "back"],
  ];
  const outward = axisPairs.map(([positive, negative]) => {
    const first = projectedFace(positive, camera);
    const second = projectedFace(negative, camera);
    const difference = first.projectedCenter.depth - second.projectedCenter.depth;
    return difference >= -1e-12 ? first : second;
  });

  const topCandidate = [...outward].sort((first, second) => (
    second.projectedCenter.y - first.projectedCenter.y
    || second.projectedCenter.depth - first.projectedCenter.depth
    || faceRank(first.face) - faceRank(second.face)
  ))[0];
  const sideCandidates = outward
    .filter((candidate) => candidate.face !== topCandidate.face)
    .sort((first, second) => (
      first.projectedCenter.x - second.projectedCenter.x
      || second.projectedCenter.depth - first.projectedCenter.depth
      || faceRank(first.face) - faceRank(second.face)
    ));

  const acid = roleFace(topCandidate, "acid");
  const drumLeft = roleFace(sideCandidates[0], "drum-left");
  const drumRight = roleFace(sideCandidates[1], "drum-right");
  return Object.freeze({
    acid,
    drumLeft,
    drumRight,
    faces: Object.freeze([acid, drumLeft, drumRight]),
  });
}

/** Encode a Rubix color for the WebGPU 303's normalized sequence buffer. */
export function rubixAcidValueForColor(color, noteSpan = RUBIX_ACID_NOTE_SPAN) {
  const safeColor = assertColor(color);
  const span = clamp(Number(noteSpan) || RUBIX_ACID_NOTE_SPAN, 1, 100);
  const midi = RUBIX_ACID_MIDI_BY_COLOR[safeColor];
  return Object.freeze({
    midi,
    normalized: clamp((midi - 20 + 0.25) / span, 0, 0.9999),
  });
}

export const RUBIX_ACID_NORMALIZED_BY_COLOR = Object.freeze(Object.fromEntries(
  RUBIX_COLOR_ORDER.map((color) => [color, rubixAcidValueForColor(color).normalized]),
));

/** Resolve a color to the matching left or right FM drum-bank voice index. */
export function rubixDrumVoiceIndexForColor(color, lane = "drum-left") {
  const safeColor = assertColor(color);
  if (lane === "drum-left") return RUBIX_DRUM_LEFT_VOICE_BY_COLOR[safeColor];
  if (lane === "drum-right") return RUBIX_DRUM_RIGHT_VOICE_BY_COLOR[safeColor];
  throw new RangeError("Rubix drum lane must be drum-left or drum-right.");
}

const readOrderCache = new Map([
  [`row-major:${RUBIX_ROW_MAJOR_ORDER.length}`, RUBIX_ROW_MAJOR_ORDER],
  [`snake:${RUBIX_SNAKE_ORDER.length}`, RUBIX_SNAKE_ORDER],
]);

function squareSideForCellCount(cellCount) {
  if (!Number.isInteger(cellCount) || cellCount < 1) {
    throw new RangeError("Rubix read cell count must be a positive integer square.");
  }
  const side = Math.sqrt(cellCount);
  if (!Number.isInteger(side)) {
    throw new RangeError("Rubix read cell count must be a positive integer square.");
  }
  return side;
}

function readOrder(path, cellCount) {
  const key = `${path}:${cellCount}`;
  const cached = readOrderCache.get(key);
  if (cached) return cached;
  const side = squareSideForCellCount(cellCount);
  const order = [];
  for (let row = 0; row < side; row += 1) {
    if (path === "snake" && row % 2 === 1) {
      for (let column = side - 1; column >= 0; column -= 1) {
        order.push(row * side + column);
      }
    } else {
      for (let column = 0; column < side; column += 1) {
        order.push(row * side + column);
      }
    }
  }
  const frozen = Object.freeze(order);
  readOrderCache.set(key, frozen);
  return frozen;
}

/**
 * Resolve any integer-like transport position through a named read path.
 * Unknown modes fall back to the parallel default. `cellCount` must describe
 * one square face; parallel/snake read it once and face mode interleaves three
 * face subdivisions inside each cell beat.
 */
export function rubixReadFrame(mode = "parallel", step = 0, cellCount = 9) {
  const config = Object.hasOwn(RUBIX_READ_MODES, mode)
    ? RUBIX_READ_MODES[mode]
    : RUBIX_READ_MODES.parallel;
  squareSideForCellCount(cellCount);
  const cellOrder = readOrder(config.path, cellCount);
  const stepCount = config.roleMode === "all"
    ? cellCount
    : config.subdivisionsPerBeat * cellCount;
  const requestedStep = Number(step);
  const integerStep = Number.isFinite(requestedStep) ? Math.trunc(requestedStep) : 0;
  const transportStep = (
    (integerStep % stepCount) + stepCount
  ) % stepCount;
  const subdivisionCount = config.subdivisionsPerBeat;
  const faceStep = config.roleMode === "all"
    ? transportStep
    : Math.floor(transportStep / subdivisionCount);
  const activeRoles = config.roleMode === "all"
    ? RUBIX_SEQUENCE_ROLES
    : Object.freeze([
      RUBIX_SEQUENCE_ROLES[transportStep % subdivisionCount],
    ]);
  return Object.freeze({
    mode: config.id,
    transportStep,
    stepCount,
    cellIndex: cellOrder[faceStep],
    activeRoles,
  });
}

/**
 * Freeze the exact 3 * size^2 sticker view heard by one sequencer loop.
 * Each visible face is a lane; all derived audio arrays preserve row-major order.
 */
export function createRubixSequenceSnapshot(cube, camera = DEFAULT_RUBIX_CAMERA) {
  const source = assertCube(cube);
  const visibleFaces = visibleRubixFaces(camera);
  const acid = extractRubixFace(source, visibleFaces.acid.face);
  const drumLeft = extractRubixFace(source, visibleFaces.drumLeft.face);
  const drumRight = extractRubixFace(source, visibleFaces.drumRight.face);
  const stickerIds = Object.freeze([
    ...acid.map(({ id }) => id),
    ...drumLeft.map(({ id }) => id),
    ...drumRight.map(({ id }) => id),
  ]);
  const expectedStickerCount = 3 * source.size * source.size;
  if (new Set(stickerIds).size !== expectedStickerCount) {
    throw new Error(
      `Rubix sequence lanes must contain ${expectedStickerCount} unique visible stickers.`,
    );
  }

  return Object.freeze({
    camera: Object.freeze({
      x: Number(camera?.x ?? DEFAULT_RUBIX_CAMERA.x),
      y: Number(camera?.y ?? DEFAULT_RUBIX_CAMERA.y),
      z: Number(camera?.z ?? DEFAULT_RUBIX_CAMERA.z),
    }),
    visibleFaces,
    faceNames: Object.freeze({
      acid: visibleFaces.acid.face,
      drumLeft: visibleFaces.drumLeft.face,
      drumRight: visibleFaces.drumRight.face,
    }),
    lanes: Object.freeze({ acid, drumLeft, drumRight }),
    audio: Object.freeze({
      acidMidi: Object.freeze(acid.map(({ color }) => RUBIX_ACID_MIDI_BY_COLOR[color])),
      acidNormalized: Object.freeze(acid.map(({ color }) => (
        RUBIX_ACID_NORMALIZED_BY_COLOR[color]
      ))),
      drumLeftVoiceIndices: Object.freeze(drumLeft.map(({ color }) => (
        RUBIX_DRUM_LEFT_VOICE_BY_COLOR[color]
      ))),
      drumRightVoiceIndices: Object.freeze(drumRight.map(({ color }) => (
        RUBIX_DRUM_RIGHT_VOICE_BY_COLOR[color]
      ))),
    }),
    stickerIds,
  });
}
