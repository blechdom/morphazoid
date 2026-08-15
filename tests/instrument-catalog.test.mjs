import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import {
  INSTRUMENT_GROUPS,
  INSTRUMENTS,
  instrumentById,
} from "../src/instrument-catalog.js";

const root = new URL("../", import.meta.url);

test("catalogue data inherits exact section order, names, titles, and links from the menu", () => {
  const catalogueGroups = TOOL_GROUPS
    .filter((group) => group.catalogue !== false)
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => tool.catalogue !== false),
    }))
    .filter((group) => group.tools.length > 0);
  assert.equal(INSTRUMENTS.length, 72);
  assert.deepEqual(
    INSTRUMENT_GROUPS.map(({ id, label }) => ({ id, label })),
    catalogueGroups.map(({ id, label }) => ({ id, label })),
  );
  assert.deepEqual(
    INSTRUMENTS.map(({ id, label, href }) => ({ id, label, href })),
    catalogueGroups.flatMap(({ tools }) => tools).map(({ id, label, href }) => ({
      id,
      label,
      href,
    })),
  );
  for (const id of [
    "room-lobby",
    "vocal-effects-room",
    "instrument-share-room",
    "morphazoid-roulette",
  ]) {
    assert.equal(INSTRUMENTS.some((instrument) => instrument.id === id), false);
  }
});

test("every instrument has factual card copy, a start action, traits, and a transparent icon path", async () => {
  for (const instrument of INSTRUMENTS) {
    assert.ok(instrument.description.length >= 45, `${instrument.id} description is too short`);
    assert.ok(instrument.start.length >= 35, `${instrument.id} start text is too short`);
    assert.ok(instrument.kind.length > 2, `${instrument.id} is missing a kind`);
    assert.equal(instrument.imageHref, `assets/instruments/${instrument.id}.webp`);

    const imageUrl = new URL(instrument.imageHref, root);
    const [bytes, fileStat] = await Promise.all([readFile(imageUrl), stat(imageUrl)]);
    assert.ok(fileStat.size > 1000, `${instrument.id} icon is unexpectedly small`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});

test("input and plug-in availability facts remain explicit", () => {
  assert.equal(instrumentById("escher-tessellation")?.label, "Escher");
  assert.equal(
    INSTRUMENT_GROUPS.find(({ tools }) => (
      tools.some(({ id }) => id === "escher-tessellation")
    ))?.id,
    "experiments",
  );
  assert.deepEqual(instrumentById("shape")?.features, ["MIDI", "Computer keys"]);
  assert.ok(instrumentById("lumber")?.features.includes("Mic input"));
  assert.ok(instrumentById("recursion")?.features.includes("File input"));
  assert.deepEqual(instrumentById("rubix")?.features, ["Pointer"]);
  assert.equal(instrumentById("rubix")?.kind, "Geometric sequencer");
  assert.equal(instrumentById("image-to-instrument-1"), null);
  assert.equal(instrumentById("image-to-instrument-2"), null);
  assert.equal(INSTRUMENT_GROUPS.some(({ id }) => id === "image-to-instrument"), false);
  assert.equal(
    INSTRUMENT_GROUPS.find(({ id }) => id === "signal-voice")?.tools.some(
      ({ id }) => id === "image-to-instrument-3",
    ),
    true,
  );
  assert.match(instrumentById("image-to-instrument-3")?.description ?? "", /every typed letter.*looping mouth.*glottal excitation.*nasal.*slime/i);
  for (const id of [
    "image-to-instrument-3",
    "plasma-ball",
  ]) {
    assert.deepEqual(
      instrumentById(id)?.features,
      id === "image-to-instrument-3"
        ? ["Built-in synth", "Pointer", "Computer keys"]
        : ["Built-in synth", "Pointer"],
    );
  }
  assert.deepEqual(
    INSTRUMENTS.filter(({ pluginHref }) => pluginHref).map(({ id, pluginHref }) => ({
      id,
      pluginHref,
    })),
    [{ id: "chaotic-fm", pluginHref: "plugins.html#chaotic-fm" }],
  );
});

test("card renderer exposes filters, browser links, disabled plug-ins, and no card subtitles", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("instrument-catalog-app.js", root), "utf8"),
    readFile(new URL("instrument-catalog.css", root), "utf8"),
  ]);
  assert.match(app, /type = "search"/);
  assert.match(app, /Play in browser/);
  assert.match(app, /Get plug-in/);
  assert.match(app, /Plug-in unavailable/);
  assert.match(app, /aria-disabled/);
  assert.doesNotMatch(app, /instrument-card-subtitle/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 620px\)[\s\S]*repeat\(2/);
  assert.match(css, /@media \(min-width: 1080px\)[\s\S]*repeat\(3/);
  assert.match(css, /@media \(min-width: 1500px\)[\s\S]*repeat\(4/);
});
