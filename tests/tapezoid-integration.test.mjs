import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/instruments/wax/wax-instrument-roles.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { restoreTapezoidSite } from "./helpers/tapezoid-site-reference.mjs";

test("Tapezoid is a complete WIP route with honest audio/MIDI classification", async () => {
  assert.ok(CANONICAL_PAGE_ROUTES.includes("tapezoid.html"));
  const tool = TOOL_GROUPS.flatMap(group => group.tools).find(item => item.id === "tapezoid");
  const catalogue = instrumentById("tapezoid");
  assert.equal(tool?.href, "tapezoid.html");
  assert.equal(tool?.imageHref, "assets/instruments/tapezoid.webp");
  assert.deepEqual(catalogue.tags.map(tag => tag.id), ["wip", "3d", "graphic-ui"]);
  assert.equal(catalogue.status, "Work in Progress");
  assert.match(catalogue.description, /original or local audio/);
  assert.match(catalogue.description, /draw several turns across the desk in one stroke/);
  assert.match(catalogue.description, /Reich-inspired two\/four\/eight/);
  assert.match(catalogue.description, /Bundled CC BY-SA 4\.0 artist cassette by joshtmc/);
  assert.match(catalogue.description, /No microphone recording/);
  assert.deepEqual(instrumentMidiCapabilityForId("tapezoid"), {
    id: "tapezoid", midiInput: true, midiInputMode: "universal-control",
    noteMode: "processor", audioInput: false, midiOutput: false,
    startsAudio: true, computerKeyboardMode: "none",
  });
  const wax = waxSupportForId("tapezoid");
  assert.equal(wax.recommended, "instrument");
  assert.deepEqual(wax.roles, ["instrument"]);
  assert.equal(wax.audioInput, false);
  assert.match(wax.caveat, /works in progress/);
  const html = await readFile(new URL("../src/pages/tapezoid.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /data-audio-output-meter/);
  assert.match(html, /<aside class="panel tapezoid-panel" data-instrument-preset-host aria-label="Tapezoid controls">/);
  assert.match(html, /data-space-key-owner/);
  assert.match(html, /id="bundledCassette"/);
  assert.match(html, /Cassette Tape by joshtmc/);
  assert.match(html, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
  assert.doesNotMatch(html, /wax-page\.js|wax-bootstrap/);
  const icon = await readFile(new URL("../assets/instruments/tapezoid.webp", import.meta.url));
  assert.equal(icon.toString("ascii", 0, 4), "RIFF");
  assert.equal(icon.toString("ascii", 8, 12), "WEBP");
  assert.ok(icon.length > 1000);
  const manifest = await readRuntimeManifest();
  for (const file of [
    "src/instruments/tapezoid/tapezoid-app.js", "src/instruments/tapezoid/artist-cassette.js",
    "src/instruments/tapezoid/path.js",
    "src/instruments/tapezoid/demo-material.js", "src/instruments/tapezoid/full-presets.js",
    "src/instruments/tapezoid/tapezoid-processor.js", "src/instruments/tapezoid/tapezoid.css",
    "assets/instruments/tapezoid.webp", "assets/tapezoid/cassette-tape.glb",
    "assets/tapezoid/cassette-tape.LICENSE.txt", "docs/tapezoid.md",
  ]) assert.ok(manifest.requiredFiles.includes(file), file);
});

test("the bundled downloaded GLB carries its own attributable artist mesh and embedded textures", async () => {
  const model = await readFile(new URL("../assets/tapezoid/cassette-tape.glb", import.meta.url));
  assert.equal(createHash("sha256").update(model).digest("hex"),
    "19f27f4eb2b0c5463623dd1479fee7e6874c3b8f2df88bd022f28ef325009668");
  assert.equal(model.toString("ascii", 0, 4), "glTF");
  assert.equal(model.readUInt32LE(8), model.length);
  assert.equal(model.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(model.toString("utf8", 20, 20 + model.readUInt32LE(12)));
  assert.equal(gltf.asset.extras.author, "joshtmc (https://sketchfab.com/joshtmc)");
  assert.equal(gltf.asset.extras.title, "Cassette Tape");
  assert.equal(gltf.asset.extras.source,
    "https://sketchfab.com/3d-models/cassette-tape-4613411c569d4185a2e07f31b1bf9e49");
  assert.match(gltf.asset.extras.license, /CC-BY-SA-4\.0/);
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.images.length, 3);
  assert.equal(gltf.accessors[0].count, 3837);
  assert.equal(gltf.animations, undefined);
  const credit = await readFile(new URL("../assets/tapezoid/cassette-tape.LICENSE.txt", import.meta.url), "utf8");
  assert.match(credit, /Cassette Tape.*joshtmc/);
  assert.match(credit, /Creative Commons Attribution-ShareAlike 4\.0/);
  assert.match(credit, /19f27f4eb2b0c5463623dd1479fee7e6874c3b8f2df88bd022f28ef325009668/);
});

test("older frozen site references reverse only the exact Tapezoid additions", async () => {
  for (const file of [
    "src/site/instrument-registry.js", "src/site/instrument-catalog.js",
    "src/site/catalogue-taxonomy.js", "src/site/instrument-midi-capabilities.js",
    "src/pages/manifest.js", "scripts/site/runtime-files.tsv",
    "README.md", "docs/THIRD_PARTY_NOTICES.md",
  ]) {
    const current = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const restored = restoreTapezoidSite(current, file);
    assert.notEqual(restored, current, file);
    assert.equal(restoreTapezoidSite(restored, file, { allowRestored: true }), restored);
    assert.throws(() => restoreTapezoidSite(restored, file), /exact Tapezoid addition/);
    assert.ok(restoreTapezoidSite(`${current}\n// unrelated drift\n`, file).endsWith("\n// unrelated drift\n"));
    assert.equal(restoreTapezoidSite(current, "unrelated.js"), current);
  }
  const registry = await readFile(new URL("../src/site/instrument-registry.js", import.meta.url), "utf8");
  assert.throws(() => restoreTapezoidSite(`${registry}    { id: "tapezoid", label: "Tapezoid", href: "tapezoid.html", picker: true, imageHref: "assets/instruments/tapezoid.webp" },\n`,
    "src/site/instrument-registry.js"), /exact Tapezoid addition/);
});
