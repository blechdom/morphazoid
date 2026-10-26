import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readGlobuleDamacySiteReference as readFile } from "./helpers/globule-damacy-site-reference.mjs";
import test from "node:test";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { FAVE_TOOL_IDS, TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { TAP_TEMPO_TARGETS } from "../src/site/tap-tempo-targets.js";
import { restoreRezoidinatorModesSite } from "./helpers/rezoidinator-modes-site-reference.mjs";
import { restoreWitchSite, witchSiteChanges } from "./helpers/witch-site-reference.mjs";
import { restoreSelectedInstrumentRecovery } from "./helpers/selected-instrument-recovery-reference.mjs";
import { restoreQuadrupedFaves } from "./helpers/quadruped-faves-reference.mjs";
import { restoreTimeLoomSite } from "./helpers/time-loom-site-reference.mjs";
import { restoreWitchesBrewFaves, witchesBrewFavesAmendment } from "./helpers/witches-brew-faves-reference.mjs";
import { restoreOculoidSite } from "./helpers/oculoid-site-reference.mjs";

const root = new URL("../", import.meta.url);
const digest = source => createHash("sha256").update(source).digest("hex");
const retiredWitchTapFiles = new Set(["src/site/tap-tempo-targets.js", "docs/tap-tempo-controls.json", "docs/tap-tempo-controls.md"]);

test("Witches Brew leads Faves as a gesture instrument with shared MIDI controls and no generic note keyboard", () => {
  const item = instrumentById("witch");
  assert.equal(item.label, "Witches Brew");
  assert.equal(item.href, "witch.html");
  assert.equal(item.imageHref, "assets/instruments/witch.webp");
  assert.equal(item.status, null);
  assert.equal(FAVE_TOOL_IDS[0], "witch");
  assert.equal(FAVE_TOOL_IDS.filter(id => id === "witch").length, 1);
  assert.deepEqual(item.tags.map(tag => tag.id), ["voice", "graphic-ui", "synthesizer", "faves"]);
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === "witch")).map(group => group.id), ["voice"]);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.equal(item.features.includes("Computer keys"), false);
  assert.deepEqual(instrumentMidiCapabilityForId("witch"), {
    id: "witch", midiInput: true, midiInputMode: "universal-control",
    noteMode: "processor", audioInput: false, midiOutput: false,
    startsAudio: true, computerKeyboardMode: "none",
  });
});

test("Witches Brew picture controls leave no retired slider Tap targets in the shared registry", () => {
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(({ route }) => route === "witch.html"), []);
  const inventory = JSON.parse(readFileSync(new URL("docs/tap-tempo-controls.json", root), "utf8"));
  assert.deepEqual(inventory.confirmed.filter(({ route }) => route === "witch"), []);
  const page = readFileSync(new URL("src/pages/witch.html", root), "utf8");
  assert.doesNotMatch(page, /id=["'](?:witchParameters|handRate|catSpeed|ghostTempo|speed|flightSpeed)["']/);
});

test("Witch additions preserve the preceding shared source and expose unknown drift", async () => {
  assert.match(witchSiteChanges.baseCommit, /^[0-9a-f]{40}$/);
  for (const change of witchSiteChanges.changes) {
    // Oculoid and the later Faves promotion have independent, exact proofs.
    const promoted = restoreWitchesBrewFaves(restoreOculoidSite(
      await readFile(new URL(change.file, root), "utf8"),
      change.file, { allowRestored: true },
    ), change.file, { allowRestored: true });
    const current = restoreSelectedInstrumentRecovery(promoted, change.file, { allowRestored: true });
    let source = restoreRezoidinatorModesSite(restoreTimeLoomSite(restoreQuadrupedFaves(current, change.file, { allowRestored: true }), change.file, { allowRestored: true }), change.file, { allowRestored: true });
    if (retiredWitchTapFiles.has(change.file)) {
      // Retiring the slider UI restores these exact earlier shared files.
      // Keep the old amendment's strict rejection checks below on its
      // reconstructed historical form, while pinning today's source here.
      assert.equal(digest(source), change.sha256, `${change.file}: exact retired Tap baseline`);
      for (const { before, after } of change.replacements) {
        assert.equal(source.includes(after), false, `${change.file}: retired rows stay absent`);
        assert.equal(source.split(before).length - 1, 1, `${change.file}: unique retired insertion point`);
        source = source.replace(before, () => after);
      }
    }
    const restored = restoreWitchSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreWitchSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWitchSite(restored, change.file), /exact Witch site amendment/);
    let reapplied = restored;
    for (const { before, after } of change.replacements) {
      assert.equal(reapplied.split(before).length - 1, 1, `${change.file}: unique insertion point`);
      reapplied = reapplied.replace(before, () => after);
      assert.throws(() => restoreWitchSite(source.replace(after, () => before), change.file), /exact Witch site amendment/);
      assert.throws(() => restoreWitchSite(source + after, change.file), /exact Witch site amendment/);
      assert.throws(() => restoreWitchSite(source.replace(after, () => after.replace("witch", "unreviewed")), change.file), /exact Witch site amendment/);
    }
    assert.equal(reapplied, source);
    const drift = "\n// unrelated source drift\n";
    assert.equal(restoreWitchSite(source + drift, change.file), restored + drift);
    assert.notEqual(digest(restoreWitchSite(source + drift, change.file)), change.sha256);
  }
  const binary = Buffer.from("raw bytes");
  assert.equal(restoreWitchSite(binary, "src/pages/manifest.js"), binary);
  assert.equal(restoreWitchSite("untouched", "unrelated.js"), "untouched");
});

test("Witches Brew promotion preserves the prior registry and rejects incomplete or duplicated moves", () => {
  const change = witchesBrewFavesAmendment;
  const source = readFileSync(new URL(change.file, root), "utf8");
  const restored = restoreWitchesBrewFaves(source, change.file);
  assert.equal(digest(restoreOculoidSite(restored, change.file)), change.sha256);
  assert.equal(restoreWitchesBrewFaves(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreWitchesBrewFaves(restored, change.file), /exact Witches Brew Faves amendment/);
  for (const { after } of change.replacements) {
    assert.throws(() => restoreWitchesBrewFaves(source.replace(after, ""), change.file), /exact Witches Brew Faves amendment/);
    assert.throws(() => restoreWitchesBrewFaves(source + after, change.file), /exact Witches Brew Faves amendment/);
  }
  const drift = "\n// unrelated registry drift\n";
  assert.equal(restoreWitchesBrewFaves(source + drift, change.file), restored + drift);
  assert.notEqual(digest(restoreOculoidSite(
    restoreWitchesBrewFaves(source + drift, change.file), change.file,
  )), change.sha256);
});
