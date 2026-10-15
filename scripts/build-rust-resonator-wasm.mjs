import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = 'src/instruments/simd-resonator-rust/rust/kernel.rs';
const manifestPath = 'src/instruments/simd-resonator-rust/rust/build-manifest.json';
const sourceFiles = ['scripts/build-rust-resonator-wasm.mjs', source].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(root, file)))])));
const commonFlags = [
  '--edition=2021', '--crate-type=cdylib', '--crate-name=rust_resonator',
  '--target=wasm32-unknown-unknown', '-Copt-level=3', '-Cpanic=abort',
  '-Clto=fat', '-Ccodegen-units=1', '-Cstrip=symbols',
  '-Clink-arg=--stack-first', '-Clink-arg=-zstack-size=65536',
  '-Clink-arg=--initial-memory=262144', '-Clink-arg=--max-memory=262144',
];
const builds = Object.freeze({
  scalar: { output: 'assets/wasm/rust-resonator-scalar.wasm', flags: ['-Ctarget-feature=-simd128,-relaxed-simd', '-Cno-vectorize-loops', '-Cno-vectorize-slp'] },
  simd: { output: 'assets/wasm/rust-resonator-simd.wasm', flags: ['--cfg', 'feature="simd"', '-Ctarget-feature=+simd128'] },
});
const required = ['memory', 'abi_version', 'max_modes', 'block_size', 'lane_width', 'reset', 'reset_resonator', 'process_resonator',
  'input_ptr', 'output_left_ptr', 'output_right_ptr', 'real_ptr', 'imaginary_ptr', 'cosine_ptr', 'sine_ptr',
  'decay_ptr', 'strike_ptr', 'gain_ptr', 'pan_left_ptr', 'pan_right_ptr', 'energy_ptr'];

function vectorLocals(bytes) {
  let cursor = 8;
  let vectors = 0;
  const leb = () => { let value = 0; let shift = 0; let byte; do { byte = bytes[cursor++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128); return value; };
  while (cursor < bytes.length) {
    const section = bytes[cursor++];
    const length = leb();
    const end = cursor + length;
    if (section === 10) {
      const functions = leb();
      for (let fn = 0; fn < functions; fn += 1) {
        const size = leb();
        const bodyEnd = cursor + size;
        const declarations = leb();
        for (let local = 0; local < declarations; local += 1) {
          const count = leb();
          if (bytes[cursor++] === 0x7b) vectors += count;
        }
        cursor = bodyEnd;
      }
    }
    cursor = end;
  }
  return vectors;
}

async function inspect(bytes, variant) {
  const module = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module).map(item => item.name).sort();
  const instance = new WebAssembly.Instance(module);
  const e = instance.exports;
  const simdLocals = vectorLocals(bytes);
  if (imports.length || required.some(name => !exports.includes(name)) || e.abi_version() !== 1
    || e.max_modes() !== 4096 || e.block_size() !== 128 || e.lane_width() !== (variant === 'simd' ? 4 : 1)
    || e.memory.buffer.byteLength !== 262144 || (simdLocals > 0) !== (variant === 'simd')) {
    throw new Error(`The Rust resonator ${variant} ABI is invalid.`);
  }
  let grew = false;
  try { e.memory.grow(1); grew = true; } catch (error) { if (!(error instanceof RangeError)) throw error; }
  if (grew) throw new Error('The Rust resonator memory must not grow.');
  return { bytes: bytes.length, wasmSha256: hash(bytes), imports, exports, simdLocals };
}

if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
  if (manifest.abi !== 1 || manifest.target !== 'wasm32-unknown-unknown'
    || JSON.stringify(manifest.commonFlags) !== JSON.stringify(commonFlags)
    || JSON.stringify(manifest.sourceHashes) !== JSON.stringify(await sourceHashes())) {
    throw new Error('The Rust resonator build is stale; run node scripts/build-rust-resonator-wasm.mjs.');
  }
  for (const [variant, build] of Object.entries(builds)) {
    const checked = { ...build, ...await inspect(await readFile(path.join(root, build.output)), variant) };
    if (JSON.stringify(manifest.builds?.[variant]) !== JSON.stringify(checked)) {
      throw new Error(`The Rust resonator ${variant} artifact is stale; rebuild its Wasm.`);
    }
  }
  console.log('Checked Rust resonator scalar/SIMD: ABI 1, 4,096 modes, fixed memory, no imports.');
} else {
  const compiler = process.env.RUSTC || 'rustc';
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) throw new Error('Install stable Rust and run: rustup target add wasm32-unknown-unknown');
  const artifacts = {};
  await mkdir(path.join(root, 'assets/wasm'), { recursive: true });
  for (const [variant, build] of Object.entries(builds)) {
    const result = spawnSync(compiler, [...commonFlags, ...build.flags, `--remap-path-prefix=${root}=.`, source, '-o', build.output], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    artifacts[variant] = { ...build, ...await inspect(await readFile(path.join(root, build.output)), variant) };
  }
  await writeFile(path.join(root, manifestPath), JSON.stringify({ abi: 1, target: 'wasm32-unknown-unknown', compiler: version.stdout.trim(),
    commonFlags, sourceHashes: await sourceHashes(), builds: artifacts }, null, 2) + '\n');
  console.log(`Built Rust resonator: scalar ${artifacts.scalar.bytes} bytes; SIMD ${artifacts.simd.bytes} bytes.`);
}
