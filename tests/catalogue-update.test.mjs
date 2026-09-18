import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { CATALOGUE_ITEMS, CATALOGUE_GROUPS, INSTRUMENTS, LABS, catalogueItemById, instrumentById } from "../src/instrument-catalog.js";
import { FAVE_TOOL_IDS, TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { canonicalInstrumentId, legacyInstrumentId } from "../src/site/instrument-identities.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/wax-instrument-roles.js";

const root = new URL("../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("docs/catalogue-update-decisions.json", root)));
const before = JSON.parse(await readFile(new URL("tests/fixtures/catalogue-before-20260918.json", root)));

test("the owner-confirmed retained IDs and Rattlesnake name remain unchanged", () => {
  assert.equal(catalogueItemById("webgpu-303")?.id, "webgpu-303");
  assert.equal(catalogueItemById("webgpu-303")?.label, "WebGPU 303");
  assert.equal(catalogueItemById("image-to-instrument-3")?.id, "image-to-instrument-3");
  assert.equal(catalogueItemById("linear-drums")?.label, "Rattlesnake");
  assert.equal(CATALOGUE_ITEMS.some(item => item.id === "webgpu-304"), false);
  assert.equal(CATALOGUE_ITEMS.some(item => item.id === "image-to-instrument-4"), false);
  assert.equal(CATALOGUE_ITEMS.some(item => item.label === "RatTesselationnake"), false);
  for (const effective of ["webgpu-303", "image-to-instrument-3", "Rattlesnake"]) {
    assert.equal(plan.notes.find(note => note.effective === effective)?.status, "confirmed");
  }
});

test("the current catalogue implements every effective sheet row without dropping newer main entries", () => {
  assert.equal(CATALOGUE_ITEMS.length, plan.rows.length);
  assert.equal(new Set(CATALOGUE_ITEMS.map(item => item.id)).size, CATALOGUE_ITEMS.length);
  assert.deepEqual(CATALOGUE_GROUPS.map(group => group.id), plan.categoryOrder);
  for (const row of plan.rows) {
    const item = catalogueItemById(row.oldId);
    assert.ok(item, row.oldId);
    assert.equal(item.id, row.id);
    assert.equal(item.label, row.label);
    const expected = [row.categoryId, ...row.tags.map(tag => tag.id)];
    if (FAVE_TOOL_IDS.includes(row.id)) expected.push("faves");
    assert.deepEqual(item.tags.map(tag => tag.id), [...new Set(expected)], row.id);
    assert.equal(item.status, row.categoryId === "wip" ? "Work in Progress" : null);
  }
  for (const id of ["tempo-tantrum", "tape-worm", "loop-soup", "habit-habitat", "hollowphonic"]) {
    assert.ok(instrumentById(id), `${id}: preserve work added on main after the sheet`);
  }
});

test("ID aliases retain every existing MIDI/WAX policy and legacy protocol identity", () => {
  for (const previous of before.INSTRUMENT_MIDI_CAPABILITIES) {
    const id = canonicalInstrumentId(previous.id);
    const current = instrumentMidiCapabilityForId(id);
    assert.deepEqual(current, { ...previous, id }, previous.id);
    assert.equal(instrumentMidiCapabilityForId(previous.id), current);
    assert.equal(legacyInstrumentId(id), previous.id);
  }
  for (const previous of before.WAX_INSTRUMENT_SUPPORT) {
    const current = waxSupportForId(previous.id);
    assert.ok(current, previous.id);
    for (const key of ["recommended", "roles", "audioInput", "midiInput", "midiInputMode",
      "computerKeyboardMode", "midiOutput", "hostSync", "noteMode"]) {
      assert.deepEqual(current[key], previous[key], `${previous.id}: ${key}`);
    }
  }
  assert.deepEqual(FAVE_TOOL_IDS, before.registry.FAVE_TOOL_IDS.map(canonicalInstrumentId));
});

test("existing labs are browseable without being misrepresented as verified MIDI instruments", () => {
  assert.equal(LABS.length, 7);
  for (const lab of LABS) {
    assert.equal(lab.entryType, "lab");
    assert.equal(instrumentById(lab.id), null);
    assert.equal(instrumentMidiCapabilityForId(lab.id), null);
    assert.equal(waxSupportForId(lab.id), null);
    assert.equal(lab.features.includes("MIDI"), false);
    assert.ok(catalogueItemById(lab.id));
  }
  assert.equal(INSTRUMENTS.length, before.INSTRUMENTS.length);
});

test("canonical pages, compatibility redirects and catalogue icons exist", async () => {
  for (const group of TOOL_GROUPS) {
    for (const tool of group.tools) {
      const href = tool.href.endsWith("/") ? tool.href + "index.html" : tool.href;
      assert.ok((await stat(new URL(href, root))).isFile(), href);
      for (const legacy of tool.legacyHrefs ?? []) {
        assert.ok((await stat(new URL(legacy, root))).isFile(), legacy);
      }
    }
  }
  for (const item of CATALOGUE_ITEMS) {
    assert.ok((await stat(new URL(item.imageHref, root))).isFile(), item.imageHref);
  }
  assert.deepEqual((await readdir(root)).filter(file => file.endsWith("-app.js")), [],
    "instrument/site/family implementation controllers must not return to the root");
});
