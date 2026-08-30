import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOOL_GROUPS } from "../nav.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);

test("Graph Drum Machine and Graph Synth expose the shared graph-feedback workbench", async () => {
  const [drums, synth, css, app, drumWrapper, synthWrapper, research] = await Promise.all([
    readFile(new URL("graph-drums.html", root), "utf8"),
    readFile(new URL("graph-synth.html", root), "utf8"),
    readFile(new URL("graph-instruments.css", root), "utf8"),
    readFile(new URL("src/graph-instrument-app.js", root), "utf8"),
    readFile(new URL("graph-drums-app.js", root), "utf8"),
    readFile(new URL("graph-synth-app.js", root), "utf8"),
    readFile(new URL("GRAPH_INSTRUMENTS_RESEARCH.md", root), "utf8"),
  ]);

  assert.match(drums, /<title>Graph Drum Machine — Morphazoid<\/title>/);
  assert.match(drums, /data-graph-instrument="drums"/);
  assert.match(drums, /id="drumMap"/);
  assert.match(drums, /id="percussionStyle"/);
  assert.match(drums, /src="graph-drums-app\.js"/);
  assert.match(synth, /<title>Graph Synth — Morphazoid<\/title>/);
  assert.match(synth, /data-graph-instrument="synth"/);
  assert.match(synth, /id="baseFrequency"/);
  assert.match(synth, /id="soundMode"/);
  assert.match(synth, /src="graph-synth-app\.js"/);

  for (const html of [drums, synth]) {
    for (const id of [
      "stage", "audioButton", "playButton", "pulseButton", "seedPulseButton",
      "seedKeyboard", "seedOctaveDown", "seedOctaveOut", "seedOctaveUp",
      "tempo", "pulseDivision", "randomGraphButton",
      "graphPatch", "graphPatchGrid", "topology", "nodeCount", "density", "seed",
      "newGraphButton", "arrangeGraphButton", "scatterGraphButton", "openAllSwitchesButton",
      "triggerScope", "edgeSubdivisions", "nodePass", "baseDelay", "timeScale",
      "timeCurve", "feedback", "feedbackTone", "motionSection", "motionSummary",
      "nodeMotionPlayButton", "nodeMotionMode", "nodeMotionSpeed", "nodeMotionSpeedOut",
      "nodeMotionAmount", "nodeMotionAmountOut", "mappingMode", "mappingReadout",
      "structureReadout", "cycleReadout", "tailReadout", "resetAll", "liveStatus",
    ]) assert.match(html, new RegExp(`id="${id}"`));
    for (const patch of [
      "clearSteps", "branchChoir", "layeredGlass", "haloRing",
      "shortcutChorus", "hubScatter", "softMesh", "islandSignals",
    ]) assert.match(html, new RegExp(`data-graph-patch="${patch}"`));
    for (const topology of [
      "chain", "tree", "dag", "bipartite", "ring", "smallworld",
      "hub", "mesh", "modular", "random",
    ]) assert.match(html, new RegExp(`option value="${topology}"`));
    assert.match(html, /Cycles are (?:musical|note) feedback/);
    assert.match(html, /id="randomGraphButton"[^>]*>Random<\/button>/);
    assert.match(html, /id="nodeCount"[^>]*max="512"/);
    assert.match(html, /id="edgeSubdivisions"[^>]*min="1"[^>]*max="16"/);
    assert.match(html, /option value="all"/);
    assert.match(html, /option value="leaves"/);
    assert.match(html, /option value="subdivisions"/);
    assert.equal(
      [...html.matchAll(/data-seed-semitone="(?:[0-9]|1[0-2])"/g)].length,
      13,
      "the seed keyboard exposes one chromatic octave plus its upper C",
    );
    assert.match(html, /Drag nodes to change edge times/);
    assert.ok(
      html.indexOf('id="delaySection"') < html.indexOf('id="topologySection"'),
      "Time + feedback sits above topology and presets",
    );
  }

  for (const id of [
    "tuningMode", "edoDivisions", "articulation", "noteDuration",
    "attack", "decay", "sustain", "release",
  ]) assert.match(synth, new RegExp(`id="${id}"`));
  assert.match(synth, /<option value="pure">Pure angle · continuous<\/option>/);
  assert.match(synth, /<option value="equal"[^>]*>Equal octave divisions<\/option>/);
  assert.match(synth, /<option value="just">Just ratios · non-equal<\/option>/);
  assert.match(synth, /id="edoDivisions"[^>]*min="1"[^>]*max="360"[^>]*step="1"/);
  assert.match(synth, /<option value="edge">Continuous · hold for edge time<\/option>/);
  assert.doesNotMatch(synth, /<option value="(?:major|minor|pentatonic|whole-tone|chromatic)"/);

  assert.match(css, /\.graph-drums-page/);
  assert.match(css, /\.graph-synth-page/);
  assert.match(css, /\.graph-drum-map/);
  assert.match(css, /\.graph-instrument-page \.graph-preset-grid\s*\{[^}]*repeat\(4,/s);
  assert.match(app, /scheduleGraphPulse/);
  assert.match(app, /horizonSeconds: 1_024/);
  assert.match(app, /maxNodes: MAX_GRAPH_INSTRUMENT_NODES/);
  assert.match(app, /invalidatePulseTemplate\(\{ clearRuns: false/);
  assert.match(app, /startAt/);
  assert.match(app, /edge\.feedbackEdge/);
  assert.match(app, /feedbackTone/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /patch\.pulseBeats \?\? patch\.pulseDivision/);
  assert.match(app, /randomGraphButton[^\n]*addEventListener\("click", randomizeGraph\)/);
  assert.match(drumWrapper, /mode: "drums"/);
  assert.match(synthWrapper, /mode: "synth"/);
  assert.match(research, /L-system synth/i);
  assert.match(research, /cycle-closing/i);
  assert.match(research, /feedbackEdge/);
});

test("both Graph instruments are registered in navigation, catalogue, and MIDI", () => {
  const tools = TOOL_GROUPS.flatMap(({ tools: entries }) => entries);
  const graphDrums = tools.find(({ id }) => id === "graph-drums");
  const graphSynth = tools.find(({ id }) => id === "graph-synth");
  assert.deepEqual(
    { label: graphDrums?.label, href: graphDrums?.href },
    { label: "Graph Drum Machine", href: "graph-drums.html" },
  );
  assert.deepEqual(
    { label: graphSynth?.label, href: graphSynth?.href },
    { label: "Graph Synth", href: "graph-synth.html" },
  );
  assert.equal(
    TOOL_GROUPS.find(({ id }) => id === "geometry-drums").tools.includes(graphDrums),
    true,
  );
  assert.equal(
    TOOL_GROUPS.find(({ id }) => id === "geometry").tools.includes(graphSynth),
    true,
  );

  const drumRecord = INSTRUMENTS.find(({ id }) => id === "graph-drums");
  const synthRecord = INSTRUMENTS.find(({ id }) => id === "graph-synth");
  assert.equal(drumRecord?.kind, "Network drum machine");
  assert.equal(synthRecord?.kind, "Network synth");
  assert.ok(drumRecord.tags.some(({ id }) => id === "fractals-recursion"));
  assert.ok(synthRecord.tags.some(({ id }) => id === "fractals-recursion"));
  assert.equal(drumRecord.imageHref, "assets/instruments/graph-drums.webp");
  assert.equal(synthRecord.imageHref, "assets/instruments/graph-synth.webp");

  const drumMidi = instrumentMidiCapabilityForId("graph-drums");
  const synthMidi = instrumentMidiCapabilityForId("graph-synth");
  assert.equal(drumMidi.noteMode, "drums");
  assert.equal(drumMidi.computerKeyboardMode, "midi");
  assert.equal(drumMidi.midiOutput, true);
  assert.equal(synthMidi.noteMode, "pitched");
  assert.equal(synthMidi.computerKeyboardMode, "midi");
  assert.equal(synthMidi.midiOutput, true);
});

test("the release builder includes every new Graph instrument runtime file", async () => {
  const build = await readFile(new URL("scripts/build-site.sh", root), "utf8");
  for (const file of [
    "graph-drums.html",
    "graph-synth.html",
    "graph-instruments.css",
    "graph-drums-app.js",
    "graph-synth-app.js",
    "src/graph-instrument-app.js",
    "src/graph-instruments.js",
    "src/graph-synth-audio.js",
    "GRAPH_INSTRUMENTS_RESEARCH.md",
  ]) {
    assert.match(build, new RegExp(file.replace(/[./-]/g, "\\$&")));
  }
});
