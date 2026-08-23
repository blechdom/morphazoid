import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KARPLUS_CARPET_DEFAULTS,
  KARPLUS_CARPET_LIMITS,
  KARPLUS_CARPET_TEXTURE_PRESETS,
  KarplusCarpetAudio,
  generateKarplusCarpetSamples,
  karplusCarpetEnvelopeTiming,
  karplusCarpetPitchAtPosition,
  karplusCarpetPointerEvent,
  karplusCarpetPositionFromStageX,
  karplusCarpetRenderSampleRate,
  karplusCarpetSpatialCellAtPosition,
  karplusCarpetSpatialCellSeed,
  karplusCarpetSpatialCrossings,
  karplusCarpetSpatialGrid,
  karplusCarpetStageGeometry,
  mergeKarplusCarpetPresetSettings,
  normalizeKarplusCarpetSamples,
  sanitizeKarplusCarpetSettings,
} from "../src/karplus-carpet.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PRESETS,
  karplusStrongStringFrequencies,
  sanitizeKarplusStrongSettings,
} from "../src/karplus-strong.js";

const root = new URL("../", import.meta.url);

test("Karplus Carpet settings keep spatial grains and pitch fields bounded", () => {
  const low = sanitizeKarplusCarpetSettings({
    grainDuration: -1,
    attackDuration: -1,
    decayDuration: -1,
    sustainLevel: -1,
    releaseDuration: -1,
    timbreVariation: -1,
    velocityScatter: -1,
    stereoSpread: -1,
    gainTrim: -1,
    centerPosition: -2,
    lowFrequency: -20,
    highFrequency: -10,
    divisionsPerOctave: -4,
    spacing: "unknown",
  });
  assert.equal(low.grainDuration, 0.08);
  assert.equal(low.attackDuration, 0.001);
  assert.equal(low.decayDuration, 0.005);
  assert.equal(low.sustainLevel, 0);
  assert.equal(low.releaseDuration, 0.005);
  assert.equal(low.timbreVariation, 0);
  assert.equal(low.velocityScatter, 0);
  assert.equal(low.stereoSpread, 0);
  assert.equal(low.gainTrim, KARPLUS_CARPET_LIMITS.minimumGainTrim);
  assert.equal(low.centerPosition, 0);
  assert.equal(low.spacing, "octave");
  assert.ok(low.highFrequency > low.lowFrequency);

  const high = sanitizeKarplusCarpetSettings({
    grainDuration: 8,
    attackDuration: 8,
    decayDuration: 8,
    sustainLevel: 8,
    releaseDuration: 8,
    timbreVariation: 8,
    velocityScatter: 4,
    stereoSpread: 4,
    gainTrim: 8,
    centerPosition: 4,
    divisionsPerOctave: 999,
    spacing: "equal-hz",
  });
  assert.equal(high.grainDuration, 0.4);
  assert.equal(high.attackDuration, 0.12);
  assert.equal(high.decayDuration, 0.3);
  assert.equal(high.sustainLevel, 1);
  assert.equal(high.releaseDuration, 0.4);
  assert.equal(high.timbreVariation, 1);
  assert.equal(high.velocityScatter, 1);
  assert.equal(high.stereoSpread, 1);
  assert.equal(high.gainTrim, KARPLUS_CARPET_LIMITS.maximumGainTrim);
  assert.equal(high.centerPosition, 1);
  assert.equal(high.divisionsPerOctave, 48);
  assert.equal(high.spacing, "equal-hz");
});

test("Carpet-native textures combine bounded material and gesture settings", () => {
  assert.equal(KARPLUS_CARPET_TEXTURE_PRESETS.length, 12);
  assert.equal(
    new Set(KARPLUS_CARPET_TEXTURE_PRESETS.map(({ id }) => id)).size,
    KARPLUS_CARPET_TEXTURE_PRESETS.length,
  );
  const strongKeys = Object.keys(KARPLUS_STRONG_DEFAULTS);
  for (const item of KARPLUS_CARPET_TEXTURE_PRESETS) {
    assert.match(item.id, /^texture-/);
    assert.ok(item.name.length > 3);
    assert.ok(item.description.length > 24);
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.settings));
    const strong = sanitizeKarplusStrongSettings(item.settings);
    for (const key of strongKeys) assert.equal(item.settings[key], strong[key]);
    const carpet = sanitizeKarplusCarpetSettings(item.settings);
    for (const key of [
      "grainDuration", "attackDuration", "decayDuration", "sustainLevel",
      "releaseDuration", "timbreVariation", "velocityScatter", "stereoSpread",
      "gainTrim",
    ]) assert.equal(item.settings[key], carpet[key]);
    const envelope = karplusCarpetEnvelopeTiming(item.settings, item.settings.grainDuration);
    assert.ok(
      envelope.endOffset * (2 ** (200 / 1_200))
        < KARPLUS_CARPET_LIMITS.maximumRenderDuration,
    );
  }
});

test("every Carpet texture retains audible post-envelope energy across the pitch field", () => {
  const sampleRate = 12_000;
  const frequencies = [110, 311.13, 880];
  const envelopeGainAt = (time, envelope) => {
    if (time <= envelope.attackEndOffset) {
      return time / envelope.attackDuration;
    }
    if (time <= envelope.decayEndOffset) {
      const progress = (time - envelope.attackEndOffset) / envelope.decayDuration;
      return envelope.sustainLevel ** progress;
    }
    if (time <= envelope.releaseStartOffset) return envelope.sustainLevel;
    if (time <= envelope.endOffset) {
      const progress = (time - envelope.releaseStartOffset) / envelope.releaseDuration;
      return envelope.sustainLevel * ((0.0001 / envelope.sustainLevel) ** progress);
    }
    return 0;
  };

  for (const item of KARPLUS_CARPET_TEXTURE_PRESETS) {
    for (const frequency of frequencies) {
      for (let variant = 0; variant < 4; variant += 1) {
        const envelope = karplusCarpetEnvelopeTiming(
          item.settings,
          item.settings.grainDuration,
        );
        const samples = normalizeKarplusCarpetSamples(generateKarplusCarpetSamples({
          frequency,
          duration: envelope.endOffset,
          timbreVariant: variant,
          timbre: (-1 + variant * (2 / 3)) * item.settings.timbreVariation,
        }, item.settings, sampleRate), sampleRate);
        let energy = 0;
        let peak = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const value = samples[index]
            * envelopeGainAt(index / sampleRate, envelope)
            * item.settings.gainTrim;
          energy += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
        const rms = Math.sqrt(energy / samples.length);
        assert.ok(rms > 0.005, `${item.name} ${frequency} Hz variant ${variant} RMS ${rms}`);
        assert.ok(peak <= KARPLUS_CARPET_LIMITS.maximumGainTrim + 1e-6);
      }
    }
  }
});

test("material presets drop a prior texture's private loudness trim", () => {
  const texture = KARPLUS_CARPET_TEXTURE_PRESETS.find(({ id }) => id === "texture-frozen-halo");
  const material = KARPLUS_STRONG_PRESETS.find(({ id }) => id === "nylon");
  const textured = mergeKarplusCarpetPresetSettings(KARPLUS_CARPET_DEFAULTS, texture.settings);
  const restored = mergeKarplusCarpetPresetSettings(textured, material.settings);
  assert.equal(textured.gainTrim, texture.settings.gainTrim);
  assert.equal(restored.gainTrim, KARPLUS_CARPET_DEFAULTS.gainTrim);
  assert.equal(restored.grainDuration, texture.settings.grainDuration);
  assert.equal(restored.hardness, material.settings.hardness);
});

test("Carpet buffers use an adaptive synthesis rate without folding high pitches", () => {
  assert.equal(karplusCarpetRenderSampleRate(48_000, 110, 220), 24_000);
  assert.equal(karplusCarpetRenderSampleRate(48_000, 6_000, 6_000), 30_000);
  assert.equal(karplusCarpetRenderSampleRate(44_100, 8_000, 16_000), 44_100);
  assert.equal(karplusCarpetRenderSampleRate(16_000, 110, 220), 16_000);
});

test("cell color produces four deterministic bounded excitation variants", () => {
  const settings = { ...KARPLUS_CARPET_DEFAULTS, timbreVariation: 1, gainTrim: 0.68 };
  const variants = new Set();
  for (let index = 0; index < 96; index += 1) {
    const first = karplusCarpetPointerEvent(settings, index, { seed: index + 1, position: 0.5 });
    const repeat = karplusCarpetPointerEvent(settings, index, { seed: index + 1, position: 0.5 });
    assert.equal(first.timbre, repeat.timbre);
    assert.equal(first.timbreVariant, repeat.timbreVariant);
    assert.ok(first.timbre >= -1 && first.timbre <= 1);
    assert.equal(first.gainTrim, 0.68);
    variants.add(first.timbreVariant);
  }
  assert.deepEqual([...variants].sort(), [0, 1, 2, 3]);

  const uniform = karplusCarpetPointerEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    timbreVariation: 0,
  }, 4, { seed: 19, position: 0.5 });
  assert.equal(uniform.timbre, 0);
  assert.equal(uniform.timbreVariant, 0);
});

test("one-shot Carpet ADSR releases after the body or completed decay", () => {
  const normal = karplusCarpetEnvelopeTiming(KARPLUS_CARPET_DEFAULTS, 0.16);
  assert.equal(normal.attackEndOffset, 0.002);
  assert.equal(normal.decayEndOffset, 0.047);
  assert.equal(normal.releaseStartOffset, 0.16);
  assert.equal(normal.endOffset, 0.24);

  const longOpening = karplusCarpetEnvelopeTiming({
    ...KARPLUS_CARPET_DEFAULTS,
    attackDuration: 0.12,
    decayDuration: 0.3,
    sustainLevel: 0.64,
    releaseDuration: 0.4,
  }, 0.08);
  assert.equal(longOpening.releaseStartOffset, 0.42);
  assert.ok(Math.abs(longOpening.endOffset - 0.82) < 1e-12);
  assert.equal(longOpening.sustainLevel, 0.64);
  assert.ok(
    longOpening.endOffset * (2 ** (200 / 1_200))
      < KARPLUS_CARPET_LIMITS.maximumRenderDuration,
  );

  const snapshotted = karplusCarpetPointerEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    attackDuration: 0.013,
    decayDuration: 0.075,
    sustainLevel: 0.51,
    releaseDuration: 0.19,
  }, 2, { seed: 7, position: 0.5 });
  assert.equal(snapshotted.attackDuration, 0.013);
  assert.equal(snapshotted.decayDuration, 0.075);
  assert.equal(snapshotted.sustainLevel, 0.51);
  assert.equal(snapshotted.releaseDuration, 0.19);
});

test("the Carpet stage is divided into close two-dimensional micro-areas", () => {
  const settings = sanitizeKarplusCarpetSettings(KARPLUS_CARPET_DEFAULTS);
  const frequencies = karplusStrongStringFrequencies(settings);
  const grid = karplusCarpetSpatialGrid(1_000, 600, { pitchCount: frequencies.length });
  assert.ok(grid.columns >= frequencies.length);
  assert.ok(grid.cellWidth <= KARPLUS_CARPET_LIMITS.spatialCellSize);
  assert.ok(grid.cellHeight <= KARPLUS_CARPET_LIMITS.spatialCellSize);
  assert.ok(grid.columns >= KARPLUS_CARPET_LIMITS.minimumSpatialColumns);
  assert.ok(grid.rows >= KARPLUS_CARPET_LIMITS.minimumSpatialRows);

  const first = karplusCarpetSpatialCellAtPosition(
    1_000,
    600,
    grid.left,
    grid.top,
    { grid },
  );
  const last = karplusCarpetSpatialCellAtPosition(
    1_000,
    600,
    grid.right,
    grid.bottom,
    { grid },
  );
  assert.deepEqual([first.column, first.row], [0, 0]);
  assert.deepEqual([last.column, last.row], [grid.columns - 1, grid.rows - 1]);
  assert.equal(karplusCarpetSpatialCellSeed(first), karplusCarpetSpatialCellSeed(first));
  assert.notEqual(karplusCarpetSpatialCellSeed(first), karplusCarpetSpatialCellSeed(last));
  assert.equal(
    karplusCarpetSpatialCellAtPosition(1_000, 600, grid.left - 0.01, grid.top, { grid }),
    null,
  );
});

test("spatial crossings are silent within an area and enumerate every crossed area", () => {
  const grid = karplusCarpetSpatialGrid(800, 500, { cellSize: 12, pitchCount: 37 });
  const point = (column, row, xAmount = 0.5, yAmount = 0.5) => ({
    x: grid.left + (column + xAmount) * grid.cellWidth,
    y: grid.top + (row + yAmount) * grid.cellHeight,
  });

  assert.deepEqual(
    karplusCarpetSpatialCrossings(point(2, 3), point(2, 3, 0.8), {
      width: 800, height: 500, grid,
    }),
    [],
  );
  const forward = karplusCarpetSpatialCrossings(point(2, 3), point(7, 3), {
    width: 800, height: 500, grid,
  });
  assert.deepEqual(forward.map(({ column, row }) => [column, row]), [
    [3, 3], [4, 3], [5, 3], [6, 3], [7, 3],
  ]);
  const reverse = karplusCarpetSpatialCrossings(point(7, 3), point(2, 3), {
    width: 800, height: 500, grid,
  });
  assert.deepEqual(reverse.map(({ column, row }) => [column, row]), [
    [6, 3], [5, 3], [4, 3], [3, 3], [2, 3],
  ]);
  const vertical = karplusCarpetSpatialCrossings(point(4, 2), point(4, 6), {
    width: 800, height: 500, grid,
  });
  assert.deepEqual(vertical.map(({ column, row }) => [column, row]), [
    [4, 3], [4, 4], [4, 5], [4, 6],
  ]);

  const visited = new Set(["2:3"]);
  const firstGesturePass = forward.filter((cell) => !visited.has(cell.key));
  for (const cell of firstGesturePass) visited.add(cell.key);
  const returnPass = reverse.filter((cell) => !visited.has(cell.key));
  assert.equal(firstGesturePass.length, 5);
  assert.equal(returnPass.length, 0, "an area sounds only once until the next gesture");
  const rearmed = new Set(["7:3"]);
  assert.equal(
    reverse.filter((cell) => !rearmed.has(cell.key)).length,
    5,
    "a new gesture rearms areas",
  );
});

test("direct Carpet pitch follows the pointer's visible pitch field", () => {
  const settings = sanitizeKarplusCarpetSettings({
    ...KARPLUS_CARPET_DEFAULTS,
    lowFrequency: 110,
    highFrequency: 880,
    divisionsPerOctave: 12,
  });
  const frequencies = karplusStrongStringFrequencies(settings);
  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    const pitch = karplusCarpetPitchAtPosition(settings, position, frequencies);
    const expectedIndex = Math.round(position * (frequencies.length - 1));
    assert.equal(pitch.frequencyIndex, expectedIndex);
    assert.equal(pitch.frequency, frequencies[expectedIndex]);
    const first = karplusCarpetPointerEvent(settings, 3, {
      seed: 11,
      frequencies,
      position,
      visualY: 0.3,
    });
    const alternate = karplusCarpetPointerEvent(settings, 29, {
      seed: 999,
      frequencies,
      position,
      visualY: 0.3,
    });
    assert.equal(first.frequency, frequencies[expectedIndex]);
    assert.equal(alternate.frequency, frequencies[expectedIndex]);
    assert.equal(first.visualY, 0.3);
  }

  const geometry = karplusCarpetStageGeometry(1_000, 600);
  assert.equal(karplusCarpetPositionFromStageX(geometry.left - 40, 1_000), 0);
  assert.equal(karplusCarpetPositionFromStageX(geometry.left, 1_000), 0);
  assert.equal(
    karplusCarpetPositionFromStageX((geometry.left + geometry.right) / 2, 1_000),
    0.5,
  );
  assert.equal(karplusCarpetPositionFromStageX(geometry.right, 1_000), 1);
  assert.equal(karplusCarpetPositionFromStageX(geometry.right + 40, 1_000), 1);
});

test("a Carpet grain is a bounded Karplus waveform rather than a loaded sample", () => {
  const event = karplusCarpetPointerEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    grainDuration: 0.12,
  }, 3, { seed: 83, position: 0.4, visualY: 0.6 });
  const samples = generateKarplusCarpetSamples(
    { ...event, duration: 0.12 },
    KARPLUS_STRONG_DEFAULTS,
    48_000,
  );
  assert.equal(samples.length, 5_760);
  assert.ok(samples.some((value) => Math.abs(value) > 0.001));
  for (const value of samples) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= -1 && value <= 1);
  }
});

test("coupled materials render a second resonator into the cached grain", () => {
  const event = {
    duration: 0.18,
    frequency: 220,
    seed: 1,
    timbre: 0,
    timbreVariant: 0,
  };
  const dry = generateKarplusCarpetSamples(
    event,
    { ...KARPLUS_STRONG_DEFAULTS, coupling: 0 },
    24_000,
  );
  const coupled = generateKarplusCarpetSamples(
    event,
    {
      ...KARPLUS_STRONG_DEFAULTS,
      coupling: 1,
      couplingRatio: 1.5,
      couplingDetune: 0,
    },
    24_000,
  );
  assert.equal(coupled.length, dry.length);
  let difference = 0;
  for (let index = 0; index < dry.length; index += 1) {
    difference += Math.abs(dry[index] - coupled[index]);
    assert.ok(coupled[index] >= -1 && coupled[index] <= 1);
  }
  assert.ok(difference / dry.length > 0.003);
});

test("thread decay remains an audible material dimension inside the ADSR window", () => {
  const event = {
    duration: 0.18,
    frequency: 220,
    seed: 1,
    timbre: 0,
    timbreVariant: 0,
  };
  const damped = generateKarplusCarpetSamples(
    event,
    { ...KARPLUS_STRONG_DEFAULTS, decay: 0.2, coupling: 0 },
    24_000,
  );
  const ringing = generateKarplusCarpetSamples(
    event,
    { ...KARPLUS_STRONG_DEFAULTS, decay: 6, coupling: 0 },
    24_000,
  );
  const lateStart = Math.floor(damped.length * 0.7);
  const lateRms = (samples) => {
    let energy = 0;
    for (let index = lateStart; index < samples.length; index += 1) {
      energy += samples[index] ** 2;
    }
    return Math.sqrt(energy / Math.max(1, samples.length - lateStart));
  };
  assert.ok(lateRms(ringing) > lateRms(damped) * 8);
});

test("Carpet normalizes quiet micro-attacks without allowing sample clipping", () => {
  const quiet = new Float32Array(48_000 * 0.2).fill(0.01);
  const normalizedQuiet = normalizeKarplusCarpetSamples(quiet, 48_000);
  assert.equal(normalizedQuiet.length, quiet.length);
  assert.ok(Math.abs(normalizedQuiet[0] - 0.036) < 1e-6);
  assert.ok(normalizedQuiet[0] > quiet[0]);

  const hot = new Float32Array([0.9, -0.9, Number.NaN, Number.POSITIVE_INFINITY]);
  const normalizedHot = normalizeKarplusCarpetSamples(hot, 48_000);
  assert.deepEqual([...normalizedHot], [1, -1, 0, 0]);
  for (const value of normalizedHot) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= -1 && value <= 1);
  }
});

test("Karplus Carpet audio schedules short grains, bends them live, and stops cleanly", async () => {
  const starts = [];
  const stops = [];
  const buffers = [];
  const gains = [];
  const compressors = [];
  const detuneCalls = [];
  const parameter = (value = 0) => ({
    value,
    events: [],
    setValueAtTime(next, at) {
      this.value = next;
      this.events.push(["set", next, at]);
      detuneCalls.push(["value", next, at]);
    },
    linearRampToValueAtTime(next, at) {
      this.value = next;
      this.events.push(["linear", next, at]);
    },
    exponentialRampToValueAtTime(next, at) {
      this.value = next;
      this.events.push(["exponential", next, at]);
    },
    setTargetAtTime(next, at, smoothing) {
      this.value = next;
      this.events.push(["target", next, at, smoothing]);
      detuneCalls.push(["target", next, at, smoothing]);
    },
    cancelScheduledValues() {},
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
    disconnect() {},
  });

  class FakeContext {
    constructor() {
      this.state = "running";
      this.currentTime = 2;
      this.sampleRate = 24_000;
      this.destination = node();
    }

    createGain() {
      const gain = node({ gain: parameter(1) });
      gains.push(gain);
      return gain;
    }
    createDynamicsCompressor() {
      const compressor = node({
        threshold: parameter(), knee: parameter(), ratio: parameter(),
        attack: parameter(), release: parameter(),
      });
      compressors.push(compressor);
      return compressor;
    }
    createAnalyser() { return node({ fftSize: 0, smoothingTimeConstant: 0 }); }
    createBiquadFilter() {
      return node({ frequency: parameter(350), Q: parameter(1), gain: parameter(0) });
    }
    createStereoPanner() { return node({ pan: parameter(0) }); }
    createBuffer(channels, frameCount, sampleRate) {
      const samples = new Float32Array(frameCount);
      const buffer = {
        duration: frameCount / sampleRate,
        getChannelData() { return samples; },
      };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      return node({
        buffer: null,
        detune: parameter(0),
        playbackRate: parameter(1),
        onended: null,
        start(when) { starts.push(when); },
        stop(when) { stops.push(when); },
      });
    }
    async close() { this.state = "closed"; }
  }

  const audio = new KarplusCarpetAudio({ AudioContext: FakeContext });
  const event = karplusCarpetPointerEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    grainDuration: 0.12,
    attackDuration: 0.01,
    decayDuration: 0.02,
    sustainLevel: 0.4,
    releaseDuration: 0.05,
    gainTrim: 0.65,
  }, 0, { seed: 91, position: 0.5, visualY: 0.5, velocity: 0.5 });
  const scheduled = await audio.scheduleGrain(
    { ...event, duration: 0.12 },
    KARPLUS_STRONG_DEFAULTS,
    { when: 2.25, density: 28, renderDuration: 0.3 },
  );
  assert.equal(gains[0].gain.value, 0.72);
  assert.equal(compressors[0].threshold.value, -18);
  assert.equal(compressors[0].knee.value, 12);
  assert.equal(compressors[0].ratio.value, 8);
  assert.equal(compressors[0].release.value, 0.18);
  assert.equal(starts.at(-1), 2.25);
  assert.equal(scheduled.when, 2.25);
  assert.equal(scheduled.envelope.attackEndOffset, 0.01);
  assert.equal(scheduled.envelope.decayEndOffset, 0.03);
  assert.equal(scheduled.envelope.releaseStartOffset, 0.12);
  assert.ok(Math.abs(scheduled.envelope.endOffset - 0.17) < 1e-12);
  assert.equal(scheduled.renderDuration, 0.3);
  assert.equal(scheduled.renderSampleRate, 24_000);
  assert.ok(
    buffers[0].duration >= scheduled.envelope.endOffset * (2 ** (200 / 1_200)),
  );
  assert.ok(buffers[0].duration <= KARPLUS_CARPET_LIMITS.maximumRenderDuration);

  const envelopeAutomation = gains.at(-1).gain.events;
  assert.deepEqual(envelopeAutomation.map(([method]) => method), [
    "set", "linear", "exponential", "set", "exponential",
  ]);
  const expectedTimes = [2.25, 2.26, 2.28, 2.37, 2.42];
  for (let index = 0; index < expectedTimes.length; index += 1) {
    assert.ok(Math.abs(envelopeAutomation[index][2] - expectedTimes[index]) < 1e-12);
  }
  const expectedPeak = 0.5
    * KARPLUS_CARPET_LIMITS.voiceGainScale
    * Math.sqrt(4 / 28)
    * 0.65;
  assert.ok(Math.abs(envelopeAutomation[1][1] - expectedPeak) < 1e-12);
  assert.ok(Math.abs(
    envelopeAutomation[2][1] - envelopeAutomation[1][1] * event.sustainLevel,
  ) < 1e-12);
  assert.equal(envelopeAutomation[3][1], envelopeAutomation[2][1]);
  assert.equal(envelopeAutomation[4][1], 0.0001);
  assert.equal(audio.activeVoices.length, 1);
  await audio.scheduleGrain(
    { ...event, duration: 0.1, seed: 9_999 },
    KARPLUS_STRONG_DEFAULTS,
    { when: 2.3, density: 28, renderDuration: 0.3 },
  );
  assert.equal(buffers.length, 1, "the same cell-color variant reuses its pitch buffer");
  const alternateVariant = (event.timbreVariant + 1) % 4;
  await audio.scheduleGrain(
    {
      ...event,
      duration: 0.1,
      timbreVariant: alternateVariant,
      timbre: (-1 + alternateVariant * (2 / 3)) * event.timbreVariation,
    },
    KARPLUS_STRONG_DEFAULTS,
    { when: 2.35, density: 28, renderDuration: 0.3 },
  );
  assert.equal(buffers.length, 2, "a different cell-color variant gets its own cached buffer");

  const buffersBeforeCapacityCheck = buffers.length;
  let newestEvent;
  for (let index = 0; index < 201; index += 1) {
    newestEvent = {
      ...event,
      frequency: 2_000 + index * 5,
      timbreVariant: 0,
      timbre: 0,
    };
    await audio.scheduleGrain(newestEvent, KARPLUS_STRONG_DEFAULTS, {
      when: 2.4 + index * 0.001,
      density: 28,
      renderDuration: 0.3,
    });
  }
  assert.equal(audio.bufferCache.size, 192);
  assert.equal(buffers.length - buffersBeforeCapacityCheck, 201);
  const buffersBeforeReuse = buffers.length;
  await audio.scheduleGrain(newestEvent, KARPLUS_STRONG_DEFAULTS, {
    when: 2.7,
    density: 28,
    renderDuration: 0.3,
  });
  assert.equal(buffers.length, buffersBeforeReuse, "the newest deterministic buffer is reused");

  assert.equal(audio.setPitchBend(125), 125);
  assert.deepEqual(detuneCalls.at(-1), ["target", 125, 2, 0.01]);
  audio.setOutput(5);
  assert.equal(audio.output, 0.85);
  audio.stopAll();
  assert.ok(stops.length > 0);
  await audio.close();
  assert.equal(audio.context, null);
  assert.equal(audio.activeVoices.length, 0);
});

test("Karplus Carpet page exposes synthesized microsound performance controls", async () => {
  const [html, css, app, source, waxHtml, waxCss, waxApp, waxSource] = await Promise.all([
    readFile(new URL("karplus-carpet.html", root), "utf8"),
    readFile(new URL("karplus-carpet.css", root), "utf8"),
    readFile(new URL("karplus-carpet-app.js", root), "utf8"),
    readFile(new URL("src/karplus-carpet.js", root), "utf8"),
    readFile(new URL("dist-wax/karplus-carpet.html", root), "utf8"),
    readFile(new URL("dist-wax/karplus-carpet.css", root), "utf8"),
    readFile(new URL("dist-wax/karplus-carpet-app.js", root), "utf8"),
    readFile(new URL("dist-wax/src/karplus-carpet.js", root), "utf8"),
  ]);
  assert.match(html, /<h1>Karplus Carpet<\/h1>/);
  assert.match(html, /id="grainDuration"[^>]*type="range"[^>]*min="\.08"[^>]*max="\.4"/);
  assert.match(html, /Amplitude ADSR/);
  assert.match(html, /id="attackDuration"[^>]*type="range"[^>]*min="\.001"[^>]*max="\.12"/);
  assert.match(html, /id="decayDuration"[^>]*type="range"[^>]*min="\.005"[^>]*max="\.3"/);
  assert.match(html, /id="sustainLevel"[^>]*type="range"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="releaseDuration"[^>]*type="range"[^>]*min="\.005"[^>]*max="\.4"/);
  assert.match(html, /<h2 class="group-title">Sound varieties<\/h2>/);
  assert.match(html, /data-preset-bank="materials"[^>]*aria-pressed="true"/);
  assert.match(html, /data-preset-bank="textures"[^>]*aria-pressed="false"/);
  assert.match(html, /id="timbreVariation"[^>]*type="range"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /four excitation colors/i);
  assert.match(html, /data-section="form">/);
  assert.match(html, /data-section="sound">/);
  assert.doesNotMatch(html, /data-section="(?:form|sound)" open/);
  assert.match(html, /Body time sets the earliest release point/i);
  assert.match(html, /id="velocityScatter"[^>]*type="range"/);
  assert.match(html, /id="stereoSpread"[^>]*type="range"/);
  assert.match(html, /id="lowFrequency"[^>]*type="range"/);
  assert.match(html, /id="highFrequency"[^>]*type="range"/);
  assert.match(html, /id="divisionsPerOctave"[^>]*type="range"/);
  assert.match(html, /close micro-area strikes it once/i);
  assert.match(html, /holding still stays silent/i);
  assert.match(html, /Previously crossed areas remain silent until the next gesture/i);
  assert.doesNotMatch(
    html,
    /id="(?:carpetButton|loopCarpet|hitCount|hitDensity|timingJitter|pitchSpread)"|data-primary-transport/,
  );
  assert.doesNotMatch(html, /hits \/ second|Timing scatter|Automatic pitch spread|>Play<|>Loop</i);
  assert.doesNotMatch(html, /<audio\b|type="file"|stringGrid|Chromatic strings/);
  assert.match(css, /\.kc-carpet-stage/);
  assert.match(css, /\.kc-envelope-sliders \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.kc-preset-bank/);
  assert.match(css, /\.kc-preset-description/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /\.karplus-carpet-page \.shell \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.karplus-carpet-page \.panel \{\s*min-height: 0;\s*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.karplus-carpet-page \.shell \{\s*display: block;/);
  assert.doesNotMatch(css, /kc-transport|kc-loop-toggle/);
  assert.match(app, /karplusCarpetSpatialGrid/);
  assert.match(app, /karplusCarpetEnvelopeTiming/);
  assert.match(app, /KARPLUS_CARPET_TEXTURE_PRESETS/);
  assert.match(app, /materials:[\s\S]*?textures:/);
  assert.match(app, /function selectPresetBank/);
  assert.match(app, /"attackDuration",\s*"decayDuration",\s*"sustainLevel",\s*"releaseDuration"/);
  assert.match(app, /karplusCarpetSpatialCrossings/);
  assert.match(app, /gesture\.visited\.has\(cell\.key\)/);
  assert.match(app, /event\.getCoalescedEvents\(\)/);
  assert.doesNotMatch(
    app,
    /scheduleTransport|startTransport|stopTransport|plantCloud|setTimeout|setInterval/,
  );
  assert.doesNotMatch(app, /hitCount|hitDensity|timingJitter|pitchSpread|loopCarpet|carpetButton/);
  const pointerDown = app.match(
    /canvas\.addEventListener\("pointerdown"[\s\S]*?\n\}\);/,
  )?.[0] ?? "";
  assert.match(pointerDown, /processPointerSample\(gesture, event\)/);
  const pointerMove = app.match(
    /canvas\.addEventListener\("pointermove"[\s\S]*?\n\}\);/,
  )?.[0] ?? "";
  assert.match(pointerMove, /processPointerSample/);
  assert.match(app, /message\?\.type === "pitchBend"/);
  assert.match(app, /message\?\.type !== "noteOn"/);
  const presetBody = app.match(/function applyPreset\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(presetBody, /queueGrain|strikeSpatial|scheduleGrain/);
  assert.match(presetBody, /syncCarpetControls\(\)/);
  const bankBody = app.match(/function selectPresetBank\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(bankBody, /queueGrain|strikeSpatial|scheduleGrain/);
  assert.match(source, /generateKarplusStrongSamples/);
  assert.match(source, /function karplusCarpetPointerEvent/);
  assert.match(source, /function karplusCarpetEnvelopeTiming/);
  assert.match(source, /KARPLUS_CARPET_TEXTURE_PRESETS/);
  assert.match(source, /timbreVariant/);
  assert.match(source, /coupledFrequency/);
  assert.match(source, /function karplusCarpetSpatialCrossings/);
  assert.match(source, /class KarplusCarpetAudio/);
  assert.match(source, /scheduleGrain\(event/);
  assert.doesNotMatch(source, /function karplusCarpetIntervalMs|function buildKarplusCarpetEvents/);
  assert.doesNotMatch(source, /decodeAudioData|fetch\(|\.wav|\.mp3/);
  assert.match(waxHtml, /close micro-area strikes it once/i);
  assert.match(waxHtml, /id="attackDuration"[^>]*type="range"/);
  assert.match(waxHtml, /id="decayDuration"[^>]*type="range"/);
  assert.match(waxHtml, /id="sustainLevel"[^>]*type="range"/);
  assert.match(waxHtml, /id="releaseDuration"[^>]*type="range"/);
  assert.match(waxHtml, /data-preset-bank="textures"/);
  assert.match(waxHtml, /id="timbreVariation"[^>]*type="range"/);
  assert.doesNotMatch(waxHtml, /id="carpetButton"|id="loopCarpet"/);
  assert.match(waxHtml, /data-morphazoid-wax-bootstrap/);
  assert.match(waxHtml, /data-morphazoid-wax-universal-adapter/);
  assert.equal(waxCss, css);
  assert.equal(waxApp, app);
  assert.equal(waxSource, source);
});
