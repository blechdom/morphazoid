import assert from "node:assert/strict";
import test from "node:test";

import {
  SLIDING_PLAYBACK_MODES,
  SLIDING_PUZZLE_BLANK,
  SLIDING_PUZZLE_MAX_DIMENSION,
  SLIDING_PUZZLE_MIN_DIMENSION,
  SLIDING_PUZZLE_SIZE,
  SLIDING_READ_PATHS,
  SLIDING_TILE_COLOR_ORDER,
  appendSlidingMoveHistory,
  applySlidingMoves,
  canSlidePuzzleTile,
  createSlidingPuzzlePlaybackFrames,
  createSlidingPuzzleScramble,
  createSlidingPuzzleSequence,
  createSolvedSlidingPuzzle,
  invertSlidingMoves,
  isSlidingPuzzleSolved,
  normalizeSlidingRotation,
  slidePuzzleTile,
  slidingPuzzleBlankIndex,
  slidingPuzzleDimensions,
  slidingPuzzleLegalTileIds,
  slidingPuzzleMetrics,
  slidingPuzzleMoveTileIds,
  slidingPuzzleReadOrder,
  slidingPuzzleScreenCellForBoardCell,
  slidingPuzzleScreenDimensions,
  slidingTileColor,
} from "../src/sliding-puzzle.js";

const THREE_BY_FIVE_ORDERS = Object.freeze({
  rows: Object.freeze([
    Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    Object.freeze([10, 5, 0, 11, 6, 1, 12, 7, 2, 13, 8, 3, 14, 9, 4]),
    Object.freeze([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
    Object.freeze([4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11, 0, 5, 10]),
  ]),
  snake: Object.freeze([
    Object.freeze([0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14]),
    Object.freeze([10, 5, 0, 1, 6, 11, 12, 7, 2, 3, 8, 13, 14, 9, 4]),
    Object.freeze([14, 13, 12, 11, 10, 5, 6, 7, 8, 9, 4, 3, 2, 1, 0]),
    Object.freeze([4, 9, 14, 13, 8, 3, 2, 7, 12, 11, 6, 1, 0, 5, 10]),
  ]),
  spiral: Object.freeze([
    Object.freeze([0, 1, 2, 3, 4, 9, 14, 13, 12, 11, 10, 5, 6, 7, 8]),
    Object.freeze([10, 5, 0, 1, 2, 3, 4, 9, 14, 13, 12, 11, 6, 7, 8]),
    Object.freeze([14, 13, 12, 11, 10, 5, 0, 1, 2, 3, 4, 9, 8, 7, 6]),
    Object.freeze([4, 9, 14, 13, 12, 11, 10, 5, 0, 1, 2, 3, 8, 7, 6]),
  ]),
});

function seededRandom(seed = 0x51a1de) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function replayLegally(puzzle, moves) {
  return moves.reduce((current, tileId, index) => {
    assert.ok(
      slidingPuzzleLegalTileIds(current).includes(tileId),
      `move ${index + 1} (tile ${tileId}) must align with the blank`,
    );
    const next = slidePuzzleTile(current, tileId);
    assert.notEqual(next, current);
    return next;
  }, puzzle);
}

function assertIndexBijection(order, cellCount) {
  assert.equal(order.length, cellCount);
  assert.deepEqual(
    [...new Set(order.map(({ boardIndex }) => boardIndex))].sort((a, b) => a - b),
    [...Array(cellCount).keys()],
  );
  assert.deepEqual(
    [...new Set(order.map(({ screenIndex }) => screenIndex))].sort((a, b) => a - b),
    [...Array(cellCount).keys()],
  );
}

function assertDeepFrozenFrames(frames) {
  assert.ok(Object.isFrozen(frames));
  for (const frame of frames) {
    assert.ok(Object.isFrozen(frame));
    assert.ok(Object.isFrozen(frame.events));
    assert.ok(frame.events.every(Object.isFrozen));
  }
}

test("dimensions accept every independent 2–8 row and column combination", () => {
  assert.equal(SLIDING_PUZZLE_SIZE, 4);
  assert.equal(SLIDING_PUZZLE_MIN_DIMENSION, 2);
  assert.equal(SLIDING_PUZZLE_MAX_DIMENSION, 8);

  for (let rows = 2; rows <= 8; rows += 1) {
    for (let columns = 2; columns <= 8; columns += 1) {
      const dimensions = slidingPuzzleDimensions(rows, columns);
      assert.deepEqual(dimensions, { rows, columns, cellCount: rows * columns });
      assert.ok(Object.isFrozen(dimensions));

      const puzzle = createSolvedSlidingPuzzle(rows, columns);
      assert.equal(puzzle.rows, rows);
      assert.equal(puzzle.columns, columns);
      assert.equal(puzzle.tiles.length, rows * columns);
      assert.equal(puzzle.tiles.at(-1), SLIDING_PUZZLE_BLANK);
      assert.equal(new Set(puzzle.tiles).size, rows * columns);
      assert.equal(isSlidingPuzzleSolved(puzzle), true);
      assert.equal(Object.hasOwn(puzzle, "size"), rows === columns);
      if (rows === columns) assert.equal(puzzle.size, rows);
      assert.ok(Object.isFrozen(puzzle));
      assert.ok(Object.isFrozen(puzzle.tiles));
    }
  }

  assert.deepEqual(slidingPuzzleDimensions({ rows: 3, columns: 5 }), {
    rows: 3,
    columns: 5,
    cellCount: 15,
  });
  assert.deepEqual(slidingPuzzleDimensions({ size: 6 }), {
    rows: 6,
    columns: 6,
    cellCount: 36,
  });
});

test("dimension and puzzle validation reject out-of-range or malformed rectangles", () => {
  for (const bad of [1, 9, 2.5, "4", Number.NaN, null]) {
    assert.throws(() => slidingPuzzleDimensions(bad, 4), /rows must be an integer from 2 through 8/);
    assert.throws(() => slidingPuzzleDimensions(4, bad), /columns must be an integer from 2 through 8/);
  }
  assert.throws(
    () => slidingPuzzleDimensions({ rows: 3 }),
    /columns must be an integer from 2 through 8/,
  );
  assert.throws(() => createSolvedSlidingPuzzle(2, 9), /columns must be an integer/);
  assert.throws(
    () => slidePuzzleTile({ rows: 3, columns: 5, tiles: [...Array(14).keys()] }, 1),
    /must have 15 cells/,
  );
  assert.throws(
    () => createSlidingPuzzleSequence({
      rows: 2,
      columns: 3,
      tiles: [1, 2, 3, 4, 4, 0],
    }),
    /unique permutation/,
  );
  assert.throws(() => slidingTileColor(1, 1), /columns must be an integer/);
  assert.throws(() => invertSlidingMoves("1,2"), /must be an array/);
  assert.throws(() => applySlidingMoves(createSolvedSlidingPuzzle(3, 5), "1,2"), /must be an array/);
});

test("a solved 3×5 puzzle exposes all aligned row and column tiles", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  assert.deepEqual(puzzle.tiles, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0]);
  assert.equal(slidingPuzzleBlankIndex(puzzle), 14);
  assert.deepEqual(slidingPuzzleLegalTileIds(puzzle), [10, 5, 14, 13, 12, 11]);
  for (const tileId of [10, 5, 14, 13, 12, 11]) {
    assert.equal(canSlidePuzzleTile(puzzle, tileId), true);
  }
  for (const tileId of [0, 1, 6, 7, 8, 9, 15, -1, 2.5, "tile"]) {
    assert.equal(canSlidePuzzleTile(puzzle, tileId), false);
    assert.deepEqual(slidingPuzzleMoveTileIds(puzzle, tileId), []);
    assert.equal(slidePuzzleTile(puzzle, tileId), puzzle);
  }
});

test("a far horizontal press shifts a complete rectangular row and reverses in one press", () => {
  const solved = createSolvedSlidingPuzzle(3, 5);
  const movedIds = slidingPuzzleMoveTileIds(solved, 11);
  assert.deepEqual(movedIds, [14, 13, 12, 11]);
  assert.ok(Object.isFrozen(movedIds));

  const moved = slidePuzzleTile(solved, 11);
  assert.deepEqual(moved.tiles, [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    0, 11, 12, 13, 14,
  ]);
  assert.deepEqual(slidingPuzzleMoveTileIds(moved, 14), [11, 12, 13, 14]);
  assert.deepEqual(slidePuzzleTile(moved, 14), solved);
  assert.deepEqual(slidingPuzzleMetrics(moved), {
    displaced: 4,
    manhattan: 4,
    disorder: 1 / 14,
    solved: false,
  });
});

test("a far vertical press shifts a complete rectangular column and reverses in one press", () => {
  const solved = createSolvedSlidingPuzzle(5, 3);
  assert.deepEqual(slidingPuzzleMoveTileIds(solved, 3), [12, 9, 6, 3]);

  const moved = slidePuzzleTile(solved, 3);
  assert.deepEqual(moved.tiles, [
    1, 2, 0,
    4, 5, 3,
    7, 8, 6,
    10, 11, 9,
    13, 14, 12,
  ]);
  assert.deepEqual(slidingPuzzleMoveTileIds(moved, 12), [3, 6, 9, 12]);
  assert.deepEqual(slidePuzzleTile(moved, 12), solved);
});

test("rectangular long-slide history stores one inverse command per press", () => {
  const solved = createSolvedSlidingPuzzle(3, 5);
  let puzzle = solved;
  let history = Object.freeze([]);

  const press = (tileId) => {
    const shifted = slidingPuzzleMoveTileIds(puzzle, tileId);
    assert.ok(shifted.length > 0);
    history = appendSlidingMoveHistory(history, tileId, shifted[0]);
    puzzle = slidePuzzleTile(puzzle, tileId);
  };

  press(11);
  assert.deepEqual(history, [14]);
  press(1);
  assert.deepEqual(history, [14, 6]);
  assert.deepEqual(invertSlidingMoves(history), [6, 14]);
  assert.deepEqual(replayLegally(puzzle, invertSlidingMoves(history)), solved);

  press(6);
  assert.deepEqual(history, [14]);
  press(14);
  assert.deepEqual(history, []);
  assert.deepEqual(puzzle, solved);
});

test("rectangular deterministic scrambles contain adjacent legal moves and solve exactly", () => {
  const solved = createSolvedSlidingPuzzle(3, 5);
  const scramble = createSlidingPuzzleScramble(solved, {
    moves: 127,
    random: seededRandom(0xc0ffee),
  });
  assert.equal(scramble.moves.length, 127);
  assert.ok(Object.isFrozen(scramble));
  assert.ok(Object.isFrozen(scramble.moves));
  assert.ok(Object.isFrozen(scramble.puzzle));

  let replay = solved;
  for (const tileId of scramble.moves) {
    assert.equal(slidingPuzzleMoveTileIds(replay, tileId).length, 1);
    replay = slidePuzzleTile(replay, tileId);
  }
  assert.deepEqual(replay, scramble.puzzle);
  assert.deepEqual(applySlidingMoves(scramble.puzzle, invertSlidingMoves(scramble.moves)), solved);

  const closedWalk = createSlidingPuzzleScramble(createSolvedSlidingPuzzle(2, 4), {
    moves: 24,
    random: () => 0,
  });
  assert.equal(closedWalk.moves.length, 25);
  assert.notDeepEqual(closedWalk.puzzle.tiles, createSolvedSlidingPuzzle(2, 4).tiles);
  assert.deepEqual(
    applySlidingMoves(closedWalk.puzzle, invertSlidingMoves(closedWalk.moves)),
    createSolvedSlidingPuzzle(2, 4),
  );
});

test("3×5 rows, snake, and spiral orders are exact at q0 through q3", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  const expectedScreens = [
    { rows: 3, columns: 5, cellCount: 15 },
    { rows: 5, columns: 3, cellCount: 15 },
    { rows: 3, columns: 5, cellCount: 15 },
    { rows: 5, columns: 3, cellCount: 15 },
  ];

  for (const [pathId, rotations] of Object.entries(THREE_BY_FIVE_ORDERS)) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const screen = slidingPuzzleScreenDimensions(puzzle, rotation);
      assert.deepEqual(screen, expectedScreens[rotation]);
      assert.ok(Object.isFrozen(screen));

      const order = slidingPuzzleReadOrder(puzzle, rotation, pathId);
      assert.deepEqual(order.map(({ boardIndex }) => boardIndex), rotations[rotation]);
      assert.deepEqual(order.map(({ step }) => step), [...Array(15).keys()]);
      assertIndexBijection(order, 15);
      assert.ok(Object.isFrozen(order));
      for (const cell of order) {
        assert.ok(Object.isFrozen(cell));
        assert.equal(cell.screenRows, screen.rows);
        assert.equal(cell.screenColumns, screen.columns);
        assert.equal(cell.boardRows, 3);
        assert.equal(cell.boardColumns, 5);
        assert.equal(cell.screenIndex, cell.screenRow * screen.columns + cell.screenColumn);
        assert.equal(cell.boardIndex, cell.boardRow * 5 + cell.boardColumn);
      }
    }
  }

  assert.deepEqual(
    slidingPuzzleReadOrder(puzzle, 0, "unknown").map(({ boardIndex }) => boardIndex),
    THREE_BY_FIVE_ORDERS.rows[0],
  );
});

test("board-to-screen mapping is the inverse rectangular rotation contract", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const order = slidingPuzzleReadOrder(puzzle, rotation, "rows");
    const screen = slidingPuzzleScreenDimensions(puzzle, rotation);
    for (let boardRow = 0; boardRow < 3; boardRow += 1) {
      for (let boardColumn = 0; boardColumn < 5; boardColumn += 1) {
        const mapped = slidingPuzzleScreenCellForBoardCell(
          puzzle,
          boardRow,
          boardColumn,
          rotation,
        );
        assert.ok(Object.isFrozen(mapped));
        assert.ok(mapped.row >= 0 && mapped.row < screen.rows);
        assert.ok(mapped.column >= 0 && mapped.column < screen.columns);
        const cell = order.find((candidate) => (
          candidate.boardRow === boardRow && candidate.boardColumn === boardColumn
        ));
        assert.deepEqual(mapped, { row: cell.screenRow, column: cell.screenColumn });
      }
    }
  }
});

test("2×8 and 8×2 spirals remain bijections under every rotation", () => {
  for (const [rows, columns] of [[2, 8], [8, 2]]) {
    const puzzle = createSolvedSlidingPuzzle(rows, columns);
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const order = slidingPuzzleReadOrder(puzzle, rotation, "spiral");
      const screen = slidingPuzzleScreenDimensions(puzzle, rotation);
      assertIndexBijection(order, 16);
      assert.equal(order[0].screenRows, screen.rows);
      assert.equal(order[0].screenColumns, screen.columns);
      assert.ok(order.every(({ boardRow, boardColumn }) => (
        boardRow >= 0 && boardRow < rows && boardColumn >= 0 && boardColumn < columns
      )));
    }
  }
});

test("rotation normalization and playback/read metadata are frozen", () => {
  assert.deepEqual(
    [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map(normalizeSlidingRotation),
    [3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1],
  );
  assert.deepEqual(Object.keys(SLIDING_READ_PATHS), ["rows", "snake", "spiral"]);
  assert.deepEqual(Object.keys(SLIDING_PLAYBACK_MODES), ["parallel", "serial"]);
  assert.ok(Object.isFrozen(SLIDING_READ_PATHS));
  assert.ok(Object.values(SLIDING_READ_PATHS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(SLIDING_PLAYBACK_MODES));
  assert.ok(Object.values(SLIDING_PLAYBACK_MODES).every(Object.isFrozen));
});

test("tile colors follow solved rows and cycle every four rows", () => {
  assert.deepEqual(SLIDING_TILE_COLOR_ORDER, ["yellow", "green", "blue", "red"]);
  assert.deepEqual(
    Array.from({ length: 15 }, (_, index) => slidingTileColor(index + 1, 2)),
    [
      "yellow", "yellow",
      "green", "green",
      "blue", "blue",
      "red", "red",
      "yellow", "yellow",
      "green", "green",
      "blue", "blue",
      "red",
    ],
  );
  assert.deepEqual(
    Array.from({ length: 14 }, (_, index) => slidingTileColor(index + 1, 5)),
    [
      "yellow", "yellow", "yellow", "yellow", "yellow",
      "green", "green", "green", "green", "green",
      "blue", "blue", "blue", "blue",
    ],
  );

  const moved = slidePuzzleTile(createSolvedSlidingPuzzle(3, 5), 11);
  const sequence = createSlidingPuzzleSequence(moved);
  for (const event of sequence.filter(({ isRest }) => !isRest)) {
    assert.equal(event.color, slidingTileColor(event.tileId, 5));
  }
});

test("sequence events expose frozen rectangular geometry, neighbors, displacement, and one rest", () => {
  const puzzle = slidePuzzleTile(createSolvedSlidingPuzzle(3, 5), 11);
  const sequence = createSlidingPuzzleSequence(puzzle, {
    rotationQuarterTurns: 1,
    pathId: "spiral",
  });
  assert.equal(sequence.length, 15);
  assert.equal(sequence.filter(({ isRest }) => isRest).length, 1);
  assert.ok(Object.isFrozen(sequence));
  assert.ok(sequence.every(Object.isFrozen));
  for (const event of sequence) {
    assert.equal(event.screenRows, 5);
    assert.equal(event.screenColumns, 3);
    assert.equal(event.boardRows, 3);
    assert.equal(event.boardColumns, 5);
    assert.ok(event.neighborCount >= 0 && event.neighborCount <= 4);
    assert.equal(event.neighborCount, event.matchingNeighbors + event.mixedNeighbors);
    assert.ok(event.normalizedDisplacement >= 0 && event.normalizedDisplacement <= 1);
    if (event.isRest) {
      assert.equal(event.tileId, SLIDING_PUZZLE_BLANK);
      assert.equal(event.color, "rest");
      assert.deepEqual(
        [event.neighborCount, event.matchingNeighbors, event.mixedNeighbors],
        [0, 0, 0],
      );
    }
  }
});

test("serial playback creates one deeply frozen event per path step", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  const frames = createSlidingPuzzlePlaybackFrames(puzzle, {
    playbackMode: "serial",
    pathId: "snake",
    rotationQuarterTurns: 0,
  });
  assertDeepFrozenFrames(frames);
  assert.equal(frames.length, 15);
  assert.deepEqual(
    frames.map(({ events }) => events[0].tileId),
    [1, 2, 3, 4, 5, 10, 9, 8, 7, 6, 11, 12, 13, 14, 0],
  );
  assert.deepEqual(frames.map(({ step }) => step), [...Array(15).keys()]);
  assert.ok(frames.every(({ playbackMode, events }) => playbackMode === "serial" && events.length === 1));
  assert.equal(frames.filter(({ isRest }) => isRest).length, 1);
  assert.equal(frames.reduce((sum, { restCount }) => sum + restCount, 0), 1);
  assert.equal(frames.reduce((sum, { soundingCount }) => sum + soundingCount, 0), 14);

  const fallback = createSlidingPuzzlePlaybackFrames(puzzle, { playbackMode: "unknown" });
  assert.equal(fallback.length, 15);
  assert.ok(fallback.every(({ playbackMode }) => playbackMode === "serial"));
});

test("parallel q0 playback is five frames of three row-lane events", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  const frames = createSlidingPuzzlePlaybackFrames(puzzle, {
    playbackMode: "parallel",
    pathId: "spiral",
    rotationQuarterTurns: 0,
  });
  assertDeepFrozenFrames(frames);
  assert.equal(frames.length, 5);
  assert.ok(frames.every(({ events }) => events.length === 3));
  assert.deepEqual(frames.map(({ events }) => events.map(({ tileId }) => tileId)), [
    [1, 6, 11],
    [2, 7, 12],
    [3, 8, 13],
    [4, 9, 14],
    [5, 10, 0],
  ]);
  assert.deepEqual(frames.map(({ screenColumn }) => screenColumn), [0, 1, 2, 3, 4]);
  assert.ok(frames.every(({ playbackMode, screenRows, screenColumns }) => (
    playbackMode === "parallel" && screenRows === 3 && screenColumns === 5
  )));
  assert.deepEqual(frames.map(({ restCount }) => restCount), [0, 0, 0, 0, 1]);
  assert.deepEqual(frames.map(({ soundingCount }) => soundingCount), [3, 3, 3, 3, 2]);
  assert.equal(frames.at(-1).events.at(-1).color, "rest");
  assert.ok(frames.every(({ isRest }) => isRest === false), "one resting lane must not mute its frame");
});

test("parallel q1 playback swaps to three frames of five row-lane events", () => {
  const puzzle = createSolvedSlidingPuzzle(3, 5);
  const frames = createSlidingPuzzlePlaybackFrames(puzzle, {
    playbackMode: "parallel",
    rotationQuarterTurns: 1,
  });
  assertDeepFrozenFrames(frames);
  assert.equal(frames.length, 3);
  assert.ok(frames.every(({ events }) => events.length === 5));
  assert.deepEqual(frames.map(({ events }) => events.map(({ tileId }) => tileId)), [
    [11, 12, 13, 14, 0],
    [6, 7, 8, 9, 10],
    [1, 2, 3, 4, 5],
  ]);
  assert.deepEqual(frames.map(({ restCount }) => restCount), [1, 0, 0]);
  assert.deepEqual(frames.map(({ soundingCount }) => soundingCount), [4, 5, 5]);
  assert.ok(frames.every(({ screenRows, screenColumns }) => screenRows === 5 && screenColumns === 3));
  assert.equal(frames[0].events.at(-1).isRest, true);
  assert.ok(frames.every(({ isRest }) => isRest === false));
});

test("playback frames reject malformed puzzle sources", () => {
  assert.throws(
    () => createSlidingPuzzlePlaybackFrames({ rows: 3, columns: 5, tiles: [] }),
    /must have 15 cells/,
  );
  assert.throws(
    () => createSlidingPuzzlePlaybackFrames({
      rows: 2,
      columns: 2,
      tiles: [1, 2, 2, 0],
    }),
    /unique permutation/,
  );
});
