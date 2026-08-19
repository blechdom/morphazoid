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
  assert.equal(INSTRUMENTS.length, 81);
  assert.equal(new Set(INSTRUMENTS.map(({ id }) => id)).size, INSTRUMENTS.length);
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
    assert.ok(instrument.tags.length > 0, `${instrument.id} is missing tags`);
    assert.equal(
      new Set(instrument.tags.map(({ id }) => id)).size,
      instrument.tags.length,
      `${instrument.id} repeats a tag`,
    );
    assert.equal(instrument.imageHref, `assets/instruments/${instrument.id}.webp`);

    const imageUrl = new URL(instrument.imageHref, root);
    const [bytes, fileStat] = await Promise.all([readFile(imageUrl), stat(imageUrl)]);
    assert.ok(fileStat.size > 1000, `${instrument.id} icon is unexpectedly small`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});

test("experiments carry a works-in-progress status while regular instruments do not", () => {
  const experiments = INSTRUMENTS.filter((instrument) => (
    instrument.tags.some(({ id }) => id === "experiments")
    && INSTRUMENT_GROUPS.find(({ id }) => id === "experiments")?.tools.includes(instrument)
  ));
  assert.equal(experiments.length, 32);
  assert.equal(experiments.every(({ status }) => status === "Works in progress"), true);
  assert.equal(
    INSTRUMENTS.filter((instrument) => !experiments.includes(instrument))
      .every(({ status }) => status === null),
    true,
  );
});

test("input and plug-in availability facts remain explicit", () => {
  assert.equal(instrumentById("escher-tessellation")?.label, "Escher");
  assert.equal(instrumentById("escher-tessellation")?.status, "Works in progress");
  assert.equal(
    INSTRUMENT_GROUPS.find(({ tools }) => (
      tools.some(({ id }) => id === "escher-tessellation")
    ))?.id,
    "experiments",
  );
  assert.deepEqual(instrumentById("shape")?.features, ["MIDI", "Computer keys"]);
  assert.deepEqual(
    instrumentById("micmic")?.tags.map(({ id, label }) => ({ id, label })),
    [
      { id: "signal-voice", label: "Signal & Voice" },
      { id: "fractals-recursion", label: "Fractals & Recursion" },
    ],
  );
  assert.deepEqual(
    instrumentById("escher-tessellation")?.tags.map(({ id }) => id),
    ["experiments", "geometry"],
  );
  assert.ok(instrumentById("lumber")?.features.includes("Mic input"));
  assert.ok(instrumentById("recursion")?.features.includes("File input"));
  assert.equal(instrumentById("hyper-rubix")?.kind, "4D drum sequencer");
  assert.deepEqual(
    instrumentById("hyper-rubix")?.features,
    ["Pointer", "Built-in synth", "MIDI"],
  );
  assert.deepEqual(instrumentById("rubix")?.features, ["Pointer", "MIDI", "Computer keys"]);
  for (const id of [
    "striped-sludge-delay", "candy-coil-delay", "chladni-plate", "spring-choir",
    "gear-ratio-drums", "cellular-automata", "reaction-diffusion", "neural-pulse",
    "cantor-lock",
  ]) {
    assert.equal(instrumentById(id)?.features.includes("MIDI"), true, `${id} keeps hardware MIDI`);
    assert.equal(
      instrumentById(id)?.features.includes("Computer keys"),
      false,
      `${id} must not advertise no-op note keys`,
    );
  }
  assert.equal(instrumentById("rubix")?.kind, "Geometric sequencer");
  for (const id of ["cascading-fm", "cascading-pm"]) {
    assert.equal(instrumentById(id)?.kind, "Synth");
    assert.deepEqual(
      instrumentById(id)?.tags.map(({ id: tagId }) => tagId),
      ["chaotic-synths", "fractals-recursion"],
    );
  }
  assert.match(instrumentById("cascading-fm")?.description ?? "", /frequenc(?:y|ies)/i);
  assert.match(instrumentById("cascading-pm")?.description ?? "", /phase.*radians/i);
  assert.equal(instrumentById("image-to-instrument-1"), null);
  assert.equal(instrumentById("image-to-instrument-2"), null);
  assert.equal(INSTRUMENT_GROUPS.some(({ id }) => id === "image-to-instrument"), false);
  assert.equal(
    INSTRUMENT_GROUPS.find(({ id }) => id === "signal-voice")?.tools.some(
      ({ id }) => id === "image-to-instrument-3",
    ),
    true,
  );
  assert.match(instrumentById("image-to-instrument-3")?.description ?? "", /every typed letter.*glottal mouth.*one-shot wheel.*nasal.*slime.*three-o'clock reader/i);
  assert.match(instrumentById("image-to-instrument-3")?.start ?? "", /accelerates.*coasts.*brakes.*final organ sustains and fades.*unlocks/i);
  for (const id of [
    "image-to-instrument-3",
    "plasma-ball",
  ]) {
    assert.deepEqual(
      instrumentById(id)?.features,
      id === "image-to-instrument-3"
        ? ["Built-in synth", "Pointer", "Computer keys", "MIDI"]
        : ["Built-in synth", "Pointer", "MIDI", "Computer keys"],
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

test("Hyper Rubix copy documents every order, topology voice, and shared rattle", async () => {
  const instrument = instrumentById("hyper-rubix");
  assert.match(instrument?.description ?? "", /order-2 through order-4/i);
  assert.match(instrument?.description ?? "", /64, 216, or 512 sticker-events/i);
  assert.match(instrument?.description ?? "", /tangent-neighbor topology.*persistent resonators/i);
  assert.match(instrument?.description ?? "", /65, 217, or 513 conceptual voices/i);
  assert.match(instrument?.start ?? "", /always-64 Corner Stream/i);

  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(
    readme,
    /Hyper Rubix[\s\S]*?2 × 2 × 2 × 2[\s\S]*?3 × 3 × 3 × 3[\s\S]*?4 × 4 × 4 × 4/,
  );
  assert.match(readme, /64, 216, or 512 total/);
  assert.match(readme, /topology-resonator bank.*actual current tangent-neighbor connections/i);
  assert.match(readme, /65, 217, or 513 conceptual voices including the rattle/i);
});

test("card renderer separates in-development experiments from the main catalogue", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("instrument-catalog-app.js", root), "utf8"),
    readFile(new URL("instrument-catalog.css", root), "utf8"),
  ]);
  assert.match(app, /INSTRUMENTS\.map\(\(instrument, index\) => \(\{/);
  assert.match(app, /image\.loading = index < 12 \? "eager" : "lazy"/);
  assert.match(app, /image\.decoding = index < 12 \? "sync" : "async"/);
  assert.ok(app.indexOf("image.loading =") < app.indexOf("image.src = instrument.imageHref"));
  assert.match(app, /grid\.append\(\.\.\.instrumentCards\)/);
  assert.match(app, /experimentGrid\.append\(\.\.\.experimentCards\)/);
  assert.match(app, /root\.replaceChildren\(grid, experiments\)/);
  assert.match(app, /catalogue-experiments/);
  assert.match(app, /instrument-card-status/);
  assert.match(app, /"Works in progress"/);
  assert.match(app, /aria-labelledby/);
  assert.match(app, /Play in browser/);
  assert.match(app, /instrument-card-heading/);
  assert.match(app, /instrument-card-heading-copy/);
  assert.match(app, /instrument-card-image-preview/);
  assert.match(app, /Show enlarged \$\{instrument\.label\} artwork/);
  assert.match(app, /card\.dataset\.previewOpen/);
  assert.match(app, /instrument-tags/);
  assert.match(app, /instrument\.tags/);
  assert.doesNotMatch(app, /type = "search"/);
  assert.doesNotMatch(app, /catalogue-controls/);
  assert.doesNotMatch(app, /catalogue-section-index/);
  assert.doesNotMatch(app, /catalogue-group-heading/);
  assert.doesNotMatch(app, /All sections|All types|Name, sound, or idea|instruments match/);
  assert.doesNotMatch(app, /Get plug-in/);
  assert.doesNotMatch(app, /Plug-in unavailable/);
  assert.doesNotMatch(app, /aria-disabled/);
  assert.doesNotMatch(app, /instrument-card-subtitle/);
  assert.match(css, /grid-template-columns: 92px minmax\(0, 1fr\)/);
  assert.match(css, /\.instrument-tags\s*\{/);
  assert.match(css, /\.catalogue-experiments\s*\{/);
  assert.match(css, /\.instrument-card-status\s*\{/);
  assert.doesNotMatch(css, /\.catalogue-controls|\.catalogue-section-index|\.catalogue-group-heading/);
  assert.match(css, /\.instrument-card-visual\s*\{[^}]*width: 92px;/s);
  assert.match(css, /\.instrument-card-image-preview\s*\{[^}]*bottom: -1px;/s);
  assert.match(css, /\.instrument-card:has\(\.instrument-card-visual:hover\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*grid-template-columns: 78px minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 620px\)[\s\S]*repeat\(2/);
  assert.match(css, /@media \(min-width: 1080px\)[\s\S]*repeat\(3/);
  assert.match(css, /@media \(min-width: 1500px\)[\s\S]*repeat\(4/);
});
