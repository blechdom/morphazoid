import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const rust = 'src/instruments/micmic/rust';
const artifact = 'assets/wasm/l-system-delay.wasm';
const provenance = 'assets/wasm/l-system-delay-build.json';
const sourceFiles = [
  'scripts/build-l-system-delay-wasm.mjs',
  `${rust}/Cargo.toml`, `${rust}/Cargo.lock`,
  `${rust}/core/Cargo.toml`, `${rust}/core/src/lib.rs`,
  `${rust}/wasm/Cargo.toml`, `${rust}/wasm/src/lib.rs`,
  ...['adaptive', 'conditioning', 'model', 'performance', 'resources'].map(name => `${rust}/app/src/${name}.rs`),
].sort();
const requiredExports = [
  'memory', 'lsd_abi_version', 'lsd_alloc', 'lsd_free', 'lsd_error_ptr', 'lsd_error_len',
  'lsd_compile', 'lsd_compile_json_ptr', 'lsd_compile_json_len', 'lsd_compile_pool_ptr',
  'lsd_compile_pool_len', 'lsd_compile_free', 'lsd_new', 'lsd_drop', 'lsd_install',
  'lsd_performance', 'lsd_strike', 'lsd_process', 'lsd_observe', 'lsd_metrics_ptr', 'lsd_metrics_len',
  'lsd_taps_ptr', 'lsd_taps_count', 'lsd_tap_indices_ptr', 'lsd_generations_ptr',
  'lsd_generation_counts_ptr', 'lsd_envelope_ptr', 'lsd_envelope_count', 'lsd_envelope_offset',
  'lsd_envelope_end_time', 'lsd_envelope_interval',
].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(root, file)))])));

async function inspect(bytes) {
  if (!WebAssembly.validate(bytes)) throw new Error('L-system Delay WASM is invalid');
  const module = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length) throw new Error('L-system Delay WASM must have no imports: ' + JSON.stringify(imports));
  const exports = WebAssembly.Module.exports(module).map(item => item.name).sort();
  for (const name of requiredExports) {
    if (!exports.includes(name)) throw new Error(`L-system Delay WASM is missing ${name}`);
  }
  const instance = await WebAssembly.instantiate(module);
  if (instance.exports.lsd_abi_version() !== 1 || instance.exports.lsd_metrics_len() !== 26) {
    throw new Error('L-system Delay WASM ABI does not match the browser bridge');
  }
  return { exports, imports };
}

if (process.argv.includes('--check')) {
  // CI only needs Node and the committed bytes: do not invoke rustc or cargo.
  const bytes = await readFile(path.join(root, artifact));
  const manifest = JSON.parse(await readFile(path.join(root, provenance), 'utf8'));
  const inspected = await inspect(bytes);
  const sourceHashes = await sources();
  if (manifest.abi !== 1 || manifest.target !== 'wasm32-unknown-unknown'
    || manifest.wasmSha256 !== hash(bytes) || manifest.bytes !== bytes.length
    || JSON.stringify(manifest.sourceHashes) !== JSON.stringify(sourceHashes)
    || JSON.stringify(manifest.exports) !== JSON.stringify(inspected.exports)
    || JSON.stringify(manifest.imports) !== JSON.stringify(inspected.imports)) {
    throw new Error('L-system Delay WASM or its build provenance is stale; run node scripts/build-l-system-delay-wasm.mjs');
  }
  console.log(`Checked Rust L-system Delay WASM: ${bytes.length} bytes, ABI 1, no imports.`);
} else {
  const args = ['build', '--locked', '--manifest-path', path.join(root, rust, 'Cargo.toml'),
    '-p', 'l-system-delay-wasm', '--target', 'wasm32-unknown-unknown', '--release'];
  // Paths are normalized so checkout location does not enter the artifact.
  const rustFlags = `${process.env.RUSTFLAGS || ''} --remap-path-prefix=${root}=. -C strip=symbols`.trim();
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: rustFlags } });
  if (result.status !== 0) process.exit(result.status || 1);
  await mkdir(path.join(root, 'assets/wasm'), { recursive: true });
  await copyFile(path.join(root, rust, 'target/wasm32-unknown-unknown/release/l_system_delay_wasm.wasm'), path.join(root, artifact));
  const bytes = await readFile(path.join(root, artifact));
  const inspected = await inspect(bytes);
  const toolchain = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  await writeFile(path.join(root, provenance), JSON.stringify({
    abi: 1, target: 'wasm32-unknown-unknown', compiler: toolchain.stdout.trim(),
    bytes: bytes.length, wasmSha256: hash(bytes), sourceHashes: await sources(), ...inspected,
  }, null, 2) + '\n');
  console.log(`Built Rust L-system Delay WASM: ${bytes.length} bytes, ABI 1, no imports.`);
}
