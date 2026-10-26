// Offline native character excerpts. A focused run updates only these four
// clips; the other authored PCM bytes remain intact. No source engine runs at
// ingredient-drop time in the Witch.
import { readFile, writeFile } from 'node:fs/promises';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { renderObjectSound, OBJECT_SOUND_PROFILES } from '../src/instruments/puggler/puggler-object-sounds.js';
import { renderCharacterVocal, vocalCharacter } from '../src/instruments/puggler/puggler-vocals.js';
import { copyClip } from '../src/instruments/puggler/puggler-voice-dsp.js';
import { SIMD_CHIPTUNE_DEFAULTS } from '../src/instruments/simd-chiptune/audio.js';
import { createWebGpuChiptunePattern, packWebGpuChiptuneSequence, webGpuChiptuneParamArray } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import { createSimd303Configuration } from '../src/simd-303.js';
import { SIMD_303_EXPANSION_PRESETS } from '../src/simd-303-presets.js';
import { spiderSpeechRequest } from '../src/instruments/spider-synth/spider-synth-speech.js';
import { SpiderSpeechPlayer } from '../src/instruments/spider-synth/spider-synth-speech-player.js';
import { renderNativeText } from '../src/families/speech/native-text.js';

const RATE = 22050, SECONDS = 2.4, clips = { ...WITCH_BITE_CLIPS }, processors = new Map();
globalThis.sampleRate = RATE; globalThis.currentTime = 0; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage(message) {
  if (message.type === 'error') throw new Error(message.message);
} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
let seed = 0x71d01a;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

function render(next, before = () => {}) {
  const data = new Float32Array(Math.round(SECONDS * RATE));
  for (let at = 0; at < data.length; at += 128) {
    const count = Math.min(128, data.length - at);
    globalThis.currentFrame = at; globalThis.currentTime = at / RATE;
    before(at / RATE);
    const left = new Float32Array(count), right = new Float32Array(count);
    next(left, right);
    for (let i = 0; i < count; i++) data[at + i] = (left[i] + right[i]) * .5;
  }
  return data;
}
function save(id, instrumentId, source, data, events, details = {}) {
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${id}: nonfinite native output`);
    data[i] *= Math.min(1, i / (RATE * .006), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-7) throw new Error(`${id}: silent native output`);
  const gain = Math.min(.14 / rms, .65 / peak), pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) pcm.writeInt16LE(Math.round(data[i] * gain * 32767), i * 2);
  clips[id] = { instrumentId, source, rate: RATE, frames: data.length, events, ...details, pcm: pcm.toString('base64') };
  console.log(`${id}: ${events} source events; ${data.length} frames; RMS ${(rms * gain).toFixed(4)}; peak ${(peak * gain).toFixed(4)}`);
}
async function drum(id) {
  const bytes = await readFile(new URL(`../assets/puggler/${id}.wav`, import.meta.url));
  let offset = 12, rate, channels, data;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    if (name === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10); rate = bytes.readUInt32LE(offset + 12);
      if (bytes.readUInt16LE(offset + 8) !== 1 || bytes.readUInt16LE(offset + 22) !== 16) throw new Error(`${id}: expected PCM16`);
    }
    if (name === 'data') {
      if (!rate || !channels) throw new Error(`${id}: missing WAV format`);
      data = new Float32Array(length / (2 * channels));
      for (let i = 0; i < data.length; i++) {
        for (let ch = 0; ch < channels; ch++) data[i] += bytes.readInt16LE(offset + 8 + (i * channels + ch) * 2) / (32768 * channels);
      }
    }
    offset += 8 + length + (length % 2);
  }
  if (!data?.length) throw new Error(`${id}: empty WAV`);
  return { data, rate };
}

// The actual Puggler recordings and string-model fuzz voices: two bars of
// 224 BPM punk sixteenths, choked eighth-note power chords and recorded Oi.
const drums = Object.fromEntries(await Promise.all(['kick', 'snare', 'hat', 'tom', 'oi'].map(async id => [id, await drum(id)])));
drums.oi = { data: renderCharacterVocal(drums.oi.data, drums.oi.rate, vocalCharacter('punk', 0)), rate: drums.oi.rate };
const punk = new Float32Array(Math.round(SECONDS * RATE)), sixteenth = 60 / 224 / 4;
const guitars = Object.values(OBJECT_SOUND_PROFILES.punk).filter(profile => profile.family === 'guitar').slice(0, 3)
  .map(profile => ({ data: renderObjectSound('punk', profile.propId, 'air', RATE, drums).slice(0, Math.round(RATE * .112)), rate: RATE }));
let punkEvents = 0;
const hit = (clip, at, gain, speed = 1) => { copyClip(punk, RATE, clip, { at, gain, speed }); punkEvents++; };
for (let step = 0; step < 32; step++) {
  const at = step * sixteenth;
  hit(drums.hat, at, step % 2 ? .16 : .23);
  if (step % 4 === 0 || step === 11 || step === 27) hit(drums.kick, at, .64);
  if (step % 4 === 2) hit(drums.snare, at, .69);
  if (step % 2 === 0) hit(guitars[[0, 0, 0, 1, 0, 0, 2, 1][step / 2 % 8]], at, .64);
  if (step >= 29) hit(drums.tom, at, .35, 1 + (step - 29) * .14);
}
hit(drums.oi, sixteenth * 4, .86); hit(drums.oi, sixteenth * 20, .8);
save('drop-puggler', 'puggler', 'Puggler / native punk fuzz-guitar riff, CC0 drum kit + rhink Oi / two bars at 224 BPM', punk, punkEvents);

// SIMD Chiptune's real source-tracker pattern, baked with its own pattern
// mapper, runs through its shipped WASM processor at 192 BPM.
await import('../src/instruments/simd-chiptune/processor.js');
const chipParams = { ...SIMD_CHIPTUNE_DEFAULTS, tempo: 3.2, fadeIn: .01, echoTaps: 3,
  echoTime: .13, echoDecay: .19, noiseLevel: .35, drumMix: .74, gain: .65 };
const chipPattern = createWebGpuChiptunePattern(chipParams), packed = packWebGpuChiptuneSequence(chipPattern, 0);
const Chip = processors.get('morphazoid-simd-chiptune'), chip = new Chip();
chip.message({ type: 'install', scalarBytes: await readFile(new URL('../assets/wasm/simd-chiptune-scalar.wasm', import.meta.url)),
  simdBytes: await readFile(new URL('../assets/wasm/simd-chiptune-simd.wasm', import.meta.url)), configuration: {
    params: webGpuChiptuneParamArray(chipParams), meta: packed.meta, cells: new Uint8Array(packed.cells), time: new Float32Array([0, -1, 0, -1]),
  } });
chip.message({ type: 'transport', playing: true, startAt: 0, offset: 0 });
let chipReleased = false, chipEvents = 0;
for (const lane of Object.values(chipPattern.lanes)) {
  for (let step = 0; step < Math.ceil(2.18 * chipParams.tempo / lane.stepBeats); step++) {
    if (lane.cells[step % lane.activeLength].state === 'note') chipEvents++;
  }
}
save('drop-chiptune', 'simd-chiptune', 'SIMD Chiptune / native WASM processor and baked Source Tracker pattern / 192 BPM',
  render((left, right) => chip.process([], [[left, right]]), time => {
    if (time >= 2.18 && !chipReleased) { chipReleased = true; chip.message({ type: 'transport', playing: false }); }
  }), chipEvents);
chip.message({ type: 'dispose' });

// The standalone acid object uses its own Silver Squelch factory sound and
// expression sequence. Rubix retains the separate 252 BPM native Acid cube.
await import('../src/simd-303-processor.js');
const acidPreset = SIMD_303_EXPANSION_PRESETS.find(preset => preset.id === 'silver-squelch');
const acidParams = { ...acidPreset.params, timeScale: 12.8 };
const Acid = processors.get('morphazoid-simd-303'), acid = new Acid();
acid.handleMessage({ type: 'install', scalarBytes: await readFile(new URL('../assets/wasm/simd-303-scalar.wasm', import.meta.url)),
  simdBytes: await readFile(new URL('../assets/wasm/simd-303-simd.wasm', import.meta.url)), requestedBackend: 'simd',
  configuration: createSimd303Configuration(acidParams, acidPreset.sequence, [], acidPreset.xlParams, acidPreset.stepExpression) });
save('drop-acid-303', 'simd-303', 'SIMD303 / native WASM processor, Silver Squelch sequence and expression / 12.8 steps per second',
  render((left, right) => acid.process([], [[left, right]])), Math.ceil(SECONDS * acidParams.timeScale));
acid.handleMessage({ type: 'dispose' });

// Actual local eSpeak NG sentence synthesis using Spider Synth's Silk buzz
// voice. Only the first word is slowed for a long descending protest; the
// accusation keeps its consonants and natural speech timing. No web plucks.
async function spiderWord(text, rate, pitch) {
  const request = spiderSpeechRequest(text, { preset: 'silk-buzz', rate, pitch, range: 24 });
  const result = await renderNativeText(request.engine, request.text, request.values);
  return { data: result.samples, rate: result.sampleRate };
}
const no = await spiderWord('No!', 80, 50), accusation = await spiderWord('Bad witch!', 145, 34);
const speech = new Float32Array(Math.round(SECONDS * RATE));
copyClip(speech, RATE, no, { at: .025, speed: .7, gain: 1 });
copyClip(speech, RATE, accusation, { at: 1.18, gain: 1 });
const speechPlayer = new SpiderSpeechPlayer(RATE); speechPlayer.speak(speech, RATE, 3);
save('drop-spider', 'spider-synth', 'Spider Synth / Silk buzz croak voice, bundled Voicesaurus eSpeak NG + native SpiderSpeechPlayer / Nooooo! Bad witch!',
  render((left, right) => { for (let i = 0; i < left.length; i++) left[i] = right[i] = speechPlayer.sample(); }), 3,
  { text: 'Nooooo! Bad witch!', speechPreset: 'silk-buzz' });

await writeFile(new URL('../src/instruments/witch/witch-bite-clips.js', import.meta.url),
  `// Generated by scripts/build-witch-bites.mjs and its native-effects / character-bites follow-ups; PCM16LE mono at22050Hz.\n// Provenance and licenses: docs/witch-sound-bites.md.\nexport const WITCH_BITE_CLIPS = Object.freeze(${JSON.stringify(clips)});\n`);
