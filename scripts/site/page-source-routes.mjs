import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CANONICAL_PAGE_ROUTES,
  PAGE_SOURCE_DIRECTORY,
  pageSourcePath,
} from "../../src/pages/manifest.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function validatePageSources(root = repositoryRoot) {
  const sourceDirectory = path.join(root, PAGE_SOURCE_DIRECTORY);
  const routes = [...CANONICAL_PAGE_ROUTES].sort();
  const actual = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".html"))
    .map(entry => entry.name)
    .sort();
  if (actual.length !== routes.length || actual.some((route, index) => route !== routes[index])) {
    throw new Error("src/pages must contain exactly the canonical page routes from its manifest");
  }
  await Promise.all(routes.map(async route => {
    const source = path.join(root, pageSourcePath(route));
    if (!(await stat(source)).isFile()) throw new Error(`Missing canonical page source: ${route}`);
  }));
  return Object.freeze(routes);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const routes = await validatePageSources();
  process.stdout.write(`${routes.join("\n")}\n`);
}
