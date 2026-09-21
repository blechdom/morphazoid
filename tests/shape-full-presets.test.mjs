import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import {
  createShapeInitialState, SHAPE_LIVE_STATE_KEYS, SHAPE_PRESET_PARAMETER_KEYS,
  SHAPE_FULL_PRESETS, validateShapePresetParameters,
  captureShapePresetParameters, applyShapePresetParameters,
} from "../src/instruments/shape-synth/full-presets.js";
import { buildShape, pingPong01, wrap01 } from "../src/geometry.js";
import { validateFullPresetBank, presetStateKey } from "../src/site/header-presets.js";

const copy = value => JSON.parse(JSON.stringify(value));

test("Shape startup retains every original default and creates private mutable arrays", async () => {
  const original = JSON.parse(await readFile(new URL("./fixtures/shape-before-header-presets.json", import.meta.url)));
  assert.deepEqual(createShapeInitialState(), original.state);
  assert.deepEqual(createShapeInitialState(11), { ...original.state, sides: 11 });
  const a = createShapeInitialState(), b = createShapeInitialState();
  a.headOffsets[0] = 0.3;
  a.amplitudeEnvelopePoints[0].y = 0.1;
  a.scanLineAxes[0] = "horizontal";
  assert.deepEqual(b, original.state);
  assert.equal(b.playing, false, "page load is still motion-off; registering a bank does not apply it");
  assert.equal(b.autoRotate, false);
  assert.equal(b.audio, false);
  assert.deepEqual(SHAPE_FULL_PRESETS[0].snapshot.parameters,
    { ...captureShapePresetParameters(b), playing: true },
    "Original study retains the original sound with its now-explicit Playhead-on setting");
});

test("Shape's 36 complete presets cover reader, motion, geometry, spacing, and synthesis families", () => {
  validateFullPresetBank(SHAPE_FULL_PRESETS);
  const parameters = SHAPE_FULL_PRESETS.map(preset => preset.snapshot.parameters);
  assert.equal(parameters.length, 36);
  assert.deepEqual(new Set(parameters.map(p => p.soundMode)), new Set(["sine", "fm", "pm", "percussion", "shepard"]));
  assert.deepEqual(new Set(parameters.map(p => p.playMethod)), new Set(["trace", "scan", "radial"]));
  assert.deepEqual(new Set(parameters.map(p => p.motionMode)), new Set(["loop", "pingpong"]));
  assert.ok(parameters.some(p => p.sides === 1));
  assert.ok(parameters.some(p => p.sides === 2));
  assert.ok(parameters.some(p => p.closedShapeType === "star"));
  assert.ok(parameters.some(p => p.shepardMapping === "turn"));
  assert.ok(parameters.some(p => p.scanLineAxes.includes("horizontal")));
  assert.ok(parameters.some(p => p.radialHeadDirections.includes(-1)));
  assert.ok(parameters.some(p => p.speed >= 1.8));
  assert.ok(parameters.some(p => p.speed < 0.1));
  assert.deepEqual(new Set(parameters.map(p => `${p.playing}:${p.autoRotate}`)),
    new Set(["true:false", "true:true", "false:true"]));
  assert.ok(parameters.some(p => p.heads === 12));
  assert.ok(parameters.some(p => p.sides === 32));
  assert.ok(parameters.some(p => p.rotationMotionMode === "pingpong"));
  assert.ok(parameters.some(p => p.traversalDirection < 0 && p.rotationDirection > 0));
  const unequal = parameters.filter(p => p.headOffsets.some((offset, i) => Math.abs(offset - i / p.heads) > 1e-9));
  assert.ok(unequal.length >= 24, "many deliberately authored nonuniform head layouts");
  const gapShapes = new Set(unequal.map(p => JSON.stringify(p.headOffsets.map((offset, i) =>
    Number(((p.headOffsets[(i + 1) % p.heads] - offset + 1) % 1).toFixed(4))))));
  assert.ok(gapShapes.size >= 20, "spacing variety cannot just rotate the same equal layout");
  for (const p of parameters) {
    validateShapePresetParameters(p);
    assert.deepEqual(Object.keys(p).sort(), [...SHAPE_PRESET_PARAMETER_KEYS].sort());
    assert.ok(SHAPE_LIVE_STATE_KEYS.every(key => !Object.hasOwn(p, key)));
    const shape = buildShape({ ...p, rotationDeg: 21, samplesPerEdge: 12 });
    assert.ok(shape.points.length > 0);
    assert.ok(shape.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
});

test("preset recall restores both motion switches without arming Audio or rewinding phases", () => {
  for (const preset of SHAPE_FULL_PRESETS) {
    const state = createShapeInitialState();
    Object.assign(state, {
      audio: true, playing: true, autoRotate: true,
      position: 0.37, continuousPosition: 24.37,
      rotation: 42, continuousRotation: 7 + 42 / 360,
    });
    const expected = copy(preset.snapshot.parameters);
    applyShapePresetParameters(state, preset.snapshot.parameters);
    assert.deepEqual(captureShapePresetParameters(state), expected);
    assert.equal(state.audio, true);
    assert.equal(state.playing, expected.playing);
    assert.equal(state.autoRotate, expected.autoRotate);
    assert.equal(state.position, 0.37);
    assert.equal(state.rotation, 42);
    const displayedAngle = state.rotationMotionMode === "pingpong"
      ? pingPong01(state.continuousRotation) * 360 - 180
      : ((state.continuousRotation * 360 + 180) % 360 + 360) % 360 - 180;
    assert.ok(Math.abs(displayedAngle - 42) < 1e-10, "rotation mode changes preserve the visible angle");
    const physical = state.motionMode === "pingpong" ? pingPong01(state.continuousPosition) : wrap01(state.continuousPosition);
    assert.ok(Math.abs(physical - state.position) < 1e-12);
    for (const method of ["trace", "radial"]) {
      for (let index = 0; index < 12; index++) {
        const travel = state[`${method}HeadDirections`][index] * state.continuousPosition
          + state[`${method}HeadDirectionAdjustments`][index];
        assert.ok(Math.abs(travel - 24.37) < 1e-12, `${method}/${index}: preserved head travel`);
      }
    }
    state.headOffsets[0] = 0.2;
    state.pitchCurveNodes[1].y = 0.7;
    assert.deepEqual(preset.snapshot.parameters, expected, "live arrays cannot corrupt a factory preset");
    const silent = createShapeInitialState();
    applyShapePresetParameters(silent, preset.snapshot.parameters);
    assert.equal(silent.audio, false);
    assert.equal(silent.playing, expected.playing, "visual motion can start with Audio still off");
    assert.equal(silent.autoRotate, expected.autoRotate);
  }
});

test("full recall is order-independent after edited curves, head layouts, and motion changes", () => {
  const state = createShapeInitialState();
  for (const a of SHAPE_FULL_PRESETS) {
    applyShapePresetParameters(state, a.snapshot.parameters);
    const before = captureShapePresetParameters(state);
    state.fmRatio = 7.75;
    state.amplitudeEnvelopePoints[1].y = 0.2;
    state.percussionEnvelopePoints[2].y = 0.9;
    state.headOffsets = state.headOffsets.map(() => 0.12);
    state.playing = !state.playing;
    state.autoRotate = !state.autoRotate;
    for (const b of SHAPE_FULL_PRESETS) {
      applyShapePresetParameters(state, b.snapshot.parameters);
      applyShapePresetParameters(state, a.snapshot.parameters);
      assert.deepEqual(captureShapePresetParameters(state), before);
    }
  }
});

test("invalid Shape scenes fail before changing live parameters or transport state", () => {
  const invalid = [
    p => { delete p.pmRatio; },
    p => { delete p.playing; },
    p => { delete p.autoRotate; },
    p => { p.playing = "true"; },
    p => { p.autoRotate = 1; },
    p => { p.audio = true; },
    p => { p.level = Infinity; },
    p => { p.fmRatio = 0; },
    p => { p.heads = 3.5; },
    p => { p.scanLineAxes = []; },
    p => { p.headOffsets[0] = 1; },
    p => { p.pitchCurveNodes[2].y = NaN; },
    p => { p.amplitudeEnvelopePoints[0].x = 0.2; },
    p => { p.soundMode = "unknown"; },
    p => { p.sides = 2; p.shepardMapping = "turn"; },
  ];
  for (const mutate of invalid) {
    const state = createShapeInitialState();
    const before = copy(state);
    const parameters = copy(SHAPE_FULL_PRESETS[0].snapshot.parameters);
    mutate(parameters);
    assert.throws(() => applyShapePresetParameters(state, parameters), /Invalid complete Shape preset/);
    assert.deepEqual(state, before);
  }
});

test("advancing the transport does not mislabel a selected musical preset as Custom", () => {
  const state = createShapeInitialState();
  applyShapePresetParameters(state, SHAPE_FULL_PRESETS[0].snapshot.parameters);
  const before = presetStateKey(captureShapePresetParameters(state));
  Object.assign(state, {
    audio: true,
    position: 0.5, continuousPosition: 128.5,
    rotation: -62, continuousRotation: 21.83,
  });
  state.traceHeadDirectionAdjustments[0] = 256;
  assert.equal(presetStateKey(captureShapePresetParameters(state)), before);
  state.speed = 0.4;
  assert.notEqual(presetStateKey(captureShapePresetParameters(state)), before);
});

test("manual Playhead/Rotate changes now mark a complete preset as custom", () => {
  for (const key of ["playing", "autoRotate"]) {
    const state = createShapeInitialState();
    applyShapePresetParameters(state, SHAPE_FULL_PRESETS[0].snapshot.parameters);
    const before = presetStateKey(captureShapePresetParameters(state));
    state[key] = !state[key];
    assert.notEqual(presetStateKey(captureShapePresetParameters(state)), before, key);
    applyShapePresetParameters(state, SHAPE_FULL_PRESETS[0].snapshot.parameters);
    assert.equal(presetStateKey(captureShapePresetParameters(state)), before);
  }
});

test("all requested retained scene IDs remain, without the removed Sweet orbit, in a stable mixed order", () => {
  const originalIds = [
    "square-study", "triangle-pad", "glass-star",
    "crossed-scanners", "opposed-radar", "low-corner-kit", "star-sprint",
    "endless-climb", "folded-shepard", "bowed-line", "crooked-radar",
  ];
  const ids = SHAPE_FULL_PRESETS.map(p => p.id);
  assert.equal(new Set(ids).size, 36);
  assert.equal(ids.includes("soft-orbit"), false);
  assert.equal(ids[0], "square-study");
  for (const id of originalIds) assert.ok(ids.includes(id), id);
  assert.equal(ids.filter(id => !originalIds.includes(id)).length, 25);
  const opening = SHAPE_FULL_PRESETS.slice(0, 8);
  assert.equal(opening.filter(p => !originalIds.includes(p.id)).length, 6);
  assert.ok(new Set(opening.map(p => p.snapshot.parameters.soundMode)).size >= 4);
  assert.ok(new Set(opening.map(p => p.snapshot.parameters.playMethod)).size === 3);
  assert.equal(ids.includes("hands-on-sketch"), false, "owner removed the paused preset, not the manual pause controls");
  assert.ok(SHAPE_FULL_PRESETS.every(p => p.snapshot.parameters.playing || p.snapshot.parameters.autoRotate));
  assert.ok(SHAPE_FULL_PRESETS.every(p => /Playhead (on|off); rotation (on|off)/.test(p.description)));
  assert.ok(Object.isFrozen(SHAPE_FULL_PRESETS));
  assert.ok(SHAPE_FULL_PRESETS.every(p => Object.isFrozen(p.snapshot.parameters.headOffsets)));
});

test("the real Shape preset adapter updates button states and audio-safe start/stop exactly once", async () => {
  const app = await readFile(new URL("../src/instruments/shape-synth/shape-synth-app.js", import.meta.url), "utf8");
  const declaration = parse(app, { sourceType: "module", ecmaVersion: "latest" }).body
    .find(node => node.type === "FunctionDeclaration" && node.id.name === "applyShapeFullPreset");
  assert.ok(declaration);
  const functionSource = app.slice(declaration.start, declaration.end);
  // Execute the authored adapter against a minimal I/O harness. Pure scene
  // application is real; graphics/readout painters are inert here. This is
  // control-flow evidence, not browser/audio-output measurement.
  const readoutFunctions = [
    "syncFormTopology", "setPlayMethod", "setMotionMode", "setRotationMotionMode",
    "setRotationDirection", "setTraversalDirection", "setSoundMode", "setPitchDimension",
    "setStereoDimension", "renderPitchCurve", "updateAmplitudeUi", "updatePercussionUi",
    "updateShepardMappingUi", "updateCornerAmplitudeMappingUi", "updateTimbreMappingUi",
    "updateHeadsOutput", "updateLineControls", "updatePlayheadReadouts", "updateCanvasLabel",
  ];
  for (const preset of SHAPE_FULL_PRESETS) {
    for (const [playing, autoRotate] of [[false, false], [true, false], [false, true], [true, true]]) {
      for (const audio of [false, true]) {
        const state = createShapeInitialState();
        Object.assign(state, { audio, playing, autoRotate, position: 0.37, continuousPosition: 4.37 });
        const nodes = new Map();
        const $ = id => {
          if (!nodes.has(id)) nodes.set(id, {
            attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); },
          });
          return nodes.get(id);
        };
        const effects = { silence: 0, level: null, frame: 0, corners: 0 };
        const pool = {
          context: audio ? { currentTime: 64 } : null,
          setLevel(value) { effects.level = value; },
          silence() { effects.silence++; },
        };
        const context = vm.createContext({
          state, applyShapePresetParameters, $, pool, rangeDisplays: new Map(),
          setPressed: (node, pressed) => node.setAttribute("aria-pressed", String(pressed)),
          sliderFromSpeed: value => value,
          ...Object.fromEntries(readoutFunctions.map(name => [name, () => {}])),
          performance: { now: () => 2000 },
          lastFrameTime: 1000, lastAudioClockTime: 12,
          lastAudioUpdate: 10, pendingCornerStrikes: [{ key: "old" }],
          resetCornerTracking() { effects.corners++; },
          invalidate() { effects.frame++; },
          snapshot: preset.snapshot,
        });
        vm.runInContext(`${functionSource}; applyShapeFullPreset(snapshot);`, context);
        const next = preset.snapshot.parameters;
        assert.deepEqual(captureShapePresetParameters(state), next);
        assert.equal(state.audio, audio);
        assert.equal($("playButton").attributes["aria-pressed"], String(next.playing));
        assert.equal($("rotationPlayButton").attributes["aria-pressed"], String(next.autoRotate));
        const startingMotion = !playing && !autoRotate && (next.playing || next.autoRotate);
        assert.equal(context.lastFrameTime, startingMotion ? 2000 : 1000);
        assert.equal(context.lastAudioClockTime, startingMotion ? audio ? 64 : null : 12);
        assert.equal(effects.silence, !next.playing && !next.autoRotate || next.soundMode !== "sine" ? 1 : 0);
        assert.equal(effects.level, next.level);
        assert.equal(effects.frame, 1);
        assert.equal(effects.corners, 1);
        assert.equal(context.pendingCornerStrikes.length, 0);
        assert.equal(context.lastAudioUpdate, -Infinity);
      }
    }
  }
});
