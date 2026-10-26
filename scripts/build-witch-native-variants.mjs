// Offline alternatives from native Morphazoid instruments. This writes only
// the separate variant bank; the established base clips remain untouched.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseMidi, beatsToSeconds } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from '../src/instruments/midi-mixer/vendor/spessasynth-core.js';
import { createSolvedRubixCube, turnRubixLayer, createRubixSequenceSnapshot } from '../src/instruments/rubix/rubix.js';
import { createRubixSimdSurfacePatterns, rubixSimdConfigurations } from '../src/instruments/rubix/rubix-simd-surface.js';
import { rubixSimdVoiceParams, rubixSimdPreset } from '../src/instruments/rubix/rubix-simd-presets.js';
import { createColonySyrinxCallState, COLONY_SYRINX_CALLS } from '../src/instruments/monstroid/monstroid.js';

const RATE = 22050, processors = new Map();
const variants = { 'drop-blech': [], 'drop-rubix': [null], 'drop-monstroid': [null], 'drop-candy-coil': [null] };
globalThis.sampleRate = RATE; globalThis.currentTime = 0; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage(message) {
  if (message.type === 'error') throw new Error(message.message);
} }; } };
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
let seed = 0x377bad;
Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

function resetClock() { globalThis.currentTime = 0; globalThis.currentFrame = 0; }
function render(seconds, next, before = () => {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let at = 0; at < out.length; at += 128) {
    globalThis.currentTime = at / RATE; globalThis.currentFrame = at;
    before(at / RATE);
    const count = Math.min(128, out.length - at), left = new Float32Array(count), right = new Float32Array(count);
    next(left, right, at);
    for (let i = 0; i < count; i++) out[at + i] = (left[i] + right[i]) * .5;
  }
  return out;
}
function add(kind, instrumentId, label, source, samples, events, details = {}) {
  const data = samples.slice();
  let sum = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error(`${kind}/${label}: nonfinite native output`);
    data[i] *= Math.min(1, i / (RATE * .008), (data.length - 1 - i) / (RATE * .12));
    sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
  }
  let rms = Math.sqrt(sum / data.length), softPeakDrive = 0;
  if (rms < 1e-7) throw new Error(`${kind}/${label}: silent native output`);
  // A fixed authoring transfer curve catches narrow native transients before
  // the fixed level trim. This retains timing and silence; it never follows
  // playback volume or lifts decays in the audio worklet.
  if (rms / peak < .14 / .65) {
    const ratioAt = drive => {
      let energy = 0;
      for (const sample of data) energy += Math.tanh(sample / peak * drive) ** 2;
      return Math.sqrt(energy / data.length) / Math.tanh(drive);
    };
    let lower = 0, upper = 64;
    if (ratioAt(upper) < .14 / .65) throw new Error(`${kind}/${label}: excessive crest factor`);
    for (let iteration = 0; iteration < 24; iteration++) {
      const drive = (lower + upper) / 2;
      if (ratioAt(drive) < .14 / .65) lower = drive; else upper = drive;
    }
    softPeakDrive = upper;
    const oldPeak = peak; sum = 0; peak = 0;
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.tanh(data[i] / oldPeak * softPeakDrive);
      sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
    }
    rms = Math.sqrt(sum / data.length);
  }
  const gain = Math.min(.14 / rms, .65 / peak), pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) { data[i] *= gain; pcm.writeInt16LE(Math.round(data[i] * 32767), i * 2); }
  variants[kind].push({ instrumentId, label, source, rate: RATE, frames: data.length, events,
    authoringSoftPeakDrive: Number(softPeakDrive.toFixed(6)), ...details, pcm: pcm.toString('base64') });
  console.log(`${kind}/${label}: ${events} events; ${data.length} frames; RMS ${(rms * gain).toFixed(4)}; peak ${(peak * gain).toFixed(4)}; soft-peak drive ${softPeakDrive.toFixed(3)}`);
  return data;
}

// Actual creator-supplied AUDIO MIDI files already in BLECH's library. Each
// passage contains its densest documented second, retaining thousands of
// original attacks, rather than a newly thinned or transposed score.
const blechPassages = [
  { id: 'black-bleed-lightstorm', begin: 126, end: 130.5, label: 'Lightstorm · storm peak' },
  { id: 'black-bleed-seven-red-suns', begin: 39.25, end: 43.75, label: 'Seven Red Suns · red eruption' },
  { id: 'black-bleed-a-soul-of-steel', begin: 208, end: 212.5, label: 'A Soul Of Steel · steel barrage' },
];
const collection = JSON.parse(await readFile(new URL('../assets/midiphoria/collection.json', import.meta.url), 'utf8'));
const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
SpessaLog.setLogLevel(false, false, false);
for (const passage of blechPassages) {
  const entry = collection.find(song => song.id === passage.id);
  if (!entry || entry.licenseId !== 'CC0-1.0') throw new Error(`Missing bundled CC0 BLECH source: ${passage.id}`);
  const bytes = await readFile(new URL(`../assets/midiphoria/${entry.file}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${passage.id}: source hash mismatch`);
  const midi = parseMidi(bytes);
  if (midi.warnings.length) throw new Error(`${passage.id}: ${midi.warnings.join('; ')}`);
  const events = midi.events.map(event => ({ ...event, seconds: beatsToSeconds(event.beat, midi.tempoMap) }));
  const warmStart = passage.begin - 1, attackEnd = 5.5, stopAt = Math.round(attackEnd * RATE);
  const synth = new SpessaSynthProcessor(RATE, { eventsEnabled: false });
  await synth.processorInitialized;
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(font.buffer.slice(font.byteOffset, font.byteOffset + font.length)), 'witch-black-midi-variants');
  // This is the actual BLECH/Midiphoria file player's voice policy. Every
  // source attack is sent; dense voice stealing remains the native behavior.
  synth.setSystemParameter('voiceCap', 128);
  const send = event => synth.processMessage([event.kind * 16 + event.channel % 16, event.a, event.b], event.channel - event.channel % 16);
  for (const event of events) {
    if (event.seconds >= warmStart) break;
    if (event.kind >= 10) send(event);
  }
  // Restore held source notes at the beginning of the one-second preroll;
  // the exported window begins after this warm-up, preserving release tails.
  for (const note of midi.notes) {
    const start = beatsToSeconds(note.beat, midi.tempoMap), end = beatsToSeconds(note.beat + note.duration, midi.tempoMap);
    if (start < warmStart && end > warmStart) send({ kind: 9, channel: note.channel, a: note.note, b: note.velocity });
  }
  const selected = events.filter(event => event.seconds >= warmStart && event.seconds < passage.end)
    .map(event => ({ ...event, frame: Math.round((event.seconds - warmStart) * RATE) }));
  const attacks = selected.filter(event => event.kind === 9 && event.seconds >= passage.begin).length;
  const pcm = new Float32Array(RATE * 6);
  let cursor = 0, at = 0, stopped = false;
  while (at < pcm.length) {
    while (cursor < selected.length && selected[cursor].frame <= at) send(selected[cursor++]);
    if (at >= stopAt && !stopped) { synth.stopAllChannels(false); stopped = true; }
    const next = Math.min(selected[cursor]?.frame ?? pcm.length, stopped ? pcm.length : stopAt);
    const count = Math.min(128, pcm.length - at, Math.max(1, next - at));
    const left = new Float32Array(count), right = new Float32Array(count);
    synth.process(left, right, 0, count);
    for (let i = 0; i < count; i++) pcm[at + i] = (left[i] + right[i]) * .5;
    at += count;
  }
  add('drop-blech', 'blech-midi', passage.label,
    `${entry.title} by BLEEDING EDGE MONOTONE / bundled creator AUDIO MIDI ${passage.begin}–${passage.end} s / native SpessaSynth + TimGM6mb`,
    pcm.slice(RATE), attacks, { midiFile: `assets/midiphoria/${entry.file}`, sourceStart: passage.begin, sourceEnd: passage.end,
      sourceSha256: entry.sha256, voiceCap: 128, artist: entry.artist, license: entry.licenseId });
  synth.destroySynthProcessor();
}

const { RubixSimd303Processor } = await import('../src/instruments/rubix/rubix-simd-303-processor.js');
const simdBytes = await readFile(new URL('../assets/wasm/simd-303-simd.wasm', import.meta.url));
const scalarBytes = await readFile(new URL('../assets/wasm/simd-303-scalar.wasm', import.meta.url));
const rubixRecipes = [
  { presetId: 'silver-facets', tempo: 288, readingMode: 'snake', turns: [['z', -1, -1], ['x', 1, 1], ['y', -1, -1], ['z', 0, 1], ['x', 0, -1]] },
  { presetId: 'pulse-prism', tempo: 240, readingMode: 'face', turns: [['y', 1, 1], ['z', 1, 1], ['x', -1, 1], ['y', 0, -1], ['z', -1, 1], ['x', 1, -1]] },
];
const acidInputs = [];
for (const recipe of rubixRecipes) {
  resetClock();
  let cube = createSolvedRubixCube();
  for (const [axis, layer, direction] of recipe.turns) cube = turnRubixLayer(cube, { axis, layer, direction });
  const snapshot = createRubixSequenceSnapshot(cube), patch = rubixSimdPreset(recipe.presetId), visible = new Set(snapshot.stickerIds);
  const patterns = createRubixSimdSurfacePatterns(snapshot, { presetId: patch.id, readingMode: recipe.readingMode, tempo: recipe.tempo,
    baseParams: rubixSimdVoiceParams({ simdPreset: patch.id }), amount: patch.controls.stickerModulation });
  const faces = rubixSimdConfigurations(patterns), acid = new RubixSimd303Processor();
  let events = 0;
  acid.port.postMessage = message => {
    if (message.type === 'error') throw new Error(message.message);
    if (message.type === 'step' && message.time < 2.18) for (const face of faces) {
      if (visible.has(face.stepStickerIds[message.step])) events++;
    }
  };
  acid.handleMessage({ type: 'install', simdBytes, scalarBytes, faces });
  acid.handleMessage({ type: 'visibility', gains: Object.fromEntries(snapshot.stickerIds.map(id => [id, .65])) });
  acid.handleMessage({ type: 'restart', startAt: 0 }); acid.handleMessage({ type: 'playback', enabled: true });
  let released = false;
  const data = render(2.4, (left, right) => acid.process([], [[left, right]]), time => {
    if (time >= 2.18 && !released) { acid.handleMessage({ type: 'visibility', gains: {} }); released = true; }
  });
  acidInputs.push(add('drop-rubix', 'rubix', `${patch.label} · ${recipe.tempo} BPM`,
    `Rubix native RubixSimd303Processor / ${patch.label} Acid preset / scrambled ${recipe.readingMode} sequence at ${recipe.tempo} BPM`,
    data, events, { presetId: patch.id, tempo: recipe.tempo, readingMode: recipe.readingMode }));
  acid.handleMessage({ type: 'dispose' });
}

await import('../src/instruments/monstroid/monstroid-processor.js');
const Monstroid = processors.get('colony-syrinx-pressure-network');
for (const id of ['water-full-pressure-freak', 'pellets-swarm-freak']) {
  resetClock();
  const recipe = COLONY_SYRINX_CALLS.find(call => call.id === id);
  const monster = new Monstroid({ processorOptions: { configuration: createColonySyrinxCallState(recipe.id), playing: false } });
  monster._handleMessage({ type: 'call', playing: true, durationSeconds: 2.25, callId: recipe.id, articulation: recipe.articulation });
  add('drop-monstroid', 'monstroid', recipe.label,
    `Monstroid native ColonySyrinxPressureProcessor / ${recipe.label} / ${recipe.mediumId} pressure network and authored articulation`,
    render(2.4, (left, right) => monster.process([], [[left, right]])), 1, { presetId: id });
}

const { BARBER_DELAY_PRESETS } = await import('../src/families/barber-delay/barber-delay.js');
const Candy = processors.get('morphazoid-barber-delay');
for (const [index, id] of ['slow-coil', 'thick-tar'].entries()) {
  resetClock();
  const preset = BARBER_DELAY_PRESETS.candy.find(patch => patch.id === id);
  const candy = new Candy({ processorOptions: { mode: 'candy', parameters: preset.settings } });
  candy.port.onmessage({ data: { type: 'active', value: true } });
  const source = acidInputs[index];
  const data = render(14.4, (left, right, frame) => {
    const input = new Float32Array(left.length);
    for (let i = 0; i < input.length; i++) input[i] = frame + i < RATE * 13 ? source[(frame + i) % source.length] : 0;
    candy.process([[input, input]], [[left, right]]);
  });
  add('drop-candy-coil', 'candy-coil-delay', preset.label,
    `Candy Coil native MorphazoidBarberDelayProcessor / ${preset.label} factory preset / 12-second history fed by ${rubixRecipes[index].presetId} native Rubix Acid`,
    data.slice(RATE * 12), preset.settings.numVoices, { presetId: id, inputPresetId: rubixRecipes[index].presetId });
}

await writeFile(new URL('../src/instruments/witch/witch-bite-native-variants.js', import.meta.url),
  `// Generated by scripts/build-witch-native-variants.mjs; PCM16LE mono at 22050 Hz.\n// Sources and licenses: docs/witch-native-variants.md. Null retains the base clip.\nexport const WITCH_NATIVE_BITE_VARIANTS = Object.freeze(${JSON.stringify(variants)});\n`);
