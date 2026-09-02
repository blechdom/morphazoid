import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function pageSources() {
  const [html, css, app, model] = await Promise.all([
    readFile(new URL("sliding-puzzle.html", root), "utf8"),
    readFile(new URL("sliding-puzzle.css", root), "utf8"),
    readFile(new URL("sliding-puzzle-app.js", root), "utf8"),
    readFile(new URL("src/sliding-puzzle.js", root), "utf8"),
  ]);
  return { html, css, app, model };
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
}

function openingTag(source, tagName, id) {
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`, "i"));
  assert.ok(match, `${tagName}#${id} should exist`);
  return match[0];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}(?:="([^"]*)")?`, "i"));
  if (!match) return null;
  return match[1] ?? "";
}

function hasBooleanAttribute(tag, name) {
  return new RegExp(`\\b${name}(?:\\s|>|=)`, "i").test(tag);
}

function selectOptions(source, id) {
  const select = source.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/select>`, "i"));
  assert.ok(select, `select#${id} should exist`);
  return [...select[0].matchAll(/<option\b[^>]*\bvalue="([^"]+)"[^>]*>([^<]+)<\/option>/gi)]
    .map((match) => ({
      value: match[1],
      label: match[2].trim(),
      selected: hasBooleanAttribute(match[0], "selected"),
    }));
}

test("the rectangular sliding-puzzle page ships complete local assets and metadata", async () => {
  for (const path of [
    "sliding-puzzle.html",
    "sliding-puzzle.css",
    "sliding-puzzle-app.js",
    "src/sliding-puzzle.js",
  ]) {
    assert.ok((await stat(new URL(path, root))).size > 0, `${path} should not be empty`);
  }

  const { html } = await pageSources();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Sliding Puzzle — Morphazoid<\/title>/);
  assert.match(
    html,
    /name="description"[\s\S]*resize a square or rectangular note puzzle[\s\S]*serially or all rows in parallel[\s\S]*rotate, scramble/i,
  );
  assert.match(html, /<link rel="stylesheet" href="style\.css"\s*\/>/);
  assert.match(html, /<link rel="stylesheet" href="sliding-puzzle\.css"\s*\/>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="sliding-puzzle-app\.js"><\/script>/);
  assert.match(html, /href="sliding-puzzle\.html" aria-current="page"/);
  assert.match(html, /<h1 id="slidingPuzzleTitle">Sliding Puzzle<\/h1>/);
  assert.match(html, /<option value="sliding-puzzle\.html" selected>sliding puzzle<\/option>/);

  const urls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(urls.length >= 8);
  for (const url of urls) {
    assert.doesNotMatch(url, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, `${url} should remain local`);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "authored ids should be unique");
});

test("markup exposes an accessible resizable grid, transport, and complete instructions", async () => {
  const { html } = await pageSources();
  const requiredIds = [
    "slidingPuzzleSequencer", "slidingPuzzleTitle", "stageScoreLabel", "puzzleFrame",
    "boardSlots", "puzzleReader", "puzzleBoard", "stageSequence", "stageReadout",
    "audioButton", "playButton", "stepStrip", "nowPlaying", "pulseDivision",
    "playbackDirection", "rows", "rowsOut", "columns", "columnsOut", "squareLock",
    "squareLockState", "dimensionOut", "scramblePuzzle", "solvePuzzle", "undoMove",
    "resetPuzzle", "rotateLeft", "rotateRight", "rotateLeftStage", "rotateRightStage",
    "autoSlide", "autoSlideSpeed", "rotationOut", "pitchSpan", "microStrum",
    "positionInfluence", "filterInfluence", "neighborResponse", "disorderInfluence",
    "colorKey", "puzzleInstructions", "liveStatus", "audioError",
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`\\bid="${id}"`));

  const board = openingTag(html, "div", "puzzleBoard");
  assert.equal(attribute(board, "role"), "grid");
  assert.equal(attribute(board, "aria-describedby"), "puzzleInstructions liveStatus");
  assert.match(attribute(board, "aria-label"), /resizable sliding note puzzle.+empty cell/i);
  assert.equal(attribute(board, "aria-rowcount"), null, "runtime dimensions own rowcount");
  assert.equal(attribute(board, "aria-colcount"), null, "runtime dimensions own colcount");

  for (const id of [
    "audioButton", "playButton", "restartLoop", "squareLock", "scramblePuzzle",
    "solvePuzzle", "undoMove", "resetPuzzle", "rotateLeft", "rotateRight",
    "rotateLeftStage", "rotateRightStage", "autoSlide", "resetSound",
  ]) {
    assert.equal(attribute(openingTag(html, "button", id), "type"), "button");
  }
  assert.equal(attribute(openingTag(html, "button", "audioButton"), "aria-pressed"), "false");
  assert.equal(attribute(openingTag(html, "button", "playButton"), "aria-pressed"), "false");
  assert.equal(hasBooleanAttribute(openingTag(html, "button", "solvePuzzle"), "disabled"), true);
  assert.equal(hasBooleanAttribute(openingTag(html, "button", "undoMove"), "disabled"), true);

  const instructions = sourceSection(html, '<p class="sr-only" id="puzzleInstructions">', "</p>");
  for (const phrase of [
    /sharing the empty cell's row or column/i,
    /every tile between it and the empty cell slide together/i,
    /arrow keys move the empty cell in screen space/i,
    /Lines together plays one screen column across every row at once/i,
    /empty cell rests only\s+its lane/i,
    /One tile mode follows the selected Lines, Snake, or Spiral path/i,
    /Rows and columns resize independently when Square lock is off/i,
    /size-scaled set of fast legal moves/i,
    /Solve unwinds the exact move history/i,
  ]) assert.match(instructions, phrase);
  assert.doesNotMatch(html, /sliding-status-strip"\s+aria-live/);
  assert.equal(attribute(openingTag(html, "p", "liveStatus"), "aria-live"), "polite");
  assert.equal(attribute(openingTag(html, "p", "audioError"), "role"), "alert");
  assert.equal(hasBooleanAttribute(openingTag(html, "p", "audioError"), "hidden"), true);
});

test("rows and columns are independent 2–8 controls behind an explicit square lock", async () => {
  const { html, app } = await pageSources();
  for (const id of ["rows", "columns"]) {
    const input = openingTag(html, "input", id);
    assert.deepEqual(
      ["type", "min", "max", "step", "value"].map((name) => attribute(input, name)),
      ["range", "2", "8", "1", "4"],
    );
  }
  const lock = openingTag(html, "button", "squareLock");
  assert.equal(attribute(lock, "aria-pressed"), "true");
  assert.match(html, /id="squareLockState">on<\/small>/);
  assert.match(html, /Unlock square to make any rectangle from 2 × 2 through 8 × 8/);

  const state = sourceSection(app, "const state = {", "const tileButtons");
  assert.match(state, /squareLock: true/);
  const resize = sourceSection(app, "function setPuzzleDimensions(", "function applyDimensionControl(");
  assert.match(resize, /clamp\(rows, 2, 8\)/);
  assert.match(resize, /clamp\(columns, 2, 8\)/);
  assert.match(resize, /current\.rows === nextRows && current\.columns === nextColumns/);
  assert.match(resize, /state\.puzzle = createSolvedSlidingPuzzle\(nextRows, nextColumns\)/);
  assert.match(resize, /state\.history = Object\.freeze\(\[\]\)/);
  assert.match(resize, /const firstStep = state\.playbackDirection === "reverse"[\s\S]*sequenceSnapshot\.length - 1/);
  assert.match(resize, /state\.currentStep = firstStep/);
  assert.match(resize, /transportStep = firstStep[\s\S]*transportDirection = state\.playbackDirection === "reverse" \? -1 : 1[\s\S]*transportPulse = 0/);
  assert.match(resize, /randomTransportOrder = \[\][\s\S]*randomTransportIndex = 0/);
  assert.match(resize, /createBoardDom\(\)[\s\S]*renderControls\(\)[\s\S]*renderAll\(\)/);
  assert.match(resize, /if \(state\.playing\) setPlaying\(true, \{ restart: true, announce: false \}\)/);

  const dimensionInput = sourceSection(app, "function applyDimensionControl(", "function rotateBoard(");
  assert.match(dimensionInput, /let rows = Math\.round\(clamp\(\$\("rows"\)\.value, 2, 8\)\)/);
  assert.match(dimensionInput, /let columns = Math\.round\(clamp\(\$\("columns"\)\.value, 2, 8\)\)/);
  assert.match(dimensionInput, /if \(state\.squareLock\)/);
  assert.match(dimensionInput, /changedAxis === "rows"\) columns = rows/);
  assert.match(dimensionInput, /else rows = columns/);
  assert.match(dimensionInput, /setPuzzleDimensions\(rows, columns\)/);

  const controls = sourceSection(app, "function bindControls()", "function cleanup()");
  assert.match(controls, /state\.squareLock = !state\.squareLock/);
  assert.match(controls, /for \(const axis of \["rows", "columns"\]\)/);
  assert.match(controls, /\$\(axis\)\.addEventListener\("input"/);
  assert.match(controls, /const pairedAxis = axis === "rows" \? "columns" : "rows"/);
  assert.match(controls, /loads on release/);
  assert.match(controls, /\$\(axis\)\.addEventListener\("change", \(\) => applyDimensionControl\(axis\)\)/);
});

test("parallel and serial playback modes expose pulse and pass controls", async () => {
  const { html, app } = await pageSources();
  const modes = [...html.matchAll(/<button\b[^>]*\bdata-playback-mode="[^"]+"[^>]*>/g)]
    .map((match) => [
      attribute(match[0], "data-playback-mode"),
      attribute(match[0], "aria-pressed"),
    ]);
  assert.deepEqual(modes, [["parallel", "true"], ["serial", "false"]]);

  const paths = [...html.matchAll(/<button\b[^>]*\bdata-read-path="[^"]+"[^>]*>/g)];
  assert.deepEqual(paths.map((match) => attribute(match[0], "data-read-path")), ["rows", "snake", "spiral"]);
  assert.ok(paths.every((match) => hasBooleanAttribute(match[0], "disabled")));
  assert.deepEqual(selectOptions(html, "pulseDivision"), [
    { value: "4", label: "1/4", selected: false },
    { value: "8", label: "1/8", selected: true },
    { value: "16", label: "1/16", selected: false },
    { value: "32", label: "1/32", selected: false },
    { value: "64", label: "1/64", selected: false },
  ]);
  assert.deepEqual(selectOptions(html, "playbackDirection"), [
    { value: "forward", label: "Forward", selected: true },
    { value: "reverse", label: "Reverse", selected: false },
    { value: "pendulum", label: "Pendulum", selected: false },
    { value: "random", label: "Random pass", selected: false },
  ]);

  assert.match(app, /pulseDivision: 8/);
  assert.match(app, /playbackMode: "parallel"/);
  assert.match(app, /playbackDirection: "forward"/);
  const frames = sourceSection(app, "function currentPlaybackFrames()", "function createTransportDom(");
  assert.match(frames, /createSlidingPuzzlePlaybackFrames\(state\.puzzle/);
  assert.match(frames, /rotationQuarterTurns: state\.rotationTurns/);
  assert.match(frames, /pathId: state\.pathId/);
  assert.match(frames, /playbackMode: state\.playbackMode/);

  const renderControls = sourceSection(app, "function renderControls()", "function renderAll()");
  assert.match(renderControls, /document\.querySelectorAll\("\[data-playback-mode\]"\)/);
  assert.match(renderControls, /button\.dataset\.playbackMode === state\.playbackMode/);
  assert.match(renderControls, /button\.disabled = state\.playbackMode === "parallel"/);

  const bindings = sourceSection(app, "function bindControls()", "function cleanup()");
  assert.match(bindings, /Object\.hasOwn\(SLIDING_PLAYBACK_MODES, mode\)/);
  assert.match(bindings, /state\.playbackMode = mode/);
  assert.match(bindings, /updateSequenceSnapshot\(\)/);
  assert.match(bindings, /transportStep %= Math\.max\(1, sequenceSnapshot\.length\)/);
  assert.match(bindings, /state\.currentStep %= Math\.max\(1, sequenceSnapshot\.length\)/);
  assert.match(bindings, /\[4, 8, 16, 32, 64\]\.includes/);
  assert.match(bindings, /\["forward", "reverse", "pendulum", "random"\]\.includes/);
});

test("dynamic DOM construction follows cell and playback-frame counts", async () => {
  const { app } = await pageSources();
  const transport = sourceSection(app, "function createTransportDom(", "function createBoardDom()");
  assert.match(transport, /frameCount = currentPlaybackFrames\(\)\.length/);
  assert.match(transport, /stageSequence\.replaceChildren\(\)/);
  assert.match(transport, /stepStrip\.replaceChildren\(\)/);
  assert.match(transport, /stageStepCells\.length = 0/);
  assert.match(transport, /clockStepCells\.length = 0/);
  assert.match(transport, /--sequence-steps/);
  assert.match(transport, /step < frameCount/);

  const board = sourceSection(app, "function createBoardDom()", "function createColorKey()");
  assert.match(board, /const dimensions = slidingPuzzleDimensions\(state\.puzzle\)/);
  assert.match(board, /slots\.replaceChildren\(\)[\s\S]*reader\.replaceChildren\(\)[\s\S]*board\.replaceChildren\(\)/);
  assert.match(board, /tileButtons\.clear\(\)/);
  assert.match(board, /readerCells\.length = 0/);
  assert.match(board, /index < dimensions\.cellCount/);
  assert.match(board, /tileId < dimensions\.cellCount/);
  assert.match(board, /slidingTileColor\(tileId, dimensions\.columns\)/);
  assert.match(board, /board\.removeEventListener\("keydown", handleBoardKeydown\)/);
  assert.match(board, /board\.addEventListener\("keydown", handleBoardKeydown\)/);
  assert.match(board, /createTransportDom\(\)/);
  assert.match(board, /face\.setAttribute\("aria-hidden", "true"\)/);
  assert.doesNotMatch(board, /\.textContent\s*=|sliding-tile-(?:number|note|home|glyph)/);
});

test("CSS uses runtime rectangle and sequence variables without a fixed 4×4 layout", async () => {
  const { css } = await pageSources();
  assert.match(css, /\.sliding-puzzle-frame\s*\{[\s\S]*--board-aspect: 1 \/ 1[\s\S]*--board-target-width: 500px[\s\S]*aspect-ratio: var\(--board-aspect\)/);
  assert.match(css, /grid-template-columns: repeat\(var\(--board-columns, 4\), minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-rows: repeat\(var\(--board-rows, 4\), minmax\(0, 1fr\)\)/);
  assert.match(css, /--tile-width: calc\([\s\S]*var\(--board-columns, 4\)/);
  assert.match(css, /--tile-height: calc\([\s\S]*var\(--board-rows, 4\)/);
  assert.match(css, /\.sliding-tile\s*\{[\s\S]*top: calc\(var\(--tile-row\)[\s\S]*left: calc\(var\(--tile-column\)[\s\S]*width: var\(--tile-width\)[\s\S]*height: var\(--tile-height\)/);
  assert.match(css, /\.sliding-score-readout\s*\{[\s\S]*repeat\(var\(--sequence-steps, 4\)/);
  assert.match(css, /\.sliding-step-strip\s*\{[\s\S]*repeat\(var\(--sequence-steps, 4\)/);
  assert.match(css, /\.sliding-step-pips i\.is-rest\s*\{[\s\S]*border: 1px dashed[\s\S]*background: transparent/);
  assert.doesNotMatch(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.sliding-tile-(?:number|note|home|glyph)\b/);
});

test("board rendering uses rectangle-safe screen mapping and complete grid accessibility", async () => {
  const { app } = await pageSources();
  const render = sourceSection(app, "function renderBoard()", "function renderSequence()");
  assert.match(render, /slidingPuzzleDimensions\(state\.puzzle\)/);
  assert.match(render, /slidingPuzzleScreenDimensions\(state\.puzzle, state\.rotationTurns\)/);
  assert.match(render, /slidingPuzzleScreenCellForBoardCell\([\s\S]*blankBoardRow[\s\S]*blankBoardColumn[\s\S]*state\.rotationTurns/);
  assert.match(render, /for \(const element of \[frame, \$\("boardSlots"\), \$\("puzzleReader"\), board\]\)/);
  assert.match(render, /--board-rows/);
  assert.match(render, /--board-columns/);
  assert.match(render, /--board-aspect/);
  assert.match(render, /--board-target-width/);
  assert.match(render, /const stageHeight = \$\("stageWrap"\)\?\.clientHeight \|\| globalThis\.innerHeight/);
  assert.match(render, /stageHeight - reservedHeight/);
  assert.match(render, /--board-max-height/);
  assert.match(render, /board\.style\.setProperty\("--board-turn", "0deg"\)/);
  assert.match(render, /slidingPuzzleScreenCellForBoardCell\([\s\S]*boardRow[\s\S]*boardColumn[\s\S]*state\.rotationTurns/);
  assert.match(render, /aria-rowindex/);
  assert.match(render, /aria-colindex/);
  assert.match(render, /button\.tabIndex = canSlide && tileId === rovingTileId \? 0 : -1/);
  assert.match(render, /board\.setAttribute\("aria-busy", String\(state\.busy\)\)/);
  assert.match(render, /board\.setAttribute\("aria-rowcount", String\(screen\.rows\)\)/);
  assert.match(render, /board\.setAttribute\("aria-colcount", String\(screen\.columns\)\)/);
  assert.match(render, /dimensions\.rows} by \$\{dimensions\.columns} sliding note puzzle/);
  assert.match(render, /viewed as \$\{screen\.rows} screen rows by \$\{screen\.columns} screen columns/);

  const keyboard = sourceSection(app, "function handleBoardKeydown(", "function schedulerNow()");
  assert.match(keyboard, /slidingPuzzleReadOrder\(state\.puzzle, state\.rotationTurns, "rows"\)/);
  assert.match(keyboard, /blankScreen\.screenRow \+ rowDelta/);
  assert.match(keyboard, /blankScreen\.screenColumn \+ columnDelta/);
  assert.match(keyboard, /state\.puzzle\.tiles\[target\.boardIndex\]/);
  assert.match(keyboard, /for \(const button of tileButtons\.values\(\)\) button\.tabIndex = button === movedTile \? 0 : -1/);
  assert.match(keyboard, /movedTile\?\.focus\(\{ preventScroll: true \}\)/);
});

test("sequence pips, playhead lanes, and readouts are dynamically frame-based", async () => {
  const { app } = await pageSources();
  const sequence = sourceSection(app, "function renderSequence()", "function renderReadouts()");
  assert.match(sequence, /sequenceSnapshot\.forEach\(\(frame, index\)/);
  assert.match(sequence, /frame\.events\.find\(\(event\) => !event\.isRest\)/);
  assert.match(sequence, /classList\.toggle\("has-rest", frame\.restCount > 0\)/);
  assert.match(sequence, /for \(const event of frame\.events\)/);
  assert.match(sequence, /pip\.className = event\.isRest \? "is-rest" : ""/);
  assert.match(sequence, /cell\.replaceChildren\(pips\)/);

  const playhead = sourceSection(app, "function updatePlayhead(", "function flashInvalidMove()");
  assert.match(playhead, /const frame = sequenceSnapshot\[safeStep\]/);
  assert.match(playhead, /new Set\(frame\.events\.map\(\(event\) => event\.screenIndex\)\)/);
  assert.match(playhead, /frame\.events\.filter\(\(event\) => event\.isRest\)/);
  assert.match(playhead, /frame\.events\.filter\(\(event\) => !event\.isRest\)/);
  assert.match(playhead, /frame\.playbackMode === "parallel"/);
  assert.match(playhead, /frame\.soundingCount/);
  assert.match(playhead, /frame\.restCount/);

  const readouts = sourceSection(app, "function renderReadouts()", "function renderControls()");
  assert.match(readouts, /const frameCount = sequenceSnapshot\.length/);
  assert.match(readouts, /const noteCount = dimensions\.cellCount - 1/);
  assert.match(readouts, /dimensions\.rows} × \$\{dimensions\.columns/);
  assert.match(readouts, /\$\{screen\.rows} lines × \$\{frameCount} steps/);
  assert.match(readouts, /\$\{mode\.label} · \$\{topology}/);
  assert.match(readouts, /\$\{path\.label} saved · available in One tile mode/);
  assert.match(readouts, /\$\("scoreSummary"\)\.textContent = `\$\{noteCount} sounding · 1 rest · \$\{frameCount} steps`/);
  assert.match(readouts, /\$\("stageScoreLabel"\)\.textContent = `\$\{noteCount} NOTES \+ ONE REST`/);
});

test("movement, auto-slide, reset, scramble, solve, and rotation remain rectangle-safe", async () => {
  const { app } = await pageSources();
  const commit = sourceSection(app, "function commitTileMove(", "function requestTileMove(");
  assert.match(commit, /slidingPuzzleMoveTileIds\(state\.puzzle, tileId\)/);
  assert.match(commit, /slidePuzzleTile\(state\.puzzle, tileId\)/);
  assert.match(commit, /appendSlidingMoveHistory\(state\.history, tileId, movedTileIds\[0\]\)/);

  const auto = sourceSection(app, "function scheduleAutoSlide()", "function scrambleMoveCount()");
  assert.match(auto, /slidingPuzzleLegalTileIds\(state\.puzzle\)/);
  assert.match(auto, /slidingPuzzleMoveTileIds\(state\.puzzle, tileId\)\[0\] \?\? tileId/);
  assert.match(auto, /rubixTwistIntervalMs\(state\.autoSlideSpeed\)/);

  const scrambleCount = sourceSection(app, "function scrambleMoveCount()", "function updateAutoSlideSpeedUi()");
  assert.match(scrambleCount, /slidingPuzzleDimensions\(state\.puzzle\)/);
  assert.match(scrambleCount, /Math\.max\(18, Math\.min\(64, cellCount \* 3\)\)/);
  const scramble = sourceSection(app, "function scramblePuzzle()", "function solvePuzzle()");
  assert.match(scramble, /const moveCount = scrambleMoveCount\(\)/);
  assert.match(scramble, /createSlidingPuzzleScramble\(state\.puzzle, \{ moves: moveCount \}\)/);
  assert.match(scramble, /Scrambling with \$\{scramble\.moves\.length} legal slides/);
  const solve = sourceSection(app, "function solvePuzzle()", "function undoMove()");
  assert.match(solve, /invertSlidingMoves\(state\.history\)/);

  const reset = sourceSection(app, "function resetPuzzle()", "function setPuzzleDimensions(");
  assert.match(reset, /const \{ rows, columns \} = slidingPuzzleDimensions\(state\.puzzle\)/);
  assert.match(reset, /createSolvedSlidingPuzzle\(rows, columns\)/);

  const rotate = sourceSection(app, "function rotateBoard(", "function handleBoardKeydown(");
  assert.match(rotate, /updateSequenceSnapshot\(\)/);
  assert.match(rotate, /transportStep %= Math\.max\(1, sequenceSnapshot\.length\)/);
  assert.match(rotate, /state\.currentStep %= Math\.max\(1, sequenceSnapshot\.length\)/);
  assert.match(rotate, /slidingPuzzleScreenDimensions\(state\.puzzle, state\.rotationTurns\)/);
  assert.doesNotMatch(rotate, /setPlaying\(|state\.puzzle\s*=/);
});

test("pulse timing and every transport pass are explicit and restart-safe", async () => {
  const { app } = await pageSources();
  const duration = sourceSection(app, "function stepDurationSeconds(", "function rebuildRandomTransportOrder(");
  assert.match(duration, /60 \/ clamp\(state\.tempo, 36, 260\) \* \(4 \/ clamp\(state\.pulseDivision, 4, 64\)\)/);
  assert.match(duration, /step % 2 === 0 \? 1 \+ swing : 1 - swing/);

  const randomOrder = sourceSection(app, "function rebuildRandomTransportOrder(", "function randomStepForSchedule(");
  assert.match(randomOrder, /Array\.from\(\{ length \}, \(_, index\) => index\)/);
  assert.match(randomOrder, /Math\.floor\(Math\.random\(\) \* \(index \+ 1\)\)/);
  assert.match(randomOrder, /randomTransportIndex = 0/);
  const randomStep = sourceSection(app, "function randomStepForSchedule(", "function advanceTransportStep(");
  assert.match(randomStep, /randomTransportIndex >= length/);
  assert.match(randomStep, /rebuildRandomTransportOrder\(length\)/);
  assert.match(randomStep, /randomTransportIndex \+= 1/);

  const advance = sourceSection(app, "function advanceTransportStep(", "function clearVisualTimers()");
  assert.match(advance, /state\.playbackDirection === "reverse"/);
  assert.match(advance, /transportStep - 1 \+ length/);
  assert.match(advance, /state\.playbackDirection === "pendulum"/);
  assert.match(advance, /transportDirection = -1/);
  assert.match(advance, /transportDirection = 1/);
  assert.match(advance, /transportStep = \(transportStep \+ 1\) % length/);
  assert.match(advance, /function reconcileTransportCursor\(\)/);
  assert.match(advance, /transportPulse = committedTransportPulse \+ 1/);
  assert.match(advance, /advanceTransportStep\(length\)/);

  const playing = sourceSection(app, "function setPlaying(", "function restartLoop(");
  assert.match(playing, /state\.playbackDirection === "reverse"[\s\S]*sequenceSnapshot\.length - 1/);
  assert.match(playing, /transportPulse = 0/);
  assert.match(playing, /randomTransportOrder = \[\]/);
  assert.match(playing, /state\.playing && !next[\s\S]*reconcileTransportCursor\(\)/);
  assert.match(playing, /audio\.resetTransportBus\(state\.audioOn\)/);
  assert.match(playing, /transportHasCommitted = false/);
  const restart = sourceSection(app, "function restartLoop(", "async function setAudioOn(");
  assert.match(restart, /state\.playbackDirection === "reverse"/);
  assert.match(restart, /transportDirection = state\.playbackDirection === "reverse" \? -1 : 1/);
  assert.match(restart, /randomTransportIndex = 0/);
  const visuals = sourceSection(app, "function scheduleVisualStep(", "function schedulerTick()");
  assert.match(visuals, /committedTransportDirection = scheduledDirection/);
  assert.match(visuals, /committedTransportPulse = scheduledPulse/);
  assert.match(visuals, /transportHasCommitted = true/);
});

test("frame scheduler rests one lane, applies equal-power headroom, and micro-strums parallel rows", async () => {
  const { app } = await pageSources();
  const scheduler = sourceSection(app, "function schedulerTick()", "function setPlaying(");
  assert.match(scheduler, /nextStepTime < now - LOOKAHEAD_SECONDS[\s\S]*nextStepTime = now \+ 0\.045/);
  assert.match(scheduler, /const frames = sequenceSnapshot/);
  assert.match(scheduler, /const settings = state\.audioOn \? settingsSnapshot\(\) : null/);
  assert.match(scheduler, /state\.playbackDirection === "random"[\s\S]*randomStepForSchedule\(frames\.length\)/);
  assert.match(scheduler, /const duration = stepDurationSeconds\(transportPulse\)/);
  assert.match(scheduler, /frame\.events\.filter\(\(event\) => !event\.isRest\)/);
  assert.match(scheduler, /const parallelLevel = 1 \/ Math\.sqrt\(soundingEvents\.length\)/);
  assert.match(scheduler, /state\.soundBank === "acid-303" && soundingEvents\.length > 1 \? 0\.86 : 1/);
  assert.match(scheduler, /Math\.min\(state\.microStrum, duration \* 0\.8\)/);
  assert.match(scheduler, /frame\.events\.forEach\(\(event\)/);
  assert.match(scheduler, /if \(event\.isRest\) return/);
  assert.match(scheduler, /strumSpread \* event\.screenRow \/ lastLane/);
  assert.match(scheduler, /audio\.schedule\(event, nextStepTime \+ strum, duration, settings, \{[\s\S]*level: parallelLevel \* bankTrim/);
  assert.match(scheduler, /scheduleVisualStep\(step, nextStepTime, transportDirection, transportPulse\)/);
  assert.match(scheduler, /state\.playbackDirection !== "random"\) advanceTransportStep\(frames\.length\)/);
  assert.match(scheduler, /transportPulse \+= 1/);

  const dispatcher = sourceSection(app, "  schedule(event, when, stepDuration, settings, options = {})", "  scheduleFm(");
  assert.match(dispatcher, /if \(!this\.context \|\| !event \|\| event\.isRest\) return/);
  assert.match(dispatcher, /const level = clamp\(options\.level \?\? 1, 0, 1\.2\)/);
  assert.match(dispatcher, /const modulatedSettings = eventSettings\(event, settings\)/);
});

test("pitch span, micro-strum, and puzzle-mapping controls have exact ranges and defaults", async () => {
  const { html, app } = await pageSources();
  for (const [id, expected] of Object.entries({
    pitchSpan: ["range", "12", "48", "1", "36"],
    microStrum: ["range", "0", "0.04", "0.001", "0.012"],
    positionInfluence: ["range", "0", "2", "0.01", "0.72"],
    filterInfluence: ["range", "0", "2", "0.01", "0.72"],
    neighborResponse: ["range", "0", "2", "0.01", "0.65"],
    disorderInfluence: ["range", "0", "2", "0.01", "0.6"],
  })) {
    const input = openingTag(html, "input", id);
    assert.deepEqual(
      ["type", "min", "max", "step", "value"].map((name) => attribute(input, name)),
      expected,
    );
  }
  for (const copy of [
    /Screen position and distance from home bend tile pitch/,
    /Screen height and tile displacement move brightness/,
    /Matching colors ring; mixed-color borders add edge/,
    /Distance from solved adds bounded detune and filter energy/,
  ]) assert.match(html, copy);

  for (const line of [
    /pitchSpan: 36/,
    /microStrum: 0\.012/,
    /positionInfluence: 0\.72/,
    /filterInfluence: 0\.72/,
    /neighborResponse: 0\.65/,
    /disorderInfluence: 0\.6/,
  ]) assert.match(app, line);

  const tileMidi = sourceSection(app, "function tileMidi(", "function noteName(");
  assert.match(tileMidi, /const span = clamp\(pitchSpan, 12, 48\)/);
  assert.match(tileMidi, /\(unfoldedMidi - scale\.root\) % span/);
  const eventMidi = sourceSection(app, "function eventMidi(", "function eventSettings(");
  assert.match(eventMidi, /event\.screenColumn \/ Math\.max\(1, event\.screenColumns - 1\)/);
  assert.match(eventMidi, /event\.screenRow \/ Math\.max\(1, event\.screenRows - 1\)/);
  assert.match(eventMidi, /settings\.positionInfluence/);
  assert.match(eventMidi, /event\.boardRow - event\.homeRow/);
  assert.match(eventMidi, /settings\.disorder[\s\S]*settings\.disorderInfluence/);

  const eventSettings = sourceSection(app, "function eventSettings(", "function loadDrumBank()");
  assert.match(eventSettings, /event\.normalizedDisplacement/);
  assert.match(eventSettings, /settings\.filterInfluence/);
  assert.match(eventSettings, /event\.matchingNeighbors/);
  assert.match(eventSettings, /event\.mixedNeighbors/);
  assert.match(eventSettings, /settings\.neighborResponse/);
  assert.match(eventSettings, /settings\.disorderInfluence/);

  const settings = sourceSection(app, "function settingsSnapshot()", "function currentSequence()");
  for (const key of [
    "pitchSpan", "positionInfluence", "filterInfluence", "neighborResponse",
    "disorderInfluence", "disorder",
  ]) assert.match(settings, new RegExp(`\\b${key}:`));

  const bindings = sourceSection(app, "function bindControls()", "function cleanup()");
  assert.match(bindings, /\["positionInfluence", 0, 2\]/);
  assert.match(bindings, /\["filterInfluence", 0, 2\]/);
  assert.match(bindings, /\["neighborResponse", 0, 2\]/);
  assert.match(bindings, /\["disorderInfluence", 0, 2\]/);
  assert.match(bindings, /state\.pitchSpan = clamp\(event\.target\.value, 12, 48\)/);
  assert.match(bindings, /state\.microStrum = clamp\(event\.target\.value, 0, 0\.04\)/);
  const controls = sourceSection(app, "function renderControls()", "function renderAll()");
  assert.match(controls, /\$\("microStrum"\)\.disabled = state\.playbackMode !== "parallel"/);
});

test("responsive and interaction CSS retains focus, busy, rest, and reduced-motion states", async () => {
  const { css } = await pageSources();
  for (const selector of [
    /\.sliding-tile\.can-slide\s*\{/,
    /\.sliding-tile:focus-visible\s*\{/,
    /\.sliding-puzzle-board\.is-busy \.sliding-tile\s*\{/,
    /\.sliding-puzzle-board\.is-invalid \.sliding-tile\.can-slide\s*\{/,
    /\.sliding-reader-cell\.is-current\s*\{/,
    /\.sliding-reader-cell\.is-rest::after\s*\{/,
    /\.sliding-playback-modes button\[aria-pressed="true"\]\s*\{/,
    /\.sliding-read-paths button:disabled\s*\{/,
    /\.sliding-dimension-heading button\[aria-pressed="true"\]\s*\{/,
  ]) assert.match(css, selector);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sliding-blank-cell[\s\S]*transition-duration: 1ms[\s\S]*animation: none/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*\.sliding-score-readout[\s\S]*display: none/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 440px\)/);
  assert.match(css, /@media \(max-width: 900px\) and \(max-height: 620px\)/);
  assert.match(css, /\.has-dense-lanes \.sliding-step-pips/);
  assert.match(css, /\.sliding-puzzle-panel\s*\{[\s\S]*overflow-x: clip/);
});

test("audio toggles resync the running scheduler and page cleanup removes resize lifecycle", async () => {
  const { app } = await pageSources();
  const resync = sourceSection(app, "function resyncRunningScheduler()", "function stepDurationSeconds(");
  assert.match(resync, /if \(!state\.playing\) return/);
  assert.match(resync, /reconcileTransportCursor\(\)/);
  assert.match(resync, /clearTimeout\(schedulerTimer\)/);
  assert.match(resync, /clearVisualTimers\(\)/);
  assert.match(resync, /audio\.resetTransportBus\(state\.audioOn\)/);
  assert.match(resync, /nextStepTime = schedulerNow\(\) \+ 0\.045/);
  assert.match(resync, /schedulerTick\(\)/);

  const clock = sourceSection(app, "function schedulerNow()", "function resyncRunningScheduler()");
  assert.match(clock, /state\.audioOn && audio\.context/);

  const audioToggle = sourceSection(app, "async function setAudioOn(", "function resetSound()");
  assert.match(audioToggle, /const generation = \+\+audioLifecycleGeneration/);
  assert.match(audioToggle, /state\.audioOn = false[\s\S]*resyncRunningScheduler\(\)[\s\S]*await audio\.close\(\)/);
  assert.match(audioToggle, /await audio\.start\(settingsSnapshot\(\)\)/);
  assert.match(audioToggle, /state\.audioOn = true[\s\S]*resyncRunningScheduler\(\)/);
  assert.match(audioToggle, /renderReadouts\(\)[\s\S]*resyncRunningScheduler\(\)/);
  assert.match(audioToggle, /const isAbortError = caught\?\.name === "AbortError"/);
  assert.match(audioToggle, /await audio\.close\(\)[\s\S]*resyncRunningScheduler\(\)/);

  const busReset = sourceSection(app, "  resetTransportBus(", "  setOutput(");
  assert.match(busReset, /previousBus\.gain\.linearRampToValueAtTime\(0\.0001, now \+ 0\.008\)/);
  assert.match(busReset, /key\.startsWith\("transport:"\)/);
  assert.match(busReset, /this\.transportBus = context\.createGain\(\)/);
  assert.match(busReset, /this\.transportBus\.connect\(this\.compressor\)/);

  const controls = sourceSection(app, "function bindControls()", "function cleanup()");
  assert.match(controls, /globalThis\.addEventListener\("pagehide", cleanup\)/);
  assert.match(controls, /globalThis\.addEventListener\("resize", renderBoard\)/);
  const cleanup = sourceSection(app, "function cleanup()", "\n\ncreateBoardDom()");
  assert.match(cleanup, /globalThis\.removeEventListener\("resize", renderBoard\)/);
  assert.match(cleanup, /setAutoSlide\(false, \{ announce: false \}\)/);
  assert.match(cleanup, /cancelMotionSequence\(\)/);
  assert.match(cleanup, /setPlaying\(false, \{ announce: false \}\)/);
  assert.match(cleanup, /audioLifecycleGeneration \+= 1/);
  assert.match(cleanup, /audio\.close\(\)/);

  const audioClose = sourceSection(app, "  async close()", "\n}\n\nconst state =");
  assert.match(audioClose, /this\.lifecycleGeneration \+= 1/);
  assert.match(audioClose, /this\.releaseAudioOutput\?\.\(\)/);
  assert.match(audioClose, /this\.panners\.clear\(\)/);
  assert.match(audioClose, /await context\.close\(\)/);
});
