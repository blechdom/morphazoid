// Offline alternates for the Witch's character ingredients. Index zero stays
// null: the original taste remains in witch-bite-clips.js, unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { WITCH_CHARACTER_BITE_VARIANTS } from '../src/instruments/witch/witch-bite-character-variants.js';
import { renderObjectSound } from '../src/instruments/puggler/puggler-object-sounds.js';
import { renderCharacterVocal, vocalCharacter } from '../src/instruments/puggler/puggler-vocals.js';
import { copyClip } from '../src/instruments/puggler/puggler-voice-dsp.js';
import { SIMD_CHIPTUNE_DEFAULTS } from '../src/instruments/simd-chiptune/audio.js';
import { createWebGpuChiptunePattern, sanitizeWebGpuChiptuneSequence, packWebGpuChiptuneSequence,
  webGpuChiptuneParamArray } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import { createSimd303Configuration } from '../src/simd-303.js';
import { SIMD_303_EXPANSION_PRESETS } from '../src/simd-303-presets.js';
import { renderWitchSpiderVocal } from './witch-spider-vocals.mjs';

const spiderOnly = process.argv.includes('--spider-only');
const RATE = 22050, SECONDS = 2.4, FRAMES = Math.round(RATE * SECONDS);
const variants = spiderOnly ? { ...WITCH_CHARACTER_BITE_VARIANTS, 'drop-spider': [null] }
  : Object.fromEntries(['drop-puggler', 'drop-chiptune', 'drop-acid-303', 'drop-spider'].map(kind => [kind, [null]]));
const processors = new Map(), signals = new Map();
globalThis.sampleRate = RATE; globalThis.currentTime = 0; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage(message) {
  if (message.type === 'error') throw new Error(message.message);
} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
let seed = 0x3c71d01a;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const resetClock = () => { globalThis.currentTime = 0; globalThis.currentFrame = 0; };

function render(next, before = () => {}) {
  resetClock();
  const data = new Float32Array(FRAMES);
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
function save(kind, instrumentId, label, source, data, events, details = {}) {
  if (data.length !== FRAMES) throw new Error(`${kind}: incorrect render length`);
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${kind}: nonfinite native output`);
    data[i] *= Math.min(1, i / (RATE * .006), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-7) throw new Error(`${kind}: silent native output`);
  let gain = .14 / rms;
  const softPeak = peak * gain > .65;
  if (softPeak) {
    // Fixed offline peak mastering only. Short native spikes must not make an
    // entire acid phrase or wordless cry much quieter than the others.
    const energyAt = drive => {
      let energy = 0;
      for (const value of data) energy += (.65 * Math.tanh(value * drive / .65)) ** 2;
      return Math.sqrt(energy / data.length);
    };
    let low = gain, high = gain;
    for (let pass = 0; pass < 20 && energyAt(high) < .14; pass++) high *= 2;
    if (energyAt(high) < .14) throw new Error(`${kind}: native phrase is too sparse for its target level`);
    for (let pass = 0; pass < 24; pass++) {
      const middle = (low + high) * .5;
      if (energyAt(middle) < .14) low = middle; else high = middle;
    }
    gain = (low + high) * .5;
  }
  const pcm = Buffer.alloc(data.length * 2); let masteredEnergy = 0, masteredPeak = 0;
  for (let i = 0; i < data.length; i++) {
    const value = softPeak ? .65 * Math.tanh(data[i] * gain / .65) : data[i] * gain;
    const sample = Math.round(value * 32767);
    pcm.writeInt16LE(sample, i * 2); data[i] = sample / 32768;
    masteredEnergy += data[i] ** 2; masteredPeak = Math.max(masteredPeak, Math.abs(data[i]));
  }
  if (data[0] !== 0 || data.at(-1) !== 0) throw new Error(`${kind}: nonzero clip edge`);
  const earlier = signals.get(kind);
  if (earlier) {
    let difference = 0;
    for (let i = 0; i < data.length; i++) difference += (data[i] - earlier[i]) ** 2;
    if (Math.sqrt(difference / data.length) < .04) throw new Error(`${kind}: alternatives are too similar`);
  }
  signals.set(kind, data);
  variants[kind].push({ instrumentId, source, rate: RATE, frames: data.length, events, label, ...details, pcm: pcm.toString('base64') });
  console.log(`${kind} / ${label}: ${events} events; RMS ${Math.sqrt(masteredEnergy / data.length).toFixed(4)}; peak ${masteredPeak.toFixed(4)}`);
}
async function wav(id) {
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
      for (let i = 0; i < data.length; i++) for (let ch = 0; ch < channels; ch++) {
        data[i] += bytes.readInt16LE(offset + 8 + (i * channels + ch) * 2) / (32768 * channels);
      }
    }
    offset += 8 + length + (length % 2);
  }
  if (!data?.length) throw new Error(`${id}: empty WAV`);
  return { data, rate };
}

// --spider-only preserves the other authored PCM and metadata byte-for-byte.
if (!spiderOnly) {
// Different native prop voices, drum rhythms and vocal characters distinguish
// these riffs from the base's straight 224 BPM fuzz-guitar eighths.
const drums = Object.fromEntries(await Promise.all(['kick', 'snare', 'hat', 'tom', 'crash', 'oi'].map(async id => [id, await wav(id)])));
function punkRiff({ label, bpm, owner, props, chordSteps, kickSteps, snareSteps, oiSteps, fillAt }) {
  const data = new Float32Array(FRAMES), stepSeconds = 60 / bpm / 4;
  const voices = props.map((propId, i) => {
    const rendered = renderObjectSound('punk', propId, 'air', RATE, drums);
    const cut = rendered.slice(0, Math.round(RATE * (i === 0 ? .09 : .14)));
    for (let at = 0; at < cut.length; at++) cut[at] *= Math.min(1, (cut.length - 1 - at) / (RATE * .008));
    return { data: cut, rate: RATE };
  });
  const bass = { data: renderObjectSound('punk', owner === 1 ? 'bowling' : 'plunger', 'air', RATE, drums), rate: RATE };
  // oi.wav contains three recorded calls. Keep one complete call for each
  // authored response so the riff's own cadence is not hidden by duplicates.
  const rawOi = drums.oi.data.slice(0, Math.round(drums.oi.rate * .45));
  const oi = { data: renderCharacterVocal(rawOi, drums.oi.rate, vocalCharacter('punk', owner)), rate: drums.oi.rate };
  let events = 0;
  const hit = (clip, step, gain, speed = 1) => { copyClip(data, RATE, clip, { at: step * stepSeconds, gain, speed }); events++; };
  for (let step = 0; step < 36 && step * stepSeconds < 2.18; step++) {
    hit(drums.hat, step, step % 4 === 0 ? .23 : .13);
    if (kickSteps.includes(step % 16)) hit(drums.kick, step, .7);
    if (snareSteps.includes(step % 16)) hit(drums.snare, step, .75);
    const chord = chordSteps[step % chordSteps.length];
    if (chord !== null) hit(voices[chord], step, .7);
    if (step % 4 === 0) hit(bass, step, .2, step % 16 === 12 ? 1.12 : 1);
    if (step >= fillAt) hit(drums.tom, step, .25 + (step % 3) * .07, 1 + (step % 4) * .1);
  }
  hit(drums.crash, 0, .17);
  for (const step of oiSteps) hit(oi, step, .95);
  save('drop-puggler', 'puggler', label,
    `Puggler / native ${props.join(', ')} punk prop voices, ${vocalCharacter('punk', owner).name} Oi, CC0 drum kit / ${bpm} BPM authored riff`, data, events,
    { voiceCharacter: vocalCharacter('punk', owner).id });
}
punkRiff({ label: 'Roxy saw sprint', bpm: 248, owner: 1, props: ['axe', 'pickle', 'apple'],
  chordSteps: [0, 0, null, 1, 0, null, 2, 1, 0, 0, 1, null, 2, 1, 0, 2],
  kickSteps: [0, 3, 6, 8, 11, 14], snareSteps: [2, 6, 10, 14], oiSteps: [4, 23], fillAt: 32 });
punkRiff({ label: 'Moss basement gallop', bpm: 232, owner: 2, props: ['pickle', 'club', 'banana'],
  chordSteps: [0, null, 0, 1, null, 0, 2, null, 1, null, 0, 0, 2, null, 1, 2],
  kickSteps: [0, 2, 3, 8, 10, 11], snareSteps: [4, 7, 12, 15], oiSteps: [1, 19], fillAt: 29 });

// Explicit native tracker lanes change the notes, rests, gates and rhythm, not
// merely the playback pitch of the original Source Tracker excerpt.
await import('../src/instruments/simd-chiptune/processor.js');
const chipBytes = { scalarBytes: await readFile(new URL('../assets/wasm/simd-chiptune-scalar.wasm', import.meta.url)),
  simdBytes: await readFile(new URL('../assets/wasm/simd-chiptune-simd.wasm', import.meta.url)) };
const REST = null;
function chipTaste(label, changes, definitions) {
  resetClock();
  const params = { ...SIMD_CHIPTUNE_DEFAULTS, tempo: 3.6, fadeIn: .01, echoTaps: 2,
    echoTime: .1, echoDecay: .13, gain: .6, ...changes };
  const source = createWebGpuChiptunePattern(params), lanes = {};
  for (const [id, lane] of Object.entries(source.lanes)) {
    const [notes, stepBeats = .25, gate = .65] = definitions[id];
    lanes[id] = { ...lane, activeLength: notes.length, stepBeats, gate,
      cells: lane.cells.map((_, i) => ({ state: i < notes.length && notes[i] !== REST ? 'note' : 'rest',
        value: i < notes.length && notes[i] !== REST ? notes[i] : 0, velocity: i % 4 === 0 ? 1 : .78 })) };
  }
  const pattern = sanitizeWebGpuChiptuneSequence({ ...source, lanes }), packed = packWebGpuChiptuneSequence(pattern, 0);
  const Chip = processors.get('morphazoid-simd-chiptune'), chip = new Chip();
  chip.message({ type: 'install', ...chipBytes, configuration: { params: webGpuChiptuneParamArray(params),
    meta: packed.meta, cells: new Uint8Array(packed.cells), time: new Float32Array([0, -1, 0, -1]) } });
  chip.message({ type: 'transport', playing: true, startAt: 0, offset: 0 });
  let released = false, events = 0;
  for (const lane of Object.values(pattern.lanes)) for (let step = 0; step < Math.ceil(2.18 * params.tempo / lane.stepBeats); step++) {
    if (lane.cells[step % lane.activeLength].state === 'note') events++;
  }
  const data = render((left, right) => chip.process([], [[left, right]]), time => {
    if (time >= 2.18 && !released) { released = true; chip.message({ type: 'transport', playing: false }); }
  });
  chip.message({ type: 'dispose' });
  save('drop-chiptune', 'simd-chiptune', label, `SIMD Chiptune / native WASM processor, authored ${label} tracker lanes / ${params.tempo * 60} BPM`, data, events);
}
chipTaste('Crypt pulse chase', { pulseWidth: .18, pwmDepth: .08, pwmRate: 1.3,
  upperOneLevel: 1.1, upperTwoLevel: .34, leadLevel: .55, arpLevel: .8,
  bassPulseLevel: 1.4, bassSineLevel: .5, noiseLevel: .17, drumMix: .65, scaleMask: 1453 }, {
  upperOne: [[0, 3, 7, 6, 0, 3, 10, 7, 0, REST, 6, 3, 7, 6, 3, REST]],
  upperTwo: [[0, REST, 3, REST, -2, REST, 1, REST], .5, .42],
  bass: [[-12, -12, REST, -5, -12, REST, -6, -7], .25, .48],
  lead: [[7, REST, 6, 3, REST, 10, 7, REST], .5, .4],
  arp: [[0, .5, .25, .75, 1, .75, .25, .5], .125, .62],
  kick: [[1, REST, REST, 1, REST, REST, 1, REST]],
  snare: [[REST, REST, 1, REST, REST, REST, 1, REST]],
  hats: [[1, .5, .7, .4, 1, .6, .8, .4], .125, .4],
  shaker: [[REST, 1, REST, REST, 1, REST, REST, 1]],
});
chipTaste('Broken cartridge rush', { tempo: 4, pulseWidth: .74, pwmDepth: .18, pwmRate: 2.3,
  upperOneLevel: .25, upperTwoLevel: 1.1, leadLevel: 1.4, arpLevel: .25,
  bassPulseLevel: .45, bassSineLevel: 1.35, leadRegister: 12, leadTrillRate: 32,
  noiseLevel: .32, drumMix: .48, snareNoiseMix: .75, scaleMask: 661, echoTime: .075 }, {
  upperOne: [[0, REST, 6, REST, 3, 1, REST, -2], .5, .32],
  upperTwo: [[12, 7, 3, 6, REST, 10, 6, 1, 7, REST, 6, 3], .25, .33],
  bass: [[-12, REST, -6, -12, REST, -9, -7, REST], .5, .8],
  lead: [[12, 6, 3, 1, REST, 7, 6, 13, 12, REST, 3, 6, 1, -2, 7, REST], .125, .47],
  arp: [[1, .1, .7, .25, .5, 0, .8, .3], .25, .4],
  kick: [[1, REST, 1, REST, REST, 1, REST, REST]],
  snare: [[REST, 1, REST, REST, 1, REST, REST, 1]],
  hats: [[1, REST, .5, .9, REST, .7, .4, REST], .125, .3],
  shaker: [[1, REST, REST, .4, REST, .8, REST, REST]],
});

await import('../src/simd-303-processor.js');
const acidBytes = { scalarBytes: await readFile(new URL('../assets/wasm/simd-303-scalar.wasm', import.meta.url)),
  simdBytes: await readFile(new URL('../assets/wasm/simd-303-simd.wasm', import.meta.url)) };
for (const [id, timeScale] of [['sixteen-ratchet', 15.4], ['foldstorm', 14.8]]) {
  resetClock();
  const preset = SIMD_303_EXPANSION_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error(`Missing native SIMD303 preset: ${id}`);
  const params = { ...preset.params, timeScale }, Acid = processors.get('morphazoid-simd-303'), acid = new Acid();
  acid.handleMessage({ type: 'install', ...acidBytes, requestedBackend: 'simd',
    configuration: createSimd303Configuration(params, preset.sequence, [], preset.xlParams, preset.stepExpression) });
  const data = render((left, right) => acid.process([], [[left, right]]));
  acid.handleMessage({ type: 'dispose' });
  save('drop-acid-303', 'simd-303', preset.label, `SIMD303 / native WASM processor, ${preset.label} factory voice, sequence and step expression / ${timeScale} steps per second`,
    data, Math.ceil(SECONDS * timeScale), { presetId: id });
}

}

// Alternate native Spider timbres and wordless death-rattle arrangements.
for (const variant of [1, 2]) {
  const spider = await renderWitchSpiderVocal(variant, RATE, SECONDS);
  save('drop-spider', 'spider-synth', spider.label, spider.source, spider.data, spider.events, spider.details);
}

for (const [kind, bank] of Object.entries(variants)) if (bank.length !== 3 || bank[0] !== null) throw new Error(`${kind}: expected original plus two alternates`);
await writeFile(new URL('../src/instruments/witch/witch-bite-character-variants.js', import.meta.url),
  `// Generated by scripts/build-witch-character-variants.mjs; PCM16LE mono at 22050 Hz.\n// Index 0 uses the original bite. Provenance: docs/witch-character-variants.md.\nexport const WITCH_CHARACTER_BITE_VARIANTS = Object.freeze(${JSON.stringify(variants)});\n`);
