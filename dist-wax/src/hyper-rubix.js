/**
 * Pure state and geometry helpers for an N x N x N x N twisty puzzle on the
 * boundary of a tesseract, for orders two through four.
 *
 * A tesseract has eight cubical boundary cells. Each cell owns an N x N x N
 * field of coloured surface records, giving 8 * N^3 records. A move
 * selects one boundary cell and rotates its outer hyper-layer by an exact
 * quarter turn in one of the cell's three tangent coordinate planes.
 *
 * Puzzle coordinates are centered, unit-spaced integers or half-integers.
 * View rotation and perspective projection are deliberately separate and
 * never mutate state.
 */

export const HYPER_RUBIX_MIN_SIZE = 2;
export const HYPER_RUBIX_MAX_SIZE = 4;
export const HYPER_RUBIX_SIZE = 3;

const sizeMetricsCache = new Map();

function normalizedHyperRubixSize(sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  const size = typeof sizeOrPuzzle === "object" && sizeOrPuzzle !== null
    ? sizeOrPuzzle.size
    : sizeOrPuzzle;
  if (!Number.isInteger(size) || size < HYPER_RUBIX_MIN_SIZE || size > HYPER_RUBIX_MAX_SIZE) {
    throw new RangeError(
      `Hyper Rubix size must be an integer from ${HYPER_RUBIX_MIN_SIZE} through ${HYPER_RUBIX_MAX_SIZE}.`,
    );
  }
  return size;
}

/** Immutable geometry and sequence lengths for an order, or for a puzzle. */
export function hyperRubixSizeMetrics(sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  const size = normalizedHyperRubixSize(sizeOrPuzzle);
  if (!sizeMetricsCache.has(size)) {
    const radius = (size - 1) / 2;
    const stickersPerCell = size ** 3;
    const stickerCount = 8 * stickersPerCell;
    sizeMetricsCache.set(size, Object.freeze({
      size,
      radius,
      layers: Object.freeze(Array.from({ length: size }, (_, index) => index - radius)),
      stickersPerCell,
      stickerCount,
      conceptualVoiceCount: stickerCount + 1,
      hyperbarLength: stickersPerCell,
      stickerStreamLength: stickerCount,
      cornerStreamLength: 8 * (2 ** 3),
    }));
  }
  return sizeMetricsCache.get(size);
}

/** Number of spatial steps in one N^3 sticker hyperbar. */
export function hyperRubixHyperbarLength(sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  return hyperRubixSizeMetrics(sizeOrPuzzle).hyperbarLength;
}

/** Number of events in the full eight-cell serial sticker scan. */
export function hyperRubixStickerStreamLength(sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  return hyperRubixSizeMetrics(sizeOrPuzzle).stickerStreamLength;
}

/** The eight cells each always have eight geometric corners. */
export function hyperRubixCornerStreamLength(sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  return hyperRubixSizeMetrics(sizeOrPuzzle).cornerStreamLength;
}

const defaultSizeMetrics = hyperRubixSizeMetrics();
export const HYPER_RUBIX_RADIUS = defaultSizeMetrics.radius;
export const HYPER_RUBIX_STICKERS_PER_CELL = defaultSizeMetrics.stickersPerCell;
export const HYPER_RUBIX_STICKER_COUNT = defaultSizeMetrics.stickerCount;
export const HYPER_RUBIX_CONCEPTUAL_VOICE_COUNT = defaultSizeMetrics.conceptualVoiceCount;
export const HYPER_RUBIX_STICKER_STREAM_LENGTH = defaultSizeMetrics.stickerStreamLength;
export const HYPER_RUBIX_CORNER_STREAM_LENGTH = defaultSizeMetrics.cornerStreamLength;
export const HYPER_RUBIX_AXES = Object.freeze(["x", "y", "z", "w"]);
export const HYPER_RUBIX_LAYERS = defaultSizeMetrics.layers;
export const HYPER_RUBIX_PLANES = Object.freeze([
  "xy",
  "xz",
  "xw",
  "yz",
  "yw",
  "zw",
]);
export const HYPER_RUBIX_SEQUENCE_LENGTH = 16;
export const HYPER_RUBIX_HYPERBAR_LENGTH = defaultSizeMetrics.hyperbarLength;

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

function technoVoice(cell, id, label, baseValues) {
  const boundary = HYPER_RUBIX_BOUNDARY_CELLS[cell];
  return Object.freeze({
    id,
    cell,
    color: boundary.color,
    label,
    family: id,
    ...baseValues,
  });
}

/**
 * One stable techno voice per coloured boundary cell. A sticker keeps the
 * voice of its home cell even after a turn moves it to another current cell.
 */
export const HYPER_RUBIX_TECHNO_VOICES = Object.freeze({
  "x+": technoVoice("x+", "kick", "Kick", {
    baseMidi: 36,
    baseFilterHz: 1_050,
    baseDecaySeconds: 0.32,
    baseDrive: 0.48,
    baseRattle: 0.04,
  }),
  "x-": technoVoice("x-", "sub", "Sub", {
    baseMidi: 31,
    baseFilterHz: 680,
    baseDecaySeconds: 0.5,
    baseDrive: 0.42,
    baseRattle: 0.02,
  }),
  "y+": technoVoice("y+", "clap", "Clap", {
    baseMidi: 58,
    baseFilterHz: 4_200,
    baseDecaySeconds: 0.24,
    baseDrive: 0.36,
    baseRattle: 0.46,
  }),
  "y-": technoVoice("y-", "snare", "Snare", {
    baseMidi: 50,
    baseFilterHz: 2_700,
    baseDecaySeconds: 0.22,
    baseDrive: 0.4,
    baseRattle: 0.3,
  }),
  "z+": technoVoice("z+", "open-hat", "Open hat", {
    baseMidi: 74,
    baseFilterHz: 7_800,
    baseDecaySeconds: 0.38,
    baseDrive: 0.28,
    baseRattle: 0.68,
  }),
  "z-": technoVoice("z-", "closed-hat", "Closed hat", {
    baseMidi: 82,
    baseFilterHz: 9_200,
    baseDecaySeconds: 0.1,
    baseDrive: 0.3,
    baseRattle: 0.8,
  }),
  "w+": technoVoice("w+", "stab", "Stab", {
    baseMidi: 55,
    baseFilterHz: 3_100,
    baseDecaySeconds: 0.42,
    baseDrive: 0.52,
    baseRattle: 0.14,
  }),
  "w-": technoVoice("w-", "rim", "Rim", {
    baseMidi: 69,
    baseFilterHz: 5_200,
    baseDecaySeconds: 0.13,
    baseDrive: 0.46,
    baseRattle: 0.36,
  }),
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

function freezePuzzle(stickers, sizeOrPuzzle = HYPER_RUBIX_SIZE) {
  const metrics = hyperRubixSizeMetrics(sizeOrPuzzle);
  return Object.freeze({
    size: metrics.size,
    radius: metrics.radius,
    stickers: Object.freeze(stickers),
  });
}

/** Construct the canonical solved 8 * N^3-record tesseract surface. */
export function createSolvedHyperRubix(size = HYPER_RUBIX_SIZE) {
  const metrics = hyperRubixSizeMetrics(size);
  const stickers = [];
  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const cell = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    const [first, second, third] = cell.tangentAxes;
    for (let firstIndex = 0; firstIndex < metrics.size; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < metrics.size; secondIndex += 1) {
        for (let thirdIndex = 0; thirdIndex < metrics.size; thirdIndex += 1) {
          const position = zeroVector();
          position[cell.axis] = cell.sign * metrics.radius;
          position[first] = metrics.layers[firstIndex];
          position[second] = metrics.layers[secondIndex];
          position[third] = metrics.layers[thirdIndex];
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
  return freezePuzzle(stickers, metrics);
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
  const metrics = hyperRubixSizeMetrics(puzzle);
  if (puzzle.radius !== metrics.radius) {
    throw new RangeError(
      `Hyper Rubix order ${metrics.size} state must use radius ${metrics.radius}.`,
    );
  }
  if (!Array.isArray(puzzle.stickers) || puzzle.stickers.length !== metrics.stickerCount) {
    throw new TypeError(
      `Hyper Rubix order ${metrics.size} state must contain exactly ${metrics.stickerCount} stickers.`,
    );
  }

  const ids = new Set();
  const slotsByCell = new Map(HYPER_RUBIX_CELL_ORDER.map((id) => [id, new Set()]));
  const homeSlotsByCell = new Map(HYPER_RUBIX_CELL_ORDER.map((id) => [id, new Set()]));
  for (const sticker of puzzle.stickers) {
    if (!sticker || typeof sticker.id !== "string" || ids.has(sticker.id)) {
      throw new TypeError("Hyper Rubix sticker IDs must be unique strings.");
    }
    ids.add(sticker.id);
    if ((sticker.size !== undefined && sticker.size !== metrics.size)
      || (sticker.radius !== undefined && sticker.radius !== metrics.radius)) {
      throw new RangeError(`Sticker ${sticker.id} has mismatched size metadata.`);
    }
    if (!Object.hasOwn(HYPER_RUBIX_COLORS, sticker.color)) {
      throw new RangeError(`Sticker ${sticker.id} has an unknown color.`);
    }
    const homeCell = HYPER_RUBIX_BOUNDARY_CELLS[sticker.homeCell];
    if (!homeCell || sticker.color !== homeCell.color) {
      throw new TypeError(`Sticker ${sticker.id} must retain a matching home cell and colour.`);
    }
    if (!Array.isArray(sticker.homeAddress)
      || sticker.homeAddress.length !== 3
      || sticker.homeAddress.some((digit) => (
        !Number.isInteger(digit) || digit < 0 || digit >= metrics.size
      ))) {
      throw new RangeError(`Sticker ${sticker.id} has an invalid home address.`);
    }
    const homeSlotKey = sticker.homeAddress.join(":");
    const homeSlots = homeSlotsByCell.get(sticker.homeCell);
    if (homeSlots.has(homeSlotKey)) {
      throw new TypeError(`Boundary cell ${sticker.homeCell} contains duplicate home slots.`);
    }
    homeSlots.add(homeSlotKey);
    const homePosition = finiteVector4(
      sticker.homePosition,
      `Sticker ${sticker.id} home position`,
    );
    const homeNormal = finiteVector4(sticker.homeNormal, `Sticker ${sticker.id} home normal`);
    const expectedHomePosition = zeroVector();
    expectedHomePosition[homeCell.axis] = homeCell.sign * metrics.radius;
    homeCell.tangentAxes.forEach((axis, index) => {
      expectedHomePosition[axis] = metrics.layers[sticker.homeAddress[index]];
    });
    if (HYPER_RUBIX_AXES.some((axis) => (
      homePosition[axis] !== expectedHomePosition[axis]
      || homeNormal[axis] !== homeCell.normal[axis]
    ))) {
      throw new RangeError(`Sticker ${sticker.id} has inconsistent home geometry.`);
    }

    const position = finiteVector4(sticker.position, `Sticker ${sticker.id} position`);
    if (HYPER_RUBIX_AXES.some((axis) => !metrics.layers.includes(position[axis]))) {
      throw new RangeError(`Sticker ${sticker.id} is outside the exact puzzle lattice.`);
    }
    const cell = hyperRubixCellForNormal(sticker.normal);
    if (!cell || position[cell.axis] !== cell.sign * metrics.radius) {
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
    if (slots.size !== metrics.stickersPerCell) {
      throw new TypeError(
        `Boundary cell ${cellId} must contain ${metrics.stickersPerCell} stickers.`,
      );
    }
    if (homeSlotsByCell.get(cellId).size !== metrics.stickersPerCell) {
      throw new TypeError(
        `Boundary cell ${cellId} must contain ${metrics.stickersPerCell} home stickers.`,
      );
    }
  }
  return puzzle;
}

/**
 * Read a sticker's current cubical cell as a base-N sequencer address. The
 * current cell's three tangent axes are the digits, so every cell contributes
 * one sticker to each of the N^3 hyperbar steps.
 */
export function hyperRubixStickerStepIndex(sticker, sizeOrPuzzle) {
  if (!sticker || typeof sticker !== "object") {
    throw new TypeError("A Hyper Rubix sticker must be an object.");
  }
  const position = finiteVector4(sticker.position, "Sticker position");
  const cell = sticker.normal === undefined
    ? HYPER_RUBIX_BOUNDARY_CELLS[sticker.cell] ?? null
    : hyperRubixCellForNormal(sticker.normal);
  if (!cell) {
    throw new RangeError("Hyper Rubix sticker must face outward from its current boundary cell.");
  }
  const metrics = hyperRubixSizeMetrics(
    sizeOrPuzzle ?? sticker.size ?? (2 * Math.abs(position[cell.axis]) + 1),
  );
  if (position[cell.axis] !== cell.sign * metrics.radius) {
    throw new RangeError("Hyper Rubix sticker must face outward from its current boundary cell.");
  }
  const digits = cell.tangentAxes.map((axis) => {
    const digit = metrics.layers.indexOf(position[axis]);
    if (digit < 0) {
      throw new RangeError("Hyper Rubix sticker position must lie on the exact puzzle lattice.");
    }
    return digit;
  });
  return digits[0] * metrics.size ** 2 + digits[1] * metrics.size + digits[2];
}

const HYPERBAR_RADIAL_CLASSES = Object.freeze(["center", "face", "edge", "corner"]);

function currentStickerSlotKey(cellId, position) {
  return `${cellId}|${HYPER_RUBIX_AXES.map((axis) => position[axis]).join(":")}`;
}

function currentStickerSlotMap(puzzle) {
  return new Map(puzzle.stickers.map((sticker) => {
    const cell = hyperRubixCellForNormal(sticker.normal);
    return [currentStickerSlotKey(cell.id, sticker.position), sticker];
  }));
}

function stickerIsDisplaced(sticker) {
  const position = finiteVector4(sticker.position, `Sticker ${sticker.id} position`);
  const homePosition = finiteVector4(sticker.homePosition, `Sticker ${sticker.id} home position`);
  const homeNormal = finiteVector4(sticker.homeNormal, `Sticker ${sticker.id} home normal`);
  return HYPER_RUBIX_AXES.some((axis) => (
    position[axis] !== homePosition[axis] || sticker.normal[axis] !== homeNormal[axis]
  ));
}

function stickerTopologyFromSlots(sticker, slots, sizeOrPuzzle) {
  const metrics = hyperRubixSizeMetrics(sizeOrPuzzle);
  const position = finiteVector4(sticker.position, `Sticker ${sticker.id} position`);
  const cell = hyperRubixCellForNormal(sticker.normal);
  const connections = [];
  for (const axis of cell.tangentAxes) {
    for (const direction of [-1, 1]) {
      const coordinate = position[axis] + direction;
      if (!metrics.layers.includes(coordinate)) continue;
      const neighborPosition = { ...position, [axis]: coordinate };
      const neighbor = slots.get(currentStickerSlotKey(cell.id, neighborPosition));
      if (!neighbor) {
        throw new TypeError(`Sticker ${sticker.id} has an incomplete current-cell neighborhood.`);
      }
      connections.push(Object.freeze({
        axis,
        direction,
        sign: direction < 0 ? "-" : "+",
        stickerId: neighbor.id,
        color: neighbor.color,
        homeCell: neighbor.homeCell,
        sameColor: neighbor.color === sticker.color,
        displaced: stickerIsDisplaced(neighbor),
      }));
    }
  }

  return Object.freeze({
    stickerId: sticker.id,
    currentCell: cell.id,
    homeCell: sticker.homeCell,
    cellDisplaced: cell.id !== sticker.homeCell,
    displaced: stickerIsDisplaced(sticker),
    neighborCount: connections.length,
    connections: Object.freeze(connections),
  });
}

function stickerConfigurationFromTopology(sticker, topology, sizeOrPuzzle) {
  const metrics = hyperRubixSizeMetrics(sizeOrPuzzle);
  const position = finiteVector4(sticker.position, `Sticker ${sticker.id} position`);
  const cell = hyperRubixCellForNormal(sticker.normal);
  const sameColorNeighbors = topology.connections.filter(({ sameColor }) => sameColor).length;
  const radialIndex = cell.tangentAxes.reduce(
    (count, axis) => count + Number(Math.abs(position[axis]) === metrics.radius),
    0,
  );

  return Object.freeze({
    neighborCount: topology.neighborCount,
    sameColorNeighbors,
    neighborDiversity: topology.neighborCount === 0
      ? 0
      : (topology.neighborCount - sameColorNeighbors) / topology.neighborCount,
    radialClass: HYPERBAR_RADIAL_CLASSES[radialIndex],
    displaced: topology.displaced,
  });
}

function currentStickerFor(puzzle, stickerOrId, purpose) {
  const stickerId = typeof stickerOrId === "string" ? stickerOrId : stickerOrId?.id;
  if (typeof stickerId !== "string") {
    throw new TypeError(`Hyper Rubix sticker ${purpose} requires a sticker or sticker ID.`);
  }
  const currentSticker = puzzle.stickers.find(({ id }) => id === stickerId);
  if (!currentSticker) {
    throw new RangeError(`Unknown Hyper Rubix sticker: ${stickerId}`);
  }
  return currentSticker;
}

/** Describe one sticker's current six-connected cubical neighborhood. */
export function hyperRubixStickerConfiguration(puzzle, sticker) {
  assertHyperRubixPuzzle(puzzle);
  const currentSticker = currentStickerFor(puzzle, sticker, "configuration");
  const topology = stickerTopologyFromSlots(
    currentSticker,
    currentStickerSlotMap(puzzle),
    puzzle,
  );
  return stickerConfigurationFromTopology(currentSticker, topology, puzzle);
}

/** Describe one sticker's actual, ordered tangent-neighbor graph. */
export function hyperRubixStickerTopology(puzzle, sticker) {
  assertHyperRubixPuzzle(puzzle);
  const currentSticker = currentStickerFor(puzzle, sticker, "topology");
  return stickerTopologyFromSlots(currentSticker, currentStickerSlotMap(puzzle), puzzle);
}

function hyperbarGate(stepIndex, voice, sizeOrPuzzle) {
  const size = hyperRubixSizeMetrics(sizeOrPuzzle).size;
  const stepInGroup = stepIndex % (size ** 2);
  const stepInSubgroup = stepIndex % size;
  const voiceIndex = HYPER_RUBIX_CELL_ORDER.indexOf(voice.cell);
  const groupAccent = stepInGroup === 0;
  const gate = groupAccent || stepInSubgroup === voiceIndex % size;
  return Object.freeze({
    gate,
    accent: gate && (groupAccent || Math.floor(stepInGroup / size) === voiceIndex % size),
  });
}

/**
 * Snapshot all 8 * N^3 stickers as N^3 time slots with eight current-cell tracks.
 * Event order follows HYPER_RUBIX_CELL_ORDER. Turns may change an event's slot
 * and current cell, while its ID, colour, home cell, and voice remain stable.
 */
export function createHyperRubixHyperbarSnapshot(puzzle) {
  assertHyperRubixPuzzle(puzzle);
  const metrics = hyperRubixSizeMetrics(puzzle);
  const stickerSlots = currentStickerSlotMap(puzzle);
  const slots = Array.from({ length: metrics.hyperbarLength }, (_, index) => ({
    index,
    group: Math.floor(index / (metrics.size ** 2)),
    subgroup: Math.floor((index % (metrics.size ** 2)) / metrics.size),
    events: [],
  }));

  for (const sticker of puzzle.stickers) {
    const voice = HYPER_RUBIX_TECHNO_VOICES[sticker.homeCell];
    if (!voice || voice.color !== sticker.color) {
      throw new TypeError(`Sticker ${sticker.id} must retain a matching home cell and colour.`);
    }
    const cell = hyperRubixCellForNormal(sticker.normal);
    const stepIndex = hyperRubixStickerStepIndex(sticker, metrics);
    const rhythm = hyperbarGate(stepIndex, voice, metrics);
    const topology = stickerTopologyFromSlots(sticker, stickerSlots, metrics);
    slots[stepIndex].events.push(Object.freeze({
      id: sticker.id,
      stickerId: sticker.id,
      color: sticker.color,
      voice,
      homeCell: sticker.homeCell,
      cell: cell.id,
      position: vector4(
        sticker.position.x,
        sticker.position.y,
        sticker.position.z,
        sticker.position.w,
      ),
      configuration: stickerConfigurationFromTopology(sticker, topology, metrics),
      topology,
      gate: rhythm.gate,
      accent: rhythm.accent,
    }));
  }

  return Object.freeze(slots.map((slot) => {
    slot.events.sort((first, second) => (
      HYPER_RUBIX_CELL_ORDER.indexOf(first.cell) - HYPER_RUBIX_CELL_ORDER.indexOf(second.cell)
    ));
    if (slot.events.length !== HYPER_RUBIX_CELL_ORDER.length
      || new Set(slot.events.map(({ cell }) => cell)).size !== HYPER_RUBIX_CELL_ORDER.length) {
      throw new TypeError(`Hyperbar step ${slot.index} must contain one event per boundary cell.`);
    }
    return Object.freeze({
      ...slot,
      events: Object.freeze(slot.events),
    });
  }));
}

/**
 * Flatten the spatial hyperbar into a serial scan: all eight current-cell
 * voices at position 0, then all eight at position 1, through position N^3 - 1.
 * Corner mode keeps that ordering while selecting the eight cubical corners.
 */
export function createHyperRubixStickerStream(puzzle, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Hyper Rubix sticker stream options must be an object.");
  }
  const cornersOnly = options.cornersOnly ?? false;
  if (typeof cornersOnly !== "boolean") {
    throw new TypeError("Hyper Rubix cornersOnly option must be a boolean.");
  }
  const events = createHyperRubixHyperbarSnapshot(puzzle)
    .flatMap(({ events: slotEvents }) => slotEvents);
  return Object.freeze(cornersOnly
    ? events.filter(({ configuration }) => configuration.radialClass === "corner")
    : events);
}

/**
 * Choose the foreground member of each opposite X/Y/Z/W boundary-cell pair.
 *
 * `scores` may be a plain object or Map containing one finite apparent-size or
 * depth score per boundary cell. Larger values are considered nearer. Ties
 * resolve to the positive cell unless a previous winner is supplied inside the
 * relative hysteresis band, which prevents an orbit gesture from rapidly
 * flipping an entire N³ lane near an edge-on view.
 */
export function selectHyperRubixViewFacingCells(scores, options = {}) {
  if (!scores || typeof scores !== "object") {
    throw new TypeError("Hyper Rubix view-facing scores must be an object or Map.");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Hyper Rubix view-facing options must be an object.");
  }
  const previousCells = options.previousCells ?? [];
  if (!Array.isArray(previousCells)) {
    throw new TypeError("Hyper Rubix previous view-facing cells must be an array.");
  }
  const previous = new Set(previousCells.map((cellId) => hyperRubixBoundaryCell(cellId).id));
  const hysteresis = clamp(Number(options.hysteresis ?? 0.06), 0, 0.5);
  if (!Number.isFinite(hysteresis)) {
    throw new TypeError("Hyper Rubix view-facing hysteresis must be finite.");
  }
  const scoreFor = (cellId) => {
    const value = scores instanceof Map ? scores.get(cellId) : scores[cellId];
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`Hyper Rubix view-facing score for ${cellId} must be finite.`);
    }
    return number;
  };
  const selected = new Set();
  for (const axis of HYPER_RUBIX_AXES) {
    const positive = `${axis}+`;
    const negative = `${axis}-`;
    const positiveScore = scoreFor(positive);
    const negativeScore = scoreFor(negative);
    const scale = Math.max(Math.abs(positiveScore), Math.abs(negativeScore), 1e-9);
    const withinHysteresis = Math.abs(positiveScore - negativeScore) <= scale * hysteresis;
    const previousWinner = previous.has(positive)
      ? positive
      : previous.has(negative) ? negative : null;
    selected.add(withinHysteresis && previousWinner
      ? previousWinner
      : positiveScore >= negativeScore ? positive : negative);
  }
  return Object.freeze(HYPER_RUBIX_CELL_ORDER.filter((cellId) => selected.has(cellId)));
}

/** Return the stable sticker stream restricted to the supplied current cells. */
export function createHyperRubixScopedStickerStream(puzzle, cellIds) {
  if (!Array.isArray(cellIds) || cellIds.length === 0) {
    throw new TypeError("Hyper Rubix scoped sticker cells must be a non-empty array.");
  }
  const included = new Set(cellIds.map((cellId) => hyperRubixBoundaryCell(cellId).id));
  const stream = createHyperRubixStickerStream(puzzle)
    .filter(({ cell }) => included.has(cell));
  const expected = hyperRubixSizeMetrics(puzzle).stickersPerCell * included.size;
  if (stream.length !== expected) {
    throw new TypeError(`Hyper Rubix scoped sticker stream must contain ${expected} events.`);
  }
  return Object.freeze(stream);
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

const TECHNO_PLANE_SEMITONES = Object.freeze({
  xy: 0,
  xz: 3,
  xw: 7,
  yz: 5,
  yw: 10,
  zw: 12,
});

function finiteGeometryNumber(value, fallback, label) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`Hyper Rubix geometry ${label} must be a finite number.`);
  }
  return number;
}

function normalizedTechnoPosition(source) {
  if (source === undefined) return zeroVector();
  if (typeof source === "number") {
    return { x: clamp(finiteGeometryNumber(source, 0, "position"), -1, 1), y: 0, z: 0, w: 0 };
  }
  if (!source || typeof source !== "object") {
    throw new TypeError("Hyper Rubix geometry position must be a finite number or point object.");
  }
  return Object.fromEntries(HYPER_RUBIX_AXES.map((axis) => [
    axis,
    clamp(finiteGeometryNumber(source[axis], 0, `position.${axis}`), -1, 1),
  ]));
}

/**
 * Map a legal turn and optional normalized geometry into synthesis controls.
 * `angle` is one normalized revolution; `depth`, `disorder`, and
 * `shapeInfluence` use 0 through 1. `pan` may override the projected position's
 * x coordinate. The five optional DSP influence controls use 0 through 2 and
 * each falls back to `shapeInfluence`. Projected position and pan values clamp
 * to -1 through +1, keeping every returned control inside a useful Web Audio
 * range.
 */
export function hyperRubixTechnoVoiceParameters(move, geometry = {}) {
  const normalized = normalizeHyperRubixMove(move);
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    throw new TypeError("Hyper Rubix geometry must be an object.");
  }
  const voice = HYPER_RUBIX_TECHNO_VOICES[normalized.cell];
  const position = normalizedTechnoPosition(geometry.position);
  const panPosition = clamp(
    finiteGeometryNumber(geometry.pan, position.x, "pan"),
    -1,
    1,
  );
  const angle = clamp(finiteGeometryNumber(geometry.angle, 0, "angle"), 0, 1);
  const depth = clamp(finiteGeometryNumber(geometry.depth, 0.5, "depth"), 0, 1);
  const disorder = clamp(finiteGeometryNumber(geometry.disorder, 0, "disorder"), 0, 1);
  const shapeInfluence = clamp(
    finiteGeometryNumber(geometry.shapeInfluence, 1, "shapeInfluence"),
    0,
    1,
  );
  const pitchInfluence = clamp(
    finiteGeometryNumber(geometry.pitchInfluence, shapeInfluence, "pitchInfluence"),
    0,
    2,
  );
  const filterInfluence = clamp(
    finiteGeometryNumber(geometry.filterInfluence, shapeInfluence, "filterInfluence"),
    0,
    2,
  );
  const stereoInfluence = clamp(
    finiteGeometryNumber(geometry.stereoInfluence, shapeInfluence, "stereoInfluence"),
    0,
    2,
  );
  const wInfluence = clamp(
    finiteGeometryNumber(geometry.wInfluence, shapeInfluence, "wInfluence"),
    0,
    2,
  );
  const disorderInfluence = clamp(
    finiteGeometryNumber(geometry.disorderInfluence, shapeInfluence, "disorderInfluence"),
    0,
    2,
  );
  const angleWave = Math.sin(angle * Math.PI * 2);
  const depthCentered = depth * 2 - 1;
  const direction = Math.sign(normalized.quarterTurns);
  const planeHasW = Number(normalized.plane.includes("w"));
  const planeSlot = HYPER_RUBIX_BOUNDARY_CELLS[normalized.cell].tangentPlanes.indexOf(
    normalized.plane,
  );
  const planeTilt = 0.82 + planeSlot * 0.18;
  const voiceIndex = HYPER_RUBIX_CELL_ORDER.indexOf(normalized.cell);
  const basePan = -0.35 + (voiceIndex / (HYPER_RUBIX_CELL_ORDER.length - 1)) * 0.7;

  const midi = voice.baseMidi
    + TECHNO_PLANE_SEMITONES[normalized.plane]
    + direction
    + position.y * 1.5 * pitchInfluence
    + position.z * 3 * pitchInfluence
    + position.w * 4 * wInfluence
    + angleWave * 2 * pitchInfluence
    + disorder * 5 * disorderInfluence;
  const pitchHz = clamp(440 * (2 ** ((midi - 69) / 12)), 24, 4_200);
  const filterOctaves = (
    position.y * 0.4 * filterInfluence
    + angleWave * 0.5 * filterInfluence
    + depthCentered * 0.65 * wInfluence
    + disorder * disorderInfluence
  );

  return Object.freeze({
    voice,
    move: normalized,
    pitchHz,
    filterHz: clamp(voice.baseFilterHz * planeTilt * (2 ** filterOctaves), 90, 16_000),
    filterQ: clamp(
      0.72
        + planeSlot * 0.82
        + Math.abs(angleWave) * 1.8 * filterInfluence
        + disorder * 1.2 * disorderInfluence,
      0.45,
      7.5,
    ),
    decaySeconds: clamp(
      voice.baseDecaySeconds * (
        1
          - depthCentered * 0.3 * wInfluence
          + Math.abs(angleWave) * 0.3 * filterInfluence
          + disorder * 0.45 * disorderInfluence
      ),
      0.035,
      2.5,
    ),
    pan: clamp(basePan + panPosition * 0.7 * stereoInfluence + direction * 0.08, -1, 1),
    drive: clamp(
      voice.baseDrive
        + Math.abs(angleWave) * 0.2 * filterInfluence
        + disorder * 0.3 * disorderInfluence
        + planeHasW * 0.08,
      0,
      1,
    ),
    rattle: clamp(
      voice.baseRattle
        + Math.abs(position.z * filterInfluence - position.w * wInfluence) * 0.14
        + disorder * 0.36 * disorderInfluence
        + Math.max(0, -depthCentered) * 0.08 * wInfluence,
      0,
      1,
    ),
  });
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
  if (![1, 2, 4, 8, 16].includes(subdivisions)) {
    throw new RangeError("Hyper Rubix subdivisions per beat must be 1, 2, 4, 8, or 16.");
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

export function hyperRubixMoveAffectsSticker(
  sticker,
  move,
  sizeOrPuzzle,
) {
  const normalized = normalizeHyperRubixMove(move);
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[normalized.cell];
  const position = finiteVector4(sticker?.position, "Sticker position");
  const currentCell = sticker?.normal
    ? hyperRubixCellForNormal(sticker.normal)
    : HYPER_RUBIX_BOUNDARY_CELLS[sticker?.cell] ?? null;
  const inferredSize = currentCell
    ? 2 * Math.abs(position[currentCell.axis]) + 1
    : HYPER_RUBIX_SIZE;
  const metrics = hyperRubixSizeMetrics(sizeOrPuzzle ?? sticker?.size ?? inferredSize);
  return position[cell.axis] === cell.sign * metrics.radius;
}

/** Apply one exact outer-cell turn and return a new immutable puzzle. */
export function turnHyperRubixBoundaryCell(puzzle, move) {
  assertHyperRubixPuzzle(puzzle);
  const normalized = normalizeHyperRubixMove(move);
  if (normalized.quarterTurns === 0) return puzzle;
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[normalized.cell];
  const slice = cell.sign * puzzle.radius;
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
  return freezePuzzle(stickers, puzzle);
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
  const count = hyperRubixDisorderCount(puzzle);
  return count / hyperRubixStickerStreamLength(puzzle);
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
