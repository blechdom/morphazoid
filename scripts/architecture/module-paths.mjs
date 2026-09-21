import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const slash = path.posix;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Resolve resource paths only; processor names, storage keys and code stay intact. */
export function relocateReference(reference, from, moves, { exists = file => existsSync(path.join(root, file)) } = {}) {
  if (!reference || reference === "/" || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return reference;
  const split = reference.search(/[?#]/);
  const pathname = split < 0 ? reference : reference.slice(0, split);
  const suffix = split < 0 ? "" : reference.slice(split);
  const absolute = pathname.startsWith("/");
  const repoRelative = /^(?:src|assets|vendor|scripts)\//.test(pathname);
  const relative = pathname.startsWith(".");
  if (!absolute && !repoRelative && !relative) return reference;
  const target = slash.normalize(absolute ? pathname.slice(1) : repoRelative ? pathname : slash.join(slash.dirname(from), pathname));
  if (target.startsWith("../")) return reference;
  const destination = moves[target] ?? target;
  if (!moves[target] && !exists(target)) return reference;
  if (absolute) return `/${destination}${suffix}`;
  if (repoRelative) return `${destination}${suffix}`;
  const newFrom = moves[from] ?? from;
  if (newFrom === from && destination === target) return reference;
  let output = slash.relative(slash.dirname(newFrom), destination) || ".";
  if (!output.startsWith(".")) output = `./${output}`;
  if (pathname.endsWith("/") && !output.endsWith("/")) output += "/";
  return output + suffix;
}

export function rewriteModulePaths(source, from, moves, options) {
  // Literal paths and template prefixes are handled without parsing/reprinting
  // surrounding JS: whitespace, algorithms and shader text remain byte-stable.
  return source.replace(/(["'`])((?:\.{1,2}\/|\/|src\/|assets\/|vendor\/|scripts\/)[^"'`\s]*)(?=\1)/g, (whole, quote, reference) => {
    const expression = reference.indexOf("${");
    if (expression < 0 || (reference.includes("?") && reference.indexOf("?") < expression)) {
      return quote + relocateReference(reference, from, moves, options);
    }
    const boundary = reference.lastIndexOf("/", expression);
    if (boundary < 0) return whole;
    const prefix = reference.slice(0, boundary + 1);
    return quote + relocateReference(prefix, from, moves, options) + reference.slice(boundary + 1);
  });
}

/** Repository-relative paths in manifests, prose, fixtures and test patterns. */
export function rewriteRepositoryPaths(source, moves) {
  const keys = Object.keys(moves).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\w/-])(?:${keys.map(escape).join("|")})(?![\\w.-])`, "g");
  return source.replace(pattern, old => moves[old]);
}
