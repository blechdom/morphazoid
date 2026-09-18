import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const defaultManifest = new URL("./runtime-files.tsv", import.meta.url);
const policies = new Set(["copy", "require", "copy+require"]);

/**
 * Explicit additions to the builder's tracked-file/glob rules, not a complete
 * list of public assets. A path occurs once, with its two independent policies.
 */
export function parseRuntimeManifest(text, source = "runtime manifest") {
  if (typeof text !== "string") throw new TypeError(`${source}: expected text`);
  const entries = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const fail = message => { throw new Error(`${source}:${index + 1}: ${message}`); };
    const fields = line.split("\t");
    if (fields.length !== 2) fail("expected policy<TAB>repository-relative-path");
    const [policy, file] = fields;
    if (!policies.has(policy)) fail(`unknown policy "${policy}"`);
    if (
      !file || file !== file.trim() || /[\\\u0000-\u001f\u007f]/u.test(file)
      || /^[A-Za-z]:/u.test(file)
      || file.split("/").some(part => !part || part === "." || part === "..")
    ) fail(`invalid repository-relative path "${file}"`);
    if (seen.has(file)) fail(`duplicate path "${file}"`);
    seen.add(file);
    entries.push(Object.freeze({
      path: file,
      policy,
      copy: policy !== "require",
      required: policy !== "copy",
    }));
  }
  if (!entries.length) throw new Error(`${source}: no runtime entries`);
  return Object.freeze({
    entries: Object.freeze(entries),
    worktreeFiles: Object.freeze(entries.filter(entry => entry.copy).map(entry => entry.path)),
    requiredFiles: Object.freeze(entries.filter(entry => entry.required).map(entry => entry.path)),
  });
}

export async function readRuntimeManifest(file = defaultManifest) {
  return parseRuntimeManifest(await readFile(file, "utf8"), String(file));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const inventory = await readRuntimeManifest(process.argv[2] ?? defaultManifest);
  // Validation must finish before any output: the shell checks this command's
  // status rather than hiding a failed reader inside process substitution.
  process.stdout.write(inventory.entries.map(entry => `${entry.policy}\t${entry.path}`).join("\n") + "\n");
}
