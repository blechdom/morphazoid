import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GRAPH_DELAY_PATCHES,
  GRAPH_PRESETS,
  MAX_GRAPH_FEEDBACK,
  directedHeading,
  edgeAudioParameters,
  generateGraph,
  graphOutputNodeIds,
  graphTurnRoutings,
  nodeTurnRouting,
  relativeTurnRadians,
  turnPitchSemitones,
} from "../src/graph-delay.js";

function spectralRadius(nodeCount, edges, iterations = 500) {
  let vector = Array(nodeCount).fill(1 / Math.sqrt(nodeCount));
  let norm = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = Array(nodeCount).fill(0);
    for (const edge of edges) next[edge.to] += edge.gain * vector[edge.from];
    norm = Math.hypot(...next);
    if (!norm) return 0;
    vector = next.map((value) => value / norm);
  }
  return norm;
}

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

test("graph-delay defaults cover many safe acyclic, cyclic, and generative sounds", () => {
  assert.ok(Object.keys(GRAPH_DELAY_PATCHES).length >= 14);
  const families = new Set();
  for (const patch of Object.values(GRAPH_DELAY_PATCHES)) {
    families.add(patch.family);
    const graph = generateGraph({ ...patch, type: patch.topology });
    const turnRoutes = graphTurnRoutings(graph).reduce(
      (count, routing) => count + routing.turns.length,
      0,
    );
    assert.equal(graph.nodes.length, patch.nodeCount);
    assert.ok(turnRoutes <= 192, `${patch.label} requests ${turnRoutes} turn routes`);
    assert.ok(patch.baseDelay >= 20 && patch.baseDelay <= 600);
    assert.ok(patch.feedback >= 0 && patch.feedback <= MAX_GRAPH_FEEDBACK);
    assert.ok(patch.nodePass >= 0 && patch.nodePass <= 1);
    assert.ok(patch.pitchScale >= 0 && patch.pitchScale <= 2);
    assert.ok(patch.pitchAsymmetry >= -0.8 && patch.pitchAsymmetry <= 0.8);
    assert.ok(patch.pitchCurve >= 0.5 && patch.pitchCurve <= 2);
    assert.ok(patch.pitchSlew >= 10 && patch.pitchSlew <= 500);
  }
  assert.deepEqual([...families].sort(), ["Acyclic", "Cyclic", "Generative"]);
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
    const sum = parameters.filter((edge) => edge.feedbackEdge && edge.to === node.id)
      .reduce((total, edge) => total + edge.gain, 0);
    assert.ok(sum <= MAX_GRAPH_FEEDBACK + Number.EPSILON);
  }
  assert.ok(parameters.every((edge) => edge.delaySeconds >= 0.004));
});

test("feedback decay is applied once per ring lap instead of at every node", () => {
  const graph = generateGraph({ type: "ring", nodeCount: 9 });
  const parameters = edgeAudioParameters(graph, {
    nodePass: 1,
    feedback: 0.6,
  });
  assert.equal(parameters.filter((edge) => edge.feedbackEdge).length, 1);
  assert.equal(parameters.filter((edge) => !edge.feedbackEdge).length, 8);
  assert.ok(Math.abs(
    parameters.reduce((product, edge) => product * edge.gain, 1) - 0.6,
  ) < 1e-12);
});

test("normalized branching keeps a dense cyclic graph below unity", () => {
  const graph = generateGraph({
    type: "smallworld",
    nodeCount: 10,
    density: 0.1,
    seed: 180,
  });
  const parameters = edgeAudioParameters(graph, {
    nodePass: 1,
    feedback: MAX_GRAPH_FEEDBACK,
  });
  assert.ok(spectralRadius(graph.nodes.length, parameters) < 1);
});

test("node pass-through replaces the hidden 78% feed-forward loss", () => {
  const graph = generateGraph({ type: "chain", nodeCount: 4 });
  const retained = edgeAudioParameters(graph, { nodePass: 1 });
  const softened = edgeAudioParameters(graph, { nodePass: 0.5 });
  assert.deepEqual(retained.map((edge) => edge.gain), [1, 1, 1]);
  assert.deepEqual(softened.map((edge) => edge.gain), [0.5, 0.5, 0.5]);
});

test("only graph sinks reach speakers, with a deterministic cyclic monitor tap", () => {
  const chain = generateGraph({ type: "chain", nodeCount: 6 });
  assert.deepEqual(graphOutputNodeIds(chain), [5]);

  const tree = generateGraph({ type: "tree", nodeCount: 7 });
  assert.deepEqual(graphOutputNodeIds(tree), [3, 4, 5, 6]);

  const ring = generateGraph({ type: "ring", nodeCount: 8 });
  assert.deepEqual(graphOutputNodeIds(ring), [7]);
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

test("relative turns create local pitch intervals while straight paths remain unshifted", () => {
  const west = { x: 0, y: 0 };
  const pivot = { x: 1, y: 0 };
  const north = { x: 1, y: -1 };
  const straight = { x: 2, y: 0 };
  assert.equal(directedHeading(pivot, straight), 0);
  assert.ok(Math.abs(relativeTurnRadians(west, pivot, straight)) < 1e-12);
  assert.ok(Math.abs(relativeTurnRadians(west, pivot, north) - Math.PI / 2) < 1e-12);
  assert.equal(turnPitchSemitones(0), 0);
  assert.ok(turnPitchSemitones(Math.PI / 2) > 0);
  assert.ok(turnPitchSemitones(-Math.PI / 2) < 0);
  assert.equal(turnPitchSemitones(Math.PI, { pitchScale: 1 }), 12);
  assert.equal(turnPitchSemitones(-Math.PI, { pitchScale: 1 }), -12);
  assert.equal(turnPitchSemitones(Math.PI / 2, { pitchScale: 1, pitchCurve: 2 }), 3);
  assert.ok(turnPitchSemitones(-Math.PI / 2, {
    pitchScale: 1,
    pitchAsymmetry: 0.5,
  }) < -turnPitchSemitones(Math.PI / 2, {
    pitchScale: 1,
    pitchAsymmetry: 0.5,
  }));
});

test("a graph merge preserves every incoming to outgoing turn pairing", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0, y: 0.2 },
      { id: 1, x: 0, y: 0.8 },
      { id: 2, x: 0.5, y: 0.5 },
      { id: 3, x: 1, y: 0.5 },
    ],
    edges: [
      { id: 0, from: 0, to: 2 },
      { id: 1, from: 1, to: 2 },
      { id: 2, from: 2, to: 3 },
    ],
    entries: [0, 1],
  };
  const routing = nodeTurnRouting(graph, 2);
  assert.equal(routing.sources.length, 2);
  assert.equal(routing.outputs.length, 1);
  assert.equal(routing.turns.length, 2);
  assert.deepEqual(routing.turns.map((turn) => turn.previousEdgeId), [0, 1]);
  assert.deepEqual(routing.turns.map((turn) => turn.nextEdgeId), [2, 2]);
  assert.notEqual(routing.turns[0].semitones, routing.turns[1].semitones);
});

test("turn routing covers every path transition and adds microphone provenance to cycles", () => {
  const graph = generateGraph({ type: "ring", nodeCount: 8, seed: 4 });
  const routings = graphTurnRoutings(graph, { inputPosition: { x: 0, y: 0.5 } });
  const expected = graph.nodes.reduce((count, node) => (
    count + (graph.indegree[node.id] + (node.id === 0 ? 1 : 0)) * graph.outdegree[node.id]
  ), 0);
  assert.equal(routings.reduce((count, routing) => count + routing.turns.length, 0), expected);
  assert.equal(routings[0].sources[0].kind, "input");
  assert.equal(routings[0].sources[1].kind, "edge");
});

test("graph-delay page exposes microphone, topology, feedback safety, and panic controls", async () => {
  const root = new URL("../", import.meta.url);
  const [html, app, turnProcessor] = await Promise.all([
    readFile(new URL("graph-delay.html", root), "utf8"),
    readFile(new URL("graph-delay-app.js", root), "utf8"),
    readFile(new URL("src/graph-turn-processor.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="micmic-page graph-delay-page">/);
  assert.match(html, /graph-delay-tab active/);
  for (const id of ["stage", "audioButton", "micButton", "panicButton", "graphPatch", "topology", "nodeCount", "density", "seed", "nodeMotionPlayButton", "nodeMotionMode", "nodeMotionSpeed", "nodeMotionAmount", "micMotionPlayButton", "micMotionMode", "micMotionSpeed", "micMotionSize", "resetViewButton", "nodePass", "baseDelay", "timeScale", "timeCurve", "pitchScale", "pitchAsymmetry", "pitchCurve", "pitchSlew", "feedback", "damping", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of ["Delay Chain", "Branching Tree", "Layered DAG", "Bipartite Field", "Directed Ring", "Small World", "Hub \\+ Spokes", "Feedback Mesh", "Modular Islands", "Seeded Random"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  for (const patch of Object.values(GRAPH_DELAY_PATCHES)) {
    assert.match(html, new RegExp(`>${patch.label}<`));
  }
  assert.match(html, /Use headphones/);
  assert.match(html, /SPEAKERS OUT stays fixed/);
  assert.match(html, /Use Motion to move nodes automatically/);
  assert.match(html, /Press Escape for panic/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /createDelay\(2\.2\)/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeSoftClipCurve/);
  assert.match(app, /function panic/);
  assert.match(app, /pointerdown/);
  assert.match(app, /nodeTurnRouting/);
  assert.match(app, /function turnSemitoneMatrix/);
  assert.match(app, /turnRouters/);
  assert.match(html, /id="pitchScale"[^>]*min="0"[^>]*max="2"[^>]*value="0.5"/);
  assert.doesNotMatch(html, /id="inputPitchReference"|id="pitchFloor"|id="pitchCeiling"/);
  assert.match(html, /id="baseDelay"[^>]*value="220"/);
  assert.match(html, /id="timeScale"[^>]*value="60"/);
  assert.match(html, /Angle → octave span/);
  assert.match(app, /graph-turn-processor/);
  assert.match(turnProcessor, /morphazoid-graph-turns/);
  assert.match(turnProcessor, /this\.sourceCount/);
  assert.match(turnProcessor, /this\.outputCount/);
  assert.match(app, /function geometryModel/);
  assert.match(app, /graphOutputNodeIds/);
  assert.match(app, /function drawSpeakerConnection/);
  assert.doesNotMatch(app, /state\.output[XY]|audibleOutputNodeIds/);
  assert.match(app, /function terminalDelaySeconds/);
  assert.match(app, /function scheduleGraphRebuild/);
  assert.match(app, /function flushGraphRebuild/);
  assert.match(app, /nextGraph\.crossfade\.gain\.linearRampToValueAtTime\(1/);
  assert.match(app, /MAX_LIVE_TURN_ROUTES = 192/);
  assert.match(app, /geometry: candidate/);
  assert.match(app, /Object\.assign\(state, lastAppliedConfiguration\)/);
  assert.match(app, /function graphRoutingSignature/);
  assert.match(app, /function loadGraphPatch/);
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
