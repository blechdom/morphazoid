import { restorePresetToolbar } from "./helpers/preset-toolbar-reference.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { restoreIphoneStartup } from "./helpers/iphone-startup-reference.mjs";

const amendments = JSON.parse(await readFile(new URL("../docs/iphone-navigation-runtime-changes.json", import.meta.url)));

test("rebase navigation amendments identify the fetched feature and existing regression evidence", async () => {
  assert.equal(amendments.baseCommit, "9a45aa0ac6ea35d2086186bcc88313b6f3a735da");
  assert.equal(amendments.featureCommit, "ef6e5939ef4de26471010b33dd7c1aaddf9a7f85");
  assert.deepEqual(amendments.changes.map(change => change.file), ["nav.js"]);
  for (const change of amendments.changes) {
    for (const file of change.regressionTests) await readFile(new URL(`../${file}`, import.meta.url));
    for (const replacement of change.replacements) {
      assert.ok(replacement.before.length && replacement.after.length);
      assert.notEqual(replacement.before, replacement.after);
    }
  }
});

test("reference normalization reverses exact amendments, not missing or duplicate blocks", async () => {
  const source = restorePresetToolbar(await readFile(new URL("../nav.js", import.meta.url), "utf8"), "nav.js");
  const restored = restoreIphoneStartup(source, "nav.js");
  assert.notEqual(restored, source);
  assert.doesNotMatch(restored, /initializeAudioSessionPolicy/);
  const block = amendments.changes[0].replacements[0].after;
  assert.throws(() => restoreIphoneStartup(source.replace(block, ""), "nav.js"));
  assert.throws(() => restoreIphoneStartup(source + block, "nav.js"));
  assert.equal(restoreIphoneStartup("untouched", "unrelated.js"), "untouched");
});
