import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import * as model from "../src/instruments/cellular-automata/automatapoeia.js";
import { AUTOMATA_FULL_PRESETS } from "../src/families/experiments/automata-presets.js";

const source = await readFile(new URL("../src/families/experiments/experiments-app.js", import.meta.url), "utf8");
const amendments = JSON.parse(await readFile(new URL("../docs/automatapoeia-audio-clock-runtime-changes.json", import.meta.url), "utf8"));
const transportChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-live-transport-runtime-changes.json", import.meta.url), "utf8"));
const bottomChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-bottom-entry-runtime-changes.json", import.meta.url), "utf8"));
const controlsChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-controls-runtime-changes.json", import.meta.url), "utf8"));
let baseline = source;
for (const change of controlsChanges.changes.filter(change => change.file.endsWith("/experiments-app.js"))) {
  for (const edit of [...change.replacements].reverse()) {
    assert.equal(baseline.split(edit.after).length - 1, 1);
    baseline = baseline.replace(edit.after, edit.before);
  }
}
for (const edit of [...bottomChanges.changes[0].replacements].reverse()) {
  assert.equal(baseline.split(edit.after).length - 1, 1);
  baseline = baseline.replace(edit.after, edit.before);
}
for (const edit of [...transportChanges.changes[0].replacements].reverse()) {
  assert.equal(baseline.split(edit.after).length - 1, 1);
  baseline = baseline.replace(edit.after, edit.before);
}
for (const edit of [...amendments.changes[0].replacements].reverse()) {
  assert.equal(baseline.split(edit.after).length - 1, 1);
  baseline = baseline.replace(edit.after, edit.before);
}
const helpers = [
  "randomUnit", "createAutomataSeedRow", "resetAutomataAudioStats", "seedAutomata", "appendAutomataRow",
  "getAutomataTopology", "refreshAutomataSoundAnalysis", "recordAutomataEvolutionSegment", "updateCaStats",
  "stepAutomataRow", "soundAutomataRow",
];

function harness(code, preset) {
  const state = { ...structuredClone(preset.snapshot.parameters), audioOn: true,
    caSeedOrigin: preset.snapshot.seedOrigin, caInitialSeedOrigin: preset.snapshot.seedOrigin, caSeed: 1, caInitialRow: [], caInitialDensity: 0,
    caRows: [], caRowBoundaries: [], caRowSeams: [], caLineageStartIndex: 0,
    caGeneration: 0, caRenderRevision: 0, caAccumulator: 0.07, caEvolutionSegments: [],
  };
  const events = [];
  const record = (row, options) => {
    const { when, ...sound } = options;
    events.push(structuredClone({ row, sound }));
    return { activeStreams: 1 };
  };
  const context = vm.createContext({
    ...model, state, structuredClone,
    audio: { automataClock: null, triggerRowScan: record, triggerColumnSineBank: record },
    automataTopology: { revision: -1 },
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    readControl: (_, fallback) => fallback,
  });
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  for (const name of helpers) {
    const node = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(code.slice(node.start, node.end), context);
  }
  vm.runInContext("seedAutomata()", context);
  return { state, events, context };
}

for (const preset of AUTOMATA_FULL_PRESETS) {
  test(`${preset.id}: lookahead preserves exact evolution and all synthesis inputs without advancing the visible score`, () => {
    const old = harness(baseline, preset), current = harness(source, preset);
    const visible = structuredClone(current.state);
    const future = structuredClone(current.state);
    current.context.future = future;
    for (let generation = 0; generation < 180; generation++) {
      // Include a live structural edit and history trimming, not only the seed.
      if (generation === 4) { old.state.caWidth = 37; future.caWidth = 37; }
      vm.runInContext("stepAutomataRow()", old.context);
      vm.runInContext("stepAutomataRow(true, future, 20)", current.context);
    }
    assert.deepEqual(current.events, old.events);
    assert.deepEqual(structuredClone(future), structuredClone(old.state));
    assert.deepEqual(structuredClone(current.state), visible, "preparing audio must not advance visible rows");
  });
}

test("audio-clock timestamps reach both native synthesis paths without altering their synthesis", () => {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const klass = ast.body.find(node => node.type === "ClassDeclaration" && node.id.name === "ExperimentAudio");
  const context = vm.createContext({ ...model });
  const audio = vm.runInContext(`new (${source.slice(klass.start, klass.end)})()`, context);
  audio.context = { currentTime: 10 };
  const timing = audio.nextAutomataRowTime({ when: 10.2, generation: 2, rate: 12, swing: 0 });
  assert.equal(timing.startTime, 10.2);
  assert.equal(timing.slotInterval, 1 / 12);
  assert.equal(audio.rowScanCursor, 10.2 + 1 / 12);
  assert.match(source, /const sharedOptions = \{\s*when,/);
});

function columnHarness(code) {
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const klass = ast.body.find(node => node.type === "ClassDeclaration" && node.id.name === "ExperimentAudio");
  const context = vm.createContext({ ...model, MAX_AUTOMATA_SINE_SOURCES: 384,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  });
  const audio = vm.runInContext(`new (${code.slice(klass.start, klass.end)})()`, context);
  const sources = [], levels = [];
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {},
    linearRampToValueAtTime() {}, cancelAndHoldAtTime() {}, cancelScheduledValues() {} });
  audio.running = true;
  audio.columnBankBus = { gain: { setTargetAtTime: value => levels.push(value) } };
  audio.context = {
    currentTime: 0, sampleRate: 48000,
    createGain: () => ({ gain: param(), connect() {} }),
    createOscillator() {
      const oscillator = { frequency: param(), stopAt: Infinity, ended: false,
        connect() {}, start() {}, stop(time) { this.stopAt = time; } };
      sources.push(oscillator);
      return oscillator;
    },
  };
  function tick(time) {
    audio.context.currentTime = time;
    for (const oscillator of sources) if (!oscillator.ended && oscillator.stopAt <= time) {
      oscillator.ended = true;
      oscillator.onended?.();
    }
  }
  return { audio, sources, levels, tick };
}

for (const [width, release, rate, rows] of [[8, 0.01, 10, 5], [127, 2, 24, 12]]) {
  test(`column lookahead retains the original gain/cap decisions (${width} columns), including future steals`, () => {
    const old = columnHarness(baseline), ahead = columnHarness(source);
    let previous = [];
    for (let generation = 0; generation < rows; generation++) {
      const cells = Array.from({ length: width }, (_, column) => (column + generation) % 2);
      const when = generation / rate;
      const options = { when, generation, rate, release, previousCells: previous };
      old.tick(when);
      const expected = old.audio.triggerColumnSineBank(cells, options);
      const actual = ahead.audio.triggerColumnSineBank(cells, options);
      assert.deepEqual(structuredClone(actual), structuredClone(expected));
      previous = cells;
    }
    assert.deepEqual(ahead.levels, old.levels);
    assert.ok(ahead.sources.length > 0);
    ahead.audio.silence();
    assert.ok(ahead.sources.every(oscillator => oscillator.stopAt === 0), "panic owns even a future-stolen voice");
    assert.equal(ahead.audio.columnSourceRetireTimes.size, 0);
  });
}
