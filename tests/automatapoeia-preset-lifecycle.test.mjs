import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import * as presets from "../src/families/experiments/automata-presets.js";


const source = await readFile(new URL("../src/families/experiments/experiments-app.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const audioClass = ast.body.find(node => node.type === "ClassDeclaration" && node.id.name === "ExperimentAudio");
const registration = ast.body.find(node => node.type === "IfStatement"
  && node.consequent.expression?.callee?.name === "registerHeaderPresets").consequent.expression.arguments[0];
const modeControls = [
  "caObjectMode", "caVoice", "caPitchTrace", "caTimbreSource", "caTimbreAmount",
  "caContourSource", "caContourAmount", "caPhraseShape", "caRhythmDetail", "caTimeSpread", "caStrikeLength",
];

// Execute the real adapter and boundary cleanup; stub DOM and the clock
// deadline only. Browser coverage exercises the actual simulation/audio clock.
function harness({ audioOn = true, hasContext = true } = {}) {
  const initial = structuredClone(presets.AUTOMATA_FULL_PRESETS.find(preset => preset.id === "columns-110").snapshot);
  const state = { ...initial.parameters, caSeedOrigin: initial.seedOrigin,
    audioOn, caPlaying: true, caAccumulator: 0.07, caGeneration: 17, time: 29,
    caRows: [[1, 0, 1], [0, 1, 0]], caInitialRow: [1, 0, 1] };
  const controls = new Map(modeControls.map(id => [id, { disabled: true }]));
  const events = [];
  const context = vm.createContext({
    ...presets, state,
    $: id => controls.get(id), presetControlPainters: new Map(),
    percent: value => value * 100, setText() {},
    updateAutomataFamilyPresentation() {}, populateAutomataRuleAtlas() {}, updateAutomataRuleControls() {},
    refreshAutomataSoundAnalysis() {}, updateCommonAudio() {}, updateSummaries() {},
    seedAutomata() { assert.fail("presets must never reset the seed/history"); },
    recordAutomataEvolutionSegment() {},
    queueAutomataLiveChange() {
      if (audioOn) audio.cancelAutomataFrom(23.1);
    },
  });
  const audio = vm.runInContext(`new (${source.slice(audioClass.start, audioClass.end)})()`, context);
  context.audio = audio;
  audio.running = audioOn;
  if (hasContext) {
    audio.context = { currentTime: 23, state: audioOn ? "running" : "suspended" };
    const held = { stop: when => events.push(["held", when, state.caSeedOrigin]) };
    const tail = { stop: when => events.push(["tail", when, state.caSeedOrigin]) };
    const row = { stop: when => events.push(["row", when, state.caSeedOrigin]) };
    const envelope = { gain: { value: 0.5, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
    audio.columnVoices.set("column", { oscillator: held, envelope });
    audio.columnSources.add(held).add(tail);
    audio.columnSourceEnvelopes.set(held, envelope).set(tail, envelope);
    audio.rowScanSources.add(row);
    audio.rowScanStartTimes.set(row, 23.2);
    audio.rowScanCursor = 24;
  }
  const presentation = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "updateAutomataSonificationControls");
  if (presentation) vm.runInContext(source.slice(presentation.start, presentation.end), context);
  const adapter = vm.runInContext(`(${source.slice(registration.start, registration.end)})`, context);
  return { adapter, audio, state, controls, events, initial };
}

for (const preset of presets.AUTOMATA_FULL_PRESETS) {
  test(`${preset.id}: recall retires old columns/future buffers at the next row without resetting history or Audio`, () => {
    const { adapter, audio, state, events, initial } = harness();
    const context = audio.context;
    const snapshot = structuredClone(preset.snapshot);
    const rows = structuredClone(state.caRows), initialRow = [...state.caInitialRow];
    adapter.apply(snapshot);
    assert.deepEqual(events, [
      ["row", 23.1, snapshot.seedOrigin], ["held", 23.1 + 0.012, snapshot.seedOrigin], ["tail", 23.1 + 0.012, snapshot.seedOrigin],
    ], "current columns release at the boundary, not in the middle of the current row");
    assert.equal(audio.columnVoices.size, 0);
    assert.equal(audio.columnSources.size, 2, "retain physical ownership until ended for panic");
    assert.deepEqual(state.caRows, rows);
    assert.deepEqual(state.caInitialRow, initialRow);
    assert.equal(state.caGeneration, 17);
    assert.equal(state.caPlaying, true);
    assert.equal(audio.rowScanCursor, 23.1);
    assert.equal(audio.context, context);
    assert.equal(audio.context.state, "running");
    assert.equal(audio.running, true);
    assert.equal(state.audioOn, true);
    assert.equal(state.time, 29);
    assert.equal(state.caAccumulator, 0.07);
    assert.deepEqual(adapter.capture(), snapshot);
    assert.deepEqual(snapshot, preset.snapshot, "factory data was not mutated");
  });
}

test("preset recall updates the same mode-dependent controls as the native selector", () => {
  const { adapter, controls } = harness();
  for (const id of ["original-thirty", "columns-110", "radius-choir", "ninety-carpet"]) {
    const { snapshot } = presets.AUTOMATA_FULL_PRESETS.find(preset => preset.id === id);
    adapter.apply(structuredClone(snapshot));
    for (const [key, control] of controls) assert.equal(control.disabled, snapshot.parameters.caSonificationMode === "vertical-sine", key);
  }
});

test("dice uses the same release boundary and preserves the performer's output level", () => {
  for (const random of [() => 0.1, () => 0.9]) {
    const { adapter, audio, state, events } = harness();
    const level = state.level;
    const snapshot = adapter.randomize(adapter.capture(), random);
    adapter.apply(snapshot);
    assert.equal(events.length, 3);
    assert.equal(audio.columnVoices.size, 0);
    assert.equal(state.caGeneration, 17);
    assert.deepEqual(adapter.capture(), snapshot);
    assert.equal(state.level, level);
  }
});

test("Audio-off recall never creates or resumes an audio context", () => {
  for (const hasContext of [false, true]) {
    const { adapter, audio, state } = harness({ audioOn: false, hasContext });
    const context = audio.context;
    for (const preset of presets.AUTOMATA_FULL_PRESETS) adapter.apply(structuredClone(preset.snapshot));
    assert.equal(state.audioOn, false);
    assert.equal(audio.running, false);
    assert.equal(audio.context, context);
    if (hasContext) assert.equal(context.state, "suspended");
  }
});

test("invalid snapshots fail before releasing notes or mutating the running state", () => {
  const { adapter, state, events, audio } = harness();
  const before = structuredClone(state);
  const invalid = adapter.capture();
  invalid.parameters.caRule = -1;
  assert.throws(() => adapter.apply(invalid));
  assert.deepEqual(state, before);
  assert.deepEqual(events, []);
  assert.equal(audio.columnSources.size, 2);
});
