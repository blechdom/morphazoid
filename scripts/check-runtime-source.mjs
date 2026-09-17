import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set(["node_modules", "tests", "dist", "dist-wax"]);

export async function runtimeSourceFiles(root = repositoryRoot) {
  const files = new Set([
    "app.js", "nav.js", "wax-page.js", "shader-synth-playground-bootstrap.js",
  ]);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".js")) files.add(entry.name);
  }
  async function visit(relative) {
    let children;
    try {
      children = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of children) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await visit(name);
      else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.add(name);
    }
  }
  await visit("src");
  await visit("scripts");
  await visit("morphazoidical");
  return [...files].sort();
}

export function checkSyntaxFile(file, root = repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", file], {
      cwd: root, stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostic = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { diagnostic += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ file, ok: code === 0, diagnostic }));
  });
}

export async function checkRuntimeSource(root = repositoryRoot) {
  const files = await runtimeSourceFiles(root);
  const results = new Array(files.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (index < files.length) {
      const next = index++;
      results[next] = await checkSyntaxFile(files[next], root);
    }
  }));
  const failures = results.filter((result) => !result.ok);
  for (const failure of failures) console.error(`${failure.file}\n${failure.diagnostic}`);
  console.log(`Parsed ${files.length} JavaScript modules; ${failures.length} syntax failures.`);
  return failures.length === 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await checkRuntimeSource() ? 0 : 1;
}
