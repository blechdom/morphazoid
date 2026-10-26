// Rebuild the Witch's finite PCM excerpts from the repository's real engines.
// This is offline authoring only: the Witch never boots these instruments.
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS } from '../src/instruments/fractal-signals/presets.js';
import { JAW_HARP_DEFAULTS } from '../src/instruments/jaw-harp/jaw-harp.js';
import { HARMONICA_DEFAULTS } from '../src/instruments/harmonica/harmonica.js';
import { stateFromPreset, getMethod } from '../src/instruments/synthesis/catalog.js';
import { DENTAPHONE_FULL_PRESETS } from '../src/instruments/object-forge/full-presets.js';
import { DENTAPHONE_BRUSH_ROUTE, DENTAPHONE_TEETH } from '../src/instruments/object-forge/dentaphone.js';
import { linearDrumParameters } from '../src/instruments/linear-drums/linear-drums.js';
import { WitchCatDSP } from '../src/instruments/witch/witch-cat-audio.js';
import { quadrupedCalls } from '../src/instruments/quadruped/quadruped-voices.js';
import { RoachBodyEngine } from '../src/instruments/roach-synth/roach-synth-body-engine.js';
import { ROACH_SOUND_PRESETS } from '../src/instruments/roach-synth/roach-synth-dsp.js';
import { L_SYSTEMS_FULL_PRESETS } from '../src/instruments/l-systems/full-presets.js';
import { createDefaultState as createLSystemsState } from '../src/instruments/l-systems/state.js';
import { lSystemsTrace } from '../src/instruments/l-systems/branch-parameters.js';
import { L_SYSTEM_PRESETS } from '../src/instruments/l-system/l-system.js';
import { lSystemDrumTraversalStepSize } from '../src/instruments/l-system-drum-machine/l-system-drum-machine.js';
import { LSystemEventClock, lSystemNoteVoice, lSystemNoteDuration, lSystemNoteEnvelope } from '../src/instruments/l-systems/discrete-audio.js';
import { percussionEnvelopeTimeMs } from '../src/audio.js';

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
// A focused source addition preserves every previously authored PCM byte.
const treeOnly = process.argv.includes('--tree-only');
const clips = { ...(await import('../src/instruments/witch/witch-bite-clips.js')).WITCH_BITE_CLIPS };
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

if (!treeOnly) {
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

async function wav(id, folder = 'puggler') {
  const bytes = await readFile(new URL(`../assets/${folder}/${id}.wav`, import.meta.url));
  let offset = 12, rate = RATE, channels = 1, data;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    if (name === 'fmt ') { channels = bytes.readUInt16LE(offset + 10); rate = bytes.readUInt32LE(offset + 12); if (bytes.readUInt16LE(offset + 22) !== 16) throw new Error('Expected PCM16'); }
    if (name === 'data') { data = new Float32Array(length / (2 * channels)); for (let i = 0; i < data.length; i++) data[i] = bytes.readInt16LE(offset + 8 + i * channels * 2) / 32768; }
    offset += 8 + length + (length % 2);
  }
  return { data, rate };
}
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

// Wing radio's real outer-wing buzz and hindwing rustle, played as three
// accelerating flutter trains. The vivarium recording is movement texture;
// the wing sound itself is synthesized by the native body engine.
const wingPatch = ROACH_SOUND_PRESETS.find(p => p.id === 'wing-radio');
const wings = new RoachBodyEngine(RATE), wingMods = new Float64Array(80);
wings.setMix(wingPatch.bodyMix.map((row, i) => ({ ...row, level: i === 1 ? .8 : i === 2 ? .28 : 0 })), true);
const rustle = await wav('vivarium-rustle', 'roach-synth/audio');
const roachManifest = JSON.parse(await readFile(new URL('../assets/roach-synth/audio/manifest.json', import.meta.url), 'utf8'));
const rustleCues = roachManifest.samples.find(sample => sample.id === 'vivarium_rustle').cues;
wings.recordings.setBank([{ id: 'vivarium_rustle', data: rustle.data, sampleRate: rustle.rate, cues: rustleCues }]);
const flutter = new Float32Array(Math.round(RATE * 2.4));
const wingSound = { ...wingPatch.sound };
const trains = [[0, .66], [.82, 1.43], [1.61, 2.27]];
let movingWings = false;
for (let i = 0; i < flutter.length; i++) {
  const t = i / RATE;
  if (i % 32 === 0) {
    const train = trains.find(([start, end]) => t >= start && t < end);
    if (movingWings && !train) wings.resetActivity();
    movingWings = Boolean(train);
    const envelope = train ? Math.min(1, (t - train[0]) / .025, (train[1] - t) / .045) : 0;
    const pulse = Math.max(0, Math.sin(TAU * (8 * t + 1.5 * t * t))) ** 2;
    const velocity = envelope * (.08 + .92 * pulse);
    wingSound.wingRate = wingPatch.sound.wingRate + 24 * Math.sin(t * TAU * .73);
    wings.voices[1].control(.2 * Math.sin(t * 17), .12, -.15, -.2, velocity, wingSound, wingMods, 10);
    wings.voices[2].control(.15 * Math.cos(t * 19), .25, .15, .2, velocity, wingSound, wingMods, 20);
    for (const group of [1, 2]) wings.movement(group, velocity * 32 / RATE * 160, movingWings);
  }
  wings.sample(0, movingWings);
  flutter[i] = (wings.left + wings.right) * .5;
}
save('roach-wings', 'roach-synth', 'RoachBodyEngine / Wing radio buzz + CC0 vivarium rustle / three flutter trains', flutter, trains.length);
}

// Use the native L-System branch/event mapping and native synth, not a phrase
// written for a replacement oscillator. The preset's final lowpass is applied
// offline as well; the interactive instrument is never loaded in the Witch.
const { MorphazoidContourSynth } = await import('../src/contour-synth-processor.js');
globalThis.currentTime = 0; globalThis.currentFrame = 0;
const treeSynth = new MorphazoidContourSynth({ processorOptions: { maxVoices: 128 } });
const treePreset = L_SYSTEMS_FULL_PRESETS.find(p => p.id === 'notes-2').snapshot;
const treeState = { ...createLSystemsState(), ...treePreset.shared, mode: treePreset.mode,
  synth: treePreset.synth, drums: treePreset.drums, corners: treePreset.corners };
const treeGrammar = L_SYSTEM_PRESETS.find(p => p.id === treeState.presetId);
const treeTraces = Array.from({ length: treeState.iterations }, (_, i) => lSystemsTrace(treeGrammar, i + 1, treeState));
const treeClock = new LSystemEventClock({ traces: treeTraces, position: 0, direction: treeState.direction,
  rate: treeState.speed, behavior: treeState.traversalBehavior, structureMode: treeState.structureMode,
  subdivisions: treeState.drums.subdivisions, mappingMode: treeState.drums.mappingMode,
  maxPhaseStep: lSystemDrumTraversalStepSize(treeTraces, treeState.drums.subdivisions, treeState.structureMode),
  now: 0, pruningBias: treeState.pruningBias, playingMode: 'notes', readerMode: treeState.readerMode,
  cornerThreshold: treeState.corners.minimumAngle, hitPlacement: treeState.corners.placement });
const omega = TAU * Math.min(RATE * .45, treeState.synth.cutoff) / RATE;
// Web Audio lowpass Q is specified in dB, unlike peaking-filter bandwidth.
const cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * 10 ** (treeState.synth.resonance / 20));
const b0 = (1 - cosine) / (2 * (1 + alpha)), b1 = 2 * b0, a1 = -2 * cosine / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
const z1 = [0, 0], z2 = [0, 0]; let treeEvents = 0;
const treePhrase = render(2.4, (left, right) => {
  treeSynth.process([], [[left, right]]);
  for (let channel = 0; channel < 2; channel++) {
    const data = channel ? right : left;
    for (let i = 0; i < data.length; i++) {
      const input = data[i], output = input * b0 + z1[channel];
      z1[channel] = input * b1 - output * a1 + z2[channel]; z2[channel] = input * b0 - output * a2;
      data[i] = output;
    }
  }
}, t => {
  if (t >= 1.5) return;
  for (const { event, eventCount, startAt } of treeClock.read(t)) {
    if (startAt >= 1.5) continue;
    treeSynth.queueNotes({ voices: [lSystemNoteVoice(event, eventCount, treeState, treePreset.envelope.level)],
      startAt, voiceLimit: 128, envelope: lSystemNoteEnvelope(lSystemNoteDuration(treeState, eventCount), treePreset.envelope)
        .map(point => ({ time: percussionEnvelopeTimeMs(point.x) / 1000, level: point.y })) });
    treeEvents++;
  }
});
save('tree-l-system', 'l-systems', 'L-System Synth / Notes Orchard chimes / native coral traversal + MorphazoidContourSynth FM', treePhrase, treeEvents);

const output = new URL('../src/instruments/witch/witch-bite-clips.js', import.meta.url);
await writeFile(output, `// Generated by scripts/build-witch-bites.mjs; PCM16LE mono at22050Hz.\n// Provenance and licenses: docs/witch-sound-bites.md.\nexport const WITCH_BITE_CLIPS = Object.freeze(${JSON.stringify(clips)});\n`);
// Separate worklet globals/module registrations from the base renderers. This
// follow-up keeps normal reauthoring on the actual MIDI/Acid/native sources.
if (!treeOnly) {
  for (const script of ['build-witch-native-effects.mjs', 'build-witch-character-bites.mjs',
    'build-witch-native-variants.mjs', 'build-witch-character-variants.mjs', 'build-witch-source-variants.mjs']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${script}`, import.meta.url))], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} exited with ${result.status}`);
  }
}
