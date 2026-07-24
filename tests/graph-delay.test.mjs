import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GRAPH_PRESETS,
  MAX_GRAPH_FEEDBACK,
  edgeAudioParameters,
  generateGraph,
} from "../src/graph-delay.js";

test("graph-delay offers acyclic, cyclic, community, and random topology families", () => {
  for (const type of ["chain", "tree", "dag", "bipartite", "ring", "smallworld", "hub", "mesh", "modular", "random"]) {
    assert.ok(GRAPH_PRESETS[type]);
    const graph = generateGraph({ type, nodeCount: 12, density: 0.6, seed: 17 });
    assert.equal(graph.nodes.length, 12);
    assert.ok(graph.edges.length > 0);
  }
  for (const type of ["chain", "tree", "dag", "bipartite"]) {
    assert.equal(generateGraph({ type, nodeCount: 12, density: 1, seed: 2 }).cyclic, false);
  }
  for (const type of ["ring", "smallworld", "hub", "mesh", "modular"]) {
    assert.equal(generateGraph({ type, nodeCount: 12, density: 1, seed: 2 }).cyclic, true);
  }
});

test("UI topology state selects the requested generator instead of falling back to DAG", () => {
  const ring = generateGraph({ topology: "ring", nodeCount: 10, density: 0.34, seed: 17 });
  assert.equal(ring.type, "ring");
  assert.equal(ring.edges.length, 10);
  assert.equal(ring.cyclic, true);

  const tree = generateGraph({ topology: "tree", nodeCount: 10, density: 0.34, seed: 17 });
  assert.equal(tree.type, "tree");
  assert.equal(tree.edges.length, 9);
  assert.equal(tree.cyclic, false);
});

test("cyclic edge gains are normalized below unity at every receiving node", () => {
  const graph = generateGraph({ type: "mesh", nodeCount: 24, density: 1, seed: 9 });
  const parameters = edgeAudioParameters(graph, { feedback: MAX_GRAPH_FEEDBACK, baseDelay: 8, dispersion: 1 });
  for (const node of graph.nodes) {
    const sum = parameters.filter((edge) => edge.cyclic && edge.to === node.id)
      .reduce((total, edge) => total + edge.gain, 0);
    assert.ok(sum <= MAX_GRAPH_FEEDBACK + Number.EPSILON);
  }
  assert.ok(parameters.every((edge) => edge.delaySeconds >= 0.004));
});

test("edge length maps monotonically to time while node positions remain editable", () => {
  const graph = generateGraph({ type: "chain", nodeCount: 3 });
  graph.nodes[0].x = 0.1;
  graph.nodes[1].x = 0.2;
  graph.nodes[2].x = 0.9;
  graph.nodes[1].y = 0.2;
  const parameters = edgeAudioParameters(graph, { baseDelay: 24, timeScale: 1_000 });
  assert.ok(parameters[1].normalizedLength > parameters[0].normalizedLength);
  assert.ok(parameters[1].delaySeconds > parameters[0].delaySeconds);
  assert.equal(graph.nodes[1].y, 0.2);
});

test("default edge timing stays near one shared rhythmic delay", () => {
  const graph = generateGraph({ type: "smallworld", nodeCount: 16, density: 0.5, seed: 17 });
  const parameters = edgeAudioParameters(graph, { baseDelay: 220, timeScale: 60 });
  assert.ok(parameters.every((edge) => edge.delaySeconds >= 0.22));
  assert.ok(parameters.every((edge) => edge.delaySeconds <= 0.28));
});

test("graph-delay page exposes microphone, topology, feedback safety, and panic controls", async () => {
  const root = new URL("../", import.meta.url);
  const [html, app] = await Promise.all([
    readFile(new URL("graph-delay.html", root), "utf8"),
    readFile(new URL("graph-delay-app.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="micmic-page graph-delay-page">/);
  assert.match(html, /graph-delay-tab active/);
  for (const id of ["stage", "audioButton", "micButton", "panicButton", "topology", "nodeCount", "density", "seed", "nodeMotionPlayButton", "nodeMotionMode", "nodeMotionSpeed", "nodeMotionAmount", "micMotionPlayButton", "micMotionMode", "micMotionSpeed", "micMotionSize", "resetViewButton", "baseDelay", "timeScale", "inputPitchReference", "pitchFloor", "pitchCeiling", "feedback", "damping", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of ["Delay Chain", "Branching Tree", "Layered DAG", "Bipartite Field", "Directed Ring", "Small World", "Hub \\+ Spokes", "Feedback Mesh", "Modular Islands", "Seeded Random"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /Use headphones/);
  assert.match(html, /MIC IN and SPEAKERS OUT/);
  assert.match(html, /wiggle, orbit, or randomly walk/);
  assert.match(html, /Press Escape for an immediate panic stop/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /createDelay\(2\.2\)/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeSoftClipCurve/);
  assert.match(app, /function panic/);
  assert.match(app, /pointerdown/);
  assert.match(app, /nodePitchSemitones/);
  assert.match(app, /function nodePitchTargetHz/);
  assert.match(app, /function nodeRelationAngle/);
  assert.match(html, /id="pitchFloor"[^>]*min="20"[^>]*value="40"/);
  assert.match(html, /id="pitchCeiling"[^>]*value="1280"/);
  assert.match(html, /id="baseDelay"[^>]*value="220"/);
  assert.match(html, /id="timeScale"[^>]*value="60"/);
  assert.doesNotMatch(html, /±12 semitones|id="pitchRange"/);
  assert.match(app, /graph-pitch-processor/);
  assert.match(app, /function geometryModel/);
  assert.match(app, /function exitNodeIds/);
  assert.match(app, /function audibleOutputNodeIds/);
  assert.match(app, /function terminalDelaySeconds/);
  assert.match(app, /function scheduleGraphRebuild/);
  assert.match(app, /function flushGraphRebuild/);
  assert.match(app, /linearRampToValueAtTime\(state\.level/);
  assert.match(app, /node\.port\?\.close/);
  assert.match(app, /0\.9 \/ Math\.sqrt\(exits\.length\)/);
  assert.match(app, /draggingTerminal/);
  assert.match(app, /function advanceNodeMotion/);
  assert.match(app, /function bakeNodeMotion/);
  assert.match(app, /function advanceMicrophoneMotion/);
  assert.match(app, /function visualArrivalTimes/);
  assert.match(app, /arrivalTimes\[edge\.from\]/);
  assert.match(app, /function drawMicrophonePathGuide/);
  for (const motion of ["circle", "ellipse", "triangle", "square", "figure8", "random"]) {
    assert.match(html, new RegExp(`value="${motion}"`));
  }
  for (const motion of ["wiggle", "orbit", "random"]) {
    assert.match(html, new RegExp(`value="${motion}"`));
  }
  assert.doesNotMatch(html, /id="rotation(?:PlayButton|Speed)?"/);
});
