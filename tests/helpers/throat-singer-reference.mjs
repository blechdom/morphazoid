import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const amendments = JSON.parse(readFileSync(
  new URL("../../docs/throat-singer-runtime-changes.json", import.meta.url), "utf8",
));

// Restore the redesigned view before peeling the earlier preset-only rollout.
// Nested historical readers may already have restored either earlier version.
export function restoreThroatSingerView(source, file) {
  const change = amendments.changes.find(change => change.file === file
    && change.normalizationStage === "before-header-presets");
  if (!change) return source;
  if (!source.includes(change.marker)) return source;
  for (const replacement of [...change.replacements].reverse()) {
    assert.equal(source.split(replacement.after).length - 1, 1,
      `${file}: exact header presets batch amendment (Throat Singer view)`);
    source = source.replace(replacement.after, () => replacement.before);
  }
  return source;
}

// Restore the later owner rename before comparing earlier feature references.
export function restoreThroatSingerMetadata(source, file, { allowRestored = false } = {}) {
  if (file !== "src/site/instrument-registry.js") return source;
  const change = amendments.changes.find(change => change.file === file);
  for (const replacement of change.replacements) {
    if (!source.includes(replacement.after)) {
      if (allowRestored) continue;
      assert.equal(source.split(replacement.before).length - 1, 1, "exact Throat Singer metadata amendment");
      continue;
    }
    assert.equal(source.split(replacement.after).length - 1, 1, "exact Throat Singer metadata amendment");
    source = source.replace(replacement.after, replacement.before);
  }
  return source;
}
