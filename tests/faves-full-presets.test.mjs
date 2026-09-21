import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "acorn";
import { FAVES_PRESET_CASES } from "./helpers/faves-preset-cases.mjs";
import { FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";
import { validateFullPresetBank, presetStateKey } from "../src/site/header-presets.js";
import { clonePresetData } from "../src/site/preset-random.js";
import { createSolidInitialState, createHyperInitialState, captureGeometryPreset, validateGeometryPreset } from "../src/families/geometry-presets/full-presets.js";
import { createAmplitudeControl } from "../src/amplitude-control.js";
import { createHybrinxGestureStore, normalizeHybrinxPresetGesture, applyHybrinxTimelinePerformance } from "../src/instruments/hybrinx/hybrinx-timeline.js";
import { CALL_GESTURES, animalState, sanitizeSyrinxState, interpolateGesture, modulateSyrinxState, resolveGestureTimeline } from "../src/families/syrinx/syrinx.js";
import { DEFAULT_TONGUE_STATE, sanitizeTongueState } from "../src/families/syrinx/tongue-physics.js";
import { captureHybrinxPreset, validateHybrinxFullPreset, HYBRINX_FULL_PRESETS, randomizeHybrinxPreset } from "../src/families/syrinx/full-presets.js";
import { RUBIX_FACTORY_PRESETS, RUBIX_DEFAULTS } from "../src/instruments/rubix/factory-presets.js";
import { RUBIX_PRESET_SETTING_KEYS } from "../src/instruments/rubix/full-presets.js";
import { rubixSimdPreset } from "../src/instruments/rubix/rubix-simd-presets.js";
import { HYPER_RUBIX_PRESET_DEFAULTS } from "../src/instruments/hyper-rubix/preset-state.js";
import { DEFAULT_L_SYSTEM_STATE, DEFAULT_MICMIC_STATE } from "../src/families/branch-presets/initial-state.js";
import { GRAPH_DELAY_INITIAL_STATE } from "../src/families/graph-presets/initial-state.js";
import { createLatticeInitialState } from "../src/instruments/lattice/initial-state.js";
import { parseRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const level = snapshot => snapshot.parameters?.level ?? snapshot.parameters?.output ?? snapshot.settings?.output ?? snapshot.state?.level;
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("startup retains original settings with voice caps equal to the previous fixed renderer limits", async () => {
  const before = JSON.parse(await readFile(new URL("./fixtures/faves-startup-before-presets.json", import.meta.url), "utf8"));
  assert.deepEqual({
    solid: createSolidInitialState(), hyper: createHyperInitialState(), lattice: createLatticeInitialState(),
    lSystem: DEFAULT_L_SYSTEM_STATE, micmic: DEFAULT_MICMIC_STATE, graphDelay: GRAPH_DELAY_INITIAL_STATE,
    rubix: RUBIX_DEFAULTS, hyperRubix: HYPER_RUBIX_PRESET_DEFAULTS,
  }, {
    ...before,
    solid: { ...before.solid, voiceLimit: 32 },
    hyper: { ...before.hyper, voiceLimit: 20 },
    rubix: { ...before.rubix, ...rubixSimdPreset().controls, acidEngine: "simd-303", simdPreset: "color-circuit", simdPresetCustom: false, visibilityDynamics: 1 },
  });
  const lattice = FAVES_PRESET_CASES.find(entry => entry.id === "lattice").bank[0].snapshot.parameters;
  const { audio, playing, position, continuousPosition, ...originalLatticeParameters } = before.lattice;
  assert.deepEqual(lattice, originalLatticeParameters, "Original net must retain the actual original sound parameters");
});

test("the implemented batches cover current Faves and retain tests for the demoted geometry instruments", () => {
  const implemented = new Set([...FAVES_PRESET_CASES.map(p => p.id), "shape-synth", "shapes", "hiccup-head", "creaturazoid"]);
  assert.ok(FAVE_TOOL_IDS.every(id => implemented.has(id)));
  assert.equal(FAVE_TOOL_IDS[0], "shapes");
  assert.ok(["shape-synth", "solid-synth", "hyper-synth"].every(id => !FAVE_TOOL_IDS.includes(id)));
  assert.equal(FAVES_PRESET_CASES.reduce((sum, item) => sum + item.bank.length, 0), 172);
});
test("dice preserves a muted master on every newly migrated instrument", () => {
  for (const entry of FAVES_PRESET_CASES) {
    if (entry.id === "rubix") {
      for (const key of ["output", "acidLevel", "drumLevel"]) assert.equal(RUBIX_PRESET_SETTING_KEYS.includes(key), false, `${key} stays live`);
      continue;
    }
    const current = clonePresetData(entry.bank[0].snapshot);
    const parameters = current.parameters ?? current.settings ?? current.state;
    parameters[Object.hasOwn(parameters, "output") ? "output" : "level"] = 0;
    const result = entry.randomize(current, seeded(0x811c9dc5));
    assert.equal(level(result), 0, entry.id);
    entry.validate(result);
  }
});
for (const entry of FAVES_PRESET_CASES) {
  test(`${entry.id}: every authored scene is distinct, complete, finite and valid`, () => {
    validateFullPresetBank(entry.bank);
    for (const preset of entry.bank) {
      assert.doesNotThrow(() => entry.validate(preset.snapshot), preset.id);
      assert.equal(presetStateKey(JSON.parse(presetStateKey(preset.snapshot))), presetStateKey(preset.snapshot));
      assert.ok(preset.description.length > 40);
    }
  });
  test(`${entry.id}: seeded dice generates parameter states without mutating factories or raising master output`, () => {
    const source = presetStateKey(entry.bank), results = new Set(), factory = new Set(entry.bank.map(p => presetStateKey(p.snapshot)));
    for (let index = 1; index <= 36; index++) {
      const current = freeze(clonePresetData(entry.bank[index % entry.bank.length].snapshot));
      const snapshot = entry.randomize(current, seeded(index * 7919));
      assert.deepEqual(snapshot, entry.randomize(current, seeded(index * 7919)), "repeatable seed");
      entry.validate(snapshot);
      assert.equal(level(snapshot), level(current), "master level is protected");
      const key = presetStateKey(snapshot);
      assert.ok(!factory.has(key), "not a random preset selector");
      results.add(key);
    }
    assert.equal(results.size, 36);
    assert.equal(presetStateKey(entry.bank), source);
  });
  test(`${entry.id}: dice covers musical controls, not just a few preset multipliers`, () => {
    const seen = new Map();
    // One continuing stream mirrors repeated clicks. Restarting a linear RNG
    // at arithmetically spaced seeds can correlate a particular draw position.
    const random = seeded(0x51c0ffee);
    for (let i = 1; i <= 64; i++) {
      const s = entry.randomize(entry.bank[0].snapshot, random);
      const parameters = s.parameters ?? s.settings ?? s.state;
      for (const [key, value] of Object.entries(parameters)) {
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key).add(presetStateKey(value));
      }
    }
    const protectedOrMetadata = new Set(["level", "output", "acidEngine", "simdPresetCustom", "generationPreset", "label", "branching", "graphPatch", "percussionStyle"]);
    const unchanged = [...seen].filter(([key, values]) => values.size === 1 && !protectedOrMetadata.has(key)).map(([key]) => key);
    assert.deepEqual(unchanged, [], `Unintentionally frozen controls: ${unchanged.join(", ")}`);
  });
}

test("Rubix keeps all five old performance presets' settings while adding full score/voice snapshots", () => {
  const { bank } = FAVES_PRESET_CASES.find(p => p.id === "rubix");
  for (const preset of Object.values(RUBIX_FACTORY_PRESETS)) {
    const full = bank.find(p => p.id === preset.id).snapshot;
    const expected = { ...RUBIX_DEFAULTS, ...preset.settings };
    expected.simdPresetCustom = Object.entries(rubixSimdPreset(expected.simdPreset).controls).some(([key, value]) => expected[key] !== value);
    assert.deepEqual(full.settings, Object.fromEntries(RUBIX_PRESET_SETTING_KEYS.map(key => [key, expected[key]])));
    assert.equal(full.cube.size, preset.size);
    assert.equal(full.shapeId, preset.shapeId);
    assert.equal(full.readingMode, preset.readingMode);
  }
});

test("Hybrinx whole-scene gesture replacement preserves other session edits and ignores only revision counters", () => {
  const store = createHybrinxGestureStore(CALL_GESTURES);
  store.setDuration("raven-croak", 900);
  const retained = normalizeHybrinxPresetGesture(store.get("raven-croak"));
  const preset = FAVES_PRESET_CASES.find(p => p.id === "hybrinx").bank.find(p => p.id === "velvet-coo");
  const { gesture } = preset.snapshot;
  store.replace(gesture.id, gesture);
  assert.deepEqual(normalizeHybrinxPresetGesture(store.get(gesture.id)), gesture);
  assert.deepEqual(normalizeHybrinxPresetGesture(store.get("raven-croak")), retained);
  assert.throws(() => store.replace("raven-croak", gesture), /identity/);
});

test("Hybrinx's actual adapter and performance update recall clips without treating their live highlight as preset state", async () => {
  const source = await readFile(new URL("../src/families/syrinx/syrinx-app.js", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  const registration = ast.body.find(node => node.type === "IfStatement" && node.test.name === "HYBRINX_MODE").consequent.expression.arguments[0];
  const performance = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "updatePerformance");
  for (const playing of [false, true]) for (const preset of HYBRINX_FULL_PRESETS) {
    const store = createHybrinxGestureStore(CALL_GESTURES);
    let posts = 0;
    const context = vm.createContext({
      HYBRINX_MODE: true, TONGUE_MODE: true, UI_MODE: true,
      state: animalState("raven", { biologicalLock: false }), tongueState: { ...DEFAULT_TONGUE_STATE },
      performanceState: {}, performanceTongueState: {}, tongueArticulation: {},
      tongueMotionId: "", tongueMotionStartTime: 0, IDLE_TONGUE_ARTICULATION: { active: false },
      gesturePlaying: playing, gesturePhase: 0.35, gestureStartTime: 0, loopGapRemainingMs: 0,
      audioDirty: false, lastConfigurationTime: -Infinity, manualBreath: false,
      modulators: clonePresetData(preset.snapshot.modulators), hybrinxGestureStore: store,
      performance: { now: () => 10000 },
      HYBRINX_FULL_PRESETS, randomizeHybrinxPreset, captureHybrinxPreset, validateHybrinxFullPreset,
      sanitizeSyrinxState, sanitizeTongueState, interpolateGesture, modulateSyrinxState,
      resolveGestureTimeline, applyHybrinxTimelinePerformance,
      parameterModulatorsFor: () => [], hasActiveParameterModulators: () => false,
      activeGesture: () => store.get(context.state.callId),
      setHybrinxTonguePatternPresentation(id) { context.tongueMotionId = id; },
      updateAnimalPresentation() {}, updateModulationPresentation() {}, updateHybrinxTimeline() {},
      updatePerformancePresentation() {}, setGesturePresentation() {},
      postConfiguration() { posts++; },
      stopPerformance() { assert.fail("Looping preset recall must not stop the call player"); },
    });
    vm.runInContext(source.slice(performance.start, performance.end), context);
    const adapter = vm.runInContext(`(${source.slice(registration.start, registration.end)})`, context);
    adapter.apply(clonePresetData(preset.snapshot));
    assert.equal(presetStateKey(adapter.capture()), presetStateKey(preset.snapshot), preset.id);
    assert.equal(context.gesturePlaying, playing);
    if (playing) assert.ok(Math.abs(context.gesturePhase - 0.35) < 1e-8);
    else assert.equal(context.tongueMotionId, "", "paused transport has no active clip highlight");
    assert.ok(posts > 0);
  }
});

for (const kind of ["solid", "hyper"]) {
  test(`${kind}: actual adapter recalls requested motions, keeps Audio, and centers only fixed slices`, async () => {
    const source = await readFile(new URL(`../src/instruments/${kind}-synth/${kind}-synth-app.js`, import.meta.url), "utf8");
    const ast = parse(source, { sourceType: "module", ecmaVersion: "latest" });
    const registration = ast.body.find(n => n.type === "ExpressionStatement" && n.expression.callee?.name === "registerHeaderPresets").expression.arguments[0];
    const create = kind === "solid" ? createSolidInitialState : createHyperInitialState;
    const bank = FAVES_PRESET_CASES.find(p => p.id === `${kind}-synth`).bank;
    for (const audio of [false, true]) for (const playing of [false, true]) for (const preset of bank) {
      const state = { ...create(), audio, playing, position: 0.37, continuousPosition: 2.37 };
      const envelope = createAmplitudeControl(null);
      const elements = new Map();
      const $ = id => {
        if (!elements.has(id)) elements.set(id, { value: "", textContent: "", hidden: false, setAttribute() {}, querySelector() { return { textContent: "" }; } });
        return elements.get(id);
      };
      let frames = 0, resets = 0;
      const context = vm.createContext({
        state, amplitudeControl: envelope, $, presetRangeRefreshers: new Map(),
        SOLID_FULL_PRESETS: bank, HYPER_FULL_PRESETS: bank, captureGeometryPreset, validateGeometryPreset,
        randomizeGeometryPreset() {}, motionIsActive: () => state.playing || Object.keys(state).some(key => key.endsWith("Playing") && state[key]),
        rotationIsMoving: () => Object.keys(state).some(key => key.endsWith("Playing") && state[key]),
        SHAPE_LABELS: {}, previousVertexSigns: {}, previousSigns: {}, setPressed() {},
        pool: { setLevel() {}, silence() {} }, resetClocks() { resets++; }, paintMotionControls() {}, paintRotation() {}, scheduleFrame() { frames++; },
      });
      const adapter = vm.runInContext(`(${source.slice(registration.start, registration.end)})`, context);
      adapter.apply(clonePresetData(preset.snapshot));
      assert.equal(presetStateKey(adapter.capture()), presetStateKey(preset.snapshot));
      assert.equal(state.audio, audio);
      assert.equal(state.playing, preset.snapshot.parameters.playing);
      assert.equal(state.position, state.playing ? 0.37 : 0.5);
      assert.equal(state.continuousPosition, state.playing ? 2.37 : 2.5);
      assert.equal(frames, 1);
      if (playing) assert.equal(resets, 0, "running clocks not restarted");
    }
  });
}

test("new runtime files are explicit in the release manifest", async () => {
  const inventory = parseRuntimeManifest(await readFile(new URL("../scripts/site/runtime-files.tsv", import.meta.url), "utf8"));
  for (const path of [
    "src/families/geometry-presets/full-presets.js", "src/families/geometry-presets/initial-state.js",
    "src/instruments/rubix/full-presets.js", "src/instruments/rubix/factory-presets.js",
    "src/families/syrinx/full-presets.js", "src/instruments/jaw-harp/full-presets.js",
    "src/instruments/hyper-rubix/full-presets.js", "src/instruments/hyper-rubix/preset-state.js",
    "src/families/branch-presets/full-presets.js", "src/families/branch-presets/initial-state.js",
    "src/families/graph-presets/full-presets.js", "src/families/graph-presets/initial-state.js",
    "src/families/experiments/automata-presets.js", "src/instruments/lattice/full-presets.js", "src/instruments/lattice/initial-state.js",
  ]) {
    assert.ok(inventory.requiredFiles.includes(path), path);
    assert.ok(inventory.worktreeFiles.includes(path), path);
  }
});

test("new authored choices exist in the real page menus, not just in a permissive model validator", async () => {
  const mappings = {
    "solid-synth": { solidType: "solidType", soundMode: "soundMode" },
    "hyper-synth": { shapeType: "hyperShape", soundMode: "soundMode" },
    "rubix": { shapeId: "shape", readingMode: null, soundBank: "soundBank", acidEngine: "acidEngine" },
    "hyper-rubix": { sequenceMethod: "sequenceMethod", voice: "voice", playbackMode: "playbackMode", decayLink: "decayLink" },
    "l-system": { soundMode: "soundMode", structureMode: "structureMode", pitchSource: "pitchSource" },
    "graph-synth": { soundMode: "soundMode", mappingMode: "mappingMode", tuningMode: "tuningMode", articulation: "articulation" },
    lattice: { soundMode: "soundMode", synthSource: "synthSource", pitchSource: "pitchSource", levelSource: "levelSource" },
  };
  for (const entry of FAVES_PRESET_CASES.filter(item => mappings[item.id])) {
    const html = await readFile(new URL(`../${entry.href}`, import.meta.url), "utf8");
    for (const [key, id] of Object.entries(mappings[entry.id])) {
      if (!id) continue;
      const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
      assert.ok(select, `${entry.id}: ${id}`);
      const values = [...select[1].matchAll(/value="([^"]*)"/g)].map(match => match[1]);
      for (const preset of entry.bank) {
        const snapshot = preset.snapshot;
        const value = snapshot.parameters?.[key] ?? snapshot.settings?.[key] ?? snapshot[key];
        assert.ok(values.includes(String(value)), `${entry.id}/${preset.id}: ${id}=${value}`);
      }
    }
  }
});
