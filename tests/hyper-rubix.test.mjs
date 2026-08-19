import assert from "node:assert/strict";
import test from "node:test";

import {
  HYPER_RUBIX_AXES,
  HYPER_RUBIX_BASIC_MOVES,
  HYPER_RUBIX_BOUNDARY_CELLS,
  HYPER_RUBIX_CELL_ORDER,
  HYPER_RUBIX_COLORS,
  HYPER_RUBIX_LAYERS,
  HYPER_RUBIX_PLANE_DRUMS,
  HYPER_RUBIX_PLANES,
  HYPER_RUBIX_RADIUS,
  HYPER_RUBIX_SEQUENCE_LENGTH,
  HYPER_RUBIX_SEQUENCE_PATTERNS,
  HYPER_RUBIX_SIZE,
  HYPER_RUBIX_STICKER_COUNT,
  HYPER_RUBIX_STICKERS_PER_CELL,
  applyHyperRubixMoves,
  assertHyperRubixPuzzle,
  buildHyperRubixTesseractWireframe,
  createHyperRubixScramble,
  createHyperRubixSequence,
  createSeededHyperRubixRandom,
  createSolvedHyperRubix,
  hyperRubixBoundaryCell,
  hyperRubixCellForNormal,
  hyperRubixDisorder,
  hyperRubixDisorderCount,
  hyperRubixMoveAffectsSticker,
  hyperRubixMoveKey,
  hyperRubixSequenceIndex,
  hyperRubixStepDurationSeconds,
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
  assert.throws(() => assertHyperRubixPuzzle(wrongSize), /fixed 3 x 3 x 3/);

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

test("sequencer duration clamps tempo and swing across 1, 2, and 4 subdivisions", () => {
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
  closeTo(hyperRubixStepDurationSeconds(1, 2, 0, 0), 1);
  closeTo(hyperRubixStepDurationSeconds(999, 2, 0, 0), 0.1);
  closeTo(hyperRubixStepDurationSeconds(120, 2, -10, 0), 0.25);
  closeTo(hyperRubixStepDurationSeconds(120, 2, 10, 0), 0.25 * 1.42);
  closeTo(hyperRubixStepDurationSeconds(120, 2, 0.2, -1), 0.2);

  assert.throws(() => hyperRubixStepDurationSeconds(Number.NaN), /tempo must be a finite number/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 3), /must be 1, 2, or 4/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 2, Number.NaN), /swing must be a finite number/);
  assert.throws(() => hyperRubixStepDurationSeconds(112, 2, 0.1, 0.5), /swing step must be an integer/);
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
