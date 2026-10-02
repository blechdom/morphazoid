import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const amendments = JSON.parse(readFileSync(
  new URL("../../docs/throat-singer-runtime-changes.json", import.meta.url), "utf8",
));

// Restore the later owner rename before comparing earlier feature references.
export function restoreThroatSingerMetadata(source, file) {
  if (file !== "src/site/instrument-registry.js") return source;
  const change = amendments.changes.find(change => change.file === file);
  for (const replacement of change.replacements) {
    if (!source.includes(replacement.after)) {
      assert.equal(source.split(replacement.before).length - 1, 1, "exact Throat Singer metadata amendment");
      continue;
    }
    assert.equal(source.split(replacement.after).length - 1, 1, "exact Throat Singer metadata amendment");
    source = source.replace(replacement.after, replacement.before);
  }
  return source;
}
