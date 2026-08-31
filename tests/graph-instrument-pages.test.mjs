import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOOL_GROUPS } from "../nav.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);

test("Graph Drum Machine and Graph Synth expose the shared graph-feedback workbench", async () => {
  const [drums, synth, css, app, core, drumAudio, drumWrapper, synthWrapper, research] = await Promise.all([
    readFile(new URL("graph-drums.html", root), "utf8"),
    readFile(new URL("graph-synth.html", root), "utf8"),
    readFile(new URL("graph-instruments.css", root), "utf8"),
    readFile(new URL("src/graph-instrument-app.js", root), "utf8"),
    readFile(new URL("src/graph-instruments.js", root), "utf8"),
    readFile(new URL("src/graph-drum-audio.js", root), "utf8"),
    readFile(new URL("graph-drums-app.js", root), "utf8"),
    readFile(new URL("graph-synth-app.js", root), "utf8"),
    readFile(new URL("GRAPH_INSTRUMENTS_RESEARCH.md", root), "utf8"),
  ]);

  assert.match(drums, /<title>Graph Drum Machine — Morphazoid<\/title>/);
  assert.match(drums, /data-graph-instrument="drums"/);
  assert.match(drums, /id="drumMap"/);
  assert.match(drums, /id="percussionStyle"/);
  assert.match(drums, /class="graph-play-percussion-bank"/);
  assert.match(drums, /<details class="group control-section" id="mappingSection" data-section="mapping">/);
  assert.match(drums, /<option value="circuit" selected>Circuit percussion<\/option>/);
  assert.ok(
    drums.indexOf('id="playSection"') < drums.indexOf('id="percussionStyle"')
      && drums.indexOf('id="drumMap"') < drums.indexOf('id="delaySection"')
      && drums.indexOf('id="delaySection"') < drums.indexOf('id="mappingSection"'),
    "the playable percussion bank belongs inside Play while Time stays high",
  );
  assert.ok(
    drums.indexOf('id="percussionStyle"') < drums.indexOf('id="drumMap"')
      && drums.indexOf('id="drumMap"') < drums.indexOf('id="mappingMode"'),
    "the playable bank belongs above the secondary mapping controls",
  );
  for (const [id, label] of [
    ["rattlesnake", "Rattlesnake"],
    ["rattlesnake-physical", "Rattlesnake physical"],
    ["karplus-strong", "Karplus Strong"],
    ["karplus-tines", "Karplus tines"],
    ["karplus-objects", "Karplus objects"],
  ]) {
    assert.match(drums, new RegExp(`<option value="${id}">${label}<\\/option>`));
    assert.equal((drums.match(new RegExp(`value="${id}"`, "g")) ?? []).length, 1);
  }
  assert.match(drums, /src="graph-drums-app\.js(?:\?[^\"]+)?"/);
  assert.match(synth, /<title>Graph Synth — Morphazoid<\/title>/);
  assert.match(synth, /data-graph-instrument="synth"/);
  assert.match(synth, /id="outputOut"[^>]*>64%<\/output>/);
  assert.match(synth, /id="output"[^>]*value="0\.64"/);
  assert.doesNotMatch(synth, /id="baseFrequency"/);
  assert.match(synth, /id="soundMode"/);
  assert.match(synth, /src="graph-synth-app\.js(?:\?[^\"]+)?"/);

  for (const html of [drums, synth]) {
    for (const id of [
      "stage", "audioButton", "playButton", "pulseButton", "seedNote", "seedNoteOut",
      "tempo", "pulseDivision", "randomGraphButton",
      "graphPatch", "graphPatchGrid", "topology", "nodeCount", "density", "seed",
      "newGraphButton", "arrangeGraphButton", "scatterGraphButton", "openAllSwitchesButton",
      "triggerScope", "nodePass", "baseDelay", "distanceRatio",
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
    assert.match(html, /id="nodeCount"[^>]*max="32"/);
    assert.match(html, /id="distanceRatio"[^>]*min="1"[^>]*max="12"[^>]*step="0\.01"/);
    assert.match(html, /At 1×, every edge uses the minimum time/);
    assert.doesNotMatch(html, /id="timeScale"|Distance → extra time/);
    assert.match(html, /option value="all"/);
    assert.match(html, /option value="leaves"/);
    assert.doesNotMatch(html, /id="edgeSubdivisions"/);
    assert.doesNotMatch(html, /option value="subdivisions"/);
    const seedNoteInput = html.match(/<input\b[^>]*id="seedNote"[^>]*>/)?.[0] ?? "";
    assert.match(seedNoteInput, /type="range"/);
    assert.match(seedNoteInput, /min="0"/);
    assert.match(seedNoteInput, /max="127"/);
    assert.match(seedNoteInput, /step="1"/);
    const seedNoteValue = Number(seedNoteInput.match(/value="(\d+)"/)?.[1]);
    assert.ok(
      Number.isInteger(seedNoteValue) && seedNoteValue >= 0 && seedNoteValue <= 127,
      "the initial seed note must be a valid MIDI note",
    );
    assert.ok(
      html.indexOf('id="playSection"') < html.indexOf('id="seedNote"')
        && html.indexOf('id="seedNote"') < html.indexOf('id="delaySection"'),
      "the compact seed-note control belongs in Play instead of over the graph",
    );
    assert.ok(
      html.indexOf('id="playSection"') < html.indexOf('id="topology"')
        && html.indexOf('id="topology"') < html.indexOf('id="delaySection"')
        && html.indexOf('id="playSection"') < html.indexOf('id="baseDelay"')
        && html.indexOf('id="baseDelay"') < html.indexOf('id="delaySection"'),
      "Graph shape and Edge speed belong in the top Play panel",
    );
    for (const uniqueId of ["topology", "baseDelay", "baseDelayOut", "nodeCount"]) {
      assert.equal(
        (html.match(new RegExp(`id="${uniqueId}"`, "g")) ?? []).length,
        1,
        `${uniqueId} must have one authoritative control`,
      );
    }
    assert.match(html, /<b>Edge speed<\/b>/);
    const edgeSpeedInput = html.match(/<input\b[^>]*id="baseDelay"[^>]*>/)?.[0] ?? "";
    assert.match(edgeSpeedInput, /min="20"/);
    assert.match(edgeSpeedInput, /max="600"/);
    assert.match(edgeSpeedInput, /step="1"/);
    assert.match(edgeSpeedInput, /value="62"/);
    assert.match(edgeSpeedInput, /dir="rtl"/);
    assert.match(edgeSpeedInput, /aria-label="Edge speed, slow to fast"/);
    assert.match(html, /id="baseDelayOut"[^>]*>968 BPM eq\. · 62 ms<\/output>/);
    assert.match(html, /<b>Pulse tempo<\/b>/);
    assert.doesNotMatch(html, /id="seedPulseButton"|id="seedKeyboard"|id="seedOctave(?:Down|Out|Up)"/);
    assert.doesNotMatch(html, /data-seed-semitone|class="[^"]*graph-seed-keyboard/);
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
  assert.match(css, /\.graph-seed-note-control\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.graph-play-primary-grid\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css, /\.graph-seed-(?:keyboard|keyboard-head|keys)\b/);
  assert.doesNotMatch(css, /\.graph-pulse-control\b/);
  assert.match(app, /scheduleGraphPulse/);
  assert.match(app, /new GraphDrumAudio\(runtime\)/);
  assert.match(app, /horizonSeconds: 1_024/);
  assert.match(app, /maxNodes: MAX_GRAPH_INSTRUMENT_NODES/);
  assert.match(core, /MAX_GRAPH_INSTRUMENT_NODES = 32/);
  assert.match(drumAudio, /class GraphDrumAudio/);
  assert.match(drumAudio, /new FmDrumAudio\(runtime\)/);
  assert.match(drumAudio, /new LinearDrumAudio\(runtime\)/);
  assert.match(drumAudio, /translateGraphDrumStartAt/);
  assert.match(drumAudio, /MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND/);
  assert.doesNotMatch(core, /edgeSubdivisions|kind: "subdivision"/);
  assert.match(app, /invalidatePulseTemplate\(\{ clearRuns: false/);
  assert.match(app, /startAt/);
  assert.match(app, /edge\.feedbackEdge/);
  assert.match(app, /feedbackTone/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /bindRange\("seedNote",\s*"seedNote"/);
  assert.doesNotMatch(app, /seedPulseButton|seedKeyboard|seedOctave|data-seed-semitone/);
  assert.match(app, /patch\.pulseBeats \?\? patch\.pulseDivision/);
  assert.match(app, /randomGraphButton[^\n]*addEventListener\("click", randomizeGraph\)/);
  assert.match(app, /const MAX_VISIBLE_RUNS = 4/);
  assert.doesNotMatch(app, /2\.5 \+ amplitude \* 4/);
  assert.doesNotMatch(app, /10 \+ age \* 70/);
  assert.match(drumWrapper, /mode: "drums"/);
  assert.match(synthWrapper, /mode: "synth"/);
  assert.match(research, /L-system synth/i);
  assert.match(research, /cycle-closing/i);
  assert.match(research, /feedbackEdge/);
});

test("Graph pages cannot mix refreshed markup with stale Graph runtime modules", async () => {
  const [drums, synth, drumWrapper, synthWrapper, app, core, devServer] = await Promise.all([
    readFile(new URL("graph-drums.html", root), "utf8"),
    readFile(new URL("graph-synth.html", root), "utf8"),
    readFile(new URL("graph-drums-app.js", root), "utf8"),
    readFile(new URL("graph-synth-app.js", root), "utf8"),
    readFile(new URL("src/graph-instrument-app.js", root), "utf8"),
    readFile(new URL("src/graph-instruments.js", root), "utf8"),
    readFile(new URL("scripts/dev-server.py", root), "utf8"),
  ]);
  const version = "graph-instruments-20260830-5";

  assert.match(drums, new RegExp(`href="graph-instruments\\.css\\?v=${version}"`));
  assert.match(synth, new RegExp(`href="graph-instruments\\.css\\?v=${version}"`));
  assert.match(drums, new RegExp(`src="graph-drums-app\\.js\\?v=${version}"`));
  assert.match(synth, new RegExp(`src="graph-synth-app\\.js\\?v=${version}"`));
  for (const wrapper of [drumWrapper, synthWrapper]) {
    assert.match(
      wrapper,
      new RegExp(`from "\\./src/graph-instrument-app\\.js\\?v=${version}"`),
    );
  }
  for (const dependency of [
    "graph-drum-audio", "graph-delay", "graph-instruments", "graph-synth-audio",
  ]) {
    assert.match(
      app,
      new RegExp(`from "\\./${dependency}\\.js\\?v=${version}"`),
      `${dependency} must share the Graph runtime version`,
    );
  }
  assert.match(
    core,
    new RegExp(`from "\\./graph-delay\\.js\\?v=${version}"`),
    "the core scheduler must resolve the same fresh Graph Delay module",
  );
  assert.match(devServer, /class DevelopmentRequestHandler\(SimpleHTTPRequestHandler\):/);
  assert.match(devServer, /self\.send_header\("Cache-Control", "no-store"\)/);
  assert.match(devServer, /partial\(DevelopmentRequestHandler, directory=str\(PROJECT_ROOT\)\)/);
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
    "src/graph-drum-audio.js",
    "src/graph-synth-audio.js",
    "assets/instruments/graph-drums.webp",
    "assets/instruments/graph-synth.webp",
    "GRAPH_INSTRUMENTS_RESEARCH.md",
  ]) {
    assert.match(build, new RegExp(file.replace(/[./-]/g, "\\$&")));
  }
});
