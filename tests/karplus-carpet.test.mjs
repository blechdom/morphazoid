import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KARPLUS_CARPET_DEFAULTS,
  KARPLUS_CARPET_LIMITS,
  KarplusCarpetAudio,
  generateKarplusCarpetSamples,
  karplusCarpetPitchAtPosition,
  karplusCarpetPointerEvent,
  karplusCarpetPositionFromStageX,
  karplusCarpetSpatialCellAtPosition,
  karplusCarpetSpatialCellSeed,
  karplusCarpetSpatialCrossings,
  karplusCarpetSpatialGrid,
  karplusCarpetStageGeometry,
  normalizeKarplusCarpetSamples,
  sanitizeKarplusCarpetSettings,
} from "../src/karplus-carpet.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  karplusStrongStringFrequencies,
} from "../src/karplus-strong.js";

const root = new URL("../", import.meta.url);

test("Karplus Carpet settings keep spatial grains and pitch fields bounded", () => {
  const low = sanitizeKarplusCarpetSettings({
    grainDuration: -1,
    velocityScatter: -1,
    stereoSpread: -1,
    centerPosition: -2,
    lowFrequency: -20,
    highFrequency: -10,
    divisionsPerOctave: -4,
    spacing: "unknown",
  });
  assert.equal(low.grainDuration, 0.08);
  assert.equal(low.velocityScatter, 0);
  assert.equal(low.stereoSpread, 0);
  assert.equal(low.centerPosition, 0);
  assert.equal(low.spacing, "octave");
  assert.ok(low.highFrequency > low.lowFrequency);

  const high = sanitizeKarplusCarpetSettings({
    grainDuration: 8,
    velocityScatter: 4,
    stereoSpread: 4,
    centerPosition: 4,
    divisionsPerOctave: 999,
    spacing: "equal-hz",
  });
  assert.equal(high.grainDuration, 0.4);
  assert.equal(high.velocityScatter, 1);
  assert.equal(high.stereoSpread, 1);
  assert.equal(high.centerPosition, 1);
  assert.equal(high.divisionsPerOctave, 48);
  assert.equal(high.spacing, "equal-hz");
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
  const event = karplusCarpetPointerEvent({
    ...KARPLUS_CARPET_DEFAULTS,
    grainDuration: 0.12,
  }, 0, { seed: 91, position: 0.5, visualY: 0.5 });
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
  assert.match(html, /id="grainDuration"[^>]*type="range"[^>]*min="\.08"[^>]*max="\.4"/);
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
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /\.karplus-carpet-page \.shell \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.karplus-carpet-page \.panel \{\s*min-height: 0;\s*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.karplus-carpet-page \.shell \{\s*display: block;/);
  assert.doesNotMatch(css, /kc-transport|kc-loop-toggle/);
  assert.match(app, /karplusCarpetSpatialGrid/);
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
  assert.match(source, /generateKarplusStrongSamples/);
  assert.match(source, /function karplusCarpetPointerEvent/);
  assert.match(source, /function karplusCarpetSpatialCrossings/);
  assert.match(source, /class KarplusCarpetAudio/);
  assert.match(source, /scheduleGrain\(event/);
  assert.doesNotMatch(source, /function karplusCarpetIntervalMs|function buildKarplusCarpetEvents/);
  assert.doesNotMatch(source, /decodeAudioData|fetch\(|\.wav|\.mp3/);
  assert.match(waxHtml, /close micro-area strikes it once/i);
  assert.doesNotMatch(waxHtml, /id="carpetButton"|id="loopCarpet"/);
  assert.match(waxHtml, /data-morphazoid-wax-bootstrap/);
  assert.match(waxHtml, /data-morphazoid-wax-universal-adapter/);
});
