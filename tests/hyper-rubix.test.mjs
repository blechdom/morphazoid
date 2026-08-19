import assert from "node:assert/strict";
import test from "node:test";

import {
  HYPER_RUBIX_AXES,
  HYPER_RUBIX_BASIC_MOVES,
  HYPER_RUBIX_BOUNDARY_CELLS,
  HYPER_RUBIX_CELL_ORDER,
  HYPER_RUBIX_COLORS,
  HYPER_RUBIX_CONCEPTUAL_VOICE_COUNT,
  HYPER_RUBIX_CORNER_STREAM_LENGTH,
  HYPER_RUBIX_HYPERBAR_LENGTH,
  HYPER_RUBIX_LAYERS,
  HYPER_RUBIX_MAX_SIZE,
  HYPER_RUBIX_MIN_SIZE,
  HYPER_RUBIX_PLANE_DRUMS,
  HYPER_RUBIX_PLANES,
  HYPER_RUBIX_RADIUS,
  HYPER_RUBIX_SEQUENCE_LENGTH,
  HYPER_RUBIX_SEQUENCE_PATTERNS,
  HYPER_RUBIX_SIZE,
  HYPER_RUBIX_STICKER_COUNT,
  HYPER_RUBIX_STICKER_STREAM_LENGTH,
  HYPER_RUBIX_STICKERS_PER_CELL,
  HYPER_RUBIX_TECHNO_VOICES,
  applyHyperRubixMoves,
  assertHyperRubixPuzzle,
  buildHyperRubixTesseractWireframe,
  createHyperRubixScramble,
  createHyperRubixHyperbarSnapshot,
  createHyperRubixSequence,
  createSeededHyperRubixRandom,
  createSolvedHyperRubix,
  createHyperRubixStickerStream,
  hyperRubixBoundaryCell,
  hyperRubixCellForNormal,
  hyperRubixDisorder,
  hyperRubixDisorderCount,
  hyperRubixCornerStreamLength,
  hyperRubixHyperbarLength,
  hyperRubixMoveAffectsSticker,
  hyperRubixMoveKey,
  hyperRubixSequenceIndex,
  hyperRubixStepDurationSeconds,
  hyperRubixStickerConfiguration,
  hyperRubixStickerStreamLength,
  hyperRubixStickerStepIndex,
  hyperRubixStickerTopology,
  hyperRubixSizeMetrics,
  hyperRubixTechnoVoiceParameters,
  invertHyperRubixMove,
  invertHyperRubixMoves,
  isHyperRubixSolved,
  normalizeHyperRubixMove,
  projectHyperRubixPoint4,
  rotateHyperRubixPoint4,
  rotateHyperRubixQuarterVector,
  turnHyperRubixBoundaryCell,
} from "../src/hyper-rubix.js";

const vector = (x, y, z, w) => ({ x, y, z, w });
const positionKey = (position) => HYPER_RUBIX_AXES.map((axis) => position[axis]).join(":");

function mutablePuzzle(puzzle = createSolvedHyperRubix()) {
  return {
    size: puzzle.size,
    radius: puzzle.radius,
    stickers: puzzle.stickers.map((sticker) => ({
      ...sticker,
      homeAddress: [...sticker.homeAddress],
      homePosition: { ...sticker.homePosition },
      homeNormal: { ...sticker.homeNormal },
      position: { ...sticker.position },
      normal: { ...sticker.normal },
    })),
  };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("the model declares four axes, six planes, and eight cubical boundary cells", () => {
  assert.equal(HYPER_RUBIX_SIZE, 3);
  assert.equal(HYPER_RUBIX_RADIUS, 1);
  assert.deepEqual(HYPER_RUBIX_LAYERS, [-1, 0, 1]);
  assert.deepEqual(HYPER_RUBIX_AXES, ["x", "y", "z", "w"]);
  assert.deepEqual(HYPER_RUBIX_PLANES, ["xy", "xz", "xw", "yz", "yw", "zw"]);
  assert.deepEqual(HYPER_RUBIX_CELL_ORDER, [
    "x+", "x-", "y+", "y-", "z+", "z-", "w+", "w-",
  ]);
  assert.equal(new Set(HYPER_RUBIX_CELL_ORDER.map(
    (id) => HYPER_RUBIX_BOUNDARY_CELLS[id].color,
  )).size, 8);

  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const cell = hyperRubixBoundaryCell(cellId);
    assert.equal(cell.normal[cell.axis], cell.sign);
    assert.equal(cell.fill, HYPER_RUBIX_COLORS[cell.color]);
    assert.equal(cell.tangentAxes.length, 3);
    assert.equal(cell.tangentPlanes.length, 3);
    assert.equal(cell.tangentAxes.includes(cell.axis), false);
    assert.equal(cell.tangentPlanes.some((plane) => plane.includes(cell.axis)), false);
    assert.equal(Object.isFrozen(cell), true);
  }
  assert.deepEqual(HYPER_RUBIX_BOUNDARY_CELLS["w+"].tangentPlanes, ["xy", "xz", "yz"]);
  assert.deepEqual(HYPER_RUBIX_BOUNDARY_CELLS["x-"].tangentPlanes, ["yz", "yw", "zw"]);
  assert.throws(() => hyperRubixBoundaryCell("q+"), /Unknown Hyper Rubix boundary cell/);
});

test("the solved state has 27 unique sticker records on each of eight cells", () => {
  const puzzle = createSolvedHyperRubix();
  assert.equal(HYPER_RUBIX_STICKERS_PER_CELL, 27);
  assert.equal(HYPER_RUBIX_STICKER_COUNT, 216);
  assert.equal(puzzle.stickers.length, 216);
  assert.equal(new Set(puzzle.stickers.map(({ id }) => id)).size, 216);
  assert.equal(Object.isFrozen(puzzle), true);
  assert.equal(Object.isFrozen(puzzle.stickers), true);
  assert.equal(Object.isFrozen(puzzle.stickers[0]), true);
  assert.equal(assertHyperRubixPuzzle(puzzle), puzzle);

  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const definition = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    const stickers = puzzle.stickers.filter(({ homeCell }) => homeCell === cellId);
    assert.equal(stickers.length, 27);
    assert.equal(new Set(stickers.map(({ color }) => color)).size, 1);
    assert.equal(stickers[0].color, definition.color);
    assert.equal(new Set(stickers.map(({ position }) => positionKey(position))).size, 27);
    for (const sticker of stickers) {
      assert.equal(sticker.position[definition.axis], definition.sign);
      assert.deepEqual(sticker.normal, definition.normal);
      assert.deepEqual(sticker.position, sticker.homePosition);
      assert.deepEqual(sticker.normal, sticker.homeNormal);
    }
  }
  assert.equal(isHyperRubixSolved(puzzle), true);
  assert.equal(hyperRubixDisorderCount(puzzle), 0);
  assert.equal(hyperRubixDisorder(puzzle), 0);
});

test("size metrics derive exact centered lattices and dynamic sequence lengths", () => {
  assert.equal(HYPER_RUBIX_MIN_SIZE, 2);
  assert.equal(HYPER_RUBIX_MAX_SIZE, 4);
  const expectedBySize = {
    2: {
      radius: 0.5,
      layers: [-0.5, 0.5],
      stickersPerCell: 8,
      stickerCount: 64,
      conceptualVoiceCount: 65,
      hyperbarLength: 8,
      stickerStreamLength: 64,
      cornerStreamLength: 64,
    },
    3: {
      radius: 1,
      layers: [-1, 0, 1],
      stickersPerCell: 27,
      stickerCount: 216,
      conceptualVoiceCount: 217,
      hyperbarLength: 27,
      stickerStreamLength: 216,
      cornerStreamLength: 64,
    },
    4: {
      radius: 1.5,
      layers: [-1.5, -0.5, 0.5, 1.5],
      stickersPerCell: 64,
      stickerCount: 512,
      conceptualVoiceCount: 513,
      hyperbarLength: 64,
      stickerStreamLength: 512,
      cornerStreamLength: 64,
    },
  };

  for (const size of [2, 3, 4]) {
    const metrics = hyperRubixSizeMetrics(size);
    assert.deepEqual(metrics, { size, ...expectedBySize[size] });
    assert.equal(Object.isFrozen(metrics), true);
    assert.equal(Object.isFrozen(metrics.layers), true);
    assert.equal(hyperRubixSizeMetrics(size), metrics, "metrics are stable immutable metadata");
    assert.equal(hyperRubixHyperbarLength(size), size ** 3);
    assert.equal(hyperRubixStickerStreamLength(size), 8 * size ** 3);
    assert.equal(hyperRubixCornerStreamLength(size), 64);

    const puzzle = createSolvedHyperRubix(size);
    assert.equal(hyperRubixSizeMetrics(puzzle), metrics);
    assert.equal(puzzle.size, size);
    assert.equal(puzzle.radius, expectedBySize[size].radius);
    assert.equal(puzzle.stickers.length, 8 * size ** 3);
    assert.equal(new Set(puzzle.stickers.map(({ id }) => id)).size, 8 * size ** 3);
    assert.equal(assertHyperRubixPuzzle(puzzle), puzzle);
    for (const cellId of HYPER_RUBIX_CELL_ORDER) {
      const stickers = puzzle.stickers.filter(({ homeCell }) => homeCell === cellId);
      assert.equal(stickers.length, size ** 3);
      assert.equal(new Set(stickers.map(({ position }) => positionKey(position))).size, size ** 3);
      assert.equal(stickers.every((sticker) => (
        sticker.position[HYPER_RUBIX_BOUNDARY_CELLS[cellId].axis]
          === HYPER_RUBIX_BOUNDARY_CELLS[cellId].sign * expectedBySize[size].radius
      )), true);
    }
  }

  assert.deepEqual(createSolvedHyperRubix(), createSolvedHyperRubix(3));
  for (const size of [1, 5, 2.5, Number.NaN]) {
    assert.throws(() => hyperRubixSizeMetrics(size), /size must be an integer from 2 through 4/);
    assert.throws(() => createSolvedHyperRubix(size), /size must be an integer from 2 through 4/);
  }
});

test("every legal move has exact inverse and order four for sizes two through four", () => {
  const move = { cell: "w+", plane: "xy", quarterTurns: 1 };
  for (const size of [2, 3, 4]) {
    const solved = createSolvedHyperRubix(size);
    assert.equal(
      solved.stickers.filter((sticker) => hyperRubixMoveAffectsSticker(sticker, move)).length,
      size ** 3 + 6 * size ** 2,
      `order ${size} moves one facet and its six boundary strips`,
    );
    const representativeTurn = turnHyperRubixBoundaryCell(solved, move);
    assert.equal(hyperRubixDisorderCount(representativeTurn), 4 * size ** 2);
    closeTo(hyperRubixDisorder(representativeTurn), 1 / (2 * size));

    for (const legalMove of HYPER_RUBIX_BASIC_MOVES) {
      const once = turnHyperRubixBoundaryCell(solved, legalMove);
      assert.equal(assertHyperRubixPuzzle(once), once, `${size}:${hyperRubixMoveKey(legalMove)}`);
      assert.equal(once.size, size);
      assert.equal(once.stickers.length, 8 * size ** 3);
      assert.deepEqual(
        turnHyperRubixBoundaryCell(once, invertHyperRubixMove(legalMove)),
        solved,
        `order ${size} inverse ${hyperRubixMoveKey(legalMove)}`,
      );
      assert.deepEqual(
        applyHyperRubixMoves(solved, [legalMove, legalMove, legalMove, legalMove]),
        solved,
        `order ${size} fourth power ${hyperRubixMoveKey(legalMove)}`,
      );
    }
  }
});

test("legacy size-three records and arbitrary stable IDs retain round-trip compatibility", () => {
  const legacy = mutablePuzzle();
  legacy.stickers[0].id = "custom-stable-sticker-id";
  assert.equal(Object.hasOwn(legacy.stickers[0], "size"), false);
  assert.equal(Object.hasOwn(legacy.stickers[0], "radius"), false);
  assert.equal(assertHyperRubixPuzzle(legacy), legacy);

  const move = { cell: "w-", plane: "xy", quarterTurns: 1 };
  const turned = turnHyperRubixBoundaryCell(legacy, move);
  assert.equal(turned.stickers.some(({ id }) => id === "custom-stable-sticker-id"), true);
  assert.deepEqual(turnHyperRubixBoundaryCell(turned, invertHyperRubixMove(move)), legacy);
});

test("normal lookup resolves exactly the eight outward coordinate normals", () => {
  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const cell = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    assert.equal(hyperRubixCellForNormal(cell.normal), cell);
  }
  assert.equal(hyperRubixCellForNormal(vector(0, 0, 0, 0)), null);
  assert.equal(hyperRubixCellForNormal(vector(1, 1, 0, 0)), null);
  assert.equal(hyperRubixCellForNormal(vector(2, 0, 0, 0)), null);
  assert.throws(() => hyperRubixCellForNormal({ x: 1 }), /finite y coordinate/);
});

test("structural validation rejects malformed surface states", () => {
  assert.throws(() => assertHyperRubixPuzzle(null), /must be an object/);

  const wrongSize = mutablePuzzle();
  wrongSize.size = 4;
  assert.throws(() => assertHyperRubixPuzzle(wrongSize), /order 4 state must use radius 1\.5/);

  const missing = mutablePuzzle();
  missing.stickers.pop();
  assert.throws(() => assertHyperRubixPuzzle(missing), /exactly 216 stickers/);

  const duplicateId = mutablePuzzle();
  duplicateId.stickers[1].id = duplicateId.stickers[0].id;
  assert.throws(() => assertHyperRubixPuzzle(duplicateId), /IDs must be unique/);

  const offLattice = mutablePuzzle();
  offLattice.stickers[0].position.y = 0.5;
  assert.throws(() => assertHyperRubixPuzzle(offLattice), /outside the exact puzzle lattice/);

  const inward = mutablePuzzle();
  inward.stickers[0].normal = vector(-1, 0, 0, 0);
  assert.throws(() => assertHyperRubixPuzzle(inward), /not outward-facing/);

  const duplicateSlot = mutablePuzzle();
  duplicateSlot.stickers[1].position = { ...duplicateSlot.stickers[0].position };
  assert.throws(() => assertHyperRubixPuzzle(duplicateSlot), /duplicate sticker slots/);

  const wrongRadius = mutablePuzzle(createSolvedHyperRubix(4));
  wrongRadius.radius = 1;
  assert.throws(() => assertHyperRubixPuzzle(wrongRadius), /order 4 state must use radius 1\.5/);

  const wrongDynamicCount = mutablePuzzle(createSolvedHyperRubix(2));
  wrongDynamicCount.stickers.pop();
  assert.throws(() => assertHyperRubixPuzzle(wrongDynamicCount), /exactly 64 stickers/);

  const offEvenLattice = mutablePuzzle(createSolvedHyperRubix(4));
  offEvenLattice.stickers[0].position.y = 0;
  assert.throws(() => assertHyperRubixPuzzle(offEvenLattice), /outside the exact puzzle lattice/);

  const invalidHomeAddress = mutablePuzzle(createSolvedHyperRubix(2));
  invalidHomeAddress.stickers[0].homeAddress[0] = 2;
  assert.throws(() => assertHyperRubixPuzzle(invalidHomeAddress), /invalid home address/);

  const inconsistentHome = mutablePuzzle(createSolvedHyperRubix(4));
  inconsistentHome.stickers[0].homePosition.y = -0.5;
  assert.throws(() => assertHyperRubixPuzzle(inconsistentHome), /inconsistent home geometry/);

  const duplicateHome = mutablePuzzle(createSolvedHyperRubix(4));
  duplicateHome.stickers[1].homeAddress = [...duplicateHome.stickers[0].homeAddress];
  duplicateHome.stickers[1].homePosition = { ...duplicateHome.stickers[0].homePosition };
  assert.throws(() => assertHyperRubixPuzzle(duplicateHome), /duplicate home slots/);
});

test("moves normalize global quarter turns and reject non-tangent planes", () => {
  assert.deepEqual(normalizeHyperRubixMove({ cell: "w+", plane: "xy" }), {
    cell: "w+",
    plane: "xy",
    quarterTurns: 1,
  });
  assert.deepEqual(normalizeHyperRubixMove({ cell: "w+", plane: "xz", turns: 3 }), {
    cell: "w+",
    plane: "xz",
    quarterTurns: -1,
  });
  assert.equal(
    normalizeHyperRubixMove({ cell: "w+", plane: "yz", quarterTurns: -2 }).quarterTurns,
    2,
  );
  assert.equal(
    normalizeHyperRubixMove({ cell: "w+", plane: "xy", quarterTurns: 4 }).quarterTurns,
    0,
  );
  assert.equal(hyperRubixMoveKey({ cell: "w+", plane: "xy" }), "w+:xy:+1");
  assert.equal(hyperRubixMoveKey({ cell: "w+", plane: "xy", quarterTurns: -1 }), "w+:xy:-1");
  assert.throws(
    () => normalizeHyperRubixMove({ cell: "w+", plane: "xw" }),
    /not a tangent plane/,
  );
  assert.throws(
    () => normalizeHyperRubixMove({ cell: "x+", plane: "xy" }),
    /not a tangent plane/,
  );
  assert.throws(
    () => normalizeHyperRubixMove({ cell: "w+", plane: "xy", quarterTurns: 0.5 }),
    /must be an integer/,
  );
});

test("the basic move table contains both directions for three planes on every cell", () => {
  assert.equal(HYPER_RUBIX_BASIC_MOVES.length, 48);
  assert.equal(new Set(HYPER_RUBIX_BASIC_MOVES.map(hyperRubixMoveKey)).size, 48);
  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const moves = HYPER_RUBIX_BASIC_MOVES.filter(({ cell }) => cell === cellId);
    assert.equal(moves.length, 6);
    assert.deepEqual(new Set(moves.map(({ plane }) => plane)), new Set(
      HYPER_RUBIX_BOUNDARY_CELLS[cellId].tangentPlanes,
    ));
    assert.equal(moves.every(({ quarterTurns }) => Math.abs(quarterTurns) === 1), true);
  }
});

test("quarter-vector rotation is exact on all six coordinate planes", () => {
  const source = vector(1, 2, 3, 4);
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xy", 1), vector(-2, 1, 3, 4));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xz", 1), vector(-3, 2, 1, 4));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xw", 1), vector(-4, 2, 3, 1));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "yz", 1), vector(1, -3, 2, 4));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "yw", 1), vector(1, -4, 3, 2));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "zw", 1), vector(1, 2, -4, 3));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xy", -1), vector(2, -1, 3, 4));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xy", 2), vector(-1, -2, 3, 4));
  assert.deepEqual(rotateHyperRubixQuarterVector(source, "xy", 4), source);
  assert.deepEqual(source, vector(1, 2, 3, 4), "the input vector must not be mutated");
  assert.throws(() => rotateHyperRubixQuarterVector(source, "xx", 1), /Unknown 4D/);
});

test("one cell turn rotates its complete outer hyper-layer and leaves the rest shared", () => {
  const solved = createSolvedHyperRubix();
  const move = { cell: "w+", plane: "xy", quarterTurns: 1 };
  const affectedBefore = solved.stickers.filter((sticker) => (
    hyperRubixMoveAffectsSticker(sticker, move)
  ));
  assert.equal(affectedBefore.length, 81, "one 3D facet plus six 3 x 3 boundary strips move");

  const turned = turnHyperRubixBoundaryCell(solved, move);
  assert.notEqual(turned, solved);
  assert.equal(assertHyperRubixPuzzle(turned), turned);
  assert.deepEqual(solved, createSolvedHyperRubix(), "turning must not mutate the input puzzle");

  const sideSticker = turned.stickers.find(({ id }) => id === "x+:1:1:2");
  assert.deepEqual(sideSticker.position, vector(0, 1, 0, 1));
  assert.deepEqual(sideSticker.normal, vector(0, 1, 0, 0));
  assert.equal(hyperRubixCellForNormal(sideSticker.normal).id, "y+");

  const facetSticker = turned.stickers.find(({ id }) => id === "w+:2:1:1");
  assert.deepEqual(facetSticker.position, vector(0, 1, 0, 1));
  assert.deepEqual(facetSticker.normal, vector(0, 0, 0, 1));

  const untouchedIndex = solved.stickers.findIndex(({ id }) => id === "x+:1:1:1");
  assert.equal(turned.stickers[untouchedIndex], solved.stickers[untouchedIndex]);
  assert.equal(isHyperRubixSolved(turned), false);
  assert.equal(hyperRubixDisorderCount(turned), 36);
  closeTo(hyperRubixDisorder(turned), 1 / 6);
});

test("every legal quarter turn preserves all surface invariants and color counts", () => {
  const solved = createSolvedHyperRubix();
  const solvedHistogram = Object.fromEntries(Object.keys(HYPER_RUBIX_COLORS).map((color) => [
    color,
    solved.stickers.filter((sticker) => sticker.color === color).length,
  ]));
  for (const move of HYPER_RUBIX_BASIC_MOVES) {
    const turned = turnHyperRubixBoundaryCell(solved, move);
    assert.equal(assertHyperRubixPuzzle(turned), turned, hyperRubixMoveKey(move));
    const histogram = Object.fromEntries(Object.keys(HYPER_RUBIX_COLORS).map((color) => [
      color,
      turned.stickers.filter((sticker) => sticker.color === color).length,
    ]));
    assert.deepEqual(histogram, solvedHistogram, hyperRubixMoveKey(move));
    assert.equal(turned.stickers.length, HYPER_RUBIX_STICKER_COUNT);
  }
});

test("four turns, move inverses, and reversed algorithms restore exact state", () => {
  const solved = createSolvedHyperRubix();
  const move = { cell: "z-", plane: "xw", quarterTurns: 1 };
  const fourTurns = applyHyperRubixMoves(solved, [move, move, move, move]);
  assert.deepEqual(fourTurns, solved);

  const once = turnHyperRubixBoundaryCell(solved, move);
  assert.deepEqual(turnHyperRubixBoundaryCell(once, invertHyperRubixMove(move)), solved);
  assert.deepEqual(invertHyperRubixMove({ ...move, quarterTurns: 2 }), {
    cell: "z-",
    plane: "xw",
    quarterTurns: 2,
  });

  const algorithm = [
    { cell: "w+", plane: "xy", quarterTurns: 1 },
    { cell: "x-", plane: "zw", quarterTurns: -1 },
    { cell: "y+", plane: "xw", quarterTurns: 2 },
    { cell: "z+", plane: "yw", quarterTurns: 1 },
  ];
  const mixed = applyHyperRubixMoves(solved, algorithm);
  assert.equal(isHyperRubixSolved(mixed), false);
  assert.ok(hyperRubixDisorder(mixed) > 0 && hyperRubixDisorder(mixed) <= 1);
  assert.deepEqual(applyHyperRubixMoves(mixed, invertHyperRubixMoves(algorithm)), solved);
});

test("opposite disjoint cells commute while tangent rotations need not", () => {
  const solved = createSolvedHyperRubix();
  const positive = { cell: "w+", plane: "xy", quarterTurns: 1 };
  const negative = { cell: "w-", plane: "xy", quarterTurns: -1 };
  assert.deepEqual(
    applyHyperRubixMoves(solved, [positive, negative]),
    applyHyperRubixMoves(solved, [negative, positive]),
  );

  const xy = { cell: "w+", plane: "xy", quarterTurns: 1 };
  const xz = { cell: "w+", plane: "xz", quarterTurns: 1 };
  assert.notDeepEqual(
    applyHyperRubixMoves(solved, [xy, xz]),
    applyHyperRubixMoves(solved, [xz, xy]),
  );
});

test("seeded and injected-random scrambles are reproducible and avoid immediate slice repeats", () => {
  const first = createHyperRubixScramble(64, createSeededHyperRubixRandom(12345));
  const second = createHyperRubixScramble(64, createSeededHyperRubixRandom(12345));
  const different = createHyperRubixScramble(64, createSeededHyperRubixRandom(54321));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.length, 64);
  for (let index = 1; index < first.length; index += 1) {
    assert.notEqual(
      `${first[index - 1].cell}:${first[index - 1].plane}`,
      `${first[index].cell}:${first[index].plane}`,
    );
  }
  const solved = createSolvedHyperRubix();
  const scrambled = applyHyperRubixMoves(solved, first);
  assert.equal(assertHyperRubixPuzzle(scrambled), scrambled);
  assert.deepEqual(applyHyperRubixMoves(scrambled, invertHyperRubixMoves(first)), solved);

  const constant = createHyperRubixScramble(8, () => 0);
  assert.equal(constant.length, 8, "a constant injected source must not cause rejection loops");
  assert.deepEqual(createHyperRubixScramble(0, () => 0), []);
  assert.throws(() => createHyperRubixScramble(-1), /non-negative integer/);
  assert.throws(() => createHyperRubixScramble(1, () => 1), /values in \[0, 1\)/);
  assert.throws(() => createHyperRubixScramble(1, null), /must be a function/);
});

test("sequencer metadata maps every coordinate plane to one labeled drum", () => {
  assert.equal(HYPER_RUBIX_SEQUENCE_LENGTH, 16);
  assert.deepEqual(HYPER_RUBIX_PLANE_DRUMS, {
    xy: { id: "kick", family: "kick", label: "Kick" },
    xz: { id: "snare", family: "snare", label: "Snare" },
    yz: { id: "hat", family: "hat", label: "Hat" },
    xw: { id: "tom", family: "tom", label: "Tom" },
    yw: { id: "clap", family: "clap", label: "Clap" },
    zw: { id: "metal", family: "metal", label: "Metal" },
  });
  assert.equal(Object.isFrozen(HYPER_RUBIX_PLANE_DRUMS), true);
  for (const plane of HYPER_RUBIX_PLANES) {
    assert.equal(Object.isFrozen(HYPER_RUBIX_PLANE_DRUMS[plane]), true);
  }

  assert.deepEqual(Object.keys(HYPER_RUBIX_SEQUENCE_PATTERNS), [
    "axis-break", "straight-xyz", "w-pressure", "random-walk",
  ]);
  assert.deepEqual(
    Object.values(HYPER_RUBIX_SEQUENCE_PATTERNS).map(({ id, label, stochastic }) => (
      { id, label, stochastic }
    )),
    [
      { id: "axis-break", label: "Axis break", stochastic: false },
      { id: "straight-xyz", label: "Straight XYZ", stochastic: false },
      { id: "w-pressure", label: "W pressure", stochastic: false },
      { id: "random-walk", label: "Random walk", stochastic: true },
    ],
  );
  assert.equal(Object.isFrozen(HYPER_RUBIX_SEQUENCE_PATTERNS), true);
  for (const pattern of Object.values(HYPER_RUBIX_SEQUENCE_PATTERNS)) {
    assert.equal(Object.isFrozen(pattern), true);
    assert.ok(pattern.description.length > 20);
  }
});

test("Axis break is an exact frozen 16-step legal move and drum score", () => {
  const sequence = createHyperRubixSequence();
  assert.equal(sequence.length, HYPER_RUBIX_SEQUENCE_LENGTH);
  assert.equal(Object.isFrozen(sequence), true);
  assert.deepEqual(sequence.map(({ move }) => move?.plane ?? null), [
    "xy", "yz", null, "yz",
    "xz", "yz", "xy", "yw",
    "xy", "yz", "xw", "yz",
    "xz", "yz", "xy", "zw",
  ]);
  assert.deepEqual(sequence.map(({ drum }) => drum?.id ?? null), [
    "kick", "hat", null, "hat",
    "snare", "hat", "kick", "clap",
    "kick", "hat", "tom", "hat",
    "snare", "hat", "kick", "metal",
  ]);
  assert.deepEqual(
    sequence.filter(({ accent }) => accent).map(({ index }) => index),
    [0, 4, 8, 12],
  );
  assert.deepEqual(
    sequence.filter(({ active }) => active).map(({ index }) => index),
    [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  );
  assert.deepEqual(sequence[2], {
    index: 2,
    move: null,
    active: false,
    accent: false,
    drum: null,
  });

  let activeOrdinal = 0;
  for (const [index, step] of sequence.entries()) {
    assert.deepEqual(Object.keys(step), ["index", "move", "active", "accent", "drum"]);
    assert.equal(step.index, index);
    assert.equal(Object.isFrozen(step), true);
    if (!step.move) continue;
    assert.equal(Object.isFrozen(step.move), true);
    assert.deepEqual(normalizeHyperRubixMove(step.move), step.move);
    const cell = hyperRubixBoundaryCell(step.move.cell);
    assert.ok(cell.tangentPlanes.includes(step.move.plane));
    assert.equal(step.move.cell.endsWith(activeOrdinal % 2 === 0 ? "+" : "-"), true);
    assert.equal(step.drum, HYPER_RUBIX_PLANE_DRUMS[step.move.plane]);
    activeOrdinal += 1;
  }

  const deterministic = createHyperRubixSequence("axis-break", 1, () => {
    throw new Error("deterministic patterns must not consume randomness");
  });
  assert.deepEqual(deterministic, sequence);
});

test("all authored patterns produce legal immutable moves and density only gates activity", () => {
  for (const patternId of ["axis-break", "straight-xyz", "w-pressure"]) {
    const first = createHyperRubixSequence(patternId, 1, () => 0);
    const second = createHyperRubixSequence(patternId, 1, () => 0.999);
    assert.deepEqual(first, second, `${patternId} should be deterministic`);
    assert.equal(first.length, 16);
    for (const step of first) {
      if (!step.move) continue;
      assert.deepEqual(normalizeHyperRubixMove(step.move), step.move);
      assert.equal(step.drum, HYPER_RUBIX_PLANE_DRUMS[step.move.plane]);
    }
  }

  const full = createHyperRubixSequence("axis-break", 1);
  const high = createHyperRubixSequence("axis-break", 0.75);
  const medium = createHyperRubixSequence("axis-break", 0.5);
  const sparse = createHyperRubixSequence("axis-break", 0.25);
  const anchors = createHyperRubixSequence("axis-break", 0);
  const moves = (sequence) => sequence.map(({ move }) => move);
  for (const sequence of [high, medium, sparse, anchors]) {
    assert.deepEqual(moves(sequence), moves(full), "density must preserve every authored move");
    assert.deepEqual(
      sequence.map(({ drum }) => drum),
      full.map(({ drum }) => drum),
      "density must preserve drum metadata",
    );
  }
  assert.deepEqual(anchors.filter(({ active }) => active).map(({ index }) => index), [0, 4, 8, 12]);
  assert.deepEqual(sparse.filter(({ active }) => active).map(({ index }) => index), [
    0, 4, 6, 8, 10, 12, 14,
  ]);
  assert.deepEqual(medium.filter(({ active }) => active).map(({ index }) => index), [
    0, 1, 4, 5, 6, 8, 9, 10, 12, 13, 14,
  ]);
  assert.deepEqual(
    high.filter(({ active }) => active).map(({ index }) => index),
    medium.filter(({ active }) => active).map(({ index }) => index),
    "the lowest-priority offbeat stays muted below full density",
  );
  assert.equal(full.every(({ move, active }) => active === Boolean(move)), true);
});

test("random-walk sequences are injected-random, reproducible, and never repeat a slice", () => {
  const first = createHyperRubixSequence(
    "random-walk",
    1,
    createSeededHyperRubixRandom(0x4444),
  );
  const second = createHyperRubixSequence(
    "random-walk",
    1,
    createSeededHyperRubixRandom(0x4444),
  );
  const different = createHyperRubixSequence(
    "random-walk",
    1,
    createSeededHyperRubixRandom(0x5555),
  );
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(first.every(({ move, active }) => Boolean(move) && active), true);
  for (let index = 1; index < first.length; index += 1) {
    const previous = first[index - 1].move;
    const current = first[index].move;
    assert.notEqual(`${previous.cell}:${previous.plane}`, `${current.cell}:${current.plane}`);
    assert.notEqual(hyperRubixMoveKey(invertHyperRubixMove(previous)), hyperRubixMoveKey(current));
  }

  const constant = createHyperRubixSequence("random-walk", 1, () => 0);
  assert.equal(constant.length, 16, "a constant random source must not cause a rejection loop");
  const dense = createHyperRubixSequence(
    "random-walk",
    1,
    createSeededHyperRubixRandom(88),
  );
  const sparse = createHyperRubixSequence(
    "random-walk",
    0,
    createSeededHyperRubixRandom(88),
  );
  assert.deepEqual(
    dense.map(({ move }) => move),
    sparse.map(({ move }) => move),
    "density must not alter or consume random move choices",
  );
  assert.deepEqual(sparse.filter(({ active }) => active).map(({ index }) => index), [0, 4, 8, 12]);

  assert.throws(() => createHyperRubixSequence("unknown"), /Unknown Hyper Rubix sequence pattern/);
  assert.throws(() => createHyperRubixSequence("axis-break", -0.01), /between 0 and 1/);
  assert.throws(() => createHyperRubixSequence("axis-break", 1.01), /between 0 and 1/);
  assert.throws(() => createHyperRubixSequence("axis-break", Number.NaN), /finite number/);
  assert.throws(() => createHyperRubixSequence("axis-break", 1, null), /must be a function/);
  assert.throws(() => createHyperRubixSequence("random-walk", 1, () => -0.1), /values in \[0, 1\)/);
  assert.throws(() => createHyperRubixSequence("random-walk", 1, () => 1), /values in \[0, 1\)/);
});

test("sequence traversal supports forward, reverse, pendulum, and injected random modes", () => {
  assert.deepEqual(
    [-1, 0, 1, 15, 16, 17].map((step) => hyperRubixSequenceIndex("forward", step)),
    [15, 0, 1, 15, 0, 1],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4, -1].map((step) => hyperRubixSequenceIndex("reverse", step, 4)),
    [3, 2, 1, 0, 3, 0],
  );
  assert.deepEqual(
    Array.from({ length: 9 }, (_, step) => hyperRubixSequenceIndex("pendulum", step, 4)),
    [0, 1, 2, 3, 2, 1, 0, 1, 2],
  );
  assert.equal(hyperRubixSequenceIndex("pendulum", -1, 4), 1);
  assert.equal(hyperRubixSequenceIndex("pendulum", 999, 1), 0);
  assert.equal(hyperRubixSequenceIndex("random", 0, 16, () => 0), 0);
  assert.equal(hyperRubixSequenceIndex("random", 0, 16, () => 0.999), 15);

  assert.throws(() => hyperRubixSequenceIndex("sideways", 0), /Unknown Hyper Rubix sequence mode/);
  assert.throws(() => hyperRubixSequenceIndex("forward", 0, 0), /positive integer/);
  assert.throws(() => hyperRubixSequenceIndex("forward", 0, 2.5), /positive integer/);
  assert.throws(() => hyperRubixSequenceIndex("forward", 0.5), /must be an integer/);
  assert.throws(() => hyperRubixSequenceIndex("random", 0, 16, null), /must be a function/);
  assert.throws(() => hyperRubixSequenceIndex("random", 0, 16, () => 1), /values in \[0, 1\)/);
});

test("sequencer duration clamps tempo and swing from quarter notes through sixty-fourths", () => {
  const defaultStraight = 60 / 112 / 2;
  closeTo(hyperRubixStepDurationSeconds(), defaultStraight * 1.08);
  closeTo(hyperRubixStepDurationSeconds(112, 2, 0.08, 1), defaultStraight * 0.92);
  closeTo(
    hyperRubixStepDurationSeconds(112, 2, 0.08, 0)
      + hyperRubixStepDurationSeconds(112, 2, 0.08, 1),
    defaultStraight * 2,
  );
  closeTo(hyperRubixStepDurationSeconds(120, 1, 0, 0), 0.5);
  closeTo(hyperRubixStepDurationSeconds(120, 2, 0, 0), 0.25);
  closeTo(hyperRubixStepDurationSeconds(120, 4, 0, 0), 0.125);
  closeTo(hyperRubixStepDurationSeconds(120, 8, 0, 0), 0.0625);
  closeTo(hyperRubixStepDurationSeconds(120, 16, 0, 0), 0.03125);
  closeTo(hyperRubixStepDurationSeconds(1, 2, 0, 0), 1);
  closeTo(hyperRubixStepDurationSeconds(999, 2, 0, 0), 0.1);
  closeTo(hyperRubixStepDurationSeconds(120, 2, -10, 0), 0.25);
  closeTo(hyperRubixStepDurationSeconds(120, 2, 10, 0), 0.25 * 1.42);
  closeTo(hyperRubixStepDurationSeconds(120, 2, 0.2, -1), 0.2);

  assert.throws(() => hyperRubixStepDurationSeconds(Number.NaN), /tempo must be a finite number/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 3), /must be 1, 2, 4, 8, or 16/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 2, Number.NaN), /swing must be a finite number/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 2, 0.1, 0.5), /swing step must be an integer/);
});

test("eight frozen cell colours map to eight stable techno voice families", () => {
  assert.equal(Object.isFrozen(HYPER_RUBIX_TECHNO_VOICES), true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(HYPER_RUBIX_TECHNO_VOICES).map(([cell, voice]) => [
      cell,
      `${voice.color}:${voice.id}`,
    ])),
    {
      "x+": "red:kick",
      "x-": "orange:sub",
      "y+": "white:clap",
      "y-": "yellow:snare",
      "z+": "green:open-hat",
      "z-": "blue:closed-hat",
      "w+": "violet:stab",
      "w-": "cyan:rim",
    },
  );
  assert.equal(
    new Set(Object.values(HYPER_RUBIX_TECHNO_VOICES).map(({ id }) => id)).size,
    8,
  );

  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const voice = HYPER_RUBIX_TECHNO_VOICES[cellId];
    assert.equal(Object.isFrozen(voice), true);
    assert.equal(voice.cell, cellId);
    assert.equal(voice.color, HYPER_RUBIX_BOUNDARY_CELLS[cellId].color);
    assert.equal(voice.family, voice.id);
    for (const key of [
      "baseMidi",
      "baseFilterHz",
      "baseDecaySeconds",
      "baseDrive",
      "baseRattle",
    ]) {
      assert.equal(Number.isFinite(voice[key]), true, `${cellId} ${key} must be finite`);
    }
  }
});

test("techno voice parameters combine a move and normalized geometry within hard bounds", () => {
  const geometry = {
    position: { x: -0.6, y: 0.25, z: 0.8, w: -0.3 },
    pan: 0.75,
    angle: 0.25,
    depth: 0.9,
    disorder: 0.6,
    shapeInfluence: 0.8,
  };
  const untouchedGeometry = structuredClone(geometry);
  const parameters = hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz", quarterTurns: -1 },
    geometry,
  );
  assert.deepEqual(geometry, untouchedGeometry);
  assert.deepEqual(Object.keys(parameters), [
    "voice", "move", "pitchHz", "filterHz", "filterQ", "decaySeconds", "pan", "drive", "rattle",
  ]);
  assert.equal(parameters.voice, HYPER_RUBIX_TECHNO_VOICES["x+"]);
  assert.deepEqual(parameters.move, { cell: "x+", plane: "yz", quarterTurns: -1 });
  assert.equal(Object.isFrozen(parameters), true);
  assert.equal(Object.isFrozen(parameters.move), true);

  const bounds = {
    pitchHz: [24, 4_200],
    filterHz: [90, 16_000],
    filterQ: [0.45, 7.5],
    decaySeconds: [0.035, 2.5],
    pan: [-1, 1],
    drive: [0, 1],
    rattle: [0, 1],
  };
  for (const [name, [minimum, maximum]] of Object.entries(bounds)) {
    assert.equal(Number.isFinite(parameters[name]), true);
    assert.ok(parameters[name] >= minimum, `${name} must be at least ${minimum}`);
    assert.ok(parameters[name] <= maximum, `${name} must be at most ${maximum}`);
  }

  for (const cellId of HYPER_RUBIX_CELL_ORDER) {
    const boundary = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
    const extreme = hyperRubixTechnoVoiceParameters({
      cell: cellId,
      plane: boundary.tangentPlanes[0],
      quarterTurns: 1,
    }, {
      position: { x: -999, y: 999, z: -999, w: 999 },
      pan: 999,
      angle: 999,
      depth: -999,
      disorder: 999,
      shapeInfluence: 999,
      pitchInfluence: 999,
      filterInfluence: 999,
      stereoInfluence: 999,
      wInfluence: 999,
      disorderInfluence: 999,
    });
    assert.equal(extreme.voice, HYPER_RUBIX_TECHNO_VOICES[cellId]);
    for (const [name, [minimum, maximum]] of Object.entries(bounds)) {
      assert.ok(extreme[name] >= minimum && extreme[name] <= maximum, `${cellId} ${name}`);
    }
  }

  const shapeOffLeft = hyperRubixTechnoVoiceParameters(
    { cell: "w+", plane: "xy", quarterTurns: 1 },
    { position: -1, pan: -1, angle: 0.25, depth: 0, shapeInfluence: 0 },
  );
  const shapeOffRight = hyperRubixTechnoVoiceParameters(
    { cell: "w+", plane: "xy", quarterTurns: 1 },
    { position: 1, pan: 1, angle: 0.75, depth: 1, shapeInfluence: 0 },
  );
  assert.deepEqual(shapeOffLeft, shapeOffRight, "zero influence must remove geometry modulation");
  const shapeOn = hyperRubixTechnoVoiceParameters(
    { cell: "w+", plane: "xy", quarterTurns: 1 },
    { position: 1, pan: 1, angle: 0.25, depth: 1, shapeInfluence: 1 },
  );
  assert.notDeepEqual(shapeOn, shapeOffRight, "shape influence must enable geometry modulation");
  const positionPan = hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz" },
    { position: { x: 1 } },
  );
  const overriddenPan = hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz" },
    { position: { x: 1 }, pan: -1 },
  );
  assert.ok(overriddenPan.pan < positionPan.pan, "pan must override projected position.x");
  const darkPlane = hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz", quarterTurns: 1 },
  );
  const brightPlane = hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "zw", quarterTurns: 1 },
  );
  assert.ok(brightPlane.filterHz > darkPlane.filterHz, "plane slot must tilt the filter");
  assert.ok(brightPlane.filterQ > darkPlane.filterQ, "plane slot must raise filter resonance");

  assert.throws(() => hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz" },
    null,
  ), /geometry must be an object/);
  assert.throws(() => hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz" },
    { position: "left" },
  ), /position must be a finite number or point object/);
  assert.throws(() => hyperRubixTechnoVoiceParameters(
    { cell: "x+", plane: "yz" },
    { position: { x: Number.NaN } },
  ), /position\.x must be a finite number/);
  for (const key of [
    "pan",
    "angle",
    "depth",
    "disorder",
    "shapeInfluence",
    "pitchInfluence",
    "filterInfluence",
    "stereoInfluence",
    "wInfluence",
    "disorderInfluence",
  ]) {
    assert.throws(() => hyperRubixTechnoVoiceParameters(
      { cell: "x+", plane: "yz" },
      { [key]: Number.NaN },
    ), new RegExp(`${key} must be a finite number`));
  }
});

test("independent DSP influences inherit the legacy macro and scale only their dimensions", () => {
  const move = { cell: "x+", plane: "yz", quarterTurns: 1 };
  const descriptors = {
    position: { x: 0.4, y: 0.55, z: 0.7, w: -0.35 },
    pan: 0.6,
    angle: 0.125,
    depth: 0.85,
    disorder: 0.65,
  };
  const legacy = hyperRubixTechnoVoiceParameters(move, {
    ...descriptors,
    shapeInfluence: 0.64,
  });
  const explicitlySplit = hyperRubixTechnoVoiceParameters(move, {
    ...descriptors,
    shapeInfluence: 0,
    pitchInfluence: 0.64,
    filterInfluence: 0.64,
    stereoInfluence: 0.64,
    wInfluence: 0.64,
    disorderInfluence: 0.64,
  });
  assert.deepEqual(
    explicitlySplit,
    legacy,
    "omitted DSP influences must reproduce the legacy shape macro exactly",
  );

  const allOff = {
    pitchInfluence: 0,
    filterInfluence: 0,
    stereoInfluence: 0,
    wInfluence: 0,
    disorderInfluence: 0,
  };
  const neutral = hyperRubixTechnoVoiceParameters(move, {
    ...allOff,
    position: { x: 0, y: 0, z: 0, w: 0 },
    pan: 0,
    angle: 0,
    depth: 0.5,
    disorder: 0,
  });

  const pitchGeometry = {
    ...allOff,
    position: { y: 0.5, z: 0.75 },
    angle: 0.25,
    depth: 0.5,
  };
  const pitchZero = hyperRubixTechnoVoiceParameters(move, pitchGeometry);
  const pitchOne = hyperRubixTechnoVoiceParameters(move, {
    ...pitchGeometry,
    pitchInfluence: 1,
  });
  const pitchTwo = hyperRubixTechnoVoiceParameters(move, {
    ...pitchGeometry,
    pitchInfluence: 2,
  });
  assert.deepEqual(pitchZero, neutral);
  assert.ok(pitchOne.pitchHz > neutral.pitchHz);
  assert.ok(pitchTwo.pitchHz - neutral.pitchHz > pitchOne.pitchHz - neutral.pitchHz);

  const filterGeometry = {
    ...allOff,
    position: { y: 0.75 },
    angle: 0.25,
    depth: 0.5,
  };
  const filterZero = hyperRubixTechnoVoiceParameters(move, filterGeometry);
  const filterOne = hyperRubixTechnoVoiceParameters(move, {
    ...filterGeometry,
    filterInfluence: 1,
  });
  const filterTwo = hyperRubixTechnoVoiceParameters(move, {
    ...filterGeometry,
    filterInfluence: 2,
  });
  assert.deepEqual(filterZero, neutral);
  assert.ok(filterOne.filterHz > neutral.filterHz);
  assert.ok(filterTwo.filterHz - neutral.filterHz > filterOne.filterHz - neutral.filterHz);
  assert.ok(filterOne.filterQ > neutral.filterQ);
  assert.ok(filterTwo.filterQ > filterOne.filterQ);

  const stereoGeometry = { ...allOff, pan: 0.4 };
  const stereoZero = hyperRubixTechnoVoiceParameters(move, stereoGeometry);
  const stereoOne = hyperRubixTechnoVoiceParameters(move, {
    ...stereoGeometry,
    stereoInfluence: 1,
  });
  const stereoTwo = hyperRubixTechnoVoiceParameters(move, {
    ...stereoGeometry,
    stereoInfluence: 2,
  });
  assert.deepEqual(stereoZero, neutral);
  assert.ok(stereoOne.pan > neutral.pan);
  assert.ok(stereoTwo.pan - neutral.pan > stereoOne.pan - neutral.pan);

  const wGeometry = {
    ...allOff,
    position: { w: 0.75 },
    depth: 1,
  };
  const wZero = hyperRubixTechnoVoiceParameters(move, wGeometry);
  const wOne = hyperRubixTechnoVoiceParameters(move, { ...wGeometry, wInfluence: 1 });
  const wTwo = hyperRubixTechnoVoiceParameters(move, { ...wGeometry, wInfluence: 2 });
  assert.deepEqual(wZero, neutral);
  assert.ok(wOne.pitchHz > neutral.pitchHz);
  assert.ok(wTwo.pitchHz - neutral.pitchHz > wOne.pitchHz - neutral.pitchHz);
  assert.ok(wOne.filterHz > neutral.filterHz);
  assert.ok(wTwo.filterHz > wOne.filterHz);
  assert.ok(wOne.decaySeconds < neutral.decaySeconds);
  assert.ok(wTwo.decaySeconds < wOne.decaySeconds);

  const disorderGeometry = { ...allOff, disorder: 0.6 };
  const disorderZero = hyperRubixTechnoVoiceParameters(move, disorderGeometry);
  const disorderOne = hyperRubixTechnoVoiceParameters(move, {
    ...disorderGeometry,
    disorderInfluence: 1,
  });
  const disorderTwo = hyperRubixTechnoVoiceParameters(move, {
    ...disorderGeometry,
    disorderInfluence: 2,
  });
  assert.deepEqual(disorderZero, neutral);
  assert.ok(disorderOne.pitchHz > neutral.pitchHz);
  assert.ok(disorderTwo.pitchHz - neutral.pitchHz > disorderOne.pitchHz - neutral.pitchHz);
  assert.ok(disorderOne.filterHz > neutral.filterHz);
  assert.ok(disorderTwo.filterHz > disorderOne.filterHz);
  assert.ok(disorderTwo.rattle > disorderOne.rattle);

  const bounded = [pitchTwo, filterTwo, stereoTwo, wTwo, disorderTwo];
  for (const parameters of bounded) {
    assert.ok(parameters.pitchHz >= 24 && parameters.pitchHz <= 4_200);
    assert.ok(parameters.filterHz >= 90 && parameters.filterHz <= 16_000);
    assert.ok(parameters.filterQ >= 0.45 && parameters.filterQ <= 7.5);
    assert.ok(parameters.decaySeconds >= 0.035 && parameters.decaySeconds <= 2.5);
    assert.ok(parameters.pan >= -1 && parameters.pan <= 1);
    assert.ok(parameters.drive >= 0 && parameters.drive <= 1);
    assert.ok(parameters.rattle >= 0 && parameters.rattle <= 1);
  }
  assert.deepEqual(
    hyperRubixTechnoVoiceParameters(move, { ...pitchGeometry, pitchInfluence: -99 }),
    pitchZero,
  );
  assert.deepEqual(
    hyperRubixTechnoVoiceParameters(move, { ...pitchGeometry, pitchInfluence: 99 }),
    pitchTwo,
  );
});

test("the 27-step hyperbar places exactly one event from every current cell in every slot", () => {
  const puzzle = createSolvedHyperRubix();
  const snapshot = createHyperRubixHyperbarSnapshot(puzzle);
  assert.equal(HYPER_RUBIX_HYPERBAR_LENGTH, 27);
  assert.equal(HYPER_RUBIX_CONCEPTUAL_VOICE_COUNT, 217);
  assert.equal(HYPER_RUBIX_CONCEPTUAL_VOICE_COUNT, HYPER_RUBIX_STICKER_COUNT + 1);
  assert.equal(snapshot.length, 27);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(snapshot.map(({ group }) => group), [
    ...Array(9).fill(0),
    ...Array(9).fill(1),
    ...Array(9).fill(2),
  ]);
  assert.deepEqual(snapshot.map(({ subgroup }) => subgroup), [
    0, 0, 0, 1, 1, 1, 2, 2, 2,
    0, 0, 0, 1, 1, 1, 2, 2, 2,
    0, 0, 0, 1, 1, 1, 2, 2, 2,
  ]);

  const stepById = new Map();
  for (const slot of snapshot) {
    assert.equal(slot.index >= 0 && slot.index <= 26, true);
    assert.equal(slot.events.length, 8);
    assert.equal(Object.isFrozen(slot), true);
    assert.equal(Object.isFrozen(slot.events), true);
    assert.deepEqual(slot.events.map(({ cell }) => cell), HYPER_RUBIX_CELL_ORDER);
    for (const event of slot.events) {
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.position), true);
      assert.equal(Object.isFrozen(event.configuration), true);
      assert.equal(event.id, event.stickerId);
      assert.equal(event.voice, HYPER_RUBIX_TECHNO_VOICES[event.homeCell]);
      assert.equal(event.color, event.voice.color);
      assert.equal(typeof event.gate, "boolean");
      assert.equal(typeof event.accent, "boolean");
      stepById.set(event.id, slot.index);
    }
  }

  const events = snapshot.flatMap(({ events: slotEvents }) => slotEvents);
  assert.equal(events.length, 27 * 8);
  assert.equal(events.length, HYPER_RUBIX_STICKER_COUNT);
  assert.equal(new Set(events.map(({ id }) => id)).size, HYPER_RUBIX_STICKER_COUNT);
  assert.equal(snapshot[0].events.every(({ gate, accent }) => gate && accent), true);
  assert.deepEqual(
    snapshot[1].events.filter(({ gate }) => gate).map(({ homeCell }) => homeCell),
    ["x-", "z+", "w-"],
  );

  for (const sticker of puzzle.stickers) {
    assert.equal(stepById.get(sticker.id), hyperRubixStickerStepIndex(sticker));
  }
  assert.equal(hyperRubixStickerStepIndex(
    puzzle.stickers.find(({ id }) => id === "x+:0:0:0"),
  ), 0);
  assert.equal(hyperRubixStickerStepIndex(
    puzzle.stickers.find(({ id }) => id === "x+:1:1:1"),
  ), 13);
  assert.equal(hyperRubixStickerStepIndex(
    puzzle.stickers.find(({ id }) => id === "x+:2:2:2"),
  ), 26);
  assert.equal(hyperRubixStickerStepIndex(
    puzzle.stickers.find(({ id }) => id === "y+:2:0:1"),
  ), 19);

  assert.throws(() => hyperRubixStickerStepIndex(null), /sticker must be an object/);
  assert.throws(() => hyperRubixStickerStepIndex({
    position: vector(0.25, 1, 0, 0),
    normal: vector(0, 1, 0, 0),
  }), /exact puzzle lattice/);
});

test("solved hyperbar events expose exact six-connected cubical neighborhoods", () => {
  const puzzle = createSolvedHyperRubix();
  const snapshot = createHyperRubixHyperbarSnapshot(puzzle);
  const events = snapshot.flatMap(({ events: slotEvents }) => slotEvents);
  const neighborCountByRadialClass = {
    center: 6,
    face: 5,
    edge: 4,
    corner: 3,
  };
  const expectedRadialHistogram = {
    center: 8,
    face: 48,
    edge: 96,
    corner: 64,
  };
  const actualRadialHistogram = {
    center: 0,
    face: 0,
    edge: 0,
    corner: 0,
  };

  for (const event of events) {
    const configuration = event.configuration;
    assert.deepEqual(Object.keys(configuration), [
      "neighborCount",
      "sameColorNeighbors",
      "neighborDiversity",
      "radialClass",
      "displaced",
    ]);
    assert.equal(
      configuration.neighborCount,
      neighborCountByRadialClass[configuration.radialClass],
    );
    assert.equal(configuration.sameColorNeighbors, configuration.neighborCount);
    assert.equal(configuration.neighborDiversity, 0);
    assert.equal(configuration.displaced, false);
    actualRadialHistogram[configuration.radialClass] += 1;
  }
  assert.deepEqual(actualRadialHistogram, expectedRadialHistogram);

  const center = puzzle.stickers.find(({ id }) => id === "x+:1:1:1");
  const corner = puzzle.stickers.find(({ id }) => id === "x+:0:0:0");
  assert.deepEqual(hyperRubixStickerConfiguration(puzzle, center), {
    neighborCount: 6,
    sameColorNeighbors: 6,
    neighborDiversity: 0,
    radialClass: "center",
    displaced: false,
  });
  assert.deepEqual(hyperRubixStickerConfiguration(puzzle, corner.id), {
    neighborCount: 3,
    sameColorNeighbors: 3,
    neighborDiversity: 0,
    radialClass: "corner",
    displaced: false,
  });
  assert.throws(
    () => hyperRubixStickerConfiguration(puzzle, null),
    /requires a sticker or sticker ID/,
  );
  assert.throws(
    () => hyperRubixStickerConfiguration(puzzle, "missing-sticker"),
    /Unknown Hyper Rubix sticker/,
  );
});

test("sticker topology exposes a stable ordered graph and travels with snapshot events", () => {
  const puzzle = createSolvedHyperRubix();
  const center = puzzle.stickers.find(({ id }) => id === "x+:1:1:1");
  const topology = hyperRubixStickerTopology(puzzle, center);
  assert.deepEqual(Object.keys(topology), [
    "stickerId",
    "currentCell",
    "homeCell",
    "cellDisplaced",
    "displaced",
    "neighborCount",
    "connections",
  ]);
  assert.equal(Object.isFrozen(topology), true);
  assert.equal(Object.isFrozen(topology.connections), true);
  assert.deepEqual(topology, {
    stickerId: center.id,
    currentCell: "x+",
    homeCell: "x+",
    cellDisplaced: false,
    displaced: false,
    neighborCount: 6,
    connections: [
      {
        axis: "y", direction: -1, sign: "-", stickerId: "x+:0:1:1",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
      {
        axis: "y", direction: 1, sign: "+", stickerId: "x+:2:1:1",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
      {
        axis: "z", direction: -1, sign: "-", stickerId: "x+:1:0:1",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
      {
        axis: "z", direction: 1, sign: "+", stickerId: "x+:1:2:1",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
      {
        axis: "w", direction: -1, sign: "-", stickerId: "x+:1:1:0",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
      {
        axis: "w", direction: 1, sign: "+", stickerId: "x+:1:1:2",
        color: "red", homeCell: "x+", sameColor: true, displaced: false,
      },
    ],
  });
  assert.equal(topology.connections.every(Object.isFrozen), true);

  const event = createHyperRubixStickerStream(puzzle).find(({ id }) => id === center.id);
  assert.deepEqual(event.topology, topology);
  assert.equal(Object.isFrozen(event.topology), true);
  assert.equal(Object.isFrozen(event.topology.connections), true);
  assert.equal(event.configuration.neighborCount, event.topology.neighborCount);
  assert.equal(
    event.configuration.sameColorNeighbors,
    event.topology.connections.filter(({ sameColor }) => sameColor).length,
  );

  const turned = turnHyperRubixBoundaryCell(puzzle, {
    cell: "x+", plane: "yz", quarterTurns: 1,
  });
  const turnedEvents = createHyperRubixStickerStream(turned);
  assert.equal(turnedEvents.some(({ topology: graph }) => (
    graph.connections.some(({ sameColor }) => !sameColor)
  )), true);
  assert.equal(turnedEvents.some(({ topology: graph }) => graph.displaced), true);
  assert.equal(turnedEvents.some(({ topology: graph }) => graph.cellDisplaced), true);

  assert.throws(
    () => hyperRubixStickerTopology(puzzle, null),
    /topology requires a sticker or sticker ID/,
  );
  assert.throws(
    () => hyperRubixStickerTopology(puzzle, "missing-sticker"),
    /Unknown Hyper Rubix sticker/,
  );
});

test("variable hyperbars preserve 8-cell order, all IDs, corners, and local configuration", () => {
  const expectedRadialHistograms = {
    2: { center: 0, face: 0, edge: 0, corner: 64 },
    3: { center: 8, face: 48, edge: 96, corner: 64 },
    4: { center: 64, face: 192, edge: 192, corner: 64 },
  };
  const neighborCountByRadialClass = { center: 6, face: 5, edge: 4, corner: 3 };
  const move = { cell: "x+", plane: "yz", quarterTurns: 1 };

  for (const size of [2, 3, 4]) {
    const solved = createSolvedHyperRubix(size);
    const snapshot = createHyperRubixHyperbarSnapshot(solved);
    const stream = createHyperRubixStickerStream(solved);
    const corners = createHyperRubixStickerStream(solved, { cornersOnly: true });
    assert.equal(snapshot.length, size ** 3);
    assert.equal(stream.length, 8 * size ** 3);
    assert.equal(corners.length, 64);
    assert.equal(new Set(stream.map(({ id }) => id)).size, 8 * size ** 3);
    assert.equal(new Set(corners.map(({ id }) => id)).size, 64);
    assert.deepEqual(stream, snapshot.flatMap(({ events }) => events));

    const histogram = { center: 0, face: 0, edge: 0, corner: 0 };
    for (const slot of snapshot) {
      assert.equal(slot.group, Math.floor(slot.index / size ** 2));
      assert.equal(slot.subgroup, Math.floor((slot.index % size ** 2) / size));
      assert.deepEqual(slot.events.map(({ cell }) => cell), HYPER_RUBIX_CELL_ORDER);
      for (const event of slot.events) {
        assert.equal(hyperRubixStickerStepIndex(event), slot.index);
        assert.equal(event.voice, HYPER_RUBIX_TECHNO_VOICES[event.homeCell]);
        assert.equal(event.configuration.neighborDiversity, 0);
        assert.equal(event.configuration.displaced, false);
        assert.equal(
          event.configuration.neighborCount,
          neighborCountByRadialClass[event.configuration.radialClass],
        );
        assert.equal(
          event.configuration.sameColorNeighbors,
          event.configuration.neighborCount,
        );
        assert.equal(event.topology.connections.length, event.configuration.neighborCount);
        histogram[event.configuration.radialClass] += 1;
      }
    }
    assert.deepEqual(histogram, expectedRadialHistograms[size]);
    assert.equal(corners.every(({ configuration }) => (
      configuration.radialClass === "corner" && configuration.neighborCount === 3
    )), true);
    if (size === 2) assert.deepEqual(corners, stream);

    for (let step = 0; step < snapshot.length; step += 1) {
      assert.deepEqual(stream.slice(step * 8, step * 8 + 8), snapshot[step].events);
    }

    const turned = turnHyperRubixBoundaryCell(solved, move);
    const turnedStream = createHyperRubixStickerStream(turned);
    const turnedById = new Map(turnedStream.map((event) => [event.id, event]));
    assert.deepEqual(
      [...turnedById.keys()].sort(),
      [...stream.map(({ id }) => id)].sort(),
    );
    assert.equal(turnedStream.some(({ configuration }) => configuration.displaced), true);
    assert.equal(turnedStream.some(({ configuration }) => (
      configuration.neighborDiversity > 0
    )), true);
    assert.equal(stream.some((event) => (
      hyperRubixStickerStepIndex(event)
        !== hyperRubixStickerStepIndex(turnedById.get(event.id))
    )), true);
    for (const event of stream) {
      const moved = turnedById.get(event.id);
      assert.equal(moved.color, event.color);
      assert.equal(moved.homeCell, event.homeCell);
      assert.equal(moved.voice, event.voice);
    }
  }
});

test("the full sticker stream scans 27 spatial positions with eight current-cell voices each", () => {
  const puzzle = createSolvedHyperRubix();
  const stream = createHyperRubixStickerStream(puzzle);
  const snapshotEvents = createHyperRubixHyperbarSnapshot(puzzle)
    .flatMap(({ events }) => events);
  assert.equal(HYPER_RUBIX_STICKER_STREAM_LENGTH, 216);
  assert.equal(HYPER_RUBIX_STICKER_STREAM_LENGTH, HYPER_RUBIX_STICKER_COUNT);
  assert.equal(stream.length, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(Object.isFrozen(stream), true);
  assert.deepEqual(stream, snapshotEvents);
  assert.equal(new Set(stream.map(({ id }) => id)).size, HYPER_RUBIX_STICKER_COUNT);
  assert.equal(stream.every((event) => (
    Object.isFrozen(event)
    && Object.isFrozen(event.position)
    && Object.isFrozen(event.configuration)
  )), true);

  for (let position = 0; position < HYPER_RUBIX_HYPERBAR_LENGTH; position += 1) {
    const voices = stream.slice(position * 8, position * 8 + 8);
    assert.deepEqual(voices.map(({ cell }) => cell), HYPER_RUBIX_CELL_ORDER);
    assert.equal(
      voices.every((event) => hyperRubixStickerStepIndex(
        puzzle.stickers.find(({ id }) => id === event.id),
      ) === position),
      true,
    );
  }
  assert.deepEqual(
    createHyperRubixStickerStream(puzzle),
    stream,
    "the same puzzle must produce the same deterministic serial scan",
  );
});

test("corner-only sticker streams retain eight voices at each of eight spatial corners", () => {
  const solved = createSolvedHyperRubix();
  const full = createHyperRubixStickerStream(solved);
  const corners = createHyperRubixStickerStream(solved, { cornersOnly: true });
  assert.equal(HYPER_RUBIX_CORNER_STREAM_LENGTH, 64);
  assert.equal(corners.length, HYPER_RUBIX_CORNER_STREAM_LENGTH);
  assert.equal(Object.isFrozen(corners), true);
  assert.deepEqual(
    corners,
    full.filter(({ configuration }) => configuration.radialClass === "corner"),
  );
  assert.equal(corners.every(({ configuration }) => (
    configuration.radialClass === "corner" && configuration.neighborCount === 3
  )), true);
  for (let corner = 0; corner < 8; corner += 1) {
    assert.deepEqual(
      corners.slice(corner * 8, corner * 8 + 8).map(({ cell }) => cell),
      HYPER_RUBIX_CELL_ORDER,
    );
  }
  const cornerSteps = createHyperRubixHyperbarSnapshot(solved)
    .filter(({ events }) => events[0].configuration.radialClass === "corner")
    .map(({ index }) => index);
  assert.deepEqual(cornerSteps, [0, 2, 6, 8, 18, 20, 24, 26]);

  const turned = turnHyperRubixBoundaryCell(solved, {
    cell: "w+",
    plane: "xy",
    quarterTurns: 1,
  });
  const turnedCorners = createHyperRubixStickerStream(turned, { cornersOnly: true });
  assert.deepEqual(
    [...turnedCorners.map(({ id }) => id)].sort(),
    [...corners.map(({ id }) => id)].sort(),
    "turns preserve corner-event identity even while moving its serial placement",
  );
  assert.deepEqual(
    turnedCorners,
    createHyperRubixHyperbarSnapshot(turned)
      .flatMap(({ events }) => events)
      .filter(({ configuration }) => configuration.radialClass === "corner"),
  );
  assert.notDeepEqual(
    turnedCorners.map(({ id }) => id),
    corners.map(({ id }) => id),
    "a turn must spatially reorder at least part of the corner scan",
  );

  assert.throws(
    () => createHyperRubixStickerStream(solved, null),
    /stream options must be an object/,
  );
  assert.throws(
    () => createHyperRubixStickerStream(solved, { cornersOnly: 1 }),
    /cornersOnly option must be a boolean/,
  );
});

test("turns permute hyperbar time and tracks while preserving sticker IDs and home voices", () => {
  const solved = createSolvedHyperRubix();
  const move = { cell: "x+", plane: "yz", quarterTurns: 1 };
  const turned = turnHyperRubixBoundaryCell(solved, move);
  const before = createHyperRubixHyperbarSnapshot(solved);
  const after = createHyperRubixHyperbarSnapshot(turned);
  const eventMap = (snapshot) => new Map(snapshot.flatMap((slot) => slot.events.map((event) => [
    event.id,
    { ...event, step: slot.index },
  ])));
  const beforeById = eventMap(before);
  const afterById = eventMap(after);

  assert.deepEqual([...afterById.keys()].sort(), [...beforeById.keys()].sort());
  let changedSteps = 0;
  let changedCells = 0;
  let changedNeighborhoods = 0;
  let displacedStickers = 0;
  for (const [id, earlier] of beforeById) {
    const later = afterById.get(id);
    assert.ok(later);
    assert.equal(later.id, earlier.id);
    assert.equal(later.color, earlier.color);
    assert.equal(later.homeCell, earlier.homeCell);
    assert.equal(later.voice, earlier.voice);
    changedSteps += Number(later.step !== earlier.step);
    changedCells += Number(later.cell !== earlier.cell);
    changedNeighborhoods += Number(
      later.configuration.sameColorNeighbors !== earlier.configuration.sameColorNeighbors
      || later.configuration.neighborDiversity !== earlier.configuration.neighborDiversity,
    );
    displacedStickers += Number(later.configuration.displaced);
  }
  assert.ok(changedSteps > 0, "a turn must permute event timing");
  assert.ok(changedCells > 0, "a turn must move events between current-cell tracks");
  assert.ok(changedNeighborhoods > 0, "a turn must alter some local color neighborhoods");
  assert.ok(displacedStickers > 0, "a turn must mark moved sticker records as displaced");
  assert.equal(after.every(({ events }) => events.length === 8), true);

  const restored = turnHyperRubixBoundaryCell(turned, invertHyperRubixMove(move));
  assert.deepEqual(createHyperRubixHyperbarSnapshot(restored), before);

  const mismatchedHome = mutablePuzzle();
  mismatchedHome.stickers[0].homeCell = "x-";
  assert.throws(
    () => createHyperRubixHyperbarSnapshot(mismatchedHome),
    /matching home cell and colour/,
  );
});

test("general 4D view rotation covers all planes without changing vector length", () => {
  assert.deepEqual(
    rotateHyperRubixPoint4(vector(1, 0, 0, 0), { xw: 90 }),
    vector(0, 0, 0, 1),
  );
  assert.deepEqual(
    rotateHyperRubixPoint4(vector(0, 1, 0, 0), { yw: -90 }),
    vector(0, 0, 0, -1),
  );
  assert.deepEqual(
    rotateHyperRubixPoint4(vector(0, 0, 1, 0), { xz: 90 }),
    vector(-1, 0, 0, 0),
  );

  const source = vector(0.37, -0.82, 1.4, -0.23);
  const rotated = rotateHyperRubixPoint4(source, {
    xy: 17,
    xz: -23,
    xw: 31,
    yz: 9,
    yw: -41,
    zw: 12,
  });
  const sourceLength = Math.hypot(source.x, source.y, source.z, source.w);
  const rotatedLength = Math.hypot(rotated.x, rotated.y, rotated.z, rotated.w);
  closeTo(rotatedLength, sourceLength);
  assert.deepEqual(source, vector(0.37, -0.82, 1.4, -0.23));
  assert.throws(
    () => rotateHyperRubixPoint4(source, { xw: Number.NaN }),
    /must be finite degrees/,
  );
});

test("4D perspective projection exposes depth and scale for Canvas rendering", () => {
  assert.deepEqual(projectHyperRubixPoint4(vector(1, 2, 3, 0), 4), {
    x: 1,
    y: 2,
    z: 3,
    w: 0,
    depth: 4,
    factor: 1,
  });
  const near = projectHyperRubixPoint4(vector(1, 0, 0, 1), 4);
  closeTo(near.factor, 4 / 3);
  closeTo(near.x, 4 / 3);
  const far = projectHyperRubixPoint4(vector(1, 0, 0, -1), 4);
  closeTo(far.factor, 4 / 5);
  assert.ok(near.x > 1 && far.x < 1);
  assert.throws(() => projectHyperRubixPoint4(vector(0, 0, 0, 4), 4), /in front/);
  assert.throws(() => projectHyperRubixPoint4(vector(0, 0, 0, 0), 0), /positive finite/);
});

test("tesseract wireframe generation yields 16 vertices, 32 edges, and eight 3-cells", () => {
  const wireframe = buildHyperRubixTesseractWireframe();
  assert.equal(wireframe.vertices.length, 16);
  assert.equal(wireframe.edges.length, 32);
  assert.equal(wireframe.cells.length, 8);
  assert.equal(Object.isFrozen(wireframe), true);
  assert.equal(Object.isFrozen(wireframe.vertices), true);
  assert.equal(Object.isFrozen(wireframe.edges[0]), true);

  const vertexDegrees = Array(16).fill(0);
  const axisCounts = Object.fromEntries(HYPER_RUBIX_AXES.map((axis) => [axis, 0]));
  for (const edge of wireframe.edges) {
    vertexDegrees[edge.a] += 1;
    vertexDegrees[edge.b] += 1;
    axisCounts[edge.axis] += 1;
    const first = wireframe.vertices[edge.a];
    const second = wireframe.vertices[edge.b];
    const changedAxes = HYPER_RUBIX_AXES.filter((axis) => first[axis] !== second[axis]);
    assert.deepEqual(changedAxes, [edge.axis]);
  }
  assert.deepEqual(vertexDegrees, Array(16).fill(4));
  assert.deepEqual(axisCounts, { x: 8, y: 8, z: 8, w: 8 });

  for (const cell of wireframe.cells) {
    assert.equal(cell.vertexIndices.length, 8);
    assert.equal(cell.edgeIndices.length, 12);
    assert.equal(new Set(cell.vertexIndices).size, 8);
    assert.equal(new Set(cell.edgeIndices).size, 12);
    assert.equal(Object.isFrozen(cell.vertexIndices), true);
    const definition = HYPER_RUBIX_BOUNDARY_CELLS[cell.id];
    assert.equal(cell.color, definition.color);
    for (const vertexIndex of cell.vertexIndices) {
      assert.equal(
        wireframe.vertices[vertexIndex][cell.axis],
        cell.sign * wireframe.radius,
      );
    }
  }

  const scaled = buildHyperRubixTesseractWireframe(2.5);
  assert.equal(scaled.radius, 2.5);
  assert.equal(Math.max(...scaled.vertices.map(({ w }) => w)), 2.5);
  assert.throws(() => buildHyperRubixTesseractWireframe(-1), /positive finite/);
});
