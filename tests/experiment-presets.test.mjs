import assert from "node:assert/strict";
import test from "node:test";
import { EXPERIMENT_PRESET_SESSION_KEYS, EXPERIMENT_PRESET_SPECS } from "../src/families/experiments/experiment-presets.js";
import { applyExperimentPreset } from "../src/families/experiments/experiment-preset-wiring.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const specs = Object.values(EXPERIMENT_PRESET_SPECS);

function leaves(value, path, into) {
  if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}.${index}`, into));
  else (into.get(path) ?? into.set(path, new Set()).get(path)).add(value);
}

function sessionState(extra = {}) {
  return {
    audioOn: true, audioStarting: false, time: 12.5, lastFrame: 3, level: 0.33, orbitalPlaying: true,
    orbitalLevelPhases: [0.1, 0.2, 0.3, 0.4], orbitalGestureTravel: 0.7, caPlaying: true,
    orbitalLevelProcessors: ["voice", "pass", "pass", "pass", "pass"], ...extra,
  };
}

test("all fifteen experiments register the expected instruments", () => {
  assert.deepEqual(specs.map(spec => spec.id).sort(), [
    "atomic-orbitals", "chladni-plate", "dna-translator", "double-pendulum", "fourier-epicycles", "gear-ratio-drums",
    "gravity-lens", "lissajous-orbits", "moire-organ", "neural-pulse", "orbital-ferris", "pendulum-wave", "prime-sieve",
    "reaction-diffusion", "spring-choir",
  ]);
});

for (const spec of specs) {
  test(`${spec.id} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(spec.presets);
    assert.ok(spec.presets.length >= 12);
    for (const preset of spec.presets) {
      assert.equal(spec.validate(preset.snapshot), preset.snapshot);
      assert.deepEqual(Object.keys(preset.snapshot).sort(), [...spec.keys].sort());
    }
    assert.throws(() => spec.validate({}), TypeError);
    const broken = structuredClone(spec.presets[1].snapshot);
    delete broken[spec.keys[0]];
    assert.throws(() => spec.validate(broken), TypeError);
    assert.throws(() => spec.validate({ ...spec.presets[1].snapshot, [spec.keys[0]]: Number.NaN }), TypeError);
    for (const key of EXPERIMENT_PRESET_SESSION_KEYS) assert.equal(spec.keys.includes(key), false, key);
  });

  test(`${spec.id} capture/apply round-trips and leaves session state alone`, () => {
    for (const preset of spec.presets) {
      const state = sessionState();
      const session = structuredClone(state);
      const calls = [];
      const hooks = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, args]) });
      applyExperimentPreset(spec.experiment, preset.snapshot, { state, hooks });
      assert.equal(presetStateKey(spec.capture(state)), presetStateKey(preset.snapshot), preset.id);
      for (const key of Object.keys(session)) {
        if (key === "orbitalLevelProcessors" && spec.experiment === "orbitalFerris") continue;
        assert.deepEqual(state[key], session[key], `${preset.id} touched ${key}`);
      }
      for (const key of spec.keys) if (typeof state[key] === "object") assert.notEqual(state[key], preset.snapshot[key], `${preset.id} aliases ${key}`);
    }
    const state = sessionState();
    const before = structuredClone(state);
    assert.throws(() => applyExperimentPreset(spec.experiment, { bad: true }, { state }), TypeError);
    assert.deepEqual(state, before);
  });

  test(`${spec.id} dice is pure, reproducible, bounded and unfrozen`, () => {
    const initial = structuredClone(spec.presets[0].snapshot);
    const before = structuredClone(initial);
    assert.deepEqual(spec.randomize(initial, seed(5)), spec.randomize(spec.presets[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(spec.presets.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map();
    const random = seed(77);
    for (let i = 0; i < 96; i++) {
      const result = spec.randomize(initial, random);
      spec.validate(result);
      assert.equal(factory.has(presetStateKey(result)), false);
      assert.notEqual(presetStateKey(result), presetStateKey(initial));
      for (const key of spec.keys) leaves(result[key], key, seen);
    }
    for (const [path, values] of seen) {
      if (spec.constant.includes(path)) { assert.equal(values.size, 1, path); continue; }
      const kinds = [...values].some(value => typeof value === "number") ? 3 : 2;
      assert.ok(values.size >= kinds, `${spec.id} ${path} stays frozen (${values.size} values)`);
    }
    for (const degenerate of [() => 0, () => 0.999999, () => 0.5]) {
      assert.doesNotThrow(() => spec.validate(spec.randomize(initial, degenerate)));
    }
    assert.throws(() => spec.randomize(initial, () => Number.NaN), TypeError);
  });
}

test("Chladni scenes and dice always excite an audible, non-nodal spot", () => {
  const spec = EXPERIMENT_PRESET_SPECS.chladni;
  const loudness = s => Math.abs(Math.sin(s.chladniN * Math.PI * s.excitationX) * Math.sin(s.chladniM * Math.PI * s.excitationY));
  for (const preset of spec.presets) assert.ok(loudness(preset.snapshot) > 0.2, preset.id);
  const random = seed(3);
  for (let i = 0; i < 200; i++) assert.ok(loudness(spec.randomize(spec.presets[0].snapshot, random)) >= 0.25);
  assert.throws(() => spec.validate({ ...spec.presets[0].snapshot, chladniN: 2, chladniM: 2, excitationX: 0.5, excitationY: 0.5 }), TypeError);
});

test("Atomic Orbitals keeps quantum numbers physical", () => {
  const spec = EXPERIMENT_PRESET_SPECS.orbitals;
  const random = seed(9);
  const shells = new Set();
  for (let i = 0; i < 200; i++) {
    const s = spec.randomize(spec.presets[0].snapshot, random);
    assert.ok(s.orbitalL < s.orbitalN && s.orbitalM <= s.orbitalL);
    shells.add(`${s.orbitalN}${s.orbitalL}${s.orbitalM}`);
  }
  assert.ok(shells.size > 12);
  assert.throws(() => spec.validate({ ...spec.presets[0].snapshot, orbitalN: 2, orbitalL: 2 }), TypeError);
  assert.throws(() => spec.validate({ ...spec.presets[0].snapshot, orbitalL: 1, orbitalM: 2 }), TypeError);
});

test("Gears and Lissajous dice avoid degenerate identical pairs", () => {
  const random = seed(21);
  for (let i = 0; i < 200; i++) {
    const gear = EXPERIMENT_PRESET_SPECS.gears.randomize(EXPERIMENT_PRESET_SPECS.gears.presets[0].snapshot, random);
    assert.notEqual(gear.gearTeethA, gear.gearTeethB);
    const liss = EXPERIMENT_PRESET_SPECS.lissajous.randomize(EXPERIMENT_PRESET_SPECS.lissajous.presets[0].snapshot, random);
    assert.notEqual(liss.lissajousX, liss.lissajousY);
  }
});

test("Reaction-Diffusion dice stays near the pattern-forming feed/kill band", () => {
  const spec = EXPERIMENT_PRESET_SPECS.reaction;
  const random = seed(11);
  for (let i = 0; i < 200; i++) {
    const s = spec.randomize(spec.presets[0].snapshot, random);
    const saddle = Math.sqrt(s.reactionFeed) / 2 - s.reactionFeed;
    assert.ok(s.reactionKill - saddle >= -0.0022 && s.reactionKill - saddle <= 0.0057, `${s.reactionFeed}/${s.reactionKill}`);
  }
});

test("DNA dice writes start-to-stop genes with no premature stop codon", () => {
  const spec = EXPERIMENT_PRESET_SPECS.dna;
  const random = seed(13);
  for (let i = 0; i < 100; i++) {
    const { dnaSequence } = spec.randomize(spec.presets[0].snapshot, random);
    assert.match(dnaSequence, /^ATG(?:[ACGT]{3})+$/);
    const codons = dnaSequence.match(/.{3}/g);
    assert.ok(/^(TAA|TAG|TGA)$/.test(codons.at(-1)));
    assert.equal(codons.slice(0, -1).some(codon => /^(TAA|TAG|TGA)$/.test(codon)), false);
  }
});

test("Neural Pulse networks keep weights bounded and the chosen input audible", () => {
  const spec = EXPERIMENT_PRESET_SPECS.neural;
  const random = seed(17);
  const sigmoid = value => 1 / (1 + Math.exp(-value));
  const reach = s => {
    const input = [0, 1, 2, 3].map(index => (index === s.neuralInput ? 1 : 0.08));
    const hidden = s.neuralWeights[0].map((row, i) => sigmoid((row.reduce((sum, w, j) => sum + w * input[j], s.neuralBiases[0][i])) * s.neuralGain));
    const output = s.neuralWeights[1].map((row, i) => sigmoid((row.reduce((sum, w, j) => sum + w * hidden[j], s.neuralBiases[1][i])) * s.neuralGain));
    return { hidden: Math.max(...hidden), output: Math.max(...output) };
  };
  for (const preset of spec.presets) {
    const r = reach(preset.snapshot);
    assert.ok(r.hidden >= preset.snapshot.neuralThreshold && r.output >= preset.snapshot.neuralThreshold, preset.id);
  }
  for (let i = 0; i < 100; i++) {
    const s = spec.randomize(spec.presets[0].snapshot, random);
    const r = reach(s);
    assert.ok(r.hidden >= s.neuralThreshold && r.output >= s.neuralThreshold);
    assert.equal(s.neuralWeights[0].length, 6);
    assert.equal(s.neuralWeights[1][0].length, 6);
  }
});

test("Ferris snapshots omit the fixed voice processor and keep level 1 enabled", () => {
  const spec = EXPERIMENT_PRESET_SPECS.orbitalFerris;
  const state = sessionState({
    orbitalGestures: 1, orbitalLevels: 3, orbitalRate: 0.1, orbitalRatio: 3, orbitalGestureSeconds: 4, orbitalPitchSpan: 4, orbitalZoom: 0,
    orbitalTone: 110, orbitalGestureMode: "loop", orbitalLevelEnabled: [true, true, true, true, true],
    orbitalLevelShapes: ["circle", "triangle", "square", "line", "star"], orbitalLevelProcessors: ["voice", "modulator", "delay", "pass", "pass"],
  });
  assert.equal(presetStateKey(spec.capture(state)), presetStateKey(spec.presets[0].snapshot));
  assert.equal(spec.capture(state).orbitalLevelProcessors.length, 4);
  applyExperimentPreset("orbitalFerris", spec.presets[2].snapshot, { state });
  assert.equal(state.orbitalLevelProcessors[0], "voice");
  assert.equal(state.orbitalPlaying, true);
  assert.deepEqual(state.orbitalLevelPhases, [0.1, 0.2, 0.3, 0.4]);
  assert.throws(() => spec.validate({ ...spec.presets[0].snapshot, orbitalLevelEnabled: [false, true, true, true, true] }), TypeError);
});

test("apply runs each experiment's restart or refresh hook", () => {
  const expectations = {
    springs: "ensureSpringState", primes: "resetPrimeSieve", doublependulum: "resetDoublePendulum", reaction: "resetReactionDiffusion",
    orbitals: "setOrbital", dna: "setDnaSequence", neural: "fireNeuralInput", fourier: "setFourierWave", orbitalFerris: "updateOrbitalFerrisControls",
  };
  for (const [experiment, hook] of Object.entries(expectations)) {
    const calls = [];
    const hooks = new Proxy({}, { get: (_, name) => () => calls.push(name) });
    applyExperimentPreset(experiment, EXPERIMENT_PRESET_SPECS[experiment].presets[1].snapshot, { state: sessionState(), hooks });
    assert.ok(calls.includes(hook), `${experiment} did not call ${hook}`);
    assert.ok(calls.includes("updateSummaries") && calls.includes("updateCommonAudio"));
  }
});
