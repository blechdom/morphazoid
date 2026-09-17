import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function runtimeEntries(root = repositoryRoot) {
  const entries = await readdir(root, { withFileTypes: true });
  return [
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort(),
    "src",
    "morphazoidical",
  ];
}

export async function architectureCommand(kind, root = repositoryRoot) {
  const output = path.join(root, "test-results", "architecture");
  if (kind === "duplicates") {
    return {
      output,
      args: [
        path.join(root, "node_modules/jscpd/run-jscpd.js"),
        "--config", "scripts/architecture/jscpd.json",
        "--output", path.join(output, "duplicates"),
        "--workers", "2",
        "--no-colors",
        "--fail-on-empty",
        ...await runtimeEntries(root),
      ],
    };
  }
  if (kind === "dependencies") {
    return {
      output,
      args: [
        path.join(root, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
        "--config", "scripts/architecture/dependency-cruiser.config.mjs",
        "--output-type", "json",
        "--output-to", path.join(output, "dependencies.json"),
        ...await runtimeEntries(root),
      ],
    };
  }
  throw new Error("Usage: node scripts/architecture/report.mjs duplicates|dependencies");
}

export async function runArchitectureReport(kind, root = repositoryRoot) {
  const { args, output } = await architectureCommand(kind, root);
  await mkdir(output, { recursive: true });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) throw new Error(`${kind} report failed (exit ${code}).`);
  console.log(`Report written beneath ${output}. Findings are advisory, not approvals.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runArchitectureReport(process.argv[2]);
}
