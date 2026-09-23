import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const pointerReference = JSON.parse(readFileSync(
  new URL("../fixtures/pointer-coordinates-v1.json", import.meta.url), "utf8",
));

/** Reverse only this checked, behavior-equivalent extraction for older proofs. */
export function restorePointerExtraction(source, file) {
  const entry = pointerReference.entries.find(entry => entry.file === file);
  if (!entry) return source;
  assert.equal(source.split(entry.importLine).length - 1, 1, `${file}: exact helper import`);
  assert.equal(source.split(entry.after).length - 1, 1, `${file}: exact migrated callback`);
  return source.replace(entry.importLine, "").replace(entry.after, entry.before);
}
