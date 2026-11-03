import assert from "node:assert/strict";

// Peel later custom-preset additions before older byte-exact 7.1 and header
// rollout proofs. Older content and unrelated drift remain visible.
const additions = new Map([
  ["src/pages/spartial.html", {
    marker: '<div class="spartial-user-presets"',
    edits: [[/      <div class="spartial-user-presets" role="group" aria-label="My presets">[\s\S]*?      <\/div>\n(?=      <section class="spartial-mixer")/, ""]],
  }],
  ["src/instruments/spartial/spartial.css", {
    marker: ".spartial-user-presets {",
    edits: [[/\.spartial-user-presets \{[\s\S]*?(?=\.spartial-recording > div)/, ""]],
  }],
  ["docs/spartial.md", {
    marker: "## My presets",
    edits: [[/## My presets\n[\s\S]*?(?=## Chords and clusters\n)/, ""]],
  }],
  ["src/instruments/spartial/spartial-app.js", {
    marker: "SPARTIAL_USER_PRESETS_KEY",
    edits: [
      [`import {
  SPARTIAL_PRESET_FILE_LIMIT, SPARTIAL_USER_PRESETS_KEY, emptySpartialPresetBank,
  mergeSpartialPresetBanks, parseSpartialPresetBank, removeSpartialUserPreset, saveSpartialUserPreset,
  spartialPresetMenuBank, spartialPresetName, stringifySpartialPresetBank,
} from "./full-presets.js";
`, ""],
      [/^let userBank = emptySpartialPresetBank\(\);[\s\S]*?^  id: "spartial", presets: spartialPresetMenuBank\(userBank\),/m,
        'registerHeaderPresets({\n  id: "spartial", presets: SPARTIAL_FULL_PRESETS,'],
      [/^const presetDownloads = new Map\(\);[\s\S]*?(?=^window.addEventListener\("pagehide", event => \{)/m, ""],
      [`  presetSelectionObserver.disconnect();
  for (const [url, timer] of presetDownloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
  presetDownloads.clear();
`, ""],
    ],
  }],
]);

export function restoreSpartialCustomPresetsSource(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const change = additions.get(file);
  if (!change) return source;
  if (allowRestored && !source.includes(change.marker)) return source;
  for (const [after, before] of change.edits) {
    const count = typeof after === "string"
      ? source.split(after).length - 1
      : [...source.matchAll(new RegExp(after.source, `${after.flags}g`))].length;
    assert.equal(count, 1, `${file}: exact later SPARTIAL preset addition`);
    source = source.replace(after, before);
  }
  return source;
}
