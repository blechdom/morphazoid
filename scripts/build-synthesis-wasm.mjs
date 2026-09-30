import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { SYNTHESIS_METHODS as METHODS, PROCESSOR_METHODS, PARAMETER_COUNT } from "../src/instruments/synthesis/catalog.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const rust = path.join(root, "src/instruments/synthesis/rust");
const f32 = value => Number.isInteger(value) ? `${value}.0` : String(value);
const string = value => JSON.stringify(value);
const data = `// Generated from catalog.js. Do not edit.\n`
  + `pub const METHOD_NAMES: [&str; ${METHODS.length}] = [${METHODS.map(m => string(m.label)).join(",")}];\n`
  + `pub const METHOD_IDS: [&str; ${METHODS.length}] = [${METHODS.map(m => string(m.id)).join(",")}];\n`
  + `pub const METHOD_STRUCK: [bool; ${METHODS.length}] = [${METHODS.map(m => m.playStyle === "strike").join(",")}];\n`
  + `pub const PARAM_NAMES: [[&str; ${PARAMETER_COUNT}]; ${METHODS.length}] = [${METHODS.map(m => `[${Array.from({ length: PARAMETER_COUNT }, (_, i) => string(m.controls[i]?.label || "Unused")).join(",")}]`).join(",")}];\n`
  + `pub const PARAM_COUNTS: [usize; ${METHODS.length}] = [${METHODS.map(m => m.controls.length).join(",")}];\n`
  + `pub static PRESETS: [[Preset; 8]; ${METHODS.length}] = [\n${METHODS.map(m => `[${m.presets.map(p => `Preset { name: ${string(p.name)}, frequency: ${f32(p.frequencyHz)}, level_trim_db: ${f32(p.levelTrimDb)}, params: [${p.params.map(f32)}], envelope: [${[p.envelope.attack, p.envelope.decay, p.envelope.sustain, p.envelope.release].map(f32)}] }`).join(",\n")} ]`).join(",\n")}\n];\n`;
await mkdir(path.join(rust, "presets/src"), { recursive: true });
await writeFile(path.join(rust, "presets/src/data.rs"), data);
const processingData = `// Generated from the processing catalog. Do not edit.\n`
  + `pub const PROCESSOR_NAMES: [&str; ${PROCESSOR_METHODS.length}] = [${PROCESSOR_METHODS.map(m => string(m.label)).join(",")}];\n`
  + `pub const PROCESSOR_IDS: [&str; ${PROCESSOR_METHODS.length}] = [${PROCESSOR_METHODS.map(m => string(m.id)).join(",")}];\n`
  + `pub const PROCESSOR_PARAM_NAMES: [[&str; 16]; ${PROCESSOR_METHODS.length}] = [${PROCESSOR_METHODS.map(m => `[${Array.from({ length: 16 }, (_, i) => string(m.controls[i]?.label || "Unused")).join(",")}]`).join(",")}];\n`
  + `pub static PROCESSOR_PRESETS: [[ProcessorPreset; 8]; ${PROCESSOR_METHODS.length}] = [\n${PROCESSOR_METHODS.map(m => `[${m.presets.map(p => `ProcessorPreset { name: ${string(p.name)}, params: [${p.params.map(f32)}], source: ${p.source}, frequency: ${f32(p.frequencyHz)}, wet: ${f32(p.wet)}, input_db: ${f32(p.inputDb)}, output_db: ${f32(p.outputDb)} }`).join(",\n")}]`).join(",\n")}\n];\n`;
await writeFile(path.join(rust, "presets/src/processing_data.rs"), processingData);
if (!process.argv.includes("--presets-only")) {
  const result = spawnSync("cargo", ["build", "--manifest-path", path.join(rust, "Cargo.toml"), "-p", "synthesis-core", "--features", "neural", "--target", "wasm32-unknown-unknown", "--release"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
  const assets = path.join(root, "assets/wasm");
  await mkdir(assets, { recursive: true });
  await copyFile(path.join(rust, "target/wasm32-unknown-unknown/release/synthesis_core.wasm"), path.join(assets, "synthesis.wasm"));
  const coreSources = (await readdir(path.join(rust, "core/src"))).filter(name => name.endsWith(".rs")).sort();
  const files = ["src/instruments/synthesis/catalog.js", "src/instruments/synthesis/level-calibration.js", "src/instruments/synthesis/historical-catalog.js", "src/instruments/synthesis/processing-schema.js", "src/instruments/synthesis/processing-catalog.js", ...coreSources.map(name => `src/instruments/synthesis/rust/core/src/${name}`)];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")])));
  const bytes = await readFile(path.join(assets, "synthesis.wasm"));
  await writeFile(path.join(assets, "synthesis-build.json"), JSON.stringify({ abi: 2, parameters: PARAMETER_COUNT, methods: METHODS.length, processors: PROCESSOR_METHODS.length, processorPresets: PROCESSOR_METHODS.reduce((n, m) => n + m.presets.length, 0), presets: METHODS.reduce((n, m) => n + m.presets.length, 0), wasmSha256: createHash("sha256").update(bytes).digest("hex"), sourceHashes }, null, 2) + "\n");
  console.log(`Built Rust synthesis engine: ${bytes.length} bytes, ${METHODS.length} methods.`);
}
