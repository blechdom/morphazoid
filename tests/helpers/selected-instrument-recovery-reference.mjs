import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const selectedInstrumentRecoveryChanges = JSON.parse(readFileSync(
  new URL("../../docs/selected-instrument-recovery-runtime-changes.json", import.meta.url), "utf8",
)).changes;

/** Preserve frozen historical evidence while reversing only the recovered instrument changes. */
export function restoreSelectedInstrumentRecovery(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  for (const change of selectedInstrumentRecoveryChanges.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact selected instrument recovery amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
