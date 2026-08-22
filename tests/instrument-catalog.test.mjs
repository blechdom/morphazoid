import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import {
  instrumentMatchesTag,
  renderInstrumentCatalog,
} from "../instrument-catalog-app.js";
import {
  INSTRUMENT_GROUPS,
  INSTRUMENTS,
  instrumentById,
} from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);

test("catalogue data inherits exact section order, names, titles, and links from the menu", () => {
  const catalogueGroups = TOOL_GROUPS
    .filter((group) => group.catalogue !== false)
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => tool.catalogue !== false),
    }))
    .filter((group) => group.tools.length > 0);
  assert.equal(INSTRUMENTS.length, 98);
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

  const pickerTools = TOOL_GROUPS.flatMap((group) => group.tools.filter((tool) => (
    group.picker !== false || tool.picker === true
  )));
  assert.deepEqual(
    pickerTools.filter((tool) => !instrumentById(tool.id)).map(({ id }) => id),
    [],
    "every pull-down entry must have a catalogue card",
  );
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
  assert.equal(experiments.length, 38);
  assert.equal(experiments.every(({ status }) => status === "Works in progress"), true);
  assert.equal(experiments.every(({ tags }) => (
    tags.length === 1 && tags[0].id === "experiments"
  )), true);
  assert.equal(
    INSTRUMENTS.filter((instrument) => !experiments.includes(instrument))
      .every(({ status }) => status === null),
    true,
  );
});

test("temporary Misc group owns the five uncategorized instruments", () => {
  const ids = [
    "playhead-paint",
    "boidzoid",
    "gesturama",
    "image-to-instrument-3",
    "orbital-ferris",
  ];
  const misc = INSTRUMENT_GROUPS.find(({ id }) => id === "misc");
  assert.deepEqual(misc?.tools.map(({ id }) => id), ids);
  for (const id of ids) {
    assert.deepEqual(instrumentById(id)?.tags.map(({ id: tagId }) => tagId), ["misc"]);
    assert.equal(instrumentById(id)?.status, null);
  }
});

test("Plasma Ball is an experiment with no secondary catalogue tags", () => {
  const plasmaBall = instrumentById("plasma-ball");
  assert.equal(plasmaBall?.status, "Works in progress");
  assert.deepEqual(
    plasmaBall?.tags.map(({ id }) => id),
    ["experiments"],
  );
});

test("Quantum Square Dance is an exact paired-atom sonification with sequence output", () => {
  const instrument = instrumentById("quantum-square-dance");
  assert.equal(instrument?.label, "Quantum Square Dance");
  assert.equal(instrument?.href, "quantum-square-dance.html");
  assert.equal(instrument?.kind, "Quantum sonification");
  assert.match(instrument?.description ?? "", /exact classical simulation/i);
  assert.match(instrument?.description ?? "", /controlled spin exchange/i);
  assert.match(instrument?.description ?? "", /paired atoms/i);
  assert.doesNotMatch(instrument?.description ?? "", /QPU|quantum hardware/i);
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);

  const midi = instrumentMidiCapabilityForId("quantum-square-dance");
  assert.equal(midi?.noteMode, "sequence");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "none");
});

test("Playhead Paint is a pointer drawing synth without generic note keys", () => {
  const instrument = instrumentById("playhead-paint");
  assert.equal(instrument?.label, "Playhead Paint");
  assert.equal(instrument?.href, "playhead-paint.html");
  assert.equal(instrument?.imageHref, "assets/instruments/playhead-paint.webp");
  assert.equal(instrument?.kind, "Drawing synth");
  assert.match(instrument?.description ?? "", /freehand pointer strokes/i);
  assert.match(instrument?.description ?? "", /mirrored axes/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["misc"]);
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);

  const midi = instrumentMidiCapabilityForId("playhead-paint");
  assert.equal(midi?.noteMode, "pitched");
  assert.equal(midi?.midiOutput, false);
  assert.equal(midi?.computerKeyboardMode, "none");
});

test("Karplus Carpet is a synthesized microsound field with page-owned note gestures", () => {
  const instrument = instrumentById("karplus-carpet");
  assert.equal(instrument?.label, "Karplus Carpet");
  assert.equal(instrument?.href, "karplus-carpet.html");
  assert.equal(instrument?.kind, "Microsound physical-model synth");
  assert.match(instrument?.description ?? "", /freshly synthesized/i);
  assert.match(instrument?.description ?? "", /without loading sample grains/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["instruments"]);
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.ok(instrument?.features.includes("Computer keys"));
  assert.equal(instrument?.imageHref, "assets/instruments/karplus-carpet.webp");

  const midi = instrumentMidiCapabilityForId("karplus-carpet");
  assert.equal(midi?.noteMode, "pitched");
  assert.equal(midi?.computerKeyboardMode, "page");
  assert.equal(midi?.midiOutput, false);
});

test("Boidzoid is a continuous flocking sine field without generic note keys", () => {
  const instrument = instrumentById("boidzoid");
  assert.equal(instrument?.label, "Boidzoid");
  assert.equal(instrument?.href, "boidzoid.html");
  assert.equal(instrument?.imageHref, "assets/instruments/boidzoid.webp");
  assert.equal(instrument?.kind, "Flocking sine field");
  assert.match(instrument?.description ?? "", /arrow playheads/i);
  assert.match(instrument?.description ?? "", /continuous sine voice/i);
  assert.match(instrument?.description ?? "", /without note divisions/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["misc"]);
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);

  const midi = instrumentMidiCapabilityForId("boidzoid");
  assert.equal(midi?.noteMode, "sequence");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "none");
});

test("Pink Trombonazoid is an articulatory voice sequencer without generic note keys or MIDI output", () => {
  const instrument = instrumentById("pink-trombonazoid");
  assert.equal(instrument?.label, "Pink Trombonazoid");
  assert.equal(instrument?.href, "pink-trombonazoid.html");
  assert.equal(instrument?.imageHref, "assets/instruments/pink-trombonazoid.webp");
  assert.equal(instrument?.kind, "Articulatory voice sequencer");
  assert.match(instrument?.description ?? "", /editable phoneme blocks/i);
  assert.match(instrument?.description ?? "", /physical vocal tract/i);
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["voice-synths", "sequencers"],
  );
  assert.ok(instrument?.features.includes("Built-in source"));
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);

  const midi = instrumentMidiCapabilityForId("pink-trombonazoid");
  assert.equal(midi?.noteMode, "sequence");
  assert.equal(midi?.midiOutput, false);
  assert.equal(midi?.computerKeyboardMode, "none");
});

test("Alien Larynx is a work-in-progress experiment", () => {
  const alienLarynx = instrumentById("alien-larynx");
  assert.equal(alienLarynx?.status, "Works in progress");
  assert.deepEqual(
    alienLarynx?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.equal(
    INSTRUMENT_GROUPS.find(({ tools }) => tools.includes(alienLarynx))?.id,
    "experiments",
  );
});

test("Hyper-Syrinx is a work-in-progress experiment", () => {
  const hyperSyrinx = instrumentById("hyper-syrinx");
  assert.equal(hyperSyrinx?.status, "Works in progress");
  assert.deepEqual(
    hyperSyrinx?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.equal(
    INSTRUMENT_GROUPS.find(({ tools }) => tools.includes(hyperSyrinx))?.id,
    "experiments",
  );
});

test("Morphynx is a work-in-progress experiment", () => {
  const morphynx = instrumentById("morphynx");
  assert.equal(morphynx?.status, "Works in progress");
  assert.deepEqual(
    morphynx?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.equal(
    INSTRUMENT_GROUPS.find(({ tools }) => tools.includes(morphynx))?.id,
    "experiments",
  );
});

test("catalogue tag matching includes secondary tags", () => {
  assert.equal(instrumentMatchesTag(instrumentById("plasma-ball"), "all"), true);
  assert.equal(instrumentMatchesTag(instrumentById("plasma-ball"), "chaotic-synths"), false);
  assert.equal(instrumentMatchesTag(instrumentById("plasma-ball"), "experiments"), true);
  assert.equal(instrumentMatchesTag(instrumentById("plasma-ball"), "geometry"), false);
  assert.equal(instrumentMatchesTag(instrumentById("fm-drums"), "geometry-drums"), true);
});

test("catalogue tag controls hide experiments until All is restored", () => {
  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.hidden = false;
      this.textContent = "";
    }

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      this.children = children;
    }

    setAttribute(name, value) {
      this.attributes.set(name, value);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    click() {
      this.listeners.get("click")?.();
    }
  }

  const doc = {};
  doc.createElement = (tagName) => new FakeElement(tagName, doc);
  const rootElement = new FakeElement("div", doc);
  const rendered = renderInstrumentCatalog(rootElement);
  const filterLabels = rendered.filter.children.map(({ textContent }) => textContent);
  assert.deepEqual(filterLabels, [
    "All",
    "Geometry Synths",
    "Drum Machines",
    "Sequencers",
    "Voice Synths",
    "Mic FX",
    "Barber Shop Poles",
    "Fractals & Recursion",
    "Chaotic Synths",
    "Misc",
    "Instruments",
    "Algorithmic Sequencers",
  ]);

  const chaoticButton = rendered.filter.children.find(
    ({ dataset }) => dataset.catalogueTag === "chaotic-synths",
  );
  chaoticButton.click();
  assert.equal(rendered.experiments.hidden, true);
  assert.equal(
    rendered.cards.find(({ dataset }) => dataset.instrumentId === "plasma-ball").hidden,
    true,
  );
  assert.equal(
    rendered.cards.find(({ dataset }) => dataset.instrumentId === "recursive-fm").hidden,
    false,
  );
  assert.equal(chaoticButton.attributes.get("aria-pressed"), "true");

  rendered.filter.children[0].click();
  assert.equal(rendered.experiments.hidden, false);
  assert.equal(rendered.cards.every(({ hidden }) => !hidden), true);
});

test("input and plug-in availability facts remain explicit", () => {
  assert.equal(instrumentById("ouroborousel")?.label, "Ouroborousel");
  assert.equal(instrumentById("ouroborousel")?.href, "ouroborousel.html");
  assert.equal(instrumentById("ouroborousel")?.kind, "Rhythm-pitch synth");
  assert.match(instrumentById("ouroborousel")?.description ?? "", /higher-note chunks/i);
  assert.match(instrumentById("ouroborousel")?.description ?? "", /Ouroboros drum bodies/i);
  assert.match(instrumentById("ouroborousel")?.description ?? "", /rhythm.*pitch fusion threshold/i);
  assert.match(instrumentById("ouroborousel")?.start ?? "", /Notes \+ Drums/i);
  assert.ok(instrumentById("ouroborousel")?.features.includes("Built-in synth"));
  assert.ok(instrumentById("ouroborousel")?.features.includes("Pointer"));
  assert.equal(instrumentById("ouroboros")?.kind, "Percussion synth");
  assert.match(instrumentById("ouroboros")?.description ?? "", /Shepard.*Rattlesnake|Rattlesnake.*Shepard/i);
  assert.ok(instrumentById("ouroboros")?.features.includes("Built-in synth"));
  assert.equal(instrumentById("ouroboros-borealis")?.kind, "Percussion synth");
  assert.match(
    instrumentById("ouroboros-borealis")?.description ?? "",
    /pitch.*rhythm|rhythm.*pitch/i,
  );
  assert.match(
    instrumentById("ouroboros-borealis")?.description ?? "",
    /Shepard|Risset/i,
  );
  assert.ok(instrumentById("ouroboros-borealis")?.features.includes("Built-in synth"));
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
      { id: "mic-fx", label: "Mic FX" },
      { id: "fractals-recursion", label: "Fractals & Recursion" },
    ],
  );
  assert.deepEqual(
    instrumentById("escher-tessellation")?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.ok(instrumentById("lumber")?.features.includes("Mic input"));
  assert.ok(instrumentById("recursion")?.features.includes("File input"));
  assert.equal(instrumentById("hyper-rubix")?.kind, "4D shape sequencer");
  assert.deepEqual(
    instrumentById("hyper-rubix")?.features,
    ["Pointer", "Built-in synth", "MIDI"],
  );
  assert.deepEqual(instrumentById("rubix")?.features, ["Pointer", "MIDI", "Computer keys"]);
  for (const id of [
    "candy-coil-delay", "chladni-plate", "spring-choir",
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
  assert.equal(instrumentById("striped-sludge-delay"), null);
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
    INSTRUMENT_GROUPS.find(({ id }) => id === "misc")?.tools.some(
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

test("Hyper Rubix copy documents every order, playback scope, and five instruments", async () => {
  const instrument = instrumentById("hyper-rubix");
  assert.match(instrument?.description ?? "", /order-2, order-3, or order-4/i);
  assert.match(instrument?.description ?? "", /64, 216, or 512 distinct notes/i);
  assert.match(instrument?.description ?? "", /color drums.*resonant prisms.*bit voices.*WebGPU acid.*seed-shell rattles/i);
  assert.match(instrument?.start ?? "", /without resetting time/i);

  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(
    readme,
    /Hyper Rubix[\s\S]*?2 × 2 × 2 × 2[\s\S]*?3 × 3 × 3 × 3[\s\S]*?4 × 4 × 4 × 4/,
  );
  assert.match(readme, /64, 216, or 512 total/);
  assert.match(readme, /View-facing reads the foreground cell from each X\/Y\/Z\/W pair/i);
  assert.match(readme, /Selected cell isolates one cubic cell/i);
  assert.match(readme, /Whole shape reads every sticker/i);
  assert.match(readme, /Hyper, Prism, Bit, WebGPU 303, and Rattlesnake/i);
  assert.match(readme, /Orbit and Fold W remap the clocked score.*without starting a separate sustained gesture synth/i);
  assert.match(readme, /manual quarter-turns.*without rewinding its clock/i);
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
  assert.match(app, /root\.replaceChildren\(filter, grid, experiments\)/);
  assert.match(app, /catalogue-tag-filter/);
  assert.match(app, /Filter instruments by tag/);
  assert.match(app, /button\.dataset\.catalogueTag = tag\.id/);
  assert.match(app, /button\.setAttribute\("aria-pressed"/);
  assert.match(app, /card\.hidden = !matches/);
  assert.match(app, /experiments\.hidden = visibleExperiments === 0/);
  assert.match(app, /catalogue-experiments/);
  assert.match(app, /instrument-card-status/);
  assert.match(app, /"Works in progress"/);
  assert.match(app, /aria-labelledby/);
  assert.match(app, /Play in browser/);
  assert.match(app, /instrument-card-heading/);
  assert.match(app, /instrument-card-heading-copy/);
  assert.match(app, /instrument-card-image-preview/);
  assert.match(app, /element\(doc, "a", "instrument-card-link"\)/);
  assert.match(app, /cardLink\.href = instrument\.href/);
  assert.match(app, /cardLink\.setAttribute\("aria-labelledby", title\.id\)/);
  assert.match(app, /cardLink\.append\(heading, body, actions\)/);
  assert.match(app, /card\.append\(cardLink, preview\)/);
  assert.doesNotMatch(app, /card\.dataset\.previewOpen|visual\.addEventListener/);
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
  assert.match(css, /\.catalogue-tag-filter\s*\{/);
  assert.match(css, /\.catalogue-tag-filter-button\[aria-pressed="true"\]/);
  assert.match(css, /\.instrument-card\[hidden\]\s*\{/);
  assert.match(css, /\.catalogue-experiments\s*\{/);
  assert.match(css, /\.instrument-card-status\s*\{/);
  assert.match(css, /\.instrument-card-link\s*\{[^}]*min-height: 100%;[^}]*cursor: pointer;/s);
  assert.match(css, /\.instrument-card:has\(\.instrument-card-link:focus-visible\)/);
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
