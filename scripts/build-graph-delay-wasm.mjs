import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const rust = 'src/instruments/graph-delay-rust/rust';
const artifact = 'assets/wasm/graph-delay.wasm';
const provenance = 'assets/wasm/graph-delay-build.json';
const files = ['scripts/build-graph-delay-wasm.mjs', `${rust}/Cargo.toml`, `${rust}/Cargo.lock`, `${rust}/src/lib.rs`].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(root, file)))])));
const required = ['memory', 'gdr_abi_version', 'gdr_alloc', 'gdr_free', 'gdr_new', 'gdr_drop', 'gdr_plan', 'gdr_controls', 'gdr_prepare',
  'gdr_new_calibration', 'gdr_prepare_calibration_history', 'gdr_performance', 'gdr_limit', 'gdr_metrics_len',
  'gdr_enabled', 'gdr_clear', 'gdr_process', 'gdr_metrics', 'gdr_node_levels', 'gdr_edge_levels'];
async function inspect(bytes) {
  const module = await WebAssembly.compile(bytes), imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module).map(item => item.name).sort();
  if (imports.length || required.some(name => !exports.includes(name))) throw new Error('The Rust graph WASM ABI is invalid.');
  if (new WebAssembly.Instance(module).exports.gdr_abi_version() !== 1) throw new Error('The Rust graph WASM ABI version is invalid.');
  return { imports, exports };
}
if (process.argv.includes('--check')) {
  const bytes = await readFile(path.join(root, artifact)), manifest = JSON.parse(await readFile(path.join(root, provenance), 'utf8'));
  const checked = await inspect(bytes);
  if (manifest.abi !== 1 || manifest.target !== 'wasm32-unknown-unknown' || manifest.bytes !== bytes.length
    || manifest.wasmSha256 !== hash(bytes) || JSON.stringify(manifest.sourceHashes) !== JSON.stringify(await sourceHashes())
    || JSON.stringify(manifest.exports) !== JSON.stringify(checked.exports) || JSON.stringify(manifest.imports) !== JSON.stringify(checked.imports)) {
    throw new Error('The Rust graph WASM build is stale; run node scripts/build-graph-delay-wasm.mjs.');
  }
  console.log(`Checked Rust graph WASM: ${bytes.length} bytes, ABI 1, no imports.`);
} else {
  const result = spawnSync('cargo', ['build', '--locked', '--manifest-path', path.join(root, rust, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS || ''} --remap-path-prefix=${root}=. -C strip=symbols`.trim() } });
  if (result.status !== 0) process.exit(result.status || 1);
  await mkdir(path.join(root, 'assets/wasm'), { recursive: true });
  await copyFile(path.join(root, rust, 'target/wasm32-unknown-unknown/release/graph_delay_wasm.wasm'), path.join(root, artifact));
  const bytes = await readFile(path.join(root, artifact)), inspected = await inspect(bytes);
  await writeFile(path.join(root, provenance), JSON.stringify({ abi: 1, target: 'wasm32-unknown-unknown',
    compiler: spawnSync('rustc', ['--version'], { encoding: 'utf8' }).stdout.trim(), bytes: bytes.length,
    wasmSha256: hash(bytes), sourceHashes: await sourceHashes(), ...inspected }, null, 2) + '\n');
  console.log(`Built Rust graph WASM: ${bytes.length} bytes, ABI 1, no imports.`);
}
