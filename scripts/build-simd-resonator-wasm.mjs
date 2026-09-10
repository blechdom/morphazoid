import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(process.argv[2] || join(repositoryRoot, "assets", "wasm"));
const compiler = join(repositoryRoot, "node_modules", "assemblyscript", "bin", "asc.js");

const builds = [
  {
    source: "src/simd-resonator-scalar.ts",
    output: "simd-resonator-scalar.wasm",
    options: [],
    memoryPages: 4,
  },
  {
    source: "src/simd-resonator-simd.ts",
    output: "simd-resonator-simd.wasm",
    options: ["--enable", "simd"],
    memoryPages: 4,
  },
  {
    source: "src/simd-303-scalar.ts",
    output: "simd-303-scalar.wasm",
    options: [],
    memoryPages: 16,
  },
  {
    source: "src/simd-303-simd.ts",
    output: "simd-303-simd.wasm",
    options: ["--enable", "simd"],
    memoryPages: 16,
  },
];

await mkdir(outputRoot, { recursive: true });

for (const build of builds) {
  const result = spawnSync(process.execPath, [
    compiler,
    join(repositoryRoot, build.source),
    "--outFile",
    join(outputRoot, build.output),
    "--runtime",
    "stub",
    "--optimize",
    "--noAssert",
    "--initialMemory",
    String(build.memoryPages),
    "--maximumMemory",
    String(build.memoryPages),
    ...build.options,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
}
