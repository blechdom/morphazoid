import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_WAVE_POOL_STATE,
  WAVE_POOL_BOUNDARIES,
  WAVE_POOL_GENERATORS,
  WAVE_POOL_LANE_IDS,
  WAVE_POOL_LIMITS,
  WAVE_POOL_PRESETS,
  WAVE_POOL_RECEIVERS,
  WAVE_POOL_SEQUENCE_LENGTH,
  bubbleResonanceHz,
  createWavePoolRuntime,
  createWavePoolState,
  deriveWavePoolPhysics,
  gravityWaveDispersion,
  sanitizeWavePoolState,
  shallowWaterSpeed,
  stepWavePool,
  wavePoolStepDurationSeconds,
} from "../src/wave-pool.js";
import { WavePoolPhysicalProcessor } from "../src/wave-pool-processor.js";

const root = new URL("../", import.meta.url);
const TEST_SAMPLE_RATE_HZ = 48_000;
const SPECTRUM_FRAME_LENGTH = 2_048;
const zeros = () => Object.fromEntries(WAVE_POOL_LANE_IDS.map((lane) => [
  lane,
  Array(WAVE_POOL_SEQUENCE_LENGTH).fill(0),
]));

function renderBlocks(processor, count = 1, frameCount = 128) {
  const samples = [];
  let peak = 0;
  for (let block = 0; block < count; block += 1) {
    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    assert.equal(processor.process([], [[left, right]]), true);
    for (let index = 0; index < frameCount; index += 1) {
      assert.equal(Number.isFinite(left[index]), true);
      assert.equal(Number.isFinite(right[index]), true);
      peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
      samples.push((left[index] + right[index]) * 0.5);
    }
  }
  return { samples, peak };
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));
}

/**
 * Measure pitch concentration without assuming that a water event is a sine.
 * A Hann window keeps an isolated partial from leaking across the whole band;
 * Goertzel bins keep this dependency-free test inexpensive enough for CI.
 */
function spectralProfile(samples, {
  start = 0,
  length = SPECTRUM_FRAME_LENGTH,
  lowHz = 80,
  highHz = 10_000,
  strongestBinCount = 5,
} = {}) {
  const frameLength = Math.min(length, Math.max(0, samples.length - start));
  assert.ok(frameLength >= 256, "spectral frames need at least 256 samples");
  let mean = 0;
  for (let index = 0; index < frameLength; index += 1) mean += samples[start + index];
  mean /= frameLength;

  const windowed = new Float64Array(frameLength);
  for (let index = 0; index < frameLength; index += 1) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frameLength - 1));
    windowed[index] = (samples[start + index] - mean) * hann;
  }

  const firstBin = Math.max(1, Math.ceil(lowHz * frameLength / TEST_SAMPLE_RATE_HZ));
  const lastBin = Math.min(
    Math.floor(frameLength / 2) - 1,
    Math.floor(highHz * frameLength / TEST_SAMPLE_RATE_HZ),
  );
  const powers = [];
  let totalPower = 0;
  let frequencyWeightedPower = 0;
  for (let bin = firstBin; bin <= lastBin; bin += 1) {
    const coefficient = 2 * Math.cos(2 * Math.PI * bin / frameLength);
    let previous = 0;
    let previousPrevious = 0;
    for (let index = 0; index < frameLength; index += 1) {
      const next = windowed[index] + coefficient * previous - previousPrevious;
      previousPrevious = previous;
      previous = next;
    }
    const power = Math.max(
      0,
      previous * previous + previousPrevious * previousPrevious
        - coefficient * previous * previousPrevious,
    );
    const frequencyHz = bin * TEST_SAMPLE_RATE_HZ / frameLength;
    powers.push(power);
    totalPower += power;
    frequencyWeightedPower += frequencyHz * power;
  }

  const strongestPower = [...powers]
    .sort((left, right) => right - left)
    .slice(0, strongestBinCount)
    .reduce((sum, power) => sum + power, 0);
  return {
    centroidHz: totalPower > 0 ? frequencyWeightedPower / totalPower : 0,
    strongestBinShare: totalPower > 0 ? strongestPower / totalPower : 1,
    totalPower,
  };
}

test("Wave Pool exposes bounded machines, boundaries, receivers, presets, and four polyphonic lanes", () => {
  assert.equal(WAVE_POOL_SEQUENCE_LENGTH, 16);
  assert.deepEqual(WAVE_POOL_LANE_IDS, ["paddle", "breaker", "wall", "vortex"]);
  assert.deepEqual(WAVE_POOL_GENERATORS.map(({ id }) => id), ["piston", "pneumatic"]);
  assert.deepEqual(
    WAVE_POOL_BOUNDARIES.map(({ id }) => id),
    ["concrete", "tile-acrylic", "steel", "liner"],
  );
  assert.deepEqual(WAVE_POOL_RECEIVERS.map(({ id }) => id), ["waterline", "underwater", "deck"]);
  assert.deepEqual(
    WAVE_POOL_PRESETS.map(({ id }) => id),
    ["family-surge", "pneumatic-break", "cross-chop", "vortex-hour", "steel-flume"],
  );
  assert.equal(DEFAULT_WAVE_POOL_STATE.presetId, "family-surge");
  assert.equal(DEFAULT_WAVE_POOL_STATE.level, 0.3);
  assert.ok(DEFAULT_WAVE_POOL_STATE.level <= 0.3, "default must remain intentionally quiet");
  assert.equal(Object.isFrozen(DEFAULT_WAVE_POOL_STATE), true);
  assert.equal(Object.isFrozen(DEFAULT_WAVE_POOL_STATE.pattern), true);
  for (const lane of WAVE_POOL_LANE_IDS) {
    assert.equal(DEFAULT_WAVE_POOL_STATE.pattern[lane].length, 16);
    assert.equal(Object.isFrozen(DEFAULT_WAVE_POOL_STATE.pattern[lane]), true);
  }
});

test("the default pool is water-first instead of panel- or machinery-first", () => {
  for (const state of [DEFAULT_WAVE_POOL_STATE, createWavePoolState()]) {
    assert.ok(state.wallImpact <= 0.2, "default wall modes must sit behind the moving water");
    assert.ok(state.damping >= 0.7, "default concrete return must be heavily water-loaded");
    assert.ok(state.machinery <= 0.1, "default machinery pickup must remain a quiet background detail");
    assert.ok(state.splash >= 0.7, "default breaking events need a broadband splash foreground");
    assert.ok(state.bubbleSize >= 5, "default bubble field must favor low wet pops over tiny chimes");
  }
});

test("hostile settings sanitize to finite physical bounds and wave height stays below shallow breaking depth", () => {
  const state = sanitizeWavePoolState({
    presetId: "not-a-pool",
    generatorId: "unknown",
    boundaryId: "wet-cardboard",
    receiverId: "inside-a-bubble",
    tempoBpm: Infinity,
    swing: -99,
    depthM: 0.01,
    waveHeightM: 99,
    wavePeriodSeconds: NaN,
    paddleForce: Symbol("hostile force"),
    paddleCount: 900,
    phaseSpread: "0.7",
    bubbleSize: 99,
    widthM: -1,
    level: 22,
    pattern: { paddle: [Infinity, -3, "0.7"], wall: null },
  });
  for (const [key, [minimum, maximum]] of Object.entries(WAVE_POOL_LIMITS)) {
    assert.equal(Number.isFinite(state[key]), true, `${key} must be finite`);
    assert.ok(state[key] >= minimum && state[key] <= maximum, `${key} must be bounded`);
  }
  assert.ok(state.waveHeightM <= state.depthM * 0.78 + 1e-12);
  assert.ok(WAVE_POOL_GENERATORS.some(({ id }) => id === state.generatorId));
  assert.ok(WAVE_POOL_BOUNDARIES.some(({ id }) => id === state.boundaryId));
  for (const lane of WAVE_POOL_LANE_IDS) {
    assert.equal(state.pattern[lane].length, 16);
    assert.equal(state.pattern[lane].every((value) => Number.isFinite(value) && value >= 0 && value <= 1), true);
  }
});

test("gravity-wave travel, bubble resonance, and boundary reflection move in the physical directions", () => {
  assert.ok(shallowWaterSpeed(2) > shallowWaterSpeed(0.5));
  const shallow = gravityWaveDispersion(3.5, 0.6);
  const deep = gravityWaveDispersion(3.5, 2.5);
  assert.ok(deep.phaseSpeedMps > shallow.phaseSpeedMps);
  assert.ok(deep.wavelengthM > shallow.wavelengthM);
  assert.ok(bubbleResonanceHz(0.5, 0) > bubbleResonanceHz(5, 0));
  assert.ok(bubbleResonanceHz(1, 2) > bubbleResonanceHz(1, 0));

  const concrete = deriveWavePoolPhysics(createWavePoolState({ boundaryId: "concrete" }));
  const liner = deriveWavePoolPhysics(createWavePoolState({ boundaryId: "liner" }));
  assert.ok(concrete.reflectionCoefficient > liner.reflectionCoefficient);
  assert.ok(concrete.wallTravelSeconds > concrete.acousticReturnSeconds);
  assert.ok(concrete.gravityWaveFrequencyHz < 1, "the visible gravity wave remains sub-audio");
});

test("tempo and swing change event timing without retuning bubble or boundary physics", () => {
  const straight = createWavePoolState({ tempoBpm: 80, swing: 0.2, bubbleSize: 2.4, panelTone: 0.5 });
  const fast = createWavePoolState({ ...straight, tempoBpm: 140 });
  assert.ok(wavePoolStepDurationSeconds(fast, 0) < wavePoolStepDurationSeconds(straight, 0));
  assert.notEqual(wavePoolStepDurationSeconds(straight, 0), wavePoolStepDurationSeconds(straight, 1));
  const firstPhysics = deriveWavePoolPhysics(straight);
  const secondPhysics = deriveWavePoolPhysics(fast);
  assert.equal(firstPhysics.bubbleFrequencyHz, secondPhysics.bubbleFrequencyHz);
  assert.deepEqual(firstPhysics.materialModalRatios, secondPhysics.materialModalRatios);
});

test("the control-rate pool is deterministic, emits causal event families, and stays finite for long runs", () => {
  const state = createWavePoolState("pneumatic-break");
  let first = createWavePoolRuntime({ randomState: 12345 });
  let second = createWavePoolRuntime({ randomState: 12345 });
  const seen = new Set();
  for (let index = 0; index < 6_000; index += 1) {
    first = stepWavePool(state, first, 1 / 120);
    second = stepWavePool(state, second, 1 / 120);
    assert.deepEqual(first, second);
    first.events.forEach(({ type }) => seen.add(type));
    for (const key of [
      "surfaceDisplacementM", "surfaceVelocityMps", "paddleEnergy", "waveEnergy",
      "breakerEnergy", "wallEnergy", "bubbleEnergy", "vortexEnergy", "splashEnergy",
    ]) assert.equal(Number.isFinite(first[key]), true, `${key} must stay finite`);
  }
  assert.ok(seen.has("paddle"));
  assert.ok(seen.has("breaker"));
  assert.ok(seen.has("wall"));
  assert.ok(seen.has("vortex"));
  assert.ok(seen.has("bubble"));
});

test("an undriven pool decays instead of generating a permanent noise source", () => {
  const state = createWavePoolState({
    sequencerEnabled: false,
    pattern: zeros(),
    paddleForce: 0,
    breaking: 0,
    whirlpool: 0,
    aeration: 0,
    machinery: 0,
  });
  let runtime = createWavePoolRuntime({
    waveEnergy: 1,
    breakerEnergy: 1,
    wallEnergy: 1,
    bubbleEnergy: 1,
    vortexEnergy: 1,
    surfaceDisplacementM: 0.8,
    surfaceVelocityMps: 1.2,
  });
  for (let index = 0; index < 4_000; index += 1) runtime = stepWavePool(state, runtime, 1 / 120);
  assert.ok(runtime.waveEnergy < 1e-5);
  assert.ok(runtime.breakerEnergy < 1e-5);
  assert.ok(runtime.wallEnergy < 5e-5);
  assert.ok(runtime.vortexEnergy < 1e-5);
  assert.ok(Math.abs(runtime.surfaceDisplacementM) < 1e-3);
});

test("the worklet is silent before transport, renders every manual family, and panic is exact", () => {
  const silent = new WavePoolPhysicalProcessor({ processorOptions: { configuration: createWavePoolState() } });
  const before = renderBlocks(silent, 8);
  assert.equal(before.peak, 0);

  for (const lane of WAVE_POOL_LANE_IDS) {
    const processor = new WavePoolPhysicalProcessor({ processorOptions: { configuration: createWavePoolState() } });
    processor.port.onmessage({
      data: { type: "trigger", lane, strength: 1, position: { x: lane === "paddle" ? 0.15 : 0.8 } },
    });
    const rendered = renderBlocks(processor, lane === "vortex" ? 90 : 35);
    assert.ok(rendered.peak > 1e-5, `${lane} must produce a nonzero physical event`);
    assert.ok(rms(rendered.samples) > 1e-6, `${lane} must carry energy`);
    assert.ok(rendered.peak <= 0.7191, `${lane} must respect the processor ceiling`);
    processor.port.onmessage({ data: { type: "panic" } });
    assert.equal(renderBlocks(processor, 2).peak, 0, `${lane} panic must be exact silence`);
  }
});

test("default paddle, breaker, wall, and vortex events keep broadband water ahead of pitched ringing", () => {
  const renderedByLane = {};
  for (const lane of WAVE_POOL_LANE_IDS) {
    const processor = new WavePoolPhysicalProcessor({
      processorOptions: { configuration: createWavePoolState() },
    });
    processor.port.onmessage({ data: { type: "trigger", lane, strength: 1 } });
    renderedByLane[lane] = renderBlocks(processor, 96).samples;
  }

  const strongestBinLimits = {
    paddle: 0.35,
    breaker: 0.35,
    wall: 0.35,
    vortex: 0.45,
  };
  for (const lane of WAVE_POOL_LANE_IDS) {
    const samples = renderedByLane[lane];
    assert.ok(rms(samples.slice(0, SPECTRUM_FRAME_LENGTH)) > 1e-5, `${lane} needs an audible attack`);
    const profile = spectralProfile(samples);
    assert.ok(
      profile.strongestBinShare < strongestBinLimits[lane],
      `${lane} must distribute energy like water, not concentrate it into a few musical partials `
        + `(${profile.strongestBinShare.toFixed(3)})`,
    );
  }

  const breakerTail = spectralProfile(renderedByLane.breaker, { start: 1_536 });
  assert.ok(
    breakerTail.strongestBinShare < 0.35,
    `delayed bubble grains must not turn the splash tail into a chime (${breakerTail.strongestBinShare.toFixed(3)})`,
  );

  const wallAttackRms = rms(renderedByLane.wall.slice(0, SPECTRUM_FRAME_LENGTH));
  const wallTailStart = 8_192;
  const wallTail = renderedByLane.wall.slice(wallTailStart, wallTailStart + SPECTRUM_FRAME_LENGTH);
  const wallTailRatio = rms(wallTail) / Math.max(1e-12, wallAttackRms);
  assert.ok(
    wallTailRatio < 0.18,
    `water-loaded concrete must lose its isolated slap quickly (${wallTailRatio.toFixed(3)} attack RMS)`,
  );
  const wallTailProfile = spectralProfile(renderedByLane.wall, { start: wallTailStart });
  assert.ok(
    wallTailProfile.strongestBinShare < 0.35,
    `the remaining concrete tail must be diffuse water noise, not a bell (${wallTailProfile.strongestBinShare.toFixed(3)})`,
  );
});

test("every running preset keeps water texture ahead of narrow musical partials", () => {
  for (const preset of WAVE_POOL_PRESETS) {
    const processor = new WavePoolPhysicalProcessor({
      processorOptions: { configuration: createWavePoolState(preset.id), seed: 123 },
    });
    processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
    const samples = renderBlocks(processor, 1_000).samples;
    const activeProfiles = [];
    for (
      let start = 0;
      start + SPECTRUM_FRAME_LENGTH <= samples.length;
      start += SPECTRUM_FRAME_LENGTH
    ) {
      const frame = samples.slice(start, start + SPECTRUM_FRAME_LENGTH);
      if (rms(frame) <= 1e-4) continue;
      activeProfiles.push(spectralProfile(samples, { start }));
    }
    assert.ok(activeProfiles.length > 4, `${preset.id} needs sustained active water frames`);
    const meanShare = activeProfiles.reduce(
      (sum, profile) => sum + profile.strongestBinShare,
      0,
    ) / activeProfiles.length;
    const maximumShare = Math.max(
      ...activeProfiles.map(({ strongestBinShare }) => strongestBinShare),
    );
    assert.ok(
      meanShare < 0.26,
      `${preset.id} must average as a broadband water field (${meanShare.toFixed(3)})`,
    );
    assert.ok(
      maximumShare < 0.46,
      `${preset.id} must not expose a bell-like active frame (${maximumShare.toFixed(3)})`,
    );
  }
});

test("breaker entrainment can be disabled and active bubble clouds remain irregular", () => {
  const dryProcessor = new WavePoolPhysicalProcessor({
    processorOptions: {
      configuration: createWavePoolState({ bubbleDensity: 0, aeration: 0 }),
    },
  });
  dryProcessor.port.onmessage({ data: { type: "trigger", lane: "breaker", strength: 1 } });
  assert.equal(dryProcessor._activeBubbleCount(), 0, "zero entrained air must schedule zero bubble voices");
  renderBlocks(dryProcessor, 8);
  assert.equal(dryProcessor._activeBubbleCount(), 0, "a dry breaker must not add a delayed bubble chime");

  const wetProcessor = new WavePoolPhysicalProcessor({
    processorOptions: { configuration: createWavePoolState() },
  });
  wetProcessor.port.onmessage({ data: { type: "trigger", lane: "breaker", strength: 1 } });
  const grains = wetProcessor.bubbles.filter(({ active }) => active);
  assert.ok(grains.length >= 2, "an entrained breaker needs multiple bubble grains");
  assert.ok(
    new Set(grains.map(({ delayFrames }) => delayFrames)).size >= 2,
    "bubble grains need irregular onset times",
  );
  const grainFrequencies = grains.map(({ frequencyHz }) => frequencyHz);
  assert.ok(
    Math.max(...grainFrequencies) / Math.max(1, Math.min(...grainFrequencies)) > 1.5,
    "a bubble cloud needs a radius field rather than one tuned pitch",
  );
});

test("bubble radius changes the rendered resonance and hostile event density never breaches the hard ceiling", () => {
  const bubbleSignature = (radiusMm) => {
    const processor = new WavePoolPhysicalProcessor({ processorOptions: { configuration: createWavePoolState() } });
    processor.port.onmessage({ data: { type: "trigger", event: "bubble", radiusMm, velocity: 1 } });
    return renderBlocks(processor, 20).samples;
  };
  const small = bubbleSignature(0.45);
  const large = bubbleSignature(6);
  const smallProfile = spectralProfile(small, { lowHz: 45, highHz: 18_000 });
  const largeProfile = spectralProfile(large, { lowHz: 45, highHz: 18_000 });
  assert.ok(
    smallProfile.centroidHz > largeProfile.centroidHz * 2,
    "smaller bubbles must stay spectrally higher without requiring pure sine ringing",
  );

  const processor = new WavePoolPhysicalProcessor({
    processorOptions: { configuration: createWavePoolState("steel-flume", { level: 0.7 }) },
  });
  processor.port.onmessage({ data: { type: "transport", playing: true } });
  for (let hit = 0; hit < 64; hit += 1) {
    processor.port.onmessage({
      data: { type: "trigger", lane: WAVE_POOL_LANE_IDS[hit % WAVE_POOL_LANE_IDS.length], velocity: 1.5 },
    });
  }
  const rendered = renderBlocks(processor, 500);
  assert.ok(rendered.peak > 0);
  assert.ok(rendered.peak <= 0.7191);
});

test("the page exposes quiet opt-in audio, accessible interaction, responsive layout, and no sample loader", async () => {
  const [html, css, app, model, processor, research] = await Promise.all([
    readFile(new URL("wave-pool.html", root), "utf8"),
    readFile(new URL("wave-pool.css", root), "utf8"),
    readFile(new URL("wave-pool-app.js", root), "utf8"),
    readFile(new URL("src/wave-pool.js", root), "utf8"),
    readFile(new URL("src/wave-pool-processor.js", root), "utf8"),
    readFile(new URL("WAVE_POOL_RESEARCH.md", root), "utf8"),
  ]);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="level"[^>]*max="0\.7"[^>]*value="0\.3"/);
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"[\s\S]*?role="application"/);
  assert.match(html, /id="sequencerGrid"[^>]*role="grid"/);
  assert.match(html, /data-primary-transport/);
  assert.match(html, /entrainment, not assumed cavitation/i);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /connectAudioOutput/);
  assert.match(app, /new AudioWorkletNode/);
  assert.match(processor, /BUBBLE_VOICE_COUNT = 24/);
  assert.match(research, /gravity-wave scheduler/i);
  assert.doesNotMatch(
    `${app}\n${model}\n${processor}`,
    /fetch\s*\(|decodeAudioData|AudioBufferSourceNode|\.(?:mp3|wav)(?:["'?#\s]|$)/i,
  );
});
