import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const rust = 'src/instruments/fractal-delay/rust';
const artifact = 'assets/wasm/fractal-delay.wasm', provenance = 'assets/wasm/fractal-delay-build.json';
const sourceFiles = ['scripts/build-fractal-delay-wasm.mjs', `${rust}/Cargo.toml`, `${rust}/Cargo.lock`, `${rust}/src/lib.rs`].sort();
const requiredExports = ['memory', 'fd_abi_version', 'fd_alloc', 'fd_free', 'fd_new', 'fd_drop', 'fd_scene_begin', 'fd_scene_step',
  'fd_scene_abort', 'fd_controls', 'fd_estimated_bytes', 'fd_process', 'fd_collect', 'fd_metrics_ptr', 'fd_metrics_len',
  'fd_edge_count', 'fd_edge_levels_ptr', 'fd_edge_waveforms_ptr', 'fd_error_ptr', 'fd_error_len'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(root, file)))])));
async function inspect(bytes) {
  if (!WebAssembly.validate(bytes)) throw new Error('Invalid fractal delay WASM');
  const module = await WebAssembly.compile(bytes), imports = WebAssembly.Module.imports(module);
  if (imports.length) throw new Error('Fractal delay WASM must have no imports');
  const exports = WebAssembly.Module.exports(module).map(item => item.name).sort();
  for (const name of requiredExports) if (!exports.includes(name)) throw new Error(`Missing ${name}`);
  const instance = await WebAssembly.instantiate(module);
  if (instance.exports.fd_abi_version() !== 1 || instance.exports.fd_metrics_len() !== 14) throw new Error('Fractal delay ABI mismatch');
  return { imports, exports };
}
if (process.argv.includes('--check')) {
  const bytes = await readFile(path.join(root, artifact)), manifest = JSON.parse(await readFile(path.join(root, provenance), 'utf8'));
  const inspected = await inspect(bytes);
  if (manifest.abi !== 1 || manifest.target !== 'wasm32-unknown-unknown' || manifest.wasmSha256 !== hash(bytes)
    || manifest.bytes !== bytes.length || JSON.stringify(manifest.sourceHashes) !== JSON.stringify(await sources())
    || JSON.stringify(manifest.exports) !== JSON.stringify(inspected.exports) || JSON.stringify(manifest.imports) !== JSON.stringify(inspected.imports)) {
    throw new Error('Fractal delay WASM provenance stale; run node scripts/build-fractal-delay-wasm.mjs');
  }
  console.log(`Checked Rust fractal delay WASM: ${bytes.length} bytes, ABI1, no imports.`);
} else {
  const result = spawnSync('cargo', ['build', '--locked', '--manifest-path', path.join(root, rust, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS || ''} --remap-path-prefix=${root}=. -C strip=symbols`.trim() } });
  if (result.status !== 0) process.exit(result.status || 1);
  await mkdir(path.join(root, 'assets/wasm'), { recursive: true });
  await copyFile(path.join(root, rust, 'target/wasm32-unknown-unknown/release/fractal_delay_wasm.wasm'), path.join(root, artifact));
  const bytes = await readFile(path.join(root, artifact)), inspected = await inspect(bytes);
  const toolchain = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  await writeFile(path.join(root, provenance), JSON.stringify({ abi: 1, target: 'wasm32-unknown-unknown', compiler: toolchain.stdout.trim(),
    bytes: bytes.length, wasmSha256: hash(bytes), sourceHashes: await sources(), ...inspected }, null, 2) + '\n');
  console.log(`Built Rust fractal delay WASM: ${bytes.length} bytes, ABI1, no imports.`);
}
