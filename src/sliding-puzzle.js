/**
 * Pure state and score helpers for the Morphazoid Sliding Puzzle Sequencer.
 *
 * The empty cell is represented by 0. Pressing any tile in the same row or
 * column shifts the complete intervening line toward that cell, so every
 * authored mutation stays solvable. Board rotation changes only screen/read
 * coordinates; it never changes the logical rows × columns permutation.
 */

export const SLIDING_PUZZLE_SIZE = 4;
export const SLIDING_PUZZLE_MIN_DIMENSION = 2;
export const SLIDING_PUZZLE_MAX_DIMENSION = 8;
export const SLIDING_PUZZLE_BLANK = 0;
export const SLIDING_TILE_COLOR_ORDER = Object.freeze([
  "yellow",
  "green",
  "blue",
  "red",
]);

export const SLIDING_PLAYBACK_MODES = Object.freeze({
  parallel: Object.freeze({
    id: "parallel",
    label: "Lines together",
    detail: "one column · every row",
  }),
  serial: Object.freeze({
    id: "serial",
    label: "One tile",
    detail: "follow the selected path",
  }),
});

export const SLIDING_READ_PATHS = Object.freeze({
  rows: Object.freeze({ id: "rows", label: "Lines", detail: "left to right" }),
  snake: Object.freeze({ id: "snake", label: "Snake", detail: "alternating rows" }),
  spiral: Object.freeze({ id: "spiral", label: "Spiral", detail: "outside to center" }),
});

const clampInteger = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Math.round(Number(value) || 0)))
);

function assertDimension(value, label = "dimension") {
  if (
    !Number.isInteger(value)
    || value < SLIDING_PUZZLE_MIN_DIMENSION
    || value > SLIDING_PUZZLE_MAX_DIMENSION
  ) {
    throw new RangeError(
      `Sliding puzzle ${label} must be an integer from ${SLIDING_PUZZLE_MIN_DIMENSION} through ${SLIDING_PUZZLE_MAX_DIMENSION}.`,
    );
  }
  return value;
}

/** Resolve a square number, dimensions object, or puzzle into frozen dimensions. */
export function slidingPuzzleDimensions(
  source = SLIDING_PUZZLE_SIZE,
  requestedColumns = source,
) {
  const objectSource = source && typeof source === "object";
  const rows = objectSource ? (source.rows ?? source.size) : source;
  const columns = objectSource ? (source.columns ?? source.size) : requestedColumns;
  const safeRows = assertDimension(rows, "rows");
  const safeColumns = assertDimension(columns, "columns");
  return Object.freeze({
    rows: safeRows,
    columns: safeColumns,
    cellCount: safeRows * safeColumns,
  });
}

function assertPuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== "object") {
    throw new TypeError("A sliding puzzle must be an object with rows, columns, and tiles.");
  }
  const dimensions = slidingPuzzleDimensions(puzzle);
  const { rows, columns, cellCount } = dimensions;
  if (!Array.isArray(puzzle.tiles) || puzzle.tiles.length !== cellCount) {
    throw new TypeError(`A ${rows} by ${columns} sliding puzzle must have ${cellCount} cells.`);
  }
  const values = new Set(puzzle.tiles);
  if (
    values.size !== cellCount
    || puzzle.tiles.some((tile) => !Number.isInteger(tile) || tile < 0 || tile >= cellCount)
  ) {
    throw new TypeError(
      "Sliding puzzle tiles must be a unique permutation from 0 to rows × columns − 1.",
    );
  }
  return puzzle;
}

function freezePuzzle(rows, columns, tiles) {
  const puzzle = { rows, columns, tiles: Object.freeze([...tiles]) };
  // Preserve the original square API for other local callers and old scores.
  if (rows === columns) puzzle.size = rows;
  return Object.freeze(puzzle);
}

export function createSolvedSlidingPuzzle(rows = SLIDING_PUZZLE_SIZE, columns = rows) {
  const dimensions = slidingPuzzleDimensions(rows, columns);
  return freezePuzzle(dimensions.rows, dimensions.columns, [
    ...Array.from({ length: dimensions.cellCount - 1 }, (_, index) => index + 1),
    SLIDING_PUZZLE_BLANK,
  ]);
}

export function slidingPuzzleBlankIndex(puzzle) {
  const safePuzzle = assertPuzzle(puzzle);
  return safePuzzle.tiles.indexOf(SLIDING_PUZZLE_BLANK);
}

export function slidingPuzzleLegalTileIds(puzzle) {
  const safePuzzle = assertPuzzle(puzzle);
  const { rows, columns } = slidingPuzzleDimensions(safePuzzle);
  const blank = slidingPuzzleBlankIndex(safePuzzle);
  const row = Math.floor(blank / columns);
  const column = blank % columns;
  const indices = [];
  for (let nextRow = row - 1; nextRow >= 0; nextRow -= 1) {
    indices.push(nextRow * columns + column);
  }
  for (let nextColumn = column + 1; nextColumn < columns; nextColumn += 1) {
    indices.push(row * columns + nextColumn);
  }
  for (let nextRow = row + 1; nextRow < rows; nextRow += 1) {
    indices.push(nextRow * columns + column);
  }
  for (let nextColumn = column - 1; nextColumn >= 0; nextColumn -= 1) {
    indices.push(row * columns + nextColumn);
  }
  return Object.freeze(indices.map((index) => safePuzzle.tiles[index]));
}

/** Return identities in the order they shift into the blank. */
export function slidingPuzzleMoveTileIds(puzzle, tileId) {
  const safePuzzle = assertPuzzle(puzzle);
  const { columns, cellCount } = slidingPuzzleDimensions(safePuzzle);
  const tile = Number(tileId);
  if (!Number.isInteger(tile) || tile <= 0 || tile >= cellCount) {
    return Object.freeze([]);
  }
  const tileIndex = safePuzzle.tiles.indexOf(tile);
  const blankIndex = slidingPuzzleBlankIndex(safePuzzle);
  const tileRow = Math.floor(tileIndex / columns);
  const tileColumn = tileIndex % columns;
  const blankRow = Math.floor(blankIndex / columns);
  const blankColumn = blankIndex % columns;
  if (tileRow !== blankRow && tileColumn !== blankColumn) return Object.freeze([]);

  const stride = tileRow === blankRow
    ? Math.sign(tileIndex - blankIndex)
    : Math.sign(tileIndex - blankIndex) * columns;
  const moved = [];
  for (let index = blankIndex + stride; ; index += stride) {
    moved.push(safePuzzle.tiles[index]);
    if (index === tileIndex) break;
  }
  return Object.freeze(moved);
}

export function canSlidePuzzleTile(puzzle, tileId) {
  return slidingPuzzleMoveTileIds(puzzle, tileId).length > 0;
}

/** Return the same immutable object for an illegal move. */
export function slidePuzzleTile(puzzle, tileId) {
  const safePuzzle = assertPuzzle(puzzle);
  const { rows, columns } = slidingPuzzleDimensions(safePuzzle);
  const tile = Number(tileId);
  const movedTileIds = slidingPuzzleMoveTileIds(safePuzzle, tile);
  if (!movedTileIds.length) return safePuzzle;
  const tiles = [...safePuzzle.tiles];
  const tileIndex = tiles.indexOf(tile);
  const blankIndex = tiles.indexOf(SLIDING_PUZZLE_BLANK);
  const stride = Math.floor(tileIndex / columns) === Math.floor(blankIndex / columns)
    ? Math.sign(tileIndex - blankIndex)
    : Math.sign(tileIndex - blankIndex) * columns;
  for (let index = blankIndex; index !== tileIndex; index += stride) {
    tiles[index] = tiles[index + stride];
  }
  tiles[tileIndex] = SLIDING_PUZZLE_BLANK;
  return freezePuzzle(rows, columns, tiles);
}

export function isSlidingPuzzleSolved(puzzle) {
  const safePuzzle = assertPuzzle(puzzle);
  return safePuzzle.tiles.every((tile, index) => (
    tile === (index === safePuzzle.tiles.length - 1 ? SLIDING_PUZZLE_BLANK : index + 1)
  ));
}

/** Store one inverse command per complete click/line-slide transaction. */
export function appendSlidingMoveHistory(history = [], tileId, inverseTileId = tileId) {
  const next = Array.isArray(history) ? [...history] : [];
  const tile = Number(tileId);
  const inverseTile = Number(inverseTileId);
  if (
    !Number.isInteger(tile)
    || tile <= 0
    || !Number.isInteger(inverseTile)
    || inverseTile <= 0
  ) return Object.freeze(next);
  if (next.at(-1) === tile) next.pop();
  else next.push(inverseTile);
  return Object.freeze(next);
}

export function invertSlidingMoves(moves = []) {
  if (!Array.isArray(moves)) throw new TypeError("Sliding moves must be an array.");
  return Object.freeze([...moves].reverse());
}

export function applySlidingMoves(puzzle, moves = []) {
  if (!Array.isArray(moves)) throw new TypeError("Sliding moves must be an array.");
  return moves.reduce((current, tileId) => slidePuzzleTile(current, tileId), assertPuzzle(puzzle));
}

/** Build a reproducible, always-solvable scramble from adjacent legal moves. */
export function createSlidingPuzzleScramble(
  puzzle = createSolvedSlidingPuzzle(),
  options = {},
) {
  let current = assertPuzzle(puzzle);
  const startTiles = current.tiles;
  const moveCount = clampInteger(options.moves ?? 48, 0, 10_000);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const moves = [];
  let previousTile = null;

  for (let index = 0; index < moveCount; index += 1) {
    // Single-cell steps make the generated move list its own exact reverse.
    const legal = slidingPuzzleLegalTileIds(current).filter(
      (tileId) => slidingPuzzleMoveTileIds(current, tileId).length === 1,
    );
    const candidates = legal.length > 1
      ? legal.filter((tileId) => tileId !== previousTile)
      : [...legal];
    const choiceIndex = Math.min(
      candidates.length - 1,
      Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * candidates.length),
    );
    const tileId = candidates[Math.max(0, choiceIndex)];
    current = slidePuzzleTile(current, tileId);
    moves.push(tileId);
    previousTile = tileId;
  }

  // A closed legal walk can occasionally land back at its starting
  // arrangement. One extra adjacent move keeps a requested scramble visibly
  // mixed while preserving an exact, reversible move list.
  if (
    moveCount > 0
    && current.tiles.every((tileId, index) => tileId === startTiles[index])
  ) {
    const legal = slidingPuzzleLegalTileIds(current).filter(
      (tileId) => slidingPuzzleMoveTileIds(current, tileId).length === 1,
    );
    const tileId = legal.find((candidate) => candidate !== previousTile) ?? legal[0];
    current = slidePuzzleTile(current, tileId);
    moves.push(tileId);
  }

  return Object.freeze({ puzzle: current, moves: Object.freeze(moves) });
}

function rowsPath(rows, columns) {
  return Array.from({ length: rows * columns }, (_, index) => Object.freeze({
    row: Math.floor(index / columns),
    column: index % columns,
  }));
}

function snakePath(rows, columns) {
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const offset = index % columns;
    return Object.freeze({
      row,
      column: row % 2 ? columns - 1 - offset : offset,
    });
  });
}

function spiralPath(rows, columns) {
  const cells = [];
  let top = 0;
  let right = columns - 1;
  let bottom = rows - 1;
  let left = 0;
  while (top <= bottom && left <= right) {
    for (let column = left; column <= right; column += 1) cells.push({ row: top, column });
    top += 1;
    for (let row = top; row <= bottom; row += 1) cells.push({ row, column: right });
    right -= 1;
    if (top <= bottom) {
      for (let column = right; column >= left; column -= 1) {
        cells.push({ row: bottom, column });
      }
      bottom -= 1;
    }
    if (left <= right) {
      for (let row = bottom; row >= top; row -= 1) cells.push({ row, column: left });
      left += 1;
    }
  }
  return cells.map((cell) => Object.freeze(cell));
}

export function normalizeSlidingRotation(rotationQuarterTurns = 0) {
  const turns = Math.round(Number(rotationQuarterTurns) || 0);
  return ((turns % 4) + 4) % 4;
}

export function slidingPuzzleScreenDimensions(
  source = SLIDING_PUZZLE_SIZE,
  rotationQuarterTurns = 0,
) {
  const { rows, columns } = slidingPuzzleDimensions(source);
  const rotation = normalizeSlidingRotation(rotationQuarterTurns);
  return Object.freeze(rotation % 2
    ? { rows: columns, columns: rows, cellCount: rows * columns }
    : { rows, columns, cellCount: rows * columns });
}

function logicalCellForScreenCell(dimensions, row, column, rotationQuarterTurns) {
  const { rows, columns } = dimensions;
  const rotation = normalizeSlidingRotation(rotationQuarterTurns);
  if (rotation === 1) return { row: rows - 1 - column, column: row };
  if (rotation === 2) return { row: rows - 1 - row, column: columns - 1 - column };
  if (rotation === 3) return { row: column, column: columns - 1 - row };
  return { row, column };
}

export function slidingPuzzleScreenCellForBoardCell(
  source,
  boardRow,
  boardColumn,
  rotationQuarterTurns = 0,
) {
  const dimensions = slidingPuzzleDimensions(source);
  const rotation = normalizeSlidingRotation(rotationQuarterTurns);
  if (rotation === 1) {
    return Object.freeze({ row: boardColumn, column: dimensions.rows - 1 - boardRow });
  }
  if (rotation === 2) {
    return Object.freeze({
      row: dimensions.rows - 1 - boardRow,
      column: dimensions.columns - 1 - boardColumn,
    });
  }
  if (rotation === 3) {
    return Object.freeze({ row: dimensions.columns - 1 - boardColumn, column: boardRow });
  }
  return Object.freeze({ row: boardRow, column: boardColumn });
}

export function slidingPuzzleReadOrder(
  source = SLIDING_PUZZLE_SIZE,
  rotationQuarterTurns = 0,
  pathId = "rows",
) {
  const dimensions = slidingPuzzleDimensions(source);
  const screen = slidingPuzzleScreenDimensions(dimensions, rotationQuarterTurns);
  const safePath = Object.hasOwn(SLIDING_READ_PATHS, pathId) ? pathId : "rows";
  const screenPath = safePath === "snake"
    ? snakePath(screen.rows, screen.columns)
    : safePath === "spiral"
      ? spiralPath(screen.rows, screen.columns)
      : rowsPath(screen.rows, screen.columns);
  return Object.freeze(screenPath.map((screenCell, step) => {
    const logical = logicalCellForScreenCell(
      dimensions,
      screenCell.row,
      screenCell.column,
      rotationQuarterTurns,
    );
    return Object.freeze({
      step,
      screenRow: screenCell.row,
      screenColumn: screenCell.column,
      screenRows: screen.rows,
      screenColumns: screen.columns,
      screenIndex: screenCell.row * screen.columns + screenCell.column,
      boardRow: logical.row,
      boardColumn: logical.column,
      boardRows: dimensions.rows,
      boardColumns: dimensions.columns,
      boardIndex: logical.row * dimensions.columns + logical.column,
    });
  }));
}

export function slidingTileColor(tileId, columns = SLIDING_PUZZLE_SIZE) {
  const tile = Math.max(1, Math.round(Number(tileId) || 1));
  const safeColumns = assertDimension(columns, "columns");
  const homeRow = Math.floor((tile - 1) / safeColumns);
  return SLIDING_TILE_COLOR_ORDER[homeRow % SLIDING_TILE_COLOR_ORDER.length];
}

function neighborContext(puzzle, boardIndex, tileId, dimensions) {
  if (tileId === SLIDING_PUZZLE_BLANK) {
    return { neighborCount: 0, matchingNeighbors: 0, mixedNeighbors: 0 };
  }
  const row = Math.floor(boardIndex / dimensions.columns);
  const column = boardIndex % dimensions.columns;
  const indices = [];
  if (row > 0) indices.push(boardIndex - dimensions.columns);
  if (column < dimensions.columns - 1) indices.push(boardIndex + 1);
  if (row < dimensions.rows - 1) indices.push(boardIndex + dimensions.columns);
  if (column > 0) indices.push(boardIndex - 1);
  const color = slidingTileColor(tileId, dimensions.columns);
  let matchingNeighbors = 0;
  let mixedNeighbors = 0;
  for (const index of indices) {
    const neighborTile = puzzle.tiles[index];
    if (neighborTile === SLIDING_PUZZLE_BLANK) continue;
    if (slidingTileColor(neighborTile, dimensions.columns) === color) matchingNeighbors += 1;
    else mixedNeighbors += 1;
  }
  return {
    neighborCount: matchingNeighbors + mixedNeighbors,
    matchingNeighbors,
    mixedNeighbors,
  };
}

export function createSlidingPuzzleSequence(puzzle, options = {}) {
  const safePuzzle = assertPuzzle(puzzle);
  const dimensions = slidingPuzzleDimensions(safePuzzle);
  const readOrder = slidingPuzzleReadOrder(
    dimensions,
    options.rotationQuarterTurns ?? 0,
    options.pathId ?? "rows",
  );
  const maximumTileDistance = Math.max(1, dimensions.rows + dimensions.columns - 2);
  return Object.freeze(readOrder.map((cell) => {
    const tileId = safePuzzle.tiles[cell.boardIndex];
    const isRest = tileId === SLIDING_PUZZLE_BLANK;
    const homeIndex = isRest ? dimensions.cellCount - 1 : tileId - 1;
    const homeRow = Math.floor(homeIndex / dimensions.columns);
    const homeColumn = homeIndex % dimensions.columns;
    const displacement = isRest
      ? 0
      : Math.abs(cell.boardRow - homeRow) + Math.abs(cell.boardColumn - homeColumn);
    const neighbors = neighborContext(safePuzzle, cell.boardIndex, tileId, dimensions);
    return Object.freeze({
      ...cell,
      ...neighbors,
      tileId,
      isRest,
      homeRow,
      homeColumn,
      displacement,
      normalizedDisplacement: displacement / maximumTileDistance,
      color: isRest ? "rest" : slidingTileColor(tileId, dimensions.columns),
    });
  }));
}

/** Serial frames contain one event; parallel frames group every screen row. */
export function createSlidingPuzzlePlaybackFrames(puzzle, options = {}) {
  const safePuzzle = assertPuzzle(puzzle);
  const playbackMode = Object.hasOwn(SLIDING_PLAYBACK_MODES, options.playbackMode)
    ? options.playbackMode
    : "serial";
  const sequence = createSlidingPuzzleSequence(safePuzzle, {
    rotationQuarterTurns: options.rotationQuarterTurns ?? 0,
    pathId: playbackMode === "parallel" ? "rows" : options.pathId ?? "rows",
  });
  if (playbackMode === "serial") {
    return Object.freeze(sequence.map((event, step) => Object.freeze({
      step,
      playbackMode,
      screenColumn: event.screenColumn,
      screenRows: event.screenRows,
      screenColumns: event.screenColumns,
      events: Object.freeze([event]),
      soundingCount: event.isRest ? 0 : 1,
      restCount: event.isRest ? 1 : 0,
      isRest: event.isRest,
    })));
  }

  const { screenColumns, screenRows } = sequence[0];
  return Object.freeze(Array.from({ length: screenColumns }, (_, screenColumn) => {
    const events = Object.freeze(sequence
      .filter((event) => event.screenColumn === screenColumn)
      .sort((left, right) => left.screenRow - right.screenRow));
    const restCount = events.filter((event) => event.isRest).length;
    return Object.freeze({
      step: screenColumn,
      playbackMode,
      screenColumn,
      screenRows,
      screenColumns,
      events,
      soundingCount: events.length - restCount,
      restCount,
      isRest: restCount === events.length,
    });
  }));
}

export function slidingPuzzleMetrics(puzzle) {
  const safePuzzle = assertPuzzle(puzzle);
  const dimensions = slidingPuzzleDimensions(safePuzzle);
  const { tiles } = safePuzzle;
  let displaced = 0;
  let manhattan = 0;
  tiles.forEach((tileId, index) => {
    if (tileId === SLIDING_PUZZLE_BLANK) return;
    const solvedIndex = tileId - 1;
    if (solvedIndex !== index) displaced += 1;
    manhattan += Math.abs(
      Math.floor(index / dimensions.columns) - Math.floor(solvedIndex / dimensions.columns),
    );
    manhattan += Math.abs(index % dimensions.columns - solvedIndex % dimensions.columns);
  });
  const maximumUsefulDistance = Math.max(
    1,
    (tiles.length - 1) * Math.max(dimensions.rows - 1, dimensions.columns - 1),
  );
  return Object.freeze({
    displaced,
    manhattan,
    disorder: Math.min(1, manhattan / maximumUsefulDistance),
    solved: displaced === 0,
  });
}
