import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "morphazoid-simd-wasm-"));
const artifacts = [
  "simd-resonator-scalar.wasm",
  "simd-resonator-simd.wasm",
  "simd-303-scalar.wasm",
  "simd-303-simd.wasm",
  "simd-synth-scalar.wasm",
  "simd-synth-simd.wasm",
];

try {
  const result = spawnSync(process.execPath, [
    join(repositoryRoot, "scripts", "build-simd-resonator-wasm.mjs"),
    temporary,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }

  for (const artifact of artifacts) {
    const committed = await readFile(join(repositoryRoot, "assets", "wasm", artifact));
    const rebuilt = await readFile(join(temporary, artifact));
    if (!committed.equals(rebuilt)) {
      throw new Error(artifact + " is stale. Run npm run build:simd-wasm.");
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
