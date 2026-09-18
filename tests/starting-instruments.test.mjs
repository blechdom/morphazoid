import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORES } from "../src/starting-instruments/cores.js";
import { TempoTantrum, TEMPO_PRESETS } from "../src/starting-instruments/tempo-tantrum.js";
import { TapeWorm } from "../src/starting-instruments/tape-worm.js";
import { LoopSoup } from "../src/starting-instruments/loop-soup.js";
import { HabitHabitat } from "../src/starting-instruments/habit-habitat.js";
import { Hollowphonic } from "../src/starting-instruments/hollowphonic.js";
import { STARTING_INSTRUMENTS } from "../src/starting-instruments/catalog.js";
import { INSTRUMENT_HELP } from "../src/starting-instruments/help.js";
import { instrumentById } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

function run(core, seconds, input = () => 0) {
  const count = Math.round(seconds * core.rate);
  let sum = 0, peak = 0;
  const wave = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const out = core.tick(input(i));
    assert.ok(Number.isFinite(out[0]) && Number.isFinite(out[1]));
    peak = Math.max(peak, Math.abs(out[0]), Math.abs(out[1]));
    sum += out[0] * out[0]; wave[i] = out[0];
  }
  return { peak, rms: Math.sqrt(sum / count), wave };
}

for (const [id, C] of Object.entries(CORES)) {
  test(`${id}: silent start, finite audible demo, reproducible engine and bounded hostile controls`, () => {
    const c = new C(12000), twin = new C(12000);
    assert.equal(run(c, 0.1).peak, 0);
    run(twin, 0.1);
    c.command({ type: "play", value: true }); twin.command({ type: "play", value: true });
    const result = run(c, 5), identical = run(twin, 5);
    assert.ok(result.rms > 0.003, `${id} silent demo`);
    assert.ok(result.peak < 1);
    assert.deepEqual(result.wave, identical.wave);
    for (const preset of Object.values(STARTING_INSTRUMENTS[id].presets)) {
      c.set(preset); assert.ok(run(c, 0.5, (i) => i % 2 ? 10 : -10).peak <= 1);
    }
    c.set(Object.fromEntries(Object.keys(c.params).map((key) => [key, NaN])));
    assert.ok(Object.values(c.params).every(Number.isFinite));
    c.command({ type: "play", value: false });
    run(c, 5);
    assert.ok(run(c, 1).rms < 0.0001, `${id} did not release after pause`);
  });
}

test("Tempo: crossing times emerge from the ODE, stable lock recovers, weak drive slips", () => {
  const c = new TempoTantrum(12000);
  c.playing = true;
  run(c, 6);
  assert.deepEqual(c.snapshot().locked, [true, true, true]);
  const before = c.snapshot();
  c.command({ type: "nudge", index: 1, amount: 0.22 });
  assert.equal(c.phases[0], before.phases[0]);
  assert.equal(c.phases[2], before.phases[2]);
  assert.equal(c.playing, true);
  assert.equal(c.snapshot().locked[1], false);
  run(c, 5);
  assert.equal(c.snapshot().locked[1], true);
  c.set(TEMPO_PRESETS["No manners"]);
  run(c, 6);
  assert.deepEqual(c.snapshot().locked, [false, false, false]);
  c.set({ strength: 0, detune: 0.31 });
  const phase = c.phases[0], f = c.params.tempo / 60;
  c.advance(0.5);
  const expected = (phase + 0.5 * f / 2 * (1 + 0.31 + c.offsets[0])) % 1;
  assert.ok(Math.abs(c.phases[0] - expected) < 1e-8);
});

test("Tempo: silent preview and audio stepping remain phase-compatible", () => {
  const fast = new TempoTantrum(48000), slow = new TempoTantrum(1000);
  fast.playing = slow.playing = true;
  run(fast, 4);
  for (let i = 0; i < 120; i++) slow.advance(1 / 30);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(fast.phases[i] - slow.phases[i]) < 0.006);
  assert.deepEqual(fast.hits, slow.hits);
});

test("Tape: splicing changes route, never source bytes; bypass and recording have defined ownership", () => {
  const c = new TapeWorm(12000);
  const originals = c.tapes.map((t) => Float32Array.from(t));
  c.playing = true; run(c, 5);
  assert.ok(c.transitions >= 2);
  assert.deepEqual(c.tapes, originals);
  c.set({ splice: 0 }); const transitions = c.transitions; run(c, 3);
  assert.equal(c.transitions, transitions);
  c.command({ type: "record", index: 1 });
  run(c, 0.25, (i) => Math.sin(i * 0.08) * 0.25);
  c.command({ type: "finish-record" });
  assert.equal(c.tapes[1].length, 3000);
  assert.deepEqual(c.tapes[0], originals[0]);
  const captured = Float32Array.from(c.tapes[1]);
  c.command({ type: "record", index: 1 }); run(c, 0.03); c.command({ type: "finish-record" });
  assert.deepEqual(c.tapes[1], captured, "too-short take must not destroy previous recording");
  c.command({ type: "reset" }); assert.deepEqual(c.tapes[1], captured);
});

test("Soup: Hold is exact, overdub changes material, local erasure works, extremes stay bounded", () => {
  const c = new LoopSoup(12000); c.playing = true;
  for (let i = 0; i < 3; i++) c.command({ type: "mode", index: i, value: "hold" });
  const original = c.buffers.map((b) => Float32Array.from(b));
  run(c, 3, () => 0.8);
  assert.deepEqual(c.buffers, original);
  c.command({ type: "mode", index: 0, value: "overdub" });
  run(c, 1, () => 0.8);
  assert.notDeepEqual(c.buffers[0], original[0]);
  assert.deepEqual(c.buffers[1], original[1]);
  c.command({ type: "erase", index: 0, phase: 0.5 });
  assert.equal(c.buffers[0][Math.floor(c.buffers[0].length * 0.5)], 0);
  c.set({ retention: 1, spill: 0.7, feed: 0.9 });
  for (let i = 0; i < 3; i++) c.command({ type: "mode", index: i, value: "overdub" });
  run(c, 5, () => 50);
  for (const buffer of c.buffers) assert.ok(buffer.every((v) => Math.abs(v) <= 0.901));
  const memory = c.buffers.map((b) => Float32Array.from(b));
  c.command({ type: "reset" }); assert.deepEqual(c.buffers, memory);
});

test("Habit: only manual teaching changes memory; deterministic recall and transactional load", () => {
  const c = new HabitHabitat(12000);
  c.command({ type: "clear" }); c.command({ type: "mode", value: "teach" });
  const before = c.weights[0][4];
  c.command({ type: "visit", index: 0 }); c.command({ type: "visit", index: 4 });
  assert.ok(c.weights[0][4] > before);
  const memory = c.weights.map((r) => [...r]);
  c.command({ type: "mode", value: "recall" }); c.playing = true; run(c, 5);
  assert.deepEqual(c.weights, memory);
  assert.ok(c.visits > 5);
  c.command({ type: "memory", weights: [[NaN]] });
  assert.deepEqual(c.weights, memory);
  c.command({ type: "reset" }); assert.deepEqual(c.weights, memory);
  c.command({ type: "forget", index: 0, to: 4 });
  assert.ok(c.weights[0][4] < memory[0][4]);
});

test("Hollowphonic: depth changes resonance, damping changes decay, strikes use silent-source chambers", () => {
  const a = new Hollowphonic(12000), b = new Hollowphonic(12000);
  a.set({ depth: 0.1, loss: 0.1, source: 0 }); b.set({ depth: 0.9, loss: 0.8, source: 0 });
  a.advance(0.3); b.advance(0.3);
  assert.ok(a.snapshot().frequencies[0] > b.snapshot().frequencies[0]);
  a.command({ type: "strike", index: 0 }); b.command({ type: "strike", index: 0 });
  const ar = run(a, 0.3), br = run(b, 0.3);
  assert.ok(ar.rms > 0.001 && br.rms > 0.001);
  assert.notDeepEqual(ar.wave, br.wave);
  a.command({ type: "play", value: true }); a.set({ source: 1 });
  const wet = run(a, 0.3);
  a.command({ type: "bypass", value: true });
  assert.notDeepEqual(run(a, 0.3).wave, wet.wave);
});

test("all five entries are authored, classified, and use real WebP icons", async () => {
  for (const [id, spec] of Object.entries(STARTING_INSTRUMENTS)) {
    const record = instrumentById(id), capability = instrumentMidiCapabilityForId(id);
    assert.equal(record.label, spec.title);
    assert.equal(record.status, "Work in Progress");
    assert.equal(capability.midiOutput, false);
    assert.equal(capability.computerKeyboardMode, "page");
    assert.equal(capability.audioInput, ["tape-worm", "loop-soup", "hollowphonic"].includes(id));
    const html = await readFile(new URL(`../${id}.html`, import.meta.url), "utf8");
    assert.ok(html.includes(`data-starting-instrument="${id}"`));
    assert.ok(html.includes('data-primary-transport'));
    assert.ok(html.includes('data-reset-all'));
    assert.ok(html.includes('tabindex="0"'));
    const network = ["tape-worm", "loop-soup"].includes(id);
    assert.ok(html.includes(network ? "src/families/starting-instruments/loop-network-app.js" : "src/families/starting-instruments/starting-instruments-app.js"));
    assert.ok(html.includes(network ? 'aria-label="Scrollable loop network"' : 'aria-describedby="canvasInstructions modelStatus"'));
    assert.ok(html.includes('og:image'));
    const help = INSTRUMENT_HELP[id];
    assert.ok(html.includes('id="howItWorks"'));
    for (const text of [help.start, help.hear, help.mechanism, help.memory, help.limits]) {
      assert.ok(text.length > 40, `${id} needs specific playable guidance`);
    }
    for (const c of spec.controls) {
      assert.ok(help.controls[c.key]);
      assert.ok(html.includes(`id="${c.key}Help"`));
    }
    assert.deepEqual(Object.keys(help.presets), Object.keys(spec.presets));
    const icon = await readFile(new URL(`../assets/instruments/${id}.webp`, import.meta.url));
    assert.equal(icon.subarray(0, 4).toString(), "RIFF");
    assert.equal(icon.subarray(8, 12).toString(), "WEBP");
    assert.ok(icon.length > 1000);
  }
});

test("initial audio handoff keeps Soup's held and erased material at a different sample rate", () => {
  const preview = new LoopSoup(24000);
  preview.command({ type: "mode", index: 0, value: "hold" });
  preview.command({ type: "clear", index: 0 });
  preview.command({ type: "erase", index: 1, phase: 0.25 });
  const audio = new LoopSoup(48000);
  audio.restore({ ...preview.snapshot(), tapeData: preview.buffers });
  assert.equal(audio.modes[0], "hold");
  assert.ok(audio.buffers[0].every((x) => x === 0));
  assert.equal(audio.buffers[1][Math.round(audio.buffers[1].length * 0.25)], 0);
  audio.command({ type: "reset" });
  assert.equal(audio.modes[0], "hold", "reset must not release protected audio into overdub");
});

test("initial handoff and reset keep truthful mode and counters", () => {
  const hollow = new Hollowphonic(24000);
  hollow.command({ type: "bypass", value: true });
  const other = new Hollowphonic(48000); other.restore(hollow.snapshot());
  assert.equal(other.bypass, true);
  other.command({ type: "reset" }); assert.equal(other.bypass, false);
  const habit = new HabitHabitat(24000); habit.command({ type: "mode", value: "teach" });
  habit.command({ type: "visit", index: 3 });
  const restored = new HabitHabitat(48000); restored.restore(habit.snapshot());
  const before = restored.weights[3][1];
  restored.command({ type: "visit", index: 1 });
  assert.ok(restored.weights[3][1] > before);
  restored.command({ type: "reset" });
  assert.equal(restored.mode, "recall"); assert.equal(restored.visits, 0);
});

test("too-short recording is reported as rejected without replacing the previous tape", () => {
  const core = new TapeWorm(12000);
  const original = core.tapes[0];
  core.command({ type: "record", index: 0 });
  run(core, 0.02);
  core.command({ type: "finish-record" });
  assert.equal(core.tapes[0], original);
  assert.equal(core.snapshot().lastRecording.accepted, false);
});
