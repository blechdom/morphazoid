import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMethod, getPreset, normalizedParameter } from '../src/instruments/synthesis/catalog.js';
import { analyzeAudioSamples } from './lib/audio-analysis.mjs';

// Original compositions, rendered by the existing Synthesaurus Rust/WASM core.
// JS schedules notes, pans/mixes them and writes PCM; it does not synthesize voices.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || resolve(root, 'assets/synthesis/extra-loops'));
const rate = 44100;
const wasm = readFileSync(resolve(root, 'assets/wasm/synthesis.wasm'));
const api = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const env = (attack, decay, sustain, release) => ({ attack, decay, sustain, release });
const voice = (method, preset, envelope, controls = {}, extra = {}) => ({ method, preset, envelope, controls, ...extra });
const voices = {
  chamber: voice('karplus-strong', 'bright-bridge-pluck', env(.006, .24, 0, .13), { decay: .5, damping: 28 }),
  chamberBass: voice('additive', 'odd-clarinet', env(.018, .2, .35, .12), { 'spectral-tilt': -7 }),
  guitar: voice('karplus-strong', 'palm-muted-string', env(.002, .15, 0, .1), { decay: .27, damping: 27, 'excitation-color': 77 }),
  country: voice('karplus-strong', 'bright-bridge-pluck', env(.009, .65, 0, .22), { decay: 1.2, damping: 32, 'pick-position': 18, 'excitation-mix': .35 }),
  bass: voice('subtractive', 'muted-saw-bass', env(.004, .15, .32, .08), { cutoff: 640, resonance: 12 }),
  popBass: voice('phase-distortion', 'low-elastic-bass', env(.004, .18, .25, .07)),
  popChord: voice('multiple-wavetable', 'center-blend', env(.008, .17, .36, .11), { detune: 9 }),
  popLead: voice('fm', 'brass-swell', env(.018, .2, .4, .16), { index: 1.7, feedback: 4 }),
  glass: voice('fm', 'inharmonic-bell', env(.002, .78, 0, .5), { 'frequency-ratio': 3.414, index: 1.8, feedback: 0 }),
  chime: voice('modal', 'edge-bright-chime', env(.001, .85, 0, .32), { 'modal-decay': .85, brightness: 69 }),
  tine: voice('fm', 'electric-tine', env(.004, .65, .04, .24), { index: 1.1 }),
  reed: voice('fm', 'feedback-reed', env(.025, .19, .43, .1), { index: .8, feedback: 8 }),
  organ: voice('additive', 'high-organ-stops', env(.004, .075, .25, .05), { 'spectral-tilt': -8 }),
  disco: voice('wavetable', 'bright-saw', env(.003, .11, .2, .08), { brightness: 56 }),
  pulse: voice('wavetable', 'narrow-pulse', env(.002, .04, .46, .04), { brightness: 58, 'pulse-width': 23, 'table-resolution': 128 }),
  triangle: voice('wavetable', 'soft-triangle', env(.002, .06, .45, .035)),
  choir: voice('formant-voice', 'singing-vowel', env(.7, .9, .5, 1.1), { aspiration: .07, 'vibrato-depth': 17, 'vibrato-rate': 4.2 }),
  cloud: voice('multiple-wavetable', 'slow-vector-cloud', env(.8, .7, .5, 1.3), { detune: 5 }),
  acid: voice('subtractive', 'hollow-pulse', env(.003, .12, .22, .055), { cutoff: 440, resonance: 57, 'envelope-depth': 3.1, 'filter-drive': 2.1 }),
  nylon: voice('karplus-strong', 'hollow-center-pluck', env(.003, .45, 0, .2), { damping: 62, decay: .65 }),
  flute: voice('additive', 'single-sine', env(.055, .15, .42, .16), { 'partial-2': 12, 'partial-3': 5 }),
  kick: voice('subtractive', 'soft-sine-body', env(.001, .11, 0, .03), { cutoff: 330, resonance: 0 }, { glide: { startHz: 145, endHz: 47, seconds: .075 } }),
  snare: voice('subtractive', 'breathing-noise', env(.001, .085, 0, .025), { cutoff: 2300, noise: 100, resonance: 10, 'filter-mode': 1 }),
  hat: voice('subtractive', 'bright-hat', env(.001, .025, 0, .015), { cutoff: 7200, noise: 100, resonance: 0, 'filter-mode': 2 }),
  rim: voice('modal', 'dry-wooden-block', env(.001, .035, 0, .025), { 'modal-decay': .055, brightness: 51 }),
};

// Event tuple: beat, MIDI note, gate in beats, velocity, stereo pan (-1..1).
const event = (beat, midi, gate = .25, velocity = .7, pan = 0) => [beat, midi, gate, velocity, pan];
const track = (name, events, level = 1) => ({ voice: name, level, events });
const chords = (notes, starts, gate, velocity = .6, strum = 0) => starts.flatMap(start => notes.map((note, i) => event(start + i * strum, note, gate, velocity, (i - (notes.length - 1) / 2) * .16)));
function drums(beats, style = 'straight') {
  const kick = [], snare = [], hat = [];
  for (let b = 0; b < beats; b++) {
    if (style === 'disco' || b % 4 === 0 || b % 4 === 2) kick.push(event(b, 36, .2, b % 4 ? .72 : .9));
    if (b % 2 === 1) snare.push(event(b, 62, .18, b % 4 === 3 ? .75 : .64, .08));
    hat.push(event(b, 92, .08, .39, -.25));
    hat.push(event(b + (style === 'shuffle' ? 2 / 3 : .5), 92, .07, .27, -.25));
  }
  return [track('kick', kick, .8), track('snare', snare, .34), track('hat', hat, .18)];
}

const loops = [
  {
    id: 'clockwork-chamber', label: 'Classical clockwork', bpm: 108, beats: 8,
    description: 'Original chamber-style counterpoint: bright plucked sixteenths against a rounded low clarinet-like line.',
    tracks: [
      track('chamber', [72,76,79,76,74,77,81,77,71,74,79,74,72,76,79,83,77,81,84,81,76,79,83,79,74,77,81,77,71,74,79,71].map((n, i) => event(i * .25, n, .19, i % 4 ? .57 : .81, i % 2 ? .22 : -.22)), 1.7),
      track('chamberBass', [48,50,43,48,41,45,43,43].map((n, i) => event(i, n, .62, .62, -.07)), .16),
    ],
  },
  {
    id: 'rockabilly-drive', label: 'Rock & roll shuffle', bpm: 148, beats: 16,
    description: 'Original shuffled power-chord picking, walking bass and synthesized backbeat.',
    tracks: [
      track('guitar', [48,48,53,53].flatMap((root, bar) => [0,2 / 3,1,5 / 3,2,8 / 3,3,11 / 3].flatMap((beat, j) => [root,root + (j % 4 > 1 ? 9 : 7)].map((n, k) => event(bar * 4 + beat + k * .015, n, .3, j % 2 ? .58 : .83, k ? .28 : -.28)))), 1.35),
      track('bass', [36,40,43,45,36,43,46,43,41,45,48,50,41,48,46,43].map((n, i) => event(i, n, .63, .78)), .8),
      ...drums(16, 'shuffle'),
    ],
  },
  {
    id: 'country-front-porch', label: 'Country porch picking', bpm: 116, beats: 8,
    description: 'Original alternating low strings, twangy upper picking and soft wooden taps.',
    tracks: [
      track('country', [55,62,67,71,62,67,74,71,60,67,72,76,67,72,79,76].map((n, i) => event(i * .5 + (i % 2 ? .02 : 0), n, .35, i % 4 ? .58 : .85, i % 2 ? .25 : -.25)), 1.15),
      track('nylon', [43,50,43,50,48,55,48,55].map((n, i) => event(i, n, .55, .78)), .72),
      track('rim', [1,3,5,7].map(b => event(b, 76, .08, .45, .16)), .18),
    ],
  },
  {
    id: 'neon-synth-pop', label: '80s synth-pop homage', bpm: 114, beats: 16,
    description: 'Original 1980s-inspired synth-pop arrangement. No Rick Astley recording, borrowed song melody or voice imitation.',
    tracks: [
      track('popChord', [[54,58,61],[57,61,64],[52,56,59],[59,63,66]].flatMap((notes, bar) => chords(notes, [bar * 4 + .5,bar * 4 + 1.5,bar * 4 + 3], .43, .55, .012)), .55),
      track('popBass', [30,30,42,37,33,33,45,40,28,28,40,35,35,35,47,42].flatMap((n, i) => [event(i, n, .34, .8),event(i + .75, n, .16, .52)]), .8),
      track('popLead', [66,73,70,68,76,73,69,68,64,71,68,66,73,78,75,71].map((n, i) => event(i + (i % 4 === 2 ? .25 : 0), n, .48, .62, .1)), .55),
      ...drums(16),
    ],
  },
  {
    id: 'unicorn-sparkles', label: 'Sparkle unicorn', bpm: 96, beats: 8,
    description: 'Original fantasy effect: rising glass glints, scattered high chimes and a slow luminous undercurrent.',
    tracks: [
      track('glass', [72,76,81,86,88,93,98,100,83,88,91,95,100].map((n, i) => event(i < 8 ? .24 * i : 3.7 + (i - 8) * .33, n, .08, .5 + (i % 3) * .1, Math.sin(i * 2.1) * .65)), .72),
      track('chime', [0,2.4,4.1,6.2].map((b, i) => event(b, [81,88,86,93][i], .1, .6, i % 2 ? -.35 : .35)), .37),
      track('cloud', chords([60,64,69], [0,4], 2.5, .33), .22),
    ],
  },
  {
    id: 'jazz-night-walk', label: 'Midnight jazz', bpm: 92, beats: 8,
    description: 'Original swung FM keys, compact reed-like answers and a walking low line.',
    tracks: [
      track('tine', [...chords([53,57,60,64], [0,1 + 2 / 3,3], .45), ...chords([55,59,62,65], [4,5 + 2 / 3,7], .45)], .72),
      track('bass', [41,45,48,49,43,47,50,40].map((n, i) => event(i, n, .68, .67)), .73),
      track('reed', [event(.65,72,.34,.6,.17),event(1.65,69,.3,.5,.17),event(2.65,67,.54,.65,.17),event(4.65,74,.36,.55,.17),event(6,71,.3,.58,.17),event(6.65,65,.58,.67,.17)], .25),
      track('hat', Array.from({ length: 8 }, (_, i) => event(i + 2 / 3, 92, .05, .24, -.28)), .12),
    ],
  },
  {
    id: 'dub-skank', label: 'Dub skank', bpm: 76, beats: 8,
    description: 'Original sparse offbeat organ, deep syncopated bass and dry rim accents; intentionally leaves space for delay.',
    tracks: [
      track('organ', [...chords([60,63,67], [.5,1.5,2.5,3.5], .16, .59), ...chords([58,62,65], [4.5,5.5,6.5,7.5], .16, .59)], .55),
      track('bass', [event(0,36,.8,.83),event(1.75,43,.45,.68),event(2.5,36,.6,.75),event(3.25,39,.4,.65),event(4,34,.85,.85),event(5.75,41,.45,.68),event(6.5,34,.6,.76),event(7.25,38,.4,.67)], 1),
      track('rim', [2,6].map(b => event(b, 69, .08, .65, .18)), .28),
      track('hat', Array.from({ length: 8 }, (_, i) => event(i + .5, 92, .06, .34, -.2)), .14),
    ],
  },
  {
    id: 'disco-strut', label: 'Disco strut', bpm: 124, beats: 8,
    description: 'Original octave bass, short bright chord chops and a synthesized four-on-the-floor beat.',
    tracks: [
      track('disco', [...chords([65,69,72,76], [.5,1.5,2.5,3.5], .13, .48), ...chords([62,65,69,72], [4.5,5.5,6.5,7.5], .13, .48)], .43),
      track('bass', [41,53,48,53,41,53,48,53,38,50,45,50,38,50,45,50].map((n, i) => event(i * .5, n, .29, i % 2 ? .56 : .78)), .9),
      track('popLead', [event(1.75,81,.16,.53,.2),event(3.25,79,.16,.48,.2),event(5.75,77,.16,.52,.2),event(7.25,76,.2,.54,.2)], .3),
      ...drums(8, 'disco'),
    ],
  },
  {
    id: 'chiptune-quest', label: 'Chiptune quest', bpm: 156, beats: 16,
    description: 'Original pulse-wave adventure motif, fast broken chords and a triangle-like bass.',
    tracks: [
      track('pulse', [72,79,76,74,72,76,81,79,77,84,81,79,77,81,86,84,74,81,77,76,74,77,83,81,71,78,74,72,71,74,79,83].map((n, i) => event(i * .5, n, .34, i % 4 ? .52 : .75, -.12)), .65),
      track('pulse', Array.from({ length: 64 }, (_, i) => event(i * .25, [[60,64,67,72],[65,69,72,77],[62,65,69,74],[59,62,67,71]][Math.floor(i / 16)][i % 4], .13, .31, .28)), .3),
      track('triangle', [36,43,36,43,41,48,41,48,38,45,38,45,43,50,43,50].map((n, i) => event(i, n, .7, .7)), .8),
    ],
  },
  {
    id: 'cloud-choir', label: 'Ambient choir', bpm: 64, beats: 8,
    description: 'Original slow synthesized vowel chords and drifting soft waves; no human vocal recording.',
    tracks: [
      track('choir', [...chords([48,55,62,67], [0], 3.1, .46, .12), ...chords([46,53,60,65], [4], 3.1, .46, .12)], .65),
      track('cloud', [...chords([60,67,74], [0], 2.8, .29, .15), ...chords([58,65,72], [4], 2.8, .29, .15)], .4),
    ],
  },
  {
    id: 'acid-circuit', label: 'Acid circuit', bpm: 132, beats: 8,
    description: 'Original resonant bass sequence with alternate accents, tight kick and tick-like hats.',
    tracks: [
      track('acid', [36,36,48,39,43,36,46,43,34,46,41,38,34,41,45,43].map((n, i) => event(i * .5, n, i % 4 === 2 ? .44 : .24, i % 4 === 0 ? .93 : .57)), .9),
      track('kick', Array.from({ length: 8 }, (_, i) => event(i, 36, .18, .8)), .6),
      track('hat', Array.from({ length: 16 }, (_, i) => event(i * .5, 92, .055, i % 2 ? .35 : .21, -.18)), .15),
      track('rim', [1,3,5,7].map(b => event(b, 79, .05, .5, .18)), .16),
    ],
  },
  {
    id: 'bossa-sunrise', label: 'Bossa sunrise', bpm: 112, beats: 8,
    description: 'Original syncopated mellow plucks, low alternating roots, flute-like answers and soft rim taps.',
    tracks: [
      track('nylon', [...chords([52,55,59,62], [0,1.5,3], .6, .7, .025), ...chords([50,54,57,60], [4,5.5,7], .6, .7, .025)], .9),
      track('bass', [event(0,40,.75,.72),event(2,47,.6,.57),event(3.5,40,.3,.56),event(4,38,.75,.72),event(6,45,.6,.58),event(7.5,38,.3,.57)], .72),
      track('flute', [event(.75,79,.45,.55,.3),event(1.5,78,.35,.5,.3),event(2.25,74,.7,.58,.3),event(4.75,76,.45,.55,.3),event(5.5,74,.35,.5,.3),event(6.25,69,.8,.58,.3)], .45),
      track('rim', [0,1.5,2.5,4,5.5,6.5].map(b => event(b, 78, .065, .44, -.22)), .14),
    ],
  },
];

function resolvedVoice(name) {
  const recipe = voices[name];
  if (!recipe) throw new Error(`Unknown voice ${name}`);
  const method = getMethod(recipe.method), preset = getPreset(recipe.method, recipe.preset);
  if (method.id !== recipe.method || preset.id !== recipe.preset) throw new Error(`Missing sound ${name}`);
  const params = [...preset.params];
  for (const [id, physical] of Object.entries(recipe.controls)) {
    const index = method.controls.findIndex(control => control.id === id);
    if (index < 0) throw new Error(`Unknown control ${name}:${id}`);
    params[index] = normalizedParameter(method.controls[index], physical);
  }
  return { ...recipe, engineId: method.engineId, params };
}
const resolvedVoices = Object.fromEntries(Object.keys(voices).map(name => [name, resolvedVoice(name)]));

function renderNote(recipe, note, beatSeconds) {
  const [, midi, gate, velocity] = note;
  const gateFrame = Math.max(1, Math.round(gate * beatSeconds * rate));
  const frames = gateFrame + Math.ceil((recipe.envelope.release + .18) * rate);
  const samples = new Float32Array(frames), engine = api.synth_new(rate);
  if (!engine) throw new Error('Could not allocate synthesis engine');
  try {
    api.synth_set_method(engine, recipe.engineId);
    new Float32Array(api.memory.buffer, api.synth_params_ptr(engine), 16).set(recipe.params);
    api.synth_apply_params(engine);
    api.synth_set_frequency(engine, recipe.glide?.startHz ?? hz(midi));
    api.synth_set_envelope(engine, ...['attack','decay','sustain','release'].map(key => recipe.envelope[key]));
    api.synth_set_level_trim_db(engine, 0);
    api.synth_reset(engine);
    api.synth_note_on(engine, recipe.glide?.startHz ?? hz(midi), velocity);
    for (let offset = 0; offset < frames;) {
      if (offset === gateFrame) api.synth_note_off(engine);
      if (recipe.glide) {
        const progress = Math.min(1, offset / (recipe.glide.seconds * rate));
        api.synth_set_frequency(engine, recipe.glide.startHz * (recipe.glide.endHz / recipe.glide.startHz) ** progress);
      }
      const count = Math.min(128, frames - offset, offset < gateFrame ? gateFrame - offset : frames - offset);
      if (api.synth_process(engine, count) !== count) throw new Error('Incomplete note render');
      samples.set(new Float32Array(api.memory.buffer, api.synth_output_ptr(engine), count), offset);
      offset += count;
    }
    const fade = Math.min(frames, Math.round(rate * .008));
    for (let i = 0; i < fade; i++) samples[frames - fade + i] *= (fade - 1 - i) / fade;
    return samples;
  } finally { api.synth_free(engine); }
}

function renderLoop(loop) {
  const beatSeconds = 60 / loop.bpm;
  const frames = Math.round(loop.beats * beatSeconds * rate);
  const channels = [new Float64Array(frames), new Float64Array(frames)];
  for (const part of loop.tracks) for (const note of part.events) {
    if (!note.every(Number.isFinite) || note[0] < 0 || note[0] >= loop.beats || note[2] <= 0 || note[4] < -1 || note[4] > 1) throw new Error(`Invalid event in ${loop.id}`);
    const samples = renderNote(resolvedVoices[part.voice], note, beatSeconds);
    const start = Math.round(note[0] * beatSeconds * rate);
    const gains = [Math.sqrt((1 - note[4]) / 2) * part.level, Math.sqrt((1 + note[4]) / 2) * part.level];
    for (let c = 0; c < 2; c++) for (let i = 0; i < samples.length; i++) channels[c][(start + i) % frames] += samples[i] * gains[c];
  }
  let peak = 0, energy = 0;
  for (const channel of channels) {
    const mean = channel.reduce((sum, value) => sum + value, 0) / frames;
    for (let i = 0; i < frames; i++) {
      channel[i] -= mean;
      if (!Number.isFinite(channel[i])) throw new Error(`Non-finite sample in ${loop.id}`);
      peak = Math.max(peak, Math.abs(channel[i]));
      energy += channel[i] ** 2;
    }
  }
  const rms = Math.sqrt(energy / (frames * 2));
  if (rms < 1e-5) throw new Error(`Silent loop ${loop.id}`);
  const gain = Math.min(.15 / rms, .78 / peak);
  for (const channel of channels) for (let i = 0; i < frames; i++) channel[i] *= gain;
  const mono = Float32Array.from(channels[0], (value, i) => (value + channels[1][i]) * .5);
  const analysis = analyzeAudioSamples(mono, rate, { maxSpectrumFrames: 48, maxPeriodicityFrames: 12 });
  const boundaryDelta = channels.map(channel => Math.abs(channel[0] - channel[frames - 1]));
  const maximumStep = channels.map(channel => {
    let maximum = 0;
    for (let i = 1; i < frames; i++) maximum = Math.max(maximum, Math.abs(channel[i] - channel[i - 1]));
    return maximum;
  });
  return { channels, frames, rmsDb: 20 * Math.log10(rms * gain), peakDb: 20 * Math.log10(peak * gain), boundaryDelta, maximumStep, analysis };
}

function wav(channels, frames) {
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) bytes.writeInt16LE(Math.round(channels[c][i] * 32767), 44 + i * 4 + c * 2);
  return bytes;
}

mkdirSync(output, { recursive: true });
const report = { engine: 'Synthesaurus Rust/WASM', wasmSha256: hash(wasm), scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))), sampleRate: rate, channels: 2, pcmBits: 16, license: 'MIT', provenance: 'Original compositions and synthesized effects; no external recordings, borrowed song excerpts or human vocals.', acceptance: 'Automated characterization only; human listening and physical-device acceptance unperformed.', voices: resolvedVoices, loops: [] };
for (const loop of loops) {
  const result = renderLoop(loop), bytes = wav(result.channels, result.frames);
  writeFileSync(resolve(output, `${loop.id}.wav`), bytes);
  report.loops.push({ ...loop, publicId: `music-${loop.id}`, seconds: result.frames / rate, frames: result.frames, rmsDb: result.rmsDb, peakDb: result.peakDb, boundaryDelta: result.boundaryDelta, maximumStep: result.maximumStep, analysis: result.analysis, sha256: hash(bytes) });
  console.log(`${loop.label}: ${(result.frames / rate).toFixed(3)}s, RMS ${result.rmsDb.toFixed(1)} dBFS, peak ${result.peakDb.toFixed(1)} dBFS`);
}
writeFileSync(resolve(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');

const credits = `# Original synthesized demo loops\n\nThese twelve original compositions and fantasy effects were created for Morphazoid in 2026 and are provided under the repository's MIT license. Every voice is rendered by the existing Synthesaurus Rust/WASM engine. There are no external recordings, borrowed song excerpts or human vocal performances. Genre names describe artistic inspiration; instrument and choir names describe synthesis approximations, not acoustic recordings or cultural authenticity.\n\nThe **80s synth-pop homage** is an original arrangement. It contains no Rick Astley recording, borrowed song melody, lyrics or imitation of his voice. It is not the Rickroll song.\n\n| Input | Tempo | Duration | Character |\n| --- | ---: | ---: | --- |\n${report.loops.map(loop => `| ${loop.label} | ${loop.bpm} BPM | ${loop.seconds.toFixed(3)} s | ${loop.description} |`).join('\n')}\n\nFiles are stereo PCM16 at 44.1 kHz. Original note sequences, individual ADSR envelopes, velocity accents and stereo positions provide different rhythmic and spectral material for recursive delay. Release tails wrap over the musical bar boundary. One fixed gain per loop targets approximately −16.5 dBFS RMS with peaks no higher than −2.2 dBFS; sparse transient loops can have lower RMS. This is a signal-level target, not a LUFS measurement.\n\nRegenerate from the repository root:\n\n\`\`\`sh\nnode scripts/render-synthesis-extra-loops.mjs\n\`\`\`\n\nAn optional output directory supports comparison renders. The script leaves the original four files in assets/synthesis/loops unchanged. renders.json records the generator and source WASM hashes, complete voice parameters, note sequences, measured levels, loop boundary steps, coarse spectral/envelope characterization and WAV hashes. These mechanical checks do not establish timbral quality or human/device listening acceptance.\n`;
writeFileSync(resolve(output, 'CREDITS.md'), credits);
