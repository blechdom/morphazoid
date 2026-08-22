import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KARPLUS_CARPET_DEFAULTS,
  KARPLUS_CARPET_LIMITS,
  KarplusCarpetAudio,
  buildKarplusCarpetEvents,
  generateKarplusCarpetSamples,
  karplusCarpetEvent,
  karplusCarpetIntervalMs,
  karplusCarpetPitchAtPosition,
  karplusCarpetPointerEvent,
  karplusCarpetPositionFromStageX,
  karplusCarpetRephaseTime,
  karplusCarpetResumeTime,
  karplusCarpetStageGeometry,
  normalizeKarplusCarpetSamples,
  sanitizeKarplusCarpetSettings,
} from "../src/karplus-carpet.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  karplusStrongStringFrequencies,
} from "../src/karplus-strong.js";

const root = new URL("../", import.meta.url);

test("Karplus Carpet settings keep hit count, Rattlesnake density, and grains bounded", () => {
  const low = sanitizeKarplusCarpetSettings({
    hitCount: -40,
    hitDensity: -8,
    grainDuration: -1,
    timingJitter: -3,
    pitchSpread: 0,
    velocityScatter: -1,
    stereoSpread: -1,
    centerPosition: -2,
    lowFrequency: -20,
    highFrequency: -10,
    divisionsPerOctave: -4,
    spacing: "unknown",
  });
  assert.equal(low.hitCount, KARPLUS_CARPET_LIMITS.minimumHitCount);
  assert.equal(low.hitDensity, 4);
  assert.equal(low.grainDuration, 0.08);
  assert.equal(low.timingJitter, 0);
  assert.equal(low.pitchSpread, 0.04);
  assert.equal(low.velocityScatter, 0);
  assert.equal(low.stereoSpread, 0);
  assert.equal(low.centerPosition, 0);
  assert.equal(low.spacing, "octave");
  assert.ok(low.highFrequency > low.lowFrequency);

  const high = sanitizeKarplusCarpetSettings({
    hitCount: 999.8,
    hitDensity: 999,
    grainDuration: 8,
    timingJitter: 4,
    pitchSpread: 4,
    velocityScatter: 4,
    stereoSpread: 4,
    centerPosition: 4,
    divisionsPerOctave: 999,
    spacing: "equal-hz",
  });
  assert.equal(high.hitCount, KARPLUS_CARPET_LIMITS.maximumHitCount);
  assert.equal(high.hitDensity, 28);
  assert.equal(high.grainDuration, 0.4);
  assert.equal(high.timingJitter, 1);
  assert.equal(high.pitchSpread, 1);
  assert.equal(high.velocityScatter, 1);
  assert.equal(high.stereoSpread, 1);
  assert.equal(high.centerPosition, 1);
  assert.equal(high.divisionsPerOctave, 48);
  assert.equal(high.spacing, "equal-hz");
});

test("Karplus Carpet builds exactly one short synthesized attack per requested hit", () => {
  const settings = sanitizeKarplusCarpetSettings({
    ...KARPLUS_CARPET_DEFAULTS,
    hitCount: 72,
    hitDensity: 18,
    timingJitter: 0,
  });
  const field = karplusStrongStringFrequencies(settings);
  const events = buildKarplusCarpetEvents(settings, { seed: 20260821 });
  assert.equal(events.length, 72);
  assert.equal(events[0].atMs, 0);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assert.equal(event.index, index);
    assert.ok(field.includes(event.frequency));
    assert.ok(event.duration >= 0.08 && event.duration <= 0.4);
    assert.ok(event.velocity >= 0.16 && event.velocity <= 0.62);
    assert.ok(event.pan >= -1 && event.pan <= 1);
    assert.ok(event.visualY >= 0.12 && event.visualY <= 0.88);
    if (index) {
      assert.ok(event.atMs > events[index - 1].atMs);
      assert.ok(Math.abs(event.atMs - events[index - 1].atMs - 1_000 / 18) < 1e-9);
    }
  }
});

test("higher hit density shortens a carpet while seeded weave stays deterministic", () => {
  const common = {
    ...KARPLUS_CARPET_DEFAULTS,
    hitCount: 32,
    timingJitter: 0.55,
  };
  const first = buildKarplusCarpetEvents({ ...common, hitDensity: 4 }, { seed: 47 });
  const repeated = buildKarplusCarpetEvents({ ...common, hitDensity: 4 }, { seed: 47 });
  const dense = buildKarplusCarpetEvents({ ...common, hitDensity: 28 }, { seed: 47 });
  const alternate = buildKarplusCarpetEvents({ ...common, hitDensity: 4 }, { seed: 48 });
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, alternate);
  assert.ok(dense.at(-1).atMs < first.at(-1).atMs);
});

test("density and timing scatter literally control the attack clock", () => {
  for (const hitDensity of [4, 16, 28]) {
    for (const seed of [1, 47, 2_026_082_1]) {
      assert.equal(
        karplusCarpetIntervalMs({
          ...KARPLUS_CARPET_DEFAULTS,
          hitDensity,
          timingJitter: 0,
        }, 7, { seed }),
        1_000 / hitDensity,
      );
    }
  }

  const source = { ...KARPLUS_CARPET_DEFAULTS, hitDensity: 16 };
  const base = 1_000 / source.hitDensity;
  const fullScatter = karplusCarpetIntervalMs(
    { ...source, timingJitter: 1 },
    5,
    { seed: 91 },
  );
  const halfScatter = karplusCarpetIntervalMs(
    { ...source, timingJitter: 0.5 },
    5,
    { seed: 91 },
  );
  assert.ok(Math.abs((halfScatter - base) - (fullScatter - base) * 0.5) < 1e-9);

  assert.equal(
    karplusCarpetRephaseTime(
      { ...source, hitDensity: 4, timingJitter: 0 },
      1_000,
      1_050,
      5,
      { seed: 91, minimumLeadMs: 40 },
    ),
    1_250,
  );
  assert.equal(
    karplusCarpetRephaseTime(
      { ...source, hitDensity: 28, timingJitter: 0 },
      1_000,
      1_050,
      5,
      { seed: 91, minimumLeadMs: 40 },
    ),
    1_090,
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

test("a late transport resumes its remaining weave instead of collapsing overdue hits", () => {
  assert.equal(karplusCarpetResumeTime(900, 1_000), 1_008);
  assert.equal(karplusCarpetResumeTime(960, 1_000), 960);
  assert.equal(karplusCarpetResumeTime(1_100, 1_000), 1_100);
  assert.equal(
    karplusCarpetResumeTime(900, 1_000, { maximumLatenessMs: 200 }),
    900,
  );
});

test("a Carpet grain is a bounded Karplus waveform rather than a loaded sample", () => {
  const event = karplusCarpetEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    grainDuration: 0.12,
  }, 3, { seed: 83 });
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
    setValueAtTime(next, at) { this.value = next; detuneCalls.push(["value", next, at]); },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next, at, smoothing) {
      this.value = next;
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
  const event = karplusCarpetEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    grainDuration: 0.12,
  }, 0, { seed: 91 });
  const scheduled = await audio.scheduleGrain(
    { ...event, duration: 0.12 },
    KARPLUS_STRONG_DEFAULTS,
    { when: 2.25, density: 28, renderDuration: 0.2 },
  );
  assert.equal(gains[0].gain.value, 0.72);
  assert.equal(compressors[0].threshold.value, -18);
  assert.equal(compressors[0].knee.value, 12);
  assert.equal(compressors[0].ratio.value, 8);
  assert.equal(compressors[0].release.value, 0.18);
  assert.equal(starts.at(-1), 2.25);
  assert.equal(scheduled.when, 2.25);
  assert.ok(buffers[0].duration >= 0.08 && buffers[0].duration <= 0.4);
  assert.equal(audio.activeVoices.length, 1);
  await audio.scheduleGrain(
    { ...event, duration: 0.1, seed: 9_999, timbre: 0.9 },
    KARPLUS_STRONG_DEFAULTS,
    { when: 2.3, density: 28, renderDuration: 0.2 },
  );
  assert.equal(buffers.length, 1, "one synthesized buffer is reused for the same pitch and patch");
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
  const [html, css, app, source, waxHtml] = await Promise.all([
    readFile(new URL("karplus-carpet.html", root), "utf8"),
    readFile(new URL("karplus-carpet.css", root), "utf8"),
    readFile(new URL("karplus-carpet-app.js", root), "utf8"),
    readFile(new URL("src/karplus-carpet.js", root), "utf8"),
    readFile(new URL("dist-wax/karplus-carpet.html", root), "utf8"),
  ]);
  assert.match(html, /<h1>Karplus Carpet<\/h1>/);
  assert.match(html, /id="carpetButton"[^>]*data-primary-transport/);
  assert.match(html, /id="hitCount"[^>]*type="range"[^>]*min="8"[^>]*max="128"/);
  assert.match(html, /id="hitDensity"[^>]*type="range"[^>]*min="4"[^>]*max="28"/);
  assert.match(html, /id="grainDuration"[^>]*type="range"[^>]*min="\.08"[^>]*max="\.4"/);
  assert.match(html, /id="lowFrequency"[^>]*type="range"/);
  assert.match(html, /id="highFrequency"[^>]*type="range"/);
  assert.match(html, /id="divisionsPerOctave"[^>]*type="range"/);
  assert.match(html, /Automatic pitch spread/);
  assert.match(html, /Pointer left and right directly selects the played pitch/);
  assert.match(html, /Timing Scatter is the only clock deviation/);
  assert.doesNotMatch(html, /vertical position changes its spread/);
  assert.match(html, /Every mote is synthesized/);
  assert.doesNotMatch(html, /<audio\b|type="file"|stringGrid|Chromatic strings/);
  assert.match(css, /\.kc-carpet-stage/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /\.karplus-carpet-page \.shell \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.karplus-carpet-page \.panel \{\s*min-height: 0;\s*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.karplus-carpet-page \.shell \{\s*display: block;/);
  assert.match(app, /KARPLUS_CARPET_LIMITS\.scheduleAheadSeconds/);
  assert.match(app, /window\.setTimeout\(scheduleTransport/);
  assert.match(app, /karplusCarpetPointerEvent\(settings, hitIndex/);
  assert.match(app, /karplusCarpetPositionFromStageX\(localX, bounds\.width\)/);
  assert.match(app, /karplusCarpetRephaseTime\(/);
  assert.doesNotMatch(app, /lastPointerGrainAt|< 55/);
  const pointerDown = app.match(
    /canvas\.addEventListener\("pointerdown"[\s\S]*?\n\}\);/,
  )?.[0] ?? "";
  assert.match(pointerDown, /startDirectCarpet/);
  assert.doesNotMatch(pointerDown, /plantCloud/);
  assert.match(app, /message\?\.type === "pitchBend"/);
  assert.match(app, /message\?\.type !== "noteOn"/);
  assert.match(source, /generateKarplusStrongSamples/);
  assert.match(source, /function karplusCarpetPointerEvent/);
  assert.match(source, /class KarplusCarpetAudio/);
  assert.match(source, /scheduleGrain\(event/);
  assert.doesNotMatch(source, /decodeAudioData|fetch\(|\.wav|\.mp3/);
  assert.match(waxHtml, /data-morphazoid-wax-bootstrap/);
  assert.match(waxHtml, /data-morphazoid-wax-universal-adapter/);
});
