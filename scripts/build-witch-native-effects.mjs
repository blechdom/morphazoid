// Offline excerpts of the actual BLECH file player, Rubix Acid bank,
// Monstroid pressure network, and Candy Coil processor. Existing bites stay intact.
import { readFile, writeFile } from 'node:fs/promises';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { parseBlackMidiScore } from '../src/instruments/blech-midi/blech-midi-black-score.js';
import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from '../src/instruments/midi-mixer/vendor/spessasynth-core.js';
import { createSolvedRubixCube, turnRubixLayer, createRubixSequenceSnapshot } from '../src/instruments/rubix/rubix.js';
import { createRubixSimdSurfacePatterns, rubixSimdConfigurations } from '../src/instruments/rubix/rubix-simd-surface.js';
import { rubixSimdVoiceParams, rubixSimdPreset } from '../src/instruments/rubix/rubix-simd-presets.js';
import { createColonySyrinxCallState, COLONY_SYRINX_CALLS } from '../src/instruments/monstroid/monstroid.js';

const RATE = 22050, clips = { ...WITCH_BITE_CLIPS }, processors = new Map();
globalThis.sampleRate = RATE; globalThis.currentTime = 0; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage(message) {
  if (message.type === 'error') throw new Error(message.message);
} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
let seed = 0x7a47b3;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

function render(seconds, next, before = () => {}) {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let at = 0; at < data.length; at += 128) {
    const count = Math.min(128, data.length - at);
    globalThis.currentFrame = at; globalThis.currentTime = at / RATE;
    before(at / RATE, at);
    const left = new Float32Array(count), right = new Float32Array(count);
    next(left, right, at);
    for (let i = 0; i < count; i++) data[at + i] = (left[i] + right[i]) * .5;
  }
  return data;
}
function save(id, instrumentId, source, data, events) {
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${id}: nonfinite native output`);
    data[i] *= Math.min(1, i / (RATE * .008), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-7) throw new Error(`${id}: silent native output`);
  const gain = Math.min(.14 / rms, .65 / peak), pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) pcm.writeInt16LE(Math.round(data[i] * gain * 32767), i * 2);
  clips[id] = { instrumentId, source, rate: RATE, frames: data.length, events, pcm: pcm.toString('base64') };
  console.log(`${id}: ${events} source events; ${data.length} frames; RMS ${(rms * gain).toFixed(4)}`);
}

// BLECH includes this original CC0 BLACK MIDI demo in its actual MIDI library.
// Preserve the file's pitches, velocities, gates, channels, GM programs, pan,
// and score timing. No new equation/melody and no thinning of the excerpt.
const midi = await readFile(new URL('../assets/midiphoria/midi/black-lattice.mid', import.meta.url));
const score = parseBlackMidiScore(midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength));
const begin = 32, end = 36.5, events = [];
let attacks = 0;
for (let i = 0; i < score.total; i++) {
  if (score.ends[i] <= begin || score.starts[i] >= end) continue;
  events.push({ frame: Math.round(Math.max(0, score.starts[i] - begin) * RATE), on: true,
    channel: score.channels[i], note: score.pitches[i], velocity: score.velocities[i] });
  events.push({ frame: Math.round(Math.min(4.6, score.ends[i] - begin) * RATE), on: false,
    channel: score.channels[i], note: score.pitches[i] });
  attacks++;
}
events.sort((a, b) => a.frame - b.frame || Number(a.on) - Number(b.on));
SpessaLog.setLogLevel(false, false, false);
const blech = new SpessaSynthProcessor(RATE, { eventsEnabled: false });
await blech.processorInitialized;
const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
blech.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength)), 'witch-black-midi');
blech.setSystemParameter('voiceCap', 128);
for (let channel = 0; channel < 8; channel++) {
  blech.programChange(channel, [0, 1, 4, 12][channel % 4]);
  blech.controllerChange(channel, 10, 26 + channel * 11);
  blech.controllerChange(channel, 7, 76);
  for (const [controller, value] of [[0, 0], [32, 0], [11, 127], [64, 0], [91, 12], [93, 0]]) blech.controllerChange(channel, controller, value);
}
const black = new Float32Array(RATE * 5);
let cursor = 0, at = 0;
while (at < black.length) {
  while (cursor < events.length && events[cursor].frame <= at) {
    const event = events[cursor++];
    if (event.on) blech.noteOn(event.channel, event.note, event.velocity);
    else blech.noteOff(event.channel, event.note);
  }
  const count = Math.min(128, black.length - at, Math.max(1, (events[cursor]?.frame ?? black.length) - at));
  const left = new Float32Array(count), right = new Float32Array(count);
  blech.process(left, right, 0, count);
  for (let i = 0; i < count; i++) black[at + i] = (left[i] + right[i]) * .5;
  at += count;
}
save('drop-blech', 'blech-midi', 'Black Lattice · Ordered Storm / actual black-lattice.mid 32–36.5 s / native SpessaSynth + TimGM6mb', black, attacks);
blech.destroySynthProcessor();

// A real scrambled 3D cube, actual color/placement mapping and native SIMD
// Acid bank. Only the current three visible faces sound, as in Rubix itself.
const { RubixSimd303Processor } = await import('../src/instruments/rubix/rubix-simd-303-processor.js');
let cube = createSolvedRubixCube();
for (const [axis, layer, direction] of [['x', -1, 1], ['y', 0, -1], ['z', 1, 1], ['x', 1, -1]]) cube = turnRubixLayer(cube, { axis, layer, direction });
const snapshot = createRubixSequenceSnapshot(cube), patch = rubixSimdPreset('color-circuit');
const patterns = createRubixSimdSurfacePatterns(snapshot, { presetId: patch.id,
  baseParams: rubixSimdVoiceParams({ simdPreset: patch.id }), amount: patch.controls.stickerModulation, tempo: 252, readingMode: 'snake' });
const acid = new RubixSimd303Processor();
acid.handleMessage({ type: 'install', simdBytes: await readFile(new URL('../assets/wasm/simd-303-simd.wasm', import.meta.url)),
  scalarBytes: await readFile(new URL('../assets/wasm/simd-303-scalar.wasm', import.meta.url)), faces: rubixSimdConfigurations(patterns) });
acid.handleMessage({ type: 'visibility', gains: Object.fromEntries(snapshot.stickerIds.map(id => [id, .65])) });
acid.handleMessage({ type: 'restart', startAt: 0 }); acid.handleMessage({ type: 'playback', enabled: true });
const rubix = render(2.4, (left, right) => acid.process([], [[left, right]]), time => {
  if (time >= 2.18) acid.handleMessage({ type: 'visibility', gains: {} });
});
save('drop-rubix', 'rubix', 'Rubix 3D / native RubixSimd303Processor + Color circuit Acid bank / scrambled visible faces at 252 BPM', rubix.slice(), 111);
acid.handleMessage({ type: 'dispose' });

// The full native multi-mouth pressure model is rendered only during authoring.
await import('../src/instruments/monstroid/monstroid-processor.js');
const recipe = COLONY_SYRINX_CALLS.find(call => call.id === 'air-many-mouth-freak');
const Monstroid = processors.get('colony-syrinx-pressure-network');
const monster = new Monstroid({ processorOptions: { configuration: createColonySyrinxCallState(recipe.id), playing: false } });
monster._handleMessage({ type: 'call', playing: true, durationSeconds: 2.25, callId: recipe.id, articulation: recipe.articulation });
save('drop-monstroid', 'monstroid', 'Monstroid / native ColonySyrinxPressureProcessor / Many-mouth rough call', render(2.4, (left, right) => monster.process([], [[left, right]])), 1);

// Capture actual Candy Coil's long-history/frozen-bog factory processor after
// feeding it the same native Rubix excerpt. The Witch loads only this PCM bite.
const { BARBER_DELAY_PRESETS } = await import('../src/families/barber-delay/barber-delay.js?witch-native-bite');
const Candy = processors.get('morphazoid-barber-delay');
const candy = new Candy({ processorOptions: { mode: 'candy', parameters: BARBER_DELAY_PRESETS.candy.find(preset => preset.id === 'frozen-bog').settings } });
candy.port.onmessage({ data: { type: 'active', value: true } });
const echoes = render(8.4, (left, right, frame) => {
  const input = new Float32Array(left.length);
  for (let i = 0; i < input.length; i++) input[i] = (frame + i) / RATE < 6.2 ? rubix[(frame + i) % rubix.length] : 0;
  candy.process([[input, input]], [[left, right]]);
});
save('drop-candy-coil', 'candy-coil-delay', 'Candy Coil / native MorphazoidBarberDelayProcessor / Frozen Bog 12-head factory preset fed by Rubix Acid', echoes.slice(RATE * 6), 12);

await writeFile(new URL('../src/instruments/witch/witch-bite-clips.js', import.meta.url),
  `// Generated by scripts/build-witch-bites.mjs and scripts/build-witch-native-effects.mjs; PCM16LE mono at22050Hz.\n// Provenance and licenses: docs/witch-sound-bites.md.\nexport const WITCH_BITE_CLIPS = Object.freeze(${JSON.stringify(clips)});\n`);
