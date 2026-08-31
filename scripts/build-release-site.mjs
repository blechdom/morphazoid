import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { buildWaxSite } from "./build-wax-site.mjs";
import { fingerprintHiccupHead } from "./fingerprint-hiccup-head.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildReleaseSite(outputArgument = "dist") {
  const outputDirectory = path.isAbsolute(outputArgument)
    ? path.resolve(outputArgument)
    : path.resolve(repositoryRoot, outputArgument);

  await execFileAsync("bash", ["scripts/build-site.sh", outputDirectory], {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  await fingerprintHiccupHead(outputDirectory);
  const waxResult = await buildWaxSite(path.join(outputDirectory, "dist-wax"));
  return {
    outputDirectory,
    waxHtmlCount: waxResult.htmlCount,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await buildReleaseSite(process.argv[2] || "dist");
  console.log(
    `Built Morphazoid site with ${result.waxHtmlCount} WAX pages in ${result.outputDirectory}`,
  );
}
