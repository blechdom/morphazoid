import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BREATH_INSTRUMENTS,
  MODEL_TIERS,
  RHYTHM_PATTERNS,
  TOPOLOGIES,
  breathCycleFlow,
  directionalModeWeight,
  evidenceCounts,
  excitationGain,
  instrumentPreset,
  linkedBreathRateBpm,
  modeFrequencies,
  mouthFormants,
  rhythmHit,
  rhythmLoopIntervalMs,
  sanitizeBreathAtlasState,
  sourceNeedsGesture,
  sourceRequiresBreath,
  stateForInstrument,
} from "../src/breath-atlas.js";

const root = new URL("../", import.meta.url);

test("breath atlas covers nineteen instruments across six honest source topologies", () => {
  assert.equal(BREATH_INSTRUMENTS.length, 19);
  assert.equal(new Set(BREATH_INSTRUMENTS.map(({ id }) => id)).size, 19);
  assert.deepEqual(new Set(BREATH_INSTRUMENTS.map(({ topology }) => topology)), new Set(Object.keys(TOPOLOGIES)));
  assert.deepEqual(evidenceCounts(), { measured: 7, established: 7, comparative: 5 });
  for (const preset of BREATH_INSTRUMENTS) {
    assert.ok(MODEL_TIERS[preset.tier]);
    assert.ok(preset.description.length > 80);
    assert.ok(preset.modelNote.length > 70);
    assert.match(preset.sourceUrl, /^https:/);
  }
});

test("the highest-evidence families are ordered first", () => {
  assert.equal(BREATH_INSTRUMENTS[0].id, "lesiba");
  assert.equal(instrumentPreset("harmonica").tier, "measured");
  assert.equal(instrumentPreset("khaen").breathMode, "both");
  assert.equal(instrumentPreset("didgeridoo").topology, "lipReed");
  assert.equal(sourceRequiresBreath("didgeridoo"), true);
  assert.equal(sourceNeedsGesture("didgeridoo"), false);
  assert.equal(sourceRequiresBreath("ukeke"), false);
  assert.equal(sourceNeedsGesture("ukeke"), true);
});

test("breath-driven models have no excitation without pressure and outward-only instruments reject inhalation", () => {
  const lesiba = stateForInstrument("lesiba");
  assert.equal(excitationGain(lesiba, 0, 1), 0);
  assert.ok(excitationGain(lesiba, -0.8, 0) > 0.7);
  assert.ok(excitationGain(lesiba, 0.8, 0) > 0.7);
  const didgeridoo = stateForInstrument("didgeridoo");
  assert.equal(excitationGain(didgeridoo, -0.9, 0), 0);
  assert.ok(excitationGain(didgeridoo, 0.9, 0) > 0.8);
  assert.equal(breathCycleFlow(didgeridoo, 0.2), 0);
  assert.ok(breathCycleFlow(didgeridoo, 0.75) > 0);
});

test("inhalation and exhalation produce different physical spectra", () => {
  for (const id of ["lesiba", "harmonica", "khaen", "makomako"]) {
    const inward = Array.from({ length: 8 }, (_, index) => directionalModeWeight(id, -1, index));
    const outward = Array.from({ length: 8 }, (_, index) => directionalModeWeight(id, 1, index));
    assert.notDeepEqual(inward, outward, `${id} needs direction-dependent spectral loading`);
  }
  const harmonica = stateForInstrument("harmonica");
  assert.notDeepEqual(modeFrequencies(harmonica, -1, 8), modeFrequencies(harmonica, 1, 8));
});

test("mouth controls keep ordered, bounded resonances", () => {
  for (const id of ["lesiba", "didgeridoo", "ukeke", "kni"]) {
    const state = stateForInstrument(id, { tonguePosition: 9, jawOpening: -4, lipRounding: 2 });
    assert.equal(state.tonguePosition, 1);
    assert.equal(state.jawOpening, 0);
    assert.equal(state.lipRounding, 1);
    const [f1, f2, f3] = mouthFormants(state).frequenciesHz;
    assert.ok(f1 < f2 && f2 < f3);
  }
});

test("rhythm bank includes non-metronomic loops with force accents and linked breath ratios", () => {
  assert.equal(RHYTHM_PATTERNS.length, 6);
  assert.deepEqual(RHYTHM_PATTERNS[0].steps, [1, 0, 0.82, 0.72]);
  assert.ok(RHYTHM_PATTERNS.every(({ steps }) => steps.includes(0)));
  assert.ok(RHYTHM_PATTERNS.every(({ steps }) => new Set(steps.filter(Boolean)).size > 1));
  const base = stateForInstrument("makomako", {
    gestureRateBpm: 120,
    rhythmId: "quarter-eighths",
    breathSyncRatio: 1,
  });
  assert.equal(rhythmLoopIntervalMs(base), 1_000);
  assert.equal(linkedBreathRateBpm(base), 60);
  assert.equal(linkedBreathRateBpm({ ...base, breathSyncRatio: 2 }), 96);
  assert.deepEqual(rhythmHit(base, 0), { index: 0, velocity: 1, active: true });
  assert.deepEqual(rhythmHit(base, 1), { index: 1, velocity: 0, active: false });
});

test("breath-atlas worklet keeps air sources silent at rest and makes dry plucks much softer", async () => {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    assert.equal(name, "breath-atlas-physical-model");
    Processor = Constructor;
  };
  const render = (processor, blocks = 360) => {
    let squareSum = 0;
    let samples = 0;
    let peak = 0;
    for (let block = 0; block < blocks; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      if (block < blocks * 0.6) continue;
      for (const sample of left) {
        assert.ok(Number.isFinite(sample));
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        samples += 1;
      }
    }
    return { rms: Math.sqrt(squareSum / samples), peak };
  };
  try {
    await import(`../src/breath-atlas-processor.js?test=${Date.now()}`);
    const silentLesiba = new Processor({ processorOptions: { configuration: stateForInstrument("lesiba") } });
    assert.equal(render(silentLesiba, 180).rms, 0);
    const breathingLesiba = new Processor({ processorOptions: { configuration: stateForInstrument("lesiba") } });
    breathingLesiba._handleMessage({ type: "breath", flow: 0.82 });
    const lesibaSound = render(breathingLesiba);
    assert.ok(lesibaSound.rms > 0.001 && lesibaSound.peak < 1);

    const makeHarp = (flow) => {
      const processor = new Processor({ processorOptions: { configuration: stateForInstrument("makomako", { dryResonance: 0.03 }) } });
      processor._handleMessage({ type: "breath", flow });
      processor._handleMessage({ type: "excite", force: 0.8 });
      return render(processor, 220);
    };
    const dry = makeHarp(0);
    const breathed = makeHarp(0.82);
    assert.ok(dry.rms > 0, "dry pluck should remain whisper-audible");
    assert.ok(breathed.rms > dry.rms * 2.5, `breath ${breathed.rms} should dominate dry ${dry.rms}`);
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});

test("page exposes signed breath, coupled rhythms, evidence, and physical worklet", async () => {
  const [html, css, app, processor] = await Promise.all([
    readFile(new URL("breath-atlas.html", root), "utf8"),
    readFile(new URL("breath-atlas.css", root), "utf8"),
    readFile(new URL("breath-atlas-app.js", root), "utf8"),
    readFile(new URL("src/breath-atlas-processor.js", root), "utf8"),
  ]);
  assert.match(html, /class="breath-atlas-page"/);
  assert.match(html, /collection of nineteen breath and mouth instrument physical models/);
  assert.doesNotMatch(html, /data-instrument-info="off"/);
  assert.doesNotMatch(html, /class="atlas-heading"/);
  assert.match(html, /id="inhaleButton"/);
  assert.match(html, /id="exhaleButton"/);
  assert.match(html, /id="rhythmSelect"/);
  assert.match(html, /id="breathSyncRatio"/);
  assert.match(html, /id="dryResonance"/);
  assert.match(html, /MEASURED[\s\S]*DOCUMENTED[\s\S]*APPROXIMATION/);
  assert.match(css, /\.atlas-breath-pad/);
  assert.match(css, /\.atlas-rhythm-section/);
  assert.match(app, /new AudioWorkletNode\(context, "breath-atlas-physical-model"/);
  assert.match(app, /rhythmLoopIntervalMs/);
  assert.match(processor, /registerProcessor\("breath-atlas-physical-model"/);
  assert.match(processor, /class ResonantBandpass/);
});
