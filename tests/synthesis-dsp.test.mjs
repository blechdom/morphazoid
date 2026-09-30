import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SYNTHESIS_METHODS as METHODS, PARAMETER_COUNT, createDefaultState, randomizeState } from "../src/instruments/synthesis/catalog.js";

const bytes = readFileSync(new URL("../assets/wasm/synthesis.wasm", import.meta.url));
const module = new WebAssembly.Module(bytes);
const api = new WebAssembly.Instance(module, {}).exports;
const rate = 32000;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function parameters(engine, params) {
  new Float32Array(api.memory.buffer, api.synth_params_ptr(engine), PARAMETER_COUNT).set(params);
  api.synth_apply_params(engine);
}
function configure(engine, method, preset) {
  api.synth_set_method(engine, method.engineId);
  parameters(engine, preset.params);
  api.synth_set_frequency(engine, preset.frequencyHz);
  api.synth_set_level_trim_db(engine, preset.levelTrimDb ?? 0);
  api.synth_set_envelope(engine, preset.envelope.attack, preset.envelope.decay, preset.envelope.sustain, preset.envelope.release);
  api.synth_reset(engine);
}
function render(engine, length) {
  const result = new Float32Array(length);
  for (let offset = 0; offset < length; offset += 128) {
    const count = Math.min(128, length - offset);
    api.synth_process(engine, count);
    result.set(new Float32Array(api.memory.buffer, api.synth_output_ptr(engine), count), offset);
  }
  return result;
}
function metrics(samples) {
  let sum = 0, peak = 0;
  for (const sample of samples) { assert.ok(Number.isFinite(sample), "non-finite audio sample"); peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; }
  return { rms: Math.sqrt(sum / samples.length), peak };
}

test("published WASM is the current Rust artifact, with no external imports", () => {
  const manifest = JSON.parse(readFileSync(new URL("../assets/wasm/synthesis-build.json", import.meta.url)));
  assert.equal(hash(bytes), manifest.wasmSha256);
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) assert.equal(hash(readFileSync(new URL(`../${path}`, import.meta.url))), expected, `${path}: rebuild synthesis WASM`);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(api.synth_abi_version(), 2);
  assert.equal(api.synth_param_count(), PARAMETER_COUNT);
  assert.equal(manifest.parameters, PARAMETER_COUNT);
  assert.equal(manifest.methods, METHODS.length);
});

test("every factory preset makes finite, bounded, non-silent sound in the actual WASM engine", () => {
  for (const method of METHODS) {
    const engine = api.synth_new(rate);
    try {
      const signatures = new Set();
      for (const preset of method.presets) {
        configure(engine, method, preset);
        api.synth_note_on(engine, preset.frequencyHz, 0.8);
        const samples = render(engine, rate * 2);
        const { rms, peak } = metrics(samples);
        assert.ok(rms > 0.00001, `${method.id}/${preset.id} is silent (${rms})`);
        assert.ok(peak <= 0.950001, `${method.id}/${preset.id} exceeds the bounded core output (${peak})`);
        signatures.add(hash(Buffer.from(samples.buffer)));
      }
      assert.equal(signatures.size, method.presets.length, `${method.id} has duplicate rendered presets`);
    } finally { api.synth_free(engine); }
  }
});

test("all methods start silent, release, reset deterministically, and preserve a held note across method edits", () => {
  const engine = api.synth_new(rate);
  try {
    assert.equal(metrics(render(engine, 1024)).peak, 0);
    for (const method of METHODS) {
      configure(engine, method, method.presets[0]);
      api.synth_set_envelope(engine, 0.002, 0.02, 0.8, 0.02);
      api.synth_note_on(engine, 220, 0.8);
      const first = render(engine, 4096);
      api.synth_reset(engine);
      api.synth_note_on(engine, 220, 0.8);
      assert.deepEqual(render(engine, 4096), first, `${method.id} reset differs`);
      api.synth_note_off(engine);
      const tail = render(engine, rate);
      assert.ok(metrics(tail.subarray(tail.length - 512)).peak < 0.00001, `${method.id} does not release`);
    }
    api.synth_note_on(engine, 180, 0.8);
    for (const method of METHODS) {
      api.synth_set_method(engine, method.engineId);
      parameters(engine, method.presets[0].params);
      assert.ok(metrics(render(engine, 4096)).peak < 1, `${method.id} unsafe transition`);
    }
  } finally { api.synth_free(engine); }
});

test("invalid parameter values and very short blocks cannot poison the render state", () => {
  const engine = api.synth_new(48000);
  try {
    for (const method of METHODS) {
      api.synth_set_method(engine, method.engineId);
      parameters(engine, [NaN, Infinity, -Infinity, -999, 1e20, NaN, Infinity, 0.5]);
      api.synth_set_envelope(engine, NaN, -Infinity, Infinity, -1);
      api.synth_note_on(engine, NaN, Infinity);
      for (const length of [1, 7, 127, 128, 129, 509]) assert.ok(metrics(render(engine, length)).peak < 1);
      api.synth_reset(engine);
    }
  } finally { api.synth_free(engine); }
});


test("random physical strikes and reeds remain audible across coupled exciter/envelope settings", () => {
  for (const sampleRate of [32000, 48000]) {
    const engine = api.synth_new(sampleRate);
    try {
      for (const id of ["physical", "waveguide"]) {
        const method = METHODS.find(method => method.id === id);
        for (let index = 1; index <= 16; index++) {
          let seed = index * 7919;
          const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
          const randomized = randomizeState(createDefaultState(id), rng);
          configure(engine, method, randomized);
          api.synth_note_on(engine, randomized.frequencyHz, 0.8);
          const output = render(engine, sampleRate * 2);
          const { rms, peak } = metrics(output);
          assert.ok(rms > 1e-5, `${id} random ${index} is inaudible at ${sampleRate} Hz`);
          assert.ok(peak <= .950001, `${id} random ${index} exceeds the output ceiling`);
          if (id === "waveguide") assert.ok(metrics(output.subarray(output.length - sampleRate / 4)).rms > 1e-5,
            `reed ${index} must continue sounding after its onset at ${sampleRate} Hz`);
        }
      }
    } finally { api.synth_free(engine); }
  }
});


test("random plucks and vocoder masks keep a useful excitation and occupied source band", () => {
  const seeds = [1, 7, 42, 173, 1024, 2166136261, 305419896, 3735928559,
    ...Array.from({ length: 16 }, (_, index) => (index + 1) * 7919)];
  for (const sampleRate of [32000, 48000]) {
    const engine = api.synth_new(sampleRate);
    try {
      for (const id of ["karplus-strong", "phase-vocoder"]) {
        const method = METHODS.find(method => method.id === id);
        for (const initialSeed of seeds) {
          let seed = initialSeed;
          const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
          const randomized = randomizeState(createDefaultState(id), rng);
          configure(engine, method, randomized);
          api.synth_note_on(engine, randomized.frequencyHz, .8);
          const { rms, peak } = metrics(render(engine, sampleRate * 2));
          assert.ok(rms > 1e-5, `${id}, seed ${initialSeed}, ${sampleRate} Hz has no useful sound`);
          assert.ok(peak <= .950001, `${id}, seed ${initialSeed} exceeds the output ceiling`);
        }
      }
    } finally { api.synth_free(engine); }
  }
});


test("every exposed parameter reaches both endpoints without non-finite or unbounded audio", () => {
  for (const sampleRate of [32000, 48000]) {
    const engine = api.synth_new(sampleRate);
    try {
      for (const method of METHODS) {
        const base = method.presets[0];
        for (let index = 0; index < method.controls.length; index++) for (const endpoint of [0, 1]) {
          const params = [...base.params]; params[index] = endpoint;
          configure(engine, method, { ...base, params });
          api.synth_set_envelope(engine, .002, .04, .8, .03);
          api.synth_note_on(engine, base.frequencyHz, .8);
          const result = metrics(render(engine, 4096));
          assert.ok(result.peak <= .950001, `${method.id}/${method.controls[index].id} at ${endpoint}, ${sampleRate} Hz`);
        }
      }
    } finally { api.synth_free(engine); }
  }
});


test("LPC and vocoder factory gains preserve resonance headroom instead of pinning the limiter", () => {
  const engine = api.synth_new(48000);
  try {
    for (const method of [METHODS[8], METHODS[28]]) for (const preset of method.presets) {
      configure(engine, method, preset);
      api.synth_note_on(engine, preset.frequencyHz, .8);
      const samples = render(engine, 72000);
      const limited = samples.reduce((count, sample) => count + Number(Math.abs(sample) > .8), 0) / samples.length;
      assert.ok(limited < .01, `${method.id}/${preset.id}: ${limited} of samples at output ceiling`);
      assert.ok(metrics(samples).rms > 1e-5, "headroom does not suppress the sound");
    }
  } finally { api.synth_free(engine); }
});


test("factory calibration evidence matches this engine and bank, with useful short-event levels and headroom", () => {
  const report = JSON.parse(readFileSync(new URL("../docs/synthesis-level-calibration.json", import.meta.url)));
  const fixtures = METHODS.map(m => ({ engineId: m.engineId, id: m.id, presets: m.presets.map(p => ({ id: p.id, params: p.params, frequencyHz: p.frequencyHz, envelope: p.envelope })) }));
  assert.equal(report.metadata.wasmSha256, hash(bytes), "rerun calibration after changing the engine");
  assert.equal(report.metadata.signalFixtureSha256, hash(JSON.stringify(fixtures)), "rerun calibration after changing factory sounds");
  const bank = new Map(METHODS.flatMap(m => m.presets.map(p => [`${m.id}/${p.id}`, p])));
  assert.equal(report.rows.length, bank.size);
  assert.equal(new Set(report.rows.map(r => r.key)).size, bank.size);
  const browserOffset = 20 * Math.log10(createDefaultState().outputLevel);
  assert.equal(report.metadata.targetCoreScoreDb, -12, "factory target must not regress to the quiet -18 dB calibration");
  assert.equal(report.metadata.peakCap, .78);
  for (const row of report.rows) {
    assert.equal(row.trimDb, bank.get(row.key)?.levelTrimDb, `${row.key} calibration applied`);
    assert.equal(row.after.nonfinite, 0, row.key);
    assert.equal(row.after.kneeSamples, 0, `${row.key} keeps its attack outside the emergency limiter`);
    assert.ok(row.after.peak <= .7801, `${row.key} leaves factory peak headroom`);
    for (const [sampleRate, measured] of Object.entries(row.extraRateVerification)) {
      assert.equal(measured.nonfinite, 0, `${row.key} at ${sampleRate} Hz`);
      assert.equal(measured.kneeSamples, 0, `${row.key} keeps stochastic/rate headroom at ${sampleRate} Hz`);
      assert.ok(measured.peak <= .7801, `${row.key} peak at ${sampleRate} Hz`);
    }
    if (row.engineId === 43) {
      assert.equal(row.peakReferenceTrials.length, 48, "shakers cover 16 RNG positions at three rates");
      assert.ok(row.sampledBrowserMax10msFloorDb > -33, `${row.key} remains useful across sampled collision patterns`);
    }
    // A short strike can legitimately have low 400 ms energy. Guard its actual
    // 10 ms signal too, instead of accepting the previous near-silence floor.
    assert.ok(row.after.max10msRmsDb + browserOffset > -32, `${row.key} has a useful short-event level`);
    assert.ok(row.after.max50msRmsDb + browserOffset > -34, `${row.key} remains measurable over 50 ms`);
  }
  const levels = report.rows.map(r => r.browserAfter.scoreDb).sort((a,b) => a-b);
  assert.ok(levels[Math.floor(levels.length/2)] >= -15.2, "median factory output reaches the new listening level");
  // A sparse impact and a held tone have different crest factors. Equalizing
  // their 400 ms energy at any cost would clip attacks. Assert the target for
  // every preset with headroom, and the maximum safe static gain otherwise.
  for (const row of report.rows) {
    if (!row.peakLimited) assert.ok(Math.abs(row.browserAfter.scoreDb - (-12 + browserOffset)) < .02, row.key + " reaches the target");
    else assert.ok(Math.abs(row.trimDb - Math.min(row.desiredTrimDb, row.peakAllowedTrimDb)) < .1, row.key + " uses its available peak headroom");
  }
  const pin = report.rows.find(row => row.key === "karplus-strong/high-harmonic-pin");
  assert.ok(pin.browserAfter.scoreDb > -17, "high string harmonics remain audible beyond the pick transient");
  const pulse = report.rows.find(row => row.key === "pulsar/hard-window-tick");
  assert.ok(pulse.browserAfter.scoreDb > -23, "hard pulsaret example has useful audible-band energy");
});
