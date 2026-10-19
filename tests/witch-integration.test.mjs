import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readGlobuleDamacySiteReference as readFile } from "./helpers/globule-damacy-site-reference.mjs";
import test from "node:test";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { restoreRezoidinatorModesSite } from "./helpers/rezoidinator-modes-site-reference.mjs";
import { restoreWitchSite, witchSiteChanges } from "./helpers/witch-site-reference.mjs";
import { restoreSelectedInstrumentRecovery } from "./helpers/selected-instrument-recovery-reference.mjs";
import { restoreQuadrupedFaves } from "./helpers/quadruped-faves-reference.mjs";
import { restoreTimeLoomSite } from "./helpers/time-loom-site-reference.mjs";

const root = new URL("../", import.meta.url);
const digest = source => createHash("sha256").update(source).digest("hex");

test("Witch is a WIP gesture instrument with shared MIDI controls and no generic note keyboard", () => {
  const item = instrumentById("witch");
  assert.equal(item.label, "Witch");
  assert.equal(item.href, "witch.html");
  assert.equal(item.imageHref, "assets/instruments/witch.webp");
  assert.equal(item.status, "Work in Progress");
  assert.deepEqual(item.tags.map(tag => tag.id), ["wip", "voice", "graphic-ui", "synthesizer"]);
  assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === "witch")).map(group => group.id), ["wip"]);
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === item.href).length, 1);
  assert.equal(item.features.includes("Computer keys"), false);
  assert.deepEqual(instrumentMidiCapabilityForId("witch"), {
    id: "witch", midiInput: true, midiInputMode: "universal-control",
    noteMode: "processor", audioInput: false, midiOutput: false,
    startsAudio: true, computerKeyboardMode: "none",
  });
});

test("Witch additions preserve the preceding shared source and expose unknown drift", async () => {
  assert.match(witchSiteChanges.baseCommit, /^[0-9a-f]{40}$/);
  for (const change of witchSiteChanges.changes) {
    // Later recovery, Faves, Time Loom, Rezoidinator and mobile additions have independent proofs.
    const current = restoreSelectedInstrumentRecovery(await readFile(new URL(change.file, root), "utf8"), change.file, { allowRestored: true });
    const source = restoreRezoidinatorModesSite(restoreTimeLoomSite(restoreQuadrupedFaves(current, change.file, { allowRestored: true }), change.file, { allowRestored: true }), change.file, { allowRestored: true });
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
