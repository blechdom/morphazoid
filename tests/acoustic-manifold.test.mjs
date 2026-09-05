import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ACOUSTIC_ARCHIVE_COLLECTIONS,
  ACOUSTIC_ARCHIVE_GROUPS,
  ACOUSTIC_BUILT_IN_SOURCES,
  ACOUSTIC_BUILT_IN_SOURCE_GROUPS,
  ACOUSTIC_ANALYSIS_LIMITS,
  ACOUSTIC_MANIFOLD_LIMITS,
  ACOUSTIC_PROFILE_GROUPS,
  ACOUSTIC_PROFILES,
  ACOUSTIC_RESYNTHESIS_LIMITS,
  acousticResynthesisForOccurrence,
  acousticManifoldExport,
  analyzeAcousticSequence,
  createAcousticDemo,
  getAcousticBuiltInSource,
  getAcousticProfile,
  normalizeAcousticAnalysisParameters,
  normalizeAcousticResynthesis,
  renderAcousticModel,
  renderAcousticModelSegment,
} from "../src/acoustic-manifold.js";

const SAMPLE_RATE = 16_000;

function twoEvents() {
  const samples = new Float32Array(SAMPLE_RATE * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE;
    if (time > 0.15 && time < 0.55) {
      samples[index] = Math.sin(2 * Math.PI * 720 * time) * 0.7;
    } else if (time > 1.05 && time < 1.52) {
      samples[index] = Math.sin(2 * Math.PI * 1_120 * time) * 0.7;
    }
  }
  return samples;
}

function peak(samples) {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  return maximum;
}

const songbirdDemo = createAcousticDemo("thrush-nightingale-synthetic", SAMPLE_RATE);
const songbirdGraph = analyzeAcousticSequence(
  songbirdDemo.samples,
  songbirdDemo.sampleRate,
  "songbird",
);
const cricketDemo = createAcousticDemo("field-cricket-synthetic", SAMPLE_RATE);
const cricketGraph = analyzeAcousticSequence(
  cricketDemo.samples,
  cricketDemo.sampleRate,
  "insect",
);

test("the research library exposes explicit segmentation, spectral, capture, and model boundaries", () => {
  assert.equal(Object.keys(ACOUSTIC_PROFILES).length, 68);
  for (const required of [
    "general",
    "songbird",
    "bird-syllable",
    "owl-hoot",
    "wolf-howl",
    "coyote-howl",
    "coyote-group-yip-howl",
    "elephant-rumble",
    "frog",
    "insect",
    "cicada-echeme",
    "bat-echolocation",
    "mouse-usv",
    "marine",
    "right-whale-upcall",
    "dolphin-whistle",
    "killer-whale-call",
    "harbor-porpoise-click",
    "sperm-whale-coda",
    "fish-pulse",
    "snapping-shrimp",
  ]) assert.ok(ACOUSTIC_PROFILES[required], `missing ${required}`);
  const expected = {
    general: [0.35, 0.18, 60, 11_000, "neutral"],
    songbird: [0.8, 0.5, 250, 11_000, "songbird"],
    insect: [0.18, 0.08, 700, 11_000, "cricket"],
    marine: [1, 0.5, 20, 5_000, "neutral"],
  };
  for (const [id, values] of Object.entries(expected)) {
    const selected = getAcousticProfile(id);
    assert.equal(Object.isFrozen(selected), true);
    assert.deepEqual([
      selected.stropheGapSeconds,
      selected.minimumStropheSeconds,
      selected.minimumSpectralHz,
      selected.maximumSpectralHz,
      selected.synthesis.specialist,
    ], values);
    assert.equal(selected.synthesis.recoversAnatomy, false);
    assert.match(selected.inferenceLimits.join(" "), /not identify a species/i);
    assert.match(selected.inferenceLimits.join(" "), /not an estimate of a multifractal spectrum/i);
  }
  for (const selected of Object.values(ACOUSTIC_PROFILES)) {
    assert.equal(Object.isFrozen(selected), true);
    assert.ok(selected.minimumSpectralHz < selected.maximumSpectralHz);
    assert.ok(selected.analysisTargetRate >= 8_000);
    assert.ok(selected.analysisTargetRate * 0.48 >= selected.maximumSpectralHz * 0.995);
    assert.ok([64, 128, 256, 512, 1024, 2048, 4096].includes(selected.frameSize));
    assert.ok(selected.hopSize <= selected.frameSize);
    assert.ok(selected.recording.recommendedSampleRate > 0);
    assert.ok(selected.recording.recommendedSampleRate * 0.48 >= selected.maximumSpectralHz * 0.995);
    assert.ok(selected.basis);
    if (selected.id !== "general") {
      assert.ok(selected.evidence.length > 0, `${selected.id} needs research evidence`);
      for (const source of selected.evidence) assert.match(source.url, /^https:\/\//);
    }
  }
  assert.throws(() => getAcousticProfile("nightingale-detector"), /Unknown acoustic profile/);
  assert.deepEqual(ACOUSTIC_MANIFOLD_LIMITS.profileIds, Object.keys(ACOUSTIC_PROFILES));
});

test("the validated catalog combines procedural demos with twelve attributed local recordings", () => {
  assert.equal(Object.isFrozen(ACOUSTIC_BUILT_IN_SOURCES), true);
  assert.equal(ACOUSTIC_BUILT_IN_SOURCES.filter((entry) => entry.kind === "procedural").length, 2);
  const recordings = ACOUSTIC_BUILT_IN_SOURCES.filter((entry) => entry.kind === "recording");
  assert.equal(recordings.length, 12);
  assert.deepEqual(
    recordings.map((entry) => entry.id),
    [
      "thrush-nightingale",
      "common-blackbird",
      "chaffinch",
      "house-cricket",
      "field-cricket",
      "european-field-cricket",
      "coyote-chorus",
      "frog-soundscape",
      "dolphin-vocalizations",
      "humpback-whale-song",
      "killer-whale-call",
      "blue-whale-south-pacific",
    ],
  );
  for (const recording of recordings) {
    assert.match(recording.assetPath, /^\.\/assets\/bioacoustics\/[a-z-]+\.(?:ogg|wav)$/);
    assert.match(recording.sourceUrl, /^https:\/\/commons\.wikimedia\.org\//);
    assert.ok(recording.attribution);
    assert.ok(recording.catalogGroup);
    assert.match(recording.sha256, /^[a-f0-9]{64}$/);
    const file = new URL(`../${recording.assetPath.slice(2)}`, import.meta.url);
    assert.ok(fs.statSync(file).size > 1_000, `${recording.assetPath} should be bundled`);
  }
  const grouped = ACOUSTIC_BUILT_IN_SOURCE_GROUPS.flatMap((group) => group.sourceIds);
  assert.deepEqual(grouped, ACOUSTIC_BUILT_IN_SOURCES.map((entry) => entry.id));
  assert.equal(getAcousticBuiltInSource("house-cricket").license, "CC BY 3.0");
  assert.throws(
    () => createAcousticDemo("house-cricket", SAMPLE_RATE),
    /must be decoded from assetPath/,
  );
});

test("archive leads separate wildlife access from community-governed human recordings", () => {
  assert.equal(ACOUSTIC_ARCHIVE_COLLECTIONS.length, 27);
  assert.equal(Object.isFrozen(ACOUSTIC_ARCHIVE_COLLECTIONS), true);
  const grouped = ACOUSTIC_ARCHIVE_GROUPS.flatMap((group) => group.collectionIds);
  assert.deepEqual(grouped, ACOUSTIC_ARCHIVE_COLLECTIONS.map((entry) => entry.id));
  const communityCollections = ACOUSTIC_ARCHIVE_COLLECTIONS.filter(
    (entry) => entry.catalogGroup === "Community-governed human archives",
  );
  assert.equal(communityCollections.length, 5);
  for (const collection of communityCollections) {
    assert.match(collection.transformationPolicy, /no default|never bulk/i);
    assert.match(collection.sourceUrl, /^https:\/\//);
  }
  assert.ok(ACOUSTIC_ARCHIVE_COLLECTIONS.some((entry) => entry.id === "watkins-marine-mammal"));
  assert.ok(ACOUSTIC_ARCHIVE_COLLECTIONS.some((entry) => entry.id === "inaturalist-sounds"));
  assert.ok(ACOUSTIC_ARCHIVE_COLLECTIONS.some((entry) => entry.id === "dolphinfree"));
  assert.ok(ACOUSTIC_ARCHIVE_COLLECTIONS.some((entry) => entry.id === "insectset459"));
  assert.ok(ACOUSTIC_ARCHIVE_COLLECTIONS.some((entry) => entry.id === "paradisec"));
});

test("listener-tunable analysis parameters normalize to one safe reproducible contract", () => {
  const normalized = normalizeAcousticAnalysisParameters("general", {
    minimumSpectralHz: 9_000,
    maximumSpectralHz: 2_000,
    stropheGapSeconds: -4,
    minimumStropheSeconds: 99,
    analysisTargetRate: 999_999,
    frameSize: 300,
    hopSize: 999,
    fixedWindowSeconds: -2,
    fixedWindowOverlap: 2,
    minimumWindowActiveRatio: -1,
    sequenceGapSeconds: null,
    neighborCount: 99,
    maxDurationSeconds: 999,
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalized.minimumSpectralHz, 9_000);
  assert.equal(normalized.maximumSpectralHz, 9_001);
  assert.equal(normalized.stropheGapSeconds, 0.08);
  assert.equal(normalized.minimumStropheSeconds, 2);
  assert.equal(normalized.analysisTargetRate, 576_000);
  assert.equal(normalized.frameSize, 256);
  assert.equal(normalized.hopSize, 256);
  assert.equal(normalized.fixedWindowSeconds, 0);
  assert.equal(normalized.fixedWindowOverlap, 0.95);
  assert.equal(normalized.minimumWindowActiveRatio, 0);
  assert.equal(normalized.sequenceGapSeconds, null);
  assert.equal(normalized.neighborCount, 12);
  assert.equal(normalized.maxDurationSeconds, 120);
  assert.equal(
    normalizeAcousticAnalysisParameters("delphinid-click").minimumStropheSeconds,
    0.0001,
    "the requested duration should disclose the DSP's hard 100-microsecond floor",
  );
  assert.equal(ACOUSTIC_ANALYSIS_LIMITS.maximumFrameCount, 120_000);
  assert.equal(ACOUSTIC_ANALYSIS_LIMITS.maximumFftWorkUnits, 120_000);
});

test("tuned requested and actually effective settings remain distinct in analysis metadata", () => {
  const graph = analyzeAcousticSequence(twoEvents(), SAMPLE_RATE, "general", {
    minimumSpectralHz: 100,
    maximumSpectralHz: 6_000,
    stropheGapSeconds: 1,
    sequenceGapSeconds: null,
    analysisTargetRate: 8_000,
    frameSize: 1_024,
    hopSize: 128,
    neighborCount: 12,
  });
  assert.equal(graph.profile.parameterMode, "listener-tuned");
  assert.ok(graph.profile.tunedFields.includes("analysisTargetRate"));
  assert.equal(graph.profile.requested.maximumSpectralHz, 6_000);
  assert.ok(graph.profile.effective.maximumSpectralHz <= 3_840);
  assert.equal(graph.profile.requested.neighborCount, 12);
  assert.equal(graph.profile.effective.neighborCount, 0, "one merged event has no neighbor");
  assert.equal(graph.profile.requested.sequenceGapSeconds, null);
  assert.equal(graph.inputCompatibility.sourceBandAvailable, true);
  assert.equal(graph.inputCompatibility.analysisRateBandAvailable, false);
  assert.equal(graph.inputCompatibility.limitingFactor, "analysis-rate-ceiling");
  assert.match(graph.inputCompatibility.note, /analysis-rate ceiling/i);
  assert.match(graph.warning, /analysis-rate ceiling truncates/i);
});

test("the analysis frame budget rejects combinations that could hang a browser", () => {
  const samples = new Float32Array(8_000 * 20);
  assert.throws(
    () => analyzeAcousticSequence(samples, 8_000, "general", {
      maxDurationSeconds: 20,
      frameSize: 64,
      hopSize: 1,
    }),
    /analysis frames.*larger frame step/i,
  );
  assert.throws(
    () => analyzeAcousticSequence({ length: 576_000 * 45 }, 576_000, "general", {
      maxDurationSeconds: 45,
      analysisTargetRate: 576_000,
      frameSize: 4_096,
      hopSize: 256,
    }),
    /weighted FFT work units.*smaller FFT frame/i,
  );
});

test("zero-event analyses keep complete numeric summary metadata", () => {
  const silent = analyzeAcousticSequence(new Float32Array(SAMPLE_RATE), SAMPLE_RATE, "general");
  assert.equal(silent.strophes.length, 0);
  assert.equal(silent.embedding.explainedVarianceTotal, 0);
  assert.equal(Number.isNaN(silent.embedding.explainedVarianceTotal), false);
});

test("dense tuned segmentation discloses the 128-event map cap", () => {
  const eventCount = 150;
  const periodSeconds = 0.2;
  const activeSeconds = 0.08;
  const samples = new Float32Array(Math.ceil(SAMPLE_RATE * eventCount * periodSeconds));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE;
    if (time % periodSeconds < activeSeconds) {
      samples[index] = 0.7 * Math.sin(2 * Math.PI * 1_000 * time);
    }
  }
  const graph = analyzeAcousticSequence(samples, SAMPLE_RATE, "general", {
    frameSize: 256,
    hopSize: 64,
    stropheGapSeconds: 0.08,
    minimumStropheSeconds: 0.06,
  });
  assert.equal(graph.strophes.length, 128);
  assert.equal(graph.segmentation.candidateCount, 150);
  assert.equal(graph.segmentation.truncatedAtEventLimit, true);
  assert.match(graph.warning, /first 128 of 150 qualifying events/i);
});

test("procedural source dispatch preserves source and profile metadata", () => {
  assert.equal(songbirdDemo.sourceId, "thrush-nightingale-synthetic");
  assert.equal(songbirdDemo.profileId, "songbird");
  assert.equal(songbirdDemo.expectedStrophes, 18);
  assert.equal(cricketDemo.sourceId, "field-cricket-synthetic");
  assert.equal(cricketDemo.profileId, "insect");
  assert.ok(cricketDemo.expectedChirps >= 6);
});

test("profile groups cover every preset exactly once", () => {
  const grouped = ACOUSTIC_PROFILE_GROUPS.flatMap((group) => group.profileIds);
  assert.deepEqual(grouped, Object.keys(ACOUSTIC_PROFILES));
  assert.equal(new Set(grouped).size, grouped.length);
  assert.ok(ACOUSTIC_PROFILE_GROUPS.length >= 8);
  assert.ok(Object.values(ACOUSTIC_PROFILES).reduce(
    (total, selected) => total + selected.evidence.length,
    0,
  ) >= 80);
});

test("resynthesis controls have frozen defaults, stable clamping, and an explicit mode", () => {
  assert.equal(Object.isFrozen(ACOUSTIC_RESYNTHESIS_LIMITS), true);
  assert.ok(Object.values(ACOUSTIC_RESYNTHESIS_LIMITS).every(Object.isFrozen));
  const anchor = normalizeAcousticResynthesis();
  assert.deepEqual(anchor, {
    speedRatio: 1,
    pitchShiftSemitones: 0,
    bodyScale: 1,
    textureAmount: 1,
    manifoldExaggeration: 1,
    gapSeconds: 0.09,
    transformed: false,
    mode: "analysis-derived-anchor",
  });
  assert.equal(Object.isFrozen(anchor), true);

  const clamped = normalizeAcousticResynthesis({
    speedRatio: -20,
    pitchShiftSemitones: 900,
    bodyScale: 900,
    textureAmount: -20,
    manifoldExaggeration: -20,
    gapSeconds: 900,
  });
  assert.deepEqual(
    [
      clamped.speedRatio,
      clamped.pitchShiftSemitones,
      clamped.bodyScale,
      clamped.textureAmount,
      clamped.manifoldExaggeration,
      clamped.gapSeconds,
    ],
    [0.125, 48, 4, 0, 1, 0.75],
  );
  assert.equal(clamped.transformed, true);
  assert.equal(clamped.mode, "artistic-extrapolation");

  const nonFinite = normalizeAcousticResynthesis({
    speedRatio: Number.NaN,
    pitchShiftSemitones: Number.POSITIVE_INFINITY,
    bodyScale: Number.NaN,
    textureAmount: Number.NEGATIVE_INFINITY,
    manifoldExaggeration: Number.NaN,
    gapSeconds: Number.NaN,
  });
  assert.deepEqual(nonFinite, anchor);
});

test("a strophe's normalized 3D position independently offsets pitch, texture, and speed", () => {
  const projected = {
    strophes: [
      { position: { x: -2, y: 0, z: 1 } },
      { position: { x: 1, y: 4, z: -2 } },
      { position: { x: 2, y: -2, z: 0.5 } },
    ],
  };
  const settings = {
    speedRatio: 2,
    pitchShiftSemitones: 6,
    bodyScale: 1.5,
    textureAmount: 0.5,
    manifoldExaggeration: 3,
    gapSeconds: 0.2,
  };
  const mapped = acousticResynthesisForOccurrence(projected, 1, settings);
  assert.deepEqual(mapped.mapPositionNormalized, { x: 0.5, y: 1, z: -1 });
  assert.deepEqual(mapped.mapOffsets, {
    pitchSemitones: 12,
    speedRatio: 0.25,
    textureRatio: 4,
  });
  assert.deepEqual(
    [
      mapped.speedRatio,
      mapped.pitchShiftSemitones,
      mapped.bodyScale,
      mapped.textureAmount,
      mapped.manifoldExaggeration,
      mapped.gapSeconds,
    ],
    [0.5, 18, 1.5, 2, 3, 0.2],
  );
  assert.equal(mapped.mode, "artistic-extrapolation");
  assert.equal(mapped.biologicalLimitClaimed, false);
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(Object.isFrozen(mapped.mapPositionNormalized), true);
  assert.equal(Object.isFrozen(mapped.mapOffsets), true);

  const noSpread = acousticResynthesisForOccurrence(projected, 0, {
    ...settings,
    manifoldExaggeration: 1,
  });
  assert.equal(noSpread.speedRatio, settings.speedRatio);
  assert.equal(noSpread.pitchShiftSemitones, settings.pitchShiftSemitones);
  assert.equal(noSpread.textureAmount, settings.textureAmount);
  assert.ok(Math.abs(noSpread.mapOffsets.pitchSemitones) === 0);
  assert.equal(noSpread.mapOffsets.speedRatio, 1);
  assert.equal(noSpread.mapOffsets.textureRatio, 1);

  const unknown = acousticResynthesisForOccurrence(projected, 99, {
    manifoldExaggeration: 4,
  });
  assert.deepEqual(unknown.mapPositionNormalized, { x: 0, y: 0, z: 0 });
  assert.deepEqual(unknown.mapOffsets, {
    pitchSemitones: 0,
    speedRatio: 1,
    textureRatio: 1,
  });
});

test("neutral model speed, pitch, body, and texture transforms stay independent", () => {
  const source = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = 0.6 * Math.sin(2 * Math.PI * 1_000 * index / SAMPLE_RATE);
  }
  const descriptor = {
    medianPeakHz: 1_000,
    meanBandwidthHz: 200,
    meanFlatness: 0.2,
  };
  const render = (resynthesis, extra = {}) => renderAcousticModel(
    source,
    SAMPLE_RATE,
    "general",
    { descriptor, seed: 17, resynthesis, ...extra },
  );
  const anchorControls = {
    speedRatio: 1,
    pitchShiftSemitones: 0,
    bodyScale: 1,
    textureAmount: 1,
  };
  const anchor = render(anchorControls);
  const repeated = render(anchorControls);
  const fast = render({ ...anchorControls, speedRatio: 2 });
  const raised = render({ ...anchorControls, pitchShiftSemitones: 12 });
  const compensated = render({
    ...anchorControls,
    pitchShiftSemitones: 12,
    bodyScale: 2,
  });
  const smooth = render({ ...anchorControls, textureAmount: 0 });

  assert.deepEqual(anchor.samples, repeated.samples, "a fixed seed must reproduce the PCM exactly");
  assert.equal(anchor.samples.length, SAMPLE_RATE);
  assert.equal(anchor.model.baseFrequencyHz, 1_000);
  assert.equal(anchor.model.flatness, 0.2);

  assert.equal(fast.samples.length, SAMPLE_RATE / 2);
  assert.equal(fast.model.baseFrequencyHz, anchor.model.baseFrequencyHz);
  assert.equal(fast.model.resynthesis.effectiveSpeedRatio, 2);
  assert.equal(fast.model.resynthesis.pitchShiftSemitones, 0);

  assert.equal(raised.samples.length, anchor.samples.length);
  assert.equal(raised.model.baseFrequencyHz, 2_000);
  assert.equal(raised.model.frequencyScale, 2);
  assert.equal(raised.model.resynthesis.effectiveSpeedRatio, 1);

  assert.equal(compensated.samples.length, anchor.samples.length);
  assert.equal(compensated.model.baseFrequencyHz, 1_000);
  assert.equal(compensated.model.frequencyScale, 1);
  assert.equal(compensated.model.resynthesis.pitchShiftSemitones, 12);
  assert.equal(compensated.model.resynthesis.bodyScale, 2);

  assert.equal(smooth.samples.length, anchor.samples.length);
  assert.equal(smooth.model.baseFrequencyHz, anchor.model.baseFrequencyHz);
  assert.equal(smooth.model.flatness, 0);
  for (const rendered of [anchor, fast, raised, compensated, smooth]) {
    assert.ok(rendered.samples.every(Number.isFinite));
    assert.ok(peak(rendered.samples) <= 1);
  }
});

test("extreme slow neutral renders are capped and disclose their effective speed", () => {
  const source = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = 0.6 * Math.sin(2 * Math.PI * 700 * index / SAMPLE_RATE);
  }
  const rendered = renderAcousticModel(source, SAMPLE_RATE, "general", {
    descriptor: { medianPeakHz: 700, meanBandwidthHz: 150, meanFlatness: 0.1 },
    seed: 23,
    maximumOutputSeconds: 2,
    resynthesis: { speedRatio: 0.125 },
  });
  assert.equal(rendered.samples.length, SAMPLE_RATE * 2);
  assert.equal(rendered.model.resynthesis.requestedSpeedRatio, 0.125);
  assert.equal(rendered.model.resynthesis.effectiveSpeedRatio, 0.5);
  assert.equal(rendered.model.resynthesis.timeWarpLimited, true);
  assert.equal(rendered.model.resynthesis.maximumOutputSeconds, 2);
  assert.deepEqual(
    rendered.resynthesis,
    rendered.model.resynthesis,
    "portable segment metadata must report the applied rather than impossible requested warp",
  );
  assert.ok(rendered.samples.every(Number.isFinite));
});

test("profile-specific FFT geometry resolves sparse ultrasound and low-frequency calls", () => {
  const ultrasoundRate = 256_000;
  const ultrasound = new Float32Array(ultrasoundRate / 2);
  for (const [startSeconds, endSeconds] of [[0.05, 0.065], [0.12, 0.14]]) {
    for (
      let index = Math.floor(startSeconds * ultrasoundRate);
      index < Math.floor(endSeconds * ultrasoundRate);
      index += 1
    ) ultrasound[index] = 0.7 * Math.sin(2 * Math.PI * 60_000 * index / ultrasoundRate);
  }
  const mouse = analyzeAcousticSequence(ultrasound, ultrasoundRate, "mouse-usv");
  assert.equal(mouse.strophes.length, 2);
  assert.equal(mouse.analysisSampleRate, 256_000);
  assert.equal(mouse.frameSize, 512);
  assert.equal(mouse.hopSize, 128);
  assert.equal(mouse.inputCompatibility.fullRequestedBandAvailable, true);
  assert.equal(mouse.profile.recording.sourceRatePcmPreferred, true);
  assert.deepEqual(mouse.events.map((event) => event.sequenceGroup), [1, 1]);
  assert.equal(mouse.sequenceEdges[0].withinConfiguredSequence, true);
  assert.ok(mouse.sequenceEdges[0].gapSeconds > 0);

  const truncated = analyzeAcousticSequence(ultrasound.slice(0, 24_000), 48_000, "mouse-usv");
  assert.equal(truncated.inputCompatibility.fullRequestedBandAvailable, false);
  assert.ok(truncated.spectralRange.maximumHz <= 48_000 * 0.48);
  assert.match(truncated.warning, /truncates the requested feature band/i);

  const whaleRate = 8_000;
  const whale = new Float32Array(whaleRate * 3);
  for (let index = whaleRate / 5; index < whaleRate * 1.6; index += 1) {
    whale[index] = 0.7 * Math.sin(2 * Math.PI * 20 * index / whaleRate);
  }
  const fin = analyzeAcousticSequence(whale, whaleRate, "fin-whale-20hz");
  assert.equal(fin.strophes.length, 1);
  assert.equal(fin.frameSize, 4096);
  assert.equal(fin.spectralRange.minimumHz, 10);
  assert.equal(fin.spectralRange.maximumHz, 40);
});

test("fixed-window profiles create overlapping windows instead of invented pause events", () => {
  const rate = 48_000;
  const samples = new Float32Array(rate * 4);
  for (let index = rate / 5; index < rate * 3.8; index += 1) {
    samples[index] = 0.6 * Math.sin(2 * Math.PI * 3_000 * index / rate);
  }
  const graph = analyzeAcousticSequence(samples, rate, "passerine-window");
  assert.equal(graph.segmentation.mode, "fixed-window");
  assert.equal(graph.segmentation.fixedWindowSeconds, 3);
  assert.equal(graph.segmentation.fixedWindowOverlap, 0.5);
  assert.equal(graph.segmentation.stropheGapSeconds, null);
  assert.equal(graph.strophes.length, 2);
  assert.match(graph.segmentation.operationalDefinition, /analysis window/i);

  const tuned = analyzeAcousticSequence(samples, rate, "passerine-window", {
    fixedWindowSeconds: 1,
    fixedWindowOverlap: 2,
    minimumWindowActiveRatio: -1,
  });
  assert.equal(tuned.profile.parameterMode, "listener-tuned");
  assert.equal(tuned.profile.requested.fixedWindowOverlap, 0.95);
  assert.equal(tuned.profile.effective.fixedWindowOverlap, 0.95);
  assert.equal(tuned.profile.effective.minimumWindowActiveRatio, 0);
  assert.equal(tuned.profile.segmentationMode, "fixed-window");
  assert.match(tuned.profile.operationalDefinition, /one 1-second analysis window with 95% overlap/i);

  const switched = analyzeAcousticSequence(samples, rate, "passerine-window", {
    fixedWindowSeconds: 0,
  });
  assert.equal(switched.profile.parameterMode, "listener-tuned");
  assert.ok(switched.profile.tunedFields.includes("fixedWindowSeconds"));
  assert.equal(switched.profile.segmentationMode, "pause-bounded");
  assert.equal(switched.segmentation.stropheGapSeconds, 0.5);
  assert.match(switched.profile.operationalDefinition, /bounded by a pause/i);
});

test("infrasonic and ultrasonic neutral models disclose their audible frequency mapping", () => {
  const rate = 8_000;
  const source = new Float32Array(rate);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = 0.6 * Math.sin(2 * Math.PI * 20 * index / rate);
  }
  const elephant = renderAcousticModel(source, rate, "elephant-rumble", {
    descriptor: { medianPeakHz: 20, meanBandwidthHz: 30 },
  });
  assert.equal(elephant.model.frequencyScale, 10);
  assert.equal(elephant.model.sourceBaseFrequencyHz, 20);
  assert.equal(elephant.model.baseFrequencyHz, 200);
  assert.match(elephant.model.frequencyMapping, /frequency-scaled/i);
});

test("profile priors change pause-bounded event segmentation without pretending to classify", () => {
  const samples = twoEvents();
  const general = analyzeAcousticSequence(samples, SAMPLE_RATE, "general");
  const marine = analyzeAcousticSequence(samples, SAMPLE_RATE, { profile: "marine" });
  assert.equal(general.strophes.length, 2);
  assert.equal(marine.strophes.length, 1, "the one-second marine gap prior merges the occurrences");
  assert.equal(general.profile.id, "general");
  assert.deepEqual(general.events.map((event) => event.id), ["E001", "E002"]);
  assert.deepEqual(general.events.map((event) => event.legacyStropheId), ["S001", "S002"]);
  assert.equal(marine.events[0].id, "P001");
  assert.equal(general.profile.effective.stropheGapSeconds, 0.35);
  assert.equal(general.segmentation.eventTerm, "event");
  assert.equal(general.events, general.strophes);
  assert.match(general.segmentation.operationalDefinition, /bounded by a pause/i);
  assert.equal(general.classification.performed, false);
  assert.match(general.classification.note, /does not identify/i);
  assert.equal(general.multiscale.isMultifractalAnalysis, false);
  assert.match(general.multiscale.note, /No generalized Hurst exponents/i);

  const custom = analyzeAcousticSequence(samples, SAMPLE_RATE, "general", {
    stropheGapSeconds: 1,
    minimumSpectralHz: 100,
    maximumSpectralHz: 3_000,
  });
  assert.equal(custom.strophes.length, 1);
  assert.equal(custom.profile.effective.minimumSpectralHz, 100);
  assert.equal(custom.profile.effective.maximumSpectralHz, 3_000);

  const clamped = analyzeAcousticSequence(samples, SAMPLE_RATE, "general", {
    stropheGapSeconds: -20,
    minimumStropheSeconds: -20,
    maxDurationSeconds: 999,
  });
  assert.equal(clamped.profile.effective.stropheGapSeconds, 0.08);
  assert.equal(clamped.profile.effective.minimumStropheSeconds, 0.06);
  assert.equal(clamped.profile.effective.maxDurationSeconds, 120);
  assert.equal(clamped.segmentation.stropheGapSeconds, 0.08);
  assert.equal(clamped.segmentation.minimumStropheSeconds, 0.06);
});

test("songbird and insect nodes dispatch to their specialist reduced models", () => {
  assert.equal(songbirdGraph.strophes.length, songbirdDemo.expectedStrophes);
  const songbird = renderAcousticModelSegment(songbirdDemo.samples, songbirdGraph, 0);
  assert.equal(songbird.profileId, "songbird");
  assert.equal(songbird.model.id, "effective-bilateral-syrinx-v0");
  assert.match(songbird.modelLabel, /syrinx/i);
  assert.equal(songbird.model.anatomyRecovered, false);
  assert.equal(songbird.fallbackUsed, false);
  assert.ok(songbird.specialistAnalysis.voicedFraction > 0);
  assert.ok(peak(songbird.samples) > 0.2);
  const transformedSongbird = renderAcousticModelSegment(songbirdDemo.samples, songbirdGraph, 0, {
    resynthesis: {
      speedRatio: 2,
      pitchShiftSemitones: 12,
      bodyScale: 2,
      textureAmount: 0,
    },
  });
  assert.ok(Math.abs(transformedSongbird.samples.length * 2 - songbird.samples.length) <= 2);
  assert.equal(transformedSongbird.model.pitchShiftSemitones, 12);
  assert.equal(transformedSongbird.model.bodyScale, 2);
  assert.equal(transformedSongbird.model.roughness, 0);
  assert.ok(Math.abs(transformedSongbird.model.resonanceHz * 2 - songbird.model.resonanceHz) < 1);
  assert.equal(transformedSongbird.resynthesis.effectiveSpeedRatio, 2);

  assert.equal(cricketGraph.strophes.length, cricketDemo.expectedChirps);
  assert.equal(cricketGraph.strophes[0].id, "C001");
  assert.equal(cricketGraph.strophes[0].eventId, "C001");
  assert.equal(cricketGraph.strophes[0].legacyStropheId, "S001");
  const cricket = renderAcousticModelSegment(cricketDemo.samples, cricketGraph, "S001");
  assert.equal(cricket.eventId, "C001");
  assert.equal(cricket.stropheId, "S001");
  assert.equal(
    renderAcousticModelSegment(cricketDemo.samples, cricketGraph, "C001").eventId,
    "C001",
  );
  assert.equal(cricket.profileId, "insect");
  assert.equal(cricket.model.id, "two-dof-cricket-wings-v1");
  assert.match(cricket.modelLabel, /two-wing/i);
  assert.equal(cricket.model.anatomyRecovered, false);
  assert.equal(cricket.fallbackUsed, false);
  assert.ok(cricket.specialistAnalysis.carrierHz > 1_000);
  assert.ok(peak(cricket.samples) > 0.01);
  const transformedCricket = renderAcousticModelSegment(
    cricketDemo.samples,
    cricketGraph,
    0,
    {
      resynthesis: {
        speedRatio: 2,
        pitchShiftSemitones: 12,
        bodyScale: 2,
        textureAmount: 0,
      },
    },
  );
  assert.ok(Math.abs(transformedCricket.samples.length * 2 - cricket.samples.length) <= 2);
  assert.equal(transformedCricket.model.pitchShiftSemitones, 12);
  assert.equal(transformedCricket.model.bodyScale, 2);
  assert.equal(transformedCricket.model.toothIrregularity, 0);
  assert.ok(Math.abs(transformedCricket.model.baseFrequencyHz - cricket.model.baseFrequencyHz) < 1);
  assert.equal(transformedCricket.resynthesis.effectiveSpeedRatio, 2);

  const cricketExport = acousticManifoldExport(cricketGraph, [0], {
    modelSegments: [cricket],
  });
  assert.deepEqual(cricketExport.route.eventIds, ["C001"]);
  assert.deepEqual(cricketExport.route.stropheIds, ["S001"]);
  assert.equal(cricketExport.modelBoundary.modelSegments[0].eventId, "C001");
  assert.equal(cricketExport.modelBoundary.modelSegments[0].stropheId, "S001");
});

test("event resynthesis inherits the tuned analysis feature band", () => {
  const neutralSamples = twoEvents();
  const neutralAnalysis = analyzeAcousticSequence(neutralSamples, SAMPLE_RATE, "general", {
    minimumSpectralHz: 1_000,
    maximumSpectralHz: 2_000,
  });
  const neutral = renderAcousticModelSegment(neutralSamples, neutralAnalysis, 0);
  assert.ok(neutral.model.sourceBaseFrequencyHz >= 1_000);
  assert.deepEqual(neutral.model.sourceFeatureBandHz, { minimum: 1_000, maximum: 2_000 });

  const tunedCricketAnalysis = analyzeAcousticSequence(
    cricketDemo.samples,
    cricketDemo.sampleRate,
    "insect",
    { minimumSpectralHz: 3_000, maximumSpectralHz: 5_000 },
  );
  const tunedCricket = renderAcousticModelSegment(
    cricketDemo.samples,
    tunedCricketAnalysis,
    0,
  );
  assert.equal(tunedCricket.fallbackUsed, false);
  assert.equal(tunedCricket.specialistAnalysis.minimumCarrierHz, 3_000);
  assert.equal(tunedCricket.specialistAnalysis.maximumCarrierHz, 5_000);
});

test("general, frog, and marine renders are explicitly neutral and sample-free", () => {
  for (const profileId of ["general", "frog", "marine"]) {
    const samples = twoEvents();
    const graph = analyzeAcousticSequence(samples, SAMPLE_RATE, profileId);
    const rendered = renderAcousticModelSegment(samples, graph, 0, { seed: 17 });
    assert.equal(rendered.model.id, "neutral-descriptor-modal-v1");
    assert.equal(rendered.model.anatomical, false);
    assert.equal(rendered.model.mechanismSpecific, false);
    assert.match(rendered.synthesisKind, /neutral/i);
    assert.match(rendered.inferenceLimit, /No |no claim/i);
    assert.equal(rendered.gesture.kind, "neutral-descriptor-modal-control");
    assert.ok(rendered.gesture.frames.length > 0);
    assert.ok(rendered.gesture.frames.every((frame) => Number.isFinite(frame.amplitude)));
    assert.equal(rendered.samples.length, rendered.sourceRange.endSample - rendered.sourceRange.startSample);
    assert.ok(peak(rendered.samples) > 0.2);
  }
});

test("neutral route exports retain their replayable envelope controls without PCM", () => {
  const samples = twoEvents();
  const graph = analyzeAcousticSequence(samples, SAMPLE_RATE, "general");
  const segment = renderAcousticModelSegment(samples, graph, 0, { seed: 31 });
  const exported = acousticManifoldExport(graph, [0], { modelSegments: [segment] });
  const gesture = exported.modelBoundary.modelSegments[0].gesture;

  assert.equal(gesture.kind, "neutral-descriptor-modal-control");
  assert.ok(gesture.frames.length > 0);
  assert.ok(gesture.frames.every((frame) => (
    Number.isFinite(frame.timeSeconds) && Number.isFinite(frame.amplitude)
  )));
  assert.equal("samples" in exported.modelBoundary.modelSegments[0], false);
});

test("missing specialist cues fall back safely instead of inventing a physical fit", () => {
  const silence = new Float32Array(SAMPLE_RATE / 2);
  for (const profileId of ["songbird", "insect"]) {
    const rendered = renderAcousticModel(silence, SAMPLE_RATE, profileId);
    assert.equal(rendered.fallbackUsed, true);
    assert.match(rendered.modelLabel, /neutral/i);
    assert.match(rendered.fallbackReason, /No stable/i);
    assert.equal(peak(rendered.samples), 0);
    assert.equal(rendered.model.mechanismSpecific, false);
    assert.match(rendered.model.label, /neutral/i);

    const graph = analyzeAcousticSequence(silence, SAMPLE_RATE, profileId);
    const exported = acousticManifoldExport(graph, [], { modelSegments: [rendered] });
    const gesture = exported.modelBoundary.modelSegments[0].gesture;
    assert.equal(gesture.kind, "neutral-descriptor-modal-control");
    assert.ok(gesture.frames.length > 0);
    assert.ok(gesture.frames.every((frame) => (
      Number.isFinite(frame.timeSeconds) && Number.isFinite(frame.amplitude)
    )));
  }
});

test("portable export preserves profile, graph semantics, and model inference limits", () => {
  const modelSegment = renderAcousticModelSegment(songbirdDemo.samples, songbirdGraph, 0);
  const exported = acousticManifoldExport(songbirdGraph, [0, 2, 1], {
    source: "synthetic test",
    sourceMetadata: {
      kind: "recording",
      id: "thrush-nightingale",
      attribution: "Test recordist",
      license: "Public domain",
      sourceUrl: "https://example.test/source",
      ignoredPrivateField: "do not export",
    },
    rule: "hybrid",
    seed: 0x5354524f,
    surprise: 0.37,
    listenMode: "physical",
    gapSeconds: 0.09,
    timeline: [
      { stropheIndex: 0, startSeconds: 0, endSeconds: 0.7 },
      { stropheIndex: 2, startSeconds: 0.79, endSeconds: 1.45 },
      { stropheIndex: 1, startSeconds: 1.54, endSeconds: 2.2 },
    ],
    modelSegments: [modelSegment],
  });
  assert.equal(exported.format, "morphazoid-acoustic-manifold");
  assert.equal(exported.profile.id, "songbird");
  assert.equal(exported.profile.evidence.length, 2);
  assert.equal(exported.profile.withinEventGapSeconds, 0.8);
  assert.equal(exported.profile.sequenceGapSeconds, 4);
  assert.equal(typeof exported.inputCompatibility.fullRequestedBandAvailable, "boolean");
  assert.match(exported.featureRecipe.resampling, /none|polyphase-windowed-sinc/);
  assert.equal(exported.classification.performed, false);
  assert.equal(exported.multiscale.isMultifractalAnalysis, false);
  assert.deepEqual(exported.route.indices, [0, 2, 1]);
  assert.equal(exported.route.seed, 0x5354524f);
  assert.equal(exported.route.surprise, 0.37);
  assert.deepEqual(exported.route.eventIds, exported.route.ids);
  assert.deepEqual(exported.route.eventIds, ["S001", "S003", "S002"]);
  assert.deepEqual(exported.route.stropheIds, ["S001", "S003", "S002"]);
  assert.equal(exported.route.gapSeconds, 0.09);
  assert.deepEqual(
    exported.route.timeline.map(({ routeStep, eventIndex, eventId, startSeconds, endSeconds }) => ({
      routeStep,
      eventIndex,
      eventId,
      startSeconds,
      endSeconds,
    })),
    [
      { routeStep: 0, eventIndex: 0, eventId: "S001", startSeconds: 0, endSeconds: 0.7 },
      { routeStep: 1, eventIndex: 2, eventId: "S003", startSeconds: 0.79, endSeconds: 1.45 },
      { routeStep: 2, eventIndex: 1, eventId: "S002", startSeconds: 1.54, endSeconds: 2.2 },
    ],
  );
  assert.equal(exported.events, exported.strophes);
  assert.equal(exported.tones.length, songbirdGraph.tones.length);
  assert.equal(songbirdGraph.tones[0].parentEventId, "S001");
  assert.equal(songbirdGraph.tones[0].parentStropheId, "S001");
  assert.deepEqual(exported.featureRecipe.eventFeatures, exported.featureRecipe.stropheFeatures);
  assert.equal(exported.edges.observedSuccession.length, songbirdGraph.strophes.length - 1);
  assert.equal(exported.modelBoundary.sourceSamplesIncluded, false);
  assert.equal(exported.modelBoundary.modelSegments.length, 1);
  assert.equal(exported.modelBoundary.modelSegments[0].model.anatomyRecovered, false);
  assert.equal(
    exported.modelBoundary.modelSegments[0].gesture.kind,
    "effective-songbird-control-trajectory",
  );
  assert.ok(exported.modelBoundary.modelSegments[0].gesture.frames.length > 0);
  assert.equal("samples" in exported.modelBoundary.modelSegments[0], false);
  assert.equal(exported.modelBoundary.modelSegments[0].eventIndex, 0);
  assert.deepEqual(exported.sourceMetadata, {
    kind: "recording",
    id: "thrush-nightingale",
    attribution: "Test recordist",
    license: "Public domain",
    sourceUrl: "https://example.test/source",
  });
  assert.equal("ignoredPrivateField" in exported.sourceMetadata, false);
  assert.match(exported.disclaimer, /prior, not a species classification/i);
});
