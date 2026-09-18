import path from "node:path";

/** A source-relative module/asset reference, independent of controller depth. */
export function relativeReference(fromFile, toFile) {
  const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
