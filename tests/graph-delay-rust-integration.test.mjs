import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readVectorFractalsSiteReference as readFile } from "./helpers/vector-fractals-site-reference.mjs";
import { TOOL_GROUPS, FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/instruments/wax/wax-instrument-roles.js";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";
import { graphDelayRustSiteAdditions, restoreGraphDelayRustSite } from "./helpers/graph-delay-rust-site-reference.mjs";
import { restoreFractalDelaySite } from "./helpers/fractal-delay-site-reference.mjs";
import { restoreMidiophiliaRename } from "./helpers/midiophilia-rename-reference.mjs";

test("Graph Delay Rust is a separate processor beside Graph Delay with truthful browser capabilities", () => {
  const tools = TOOL_GROUPS.find(group => group.id === "audio-effect").tools;
  const original = tools.findIndex(tool => tool.id === "graph-delay");
  assert.equal(tools[original + 1].id, "graph-delay-rust");
  assert.equal(tools[original].href, "graph-delay.html");
  assert.ok(CANONICAL_PAGE_ROUTES.includes("graph-delay-rust.html"));
  assert.equal(FAVE_TOOL_IDS.includes("graph-delay-rust"), false);
  const instrument = instrumentById("graph-delay-rust");
  assert.equal(instrument.imageHref, "assets/instruments/graph-delay.webp");
  assert.match(instrument.description, /Rust WebAssembly.*WebGL/);
  assert.deepEqual(instrument.tags.map(tag => tag.id), ["audio-effect", "graph", "delay"]);
  const capability = instrumentMidiCapabilityForId("graph-delay-rust");
  assert.equal(capability.noteMode, "processor");
  assert.equal(capability.audioInput, true);
  assert.equal(capability.startsAudio, false);
  assert.equal(capability.computerKeyboardMode, "page");
  const wax = waxSupportForId("graph-delay-rust");
  assert.equal(wax.available, false);
  assert.deepEqual(wax.roles, []);
  assert.match(wax.caveat, /does not connect to WAX audio buses/);
});

test("Graph Delay Rust metadata additions reverse exactly and preserve historical source", async () => {
  for (const change of graphDelayRustSiteAdditions) {
    const source = restoreMidiophiliaRename(
      await readFile(new URL(`../${change.file}`, import.meta.url), "utf8"), change.file,
    );
    const restored = restoreGraphDelayRustSite(source, change.file);
    // Main independently added Fractal Delay and renamed Midiophilia after this frozen reference.
    const historical = restoreFractalDelaySite(restored, change.file);
    assert.equal(createHash("sha256").update(historical).digest("hex"), change.sha256, change.file);
    assert.equal(restoreGraphDelayRustSite(restored, change.file, { allowRestored: true }), restored);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreGraphDelayRustSite(source.replace(after, ""), change.file), /exact Graph Delay Rust amendment/);
      assert.throws(() => restoreGraphDelayRustSite(source + after, change.file), /exact Graph Delay Rust amendment/);
    }
    assert.notEqual(createHash("sha256").update(restoreFractalDelaySite(
      restoreGraphDelayRustSite(source + "\n// unrelated\n", change.file), change.file,
    )).digest("hex"), change.sha256);
  }
});
