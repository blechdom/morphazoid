import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBeatWindows, ANALYSIS_LIMITS, BEAT_ANALYSIS_VERSION } from "../src/instruments/trackazoid/beat-analysis.js";
import { copyAnalysisWindows, createBeatAnalyzer } from "../src/instruments/trackazoid/beat-analysis-client.js";

const RATE = 12000;
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected} within ${tolerance}`);
function randomGenerator(seed = 123456) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
}

// Drum envelopes, pitched bass, noise hats/snare, a continuous chord and ghost
// notes exercise attacks over sustained music rather than an ideal click train.
function music({ bpm = 126, offset = 0.283, seconds = 24, rate = RATE, hats = true, syncopation = true } = {}) {
  const samples = new Float32Array(Math.ceil(seconds * rate));
  const noise = randomGenerator();
  for (let i = Math.floor(offset * rate); i < samples.length; i++) {
    const time = i / rate - offset;
    const beats = time * bpm / 60;
    const beatIndex = Math.floor(beats);
    const sinceBeat = (beats - beatIndex) * 60 / bpm;
    const eighth = beats * 2;
    const sinceEighth = (eighth - Math.floor(eighth)) * 30 / bpm;
    let value = 0.024 * (Math.sin(2 * Math.PI * 220 * time) + Math.sin(2 * Math.PI * 277.18 * time) + Math.sin(2 * Math.PI * 329.63 * time));
    value += 0.55 * Math.exp(-sinceBeat / 0.047) * Math.sin(2 * Math.PI * (58 * sinceBeat + 1.8 * (1 - Math.exp(-sinceBeat * 50))));
    value += 0.11 * Math.exp(-sinceBeat / 0.22) * Math.sin(2 * Math.PI * [73.42, 73.42, 82.41, 65.41][beatIndex % 4] * sinceBeat);
    if (beatIndex % 2 === 1) value += 0.2 * Math.exp(-sinceBeat / 0.038) * noise();
    if (hats) value += 0.075 * Math.exp(-sinceEighth / 0.012) * noise();
    if (syncopation && beatIndex % 4 === 3 && sinceBeat > 0.75 * 60 / bpm) value += 0.07 * Math.exp(-(sinceBeat - 0.75 * 60 / bpm) / 0.02) * noise();
    samples[i] = value;
  }
  return samples;
}
const run = samples => analyzeBeatWindows({ sampleRate: RATE, windows: [{ startTime: 0, channels: [samples] }] });
function assertGrid(result, bpm, offset, tolerance = 0.5) {
  assert.equal(result.status, "ok", JSON.stringify(result));
  near(result.bpm, bpm, tolerance);
  const period = 60 / bpm;
  const difference = Math.abs((result.beatOffset - offset) % period);
  assert.ok(Math.min(difference, period - difference) < 0.035, `phase ${result.beatOffset} matches ${offset}`);
  assert.ok(result.confidence >= 0.42 && result.confidence <= 1);
}

test("estimates dance-tempo music with bass, chords, hats, snare and syncopation", () => {
  for (const bpm of [83.5, 114, 126, 137.7, 172]) assertGrid(run(music({ bpm })), bpm, 0.283);
});

test("leading silence keeps absolute phase and half/double interpretations remain visible", () => {
  for (const offset of [0.137, 1.371, 5.283]) {
    const result = run(music({ bpm: 120, offset }));
    assertGrid(result, 120, offset);
    assert.ok(result.candidates.some(candidate => Math.abs(candidate.bpm - 60) < 0.5), JSON.stringify(result));
  }
});

test("range edges are represented even when the musical half/double level is ambiguous", () => {
  for (const bpm of [40, 60, 220, 240]) {
    const result = run(music({ bpm, hats: false, syncopation: false }));
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.ok(result.candidates.some(candidate => Math.abs(candidate.bpm - bpm) < 0.7), JSON.stringify(result));
    for (const candidate of result.candidates) assert.ok(candidate.bpm >= 40 && candidate.bpm <= 240);
  }
});

test("stereo opposite polarity and right-only rhythm survive analysis", () => {
  const pcm = music({ bpm: 114 });
  for (const channels of [[pcm, pcm.map(value => -value)], [new Float32Array(pcm.length), pcm]]) {
    assertGrid(analyzeBeatWindows({ sampleRate: RATE, windows: [{ startTime: 0, channels }] }), 114, 0.283);
  }
});

test("silence, short files, sustained tones and random unmetered attacks have no fabricated tempo", () => {
  const tone = (frequency, seconds = 24) => Float32Array.from({ length: seconds * RATE }, (_, i) => 0.5 * Math.sin(2 * Math.PI * frequency * i / RATE));
  const random = randomGenerator(981);
  const noise = Float32Array.from({ length: 24 * RATE }, () => random() * 0.3);
  const unmetered = new Float32Array(24 * RATE);
  for (let time = 0.1; time < 23; time += 0.19 + (random() + 1) * 0.83) {
    for (let i = Math.floor(time * RATE); i < Math.min(unmetered.length, (time + 0.12) * RATE); i++) unmetered[i] += 0.6 * Math.exp(-(i / RATE - time) / 0.025) * random();
  }
  const beatingTone = (a, b) => Float32Array.from({ length: 24 * RATE }, (_, i) => 0.3 * (Math.sin(2 * Math.PI * a * i / RATE) + Math.sin(2 * Math.PI * b * i / RATE)));
  const smoothTremolo = Float32Array.from({ length: 24 * RATE }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / RATE) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * i / RATE)));
  const inputs = [new Float32Array(24 * RATE), music({ seconds: 3 }), tone(55), tone(440), tone(997.3), noise, unmetered, beatingTone(440, 442), beatingTone(55, 57), smoothTremolo];
  for (const input of inputs) {
    const result = run(input);
    assert.equal(result.status, "unreliable", JSON.stringify(result));
    assert.equal(result.bpm, null); assert.equal(result.beatOffset, null); assert.equal(result.confidence, 0);
  }
  assert.equal(run(inputs[0]).reason, "silence");
  assert.equal(run(inputs[1]).reason, "too-short");
});

test("nonfinite PCM is sanitized and oversized requests retain bounded work/results", () => {
  const pcm = music({ bpm: 126 });
  pcm[100] = NaN; pcm[3000] = Infinity; pcm[7000] = -Infinity;
  assertGrid(run(pcm), 126, 0.283);
  const windows = Array.from({ length: 9 }, (_, i) => ({ startTime: i * 24, channels: [pcm, pcm, pcm] }));
  const result = analyzeBeatWindows({ sampleRate: RATE, windows });
  assert.equal(result.analyzedSeconds, 72);
  assert.ok(result.candidates.length <= 5);
  for (const candidate of result.candidates) {
    assert.ok(Number.isFinite(candidate.bpm) && Number.isFinite(candidate.beatOffset) && Number.isFinite(candidate.confidence));
    assert.ok(candidate.beatOffset >= 0 && candidate.beatOffset < 60 / candidate.bpm);
  }
  assert.throws(() => analyzeBeatWindows({ sampleRate: Infinity, windows }), TypeError);
  assert.equal(analyzeBeatWindows({ sampleRate: RATE, windows: [] }).reason, "too-short");
});

test("multiple separated windows agree on global phase and conflicting tempi are rejected", () => {
  const full = music({ bpm: 126, seconds: 100, offset: 0.137 });
  const windows = [0, 38, 76].map(startTime => ({ startTime, channels: [full.slice(startTime * RATE, (startTime + 24) * RATE)] }));
  const result = analyzeBeatWindows({ sampleRate: RATE, windows });
  assertGrid(result, 126, 0.137, 0.15);
  const conflicting = [83, 126, 177].map((bpm, index) => ({ startTime: index * 24, channels: [music({ bpm })] }));
  assert.equal(analyzeBeatWindows({ sampleRate: RATE, windows: conflicting }).status, "unreliable");
});

function audioBuffer(channels, sampleRate = RATE) {
  return { sampleRate, length: channels[0].length, numberOfChannels: channels.length, getChannelData: index => channels[index] };
}

test("copying is bounded, yields, respects stereo and never detaches source PCM", async () => {
  const source = music({ seconds: 110, rate: 48000 });
  const original = source[100000]; let yields = 0;
  const request = await copyAnalysisWindows(audioBuffer([source, source], 48000), { yieldControl: async () => { yields++; } });
  assert.equal(request.windows.length, 3);
  assert.ok(request.sampleRate <= ANALYSIS_LIMITS.sampleRate);
  for (const window of request.windows) {
    assert.equal(window.channels.length, 2);
    for (const channel of window.channels) assert.ok(channel.length <= ANALYSIS_LIMITS.windowSeconds * request.sampleRate);
  }
  assert.ok(yields > 20, "Large files yield to UI repeatedly");
  structuredClone(request, { transfer: request.windows.flatMap(window => window.channels.map(channel => channel.buffer)) });
  assert.equal(source[100000], original); assert.equal(source.length, 110 * 48000);
});

test("copy cancellation interrupts before more chunks or worker work", async () => {
  let cancelled = false; let yields = 0;
  await assert.rejects(copyAnalysisWindows(audioBuffer([new Float32Array(24 * RATE)]), {
    isCancelled: () => cancelled,
    yieldControl: async () => { cancelled = true; yields++; },
  }), { name: "AbortError" });
  assert.equal(yields, 1);
});

class FakeWorker {
  static instances = [];
  constructor(url, options) { this.url = url; this.options = options; this.terminated = false; FakeWorker.instances.push(this); }
  postMessage(data, transfers) { this.data = structuredClone(data, { transfer: transfers }); }
  terminate() { this.terminated = true; }
  reply(result = { version: BEAT_ANALYSIS_VERSION, status: "unreliable" }) { this.onmessage({ data: { id: this.data.id, result } }); }
}
async function waitForWorker(count) {
  for (let i = 0; i < 200 && FakeWorker.instances.length < count; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(FakeWorker.instances.length, count);
  return FakeWorker.instances.at(-1);
}

test("worker ownership cancels replaced requests, ignores stale results and disposes", async () => {
  FakeWorker.instances = [];
  const analyzer = createBeatAnalyzer({ WorkerClass: FakeWorker });
  const pcm = music({ seconds: 6 }); const buffer = audioBuffer([pcm]);
  const first = analyzer.analyze(buffer);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const worker = await waitForWorker(1);
  const second = analyzer.analyze(buffer);
  await firstRejected;
  assert.ok(worker.terminated);
  worker.reply();
  const next = await waitForWorker(2);
  assert.equal(next.options.type, "module");
  assert.ok(String(next.url).endsWith("beat-analysis-worker.js"));
  next.reply();
  assert.equal((await second).version, BEAT_ANALYSIS_VERSION);
  assert.ok(next.terminated); assert.ok(pcm.byteLength > 0);
  const third = analyzer.analyze(buffer);
  const thirdRejected = assert.rejects(third, { name: "AbortError" });
  analyzer.dispose();
  await thirdRejected;
  await assert.rejects(analyzer.analyze(buffer), { name: "AbortError" });
});

test("abort signal, worker failure and timeout reject with cleanup instead of hanging", async () => {
  FakeWorker.instances = [];
  const buffer = audioBuffer([new Float32Array(100)]);
  const analyzer = createBeatAnalyzer({ WorkerClass: FakeWorker, timeoutMs: 1000 });
  const controller = new AbortController();
  const aborted = analyzer.analyze(buffer, { signal: controller.signal });
  const abortedAssertion = assert.rejects(aborted, { name: "AbortError" });
  const worker = await waitForWorker(1);
  controller.abort(); await abortedAssertion; assert.ok(worker.terminated);
  const failed = analyzer.analyze(buffer);
  const failedAssertion = assert.rejects(failed, /broken/);
  (await waitForWorker(2)).onerror({ message: "broken", preventDefault() {} });
  await failedAssertion;
  const timeout = createBeatAnalyzer({ WorkerClass: FakeWorker, timeoutMs: 15 });
  const timedOut = timeout.analyze(buffer);
  const timedOutAssertion = assert.rejects(timedOut, /timed out/);
  const waiting = await waitForWorker(3);
  await timedOutAssertion; assert.ok(waiting.terminated);
  await assert.rejects(createBeatAnalyzer({ WorkerClass: null }).analyze(buffer), /unavailable/);
});
