import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMethod, getPreset } from '../src/instruments/synthesis/catalog.js';

// Render original musical phrases through the same Rust/WASM core as the page.
// No audio device, browser, external recording or extra DSP implementation.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || fileURLToPath(new URL('../assets/synthesis/loops/', import.meta.url)));
const rate = 44100, bpm = 120, beatSeconds = 60 / bpm;
const wasm = readFileSync(resolve(root, 'assets/wasm/synthesis.wasm'));
const api = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
// Events: beat, MIDI note, gate in beats, velocity, pan (-1..1).
const loops = [
  {
    id: 'bass-groove', label: 'Bass groove', beats: 8,
    method: 'subtractive', preset: 'muted-saw-bass',
    envelope: { attack: .005, decay: .16, sustain: .5, release: .09 },
    events: [
      [0,33,.65,.95,0], [1,33,.35,.72,0], [1.75,40,.38,.8,0],
      [2.5,43,.4,.82,0], [3.25,45,.32,.7,0], [4,31,.7,.93,0],
      [5,31,.38,.74,0], [5.75,38,.35,.82,0], [6.5,43,.4,.84,0], [7.25,40,.32,.7,0],
    ],
  },
  {
    id: 'electric-piano', label: 'Electric piano chords', beats: 16,
    method: 'fm', preset: 'electric-tine',
    envelope: { attack: .003, decay: 1.25, sustain: .12, release: .65 },
    events: [
      [57,60,64,71], [53,57,60,64], [55,60,64,67], [55,59,62,69],
    ].flatMap((chord, bar) => chord.flatMap((note, voice) => [
      [bar * 4 + voice * .014, note, 1.2, .76 + voice * .025, (voice - 1.5) * .14],
      [bar * 4 + 2.5 + voice * .012, note, .65, .57 + voice * .025, (voice - 1.5) * .14],
    ])),
  },
  {
    id: 'plucked-strings', label: 'Plucked strings', beats: 8,
    method: 'karplus-strong', preset: 'natural-string-pluck',
    envelope: { attack: .002, decay: 1.35, sustain: 0, release: .5 },
    events: [
      [0,57,1.4,.88,-.18], [.75,64,1.1,.7,.12], [1.5,69,1.2,.8,-.08],
      [2.25,72,1,.72,.18], [3,71,.85,.65,-.12], [4,55,1.4,.88,.18],
      [4.75,62,1.1,.7,-.12], [5.5,67,1.2,.8,.08], [6.25,71,1,.72,-.18], [7,69,.85,.65,.12],
    ],
  },
  {
    id: 'synth-arpeggio', label: 'Synth arpeggio', beats: 8,
    method: 'wavetable', preset: 'hollow-square',
    envelope: { attack: .004, decay: .075, sustain: .28, release: .065 },
    events: [57,64,69,72,64,67,71,76,55,62,67,71,62,65,69,74]
      .map((note, step) => [step * .5, note, step % 4 === 0 ? .32 : .22,
        step % 4 === 0 ? .85 : step % 2 ? .62 : .73, step % 2 ? .16 : -.16]),
  },
];

function renderNote(loop, event) {
  const [, midi, gate, velocity] = event;
  const preset = getPreset(loop.method, loop.preset), method = getMethod(loop.method);
  const envelope = loop.envelope;
  const gateFrame = Math.round(gate * beatSeconds * rate);
  const frames = gateFrame + Math.ceil((envelope.release + .3) * rate);
  const samples = new Float32Array(frames), engine = api.synth_new(rate);
  try {
    api.synth_set_method(engine, method.engineId);
    new Float32Array(api.memory.buffer, api.synth_params_ptr(engine), 16).set(preset.params);
    api.synth_apply_params(engine);
    api.synth_set_frequency(engine, hz(midi));
    api.synth_set_envelope(engine, envelope.attack, envelope.decay, envelope.sustain, envelope.release);
    api.synth_set_level_trim_db(engine, 0);
    api.synth_reset(engine);
    api.synth_note_on(engine, hz(midi), velocity);
    for (let offset = 0; offset < frames;) {
      if (offset === gateFrame) api.synth_note_off(engine);
      const count = Math.min(128, frames - offset, offset < gateFrame ? gateFrame - offset : frames - offset);
      if (api.synth_process(engine, count) !== count) throw new Error('Incomplete note render');
      samples.set(new Float32Array(api.memory.buffer, api.synth_output_ptr(engine), count), offset);
      offset += count;
    }
    // Finish any extremely low residual tail before periodically summing notes.
    const fade = Math.round(rate * .008);
    for (let i = 0; i < fade; i++) samples[frames - fade + i] *= (fade - 1 - i) / fade;
    return samples;
  } finally { api.synth_free(engine); }
}

function renderLoop(loop) {
  const frames = Math.round(loop.beats * beatSeconds * rate);
  const channels = [new Float64Array(frames), new Float64Array(frames)];
  for (const event of loop.events) {
    const note = renderNote(loop, event), start = Math.round(event[0] * beatSeconds * rate);
    const gains = [Math.sqrt((1 - event[4]) / 2), Math.sqrt((1 + event[4]) / 2)];
    for (let c = 0; c < 2; c++) for (let i = 0; i < note.length; i++) {
      // Tails cross the bar line instead of being chopped or adding silence.
      channels[c][(start + i) % frames] += note[i] * gains[c];
    }
  }
  let peak = 0, energy = 0;
  for (const channel of channels) {
    const mean = channel.reduce((sum, value) => sum + value, 0) / frames;
    for (let i = 0; i < frames; i++) {
      channel[i] -= mean;
      if (!Number.isFinite(channel[i])) throw new Error('Non-finite sample');
      peak = Math.max(peak, Math.abs(channel[i])); energy += channel[i] ** 2;
    }
  }
  const rms = Math.sqrt(energy / (frames * 2));
  if (rms < 1e-5) throw new Error('Silent musical loop');
  const gain = Math.min(.16 / rms, .78 / peak);
  for (const channel of channels) for (let i = 0; i < frames; i++) channel[i] *= gain;
  return { channels, frames, rmsDb: 20 * Math.log10(rms * gain), peakDb: 20 * Math.log10(peak * gain) };
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
const report = { engine: 'Synthesaurus Rust/WASM', wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  sampleRate: rate, bpm, license: 'MIT', loops: [] };
for (const loop of loops) {
  const result = renderLoop(loop), bytes = wav(result.channels, result.frames);
  writeFileSync(resolve(output, loop.id + '.wav'), bytes);
  report.loops.push({ ...loop, seconds: result.frames / rate, rmsDb: result.rmsDb, peakDb: result.peakDb,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${loop.label}: ${result.frames / rate}s, RMS ${result.rmsDb.toFixed(1)} dBFS, peak ${result.peakDb.toFixed(1)} dBFS`);
}
writeFileSync(resolve(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
