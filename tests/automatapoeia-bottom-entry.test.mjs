import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "acorn";
import * as model from "../src/instruments/cellular-automata/automatapoeia.js";
import * as presets from "../src/families/experiments/automata-presets.js";
import { AutomatapoeiaClock, AUTOMATA_START_LEAD } from "../src/instruments/cellular-automata/automatapoeia-clock.js";

const source = await readFile(new URL("../src/families/experiments/experiments-app.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
function harness(audioOn = true) {
  let now = 0;
  const events = [], cancellations = [], draws = [];
  const state = { ...structuredClone(presets.AUTOMATA_FULL_PRESETS[0].snapshot.parameters),
    audioOn, caPlaying: false, caSeedOrigin: 1, caInitialSeedOrigin: 1, caSeed: 1,
    caInitialRow: [], caInitialDensity: 0, caRows: [], caGeneration: 0, caRenderRevision: 0,
    caRowBoundaries: [], caRowSeams: [], caEvolutionSegments: [], caAccumulator: 0,
  };
  const record = (row, options) => { events.push(structuredClone({ row, options })); return {}; };
  const audio = { context: { get currentTime() { return now; } },
    triggerRowScan: record, triggerColumnSineBank: record,
    silence() { this.automataClock?.stop(); }, cancelAutomataFrom: time => cancellations.push(time),
  };
  const context = vm.createContext({ ...model, ...presets, state, audio, structuredClone,
    experiment: "automata", automataTopology: { revision: -1 },
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)), readControl: (_, fallback) => fallback,
    $: () => null, updateSummaries() {}, performance: { now: () => now * 1000 },
    AutomatapoeiaClock: class extends AutomatapoeiaClock {
      constructor(options) { super({ ...options, setTimer: () => 1, clearTimer() {} }); }
    },
    clearStage() { draws.push("clear"); }, canvasWidth: 730, canvasHeight: 400,
    updateAutomataRaster: () => ({}),
    context2d: { save() {}, restore() {}, strokeRect() {},
      drawImage(...args) { draws.push(args.slice(1)); } },
  });
  const names = ["randomUnit", "createAutomataSeedRow", "resetAutomataAudioStats", "seedAutomata",
    "appendAutomataRow", "getAutomataTopology", "refreshAutomataSoundAnalysis", "recordAutomataEvolutionSegment",
    "updateCaStats", "stepAutomataRow", "stepAutomata", "soundAutomataRow", "captureAutomataScore",
    "updateAutomataTransport", "setAutomataPlaying", "queueAutomataLiveChange", "startAutomataAudioClock", "drawAutomata"];
  for (const name of names) {
    const node = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(source.slice(node.start, node.end), context);
  }
  const score = ast.body.find(node => node.type === "VariableDeclaration" && node.declarations[0].id.name === "AUTOMATA_SCORE_KEYS");
  vm.runInContext(source.slice(score.start, score.end) + "\nlet automataFuture = null;", context);
  const clock = ast.body.find(node => node.type === "IfStatement" && node.consequent.expression?.left?.property?.name === "automataClock");
  vm.runInContext(source.slice(clock.start, clock.end), context);
  const run = code => vm.runInContext(code, context);
  run("seedAutomata({ defer: true })");
  return { state, audio, events, cancellations, draws, run, at(time) { now = time; audio.automataClock.drain(); } };
}

test("deferred seed leaves a black, silent stage and drawing never populates history", () => {
  const h = harness();
  h.run("drawAutomata(); stepAutomata(1); drawAutomata()");
  assert.equal(h.state.caRows.length, 0);
  assert.equal(h.state.caInitialRow.filter(Boolean).length, 1);
  assert.deepEqual(h.draws, ["clear", "clear"]);
  assert.equal(h.events.length, 0);
  assert.equal(h.audio.automataClock.running, false);
});

test("first audio event is the seed, presented at its clock deadline before any descendant", () => {
  const h = harness(); h.run("setAutomataPlaying(true)");
  assert.equal(h.state.caRows.length, 0, "lookahead must not reveal the seed early");
  assert.deepEqual(h.events[0].row, Array.from(h.state.caInitialRow));
  assert.equal(h.events[0].options.generation, 0);
  assert.equal(h.events[0].options.when, AUTOMATA_START_LEAD);
  const interval = model.automatapoeiaSwingInterval(0, h.state.caRate, h.state.caSwing);
  h.at(AUTOMATA_START_LEAD);
  assert.equal(h.state.caRows.length, 1);
  assert.equal(h.state.caGeneration, 0);
  h.run("drawAutomata()");
  assert.deepEqual(h.draws.at(-1), [0, 0, 73, 1, 0, 390, 730, 10]);
  h.at(AUTOMATA_START_LEAD + interval);
  assert.equal(h.state.caRows.length, 2);
  assert.equal(h.state.caGeneration, 1);
  h.run("drawAutomata()");
  assert.deepEqual(h.draws.at(-1), [0, 0, 73, 2, 0, 380, 730, 20]);
  assert.equal(h.events[1].options.when, AUTOMATA_START_LEAD + interval);
});

test("edits before the first deadline replace the seed slot, never skip it", () => {
  const h = harness(); h.run("setAutomataPlaying(true)");
  const seed = [...h.state.caInitialRow];
  h.run("state.caRule = 90; queueAutomataLiveChange()");
  assert.equal(h.cancellations[0], AUTOMATA_START_LEAD);
  assert.equal(h.state.caRows.length, 0);
  assert.equal(h.audio.automataClock.queue[0].time, AUTOMATA_START_LEAD);
  assert.deepEqual(h.audio.automataClock.queue[0].view.caRows, [seed]);
  h.at(AUTOMATA_START_LEAD);
  assert.deepEqual(Array.from(h.state.caRows[0]), seed);
  assert.equal(h.state.caGeneration, 0);
});

test("pause before the seed keeps the stage empty; resume retries it once, later pauses retain history", () => {
  const h = harness(); h.run("setAutomataPlaying(true)"); h.at(0.02);
  h.run("setAutomataPlaying(false)");
  assert.equal(h.state.caRows.length, 0);
  assert.equal(h.audio.automataClock.queue.length, 0);
  h.run("setAutomataPlaying(true)"); h.at(0.02 + AUTOMATA_START_LEAD);
  assert.equal(h.state.caRows.length, 1);
  h.run("setAutomataPlaying(false); setAutomataPlaying(true)");
  assert.equal(h.audio.automataClock.queue[0].view.caGeneration, 1, "ordinary resume must not replay the seed");
});

test("Audio-off Play starts with only the seed and honors pre-Play seed controls", () => {
  const h = harness(false);
  h.run("state.caWidth = 37; state.caDensity = 1; setAutomataPlaying(true); stepAutomata(0.01)");
  assert.equal(h.state.caRows.length, 1);
  assert.equal(h.state.caRows[0].length, 37);
  assert.ok(h.state.caRows[0].every(Boolean));
  assert.equal(h.state.caGeneration, 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.audio.automataClock.running, false);
});
