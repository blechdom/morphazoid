// Offline native-source authoring. Slot zero keeps the existing Witch taste.
// Regenerate only this bank: node scripts/build-witch-source-variants.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS } from '../src/instruments/fractal-signals/presets.js';
import { JAW_HARP_FULL_PRESETS } from '../src/instruments/jaw-harp/full-presets.js';
import { HARMONICA_DEFAULTS } from '../src/instruments/harmonica/harmonica.js';
import { HARMONICA_FULL_PRESETS } from '../src/instruments/harmonica/full-presets.js';
import { stateFromPreset, getMethod } from '../src/instruments/synthesis/catalog.js';
import { DENTAPHONE_FULL_PRESETS } from '../src/instruments/object-forge/full-presets.js';
import { DENTAPHONE_BRUSH_ROUTE, buildDentaphonePitchMap } from '../src/instruments/object-forge/dentaphone.js';
import { linearDrumParameters } from '../src/instruments/linear-drums/linear-drums.js';
import { createQuadrupedGestureCall } from '../src/instruments/quadruped/quadruped-gesture-voices.js';

const RATE = 22050, SECONDS = 2.4, FRAMES = Math.round(RATE * SECONDS), TAU = Math.PI * 2;
let seed = 0x5eac731;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
globalThis.sampleRate = RATE; globalThis.currentFrame = 0; globalThis.currentTime = 0;
const processors = new Map();
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
await import('../src/instruments/jaw-harp/jaw-harp-processor.js');
await import('../src/instruments/harmonica/harmonica-processor.js');
await import('../src/physical-sounds-processor.js');
await import('../src/instruments/synthesis/processor.js');

const variants = {};
function begin() { globalThis.currentFrame = 0; globalThis.currentTime = 0; }
function render(next, before = () => {}) {
  const out = new Float32Array(FRAMES);
  for (let at = 0; at < out.length; at += 128) {
    globalThis.currentFrame = at; globalThis.currentTime = at / RATE; before(at / RATE);
    const n = Math.min(128, out.length - at), left = new Float32Array(n), right = new Float32Array(n);
    next(left, right);
    for (let i = 0; i < n; i++) out[at + i] = (left[i] + right[i]) * .5;
  }
  return out;
}
function save(id, instrumentId, source, data, events) {
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${id}: nonfinite render`);
    data[i] *= Math.min(1, i / (RATE * .006), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-7) throw new Error(`${id}: silent render`);
  let gain = .14 / rms;
  const softPeak = peak * gain > .65;
  if (softPeak) {
    // Fixed offline conditioning, never a level follower. Dense clicks retain
    // their score and envelope without one transient making the taste quiet.
    const conditionedRms = candidate => {
      let energy = 0;
      for (const sample of data) energy += (.65 * Math.tanh(sample * candidate / .65)) ** 2;
      return Math.sqrt(energy / data.length);
    };
    let low = 0, high = gain;
    while (conditionedRms(high) < .14) high *= 2;
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) * .5;
      if (conditionedRms(middle) < .14) low = middle; else high = middle;
    }
    gain = (low + high) * .5;
  }
  const bytes = Buffer.alloc(data.length * 2); sum = 0; peak = 0;
  for (let i = 0; i < data.length; i++) {
    const sample = softPeak ? .65 * Math.tanh(data[i] * gain / .65) : data[i] * gain;
    sum += sample ** 2; peak = Math.max(peak, Math.abs(sample));
    bytes.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const bank = variants[id] ??= [null];
  bank.push({ instrumentId, source, rate: RATE, frames: data.length, events, pcm: bytes.toString('base64') });
  console.log(`${id}[${bank.length - 1}]: ${events} events; ${data.length} frames; RMS ${Math.sqrt(sum / data.length).toFixed(4)}; peak ${peak.toFixed(4)}${softPeak ? '; fixed soft peak' : ''}`);
}

for (const presetId of ['grammar-tangled-bells', 'texture-gravel-static']) {
  begin();
  const state = FACTORY_PRESETS.find(p => p.id === presetId).snapshot;
  const dsp = new FractalDSP(RATE, state, generateStructure(state));
  let events = 0;
  const trigger = dsp.trigger.bind(dsp); dsp.trigger = (...args) => { events++; return trigger(...args); };
  dsp.setPlaying(true);
  const data = render((left, right) => dsp.process(left, right));
  save('drop-fractal', 'fractal-signals', `FractalDSP / native ${presetId} factory scene`, data, events);
}

const Jaw = processors.get('jaw-harp-physical-model');
for (const [presetId, period, breathRate] of [['deep-overtone', .19, 98], ['sicilian-chatter', .083, 164]]) {
  begin();
  const configuration = { ...JAW_HARP_FULL_PRESETS.find(p => p.id === presetId).snapshot.parameters,
    repeat: false, autoBreath: true, breathLinked: false, breathRateBpm: breathRate, vowelSequenceMode: 'pluck' };
  const jaw = new Jaw({ processorOptions: { configuration } });
  let last = -1, events = 0;
  const data = render((left, right) => jaw.process([], [[left, right]]), t => {
    const event = Math.floor(t / period);
    if (event === last || t >= 2.04) return;
    last = event; events++;
    jaw._handleMessage({ type: 'configure', configuration: {
      jawOpening: configuration.jawOpening + .45 * Math.sin(event * 1.71),
      tongueHeight: configuration.tongueHeight + .3 * Math.cos(event * .83),
    } });
    jaw._handleMessage({ type: 'pluck', force: configuration.pluckForce * (event % 3 ? .72 : 1),
      direction: event % 2 ? -1 : 1, position: configuration.pluckPosition });
  });
  save('drop-jaw-harp', 'jaw-harp', `JawHarpPhysicalProcessor / ${presetId}, native vowel sequence and ${period}s alternating plucks`, data, events);
}

const Harmonica = processors.get('harmonica-physical-model');
for (const [presetId, period, holes] of [
  ['midnight-growl', .28, [2, 1, 3, 2, 4, 2, 1, 3]],
  ['fox-chase', .115, [2, 3, 2, 4, 3, 2, 5, 3]],
]) {
  begin();
  const configuration = { ...HARMONICA_DEFAULTS, ...HARMONICA_FULL_PRESETS.find(p => p.id === presetId).snapshot,
    autoBreath: false };
  const harmonica = new Harmonica({ processorOptions: { configuration } });
  let last = -1, events = 0;
  const data = render((left, right) => harmonica.process([], [[left, right]]), t => {
    const event = Math.floor(t / period);
    if (t < 2.05 && event !== last) {
      last = event; events++;
      harmonica._handleMessage({ type: 'configure', configuration: {
        hole: holes[event % holes.length], handCup: .3 + .65 * Math.sin(event * .72) ** 2,
      } });
    }
    harmonica._handleMessage({ type: 'breath', manual: true,
      flow: t >= 2.05 ? 0 : (presetId === 'midnight-growl' || event % 3 ? -.95 : .85)
        * Math.sin(Math.PI * (t % period) / period) ** 2 });
  });
  save('drop-harmonicazoid', 'harmonica', `HarmonicaPhysicalProcessor / ${presetId}, native technique and pulsed moving holes`, data, events);
}

const wasm = await WebAssembly.compile(await readFile(new URL('../assets/wasm/synthesis.wasm', import.meta.url)));
const Synth = processors.get('roads-synthesis');
for (const [method, presetId, period, root, ratios] of [
  ['phase-distortion', 'resonant-synthetic-vowel', .073, 87, [1, 1.41, 1.07, 2.13, 1.69, .78, 2.77, 1.19]],
  ['waveguide', 'ragged-bass-reed', .137, 111, [2.31, 1.73, 1.37, 1.11, .89, 1.49, 1.03]],
]) {
  begin();
  const synth = new Synth({ processorOptions: { module: wasm, outputArmed: true } });
  synth.message({ type: 'state', state: { ...stateFromPreset(method, presetId), kind: 'synthesis',
    engineId: getMethod(method).engineId, voiceMode: 'poly', levelTrimDb: 0 } });
  let last = -1, events = 0;
  const data = render((left, right) => synth.process([], [[left, right]]), t => {
    const event = Math.floor(t / period);
    if (event === last || t >= 2.03) return;
    last = event; events++;
    synth.message({ type: 'note', frequency: root * ratios[event % ratios.length],
      velocity: event % 4 ? .57 : .79, duration: period * 1.25, at: t });
  });
  synth.message({ type: 'dispose' });
  save('drop-synthesaurus', 'synthesis', `Synthesaurus WASM / ${method} ${presetId}, continuous-ratio ${period}s phrase`, data, events);
}

const Physical = processors.get('morphazoid-physical-sounds');
for (const [presetId, period, reverse] of [['bronze-drone', .112, false], ['tiny-glass-bells', .049, true]]) {
  begin();
  const preset = DENTAPHONE_FULL_PRESETS.find(p => p.id === presetId).snapshot;
  const pitches = buildDentaphonePitchMap(preset.pitch), teeth = new Physical({ processorOptions: { kind: 'object-forge', configuration: preset.sound } });
  let last = -1, events = 0;
  const data = render((left, right) => teeth.process([], [[left, right]]), t => {
    const event = Math.floor(t / period);
    if (event === last || t >= 2.02) return;
    last = event; events++;
    const routeIndex = reverse ? (DENTAPHONE_BRUSH_ROUTE.length - 1 - event % DENTAPHONE_BRUSH_ROUTE.length) : event % DENTAPHONE_BRUSH_ROUTE.length;
    const tooth = pitches.find(t => t.id === DENTAPHONE_BRUSH_ROUTE[routeIndex]);
    teeth._handleMessage({ type: 'configure', configuration: preset.sound,
      fundamentalOverrideHz: 440 * 2 ** ((tooth.midi - 69) / 12) });
    teeth._handleMessage({ type: 'excite', strength: event % 4 ? .48 : .76,
      position: tooth.strikePosition, hardness: reverse ? .88 : .48 });
  });
  save('drop-dentaphone', 'object-forge', `Dentaphone native modal processor / ${presetId}, ${reverse ? 'reversed' : 'forward'} brush route and authored tooth pitch map`, data, events);
}

// Rattlesnake's scalar modal excerpt retains its native pitch-dependent
// ratios, damping, strike noise and pitch fall, with two newly authored scores.
for (const variant of [1, 2]) {
  const out = new Float32Array(FRAMES), count = variant === 1 ? 48 : 58;
  const settings = variant === 1 ? { model: 'modal', inharmonicity: .91, brightness: .76, pitchFall: 1.38, decay: .52 }
    : { model: 'modal', inharmonicity: .32, hardness: .89, brightness: .67, pitchFall: .47, decay: .38 };
  for (let event = 0; event < count; event++) {
    const at = variant === 1 ? event * .041 : event * .034 + (event % 4 === 3 ? .012 : 0);
    const degree = variant === 1 ? (47 - event) % 23 : (event % 18 < 9 ? event % 18 : 17 - event % 18) * 2;
    const frequency = (variant === 1 ? 83 : 159) * (variant === 1 ? 1.137 : 1.151) ** degree;
    const p = linearDrumParameters(frequency, settings), phases = new Float64Array(p.modalRatios.length);
    const start = Math.round(at * RATE);
    for (let i = 0; i < Math.min(RATE * .46, out.length - start); i++) {
      const t = i / RATE, attack = Math.min(1, t / p.attack); let sample = 0;
      for (let band = 0; band < phases.length; band++) {
        const hz = frequency * p.modalRatios[band] * 2 ** (p.pitchDropOctaves * Math.exp(-t / p.pitchDropSeconds));
        if (hz > RATE * .43) continue;
        phases[band] += TAU * hz / RATE;
        sample += Math.sin(phases[band]) * p.modalGains[band] * Math.exp(-t / (p.decay / (1 + band * p.highDamping)));
      }
      out[start + i] += (sample * .22 + (Math.random() * 2 - 1) * p.noiseMix * Math.exp(-t / p.noiseDecay)) * attack;
    }
  }
  save('drop-marimba', 'linear-drums', `Rattlesnake linearDrumParameters / ${count} ${variant === 1 ? 'falling inharmonic' : 'folding sharp'} modal strikes`, out, count);
}

// Fixed scalar rendition of Quadruped's authored call descriptors and native
// scheduleCall envelopes: bandpassed oscillator plus the quiet sine undertone.
// These are synthetic character calls, not animal recordings.
function bandpass(frequency, q) {
  const omega = TAU * Math.min(RATE * .43, frequency) / RATE, alpha = Math.sin(omega) / (2 * q), inverse = 1 / (1 + alpha);
  const b = alpha * inverse, a1 = -2 * Math.cos(omega) * inverse, a2 = (1 - alpha) * inverse;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return input => { const output = b * (input - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = input; y2 = y1; y1 = output; return output; };
}
function oscillator(type, phase, frequency) {
  if (type === 'sine') return Math.sin(TAU * phase);
  const partials = Math.min(48, Math.floor(RATE * .43 / frequency)); let sample = 0;
  for (let harmonic = 1; harmonic <= partials; harmonic++) {
    if (type !== 'sawtooth' && harmonic % 2 === 0) continue;
    const gain = type === 'triangle' ? 8 / Math.PI ** 2 * (harmonic % 4 === 1 ? 1 : -1) / harmonic ** 2
      : type === 'square' ? 4 / Math.PI / harmonic : -2 / Math.PI / harmonic;
    sample += gain * Math.sin(TAU * phase * harmonic);
  }
  return sample;
}
function exponentialEnvelope(t, duration, attack, peak, sustain = true) {
  const floor = .0001, startRelease = sustain ? duration * .72 : attack;
  if (t < attack) return floor * (peak / floor) ** (t / attack);
  if (t < startRelease) return peak * .72 ** ((t - attack) / (startRelease - attack));
  const from = sustain ? peak * .72 : peak;
  return from * (floor / from) ** ((t - startRelease) / (duration - startRelease));
}
function addCall(out, call, at) {
  const renderVoice = (start, duration, frequencies, offsets, type, gain, attack, filterHz, q, arpeggio = false) => {
    let phase = 0; const filter = bandpass(filterHz, q), first = Math.round(start * RATE);
    for (let i = 0; i < Math.min(Math.ceil(duration * RATE), out.length - first); i++) {
      const t = i / RATE;
      let index = 0; while (index + 1 < offsets.length && t >= offsets[index + 1]) index++;
      const next = Math.min(index + 1, frequencies.length - 1);
      const mix = next === index ? 0 : Math.min(1, (t - offsets[index]) / (offsets[next] - offsets[index]));
      let frequency = frequencies[index] + (frequencies[next] - frequencies[index]) * mix;
      if (arpeggio) frequency *= 1.02 * (.997 / 1.02) ** (t / duration);
      phase = (phase + frequency / RATE) % 1;
      const pulse = call.pulse ? .58 + .42 * Math.sin(t * call.pulse * TAU) : 1;
      out[first + i] += filter(oscillator(type, phase, frequency)
        * exponentialEnvelope(t, duration, attack, gain * call.intensity, !arpeggio)) * pulse;
    }
  };
  const pitches = call.notes.map(note => 440 * 2 ** ((note - 69) / 12));
  if (call.articulation === 'arpeggio') {
    pitches.forEach((pitch, i) => renderVoice(at + call.noteOffsetsSeconds[i], call.noteDurationSeconds,
      [pitch], [0], call.type, .14, call.attackSeconds, call.filter, .8, true));
  } else {
    renderVoice(at, call.duration, pitches, call.noteOffsetsSeconds, call.type, .19, call.attackSeconds, call.filter, .85);
    renderVoice(at, call.duration, pitches.map(pitch => pitch * .5), call.noteOffsetsSeconds, 'sine', .055,
      call.undertoneAttackSeconds, call.filter * .6, .55);
  }
}
for (const animal of ['cat', 'mouse', 'lizard']) for (const row of [1, 2]) {
  const score = { animalId: animal, tempoBpm: animal === 'cat' && row === 1 ? 104 : 138, pitchSemitones: 0 };
  const call = createQuadrupedGestureCall(score, { row, strength: .9 });
  const out = new Float32Array(FRAMES), spacing = call.duration + (animal === 'cat' ? .13 : .085);
  let events = 0;
  for (let at = .012; at + call.duration <= 2.2; at += spacing) { addCall(out, call, at); events++; }
  save(`drop-${animal}`, 'quadruped', `Quadruped ${animal} / native ${call.label} call descriptor, ${score.tempoBpm} BPM scalar scheduleCall rendition`, out, events);
}

for (const [id, bank] of Object.entries(variants)) if (bank.length !== 3 || bank[0] !== null) throw new Error(`${id}: expected base plus two variants`);
await writeFile(new URL('../src/instruments/witch/witch-bite-source-variants.js', import.meta.url),
  `// Generated by scripts/build-witch-source-variants.mjs; PCM16LE mono at 22050 Hz.\n// Native source and license provenance: docs/witch-source-variants.md.\nexport const WITCH_SOURCE_BITE_VARIANTS = Object.freeze(${JSON.stringify(variants)});\n`);
