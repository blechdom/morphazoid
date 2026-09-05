import assert from "node:assert/strict";
import test from "node:test";

import * as crickets from "../src/crickets.js";

const {
  CRICKET_ANALYSIS_LIMITS,
  CRICKET_DEMO_PRESETS,
  CRICKET_REFERENCE,
  analyzeCricketSong,
  createDemoCricketSong,
  cricketGestureExport,
  renderCricketModel,
} = crickets;

const SAMPLE_RATE = 48_000;

function rmsBetween(samples, sampleRate, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.floor(endSeconds * sampleRate));
  let squareSum = 0;
  for (let index = start; index < end; index += 1) {
    squareSum += samples[index] ** 2;
  }
  return Math.sqrt(squareSum / Math.max(1, end - start));
}

function singlePulseAnalysis({
  sampleRate = SAMPLE_RATE,
  durationSeconds = 0.35,
  pulseStartSeconds = 0.05,
  pulseEndSeconds = 0.15,
  carrierHz = CRICKET_REFERENCE.carrierHz,
} = {}) {
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const hopSize = Math.round(sampleRate * 0.002);
  const frameCount = Math.ceil(sampleCount / hopSize);
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const timeSeconds = index * hopSize / sampleRate;
    const active = timeSeconds >= pulseStartSeconds && timeSeconds <= pulseEndSeconds;
    return { timeSeconds, envelope: active ? 1 : 0, active };
  });
  const pulse = {
    id: "pulse-1",
    startSeconds: pulseStartSeconds,
    endSeconds: pulseEndSeconds,
    centerSeconds: (pulseStartSeconds + pulseEndSeconds) * 0.5,
    durationSeconds: pulseEndSeconds - pulseStartSeconds,
    strength: 1,
  };
  return {
    version: 1,
    sampleRate,
    sampleCount,
    durationSeconds,
    carrierHz,
    toothStrikeRateHz: carrierHz,
    effectiveQ: CRICKET_REFERENCE.wingQ,
    hopSize,
    frames,
    pulses: [pulse],
    chirps: [{
      id: "chirp-1",
      startSeconds: pulseStartSeconds,
      endSeconds: pulseEndSeconds,
      pulseCount: 1,
    }],
  };
}

const ISOLATED_MODE_OPTIONS = Object.freeze({
  coupling: 0,
  wingSplitCents: 0,
  mirrorMix: 0,
  toothIrregularity: 0,
  closingSweep: 0,
  plectrumForce: 0.82,
  seed: 17,
});

test("Crickets exposes the analysis, synthesis, reference, and gesture-export contract", () => {
  assert.deepEqual(Object.keys(crickets), [
    "CRICKET_ANALYSIS_LIMITS",
    "CRICKET_DEMO_PRESETS",
    "CRICKET_REFERENCE",
    "analyzeCricketSong",
    "createDemoCricketSong",
    "cricketGestureExport",
    "renderCricketModel",
  ]);
  assert.equal(Object.isFrozen(CRICKET_ANALYSIS_LIMITS), true);
  assert.equal(Object.isFrozen(CRICKET_REFERENCE), true);
  assert.deepEqual(CRICKET_ANALYSIS_LIMITS, {
    minimumSampleRate: 8_000,
    maximumSampleRate: 192_000,
    maximumDurationSeconds: 12,
    minimumCarrierHz: 1_000,
    maximumCarrierHz: 12_000,
  });
  assert.equal(CRICKET_REFERENCE.species, "Teleogryllus oceanicus");
  assert.equal(CRICKET_REFERENCE.carrierHz, 4_820);
  assert.equal(CRICKET_REFERENCE.wingQ, 23.4);
});

test("the built-in source catalog round-trips three distinct synthetic call patterns", () => {
  assert.equal(Object.isFrozen(CRICKET_DEMO_PRESETS), true);
  assert.deepEqual(
    CRICKET_DEMO_PRESETS.map((preset) => preset.id),
    ["field-chirps", "slow-low-chirps", "fast-high-trill"],
  );
  const analyses = CRICKET_DEMO_PRESETS.map((preset) => {
    assert.match(preset.label, /^Synthetic/);
    const demo = createDemoCricketSong(SAMPLE_RATE, preset.id);
    const analysis = analyzeCricketSong(demo.samples, demo.sampleRate);
    assert.equal(demo.presetId, preset.id);
    assert.equal(analysis.chirps.length, demo.expectedChirps);
    assert.equal(analysis.pulses.length, demo.expectedPulses);
    assert.ok(Math.abs(analysis.carrierHz - demo.referenceCarrierHz) < 180);
    return analysis;
  });
  assert.ok(analyses[1].wingStrokeRateHz < analyses[0].wingStrokeRateHz);
  assert.ok(analyses[2].wingStrokeRateHz > analyses[0].wingStrokeRateHz);
});

test("silence and constant DC produce an explicit empty analysis and silent render", () => {
  for (const samples of [
    new Float32Array(4_800),
    new Float32Array(4_800).fill(0.25),
  ]) {
    const analysis = analyzeCricketSong(samples, SAMPLE_RATE);
    assert.equal(Object.isFrozen(analysis), true);
    assert.equal(analysis.sampleCount, samples.length);
    assert.equal(analysis.durationSeconds, samples.length / SAMPLE_RATE);
    assert.equal(analysis.carrierHz, 0);
    assert.equal(analysis.toothStrikeRateHz, 0);
    assert.equal(analysis.effectiveQ, 0);
    assert.equal(analysis.wingStrokeRateHz, 0);
    assert.equal(analysis.globalRms, 0);
    assert.deepEqual(analysis.frames, []);
    assert.deepEqual(analysis.pulses, []);
    assert.deepEqual(analysis.chirps, []);
    assert.match(analysis.warning, /No signal/i);

    const rendered = renderCricketModel(analysis);
    assert.equal(rendered.sampleRate, SAMPLE_RATE);
    assert.equal(rendered.samples.length, samples.length);
    assert.ok(rendered.samples.every((sample) => sample === 0));
    assert.deepEqual(rendered.stats, { rawPeak: 0, rawRms: 0 });
  }
});

test("the bundled demo round-trips its pulse, chirp, stroke-rate, and carrier gesture", () => {
  const demo = createDemoCricketSong(SAMPLE_RATE);
  const analysis = analyzeCricketSong(demo.samples, demo.sampleRate);

  assert.equal(demo.samples.length, Math.round(4.2 * SAMPLE_RATE));
  assert.equal(demo.samples.every(Number.isFinite), true);
  assert.equal(analysis.pulses.length, demo.expectedPulses);
  assert.equal(analysis.chirps.length, demo.expectedChirps);
  assert.ok(Math.abs(analysis.carrierHz - demo.referenceCarrierHz) < 100);
  assert.equal(analysis.toothStrikeRateHz, analysis.carrierHz);
  assert.ok(Math.abs(analysis.wingStrokeRateHz - 1 / 0.038) < 0.75);
  assert.ok(Math.abs(analysis.medianPulseMs - 26) <= 3);
  assert.ok(analysis.tonalityDb > 15);
  assert.ok(analysis.dutyCycle > 0 && analysis.dutyCycle < 1);

  for (let index = 1; index < analysis.pulses.length; index += 1) {
    assert.ok(analysis.pulses[index].startSeconds >= analysis.pulses[index - 1].endSeconds);
  }
  assert.equal(
    analysis.chirps.reduce((count, chirp) => count + chirp.pulseCount, 0),
    analysis.pulses.length,
  );
});

test("seeded resynthesis is exact, finite, bounded, and preserves the analyzed duration", () => {
  const demo = createDemoCricketSong(SAMPLE_RATE);
  const analysis = analyzeCricketSong(demo.samples, demo.sampleRate);
  const options = {
    resonanceScale: 1.04,
    toothRateRatio: 0.985,
    wingQ: 31,
    coupling: 0.4,
    toothIrregularity: 0.12,
    seed: 0x1234abcd,
  };
  const first = renderCricketModel(analysis, options);
  const second = renderCricketModel(analysis, options);

  assert.deepEqual(first.samples, second.samples);
  assert.equal(first.sampleRate, analysis.sampleRate);
  assert.equal(first.samples.length, analysis.sampleCount);
  assert.equal(first.samples.every(Number.isFinite), true);
  assert.ok(first.samples.some((sample) => sample !== 0));
  assert.ok(first.stats.outputPeak > 0 && first.stats.outputPeak <= 0.88);
  assert.ok(first.stats.outputRms > 0);
  assert.ok(Object.values(first.stats).every(Number.isFinite));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.model), true);
  assert.equal(Object.isFrozen(first.stats), true);
});

test("cycle-by-cycle tooth excitation is strongest when locked to the wing resonance", () => {
  const analysis = singlePulseAnalysis({ pulseEndSeconds: 0.3 });
  const responseRms = (toothRateRatio) => {
    const rendered = renderCricketModel(analysis, {
      ...ISOLATED_MODE_OPTIONS,
      toothRateRatio,
      wingQ: 25,
    });
    return rmsBetween(rendered.samples, SAMPLE_RATE, 0.15, 0.28);
  };
  const responses = new Map([0.8, 0.9, 1, 1.1, 1.2].map((ratio) => (
    [ratio, responseRms(ratio)]
  )));

  assert.equal(
    [...responses].sort((left, right) => right[1] - left[1])[0][0],
    1,
    "the response sweep should peak where tooth strikes repeat at the modal frequency",
  );
  assert.ok(responses.get(1) > responses.get(0.8) * 4);
  assert.ok(responses.get(1) > responses.get(1.2) * 4);
});

test("wing 2 receives energy through coupling rather than the shared tooth drive", () => {
  const analysis = singlePulseAnalysis();
  const render = (coupling, mirrorMix) => renderCricketModel(analysis, {
    ...ISOLATED_MODE_OPTIONS,
    coupling,
    mirrorMix,
    wingSplitCents: 45,
    wingQ: 12,
  });
  const uncoupledOne = render(0, 0);
  const uncoupledBoth = render(0, 0.8);
  assert.deepEqual(
    uncoupledOne.samples,
    uncoupledBoth.samples,
    "wing 2 radiation must be silent when no mechanical energy reaches wing 2",
  );

  const coupledOne = render(0.7, 0);
  const coupledBoth = render(0.7, 0.8);
  assert.notDeepEqual(coupledOne.samples, coupledBoth.samples);
  assert.ok(coupledBoth.model.highModeFrequencyHz > coupledBoth.model.lowModeFrequencyHz);
  assert.ok(coupledBoth.model.couplingCoefficient > 0);
});

test("higher wing Q retains more normalized energy after the final tooth strike", () => {
  const analysis = singlePulseAnalysis();
  const renderAtQ = (wingQ) => renderCricketModel(analysis, {
    ...ISOLATED_MODE_OPTIONS,
    toothRateRatio: 1,
    wingQ,
  }).samples;
  const damped = renderAtQ(5);
  const ringing = renderAtQ(40);
  const activeWindow = [0.1, 0.14];
  const tailWindow = [0.152, 0.156];
  const dampedRetention = rmsBetween(damped, SAMPLE_RATE, ...tailWindow)
    / rmsBetween(damped, SAMPLE_RATE, ...activeWindow);
  const ringingRetention = rmsBetween(ringing, SAMPLE_RATE, ...tailWindow)
    / rmsBetween(ringing, SAMPLE_RATE, ...activeWindow);
  const laterRingingTail = rmsBetween(ringing, SAMPLE_RATE, 0.16, 0.17);

  assert.ok(ringingRetention > dampedRetention * 50);
  assert.ok(laterRingingTail < rmsBetween(ringing, SAMPLE_RATE, ...tailWindow));
});

test("gesture export is JSON-safe and keeps analysis separate from synthesis settings", () => {
  const demo = createDemoCricketSong(SAMPLE_RATE);
  const analysis = analyzeCricketSong(demo.samples, demo.sampleRate);
  const rendered = renderCricketModel(analysis, { seed: 91 });
  const exported = cricketGestureExport(analysis, rendered, "demo-cricket.wav");

  assert.deepEqual(Object.keys(exported), [
    "format",
    "version",
    "source",
    "mechanism",
    "disclaimer",
    "sampleRate",
    "sampleCount",
    "durationSeconds",
    "analysis",
    "synthesis",
  ]);
  assert.equal(exported.format, "morphazoid-cricket-wing-gesture");
  assert.equal(exported.version, 1);
  assert.equal(exported.source, "demo-cricket.wav");
  assert.match(exported.disclaimer, /not recovered wing anatomy/i);
  assert.equal(exported.analysis.pulses, analysis.pulses);
  assert.equal(exported.analysis.chirps, analysis.chirps);
  assert.equal(exported.analysis.envelope.length, analysis.frames.length);
  assert.equal(exported.synthesis, rendered.model);
  assert.equal(Object.isFrozen(exported), true);
  assert.equal(Object.isFrozen(exported.analysis), true);

  const roundTrip = JSON.parse(JSON.stringify(exported));
  assert.equal(roundTrip.analysis.pulses.length, demo.expectedPulses);
  assert.equal(roundTrip.analysis.chirps.length, demo.expectedChirps);
  assert.equal(roundTrip.synthesis.id, "two-dof-cricket-wings-v1");
  assert.ok(roundTrip.analysis.envelope.every(({ timeSeconds, amplitude }) => (
    Number.isFinite(timeSeconds) && Number.isFinite(amplitude)
  )));
});
