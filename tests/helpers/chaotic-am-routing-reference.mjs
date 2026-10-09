import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const chaoticAmRoutingAmendments = JSON.parse(readFileSync(
  new URL("../fixtures/chaotic-am-routing-amendments.json", import.meta.url), "utf8",
));

// Peel only the reviewed Chaotic AM DSP-reference changes. Earlier
// preservation hashes continue to describe the exact historical source bytes.
export function restoreChaoticAmRouting(source, file, { allowRestored = false } = {}) {
  for (const change of chaoticAmRoutingAmendments.changes.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, 1, `${file}: exact Chaotic AM routing amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
