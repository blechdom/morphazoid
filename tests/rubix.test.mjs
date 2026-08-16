import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";

import {
  DEFAULT_RUBIX_CAMERA,
  RUBIX_ACID_MIDI_BY_COLOR,
  RUBIX_ACID_NORMALIZED_BY_COLOR,
  RUBIX_AXES,
  RUBIX_COLOR_ORDER,
  RUBIX_DRUM_LEFT_VOICE_BY_COLOR,
  RUBIX_DRUM_RIGHT_VOICE_BY_COLOR,
  RUBIX_FACE_DEFINITIONS,
  RUBIX_FACE_ORDER,
  RUBIX_LAYERS,
  RUBIX_READ_MODES,
  RUBIX_ROW_MAJOR_ORDER,
  RUBIX_SEQUENCE_ROLES,
  RUBIX_SNAKE_ORDER,
  createRubixSequenceSnapshot,
  createSolvedRubixCube,
  extractRubixFace,
  projectRubixPoint,
  rotateRubixQuarterVector,
  rotateRubixVector,
  rubixAcidValueForColor,
  rubixDrumVoiceIndexForColor,
  rubixEulerMatrix,
  rubixLayersForSize,
  rubixReadFrame,
  turnRubixLayer,
  visibleRubixFaces,
} from "../src/rubix.js";

const root = new URL("../", import.meta.url);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
}

const centerState = (cube) => Object.fromEntries(
  cube.stickers
    .filter(({ isCenter }) => isCenter)
    .map(({ id, position, normal }) => [id, { position, normal }]),
);

test("solved Rubix cube has 54 unique stickers and nine of each color", () => {
  const cube = createSolvedRubixCube();
  assert.equal(cube.size, 3);
  assert.equal(cube.stickers.length, 54);
  assert.equal(new Set(cube.stickers.map(({ id }) => id)).size, 54);
  assert.equal(cube.stickers.filter(({ isCenter }) => isCenter).length, 6);
  assert.ok(Object.isFrozen(cube));
  assert.ok(Object.isFrozen(cube.stickers));

  for (const color of RUBIX_COLOR_ORDER) {
    assert.equal(cube.stickers.filter((sticker) => sticker.color === color).length, 9);
  }
  for (const sticker of cube.stickers) {
    assert.ok(Object.isFrozen(sticker));
    assert.ok(Object.isFrozen(sticker.position));
    assert.ok(Object.isFrozen(sticker.normal));
    assert.ok([sticker.position.x, sticker.position.y, sticker.position.z].every(Number.isInteger));
    assert.ok([sticker.normal.x, sticker.normal.y, sticker.normal.z].every(Number.isInteger));
  }

  for (const face of RUBIX_FACE_ORDER) {
    const stickers = extractRubixFace(cube, face);
    assert.equal(stickers.length, 9);
    assert.ok(stickers.every(({ color }) => color === RUBIX_FACE_DEFINITIONS[face].color));
    assert.deepEqual(
      stickers.map(({ homeRow, homeColumn }) => [homeRow, homeColumn]),
      Array.from({ length: 9 }, (_, index) => [Math.floor(index / 3), index % 3]),
    );
  }
});

test("Rubix layers are exact centered integer or half-integer coordinates", () => {
  assert.equal(rubixLayersForSize(), RUBIX_LAYERS);
  assert.deepEqual(rubixLayersForSize(2), [-0.5, 0.5]);
  assert.deepEqual(rubixLayersForSize(3), [-1, 0, 1]);
  assert.deepEqual(rubixLayersForSize(4), [-1.5, -0.5, 0.5, 1.5]);
  assert.deepEqual(rubixLayersForSize(5), [-2, -1, 0, 1, 2]);
  assert.deepEqual(rubixLayersForSize(6), [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]);
  for (const size of [2, 3, 4, 5, 6]) {
    const layers = rubixLayersForSize(size);
    assert.ok(Object.isFrozen(layers));
    assert.equal(layers.length, size);
    assert.equal(layers[0], -layers.at(-1));
    assert.ok(layers.every((coordinate) => Number.isInteger(coordinate * 2)));
  }
  for (const size of [undefined, 1, 2.5, Number.NaN, "3"]) {
    if (size === undefined) continue;
    assert.throws(() => rubixLayersForSize(size), /integer of at least 2/);
    assert.throws(() => createSolvedRubixCube(size), /integer of at least 2/);
  }
});

test("2 x 2 through 6 x 6 solved cubes expose dynamic faces and exact centers", () => {
  for (const size of [2, 4, 5, 6]) {
    const cube = createSolvedRubixCube(size);
    const cellCount = size * size;
    const expectedStickerCount = 6 * cellCount;
    const layers = rubixLayersForSize(size);
    assert.equal(cube.size, size);
    assert.equal(cube.stickers.length, expectedStickerCount);
    assert.equal(new Set(cube.stickers.map(({ id }) => id)).size, expectedStickerCount);
    assert.equal(
      cube.stickers.filter(({ isCenter }) => isCenter).length,
      size % 2 === 1 ? 6 : 0,
    );
    assert.ok(cube.stickers.every(({ position }) => (
      RUBIX_AXES.every((axis) => layers.includes(position[axis]))
    )));
    for (const color of RUBIX_COLOR_ORDER) {
      assert.equal(cube.stickers.filter((sticker) => sticker.color === color).length, cellCount);
    }
    for (const face of RUBIX_FACE_ORDER) {
      const stickers = extractRubixFace(cube, face);
      assert.equal(stickers.length, cellCount);
      assert.ok(stickers.every(({ color }) => color === RUBIX_FACE_DEFINITIONS[face].color));
      assert.deepEqual(
        stickers.map(({ homeRow, homeColumn }) => [homeRow, homeColumn]),
        Array.from({ length: cellCount }, (_, index) => [
          Math.floor(index / size),
          index % size,
        ]),
      );
    }
  }
});

test("every layer returns exactly to its source after four quarter turns", () => {
  const solved = createSolvedRubixCube();
  for (const axis of RUBIX_AXES) {
    for (const layer of RUBIX_LAYERS) {
      for (const direction of [-1, 1]) {
        let turned = solved;
        for (let count = 0; count < 4; count += 1) {
          turned = turnRubixLayer(turned, { axis, layer, direction });
        }
        assert.deepEqual(turned, solved, `${axis}/${layer}/${direction} should cycle in four turns`);
      }
    }
  }
});

test("a quarter turn followed by its inverse restores the cube without mutation", () => {
  const solved = createSolvedRubixCube();
  const sourceSnapshot = structuredClone(solved);
  for (const axis of RUBIX_AXES) {
    for (const layer of RUBIX_LAYERS) {
      const turned = turnRubixLayer(solved, { axis, layer, direction: 1 });
      assert.notEqual(turned, solved);
      assert.deepEqual(
        turnRubixLayer(turned, { axis, layer, direction: -1 }),
        solved,
      );
    }
  }
  assert.deepEqual(solved, sourceSnapshot);
});

test("every supported non-default cube layer turns exactly and validates against its own size", () => {
  for (const size of [2, 4, 5, 6]) {
    const solved = createSolvedRubixCube(size);
    for (const axis of RUBIX_AXES) {
      for (const layer of rubixLayersForSize(size)) {
        const selectedIndices = solved.stickers.flatMap((sticker, index) => (
          sticker.position[axis] === layer ? [index] : []
        ));
        const turned = turnRubixLayer(solved, { axis, layer, direction: 1 });
        assert.equal(turned.size, size);
        assert.ok(selectedIndices.length > 0);
        assert.ok(
          selectedIndices.some((index) => turned.stickers[index] !== solved.stickers[index]),
          "a center sticker on an odd cube's rotation axis may remain geometrically unchanged",
        );
        assert.deepEqual(
          turnRubixLayer(turned, { axis, layer, direction: -1 }),
          solved,
          `${size}/${axis}/${layer} should invert exactly`,
        );

        let cycled = solved;
        for (let count = 0; count < 4; count += 1) {
          cycled = turnRubixLayer(cycled, { axis, layer, direction: 1 });
        }
        assert.deepEqual(cycled, solved, `${size}/${axis}/${layer} should cycle in four turns`);
      }
    }
  }

  const two = createSolvedRubixCube(2);
  assert.throws(
    () => turnRubixLayer(two, { axis: "x", layer: 0, direction: 1 }),
    /for size 2/,
  );
  assert.throws(
    () => turnRubixLayer(createSolvedRubixCube(6), {
      axis: "z", layer: 3, direction: 1,
    }),
    /for size 6/,
  );
  assert.throws(
    () => extractRubixFace({ size: 2, stickers: two.stickers.slice(1) }, "up"),
    /exactly 24 stickers/,
  );
  const duplicateCell = {
    size: 2,
    stickers: two.stickers.map((sticker, index) => (
      index === 1
        ? { ...sticker, position: two.stickers[0].position }
        : sticker
    )),
  };
  assert.throws(
    () => turnRubixLayer(duplicateCell, { axis: "x", layer: -0.5, direction: 1 }),
    /unique up face cell/,
  );
});

test("middle-slice turns move their ring while all six face centers remain fixed", () => {
  const solved = createSolvedRubixCube();
  const centers = centerState(solved);
  for (const axis of RUBIX_AXES) {
    const turned = turnRubixLayer(solved, { axis, layer: 0, direction: 1 });
    assert.deepEqual(centerState(turned), centers);
    assert.ok(turned.stickers.some((sticker, index) => (
      !sticker.isCenter
      && sticker.position[axis] === 0
      && sticker !== solved.stickers[index]
    )));
    for (const face of RUBIX_FACE_ORDER) {
      assert.equal(extractRubixFace(turned, face).length, 9);
    }
  }
});

test("quarter-vector and Euler camera helpers preserve their documented conventions", () => {
  assert.deepEqual(rotateRubixQuarterVector({ x: 1, y: 1, z: 0 }, "x", 1), {
    x: 1, y: 0, z: 1,
  });
  assert.deepEqual(rotateRubixQuarterVector({ x: 1, y: 0, z: 1 }, "y", 1), {
    x: 1, y: 0, z: -1,
  });
  assert.deepEqual(rotateRubixQuarterVector({ x: 1, y: 0, z: 0 }, "z", 1), {
    x: 0, y: 1, z: 0,
  });
  assert.deepEqual(rubixEulerMatrix({ x: 0, y: 0, z: 0 }), [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  assert.deepEqual(rotateRubixVector({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }), {
    x: 1, y: 2, z: 3,
  });
  assert.deepEqual(projectRubixPoint({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }), {
    x: 1, y: 2, depth: 3,
  });
});

test("visible lanes are deterministic, distinct, and change with camera view", () => {
  const cube = createSolvedRubixCube();
  const visible = visibleRubixFaces(DEFAULT_RUBIX_CAMERA);
  assert.deepEqual(visible.faces.map(({ face }) => face), ["up", "front", "right"]);
  assert.deepEqual(visible.faces.map(({ role }) => role), ["acid", "drum-left", "drum-right"]);
  assert.equal(new Set(visible.faces.map(({ face }) => face)).size, 3);

  const first = createRubixSequenceSnapshot(cube, DEFAULT_RUBIX_CAMERA);
  const repeated = createRubixSequenceSnapshot(cube, DEFAULT_RUBIX_CAMERA);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.faceNames, {
    acid: "up",
    drumLeft: "front",
    drumRight: "right",
  });
  assert.equal(first.lanes.acid.length, 9);
  assert.equal(first.lanes.drumLeft.length, 9);
  assert.equal(first.lanes.drumRight.length, 9);
  assert.equal(first.stickerIds.length, 27);
  assert.equal(new Set(first.stickerIds).size, 27);

  const oppositeCamera = { x: 30, y: 135, z: 0 };
  const opposite = createRubixSequenceSnapshot(cube, oppositeCamera);
  assert.equal(opposite.stickerIds.length, 27);
  assert.equal(new Set(opposite.stickerIds).size, 27);
  assert.notDeepEqual(opposite.faceNames, first.faceNames);
  assert.notDeepEqual(opposite.stickerIds, first.stickerIds);

  const moved = turnRubixLayer(cube, { axis: "x", layer: 1, direction: 1 });
  const movedSnapshot = createRubixSequenceSnapshot(moved, DEFAULT_RUBIX_CAMERA);
  assert.equal(new Set(movedSnapshot.stickerIds).size, 27);
  assert.notDeepEqual(
    movedSnapshot.lanes.drumLeft.map(({ color }) => color),
    first.lanes.drumLeft.map(({ color }) => color),
  );
});

test("2 x 2 through 6 x 6 snapshots contain three complete dynamic lanes", () => {
  for (const size of [2, 4, 5, 6]) {
    const cube = createSolvedRubixCube(size);
    const cellCount = size * size;
    const snapshot = createRubixSequenceSnapshot(cube, DEFAULT_RUBIX_CAMERA);
    for (const lane of Object.values(snapshot.lanes)) assert.equal(lane.length, cellCount);
    assert.equal(snapshot.stickerIds.length, 3 * cellCount);
    assert.equal(new Set(snapshot.stickerIds).size, 3 * cellCount);
    assert.equal(snapshot.audio.acidMidi.length, cellCount);
    assert.equal(snapshot.audio.acidNormalized.length, cellCount);
    assert.equal(snapshot.audio.drumLeftVoiceIndices.length, cellCount);
    assert.equal(snapshot.audio.drumRightVoiceIndices.length, cellCount);

    const moved = turnRubixLayer(cube, {
      axis: "y",
      layer: rubixLayersForSize(size).at(-1),
      direction: -1,
    });
    const movedSnapshot = createRubixSequenceSnapshot(moved, DEFAULT_RUBIX_CAMERA);
    assert.equal(movedSnapshot.stickerIds.length, 3 * cellCount);
    assert.equal(new Set(movedSnapshot.stickerIds).size, 3 * cellCount);
  }
});

test("six color mappings use distinct, complementary conventional drum voices", () => {
  const acidMidi = [];
  const acidNormalized = [];
  const leftVoices = [];
  const rightVoices = [];
  const allowedDrumFamilies = new Set(["kick", "snare", "tom", "hat"]);
  const abrasiveDrumFamilies = new Set(["bell", "metal", "effect"]);
  for (const color of RUBIX_COLOR_ORDER) {
    const acid = rubixAcidValueForColor(color);
    const left = rubixDrumVoiceIndexForColor(color, "drum-left");
    const right = rubixDrumVoiceIndexForColor(color, "drum-right");
    assert.equal(acid.midi, RUBIX_ACID_MIDI_BY_COLOR[color]);
    assert.equal(acid.normalized, RUBIX_ACID_NORMALIZED_BY_COLOR[color]);
    assert.ok(Number.isInteger(acid.midi) && acid.midi >= 20 && acid.midi <= 57);
    assert.ok(acid.normalized >= 0 && acid.normalized <= 0.9999);
    assert.equal(left, RUBIX_DRUM_LEFT_VOICE_BY_COLOR[color]);
    assert.equal(right, RUBIX_DRUM_RIGHT_VOICE_BY_COLOR[color]);
    assert.ok(Number.isInteger(left) && left >= 0 && left < 16);
    assert.ok(Number.isInteger(right) && right >= 0 && right < 16);
    assert.notEqual(left, right);
    for (const voiceIndex of [left, right]) {
      const family = DEFAULT_FM_DRUM_VOICES[voiceIndex]?.family;
      assert.ok(
        allowedDrumFamilies.has(family),
        `${color} maps to disallowed ${String(family)} voice ${voiceIndex}`,
      );
      assert.equal(abrasiveDrumFamilies.has(family), false);
    }
    acidMidi.push(acid.midi);
    acidNormalized.push(acid.normalized);
    leftVoices.push(left);
    rightVoices.push(right);
  }
  assert.equal(new Set(acidMidi).size, 6);
  assert.equal(new Set(acidNormalized).size, 6);
  assert.equal(new Set(leftVoices).size, 6);
  assert.equal(new Set(rightVoices).size, 6);

  const snapshot = createRubixSequenceSnapshot(createSolvedRubixCube());
  assert.equal(snapshot.audio.acidMidi.length, 9);
  assert.equal(snapshot.audio.acidNormalized.length, 9);
  assert.equal(snapshot.audio.drumLeftVoiceIndices.length, 9);
  assert.equal(snapshot.audio.drumRightVoiceIndices.length, 9);
  assert.ok(snapshot.audio.acidNormalized.every((value) => value >= 0 && value <= 0.9999));
  assert.ok(snapshot.audio.drumLeftVoiceIndices.every((value) => value >= 0 && value < 16));
  assert.ok(snapshot.audio.drumRightVoiceIndices.every((value) => value >= 0 && value < 16));
});

test("Rubix read-path metadata is immutable and defaults to parallel row-major playback", () => {
  assert.deepEqual(RUBIX_SNAKE_ORDER, [0, 1, 2, 5, 4, 3, 6, 7, 8]);
  assert.ok(Object.isFrozen(RUBIX_SNAKE_ORDER));
  assert.ok(Object.isFrozen(RUBIX_READ_MODES));
  assert.deepEqual(
    Object.fromEntries(Object.entries(RUBIX_READ_MODES).map(([id, config]) => [id, {
      stepCount: config.stepCount,
      roleMode: config.roleMode,
      path: config.path,
      subdivisionsPerBeat: config.subdivisionsPerBeat,
    }])),
    {
      parallel: {
        stepCount: 9, roleMode: "all", path: "row-major", subdivisionsPerBeat: 1,
      },
      snake: {
        stepCount: 9, roleMode: "all", path: "snake", subdivisionsPerBeat: 1,
      },
      face: {
        stepCount: 27, roleMode: "alternating", path: "snake", subdivisionsPerBeat: 3,
      },
    },
  );
  for (const config of Object.values(RUBIX_READ_MODES)) {
    assert.ok(Object.isFrozen(config));
    assert.equal(config.roleOrder, RUBIX_SEQUENCE_ROLES);
  }
  assert.equal(RUBIX_READ_MODES.parallel.cellOrder, RUBIX_ROW_MAJOR_ORDER);
  assert.equal(RUBIX_READ_MODES.snake.cellOrder, RUBIX_SNAKE_ORDER);
  assert.equal(RUBIX_READ_MODES.face.cellOrder, RUBIX_SNAKE_ORDER);
  assert.deepEqual(rubixReadFrame(), {
    mode: "parallel",
    transportStep: 0,
    stepCount: 9,
    cellIndex: 0,
    activeRoles: ["acid", "drumLeft", "drumRight"],
  });
  assert.deepEqual(rubixReadFrame("unknown", 4), {
    mode: "parallel",
    transportStep: 4,
    stepCount: 9,
    cellIndex: 4,
    activeRoles: ["acid", "drumLeft", "drumRight"],
  });
  assert.deepEqual(rubixReadFrame("constructor", 4), rubixReadFrame("parallel", 4));
});

test("Rubix read paths wrap transport positions and expose the full snake", () => {
  assert.equal(rubixReadFrame("parallel", 9).transportStep, 0);
  assert.equal(rubixReadFrame("parallel", -1).transportStep, 8);
  assert.equal(rubixReadFrame("face", 27).transportStep, 0);
  assert.deepEqual(rubixReadFrame("face", -1), {
    mode: "face",
    transportStep: 26,
    stepCount: 27,
    cellIndex: 8,
    activeRoles: ["drumRight"],
  });
  assert.deepEqual(
    Array.from({ length: 9 }, (_, step) => rubixReadFrame("parallel", step).cellIndex),
    RUBIX_ROW_MAJOR_ORDER,
  );
  assert.deepEqual(
    Array.from({ length: 9 }, (_, step) => rubixReadFrame("snake", step).cellIndex),
    RUBIX_SNAKE_ORDER,
  );
});

test("alternate-faces read path subdivides each snake cell across the three roles", () => {
  const resolved = Array.from({ length: 27 }, (_, step) => rubixReadFrame("face", step));
  assert.deepEqual(
    resolved.flatMap(({ activeRoles }) => activeRoles),
    Array.from({ length: 9 }, () => RUBIX_SEQUENCE_ROLES).flat(),
  );
  assert.deepEqual(
    resolved.map(({ cellIndex }) => cellIndex),
    RUBIX_SNAKE_ORDER.flatMap((cellIndex) => Array(3).fill(cellIndex)),
  );
  for (let cell = 0; cell < 9; cell += 1) {
    const subdivisions = resolved.slice(cell * 3, cell * 3 + 3);
    assert.deepEqual(
      subdivisions.flatMap(({ activeRoles }) => activeRoles),
      RUBIX_SEQUENCE_ROLES,
    );
    assert.ok(subdivisions.every(({ cellIndex }) => cellIndex === RUBIX_SNAKE_ORDER[cell]));
  }
  assert.ok(resolved.every(({ stepCount, activeRoles }) => (
    stepCount === 27 && activeRoles.length === 1
  )));
});

test("dynamic read paths cover every supported 2 x 2 through 6 x 6 cube face", () => {
  const expectedSnake = (side) => Array.from({ length: side }, (_, row) => {
    const cells = Array.from({ length: side }, (_, column) => row * side + column);
    return row % 2 === 1 ? cells.reverse() : cells;
  }).flat();

  for (const side of [2, 3, 4, 5, 6]) {
    const cellCount = side * side;
    const rowMajor = Array.from({ length: cellCount }, (_, index) => index);
    const snake = expectedSnake(side);
    const parallelFrames = Array.from(
      { length: cellCount },
      (_, step) => rubixReadFrame("parallel", step, cellCount),
    );
    const snakeFrames = Array.from(
      { length: cellCount },
      (_, step) => rubixReadFrame("snake", step, cellCount),
    );
    const faceFrames = Array.from(
      { length: 3 * cellCount },
      (_, step) => rubixReadFrame("face", step, cellCount),
    );

    assert.deepEqual(parallelFrames.map(({ cellIndex }) => cellIndex), rowMajor);
    assert.deepEqual(snakeFrames.map(({ cellIndex }) => cellIndex), snake);
    assert.ok(parallelFrames.every(({ stepCount }) => stepCount === cellCount));
    assert.ok(snakeFrames.every(({ stepCount }) => stepCount === cellCount));
    assert.ok(faceFrames.every(({ stepCount }) => stepCount === 3 * cellCount));
    assert.deepEqual(
      faceFrames.flatMap(({ activeRoles }) => activeRoles),
      Array.from({ length: cellCount }, () => RUBIX_SEQUENCE_ROLES).flat(),
    );
    assert.deepEqual(
      faceFrames.map(({ cellIndex }) => cellIndex),
      snake.flatMap((cellIndex) => Array(RUBIX_SEQUENCE_ROLES.length).fill(cellIndex)),
    );
    for (let cell = 0; cell < cellCount; cell += 1) {
      const subdivisions = faceFrames.slice(cell * 3, cell * 3 + 3);
      assert.deepEqual(
        subdivisions.flatMap(({ activeRoles }) => activeRoles),
        RUBIX_SEQUENCE_ROLES,
      );
      assert.ok(subdivisions.every(({ cellIndex }) => cellIndex === snake[cell]));
    }
    assert.equal(rubixReadFrame("parallel", cellCount, cellCount).transportStep, 0);
    assert.equal(rubixReadFrame("snake", -1, cellCount).cellIndex, snake.at(-1));
    assert.equal(rubixReadFrame("face", 3 * cellCount, cellCount).transportStep, 0);
  }

  for (const cellCount of [0, 2, 8, 37]) {
    assert.throws(
      () => rubixReadFrame("snake", 0, cellCount),
      /positive integer square/,
    );
  }
});

test("Rubix page exposes the cube gestures, three visible lanes, and release asset", async () => {
  const [html, css, app, image] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix.css", root), "utf8"),
    readFile(new URL("rubix-app.js", root), "utf8"),
    stat(new URL("assets/instruments/rubix.webp", root)),
  ]);

  assert.match(html, /<canvas[^>]+id="stage"[^>]+role="application"/s);
  assert.doesNotMatch(html, /id="twistMode"/);
  assert.doesNotMatch(html, /id="orbitMode"/);
  assert.match(html, /drag empty space to orbit/i);
  assert.match(html, /id="moveLeft"/);
  assert.match(html, /id="moveRight"/);
  assert.match(html, /id="moveUp"/);
  assert.match(html, /id="moveDown"/);
  assert.match(html, /data-read-mode="parallel"[^>]+aria-pressed="true"/);
  assert.match(html, /data-read-mode="snake"/);
  assert.match(
    html,
    /data-read-mode="face"[^>]*>[\s\S]*?<b>Alternate faces<\/b>/,
  );
  assert.match(html, /upper visible face is one acid lane/i);
  assert.match(html, /hidden stickers are silent/i);
  assert.match(html, /src="rubix-app\.js"/);
  const clockPosition = html.indexOf('data-section="play"');
  const playPosition = html.indexOf('id="playButton"');
  const movesPosition = html.indexOf('data-section="form"');
  const acidPosition = html.indexOf('data-section="sound"');
  const drumsPosition = html.indexOf('data-section="output"');
  const scorePosition = html.indexOf('data-section="mapping"');
  assert.ok(clockPosition < playPosition && playPosition < movesPosition);
  assert.ok(movesPosition < acidPosition && acidPosition < drumsPosition && drumsPosition < scorePosition);
  assert.doesNotMatch(html.slice(0, clockPosition), /id="playButton"/);
  assert.match(css, /\.rubix-stage-wrap/);
  assert.match(css, /\.rubix-clock-transport/);
  assert.match(css, /\.rubix-read-modes/);
  assert.match(css, /\.rubix-mini-face/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /from "\.\/src\/rubix\.js"/);
  assert.match(app, /rubixReadFrame/);
  assert.match(app, /rubixLayersForSize/);
  assert.match(app, /createRubixVisibilityProfile/);
  assert.match(app, /rubixVisibilityGain/);
  assert.match(app, /warpRubixSurfacePoint/);
  assert.match(app, /pyramid:[\s\S]*surface: "pyramid"/);
  assert.match(app, /sphere:[\s\S]*surface: "sphere"/);
  assert.match(app, /DEFAULT_FM_DRUM_VOICES/);
  assert.match(app, /scheduleAcid/);
  assert.match(app, /scheduleDrum/);
  assert.doesNotMatch(app, /\$\("(?:twistMode|orbitMode)"\)/);
  assert.doesNotMatch(app, /\bsetGestureMode\b|state\.gestureMode/);
  assert.doesNotMatch(html, /\bcube12\b|12\s*[×x]\s*12/i);
  assert.doesNotMatch(app, /\bcube12\b|12\s*[×x]\s*12/i);

  const geometryDefinitions = sourceSection(app, "const GEOMETRIES", "const DEFAULTS");
  const cubeDefinitions = [...geometryDefinitions.matchAll(
    /\bcube(\d+)\s*:\s*Object\.freeze\s*\(\s*\{([^}]*)\}\s*\)/g,
  )].map((match) => ({
    idSize: Number(match[1]),
    declaredSize: Number(match[2].match(/\bsize\s*:\s*(\d+)\b/)?.[1]),
    surface: match[2].match(/\bsurface\s*:\s*"([^"]+)"/)?.[1],
  }));
  assert.deepEqual(
    cubeDefinitions.map(({ idSize }) => idSize).sort((first, second) => first - second),
    [2, 3, 4, 5, 6],
    "selectable cube geometry should cover 2 × 2 through 6 × 6 and stop there",
  );
  assert.ok(cubeDefinitions.every(({ idSize, declaredSize }) => idSize === declaredSize));
  assert.ok(cubeDefinitions.every(({ surface }) => surface === "cube"));

  const percEngineDefinitions = sourceSection(
    app,
    "const PERC_ENGINES",
    "const READ_MODE_DESCRIPTIONS",
  );
  const defaultsDefinition = sourceSection(app, "const DEFAULTS", "const RUBIX_PRESETS");
  const presetDefinitions = sourceSection(app, "const RUBIX_PRESETS", "function cloneVector");
  const registeredPercEngines = new Set(
    [...percEngineDefinitions.matchAll(/\bid\s*:\s*"([^"]+)"/g)]
      .map((match) => match[1]),
  );
  const defaultPercEngine = defaultsDefinition.match(/\bpercEngine\s*:\s*"([^"]+)"/)?.[1];
  const presetPercEngines = new Set([
    defaultPercEngine,
    ...[...presetDefinitions.matchAll(/\bpercEngine\s*:\s*"([^"]+)"/g)]
      .map((match) => match[1]),
  ]);
  for (const requiredEngine of ["soft-fm", "analog", "modal", "noise"]) {
    assert.ok(registeredPercEngines.has(requiredEngine));
  }
  for (const engine of registeredPercEngines) {
    assert.ok(
      presetPercEngines.has(engine),
      `the preset collection should demonstrate the ${engine} percussion engine`,
    );
  }
  const presetGeometryIds = [...presetDefinitions.matchAll(/\bgeometryId\s*:\s*"([^"]+)"/g)]
    .map((match) => match[1]);
  for (const geometryId of presetGeometryIds) {
    assert.match(
      geometryDefinitions,
      new RegExp(`\\b${geometryId}\\s*:`),
      `preset geometry ${geometryId} should be registered`,
    );
  }
  for (const representative of ["cube2", "cube3", "cube4", "pyramid", "sphere"]) {
    assert.ok(
      presetGeometryIds.includes(representative),
      `${representative} should be represented by a preset`,
    );
  }

  const listenerEvents = (id) => [...app.matchAll(new RegExp(
    `\\$\\(\\s*["']${id}["']\\s*\\)\\.addEventListener\\(\\s*["']([^"']+)["']`,
    "g",
  ))].map((match) => match[1]);
  assert.deepEqual(listenerEvents("percEngine"), ["change"]);
  assert.deepEqual(listenerEvents("rubixPreset"), ["change"]);
  assert.deepEqual(listenerEvents("randomTwists"), ["click"]);
  assert.deepEqual(listenerEvents("solveCube"), ["click"]);
  assert.deepEqual(listenerEvents("resetSound"), ["click"]);
  const solveCubeAction = sourceSection(app, "function solveCube", "function resetSound");
  assert.match(solveCubeAction, /createSolvedRubixCube/);
  assert.match(solveCubeAction, /stopRandomTwists\(false\)/);
  assert.doesNotMatch(solveCubeAction, /SOUND_DEFAULTS|DEFAULT_RUBIX_CAMERA|audio\.updateSettings/);
  const resetSoundAction = sourceSection(app, "function resetSound", "function pointFromEvent");
  assert.match(resetSoundAction, /Object\.assign\(state, SOUND_DEFAULTS\)/);
  assert.doesNotMatch(resetSoundAction, /state\.cube|state\.camera|moveHistory|stopRandomTwists/);
  const soundDefaults = sourceSection(app, "const SOUND_DEFAULTS", "const RUBIX_PRESETS");
  assert.doesNotMatch(soundDefaults, /randomTwists|randomTwistTempo/);
  const randomTwistTempoBindings = [
    ...app.matchAll(/\bbindRange\s*\(\s*["']randomTwistTempo["']/g),
    ...app.matchAll(
      /\$\(\s*["']randomTwistTempo["']\s*\)\.addEventListener\s*\(/g,
    ),
  ];
  assert.equal(
    randomTwistTempoBindings.length,
    1,
    "random twist tempo should have one input binding",
  );

  const pointerDown = sourceSection(
    app,
    'canvas.addEventListener("pointerdown"',
    'canvas.addEventListener("pointermove"',
  );
  assert.match(
    pointerDown,
    /(?:!hit\s*\?\s*"orbit"\s*:\s*"twist"|hit\s*\?\s*"twist"\s*:\s*"orbit")/,
    "dragging empty stage space should orbit without a separate Orbit toggle",
  );

  assert.match(app, /let\s+randomTwistTimer\s*=\s*null/);
  assert.match(app, /function\s+startRandomTwists\b/);
  assert.match(app, /function\s+stopRandomTwists\b/);
  const randomTwistSchedule = sourceSection(
    app,
    "function scheduleRandomTwists",
    "function startRandomTwists",
  );
  assert.match(randomTwistSchedule, /setTimeout\s*\(/);
  assert.match(randomTwistSchedule, /state\.randomTwistTempo/);
  assert.match(randomTwistSchedule, /beginTurn\s*\(/);
  assert.doesNotMatch(
    randomTwistSchedule,
    /state\.tempo\b/,
    "random twists should use their own tempo rather than sequencer tempo",
  );

  const pointerMove = sourceSection(
    app,
    'canvas.addEventListener("pointermove"',
    "function endPointerGesture",
  );
  const orbitBranch = sourceSection(
    pointerMove,
    'pointerGesture.kind === "orbit"',
    "return;",
  );
  assert.match(
    orbitBranch,
    /refreshOrbitPerformanceSnapshot\s*\(\s*\)/,
    "orbit drags should refresh the audible snapshot before pointerup",
  );
  const previewPosition = pointerMove.indexOf("previewTurn");
  const auditionPosition = pointerMove.indexOf("auditionTurn", previewPosition);
  assert.ok(previewPosition >= 0, "twist pointermove should build a live preview");
  assert.ok(
    auditionPosition > previewPosition,
    "twist pointermove should audition its preview before pointerup",
  );

  assert.match(app, /\bperformanceSnapshots\b/);
  const auditionTurn = sourceSection(
    app,
    "function auditionTurn",
    "function refreshOrbitPerformanceSnapshot",
  );
  assert.match(auditionTurn, /setPerformanceSnapshots\s*\(/);
  const orbitRefresh = sourceSection(
    app,
    "function refreshOrbitPerformanceSnapshot",
    "function performanceEventsForRole",
  );
  assert.match(orbitRefresh, /setPerformanceSnapshots\s*\(/);
  const beginTurn = sourceSection(app, "function beginTurn", "function finishTurnAnimation");
  assert.match(beginTurn, /auditionTurn\s*\(\s*move\s*\)/);
  const liveEvents = sourceSection(
    app,
    "function performanceEventsForRole",
    "function schedulerTick",
  );
  assert.match(liveEvents, /for\s*\([^)]*\bperformanceSnapshots\b[^)]*\)/);
  assert.match(liveEvents, /new\s+Map\s*\(/, "live candidates should be deduplicated");
  assert.match(liveEvents, /\.set\s*\(\s*(?:event\.)?sticker\.id\b/);
  const scheduler = sourceSection(app, "function schedulerTick", "function clearVisualTimers");
  assert.match(
    scheduler,
    /const\s+beatDuration\s*=\s*sixteenthDurationSeconds\s*\(\s*\)/,
    "alternate faces should retain the parent beat duration",
  );
  assert.match(
    scheduler,
    /const\s+stepDuration\s*=\s*beatDuration\s*\/\s*subdivisionsPerBeat/,
    "alternate faces should fit its three transport subdivisions inside one base beat",
  );
  assert.match(
    scheduler,
    /scheduleAcid\s*\([\s\S]*?nextStepTime\s*,\s*beatDuration\s*,/,
    "acid articulation should last for the parent beat rather than one short subdivision",
  );
  assert.match(
    scheduler,
    /if\s*\(\s*\(frame\.transportStep\s*\+\s*1\)\s*%\s*subdivisionsPerBeat\s*===\s*0\s*\)\s*nextSwingStep\s*\+=\s*1/,
    "swing should advance by base beat rather than once per face subdivision",
  );
  assert.match(
    scheduler,
    /performanceEventsForRole\s*\(/,
    "the scheduler should consume live performance snapshots through the deduped event helper",
  );
  assert.ok(image.size > 1000);
});
