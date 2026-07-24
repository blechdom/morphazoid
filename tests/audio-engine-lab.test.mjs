import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ENGINE_DEFINITIONS,
  durationFactorToPlaybackRate,
  formatTapeStretch,
  playbackStatsSnapshot,
  prepareMicLoop,
  tapePitchForDuration,
} from "../src/audio-engine-lab.js";

const root = new URL("../", import.meta.url);

function markupWithId(html, tagName, id, closingTag = false) {
  const close = closingTag ? `[\\s\\S]*?<\\/${tagName}>` : "";
  return html.match(
    new RegExp(`<${tagName}\\b(?=[^>]*\\bid="${id}")[^>]*>${close}`, "i"),
  )?.[0] ?? "";
}

function engineCardMarkup(html, engineId) {
  const marker = `data-engine-card="${engineId}"`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `missing the ${engineId} engine card`);

  const nextCard = html.indexOf("data-engine-card=", start + marker.length);
  const candidates = [nextCard, html.length].filter((position) => position > start);
  return html.slice(start, Math.min(...candidates));
}

function rangeFor(cardMarkup, control) {
  return (cardMarkup.match(/<input\b[^>]*>/gi) ?? []).find(
    (tag) => new RegExp(`\\bdata-control="${control}"`, "i").test(tag)
      && /\btype="range"/i.test(tag),
  ) ?? "";
}

test("audio engine registry names the baseline and every comparable processor honestly", () => {
  const byId = new Map(ENGINE_DEFINITIONS.map((engine) => [engine.id, engine]));

  assert.equal(byId.get("raw")?.controls.pitch, false);
  assert.equal(byId.get("raw")?.controls.time, false);
  assert.match(JSON.stringify(byId.get("raw")), /(?:original|raw)[\s\S]*baseline/i);

  for (const engineId of [
    "signalsmith-silky",
    "signalsmith-economy",
    "soundtouch",
    "soundtouch-phase-vocoder",
    "tone-grain",
    "elementary",
  ]) {
    const engine = byId.get(engineId);
    assert.ok(engine, `missing ${engineId}`);
    assert.equal(engine.controls.pitch, true);
    assert.equal(engine.controls.time, true);
    assert.match(engine.gpu, /not used|none/i);
  }

  const nativeTape = byId.get("native-tape");
  assert.ok(nativeTape, "missing native-tape");
  assert.equal(nativeTape.controls.pitch, false);
  assert.equal(nativeTape.controls.time, true);
  assert.equal(nativeTape.controls.coupled, true);
  assert.match(JSON.stringify(nativeTape), /(?:native|Web Audio)[\s\S]*(?:tape|varispeed)/i);
  assert.match(nativeTape.gpu, /not used|none/i);

  const hybrid = byId.get("hybrid-soundtouch-signalsmith");
  assert.ok(hybrid, "missing hybrid-soundtouch-signalsmith");
  assert.equal(hybrid.controls.pitch, true);
  assert.equal(hybrid.controls.time, true);
  assert.match(JSON.stringify(hybrid), /SoundTouch[\s\S]*Signalsmith/i);
  assert.match(hybrid.gpu, /not used|none/i);

  assert.match(
    JSON.stringify(byId.get("signalsmith-silky")),
    /Signalsmith[\s\S]*Silky/i,
  );
  assert.match(
    JSON.stringify(byId.get("signalsmith-economy")),
    /Signalsmith[\s\S]*(Economy|cheaper)/i,
  );
  assert.match(JSON.stringify(byId.get("soundtouch")), /SoundTouchJS/i);
  assert.match(
    JSON.stringify(byId.get("soundtouch-phase-vocoder")),
    /FFT[\s\S]*phase[ -]vocoder|phase[ -]vocoder[\s\S]*FFT/i,
  );
  assert.match(JSON.stringify(byId.get("tone-grain")), /Tone\.js[\s\S]*grain/i);
  assert.match(
    JSON.stringify(byId.get("elementary")),
    /Elementary[\s\S]*Signalsmith backend/i,
  );
});

test("duration-factor controls map to reciprocal processor playback rates", () => {
  assert.equal(durationFactorToPlaybackRate(0.5), 2);
  assert.equal(durationFactorToPlaybackRate(1), 1);
  assert.equal(durationFactorToPlaybackRate(2), 0.5);
  assert.equal(durationFactorToPlaybackRate(Number.NaN), 1);
});

test("native tape reports its inseparable pitch and duration relationship", () => {
  assert.equal(tapePitchForDuration(0.5), 12);
  assert.equal(tapePitchForDuration(1), -0);
  assert.equal(tapePitchForDuration(2), -12);
  assert.equal(formatTapeStretch(0.5), "0.50× · +12.0 st");
  assert.equal(formatTapeStretch(2), "2.00× · −12.0 st");
});

test("microphone loops remove DC, normalize safely, and fade both seam endpoints", () => {
  const sampleRate = 48_000;
  const frameCount = 4_800;
  const input = Float32Array.from(
    { length: frameCount },
    (_, index) => 0.31 + (0.09 * Math.cos(2 * Math.PI * 100 * index / sampleRate)),
  );
  input[947] = Number.NaN;
  input[2_113] = Number.POSITIVE_INFINITY;

  const prepared = prepareMicLoop(input, sampleRate, {
    targetRms: 0.16,
    peakCeiling: 0.86,
    fadeSeconds: 0.005,
  });

  assert.ok(prepared.samples instanceof Float32Array);
  assert.equal(prepared.samples.length, frameCount);
  assert.equal(prepared.sampleRate, sampleRate);
  assert.ok(prepared.samples.every(Number.isFinite));
  assert.ok(Math.abs(prepared.metrics.removedDc - 0.31) < 0.002);
  assert.ok(prepared.metrics.gain > 1, "quiet input should be normalized upward");
  assert.ok(prepared.metrics.rms > 0.13);
  assert.ok(prepared.metrics.rms <= 0.161);
  assert.ok(prepared.metrics.peak <= 0.861);
  assert.ok(prepared.metrics.fadeFrames > 0);

  const outputMean = prepared.samples.reduce((sum, sample) => sum + sample, 0)
    / prepared.samples.length;
  assert.ok(Math.abs(outputMean) < 0.01, `residual DC was ${outputMean}`);

  assert.ok(
    Math.abs(prepared.samples[0]) < prepared.metrics.peak * 0.01,
    "the first loop sample should be softened",
  );
  assert.ok(
    Math.abs(prepared.samples.at(-1)) < prepared.metrics.peak * 0.01,
    "the final loop sample should be softened",
  );
});

test("playback health keeps browser XRUNs and average output latency explicit", () => {
  const snapshot = playbackStatsSnapshot({
    playbackStats: {
      underrunEvents: 3,
      underrunDuration: 0.012,
      averageLatency: 0.024,
    },
    outputLatency: 0.1,
  });
  assert.equal(snapshot.supported, true);
  assert.equal(snapshot.underrunEvents, 3);
  assert.equal(snapshot.underrunDuration, 0.012);
  assert.equal(snapshot.latency, 0.024);
});

test("audio engine lab exposes capture and a simple sequential list of effects", async () => {
  const html = await readFile(new URL("audio-engine-lab.html", root), "utf8");

  assert.ok(markupWithId(html, "button", "captureButton"));
  assert.ok(markupWithId(html, "canvas", "loopWaveform"));
  assert.ok(markupWithId(html, "button", "stopButton"));
  assert.match(html, /\bid="labDspCpu"/i);
  assert.match(html, /\bid="labAudioHealth"/i);
  assert.match(html, /\bid="labGpuDsp"/i);
  assert.match(html, /not total system CPU/i);
  assert.match(html, /GPU DSP/i);

  for (const removedId of [
    "engineA",
    "engineB",
    "listenAButton",
    "listenBButton",
    "benchmarkButton",
    "benchmarkResults",
  ]) {
    assert.doesNotMatch(html, new RegExp(`\\bid="${removedId}"`, "i"));
  }
  assert.doesNotMatch(html, /\bdata-benchmark-row=/i);

  for (const engineId of [
    "raw",
    "native-tape",
    "signalsmith-silky",
    "signalsmith-economy",
    "soundtouch",
    "soundtouch-phase-vocoder",
    "tone-grain",
    "elementary",
    "hybrid-soundtouch-signalsmith",
  ]) {
    const card = engineCardMarkup(html, engineId);
    const listenButtons = card.match(/<button\b(?=[^>]*\bdata-engine-listen\b)[^>]*>/gi) ?? [];
    assert.equal(listenButtons.length, 1, `${engineId} needs exactly one Listen button`);
  }

  for (const engineId of [
    "signalsmith-silky",
    "signalsmith-economy",
    "soundtouch",
    "soundtouch-phase-vocoder",
    "tone-grain",
    "elementary",
    "hybrid-soundtouch-signalsmith",
  ]) {
    const card = engineCardMarkup(html, engineId);
    const pitch = rangeFor(card, "pitch");
    const duration = rangeFor(card, "duration");
    assert.ok(pitch, `${engineId} needs an independent pitch range`);
    assert.ok(duration, `${engineId} needs an independent duration range`);
    assert.match(pitch, /\bmin="-12"/i);
    assert.match(pitch, /\bmax="12"/i);
    if (engineId === "soundtouch-phase-vocoder" || engineId === "tone-grain") {
      assert.match(duration, /\bmin="0\.25"/i);
      assert.match(duration, /\bmax="4"/i);
    } else {
      assert.match(duration, /\bmin="0\.5"/i);
      assert.match(duration, /\bmax="2"/i);
    }
  }

  const rawCard = engineCardMarkup(html, "raw");
  assert.equal(rawCard.match(/<input\b[^>]*\btype="range"[^>]*>/gi), null);

  const nativeTapeCard = engineCardMarkup(html, "native-tape");
  const nativeTapeRanges = nativeTapeCard.match(/<input\b[^>]*\btype="range"[^>]*>/gi) ?? [];
  assert.equal(nativeTapeRanges.length, 1, "native tape needs one coupled control");
  assert.match(nativeTapeRanges[0], /\bdata-control="duration"/i);
  assert.doesNotMatch(nativeTapeRanges[0], /\bdata-control="pitch"/i);
  assert.match(nativeTapeCard, /(?:coupled|tape)[\s\S]*(?:duration|pitch)|(?:duration|pitch)[\s\S]*(?:coupled|tape)/i);

  assert.match(
    html,
    /FFT[\s\S]{0,160}phase[ -]vocoder|phase[ -]vocoder[\s\S]{0,160}FFT/i,
  );
  assert.match(html, /Elementary[\s\S]{0,160}Signalsmith backend/i);
});

test("audio engine lab app captures privately, monitors audio health, and loads the distinct processors", async () => {
  const app = await readFile(new URL("audio-engine-lab-app.js", root), "utf8");
  const adapters = await readFile(new URL("src/audio-engine-adapters.js", root), "utf8");
  assert.match(app, /getUserMedia/);
  assert.match(app, /mic-loop-capture-processor\.js/);
  assert.match(app, /renderCapacity/);
  assert.match(app, /playbackStatsSnapshot/);
  assert.match(app, /Not whole-device CPU/i);
  assert.doesNotMatch(app, /\bengineA\b|\bengineB\b/);
  assert.match(app, /benchmarkOfflineEngine/);
  assert.match(app, /offlineBudgetPercent/);
  assert.match(app, /data-engine-metric="live-average"/);
  assert.match(app, /data-engine-metric="offline-pitch"/);
  assert.match(app, /data-engine-metric="offline-time"/);
  assert.match(app, /data-engine-metric="offline-combined"/);
  assert.match(app, /data-engine-metric="audio-xrun"/);
  assert.match(app, /data-engine-metric="dsp-underflow"/);
  assert.match(adapters, /class NativeTapeAdapter/);
  assert.match(adapters, /class HybridSoundTouchSignalsmithAdapter/);
  assert.match(adapters, /class ToneGrainAdapter/);
  assert.match(adapters, /vendor\/tone\/Tone\.js/);
  assert.match(
    adapters,
    /vendor\/soundtouchjs-phase-vocoder\/PhaseVocoderNode\.js/,
  );
  assert.match(
    `${app}\n${adapters}`,
    /vendor\/soundtouchjs-phase-vocoder\/phase-vocoder-processor\.js/,
  );
});

test("audio worklet processors do not add unsupported hot-path wall clocks", async () => {
  for (const relativePath of [
    "vendor/signalsmith-stretch/SignalsmithStretch.mjs",
    "vendor/soundtouchjs/soundtouch-processor.js",
    "vendor/soundtouchjs-phase-vocoder/phase-vocoder-processor.js",
  ]) {
    const source = await readFile(new URL(relativePath, root), "utf8");
    assert.doesNotMatch(
      source,
      /globalThis\.performance\?\.now|measureProcessing|worklet-clock/,
      `${relativePath} must use context/offline metrics instead of intrusive processor clocks`,
    );
  }
});

test("SoundTouch health counters exclude expected pipeline priming and can reset per audition", async () => {
  for (const relativePath of [
    "vendor/soundtouchjs/soundtouch-processor.js",
    "vendor/soundtouchjs-phase-vocoder/phase-vocoder-processor.js",
  ]) {
    const source = await readFile(new URL(relativePath, root), "utf8");
    assert.match(source, /message\.type === "reset-metrics"/);
    assert.match(source, /_outputPrimed/);
    assert.match(source, /else if \(this\._outputPrimed\) this\._underrunCount\+\+/);
  }
});
