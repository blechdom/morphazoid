// Offline production-WASM renders, measured by FFmpeg's actual EBU R128 meter.
// Requires Node and optional FFmpeg on PATH; no browser or audio device is used.
// node scripts/analyze-staircase-loudness.mjs --cases=default-moving,held-white
// node scripts/analyze-staircase-loudness.mjs --rate=44100 --voices=512 --level=1 --brightness=1
// Optional --root, --out, --wasm, --base, --mapping. Defaults create a fresh temp
// directory; explicit --out retains renders, source snapshots and meter logs there.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/analyze-staircase-loudness.mjs [--root=path] [--out=path] [--wasm=path] [--cases=names]\n'
    + 'Options: --rate=44100|48000 --voices=1..512 --level=0..1 --base=20..1200 --mapping=0|1|2 --brightness=0..1\n'
    + 'Cases: default-moving,held-white,dense-white,centers-moving,mode0,mode1,mode3. Outputs default to a fresh temporary directory.');
  process.exit(0);
}
const argumentsMap = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = argument.match(/^--(root|out|wasm|cases|level|rate|voices|base|mapping|brightness)=(.+)$/);
  if (!match) throw new Error(`Unknown argument: ${argument}`);
  return match.slice(1);
}));
const root = path.resolve(argumentsMap.root ?? path.join(directory, '..'));
const wasmPath = path.resolve(argumentsMap.wasm ?? path.join(root, 'assets/wasm/staircase.wasm'));
const optionNumber = (name, fallback, minimum, maximum, integer = false) => {
  const value = argumentsMap[name] === undefined ? fallback : Number(argumentsMap[name]);
  assert.ok(Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isInteger(value)),
    `--${name} must be ${integer ? 'an integer' : 'a number'} from ${minimum} to ${maximum}`);
  return value;
};
const parameters = { sampleRate: optionNumber('rate', 48000, 44100, 48000, true), blockSize: 128,
  aspect: 1.3788659793814433, resolution: 112, pitchSource: 1, voiceLimit: optionNumber('voices', 256, 1, 512, true),
  mode: 2, base: optionNumber('base', 73, 20, 1200), brightness: optionNumber('brightness', .55, 0, 1), body: .35,
  level: optionNumber('level', .75, 0, 1), mapping: optionNumber('mapping', 1, 0, 2, true), span: 3,
  depth: .175, speed: .035, seconds: 20, hold: false, view: 'seahorse' };
assert.ok([44100, 48000].includes(parameters.sampleRate), '--rate must be 44100 or 48000');
const cases = (argumentsMap.cases ?? 'default-moving,held-white,dense-white,centers-moving,mode0,mode1,mode3').split(',');
const available = {
  'default-moving': {},
  'held-white': { hold: true, seconds: 5 },
  'dense-white': { hold: true, seconds: 5, view: 'double-spiral', dense: true },
  'centers-moving': { pitchSource: 0 },
  mode0: { mode: 0 }, mode1: { mode: 1 }, mode3: { mode: 3 },
};
assert.ok(cases.every(name => Object.hasOwn(available, name)), 'Unknown render case; use --help for the case names');
const hash = value => createHash('sha256').update(value).digest('hex');
const command = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (binary === 'ffmpeg' && result.error?.code === 'ENOENT') throw new Error('This optional loudness analysis requires FFmpeg on PATH with the ebur128 filter; install FFmpeg and retry.');
  if (result.error || result.status !== 0) throw new Error(`${binary} failed: ${result.error?.message ?? result.stderr}`);
  return result;
};
const ffmpegVersion = command('ffmpeg', ['-version']).stdout.split('\n')[0];
const out = argumentsMap.out ? path.resolve(argumentsMap.out) : await mkdtemp(path.join(tmpdir(), 'staircase-loudness-'));
await mkdir(out, { recursive: true });
const fieldPath = path.join(root, 'src/instruments/striped-staircase-rust/field.js');
const originalPath = path.join(root, 'src/instruments/striped-staircase/striped-staircase.js');
const rustPath = path.join(root, 'src/instruments/striped-staircase-rust/rust/src/lib.rs');
const [wasm, fieldSource, originalSource, rustSource] = await Promise.all([wasmPath, fieldPath, originalPath, rustPath].map(name => readFile(name)));
const { buildStaircaseField, readStaircaseRhythm } = await import(pathToFileURL(fieldPath));
const { cameraFromView, viewById } = await import(pathToFileURL(originalPath));
const module = await WebAssembly.compile(wasm);
const provenance = { measuredAt: new Date().toISOString(), root, wasmPath,
  wasmOverride: Boolean(argumentsMap.wasm),
  commit: command('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
  dirtyPaths: command('git', ['status', '--short'], { cwd: root }).stdout.trim().split('\n').filter(Boolean),
  node: process.version, ffmpeg: ffmpegVersion,
  wasmBytes: wasm.length, wasmSha256: hash(wasm), fieldSourceSha256: hash(fieldSource), originalSourceSha256: hash(originalSource),
  rustSourceSha256: hash(rustSource), analyzerSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  method: `Direct Rust WASM exports, stereo IEEE float32 WAV at ${parameters.sampleRate} Hz, 128-frame calls. FFmpeg ebur128=peak=true supplies gated integrated LUFS, LRA and oversampled true peak. RMS/sample peak are separate diagnostics. No analyzer normalization, compressor, post-gain, dithering or silent preroll. Browser/device routing is excluded. Null dB values indicate negative infinity; the meter's integrated floor is retained.`,
  sourceSnapshotScope: 'Sources are read from --root. With --wasm, the supplied binary is measured and saved exactly; root Rust source is a snapshot, not proof of that external binary compilation.',
  defaults: parameters };
await Promise.all([['kernel.wasm', wasm], ['field-source.js', fieldSource], ['original-source.js', originalSource], ['rust-source.rs', rustSource]]
  .map(([name, bytes]) => writeFile(path.join(out, name), bytes)));
const rows = [], fields = new Map();
for (const name of cases) {
  const settings = { ...parameters, ...available[name] };
  const fieldKey = `${settings.view}-${settings.pitchSource}`;
  let field = fields.get(fieldKey);
  if (!field) {
    field = buildStaircaseField({ camera: cameraFromView(viewById(settings.view)), aspect: settings.aspect,
      resolution: settings.resolution, pitchSource: settings.pitchSource, voiceLimit: settings.voiceLimit });
    fields.set(fieldKey, field);
    await writeFile(path.join(out, `${fieldKey}.table.f32le`), new Uint8Array(field.table.buffer));
  }
  if (settings.dense) {
    const candidates = Array.from({ length: field.frames }, (_, index) => ({ depth: index / (field.frames - 1),
      ...readStaircaseRhythm(field, index / (field.frames - 1)) })).filter(item => item.white);
    candidates.sort((a, b) => b.count - a.count || a.depth - b.depth);
    assert.ok(candidates[0]?.count > 0, 'Dense representative must contain real complete white pairs');
    settings.depth = candidates[0].depth;
  }
  const api = new WebAssembly.Instance(module).exports, engine = api.stair_new(settings.sampleRate);
  assert.ok(engine); assert.equal(api.stair_abi_version(), 3);
  const leftPointer = api.stair_alloc(settings.blockSize * 4), rightPointer = api.stair_alloc(settings.blockSize * 4);
  const tablePointer = api.stair_alloc(field.table.byteLength);
  const samples = Math.round(settings.seconds * settings.sampleRate), audio = new Float32Array(samples * 2);
  let squares = 0, peak = 0, stereoDelta = 0, dc = 0, exactSilentFrames = 0, whiteBlocks = 0, voiceSum = 0, voiceMax = 0, voiceMin = Infinity, blocks = 0;
  const start = performance.now();
  let finalState;
  try {
    new Float32Array(api.memory.buffer, tablePointer, field.table.length).set(field.table);
    assert.equal(api.stair_table(engine, tablePointer, field.table.length, field.frames), 1);
    assert.equal(api.stair_controls(engine, settings.mode, settings.base, settings.brightness, settings.body, settings.level, 1 / settings.speed), 1);
    assert.equal(api.stair_pitch(engine, settings.mapping, settings.span), 1);
    assert.equal(api.stair_seek(engine, settings.depth, 1), 1);
    assert.equal(api.stair_transport(engine, 1, 1, Number(settings.hold)), 1);
    for (let offset = 0; offset < samples; offset += settings.blockSize) {
      const count = Math.min(settings.blockSize, samples - offset);
      assert.equal(api.stair_process(engine, leftPointer, rightPointer, count), 1);
      const left = new Float32Array(api.memory.buffer, leftPointer, count), right = new Float32Array(api.memory.buffer, rightPointer, count);
      for (let index = 0; index < count; index++) {
        const a = left[index], b = right[index];
        assert.ok(Number.isFinite(a) && Number.isFinite(b), 'Nonfinite audio');
        audio[(offset + index) * 2] = a; audio[(offset + index) * 2 + 1] = b;
        squares += a * a + b * b; peak = Math.max(peak, Math.abs(a), Math.abs(b)); dc += a + b;
        stereoDelta = Math.max(stereoDelta, Math.abs(a - b));
        if (a === 0 && b === 0) exactSilentFrames++;
      }
      const state = new Float64Array(api.memory.buffer, api.stair_state(engine), api.stair_state_len());
      whiteBlocks += Number(state[11] !== 0); voiceSum += state[10]; voiceMax = Math.max(voiceMax, state[10]); voiceMin = Math.min(voiceMin, state[10]); blocks++;
    }
    finalState = Array.from(new Float64Array(api.memory.buffer, api.stair_state(engine), api.stair_state_len()));
  } finally {
    api.stair_drop(engine); api.stair_free(leftPointer, settings.blockSize * 4); api.stair_free(rightPointer, settings.blockSize * 4); api.stair_free(tablePointer, field.table.byteLength);
  }
  const renderMs = performance.now() - start;
  assert.equal(new Uint8Array(new Uint16Array([1]).buffer)[0], 1, 'WAV writer requires a little-endian host');
  const header = Buffer.alloc(44), data = Buffer.from(audio.buffer);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(settings.sampleRate, 24); header.writeUInt32LE(settings.sampleRate * 8, 28);
  header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const wav = Buffer.concat([header, data]), wavPath = path.join(out, `${name}.wav`);
  await writeFile(wavPath, wav);
  const ffmpegArgs = ['-hide_banner', '-nostats', '-i', wavPath, '-af', 'ebur128=peak=true', '-f', 'null', '-'];
  const log = command('ffmpeg', ffmpegArgs).stderr;
  await writeFile(path.join(out, `${name}.ebur128.log`), log);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const number = expression => {
    const match = summary.match(expression); assert.ok(match, `Unparsed EBU128 summary: ${summary}`);
    return /^-?inf$/i.test(match[1]) ? null : Number(match[1]);
  };
  const loudness = { integratedLufs: number(/Integrated loudness:\s*I:\s*(-?inf|[-\d.]+) LUFS/i),
    loudnessRangeLu: number(/Loudness range:\s*LRA:\s*([-\d.]+) LU/), truePeakDbtp: number(/True peak:\s*Peak:\s*(-?inf|[-\d.]+) dBFS/i) };
  const rms = Math.sqrt(squares / audio.length);
  const row = { name, settings, wavPath, wavBytes: wav.length, wavSha256: hash(wav), pcmSha256: hash(data),
    tableSha256: hash(new Uint8Array(field.table.buffer)), tablePath: path.join(out, `${fieldKey}.table.f32le`),
    camera: field.camera, staircaseSettings: field.settings, gridStats: field.stats, effectiveVoiceLimit: field.voiceLimit,
    startGeometry: { ...readStaircaseRhythm(field, settings.depth), branches: undefined },
    renderMs, finalState, loudness, diagnostics: { isExactSilence: peak === 0, samplePeak: peak, samplePeakDbfs: peak > 0 ? 20 * Math.log10(peak) : null,
      rms, rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null, dc: dc / audio.length, maximumStereoDifference: stereoDelta,
      exactSilentFrameFraction: exactSilentFrames / samples, whiteBlockFraction: whiteBlocks / blocks,
      voiceCount: { min: voiceMin, max: voiceMax, mean: voiceSum / blocks } }, ffmpegArgs };
  rows.push(row);
  const report = { provenance, rows };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ name, ...loudness, samplePeakDbfs: row.diagnostics.samplePeakDbfs,
    depth: settings.depth, voices: row.diagnostics.voiceCount, renderMs: Math.round(renderMs), report: path.join(out, 'report.json') }));
}
