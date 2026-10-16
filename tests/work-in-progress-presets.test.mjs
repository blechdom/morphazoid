import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import { TempoTantrum } from "../src/families/work-in-progress/tempo-tantrum.js";
import { HabitHabitat } from "../src/families/work-in-progress/habit-habitat.js";
import { TapeWorm } from "../src/families/work-in-progress/tape-worm.js";
import { LoopSoup } from "../src/families/work-in-progress/loop-soup.js";
import {
  TEMPO_FULL_PRESETS, TEMPO_PRESET_PARAMS, captureTempoPreset, randomizeTempoPreset, validateTempoPreset,
} from "../src/families/work-in-progress/tempo-tantrum-presets.js";
import {
  HABIT_FULL_PRESETS, HABIT_PRESET_PARAMS, captureHabitPreset, randomizeHabitPreset, validateHabitPreset,
} from "../src/families/work-in-progress/habit-habitat-presets.js";
import {
  TAPE_WORM_FULL_PRESETS, randomizeTapeWormPreset, validateTapeWormPreset,
} from "../src/families/work-in-progress/tape-worm-presets.js";
import {
  LOOP_SOUP_FULL_PRESETS, randomizeLoopSoupPreset, validateLoopSoupPreset,
} from "../src/families/work-in-progress/loop-soup-presets.js";
import {
  LOOP_SLOTS, captureWithDormantSlots, liveLoopNetworkState, planLoopNetworkRecall,
} from "../src/families/work-in-progress/loop-network-presets.js";
import { settleOnCapture } from "../src/families/work-in-progress/preset-settle.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const distinct = (values) => new Set(values).size;

test("Tempo Tantrum bank is complete and distinct", () => {
  validateFullPresetBank(TEMPO_FULL_PRESETS);
  for (const preset of TEMPO_FULL_PRESETS) assert.equal(validateTempoPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateTempoPreset({ ...TEMPO_FULL_PRESETS[0].snapshot, offsets: [0] }), TypeError);
  assert.throws(() => validateTempoPreset({ ...TEMPO_FULL_PRESETS[0].snapshot, tempo: 999 }), TypeError);
});

test("Tempo Tantrum dice is pure, seedable and varies every owned field", () => {
  const initial = TEMPO_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeTempoPreset(initial, seed(3)), randomizeTempoPreset(TEMPO_FULL_PRESETS[4].snapshot, seed(3)));
  assert.deepEqual(initial, before);
  const keys = new Set(TEMPO_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = { offsets: [[], [], []], ...Object.fromEntries(TEMPO_PRESET_PARAMS.map(key => [key, []])) };
  const random = seed(11);
  for (let i = 0; i < 64; i++) {
    const result = validateTempoPreset(randomizeTempoPreset(initial, random));
    assert.equal(keys.has(presetStateKey(result)), false);
    for (const key of TEMPO_PRESET_PARAMS) seen[key].push(result[key]);
    result.offsets.forEach((offset, index) => seen.offsets[index].push(offset));
  }
  for (const key of TEMPO_PRESET_PARAMS) assert.ok(distinct(seen[key]) > 20, `${key} frozen`);
  for (const values of seen.offsets) assert.ok(distinct(values) > 20, "offset frozen");
});

test("Tempo Tantrum recall leaves the live phases alone", () => {
  const core = new TempoTantrum(24000);
  core.command({ type: "play", value: true }); core.advance(0.4);
  const phases = [...core.phases];
  for (const preset of TEMPO_FULL_PRESETS) {
    core.set(Object.fromEntries(TEMPO_PRESET_PARAMS.map(key => [key, preset.snapshot[key]])));
    preset.snapshot.offsets.forEach((offset, index) => core.command({ type: "body", index, offset }));
    const state = core.snapshot();
    assert.deepEqual(captureTempoPreset({ ...state.params, offsets: state.offsets }), preset.snapshot);
    assert.deepEqual(state.phases, phases);
  }
});

test("Habit Habitat bank is complete and recalls through the engine", () => {
  validateFullPresetBank(HABIT_FULL_PRESETS);
  const core = new HabitHabitat(24000);
  core.command({ type: "visit", index: 2 });
  const { head, visits, mode } = core.snapshot();
  for (const preset of HABIT_FULL_PRESETS) {
    validateHabitPreset(preset.snapshot);
    core.set(Object.fromEntries(HABIT_PRESET_PARAMS.map(key => [key, preset.snapshot[key]])));
    core.command({ type: "memory", weights: preset.snapshot.weights });
    const state = core.snapshot();
    assert.deepEqual(captureHabitPreset({ ...state.params, weights: state.weights }), preset.snapshot);
    assert.equal(state.head, head); assert.equal(state.visits, visits); assert.equal(state.mode, mode);
  }
  assert.throws(() => validateHabitPreset({ ...HABIT_FULL_PRESETS[0].snapshot, weights: [] }), TypeError);
});

test("Habit Habitat dice is pure and varies params and routes", () => {
  const initial = HABIT_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHabitPreset(initial, seed(8)), randomizeHabitPreset(HABIT_FULL_PRESETS[3].snapshot, seed(8)));
  assert.deepEqual(initial, before);
  const keys = new Set(HABIT_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(21), params = Object.fromEntries(HABIT_PRESET_PARAMS.map(key => [key, []])), cells = Array.from({ length: 36 }, () => []);
  for (let i = 0; i < 64; i++) {
    const result = validateHabitPreset(randomizeHabitPreset(initial, random));
    assert.equal(keys.has(presetStateKey(result)), false);
    for (const key of HABIT_PRESET_PARAMS) params[key].push(result[key]);
    result.weights.forEach((row, a) => row.forEach((value, b) => cells[a * 6 + b].push(value)));
    for (let a = 0; a < 6; a++) assert.equal(result.weights[a][a], 0);
  }
  for (const key of HABIT_PRESET_PARAMS) assert.ok(distinct(params[key]) > 20, `${key} frozen`);
  cells.forEach((values, index) => { if (index % 7) assert.ok(distinct(values) > 5, `route ${index} frozen`); });
});

const KINDS = {
  tape: { Core: TapeWorm, bank: TAPE_WORM_FULL_PRESETS, validate: validateTapeWormPreset, randomize: randomizeTapeWormPreset },
  soup: { Core: LoopSoup, bank: LOOP_SOUP_FULL_PRESETS, validate: validateLoopSoupPreset, randomize: randomizeLoopSoupPreset },
};

for (const [kind, { Core, bank, validate, randomize }] of Object.entries(KINDS)) {
  const live = (core, held) => captureWithDormantSlots(kind, liveLoopNetworkState(core.snapshot(), core.snapshot().params), held);
  const recall = (core, snapshot) => { for (const command of planLoopNetworkRecall(kind, snapshot, core.snapshot())) core.command(command); };
  const audio = core => core.buffers.map(buffer => Float32Array.from(buffer));

  test(`${kind} bank is complete, distinct and respects the route cap`, () => {
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.equal(validate(preset.snapshot), preset.snapshot);
      assert.equal(preset.snapshot.loops.length, LOOP_SLOTS);
      assert.ok(preset.snapshot.routes.length <= 24);
    }
  });

  test(`${kind} recall restores the complete state on every loop count without touching audio`, () => {
    for (const extra of [0, 1, 4]) {
      const core = new Core(24000);
      for (let i = 0; i < extra; i++) core.command({ type: "add-loop", seconds: 1, connect: kind === "tape" });
      core.command({ type: "load", index: 0, name: "take", samples: Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i / 7) * 0.5) });
      core.command({ type: "play", value: true });
      const buffers = audio(core), loops = core.loops.length, playing = core.playing, recording = core.recording;
      let held = null;
      for (const preset of bank) {
        recall(core, preset.snapshot); held = preset.snapshot;
        assert.deepEqual(live(core, held), preset.snapshot, `${preset.id} with ${loops} loops`);
      }
      assert.deepEqual(audio(core), buffers);
      assert.equal(core.loops.length, loops);
      assert.equal(core.playing, playing); assert.equal(core.recording, recording);
      if (kind === "soup") {
        assert.equal(core.params.demo, 1);
        assert.deepEqual(core.loops.map(loop => loop.mode), Array(loops).fill("overdub"));
      }
      assert.ok(core.loops.every(loop => !loop.paused));
    }
  });

  test(`${kind} dice is pure, valid, new and varies every owned field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomize(initial, seed(5)), randomize(bank[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const keys = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const random = seed(31), seen = {}, routeSeen = {};
    for (let i = 0; i < 64; i++) {
      const result = validate(randomize(initial, random, { loopCount: 3 }));
      assert.equal(keys.has(presetStateKey(result)), false);
      for (const [key, value] of Object.entries(result.params)) (seen[key] ??= []).push(value);
      for (const slot of [0, 1, 2]) for (const key of ["level", "pan"]) (seen[`${key}${slot}`] ??= []).push(result.loops[slot][key]);
      for (const route of result.routes) for (const [key, value] of Object.entries(route)) if (key !== "from" && key !== "to") (routeSeen[key] ??= []).push(value);
      assert.ok(result.routes.every(route => route.from < 3 && route.to < 3));
      assert.ok(result.routes.some(route => route.enabled));
      assert.ok(result.loops.slice(0, 3).some(loop => !loop.muted));
    }
    for (const [key, values] of Object.entries(seen)) assert.ok(distinct(values) > (key === "splice" ? 1 : 20), `${key} frozen`);
    for (const [key, values] of Object.entries(routeSeen)) assert.ok(distinct(values) > (key === "enabled" ? 1 : 20), `route ${key} frozen`);
  });
}

test("recalled routes only ever connect existing loops", () => {
  const core = new TapeWorm(24000);
  for (const preset of TAPE_WORM_FULL_PRESETS) {
    for (const command of planLoopNetworkRecall("tape", preset.snapshot, core.snapshot())) core.command(command);
    const ids = new Set(core.loops.map(loop => loop.id));
    assert.ok(core.routes.every(route => ids.has(route.from) && ids.has(route.to) && route.from !== route.to));
  }
});

test("settleOnCapture resolves immediately, after convergence, and rejects when the engine never confirms", async () => {
  assert.equal(settleOnCapture(() => ({ a: 1 }), { a: 1 }), undefined);
  let value = 0, time = 0;
  const wait = fn => { time += 16; value += 1; fn(); };
  await settleOnCapture(() => ({ a: value }), { a: 3 }, { wait, now: () => time });
  await assert.rejects(settleOnCapture(() => ({ a: 0 }), { a: 1 }, { wait: fn => { time += 500; fn(); }, now: () => time, timeoutMs: 1000 }), /did not confirm/);
});
