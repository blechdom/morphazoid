#!/usr/bin/env node
/** Reproducible DSP-core comparison. It does not time browser/device I/O. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { generationVoiceSpecs } from '../src/instruments/micmic/micmic.js';
import { DEFAULT_MICMIC_STATE, MICMIC_FULL_PRESETS } from '../src/families/branch-presets/full-presets.js';
import { GranularEconomyRenderer } from '../src/families/signalsmith-generation/granular-economy-renderer.js';
import { MicmicGenerationDSP } from '../src/families/mic-branch/micmic-generation-dsp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_RATE = 48_000;
const BLOCK_FRAMES = 128;
const HISTORY_SECONDS = 40;
const MAX_VOICES = 16_384;
const BENCH_COUNTS = [48, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
const MATCHED_RMS = 10 ** (-18 / 20);
const PARITY_MAX_ABS = 1e-6;
const SPECTRAL_FFT_FRAMES = 4096;

function fftInPlace(real, imaginary) {
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const rotationReal = Math.cos(angle), rotationImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let factorReal = 1, factorImaginary = 0;
      for (let offset = 0; offset < size / 2; offset++) {
        const even = start + offset, odd = even + size / 2;
        const oddReal = factorReal * real[odd] - factorImaginary * imaginary[odd];
        const oddImaginary = factorReal * imaginary[odd] + factorImaginary * real[odd];
        real[odd] = real[even] - oddReal; imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal; imaginary[even] += oddImaginary;
        const nextReal = factorReal * rotationReal - factorImaginary * rotationImaginary;
        factorImaginary = factorReal * rotationImaginary + factorImaginary * rotationReal;
        factorReal = nextReal;
      }
    }
  }
}

/** Coarse energy-weighted spectral measurements of interleaved stereo.
 * Sum the channel energies, avoiding anti-phase cancellation from downmixing.
 * Fixed Hann 4096, nominal hop 2048, at most 96 evenly selected windows.
 * Band fractions use all spectral energy from 20 Hz through Nyquist as denominator.
 */
export function spectralMetrics(samples, sampleRate = SAMPLE_RATE) {
  const frames = Math.floor(samples.length / 2);
  const size = SPECTRAL_FFT_FRAMES, hop = size / 2;
  const possible = Math.max(1, Math.floor(Math.max(0, frames - size) / hop) + 1);
  const windows = Math.min(96, possible);
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  const hann = Float64Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1)));
  let total = 0, weighted = 0, low = 0, mid = 0, high = 0;
  for (let window = 0; window < windows; window++) {
    const selected = windows === 1 ? 0 : Math.round(window * (possible - 1) / (windows - 1));
    const start = selected * hop;
    for (let channel = 0; channel < 2; channel++) {
      imaginary.fill(0);
      for (let index = 0; index < size; index++) real[index] = (samples[(start + index) * 2 + channel] ?? 0) * hann[index];
      fftInPlace(real, imaginary);
      for (let bin = 1; bin <= size / 2; bin++) {
        const frequency = bin * sampleRate / size;
        if (frequency < 20) continue;
        const energy = real[bin] ** 2 + imaginary[bin] ** 2;
        total += energy; weighted += frequency * energy;
        if (frequency < 200) low += energy;
        else if (frequency < 1000) mid += energy;
        else if (frequency < 8000) high += energy;
      }
    }
  }
  return { centroidHz: total > 0 ? weighted / total : 0,
    bandEnergyFractions: { hz20to200: total > 0 ? low / total : 0,
      hz200to1000: total > 0 ? mid / total : 0, hz1000to8000: total > 0 ? high / total : 0 },
    fftFrames: size, nominalHopFrames: hop, analyzedWindows: windows,
    weighting: 'Energy centroid; left/right spectral energy summed; fractions relative to 20 Hz–Nyquist' };
}

export function optionsForState(state, maximumVoices) {
  return {
    lSystemType: state.lSystemType, generations: state.generations,
    interval: state.interval, depth: state.depth, branching: state.branching,
    spread: state.spread, mutation: state.mutation, timeRatio: state.timeRatio,
    angle: state.generationAngle, asymmetry: state.generationAsymmetry,
    pitchScale: state.generationPitchScale, pruningBias: state.pruningBias,
    maximumVoices,
  };
}

export function economyVoices(voices) {
  let mapped;
  let detail;
  new GranularEconomyRenderer({ port: { postMessage(message) { mapped = message.voices; } } }, {
    maxVoices: 1024, onPitchDetail(report) { detail = report; },
  }).setVoices(voices, { voiceLimit: voices.length, requestedVoiceCount: voices.length });
  return { voices: mapped, detail };
}

function hashUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Explicit extension of the Pythagorean fork, with the old 128/stage cap removed.
 * Every node is a raw-history tap with inherited delay/pitch, not a serial DSP.
 * No pitch-class merging or 0.01-semitone rounding is applied here.
 */
export function expandedPythagoreanVoices({ generations = 11, interval = 240,
  timeRatio = .72, angle = 45, asymmetry = 0, mutation = 0,
  pitchScale = 1, depth = .72, spread = .9 } = {}) {
  if (!Number.isInteger(generations) || generations < 1 || generations > 13) {
    throw new RangeError('Expanded Pythagorean depth must be an integer from 1 to 13');
  }
  const taper = Math.max(.2, Math.min(2, timeRatio));
  const skew = Math.max(-.8, Math.min(.8, asymmetry));
  const mut = Math.max(0, Math.min(1, mutation));
  const octaveScale = Math.max(0, Math.min(4, pitchScale));
  const decay = Math.max(0, Math.min(.96, depth));
  const turn = Math.max(0, Math.min(180, angle));
  const base = Math.max(1, Math.min(3000, interval)) / 1000;
  const visualTaper = taper <= 1 ? taper : 1 + Math.log2(taper) * .08;
  const nodes = [];
  let frontier = [{ id: 'trunk', heading: 0, delay: 0, semitones: 0, x: 1, y: 0 }];
  for (let generation = 1; generation <= generations; generation++) {
    const children = [];
    for (const parent of frontier) {
      for (const [rule, initialTurn] of [['A', -turn * (1 - skew)], ['B', turn * (1 + skew)]]) {
        const id = `${parent.id}/${rule}`;
        const variation = hashUnit(`${id}:length`) * mut * .3;
        const turnDegrees = initialTurn + (hashUnit(`${id}:turn`) * 2 - 1) * turn * mut * .5;
        const heading = parent.heading + turnDegrees;
        const length = Math.max(.02, visualTaper ** generation * (1 - variation));
        const nextInterval = base * taper ** generation * (1 - variation);
        const delay = parent.delay + nextInterval;
        const semitones = parent.semitones + turnDegrees / 180 * 12 * octaveScale;
        const node = { id, parentId: parent.id, generation, rule, turnDegrees,
          heading, interval: nextInterval, delay, semitones,
          x: parent.x + Math.cos(heading * Math.PI / 180) * length,
          y: parent.y + Math.sin(heading * Math.PI / 180) * length };
        children.push(node);
        nodes.push(node);
      }
    }
    frontier = children;
  }
  const maximumY = Math.max(.001, ...nodes.map(node => Math.abs(node.y)));
  return nodes.filter(node => node.delay <= 39 + 1e-9).map(node => ({
    key: `generation:${node.id}`, generation: node.generation, rule: node.rule,
    parentId: node.parentId, turnDegrees: node.turnDegrees, interval: node.interval,
    delay: node.delay, rate: Math.max(.125, Math.min(8, 2 ** (node.semitones / 12))),
    gain: .5 * decay ** (node.generation * .72) / Math.sqrt(2 ** node.generation),
    pan: Math.max(-1, Math.min(1, node.y / maximumY * Math.max(0, Math.min(1, spread)))),
  }));
}

export function sceneForVoices(voices, { channels = 1, events } = {}) {
  return { sampleRate: SAMPLE_RATE, historySeconds: HISTORY_SECONDS, channels,
    maxVoices: MAX_VOICES, events: events ?? [{ time: 0, voices, limit: voices.length }] };
}

export function comparisonScenarios() {
  const defaultState = DEFAULT_MICMIC_STATE;
  const all = generationVoiceSpecs(optionsForState(defaultState, 1024));
  const scenarios = [];
  for (const limit of [48, 256, 1024]) {
    const raw = generationVoiceSpecs(optionsForState(defaultState, limit));
    const { voices, detail } = economyVoices(raw);
    const actual = voices.length;
    scenarios.push({ name: `default-${actual}-economy`,
      title: `Pythagorean Pine · ${actual} voices · browser economy mapping`,
      group: 'default', scene: sceneForVoices(voices), pitchDetail: detail,
      origin: 'Current browser generationVoiceSpecs plus GranularEconomyRenderer',
      browserStatus: limit === 48 ? 'Safe browser start/fallback' : limit === 256
        ? 'Maximum with partial worklet timing' : 'All available taps; whole-context calibration required' });
  }
  scenarios.push({ name: `default-${all.length}-independent`,
    title: `Pythagorean Pine · ${all.length} voices · independent pitch`, group: 'default',
    scene: sceneForVoices(all), origin: 'Current browser topology, original unmerged voice rates' });
  const ivy = MICMIC_FULL_PRESETS.find(preset => preset.id === 'ivy');
  const mutated = generationVoiceSpecs(optionsForState(ivy.snapshot.parameters, 48));
  const economy = economyVoices(mutated);
  scenarios.push({ name: 'midnight-ivy-48-economy', title: 'Midnight Ivy · 48 voices · 24 shifted pitch classes',
    group: 'mutation', scene: sceneForVoices(economy.voices), pitchDetail: economy.detail,
    origin: `Actual complete preset ${ivy.label}; current browser economy mapping` });
  scenarios.push({ name: 'midnight-ivy-48-independent', title: 'Midnight Ivy · 48 voices · independent pitch',
    group: 'mutation', scene: sceneForVoices(mutated),
    origin: `Actual complete preset ${ivy.label}; original unmerged voice rates` });
  for (const generations of [11, 13]) {
    const voices = expandedPythagoreanVoices({ ...optionsForState(defaultState, 1024), generations });
    scenarios.push({ name: `expanded-${voices.length}-independent`,
      title: `Native extension · ${voices.length} voices · full binary ${generations}-generation tree`,
      group: 'extension', nativeOnly: true, scene: sceneForVoices(voices),
      origin: 'Explicit native extension: no 128-branches/stage or 1024-total topology caps; same inheritance equations' });
  }
  const transitionStart = [
    { key: 'stable', delay: .16, rate: 1, gain: .22, pan: -.5 },
    { key: 'shifted', delay: .25, rate: 1.5, gain: .2, pan: .6 },
  ];
  const retimed = transitionStart.map(voice => ({ ...voice, delay: voice.delay + .23,
    rate: voice.key === 'stable' ? .75 : 2.2, pan: -voice.pan }));
  const replacement = Array.from({ length: 6 }, (_, index) => ({ key: `new:${index}`,
    delay: .08 + index * .065, rate: .55 + index * .34, gain: .11, pan: index / 2.5 - 1 }));
  scenarios.push({ name: 'transition-stereo', title: 'Stereo live edits · retime, pitch, pan, shrink, release',
    group: 'parity', scene: sceneForVoices([], { channels: 2, events: [
      { time: 0, voices: transitionStart, limit: 8 },
      { time: .7, voices: retimed, limit: 8 },
      { time: 1.1, voices: replacement, limit: 8 },
      { time: 1.6, voices: replacement.slice(0, 2), limit: 2 },
      { time: 2.2, voices: [], limit: 0 },
    ] }), origin: 'DSP lifecycle fixture, no outer browser gain/filter/compressor graph' });
  return scenarios;
}

/** Four seconds, with 1.8 seconds of mixed excitation followed by a quiet tail. */
export function makeInput(seconds = 4, sampleRate = SAMPLE_RATE, channels = 1) {
  const output = new Float32Array(Math.round(seconds * sampleRate) * channels);
  let seed = 0x53ad4bc1;
  for (let frame = 0; frame < output.length / channels; frame++) {
    const time = frame / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    const attack = Math.min(1, time / .01);
    const envelope = time < 1.8 ? attack * (.7 + .3 * Math.sin(Math.PI * time / 1.8)) : 0;
    const transientAge = time % .31;
    const transient = transientAge < .035 ? noise * Math.exp(-transientAge * 145) : 0;
    const tone = .16 * Math.sin(2 * Math.PI * 173 * time)
      + .085 * Math.sin(2 * Math.PI * 259.5 * time)
      + .055 * Math.sin(2 * Math.PI * 346 * time)
      + .045 * Math.sin(2 * Math.PI * (70 * time + 110 * time * time));
    output[frame * channels] = envelope * (tone + .18 * transient);
    if (channels === 2) output[frame * channels + 1] = envelope * (.15 * Math.sin(2 * Math.PI * 211 * time)
      + .07 * Math.sin(2 * Math.PI * 316.5 * time + .3) - .09 * transient);
  }
  return output;
}

export function encodeFloatWav(interleaved, sampleRate = SAMPLE_RATE, channels = 2) {
  const bytes = Buffer.alloc(44 + interleaved.length * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20);
  bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * 4, 28); bytes.writeUInt16LE(channels * 4, 32);
  bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(interleaved.length * 4, 40);
  for (let index = 0; index < interleaved.length; index++) bytes.writeFloatLE(interleaved[index], 44 + index * 4);
  return bytes;
}

export function decodeFloatWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF WAVE');
  let format;
  let payload;
  for (let position = 12; position + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', position, position + 4);
    const size = bytes.readUInt32LE(position + 4);
    const start = position + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Truncated WAV format');
      let kind = bytes.readUInt16LE(start);
      if (kind === 0xfffe) {
        if (size < 40) throw new Error('Truncated extensible WAV format');
        kind = bytes.readUInt16LE(start + 24);
      }
      format = { kind, channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    }
    if (id === 'data') payload = bytes.subarray(start, start + size);
    position = start + size + (size & 1);
  }
  if (!format || !payload || format.kind !== 3 || format.bits !== 32) throw new Error('Comparison requires float32 WAV');
  const samples = Float32Array.from({ length: payload.length / 4 }, (_, index) => payload.readFloatLE(index * 4));
  return { ...format, samples };
}

export function renderReference(scene, input, seconds = 4) {
  const renderer = new MicmicGenerationDSP(scene);
  // The browser guards 1024. Extension scenes are never passed here.
  if (scene.events.some(event => event.voices.length > renderer.maxVoices)) throw new Error('JS reference cannot render above its real browser 1024-voice guard');
  const frames = Math.round(seconds * scene.sampleRate);
  const output = new Float32Array(frames * 2);
  const events = [...scene.events].sort((a, b) => a.time - b.time);
  let eventIndex = 0;
  let frame = 0;
  while (frame < frames) {
    while (eventIndex < events.length && Math.round(events[eventIndex].time * scene.sampleRate) <= frame) {
      const event = events[eventIndex++]; renderer.setVoices(event.voices, event.limit);
    }
    const untilEvent = eventIndex < events.length ? Math.round(events[eventIndex].time * scene.sampleRate) - frame : frames - frame;
    const count = Math.min(BLOCK_FRAMES, frames - frame, untilEvent);
    const leftIn = new Float32Array(count), rightIn = scene.channels === 2 ? new Float32Array(count) : null;
    for (let index = 0; index < count; index++) {
      leftIn[index] = input[(frame + index) * scene.channels] ?? 0;
      if (rightIn) rightIn[index] = input[(frame + index) * scene.channels + 1] ?? 0;
    }
    const left = new Float32Array(count), right = new Float32Array(count);
    renderer.process(leftIn, rightIn, left, right);
    for (let index = 0; index < count; index++) {
      output[(frame + index) * 2] = left[index]; output[(frame + index) * 2 + 1] = right[index];
    }
    frame += count;
  }
  return output;
}

export function signalMetrics(samples, sampleRate = SAMPLE_RATE) {
  let peak = 0, energy = 0, cross = 0, leftEnergy = 0, rightEnergy = 0, onset = -1;
  let clippedSamples = 0, tailEnergy = 0;
  const tailStart = Math.max(0, samples.length - Math.round(.5 * sampleRate) * 2);
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index];
    if (!Number.isFinite(value)) throw new Error('Non-finite audio');
    peak = Math.max(peak, Math.abs(value)); energy += value * value;
    if (Math.abs(value) >= .999999) clippedSamples++;
    if (index >= tailStart) tailEnergy += value * value;
    if (onset < 0 && Math.abs(value) > .0001) onset = Math.floor(index / 2);
    if ((index & 1) === 0) {
      const right = samples[index + 1] ?? 0;
      cross += value * right; leftEnergy += value * value; rightEnergy += right * right;
    }
  }
  if (peak > 1) throw new Error(`DSP output exceeds unity peak: ${peak}`);
  return { peak, rms: Math.sqrt(energy / Math.max(1, samples.length)), clippedSamples,
    tailRms: Math.sqrt(tailEnergy / Math.max(1, samples.length - tailStart)), tailSeconds: Math.min(.5, samples.length / 2 / sampleRate),
    onsetFrame: onset, stereoCorrelation: cross / Math.max(1e-30, Math.sqrt(leftEnergy * rightEnergy)),
    spectral: spectralMetrics(samples, sampleRate) };
}

export function differenceMetrics(first, second) {
  if (first.length !== second.length) throw new Error(`Audio length mismatch ${first.length} != ${second.length}`);
  let peak = 0, error = 0, signal = 0;
  for (let index = 0; index < first.length; index++) {
    const delta = first[index] - second[index];
    peak = Math.max(peak, Math.abs(delta)); error += delta * delta; signal += first[index] ** 2;
  }
  return { maxAbs: peak, rms: Math.sqrt(error / Math.max(1, first.length)),
    signalToErrorDb: error > 0 ? 10 * Math.log10(Math.max(1e-30, signal) / error) : null,
    exactlyEqual: peak === 0 };
}

export function levelMatch(samples) {
  const metrics = signalMetrics(samples);
  const gain = metrics.rms > 0
    ? Math.min(MATCHED_RMS / metrics.rms, .9 / Math.max(1e-20, metrics.peak)) : 1;
  const matched = Float32Array.from(samples, value => value * gain);
  return { samples: matched, gain, targetRms: MATCHED_RMS, metrics: signalMetrics(matched) };
}

export function stressVoices(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_VOICES) throw new RangeError('Invalid stress voice count');
  return Array.from({ length: count }, (_, index) => {
    let rate = .25 + hashUnit(`stress:${index}:rate`) * 3.74;
    if (Math.abs(rate - 1) < .001) rate += .002;
    return { key: `stress:${index}`, delay: .025 + hashUnit(`stress:${index}:delay`) * .52,
      rate, gain: .32 / Math.sqrt(count), pan: hashUnit(`stress:${index}:pan`) * 2 - 1 };
  });
}

export function timingMetrics(milliseconds, sampleRate = SAMPLE_RATE, blockFrames = BLOCK_FRAMES) {
  const sorted = [...milliseconds].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const deadline = blockFrames / sampleRate * 1000;
  return { meanMs, medianMs: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
    maxMs: sorted.at(-1), realtimeFactor: meanMs / deadline,
    deadlineMisses: sorted.filter(value => value > deadline).length, blocks: sorted.length };
}

/** Deliberate CPU stress comparison above the production JavaScript 1024 guard.
 * Only the guard is bypassed; its renderer algorithm and loop are unchanged.
 * Histories, input blocks, engines, setup, warmup and file I/O are not timed.
 */
export function benchmarkReference(count, input, { blocks = 64, warmupBlocks = 128, reps = 3 } = {}) {
  const milliseconds = [], trials = [];
  const voices = stressVoices(count);
  const sourceBlocks = Array.from({ length: blocks + warmupBlocks }, (_, block) => {
    const samples = new Float32Array(BLOCK_FRAMES);
    for (let index = 0; index < samples.length; index++) samples[index] = input[(SAMPLE_RATE * HISTORY_SECONDS + block * BLOCK_FRAMES + index) % input.length];
    return samples;
  });
  for (let rep = 0; rep < reps; rep++) {
    const renderer = new MicmicGenerationDSP({ sampleRate: SAMPLE_RATE, historySeconds: HISTORY_SECONDS, maxVoices: 1024 });
    renderer.maxVoices = count;
    renderer.runtimeLimit = count;
    for (let index = 0; index < renderer.history.length; index++) renderer.history[index] = Math.tanh(input[index % input.length]);
    renderer.recordedSamples = renderer.history.length;
    renderer.setVoices(voices, count);
    const left = new Float32Array(BLOCK_FRAMES), right = new Float32Array(BLOCK_FRAMES);
    for (let block = 0; block < warmupBlocks; block++) renderer.process(sourceBlocks[block], null, left, right);
    const samples = [];
    for (let block = 0; block < blocks; block++) {
      const source = sourceBlocks[block + warmupBlocks];
      const started = performance.now();
      renderer.process(source, null, left, right);
      const elapsed = performance.now() - started;
      samples.push(elapsed); milliseconds.push(elapsed);
    }
    trials.push(timingMetrics(samples));
  }
  return { sampleRate: SAMPLE_RATE, channels: 1, blockFrames: BLOCK_FRAMES,
    maxVoices: count, requestedVoices: count, activeVoices: count, reps, warmupBlocks,
    prefillFrames: SAMPLE_RATE * HISTORY_SECONDS,
    productionGuardBypassed: count > 1024,
    repetitionPolicy: 'Fresh engine, identical primed history, identical warmup and input block sequence for each repetition',
    timing: timingMetrics(milliseconds), trials };
}

function runNative(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Native command failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout.trim();
}

function safeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function provenanceDigests(binary, destination) {
  const sources = [
    'scripts/compare-l-system-delay.mjs',
    'src/instruments/micmic/micmic.js',
    'src/instruments/l-system/l-system.js',
    'src/families/branch-presets/full-presets.js',
    'src/families/branch-presets/initial-state.js',
    'src/families/mic-branch/micmic-generation-dsp.js',
    'src/families/signalsmith-generation/granular-economy-renderer.js',
    'src/instruments/micmic/rust/Cargo.toml', 'src/instruments/micmic/rust/Cargo.lock',
    'src/instruments/micmic/rust/core/Cargo.toml', 'src/instruments/micmic/rust/core/src/lib.rs',
    'src/instruments/micmic/rust/cpal/Cargo.toml', 'src/instruments/micmic/rust/cpal/src/main.rs',
    'src/instruments/micmic/rust/cpal/src/audio.rs', 'src/instruments/micmic/rust/cpal/src/options.rs',
    'src/instruments/micmic/rust/cpal/src/wav.rs', 'src/instruments/micmic/rust/cpal/src/bench.rs',
  ];
  const digests = {};
  for (const source of sources) {
    const file = path.join(ROOT, source);
    digests[source] = existsSync(file) ? sha256(await readFile(file)) : null;
  }
  for (const source of ['input-mono.wav', 'input-stereo.wav']) digests[source] = sha256(await readFile(path.join(destination, source)));
  return { algorithm: 'SHA-256', sources: digests,
    nativeExecutable: existsSync(binary) ? sha256(await readFile(binary)) : null };
}

export function listeningReport(report) {
  const cards = report.scenarios.map(row => {
    const players = [['javascript', 'JavaScript DSP reference'], ['rust', 'Rust DSP via CPAL executable']]
      .filter(([key]) => row[key]).map(([key, title]) => {
        const data = row[key];
        const metrics = data.metrics;
        return `<label>${title}<audio controls preload="none" data-raw="${safeHtml(data.file)}" data-matched="${safeHtml(data.matchedFile)}" src="${safeHtml(data.matchedFile)}"></audio><small>Raw peak ${metrics.peak.toFixed(4)} · RMS ${metrics.rms.toFixed(4)}<br>Centroid ${metrics.spectral.centroidHz.toFixed(1)} Hz · stereo correlation ${metrics.stereoCorrelation.toFixed(3)}<br>Low / mid / high energy ${(metrics.spectral.bandEnergyFractions.hz20to200 * 100).toFixed(1)}% / ${(metrics.spectral.bandEnergyFractions.hz200to1000 * 100).toFixed(1)}% / ${(metrics.spectral.bandEnergyFractions.hz1000to8000 * 100).toFixed(1)}%<br>Tail RMS ${metrics.tailRms.toFixed(5)} · ${metrics.clippedSamples} samples near unity</small></label>`;
      }).join('');
    return `<article><h3>${safeHtml(row.title)}</h3><p>${safeHtml(row.origin)}</p><p>${row.voiceCount} initial voices · ${row.pitchCount} distinct initial rates${row.pitchDetail ? ` · ${row.pitchDetail.mergedShiftedPitches} merged requested shifted pitches` : ''}</p>${players}<p>${row.difference ? `Matched-engine error: max ${row.difference.maxAbs.toExponential(3)}, RMS ${row.difference.rms.toExponential(3)}.` : 'Expanded topology is a native extension; no matching browser render is claimed.'}</p></article>`;
  }).join('');
  const benchmarks = report.benchmarks.map(row => `<tr><td>${row.voices}</td><td>${row.javascript?.timing.medianMs.toFixed(3) ?? '—'}</td><td>${row.rust?.timing.medianMs.toFixed(3) ?? '—'}</td><td>${row.javascript?.timing.p99Ms.toFixed(3) ?? '—'}</td><td>${row.rust?.timing.p99Ms.toFixed(3) ?? '—'}</td><td>${row.rust && row.javascript ? (row.javascript.timing.meanMs / row.rust.timing.meanMs).toFixed(2) + '×' : '—'}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L-system Delay · Rust comparison</title><style>body{background:#101419;color:#e8eeee;font:16px/1.55 system-ui;max-width:1000px;margin:auto;padding:32px}h1,h2,h3{line-height:1.25}article{padding:22px 0;border-top:1px solid #35404a}label{display:inline-block;max-width:100%;margin:8px 20px 8px 0}audio{display:block;max-width:100%;width:390px;margin-top:8px}button{background:#1b4c4c;color:#fff;padding:10px;border:0;border-radius:5px}.table-scroll{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid #35404a;padding:8px;text-align:right}th:first-child,td:first-child{text-align:left}small{color:#b2c1ca}</style><h1>L-system Delay · Rust comparison</h1><p>Same deterministic source, 48 kHz, 128-frame blocks, identical scene events. These clips isolate the current raw-history granular DSP. The browser's input filter, master gain, compressor and other outer routing are excluded. CPAL handles native audio I/O; it supplies no pitch/time algorithm itself.</p><p><button id="match">Use level matching (−18 dBFS RMS)</button> <button id="original">Use original render levels</button></p><p>Each matched WAV targets −18 dBFS RMS, with a 0.9 peak ceiling. Raw and matched copies are retained. Clips can be downloaded through the browser's audio menu. Only one player runs at a time.</p><h2>Listening clips</h2>${cards}<h2>Measured processing cost</h2><p>Single-process offline processing, startup/history priming excluded, three repetitions. Each block has a 2.667 ms deadline. JavaScript above 1024 bypasses only its production guard for controlled stress; it is not an available browser mode. CPU/headroom estimates are not a hardware stream underrun test. Spectral quality and musical preference require listening.</p><div class="table-scroll" tabindex="0" aria-label="Processing cost table"><table><thead><tr><th>Voices</th><th>JS median ms</th><th>Rust median ms</th><th>JS p99 ms</th><th>Rust p99 ms</th><th>Mean speedup</th></tr></thead><tbody>${benchmarks}</tbody></table></div><p><small>${safeHtml(report.environment.cpu)} · ${safeHtml(report.environment.platform)} · Node ${safeHtml(report.environment.node)} · source commit ${safeHtml(report.environment.commit)} · ${safeHtml(report.generatedAt)}</small></p><p><a href="results.json">Full machine-readable results</a></p><script>const players=[...document.querySelectorAll('audio')];for(const player of players)player.addEventListener('play',()=>{for(const other of players)if(other!==player)other.pause()});function use(matched){for(const player of players){player.pause();player.src=matched?player.dataset.matched:player.dataset.raw;player.load()}}document.querySelector('#match').onclick=()=>use(true);document.querySelector('#original').onclick=()=>use(false);</script></html>`;
}

export async function runComparison({ out, native, seconds = 4, prepareOnly = false, skipJsBench = false, benchCounts = BENCH_COUNTS } = {}) {
  const destination = path.resolve(out ?? path.join(ROOT, 'artifacts/l-system-delay-comparison'));
  const binary = path.resolve(native ?? path.join(ROOT, 'src/instruments/micmic/rust/target/release/l-system-delay-cpal'));
  if (!prepareOnly && !existsSync(binary)) throw new Error(`Build the Rust executable first: ${binary}`);
  await mkdir(destination, { recursive: true });
  const mono = makeInput(seconds), stereo = makeInput(seconds, SAMPLE_RATE, 2);
  await writeFile(path.join(destination, 'input-mono.wav'), encodeFloatWav(mono, SAMPLE_RATE, 1));
  await writeFile(path.join(destination, 'input-stereo.wav'), encodeFloatWav(stereo, SAMPLE_RATE, 2));
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  let cpuAffinity = null;
  try { cpuAffinity = (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null; } catch { /* Non-Linux host. */ }
  const provenance = await provenanceDigests(binary, destination);
  const report = { generatedAt: new Date().toISOString(), environment: {
    commit, platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    nativeBinary: binary, cpuAffinityAllowedList: cpuAffinity,
    rustCompiler: spawnSync('rustc', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? null,
    provenance,
  }, method: { sampleRate: SAMPLE_RATE, blockFrames: BLOCK_FRAMES, historySeconds: HISTORY_SECONDS,
    seconds, rmsMatchingTarget: MATCHED_RMS, rmsMatchingDbfs: -18, capture: 'DSP core only; offline rendering, not device latency or browser AudioWorklet timing',
    benchmark: 'Independent shifted voices; 40-second history primed untimed; 128 warmup blocks then 3 × 64 measured blocks',
    source: 'Deterministic harmonic tones, chirp, seeded-noise transients; input becomes silent at 1.8 s',
    nativeMemory: '40-second mono float32 history is 7,680,000 bytes, independent of voice count, plus fixed voice state',
    browserMemory: 'Granular economy also shares raw history; Silky spectral bank needs one 40-second history per lane plus raw unison (3–16 shifted lanes)' },
    scenarios: [], benchmarks: [] };
  for (const scenario of comparisonScenarios()) {
    const sceneFile = `${scenario.name}.scene.json`;
    const sceneJson = JSON.stringify(scenario.scene);
    await writeFile(path.join(destination, sceneFile), sceneJson);
    const row = { ...scenario, scene: undefined, sceneFile,
      sceneSha256: sha256(sceneJson),
      voiceCount: scenario.scene.events[0].voices.length,
      pitchCount: new Set(scenario.scene.events[0].voices.map(voice => voice.rate)).size };
    const input = scenario.scene.channels === 2 ? stereo : mono;
    if (!scenario.nativeOnly) {
      process.stderr.write(`JavaScript reference: ${scenario.name}\n`);
      const audio = renderReference(scenario.scene, input, seconds);
      const file = `${scenario.name}.javascript.wav`;
      await writeFile(path.join(destination, file), encodeFloatWav(audio));
      const matched = levelMatch(audio);
      const matchedFile = `${scenario.name}.javascript.matched.wav`;
      await writeFile(path.join(destination, matchedFile), encodeFloatWav(matched.samples));
      row.javascript = { file, metrics: signalMetrics(audio), matchedFile,
        matching: { gain: matched.gain, targetRms: matched.targetRms, metrics: matched.metrics } };
    }
    if (!prepareOnly) {
      process.stderr.write(`Rust reference: ${scenario.name}\n`);
      const file = `${scenario.name}.rust.wav`;
      runNative(binary, ['--scene', path.join(destination, sceneFile), '--input', path.join(destination, `input-${scenario.scene.channels === 2 ? 'stereo' : 'mono'}.wav`),
        '--seconds', String(seconds), '--render', path.join(destination, file), '--level', '1']);
      const rendered = decodeFloatWav(await readFile(path.join(destination, file)));
      if (rendered.sampleRate !== SAMPLE_RATE || rendered.channels !== 2) throw new Error('Native render changed the configured sample rate/channel layout');
      const matched = levelMatch(rendered.samples);
      const matchedFile = `${scenario.name}.rust.matched.wav`;
      await writeFile(path.join(destination, matchedFile), encodeFloatWav(matched.samples));
      row.rust = { file, metrics: signalMetrics(rendered.samples), matchedFile,
        matching: { gain: matched.gain, targetRms: matched.targetRms, metrics: matched.metrics } };
      if (row.javascript) {
        row.difference = differenceMetrics(decodeFloatWav(await readFile(path.join(destination, row.javascript.file))).samples, rendered.samples);
        row.parity = { passed: row.difference.maxAbs <= PARITY_MAX_ABS, maxAbsThreshold: PARITY_MAX_ABS };
      }
    }
    report.scenarios.push(row);
    await writeFile(path.join(destination, 'results.json'), JSON.stringify(report, null, 2));
    if (row.parity && !row.parity.passed) throw new Error(`DSP parity failed for ${row.name}: maxAbs ${row.difference.maxAbs} exceeds ${PARITY_MAX_ABS}; raw WAVs and partial results.json retained`);
  }
  for (const count of benchCounts) {
    const scene = sceneForVoices(stressVoices(count));
    const sceneFile = `stress-${count}.scene.json`;
    const sceneJson = JSON.stringify(scene);
    await writeFile(path.join(destination, sceneFile), sceneJson);
    const row = { voices: count, sceneFile, sceneSha256: sha256(sceneJson) };
    if (!skipJsBench) {
      process.stderr.write(`JavaScript benchmark: ${count} voices\n`);
      row.javascript = benchmarkReference(count, mono);
    }
    if (!prepareOnly) {
      process.stderr.write(`Rust benchmark: ${count} voices\n`);
      const benchFile = `stress-${count}.rust.bench.json`;
      runNative(binary, ['--scene', path.join(destination, sceneFile), '--input', path.join(destination, 'input-mono.wav'),
        '--seconds', String(seconds), '--bench', path.join(destination, benchFile), '--level', '1',
        '--bench-blocks', '64', '--bench-warmup', '128', '--bench-repetitions', '3']);
      row.rust = JSON.parse(await readFile(path.join(destination, benchFile), 'utf8'));
    }
    report.benchmarks.push(row);
    await writeFile(path.join(destination, 'results.json'), JSON.stringify(report, null, 2));
  }
  await writeFile(path.join(destination, 'listening.html'), listeningReport(report));
  process.stdout.write(`${path.join(destination, 'listening.html')}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out') options.out = args[++index];
    else if (arg === '--native' || arg === '--binary') options.native = args[++index];
    else if (arg === '--seconds') options.seconds = Number(args[++index]);
    else if (arg === '--prepare-only' || arg === '--prepare') options.prepareOnly = true;
    else if (arg === '--skip-js-bench') options.skipJsBench = true;
    else if (arg === '--bench-counts') options.benchCounts = args[++index].split(',').map(Number);
    else if (arg === '--help') {
      process.stdout.write('node scripts/compare-l-system-delay.mjs [--out directory] [--native executable | --binary executable] [--seconds 4] [--prepare-only | --prepare] [--skip-js-bench] [--bench-counts 48,128,...]\n');
      process.exit(0);
    } else throw new Error(`Unknown comparison option: ${arg}`);
  }
  if (options.seconds !== undefined && (!Number.isFinite(options.seconds) || options.seconds < 3 || options.seconds > 60)) throw new Error('--seconds must be from 3 to 60');
  await runComparison(options);
}
