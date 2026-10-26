// Rebuild the Witch's finite PCM excerpts from the repository's real engines.
// This is offline authoring only: the Witch never boots these instruments.
import { readFile, writeFile } from 'node:fs/promises';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS } from '../src/instruments/fractal-signals/presets.js';
import { JAW_HARP_DEFAULTS } from '../src/instruments/jaw-harp/jaw-harp.js';
import { HARMONICA_DEFAULTS } from '../src/instruments/harmonica/harmonica.js';
import { stateFromPreset, getMethod } from '../src/instruments/synthesis/catalog.js';
import { DENTAPHONE_FULL_PRESETS } from '../src/instruments/object-forge/full-presets.js';
import { DENTAPHONE_BRUSH_ROUTE, DENTAPHONE_TEETH } from '../src/instruments/object-forge/dentaphone.js';
import { linearDrumParameters } from '../src/instruments/linear-drums/linear-drums.js';
import { mathArtwork, MATH_PRESETS } from '../src/instruments/blech-midi/blech-midi-math.js';
import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from '../src/instruments/midi-mixer/vendor/spessasynth-core.js';
import { renderObjectSound, OBJECT_SOUND_PROFILES } from '../src/instruments/puggler/puggler-object-sounds.js';
import { renderCharacterVocal, vocalCharacter } from '../src/instruments/puggler/puggler-vocals.js';
import { copyClip } from '../src/instruments/puggler/puggler-voice-dsp.js';
import { WitchCatDSP } from '../src/instruments/witch/witch-cat-audio.js';
import { quadrupedCalls } from '../src/instruments/quadruped/quadruped-voices.js';

const RATE = 22050, TAU = Math.PI * 2;
let seed = 0x73ac51;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
globalThis.sampleRate = RATE; globalThis.currentFrame = 0; globalThis.currentTime = 0;
const processors = new Map();
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
await import('../src/instruments/jaw-harp/jaw-harp-processor.js');
await import('../src/instruments/harmonica/harmonica-processor.js');
await import('../src/physical-sounds-processor.js');
await import('../src/instruments/synthesis/processor.js');

function render(seconds, next, before = () => {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let at = 0; at < out.length; at += 128) {
    globalThis.currentFrame = at; globalThis.currentTime = at / RATE; before(at / RATE, at);
    const n = Math.min(128, out.length - at), left = new Float32Array(n), right = new Float32Array(n);
    next(left, right);
    for (let i = 0; i < n; i++) out[at + i] = (left[i] + right[i]) * .5;
  }
  return out;
}
const clips = {};
function save(id, instrumentId, source, data, events) {
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${id}: nonfinite render`);
    data[i] *= Math.min(1, i / (RATE * .006), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-7) throw new Error(`${id}: silent render`);
  const gain = Math.min(.14 / rms, .65 / peak);
  const bytes = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) bytes.writeInt16LE(Math.round(data[i] * gain * 32767), i * 2);
  clips[id] = { instrumentId, source, rate: RATE, frames: data.length, events, pcm: bytes.toString('base64') };
  console.log(`${id}: ${data.length} frames, ${events} events, RMS ${(rms * gain).toFixed(4)}`);
}

const fractalState = FACTORY_PRESETS.find(p => p.id === 'wander-copper-zip').snapshot;
const fractal = new FractalDSP(RATE, fractalState, generateStructure(fractalState)); fractal.setPlaying(true);
save('drop-fractal', 'fractal-signals', 'FractalDSP / wander-copper-zip', render(2.4, (l, r) => fractal.process(l, r)), 60);

const Jaw = processors.get('jaw-harp-physical-model');
const jaw = new Jaw({ processorOptions: { configuration: { ...JAW_HARP_DEFAULTS, repeat: false, autoBreath: true, breathRateBpm: 118 } } });
let last = -1;
save('drop-jaw-harp', 'jaw-harp', 'JawHarpPhysicalProcessor / khomus', render(2.4, (l, r) => jaw.process([], [[l, r]]), t => {
  const event = Math.floor(t / .24);
  if (event !== last && t < 2.05) {
    last = event; jaw._handleMessage({ type: 'configure', configuration: { jawOpening: .25 + .65 * Math.sin(event * .83) ** 2, lipRounding: event % 3 * .3 } });
    jaw._handleMessage({ type: 'pluck', force: .7, direction: event % 2 ? -1 : 1, position: .32 });
  }
}), 9);

const Harmonica = processors.get('harmonica-physical-model');
const harmonica = new Harmonica({ processorOptions: { configuration: { ...HARMONICA_DEFAULTS, autoBreath: false, hole: 3, chordWidth: 1 } } }); last = -1;
save('drop-harmonicazoid', 'harmonica', 'HarmonicaPhysicalProcessor / alternating bent breaths', render(2.4, (l, r) => harmonica.process([], [[l, r]]), t => {
  const event = Math.floor(t / .29);
  if (event !== last) { last = event; harmonica._handleMessage({ type: 'configure', configuration: { hole: [3, 4, 2, 5, 3, 2, 4, 3, 3][event], handCup: (event % 3) * .35 } }); }
  harmonica._handleMessage({ type: 'breath', manual: true, flow: t > 2.1 ? 0 : (event % 2 ? -.92 : .8) * Math.sin(Math.PI * (t % .29) / .29) ** 2 });
}), 8);

const wasm = await WebAssembly.compile(await readFile(new URL('../assets/wasm/synthesis.wasm', import.meta.url)));
const Synth = processors.get('roads-synthesis');
const synth = new Synth({ processorOptions: { module: wasm, outputArmed: true } });
const sound = stateFromPreset('fm', 'inharmonic-bell');
synth.message({ type: 'state', state: { ...sound, kind: 'synthesis', engineId: getMethod('fm').engineId, voiceMode: 'poly', levelTrimDb: 0 } }); last = -1;
save('drop-synthesaurus', 'synthesis', 'Synthesaurus WASM / FM inharmonic-bell', render(2.4, (l, r) => synth.process([], [[l, r]]), t => {
  const event = Math.floor(t / .095);
  if (event !== last && t < 2) { last = event; synth.message({ type: 'note', frequency: 131 * [1, 1.37, 2.11, 1.73, .89, 2.63, 1.17][event % 7], velocity: .65, duration: .11, at: t }); }
}), 22);
synth.message({ type: 'dispose' });

const Physical = processors.get('morphazoid-physical-sounds');
const toothSound = DENTAPHONE_FULL_PRESETS.find(p => p.id === 'steel-plates').snapshot.sound;
const teeth = new Physical({ processorOptions: { kind: 'object-forge', configuration: toothSound } }); last = -1;
save('drop-dentaphone', 'object-forge', 'Dentaphone steel-plates / actual brush route and modal processor', render(2.4, (l, r) => teeth.process([], [[l, r]]), t => {
  const event = Math.floor(t / .085);
  if (event !== last && t < 1.9) {
    last = event; const toothId = DENTAPHONE_BRUSH_ROUTE[event % DENTAPHONE_BRUSH_ROUTE.length];
    const tooth = DENTAPHONE_TEETH.find(t => t.id === toothId) ?? DENTAPHONE_TEETH[event % 32];
    teeth._handleMessage({ type: 'configure', configuration: toothSound, fundamentalOverrideHz: 147 * Math.pow(1.079, event % 14) });
    teeth._handleMessage({ type: 'excite', strength: .63, position: tooth.strikePosition, hardness: .75 });
  }
}), 23);

// Scalar excerpt of Rattlesnake's native modal branch: the same frequency-
// dependent modes, gains, damping and strike-noise parameters, in a fixed score.
const cascade = new Float32Array(Math.round(RATE * 2.4));
for (let event = 0; event < 36; event++) {
  const at = event * .054, frequency = 137 * Math.pow(1.115, (35 - event) % 17);
  const p = linearDrumParameters(frequency), phases = new Float64Array(p.modalRatios.length);
  for (let i = 0; i < Math.min(RATE * .42, cascade.length - Math.round(at * RATE)); i++) {
    const t = i / RATE, attack = Math.min(1, t / p.attack); let sample = 0;
    for (let band = 0; band < phases.length; band++) {
      const hz = frequency * p.modalRatios[band] * 2 ** (p.pitchDropOctaves * Math.exp(-t / p.pitchDropSeconds));
      if (hz > RATE * .43) continue;
      phases[band] += TAU * hz / RATE;
      sample += Math.sin(phases[band]) * p.modalGains[band] * Math.exp(-t / (p.decay / (1 + band * p.highDamping)));
    }
    cascade[Math.round(at * RATE) + i] += (sample * .22 + (Math.random() * 2 - 1) * p.noiseMix * Math.exp(-t / p.noiseDecay)) * attack;
  }
}
save('drop-marimba', 'linear-drums', 'Rattlesnake linearDrumParameters / 36 falling modal strikes', cascade, 36);

SpessaLog.setLogLevel(false, false, false);
const blech = new SpessaSynthProcessor(RATE, { eventsEnabled: false }); await blech.processorInitialized;
const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
blech.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength)), 'witch-blech');
blech.setSystemParameter('voiceCap', 32); blech.programChange(0, 10);
const artwork = mathArtwork({ ...MATH_PRESETS.find(p => p.id === 'accelerator'), low: 39, high: 87, samples: 96, beats: 8, velocity: 92, gate: .58 });
const events = artwork.notes.flatMap(n => [{ at: n.beat * .51, on: true, note: n.note }, { at: (n.beat + n.duration) * .51, on: false, note: n.note }]).sort((a, b) => a.at - b.at);
let cursor = 0;
save('drop-blech', 'blech-midi', 'BLECH accelerator equation / SpessaSynth / TimGM6mb music box', render(5, (l, r) => blech.process(l, r, 0, l.length), t => {
  while (cursor < events.length && events[cursor].at <= t) { const e = events[cursor++]; if (e.on) blech.noteOn(0, e.note, 92); else blech.noteOff(0, e.note); }
}), artwork.notes.length);
blech.destroySynthProcessor();

async function wav(id) {
  const bytes = await readFile(new URL(`../assets/puggler/${id}.wav`, import.meta.url));
  let offset = 12, rate = RATE, channels = 1, data;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    if (name === 'fmt ') { channels = bytes.readUInt16LE(offset + 10); rate = bytes.readUInt32LE(offset + 12); if (bytes.readUInt16LE(offset + 22) !== 16) throw new Error('Expected PCM16'); }
    if (name === 'data') { data = new Float32Array(length / (2 * channels)); for (let i = 0; i < data.length; i++) data[i] = bytes.readInt16LE(offset + 8 + i * channels * 2) / 32768; }
    offset += 8 + length + (length % 2);
  }
  return { data, rate };
}
const drums = Object.fromEntries(await Promise.all(['kick', 'snare', 'hat', 'tom', 'oi'].map(async id => [id, await wav(id)])));
drums.oi = { data: renderCharacterVocal(drums.oi.data, RATE, vocalCharacter('punk', 0)), rate: RATE };
const punk = new Float32Array(Math.round(RATE * 2.4));
for (let step = 0; step < 16; step++) {
  const at = step * .125; copyClip(punk, RATE, drums.hat, { at, gain: .24 });
  if (step % 4 === 0 || step === 10) copyClip(punk, RATE, drums.kick, { at, gain: .7 });
  if (step % 4 === 2) copyClip(punk, RATE, drums.snare, { at, gain: .65 });
}
copyClip(punk, RATE, drums.oi, { at: .27, gain: .85 }); copyClip(punk, RATE, drums.oi, { at: 1.2, gain: .75 });
const guitarId = Object.values(OBJECT_SOUND_PROFILES.punk).find(p => p.family === 'guitar').propId;
copyClip(punk, RATE, { data: renderObjectSound('punk', guitarId, 'air', RATE, drums), rate: RATE }, { at: 0, gain: .2 });
save('drop-puggler', 'puggler', 'Puggler CC0 drums + rhink Oi / original punk character DSP', punk, 27);

const cat = new WitchCatDSP(RATE); cat.startMeow();
save('drop-cat', 'quadruped', 'Witch Quadruped cat / actual click-meow DSP', render(2.4, (l, r) => {
  for (let i = 0; i < l.length; i++) { cat.nextMeow(); l[i] = cat.meowLeft; r[i] = cat.meowRight; }
}), 1);
for (const animal of ['mouse', 'lizard']) {
  const calls = quadrupedCalls(animal), data = new Float32Array(Math.round(RATE * 2.4));
  for (let event = 0; event < 4; event++) {
    const call = calls[event % calls.length], duration = Math.min(.6, call.beats * .4), at = event * .41;
    let phase = 0, low = 0;
    for (let i = 0; i < duration * RATE; i++) {
      const t = i / RATE, position = t / duration * (call.notes.length - 1), j = Math.floor(position), blend = position - j;
      const midi = call.notes[j] * (1 - blend) + call.notes[Math.min(call.notes.length - 1, j + 1)] * blend;
      phase = (phase + 440 * 2 ** ((midi - 69) / 12) / RATE) % 1;
      const source = call.type === 'sine' ? Math.sin(TAU * phase) : call.type === 'triangle' ? 1 - 4 * Math.abs(phase - .5) : 2 * phase - 1;
      low += (source - low) * Math.min(.8, TAU * call.filter / RATE);
      data[Math.round(at * RATE) + i] += low * Math.sin(Math.PI * t / duration) ** 2 * .35;
    }
  }
  save(`drop-${animal}`, 'quadruped', `Quadruped ${animal} authored call contours / fixed oscillator excerpt`, data, 4);
}

const output = new URL('../src/instruments/witch/witch-bite-clips.js', import.meta.url);
await writeFile(output, `// Generated by scripts/build-witch-bites.mjs; PCM16LE mono at22050Hz.\n// Provenance and licenses: docs/witch-sound-bites.md.\nexport const WITCH_BITE_CLIPS = Object.freeze(${JSON.stringify(clips)});\n`);
