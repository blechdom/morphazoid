import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  globuleDamacySiteChanges, restoreGlobuleDamacySite,
} from "./helpers/globule-damacy-site-reference.mjs";
import { restoreOculoidSite } from "./helpers/oculoid-site-reference.mjs";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { INSTRUMENTS, LABS, instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/instruments/wax/wax-instrument-roles.js";
import { CANONICAL_PAGE_ROUTES, pageSourcePath } from "../src/pages/manifest.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { refreshRolloutStatus } from "../scripts/presets/rollout-status.mjs";
import { restoreWitchesBrewRefresh } from "./helpers/witches-brew-refresh-reference.mjs";

const root = new URL("../", import.meta.url), id = "globule-damacy";
const sha = source => createHash("sha256").update(source).digest("hex");

test("Globule Damacy's exact metadata amendments reverse to the untouched main files", async () => {
  assert.equal(globuleDamacySiteChanges.schemaVersion, 1);
  assert.deepEqual(globuleDamacySiteChanges.changes.map(change => change.file), [
    "src/site/instrument-registry.js", "src/site/instrument-catalog.js",
    "src/site/catalogue-taxonomy.js", "src/site/instrument-midi-capabilities.js",
  ]);
  for (const change of globuleDamacySiteChanges.changes) {
    const current = restoreWitchesBrewRefresh(restoreOculoidSite(
      await readFile(new URL(change.file, root), "utf8"),
      change.file, { allowRestored: true },
    ), change.file);
    const restored = restoreGlobuleDamacySite(current, change.file);
    assert.equal(sha(restored), change.sha256, `${change.file}: previous metadata preserved byte-for-byte`);
    assert.doesNotMatch(restored, /globule-damacy/);
    for (const replacement of change.replacements) {
      assert.match(replacement.after, /globule-damacy/);
      assert.throws(() => restoreGlobuleDamacySite(current.replace(replacement.after, ""), change.file),
        /exact Globule Damacy amendment/);
      assert.throws(() => restoreGlobuleDamacySite(current + replacement.after, change.file),
        /exact Globule Damacy amendment/);
    }
    assert.notEqual(sha(restoreGlobuleDamacySite(current + "\n// drift\n", change.file)), change.sha256);
  }
  assert.equal(restoreGlobuleDamacySite("untouched", "unrelated.js"), "untouched");
});

test("Globule's public route, runtime inventory, overview and icon attribution leave main intact", async () => {
  assert.deepEqual(globuleDamacySiteChanges.sharedChanges.map(change => change.file), [
    "src/pages/manifest.js", "scripts/site/runtime-files.tsv",
    "README.md", "assets/instruments/CATALOGUE_LOGOS.md",
  ]);
  for (const change of globuleDamacySiteChanges.sharedChanges) {
    const current = restoreWitchesBrewRefresh(restoreOculoidSite(
      await readFile(new URL(change.file, root), "utf8"),
      change.file, { allowRestored: true },
    ), change.file);
    const restored = restoreGlobuleDamacySite(current, change.file);
    assert.equal(sha(restored), change.sha256, `${change.file}: preceding main bytes preserved`);
    assert.doesNotMatch(restored, /globule-damacy/i);
    assert.equal(restoreGlobuleDamacySite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreGlobuleDamacySite(current.replace(change.addition, ""), change.file),
      /exact Globule Damacy addition/);
    assert.throws(() => restoreGlobuleDamacySite(current + change.addition, change.file),
      /exact Globule Damacy addition/);
    assert.notEqual(sha(restoreGlobuleDamacySite(current + "\n// drift\n", change.file)), change.sha256);
  }
});

test("the WIP rolling sampler remains separate from Groove Globe and declares local mic input", async () => {
  const groups = TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === id));
  assert.deepEqual(groups.map(group => group.id), ["wip"]);
  const item = instrumentById(id);
  assert.ok(item);
  assert.equal(instrumentById("groove-globe"), null, "unpublished Groove Globe stays outside this change");
  assert.equal(item.status, "Work in Progress");
  assert.equal(INSTRUMENTS.filter(entry => entry.id === id).length, 1);
  assert.equal(LABS.some(entry => entry.id === id), false);
  assert.deepEqual(item.tags.map(tag => tag.id), ["wip", "looper", "instrument"]);
  assert.ok(item.features.includes("Sample collage") && item.features.includes("Audio file")
    && item.features.includes("Microphone") && item.features.includes("Grain size"));
  assert.ok(!item.features.includes("WebGL"));
  const fixture = JSON.parse(await readFile(new URL("tests/fixtures/catalogue-globule-damacy.json", root))).additions;
  assert.deepEqual(fixture, [{
    id, label: item.label, href: item.href, imageHref: item.imageHref,
    categoryId: "wip", categoryLabel: "Work in Progress", tags: item.tags.slice(1),
  }]);
  assert.deepEqual(instrumentMidiCapabilityForId(id), {
    id, midiInput: true, midiInputMode: "universal-control", noteMode: "sequence",
    audioInput: true, midiOutput: false, startsAudio: true, computerKeyboardMode: "none",
  });
  const wax = waxSupportForId(id);
  assert.deepEqual(wax.roles, ["instrument", "audio-fx"]);
  assert.equal(wax.hostSync, false);

  const status = JSON.parse(await readFile(new URL("docs/preset-rollout-status.json", root)));
  assert.deepEqual(refreshRolloutStatus(status), status);
  const entry = status.entries.find(candidate => candidate.id === id);
  assert.equal(entry.scope, "deferred-wip");
  assert.equal(entry.status, "deferred");
  assert.equal(entry.presets, null);
  assert.ok(status.queues.deferred.includes(id));
});

test("one authored page ships the two phases, modules, local-only docs and an original 512px icon", async () => {
  assert.ok(CANONICAL_PAGE_ROUTES.includes("globule-damacy.html"));
  assert.equal(pageSourcePath("globule-damacy.html"), "src/pages/globule-damacy.html");
  const html = await readFile(new URL(pageSourcePath("globule-damacy.html"), root), "utf8");
  assert.match(html, /id="recordTab"/);
  assert.match(html, /id="playTab"/);
  assert.match(html, /id="stageCanvas"[^>]*tabindex="0"/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="playButton"[^>]*data-primary-transport/);
  assert.match(html, /id="sourceInput"[^>]*type="file"/);
  assert.match(html, /id="sourceInput"[^>]*multiple/);
  for (const id of ["grainSize", "grainMode", "grainSpread", "recordPreset", "playPreset",
    "layerTransparency", "layerTransparencyOut",
    "floorRemaining", "sampleSelect", "useSampleButton", "micButton"])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /Roll sideways|01 \/ Record|02 \/ Play|01 \/ ROLL/);
  assert.match(html, /id="playButton" class="play-button"[^>]*data-primary-transport/);
  assert.match(html, /src\/instruments\/globule-damacy\/app\.js/);
  assert.doesNotMatch(html, /morphazoid-wax-bootstrap|location\.replace\(/);
  const inventory = await readRuntimeManifest();
  const required = [...["model.js", "presets.js", "sources.js", "audio.js", "view.js", "app.js",
    "globule-damacy.css"].map(name => `src/instruments/globule-damacy/${name}`),
  "assets/instruments/globule-damacy.webp", "docs/globule-damacy.md"];
  for (const path of required) {
    assert.ok(inventory.worktreeFiles.includes(path), `${path}: pre-commit inclusion`);
    assert.ok(inventory.requiredFiles.includes(path), `${path}: release requirement`);
    assert.ok((await stat(new URL(path, root))).isFile(), path);
  }
  const icon = await readFile(new URL(instrumentById(id).imageHref, root));
  assert.ok(icon.length > 1000);
  assert.equal(icon.toString("ascii", 0, 4), "RIFF");
  assert.equal(icon.toString("ascii", 8, 12), "WEBP");
  assert.equal(icon.readUInt16LE(26) & 0x3fff, 512);
  assert.equal(icon.readUInt16LE(28) & 0x3fff, 512);
  const docs = await readFile(new URL("docs/globule-damacy.md", root), "utf8");
  assert.match(docs, /Refresh|refresh/);
  assert.match(docs, /does \*\*not\*\* yet save/);
});
