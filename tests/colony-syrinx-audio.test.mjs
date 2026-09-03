import assert from "node:assert/strict";
import test from "node:test";

import {
  COLONY_SYRINX_CALLS,
  createColonySyrinxCallState,
  createColonySyrinxState,
} from "../src/colony-syrinx.js";

const render = (processor, seconds, sampleRate, skipSeconds = 0) => {
  const blocks = Math.ceil(seconds * sampleRate / 128);
  const skipFrames = Math.floor(skipSeconds * sampleRate);
  const samples = [];
  let renderedFrames = 0;
  for (let block = 0; block < blocks; block += 1) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    assert.equal(processor.process([], [[left, right]]), true);
    for (let index = 0; index < left.length; index += 1) {
      assert.ok(Number.isFinite(left[index]));
      assert.ok(Number.isFinite(right[index]));
      if (renderedFrames >= skipFrames) samples.push((left[index] + right[index]) * 0.5);
      renderedFrames += 1;
    }
  }
  return samples;
};

const metrics = (samples) => {
  let peak = 0;
  let squares = 0;
  let derivativeSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    peak = Math.max(peak, Math.abs(sample));
    squares += sample * sample;
    if (index > 0) derivativeSquares += (sample - samples[index - 1]) ** 2;
  }
  const rms = Math.sqrt(squares / Math.max(1, samples.length));
  const derivativeRms = Math.sqrt(derivativeSquares / Math.max(1, samples.length - 1));
  const quietThreshold = rms * 0.18;
  const quietShare = samples.filter((sample) => Math.abs(sample) < quietThreshold).length
    / Math.max(1, samples.length);
  return {
    peak,
    rms,
    crest: peak / Math.max(1e-12, rms),
    derivativeRatio: derivativeRms / Math.max(1e-12, rms),
    quietShare,
  };
};

test("all seventy-two calls render finite audible openings and pellet grains ricochet", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  const sampleRate = 16_000;
  let RegisteredProcessor = null;

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }

  globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  globalThis.sampleRate = sampleRate;
  globalThis.registerProcessor = (_name, Processor) => { RegisteredProcessor = Processor; };

  try {
    const processorUrl = new URL("../src/colony-syrinx-processor.js", import.meta.url);
    processorUrl.searchParams.set("atlas-audio-test", String(Date.now()));
    await import(processorUrl.href);
    assert.equal(typeof RegisteredProcessor, "function");

    const processor = new RegisteredProcessor({
      processorOptions: { configuration: createColonySyrinxCallState(0), playing: false },
    });
    const callMetrics = [];
    for (const call of COLONY_SYRINX_CALLS) {
      const state = createColonySyrinxCallState(call.id);
      processor.port.onmessage({ data: { type: "configure", configuration: state } });
      processor.port.onmessage({
        data: {
          type: "call",
          playing: true,
          reset: true,
          durationSeconds: call.durationSeconds,
          callId: call.id,
          articulation: call.articulation,
        },
      });
      const opening = render(processor, 0.62, sampleRate, 0.08);
      const measurement = metrics(opening);
      assert.ok(measurement.peak > 1e-5, `${call.id} peak ${measurement.peak}`);
      assert.ok(measurement.rms > 1e-7, `${call.id} RMS ${measurement.rms}`);
      callMetrics.push({ call, measurement });
    }
    assert.equal(callMetrics.length, 72);

    const allRoutes = Array.from({ length: 4 }, () => [0.82, 0.82, 0.82]);
    const base = createColonySyrinxState();
    const materialResults = {};
    for (const mediumId of ["air", "water", "pellets"]) {
      const configuration = createColonySyrinxState({
        seed: 0x6d61746c,
        mediumId,
        breath: 0.92,
        pressureGain: 1.62,
        level: 0.7,
        colonyAmount: 0,
        sequencerEnabled: false,
        foldEnabled: Array(8).fill(false),
        routes: allRoutes,
        alternateRoutes: allRoutes,
        mouths: base.mouths.map((mouth) => ({ ...mouth, opening: 0.76, slewMs: 4 })),
        articulation: {
          ...base.articulation,
          mode: "flow",
          noise: 0.72,
          brightness: 0.62,
        },
      });
      const materialProcessor = new RegisteredProcessor({
        processorOptions: { configuration, playing: true, breathActive: false },
      });
      const samples = render(materialProcessor, 1.65, sampleRate, 0.35);
      materialResults[mediumId] = {
        ...metrics(samples),
        pelletImpacts: materialProcessor.pelletImpactCount,
        pelletRicochets: materialProcessor.pelletRicochetCount,
      };
    }

    const { air, water, pellets } = materialResults;
    assert.ok(air.rms > 1e-5, `air RMS ${air.rms}`);
    assert.ok(water.rms > 1e-5, `water RMS ${water.rms}`);
    assert.ok(pellets.rms > 1e-5, `pellet RMS ${pellets.rms}`);
    assert.equal(air.pelletImpacts, 0);
    assert.equal(water.pelletImpacts, 0);
    assert.ok(pellets.pelletImpacts >= 12, `pellet impacts ${pellets.pelletImpacts}`);
    assert.ok(
      pellets.pelletRicochets >= pellets.pelletImpacts * 2.7,
      `${pellets.pelletRicochets} ricochets / ${pellets.pelletImpacts} impacts`,
    );
    assert.ok(water.rms < air.rms * 0.72, `water ${water.rms}; air ${air.rms}`);
    assert.ok(
      water.quietShare > air.quietShare * 1.6,
      `water gaps ${water.quietShare}; air ${air.quietShare}`,
    );
    assert.ok(
      pellets.crest > Math.max(air.crest, water.crest) * 1.18,
      `pellet crest ${pellets.crest}; air ${air.crest}; water ${water.crest}`,
    );
    assert.ok(
      pellets.quietShare > Math.max(air.quietShare, water.quietShare),
      `pellet silence ${pellets.quietShare}; air ${air.quietShare}; water ${water.quietShare}`,
    );

    // Imported/shared state can legally contain much wider pitch and tract
    // values than this crowded instrument can sustain comfortably. Exercise
    // that hostile corner explicitly: the DSP must keep it bright and audible
    // without allowing its four simultaneous sources or mouth resonators to
    // settle into power-tool/ultrasonic-adjacent bands.
    const guardSampleRate = 48_000;
    globalThis.sampleRate = guardSampleRate;
    const extreme = createColonySyrinxState({
      seed: 0x73616665,
      mediumId: "air",
      breath: 0.94,
      pressureGain: 2,
      level: 0.72,
      sequencerEnabled: false,
      lungEnabled: Array(16).fill(true),
      phonatorEnabled: Array(4).fill(true),
      foldEnabled: Array(8).fill(true),
      mouthEnabled: Array(3).fill(true),
      phonators: base.phonators.map((phonator) => ({
        ...phonator,
        frequencyHz: 12_000,
        tension: 0.94,
        closure: 0.88,
        roughness: 0.92,
      })),
      routes: allRoutes,
      alternateRoutes: allRoutes,
      mouths: base.mouths.map((mouth) => ({
        ...mouth,
        opening: 0.82,
        tongueSize: 0.94,
        tonguePosition: 0.94,
        lipTension: 0.96,
        cavity: 0.12,
        resonanceHz: 12_000,
        slewMs: 2,
      })),
      articulation: {
        ...base.articulation,
        mode: "flow",
        brightness: 1,
        noise: 1,
      },
    });
    const guardedProcessor = new RegisteredProcessor({
      processorOptions: { configuration: extreme, playing: true, breathActive: false },
    });
    const guardedSamples = render(guardedProcessor, 0.9, guardSampleRate, 0.32);
    const guardedMetrics = metrics(guardedSamples);
    assert.ok(guardedMetrics.rms > 1e-5, `guarded extreme RMS ${guardedMetrics.rms}`);
    assert.ok(
      Math.max(...guardedProcessor.sourceFrequenciesHz) <= 2_600,
      `source ceiling ${Math.max(...guardedProcessor.sourceFrequenciesHz)} Hz`,
    );
    const formantCeilings = [6_200, 7_600, 7_900];
    guardedProcessor.mouths.forEach((mouth, index) => {
      assert.ok(
        Math.max(...mouth.formantsHz) <= formantCeilings[index],
        `mouth ${index + 1} formant ceiling ${Math.max(...mouth.formantsHz)} Hz`,
      );
    });
    assert.ok(guardedProcessor.mouths[2].jetFrequencyHz <= 4_200);
    assert.ok(guardedProcessor.outputLowpassCutoffHz <= 8_200);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});
