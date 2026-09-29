import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rust = resolve(root, "src/instruments/wasm-garden/rust");
const source = resolve(rust, "kernel.rs");
const output = resolve(root, "assets/wasm/wasm-garden.wasm");
const compiler = process.env.RUSTC || "rustc";
const flags = [
  "--edition=2021", "--crate-type=cdylib", "--crate-name=wasm_garden",
  "--target=wasm32-unknown-unknown", "-Copt-level=3", "-Cpanic=abort",
  "-Ctarget-feature=+simd128", "-Clto=fat", "-Ccodegen-units=1", "-Cstrip=symbols",
  "-Clink-arg=--stack-first", "-Clink-arg=-zstack-size=65536",
  "-Clink-arg=--initial-memory=4194304", "-Clink-arg=--max-memory=4194304",
];
const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
if (version.status !== 0) throw new Error("Install stable Rust and run: rustup target add wasm32-unknown-unknown");
await mkdir(dirname(output), { recursive: true });
const build = spawnSync(compiler, [...flags, source, "-o", output], { cwd: root, encoding: "utf8" });
if (build.status !== 0) {
  process.stderr.write(build.stderr || build.error?.message || "Rust compilation failed.\n");
  process.stderr.write("The build requires: rustup target add wasm32-unknown-unknown\n");
  process.exit(build.status || 1);
}
const bytes = await readFile(output);
const module = await WebAssembly.compile(bytes);
if (WebAssembly.Module.imports(module).length) throw new Error("The kernel must have no runtime imports.");
const hash = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(resolve(rust, "build-manifest.json"), `${JSON.stringify({
  schema: 1,
  compiler: version.stdout.trim(),
  source: "src/instruments/wasm-garden/rust/kernel.rs",
  output: "assets/wasm/wasm-garden.wasm",
  flags,
  sourceSha256: hash(await readFile(source)),
  wasmSha256: hash(bytes),
  wasmBytes: bytes.length,
}, null, 2)}\n`);
console.log(`Built assets/wasm/wasm-garden.wasm (${bytes.length} bytes) with ${version.stdout.trim()}`);
