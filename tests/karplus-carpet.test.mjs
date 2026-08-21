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

test("Karplus Carpet audio schedules short grains, bends them live, and stops cleanly", async () => {
  const starts = [];
  const stops = [];
  const buffers = [];
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

    createGain() { return node({ gain: parameter(1) }); }
    createDynamicsCompressor() {
      return node({
        threshold: parameter(), knee: parameter(), ratio: parameter(),
        attack: parameter(), release: parameter(),
      });
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
    { when: 2.25, density: 28 },
  );
  assert.equal(starts.at(-1), 2.25);
  assert.equal(scheduled.when, 2.25);
  assert.ok(buffers[0].duration >= 0.08 && buffers[0].duration <= 0.4);
  assert.equal(audio.activeVoices.length, 1);
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
  assert.match(html, /Every mote is synthesized/);
  assert.doesNotMatch(html, /<audio\b|type="file"|stringGrid|Chromatic strings/);
  assert.match(css, /\.kc-carpet-stage/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(app, /KARPLUS_CARPET_LIMITS\.scheduleAheadSeconds/);
  assert.match(app, /window\.setTimeout\(scheduleTransport/);
  assert.match(app, /message\?\.type === "pitchBend"/);
  assert.match(app, /message\?\.type !== "noteOn"/);
  assert.match(source, /generateKarplusStrongSamples/);
  assert.match(source, /class KarplusCarpetAudio/);
  assert.match(source, /scheduleGrain\(event/);
  assert.doesNotMatch(source, /decodeAudioData|fetch\(|\.wav|\.mp3/);
  assert.match(waxHtml, /data-morphazoid-wax-bootstrap/);
  assert.match(waxHtml, /data-morphazoid-wax-universal-adapter/);
});
