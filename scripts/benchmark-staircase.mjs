// Warm Node/WASM throughput, not an AudioWorklet/device capacity guarantee.
// Compile capacity variants in an owned temporary directory; authored source
// and committed WASM are never changed. Run: node scripts/benchmark-staircase.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildStaircaseField } from '../src/instruments/striped-staircase-rust/field.js';
import { STRIPED_STAIRCASE_VIEWS, cameraFromView } from '../src/instruments/striped-staircase/striped-staircase.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = argument.match(/^--(voices|blocks|warmup|repeats|output|rust-source)=(.+)$/);
  if (!match) throw new Error(`Unknown argument ${argument}; use --name=value.`);
  return match.slice(1);
}));
function positive(value, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  assert.ok(Number.isInteger(number) && number > 0 && number <= maximum, `Invalid positive count: ${value}`);
  return number;
}
const capacities = (options.voices ?? '32,64,128,256,512,1024').split(',').map(value => positive(value, 32, 4096));
const blocks = positive(options.blocks, 384, 100000);
const warmup = positive(options.warmup, 512, 100000);
const repeats = positive(options.repeats, 5, 100);
const rate = 48000, blockSize = 128, frames = 64, deadlineMs = blockSize / rate * 1000;
const rustRoot = path.join(root, 'src/instruments/striped-staircase-rust/rust');
const sourcePath = path.resolve(options['rust-source'] ?? path.join(rustRoot, 'src/lib.rs'));
const source = await readFile(sourcePath, 'utf8');
const branchDeclaration = /const BRANCHES: usize = \d+;/g;
assert.equal([...source.matchAll(branchDeclaration)].length, 1, 'One exact capacity declaration is required.');
assert.match(source, /const STRIDE: usize = 544 \+ BRANCHES \* 4;/, 'Update the synthetic record for a changed branch ABI.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function command(executable, args, extra = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', ...extra });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
const quantile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
const rounded = number => Number(number.toFixed(6));
function summarize(timings) {
  const sorted = timings.slice().sort((a, b) => a - b);
  return { medianMs: rounded(quantile(sorted, .5)), p95Ms: rounded(quantile(sorted, .95)),
    p99Ms: rounded(quantile(sorted, .99)), maximumMs: rounded(sorted.at(-1)),
    p95DeadlinePercent: rounded(quantile(sorted, .95) / deadlineMs * 100),
    deadlineOverruns: sorted.filter(time => time > deadlineMs).length };
}
function syntheticField(capacity) {
  const stride = 544 + capacity * 4, table = new Float32Array(frames * stride);
  for (let frame = 0; frame < frames; frame++) {
    const at = frame * stride;
    for (let point = 0; point < 256; point++) {
      table[at + point] = .25 * Math.cos(point / 256 * Math.PI * 2);
      table[at + 256 + point] = .25 * Math.sin(point / 256 * Math.PI * 2);
    }
    table.fill(1 / 16, at + 512, at + 528);
    table.set([.3, .4, 0, 0, 1, .2, 5.25, 7], at + 528);
    for (let voice = 0; voice < capacity; voice++) {
      const position = (voice + .5) / capacity;
      table.set([1, position, position, .2], at + 544 + voice * 4);
    }
  }
  return table;
}
function surveyGeometry() {
  buildStaircaseField({ resolution: 32 });
  const cases = STRIPED_STAIRCASE_VIEWS.flatMap(view => [64, 112, 192].map(resolution => ({ view, resolution, aspect: 1.5 })));
  const seahorse = STRIPED_STAIRCASE_VIEWS.find(view => view.id === 'seahorse');
  for (const aspect of [.6, 2.5]) for (const resolution of [64, 112, 192]) cases.push({ view: seahorse, resolution, aspect });
  return { scope: 'Single worker-equivalent builds after one warmup, including the checked-in branch matcher. Counts are uncapped sampled contour components, not mathematical branches. Censoring, clipping, aspect and grid resolution affect them. This is separate from DSP throughput.',
    rows: cases.map(({ view, resolution, aspect }) => {
      const start = performance.now();
      const field = buildStaircaseField({ camera: cameraFromView(view), resolution, aspect });
      const buildMs = performance.now() - start;
      const counts = field.overlays.map(overlay => overlay.contours).sort((a, b) => a - b);
      return { view: view.id, resolution, aspect, grid: [field.stats.columns, field.stats.rows],
        buildMs: rounded(buildMs), censoredPercent: rounded(field.stats.censored / field.stats.samples * 100),
        maxContours: counts.at(-1), p50Contours: quantile(counts, .5), p95Contours: quantile(counts, .95),
        framesAbove: Object.fromEntries([32, 64, 128, 256, 512, 1024].map(capacity => [capacity, counts.filter(count => count > capacity).length])) };
    }) };
}
const directory = await mkdtemp(path.join(tmpdir(), 'morphazoid-staircase-benchmark-'));
const rows = [];
try {
  await mkdir(path.join(directory, 'src'));
  for (const name of ['Cargo.toml', 'Cargo.lock']) await writeFile(path.join(directory, name), await readFile(path.join(rustRoot, name)));
  for (const capacity of capacities) {
    await writeFile(path.join(directory, 'src/lib.rs'), source.replace(branchDeclaration, `const BRANCHES: usize = ${capacity};`));
    command('cargo', ['build', '--locked', '--manifest-path', path.join(directory, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release'], {
      env: { ...process.env, CARGO_TARGET_DIR: path.join(directory, 'target'),
        RUSTFLAGS: `--remap-path-prefix=${directory}=. -C strip=symbols` },
    });
    const bytes = await readFile(path.join(directory, 'target/wasm32-unknown-unknown/release/staircase_wasm.wasm'));
    const { instance } = await WebAssembly.instantiate(bytes), api = instance.exports;
    assert.equal(api.stair_abi_version(), 2);
    const handle = api.stair_new(rate), table = syntheticField(capacity);
    const leftPointer = api.stair_alloc(blockSize * 4), rightPointer = api.stair_alloc(blockSize * 4), tablePointer = api.stair_alloc(table.byteLength);
    assert.ok(handle && leftPointer && rightPointer && tablePointer);
    try {
      new Float32Array(api.memory.buffer, tablePointer, table.length).set(table);
      assert.equal(api.stair_table(handle, tablePointer, table.length, frames), 1);
      api.stair_controls(handle, 2, 110, 1, .5, .5, 24);
      api.stair_seek(handle, .5, 1);
      api.stair_transport(handle, 1, 1, 1);
      const render = () => api.stair_process(handle, leftPointer, rightPointer, blockSize);
      for (let block = 0; block < warmup; block++) assert.equal(render(), 1);
      const state = new Float64Array(api.memory.buffer, api.stair_state(handle), api.stair_state_len());
      assert.equal(state[10], capacity, 'All synthetic voices must be active.');
      assert.equal(state[11], 1, 'The fixture must sustain the white gate.');
      const timings = [], rounds = [];
      for (let repeat = 0; repeat < repeats; repeat++) {
        const round = [];
        for (let block = 0; block < blocks; block++) {
          const start = performance.now();
          const success = render();
          round.push(performance.now() - start);
          assert.equal(success, 1);
        }
        timings.push(...round); rounds.push(summarize(round));
      }
      const output = new Float32Array(api.memory.buffer, leftPointer, blockSize);
      assert.ok(output.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
      assert.ok(output.some(value => value !== 0), 'A silent benchmark would understate voice work.');
      // Upload executes on the worklet too. Report its separate worst-case burst
      // rather than hiding it in steady-state block throughput.
      const uploadTimings = [];
      for (let repeat = 0; repeat < 11; repeat++) {
        const start = performance.now();
        const accepted = api.stair_table(handle, tablePointer, table.length, frames);
        uploadTimings.push(performance.now() - start); assert.equal(accepted, 1);
      }
      const row = { capacity, activeVoices: capacity, wasmBytes: bytes.length, wasmSha256: sha256(bytes),
        tableBytes: table.byteLength, blocks: timings.length, ...summarize(timings), rounds,
        upload: { iterations: uploadTimings.length, ...summarize(uploadTimings) } };
      rows.push(row);
      console.error(`${capacity} voices: median ${row.medianMs} ms, p95 ${row.p95Ms} ms (${row.p95DeadlinePercent}% of quantum); upload p95 ${row.upload.p95Ms} ms`);
    } finally {
      api.stair_drop(handle); api.stair_free(leftPointer, blockSize * 4); api.stair_free(rightPointer, blockSize * 4); api.stair_free(tablePointer, table.byteLength);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
const result = { measuredAt: new Date().toISOString(), sourceCommit: command('git', ['rev-parse', 'HEAD']),
  rustSource: path.relative(root, sourcePath), rustSourceSha256: sha256(source), compiler: command('rustc', ['--version']),
  runtime: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  sampleRate: rate, blockSize, deadlineMs, warmupBlocks: warmup, repeats, blocksPerRepeat: blocks,
  scenario: 'All synthetic components sustain a white stripe; mode 2, maximum Detail, held depth, 32-sample metadata refresh. All existing mode calculations remain in the measured callback.',
  scope: 'Warm Node/WASM kernel plus JS call/timer overhead. Excludes AudioWorklet routing, browser/UI/worker scheduling, audio output device, and power/thermal variation. Local timing does not establish a universal safe voice maximum.',
  rows, geometry: surveyGeometry() };
const json = JSON.stringify(result, null, 2) + '\n';
if (options.output) await writeFile(path.resolve(options.output), json);
else process.stdout.write(json);
