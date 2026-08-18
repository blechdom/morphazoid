import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWaxSite } from "./build-wax-site.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const committedDirectory = path.join(repositoryRoot, "dist-wax");

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function compareDirectories(expectedDirectory, actualDirectory) {
  const [expectedFiles, actualFiles] = await Promise.all([
    listFiles(expectedDirectory),
    listFiles(actualDirectory),
  ]);

  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    const expectedSet = new Set(expectedFiles);
    const actualSet = new Set(actualFiles);
    const missing = expectedFiles.filter((file) => !actualSet.has(file));
    const extra = actualFiles.filter((file) => !expectedSet.has(file));
    throw new Error([
      "dist-wax file list is stale.",
      missing.length ? `Missing: ${missing.slice(0, 8).join(", ")}` : "",
      extra.length ? `Extra: ${extra.slice(0, 8).join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  }

  for (const relativePath of expectedFiles) {
    const [expected, actual] = await Promise.all([
      readFile(path.join(expectedDirectory, relativePath)),
      readFile(path.join(actualDirectory, relativePath)),
    ]);
    if (!expected.equals(actual)) {
      throw new Error(`dist-wax is stale: ${relativePath} differs from a clean build`);
    }
  }
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "morphazoid-wax-check-"));
try {
  const cleanBuild = path.join(temporaryRoot, "dist-wax");
  await buildWaxSite(cleanBuild);
  await compareDirectories(cleanBuild, committedDirectory);
  console.log("Committed dist-wax matches a clean build.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
