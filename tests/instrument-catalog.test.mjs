import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { FAVE_TOOL_IDS, TOOL_GROUPS } from "../nav.js";
import {
  FIRST_CATEGORY_ID,
  HOMEPAGE_ACTIVITY_IDS,
  instrumentMatchesTag,
  orderHomepageInstruments,
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
  assert.ok(INSTRUMENTS.length > 0);
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

test("every instrument keeps factual catalogue metadata and a valid icon path", async () => {
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
    const expectedImageHref = ["shader-synth-playground", "srtuss"].includes(instrument.id)
      ? "assets/instruments/webgpu-synths.webp"
      : instrument.id === "webgpu-chiptune"
        ? "assets/instruments/webgpu-303.webp"
        : instrument.id === "constellation"
        ? "assets/instruments/graph-synth.webp"
        : instrument.id === "jaw-jam"
          ? "assets/instruments/jaw-harp.webp"
          : instrument.id === "object-forge"
            ? "assets/instruments/dentaphone.webp"
          : `assets/instruments/${instrument.id}.webp`;
    assert.equal(instrument.imageHref, expectedImageHref);

    const imageUrl = new URL(instrument.imageHref, root);
    const [bytes, fileStat] = await Promise.all([readFile(imageUrl), stat(imageUrl)]);
    assert.ok(fileStat.size > 1000, `${instrument.id} icon is unexpectedly small`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});

test("experiments carry a works-in-progress status while regular instruments do not", () => {
  const experimentGroup = INSTRUMENT_GROUPS.find(({ id }) => id === "experiments");
  assert.ok(experimentGroup);
  const experiments = INSTRUMENTS.filter((instrument) => (
    instrument.tags.some(({ id }) => id === "experiments")
    && experimentGroup.tools.includes(instrument)
  ));
  assert.equal(experiments.length, experimentGroup.tools.length);
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

test("unfinished algorithmic scores live only in Works in progress", () => {
  const movedIds = ["hanoi", "minimax", "nqueens", "euclid"];
  const algorithmicIds = INSTRUMENT_GROUPS.find(
    ({ id }) => id === "algorithmic-sequencers",
  )?.tools.map(({ id }) => id);
  const experimentIds = INSTRUMENT_GROUPS.find(
    ({ id }) => id === "experiments",
  )?.tools.map(({ id }) => id);

  assert.deepEqual(algorithmicIds, ["sorting-algorithms", "dijkstra"]);
  for (const id of movedIds) {
    const instrument = instrumentById(id);
    assert.equal(experimentIds.includes(id), true);
    assert.equal(instrument?.status, "Works in progress");
    assert.deepEqual(instrument?.tags.map(({ id: tagId }) => tagId), ["experiments"]);
  }
});

test("Faves keep their regular catalogue groups and experiments never inherit the tag", () => {
  for (const id of FAVE_TOOL_IDS) {
    const instrument = instrumentById(id);
    assert.ok(instrument, `${id} must exist in the catalogue`);
    assert.equal(instrument.tags.some(({ id: tagId }) => tagId === "faves"), true);
    assert.notEqual(instrument.tags[0].id, "faves", `${id} keeps its primary group first`);
    assert.equal(instrument.status, null);
  }
  assert.equal(
    INSTRUMENTS.filter(({ status }) => status)
      .some(({ tags }) => tags.some(({ id }) => id === "faves")),
    false,
  );
});

test("Misc group owns the uncategorized instruments including Puggler", () => {
  const ids = [
    "playhead-paint",
    "boidzoid",
    "puggler",
    "vector-flight",
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

test("Dentaphone catalogues its complete sample-free tooth instrument", () => {
  const instrument = instrumentById("object-forge");
  assert.equal(instrument?.label, "Dentaphone");
  assert.equal(instrument?.href, "dentaphone.html");
  assert.equal(instrument?.imageHref, "assets/instruments/dentaphone.webp");
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["instruments"]);
  assert.match(instrument?.description ?? "", /32 individually playable upper and lower teeth/i);
  assert.ok(instrument?.features.includes("Physical-model DSP"));
  assert.ok(instrument?.features.includes("Sample-free AudioWorklet"));
  assert.equal(instrumentMidiCapabilityForId("object-forge")?.noteMode, "pitched");
  assert.equal(instrumentMidiCapabilityForId("object-forge")?.computerKeyboardMode, "page");
});

test("Plasma Ball is an experiment with no secondary catalogue tags", () => {
  const plasmaBall = instrumentById("plasma-ball");
  assert.equal(plasmaBall?.status, "Works in progress");
  assert.deepEqual(
    plasmaBall?.tags.map(({ id }) => id),
    ["experiments"],
  );
});

test("Slippery Resynthesis catalogues its FFT resynthesis and both local input paths", () => {
  const instrument = instrumentById("slippery-resynthesis");
  assert.equal(instrument?.label, "Slippery Resynthesis");
  assert.equal(instrument?.href, "slippery-resynthesis.html");
  assert.equal(instrument?.kind, "Spectral resynthesizer");
  assert.match(instrument?.description ?? "", /FFT bands/i);
  assert.match(instrument?.description ?? "", /Shepard glissando banks/i);
  assert.ok(instrument?.features.includes("Mic input"));
  assert.ok(instrument?.features.includes("Local file input"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);
  assert.ok(instrument?.features.includes("Speech-detail resynthesis"));
  assert.equal(instrument?.tags.some(({ id }) => id === "faves"), false);
  assert.equal(instrumentMidiCapabilityForId("slippery-resynthesis")?.noteMode, "processor");
});

test("Micromorph catalogues its honest local streaming-model boundary", () => {
  const instrument = instrumentById("micromorph");
  assert.equal(instrument?.label, "Micromorph");
  assert.equal(instrument?.href, "micromorph.html");
  assert.equal(instrument?.kind, "Realtime generative mic effect");
  assert.match(instrument?.description ?? "", /local diffusion model/i);
  assert.match(instrument?.start ?? "", /rehearsal DSP/i);
  assert.ok(instrument?.features.includes("Mic input"));
  assert.ok(instrument?.features.includes("Local model host"));
  assert.ok(instrument?.features.includes("Streaming PCM"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["mic-fx"]);
  assert.equal(instrumentMidiCapabilityForId("micromorph")?.noteMode, "processor");
});

test("Fabric Filter catalogues its two-dimensional noise-filter collision engine", () => {
  const instrument = instrumentById("moire-drone");
  assert.equal(instrument?.label, "Fabric Filter");
  assert.equal(instrument?.href, "moire-drone.html");
  assert.equal(instrument?.kind, "Noise-field drone");
  assert.match(instrument?.description ?? "", /colored noise/i);
  assert.match(instrument?.description ?? "", /two-dimensional wave fields/i);
  assert.ok(instrument?.features.includes("Built-in noise"));
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.equal(instrument?.features.includes("Computer keys"), false);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["barber-shop-poles"]);
  const midi = instrumentMidiCapabilityForId("moire-drone");
  assert.equal(midi?.noteMode, "processor");
  assert.equal(midi?.audioInput, false);
  assert.equal(midi?.startsAudio, true);
  assert.equal(midi?.computerKeyboardMode, "none");
});

test("Modular Shader Synth is a sequencer instrument with shared GPU artwork", () => {
  const instrument = instrumentById("shader-synth-playground");
  assert.equal(instrument?.label, "Modular Shader Synth");
  assert.equal(instrument?.href, "shader-synth-playground.html");
  assert.equal(instrument?.kind, "Modular WebGPU synth");
  assert.equal(instrument?.imageHref, "assets/instruments/webgpu-synths.webp");
  assert.match(instrument?.description ?? "", /editable graph/i);
  assert.match(instrument?.description ?? "", /WGSL compute shaders/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["sequencers"]);
  assert.ok(instrument?.features.includes("WebGPU"));
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.ok(instrument?.features.includes("Computer keys"));

  const midi = instrumentMidiCapabilityForId("shader-synth-playground");
  assert.equal(midi?.noteMode, "sequence");
  assert.equal(midi?.computerKeyboardMode, "midi");
});

test("SIMD SYNTH is a pitched, configurable WebAssembly instrument", () => {
  const instrument = instrumentById("simd-synth");
  assert.equal(instrument?.label, "SIMD SYNTH");
  assert.equal(instrument?.href, "simd-synth.html");
  assert.equal(instrument?.kind, "Configurable WebAssembly SIMD synth");
  assert.equal(instrument?.imageHref, "assets/instruments/simd-synth.webp");
  assert.match(instrument?.description ?? "", /eight synthesis models/i);
  assert.match(instrument?.description ?? "", /filter-routing/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["sequencers"]);
  assert.ok(instrument?.features.includes("WebAssembly SIMD"));
  assert.ok(instrument?.features.includes("AudioWorklet"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.ok(instrument?.features.includes("Computer keys"));

  const midi = instrumentMidiCapabilityForId("simd-synth");
  assert.equal(midi?.noteMode, "pitched");
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("srtuss is a sound-only decomposed WebGPU master synth", () => {
  const instrument = instrumentById("srtuss");
  assert.equal(instrument?.href, "srtuss.html");
  assert.equal(instrument?.imageHref, "assets/instruments/webgpu-synths.webp");
  assert.match(instrument?.description ?? "", /48 selectable source parts/i);
  assert.match(instrument?.description ?? "", /all ten verified translations/i);
  assert.match(instrument?.start ?? "", /Explode mix/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["sequencers"]);
  assert.ok(instrument?.features.includes("WebGPU"));
  assert.ok(instrument?.features.includes("Built-in synth"));
  assert.equal(instrumentMidiCapabilityForId("srtuss")?.noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("srtuss")?.computerKeyboardMode, "none");
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
  assert.match(instrument?.description ?? "", /amplitude ADSR/i);
  assert.match(instrument?.description ?? "", /two sound-variety banks/i);
  assert.match(instrument?.description ?? "", /deterministic cell color/i);
  assert.match(instrument?.description ?? "", /coupled resonators/i);
  assert.match(instrument?.description ?? "", /without loading sample grains/i);
  assert.match(instrument?.start ?? "", /each newly crossed area sounds once per gesture/i);
  assert.match(instrument?.start ?? "", /holding still stays silent/i);
  assert.doesNotMatch(instrument?.start ?? "", /\bPlay\b|hit count|timing scatter/i);
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

test("Hiccup Head is a monophonic physical beatbox sequencer with page-owned drum keys", () => {
  const instrument = instrumentById("hiccup-head");
  assert.equal(instrument?.label, "Hiccup Head");
  assert.equal(instrument?.href, "hiccup-head.html");
  assert.equal(instrument?.imageHref, "assets/instruments/hiccup-head.webp");
  assert.equal(instrument?.kind, "Monophonic physical beatbox sequencer");
  assert.match(instrument?.description ?? "", /fifty-two exclusive gestures/i);
  assert.match(instrument?.description ?? "", /HIC!/i);
  assert.match(instrument?.description ?? "", /mouth KSH snare/i);
  assert.match(instrument?.description ?? "", /twelve pitched dead-wood teeth/i);
  assert.match(instrument?.start ?? "", /one gesture per column/i);
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["voice-synths", "sequencers", "faves"],
  );
  assert.ok(instrument?.features.includes("Built-in source"));
  assert.ok(instrument?.features.includes("Pointer"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.ok(instrument?.features.includes("Computer keys"));

  const midi = instrumentMidiCapabilityForId("hiccup-head");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Jaw Jam is a dual-clock monophonic physical jaw-harp sequencer", () => {
  const instrument = instrumentById("jaw-jam");
  assert.equal(instrument?.label, "Jaw Jam");
  assert.equal(instrument?.href, "jaw-jam.html");
  assert.equal(instrument?.imageHref, "assets/instruments/jaw-harp.webp");
  assert.equal(instrument?.kind, "Virtuosic monophonic jaw-harp sequencer");
  assert.match(instrument?.description ?? "", /plucks, pitch-inheriting sustains, and exact hard rests/i);
  assert.match(instrument?.start ?? "", /independent pluck and breath clocks/i);
  assert.deepEqual(instrument?.tags.map(({ id }) => id), ["sequencers", "voice-synths"]);
  assert.ok(instrument?.features.includes("Physical-model DSP"));
  assert.ok(instrument?.features.includes("Dual clocks"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.ok(instrument?.features.includes("Computer keys"));

  const midi = instrumentMidiCapabilityForId("jaw-jam");
  assert.equal(midi?.noteMode, "pitched");
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Digestazoid is a tactile digestive physical model with page-owned pressure gestures", () => {
  const instrument = instrumentById("digestazoid");
  assert.equal(instrument?.label, "Digestazoid");
  assert.equal(instrument?.href, "digestazoid.html");
  assert.equal(instrument?.imageHref, "assets/instruments/digestazoid.webp");
  assert.equal(instrument?.kind, "Tactile digestive physical model");
  assert.match(instrument?.description ?? "", /compliant stomach/i);
  assert.match(instrument?.description ?? "", /viscous sludge/i);
  assert.match(instrument?.start ?? "", /push and prod/i);
  assert.ok(instrument?.features.includes("Physical-model DSP"));
  assert.ok(instrument?.features.includes("Computer keys"));
  assert.ok(instrument?.features.includes("MIDI"));

  const midi = instrumentMidiCapabilityForId("digestazoid");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Creaturazoid intersperses creature voices and body percussion in one shared body", () => {
  const instrument = instrumentById("creaturazoid");
  assert.equal(instrument?.label, "Creaturazoid");
  assert.equal(instrument?.href, "creaturazoid.html");
  assert.equal(instrument?.imageHref, "assets/instruments/creaturazoid.webp");
  assert.equal(instrument?.kind, "Monophonic creature voice and body sequencer");
  assert.equal(
    instrument?.description,
    "Routes 50 gestures—36 animal voices plus 14 procedural hisses, impacts, scrapes, wing sounds, breaths, feeding clicks, and locomotion—through one persistent absolute Hybrinx body.",
  );
  assert.equal(
    instrument?.start,
    "Turn on audio, choose a persistent body and rhythm, then intersperse vocal calls with body percussion; every rectangular step retargets the same airway and body-cavity resonator.",
  );
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["voice-synths", "sequencers"],
  );
  assert.deepEqual(
    instrument?.features,
    ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP", "MIDI"],
  );

  const midi = instrumentMidiCapabilityForId("creaturazoid");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Quadruped includes Frog and couples animal bodies to foot-driven contact scores", () => {
  const instrument = instrumentById("quadruped");
  assert.equal(instrument?.label, "Quadruped");
  assert.equal(instrument?.href, "quadruped.html");
  assert.equal(instrument?.imageHref, "assets/instruments/quadruped.webp");
  assert.equal(instrument?.kind, "Quadruped gait sequencer");
  assert.match(instrument?.description ?? "", /species-shaped bodies, including Frog/i);
  assert.match(instrument?.description ?? "", /three optional melodic calls/i);
  assert.match(instrument?.start ?? "", /Solo, Herd or Trio/i);
  assert.match(instrument?.description ?? "", /sixteen-card motion study/i);
  assert.match(instrument?.description ?? "", /touchdown, load, push, support, lift-off, and landing/i);
  assert.match(instrument?.start ?? "", /continuous ground material/i);
  assert.match(instrument?.start ?? "", /stair direction/i);
  assert.match(instrument?.description ?? "", /exact global BPM clock/i);
  assert.match(instrument?.start ?? "", /tempo stays independent/i);
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["voice-synths", "sequencers", "geometry-drums"],
  );
  assert.deepEqual(
    instrument?.features,
    ["Built-in source", "Pointer", "Computer keys", "MIDI"],
  );

  const midi = instrumentMidiCapabilityForId("quadruped");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Monstrozoid is a continuous mutable pressure-network voice with page-owned valve keys", () => {
  const instrument = instrumentById("colony-syrinx");
  assert.equal(instrument?.label, "Monstrozoid");
  assert.equal(instrument?.href, "monstrozoid.html");
  assert.equal(instrument?.imageHref, "assets/instruments/colony-syrinx.webp");
  assert.equal(instrument?.kind, "Mutable pressure-network voice");
  assert.match(instrument?.description ?? "", /variable lungs/i);
  assert.match(instrument?.description ?? "", /impact, and resonance contours/i);
  assert.doesNotMatch(
    `${instrument?.description ?? ""} ${instrument?.start ?? ""}`,
    /air, water|pellet excitation|excitation material/i,
  );
  assert.match(instrument?.start ?? "", /select a call to hear it immediately/i);
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["voice-synths"],
  );
  assert.ok(instrument?.features.includes("Physical-model DSP"));
  assert.ok(instrument?.features.includes("MIDI"));
  assert.ok(instrument?.features.includes("Computer keys"));

  const midi = instrumentMidiCapabilityForId("colony-syrinx");
  assert.equal(midi?.noteMode, "sequence");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
});

test("Wave Pool catalogues a sample-free hydroacoustic rhythm model", () => {
  const instrument = instrumentById("wave-pool");
  assert.equal(instrument?.label, "Wave Pool");
  assert.equal(instrument?.href, "wave-pool.html");
  assert.equal(instrument?.imageHref, "assets/instruments/wave-pool.webp");
  assert.equal(instrument?.kind, "Hydroacoustic physical-model sequencer");
  assert.match(instrument?.description ?? "", /piston paddles|pneumatic caissons/i);
  assert.match(instrument?.description ?? "", /entrained bubbles/i);
  assert.deepEqual(
    instrument?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.equal(instrument?.status, "Works in progress");
  assert.ok(instrument?.features.includes("Physical-model DSP"));
  assert.ok(instrument?.features.includes("Computer keys"));
  const midi = instrumentMidiCapabilityForId("wave-pool");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.midiOutput, true);
  assert.equal(midi?.computerKeyboardMode, "page");
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
  assert.equal(instrumentMatchesTag(instrumentById("moebius"), "sequencers"), true);
  assert.equal(instrumentMatchesTag(instrumentById("shape"), "faves"), true);
  assert.equal(instrumentMatchesTag(instrumentById("lattice"), "faves"), true);
});

test("home catalogue shows every category with Faves first and compact duplicate links", () => {
  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
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

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    dispatch(name) {
      this.listeners.get(name)?.();
    }

    getBoundingClientRect() {
      return {
        left: 20,
        top: 240,
        width: 70,
        bottom: 308,
      };
    }
  }

  const doc = {};
  doc.createElement = (tagName) => new FakeElement(tagName, doc);
  const rootElement = new FakeElement("div", doc);
  const rendered = renderInstrumentCatalog(rootElement);
  const groupIds = rendered.groups.map(({ id }) => id);
  assert.deepEqual(groupIds, [FIRST_CATEGORY_ID, ...INSTRUMENT_GROUPS.map(({ id }) => id)]);
  assert.equal(rootElement.children.length, rendered.groups.length + 1);
  assert.deepEqual(rootElement.children.slice(0, -1), rendered.groups.map(({ section }) => section));
  assert.equal(rootElement.children.at(-1), rendered.preview.node);
  assert.equal(rendered.groups[0].heading.textContent, "Faves");
  assert.equal(rendered.groups[1].heading.textContent, "Geometry Synths");

  const orderedInstruments = orderHomepageInstruments(INSTRUMENTS);
  const expectedCardCount = INSTRUMENTS.reduce((sum, { tags }) => sum + tags.length, 0);
  assert.equal(rendered.cards.length, expectedCardCount);
  const renderedInstrumentIds = new Set(rendered.cards.map(({ dataset }) => dataset.instrumentId));
  assert.equal(renderedInstrumentIds.size, INSTRUMENTS.length);
  assert.deepEqual(
    renderedInstrumentIds,
    new Set(INSTRUMENTS.map(({ id }) => id)),
  );

  for (const group of rendered.groups) {
    assert.equal(group.section.dataset.categoryId, group.id);
    assert.equal(group.grid.dataset.categoryId, group.id);
    assert.deepEqual(
      group.cards.map(({ dataset }) => dataset.instrumentId),
      orderedInstruments
        .filter((instrument) => instrumentMatchesTag(instrument, group.id))
        .map(({ id }) => id),
    );
  }

  const faveIds = new Set(FAVE_TOOL_IDS);
  assert.deepEqual(
    rendered.groups[0].cards.map(({ dataset }) => dataset.instrumentId),
    orderedInstruments.filter(({ id }) => faveIds.has(id)).map(({ id }) => id),
  );
  for (const faveId of FAVE_TOOL_IDS) {
    const fave = instrumentById(faveId);
    assert.ok(rendered.groups[0].cards.some(({ dataset }) => dataset.instrumentId === faveId));
    assert.ok(
      rendered.groups.find(({ id }) => id === fave.tags[0].id)
        .cards.some(({ dataset }) => dataset.instrumentId === faveId),
    );
  }

  const firstInstrument = orderedInstruments.find((instrument) => faveIds.has(instrument.id));
  const firstCard = rendered.cards[0];
  const [cardLink] = firstCard.children;
  const [visual, title] = cardLink.children;
  const [image] = visual.children;
  assert.equal(firstCard.children.length, 1);
  assert.equal(cardLink.tagName, "a");
  assert.equal(cardLink.href, firstInstrument.href);
  assert.equal(cardLink.attributes.get("aria-label"), firstInstrument.label);
  assert.equal(visual.tagName, "span");
  assert.equal(image.tagName, "img");
  assert.equal(image.alt, "");
  assert.equal(image.src, firstInstrument.imageHref);
  assert.equal(title.tagName, "h3");
  assert.equal(title.textContent, firstInstrument.label);
  assert.equal(cardLink.children.length, 2);
  assert.equal(rendered.preview.node.hidden, true);
  assert.equal(rendered.preview.node.attributes.get("aria-hidden"), "true");

  cardLink.dispatch("pointerenter");
  const [previewVisual, previewCopy] = rendered.preview.node.children;
  const [previewImage] = previewVisual.children;
  const [previewTitle, previewDescription] = previewCopy.children;
  assert.equal(rendered.preview.node.hidden, false);
  assert.equal(previewImage.src, firstInstrument.imageHref);
  assert.equal(previewTitle.textContent, firstInstrument.label);
  assert.ok(previewDescription.textContent.length > 0);
  assert.ok(previewDescription.textContent.length <= 150);
  assert.equal(rendered.preview.node.style.left, "8px");
  assert.equal(rendered.preview.node.style.top, "232px");

  cardLink.dispatch("pointerleave");
  assert.equal(rendered.preview.node.hidden, true);
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
  assert.equal(instrumentById("ourorourobouroboros")?.label, "Ourorourobouroboros");
  assert.equal(instrumentById("ourorourobouroboros")?.href, "ourorourobouroboros.html");
  assert.equal(instrumentById("ourorourobouroboros")?.kind, "Recursive rhythm-pitch synth");
  assert.match(
    instrumentById("ourorourobouroboros")?.description ?? "",
    /slow.*rhythm.*pitch.*silences.*high spectrum/i,
  );
  assert.match(instrumentById("ourorourobouroboros")?.description ?? "", /phase-locked gates/i);
  assert.match(instrumentById("ourorourobouroboros")?.start ?? "", /add or remove Shepard rings/i);
  assert.ok(instrumentById("ourorourobouroboros")?.features.includes("Built-in synth"));
  assert.ok(instrumentById("ourorourobouroboros")?.features.includes("Pointer"));
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
      { id: "faves", label: "Faves" },
    ],
  );
  assert.deepEqual(
    instrumentById("escher-tessellation")?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.equal(instrumentById("penrose-tilings")?.label, "Penrose Tilings");
  assert.equal(instrumentById("penrose-tilings")?.status, "Works in progress");
  assert.deepEqual(
    instrumentById("penrose-tilings")?.tags.map(({ id }) => id),
    ["experiments"],
  );
  assert.deepEqual(
    INSTRUMENT_GROUPS.find(({ id }) => id === "apps")?.tools.map(({ id }) => id),
    ["combo", "l-systems", "tiles-app", "algorithmic-mazes", "paths"],
  );
  assert.deepEqual(
    instrumentById("tiles-app")?.tags.map(({ id }) => id),
    ["apps"],
  );
  assert.deepEqual(
    instrumentById("algorithmic-mazes")?.tags.map(({ id }) => id),
    ["apps"],
  );
  assert.deepEqual(
    instrumentById("paths")?.tags.map(({ id }) => id),
    ["apps"],
  );
  const tileIds = [
    "lattice",
    "spiral",
    "lattice-drums",
    "spiral-drums",
  ];
  assert.deepEqual(
    INSTRUMENT_GROUPS.find(({ id }) => id === "tiles")?.tools.map(({ id }) => id),
    tileIds,
  );
  const faveTileIds = new Set(["lattice", "spiral"]);
  for (const id of tileIds) {
    assert.deepEqual(
      instrumentById(id)?.tags.map(({ id: tagId }) => tagId),
      ["tiles", ...(faveTileIds.has(id) ? ["faves"] : [])],
    );
  }
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
  assert.equal(instrumentById("sliding-puzzle")?.kind, "2D puzzle sequencer");
  assert.match(instrumentById("sliding-puzzle")?.description ?? "", /resizable.*2 × 2.*8 × 8.*rectangular.*parallel rows.*silent cell/i);
  assert.match(instrumentById("sliding-puzzle")?.start ?? "", /complete lines.*rectangle.*scramble.*Solve.*exact move history/i);
  assert.deepEqual(
    instrumentById("sliding-puzzle")?.features,
    ["Pointer", "Built-in synth", "MIDI"],
  );
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

test("card renderer stays a dense, complete activity-ranked visual index", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("instrument-catalog-app.js", root), "utf8"),
    readFile(new URL("instrument-catalog.css", root), "utf8"),
  ]);
  assert.equal(new Set(HOMEPAGE_ACTIVITY_IDS).size, HOMEPAGE_ACTIVITY_IDS.length);
  assert.deepEqual(
    HOMEPAGE_ACTIVITY_IDS.filter((id) => !instrumentById(id)),
    [],
  );
  assert.match(app, /const instruments = orderHomepageInstruments\(INSTRUMENTS\)/);
  assert.match(app, /const groupViews = homepageCategories\(\)\.map/);
  assert.match(app, /image\.loading = index < 12 \? "eager" : "lazy"/);
  assert.match(app, /image\.decoding = index < 12 \? "sync" : "async"/);
  const cardRenderer = app.slice(app.indexOf("function createCard"));
  assert.ok(cardRenderer.indexOf("image.loading =") < cardRenderer.indexOf("image.src = instrument.imageHref"));
  assert.match(app, /grid\.append\(\.\.\.groupCards\)/);
  assert.match(app, /root\.replaceChildren\(\.\.\.groupViews\.map/);
  assert.match(app, /const section = element\(doc, "section", "catalogue-group"\)/);
  assert.match(app, /FIRST_CATEGORY_ID = "faves"/);
  assert.doesNotMatch(app, /import\s*\{[^}]*FAVE_TOOL_IDS/s);
  assert.match(app, /element\(doc, "a", "instrument-card-link"\)/);
  assert.match(app, /cardLink\.href = instrument\.href/);
  assert.match(app, /cardLink\.setAttribute\("aria-label", instrument\.label\)/);
  assert.match(app, /cardLink\.append\(visual, title\)/);
  assert.match(app, /card\.append\(cardLink\)/);
  assert.match(app, /function createPreview\(doc\)/);
  assert.match(app, /cardLink\.addEventListener\("pointerenter"/);
  assert.match(app, /cardLink\.addEventListener\("focus"/);
  assert.match(app, /preview\.description\.textContent = previewDescription\(instrument\.description\)/);
  assert.doesNotMatch(app, /instrument-start|instrument-tags/);
  assert.doesNotMatch(app, /instrument\.start|instrument\.status/);
  assert.doesNotMatch(app, /catalogue-tag-filter|catalogue-category-button|image-preview/);
  assert.match(css, /\.catalogue-group-title\s*\{/);
  assert.doesNotMatch(css, /catalogue-category-nav|catalogue-category-button/);
  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(70px, 1fr\)\)/);
  assert.match(css, /\.instrument-card-link\s*\{[^}]*min-height: 68px;/s);
  assert.match(css, /\.instrument-card-visual\s*\{[^}]*width: 34px;[^}]*height: 34px;/s);
  assert.match(css, /\.instrument-card-preview\s*\{[^}]*position: fixed;/s);
  assert.match(css, /\.instrument-card-preview\s*\{[^}]*pointer-events: none;/s);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 340px\)[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /catalogue-tag-filter|catalogue-experiments/);
});


test("Roach Synth is discoverable in the main chooser with current body-instrument copy", () => {
  const group = TOOL_GROUPS.find(({ id }) => id === "voice-synths");
  const entry = group.tools.find(({ id }) => id === "roach-synth");
  assert.equal(entry.href, "roach-synth.html");
  assert.notEqual(group.picker, false);
  assert.equal(TOOL_GROUPS.flatMap(({ tools }) => tools).filter(({ id }) => id === "roach-synth").length, 1);
  const instrument = instrumentById("roach-synth");
  assert.equal(instrument.status, null);
  assert.equal(instrument.tags[0].id, "voice-synths");
  assert.match(instrument.description, /31 playable joints/);
  assert.match(instrument.description, /body-part mixer/);
  assert.doesNotMatch(instrument.description + instrument.start, /27 playable|16-step|joint score|edit each joint.s loop/);
  assert.ok(instrument.features.includes("Recordings"));
});
