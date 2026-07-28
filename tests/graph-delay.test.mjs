import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GRAPH_DELAY_PATCHES,
  GRAPH_PRESETS,
  MAX_GRAPH_FEEDBACK,
  MAX_GRAPH_TURN_ROUTES,
  directedHeading,
  edgeAudioParameters,
  generateGraph,
  generateGraphWithinTurnBudget,
  graphEdgeSwitchMultipliers,
  graphNodePans,
  graphOutputNodeIds,
  graphSinkNodeIds,
  graphTurnRouteCount,
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

function firstArrivalTimes(graph, edges) {
  const arrivals = Array(graph.nodes.length).fill(Infinity);
  const visited = new Set();
  for (const nodeId of (graph.entries.length ? graph.entries : [0])) arrivals[nodeId] = 0;
  while (visited.size < graph.nodes.length) {
    let current = -1;
    for (const node of graph.nodes) {
      if (
        !visited.has(node.id)
        && Number.isFinite(arrivals[node.id])
        && (current < 0 || arrivals[node.id] < arrivals[current])
      ) current = node.id;
    }
    if (current < 0) break;
    visited.add(current);
    for (const edge of edges) {
      if (edge.from !== current) continue;
      arrivals[edge.to] = Math.min(
        arrivals[edge.to],
        arrivals[current] + edge.delaySeconds,
      );
    }
  }
  return arrivals;
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
    const routings = graphTurnRoutings(graph, patch);
    const turnRoutes = routings.reduce(
      (count, routing) => count + routing.turns.length,
      0,
    );
    const edgeParameters = edgeAudioParameters(graph, patch);
    const arrivals = firstArrivalTimes(graph, edgeParameters);
    const tapArrivals = graphSinkNodeIds(graph).map((nodeId) => arrivals[nodeId]);
    const maximumLocalPitch = Math.max(
      0,
      ...routings.flatMap((routing) => routing.turns.map((turn) => Math.abs(turn.semitones))),
    );
    assert.equal(graph.nodes.length, patch.nodeCount);
    assert.ok(turnRoutes <= 192, `${patch.label} requests ${turnRoutes} turn routes`);
    assert.ok(patch.baseDelay >= 20 && patch.baseDelay <= 600);
    assert.ok(patch.feedback >= 0 && patch.feedback <= MAX_GRAPH_FEEDBACK);
    assert.ok(patch.nodePass >= 0 && patch.nodePass <= 1);
    assert.equal(patch.nodePass, 1);
    assert.ok(patch.pitchScale >= 0 && patch.pitchScale <= 2);
    assert.ok(patch.pitchAsymmetry >= -0.8 && patch.pitchAsymmetry <= 0.8);
    assert.ok(patch.pitchCurve >= 0.5 && patch.pitchCurve <= 2);
    assert.ok(patch.pitchSlew >= 10 && patch.pitchSlew <= 500);
    assert.ok(patch.wet > 0 && patch.wet <= 1.5);
    assert.ok(patch.dry >= 0 && patch.dry <= 1);
    assert.ok(Math.min(...tapArrivals) <= 0.9, `${patch.label} starts too late`);
    assert.ok(Math.max(...tapArrivals) <= 0.95, `${patch.label} spreads beyond one second`);
    assert.ok(maximumLocalPitch <= 5, `${patch.label} has a ${maximumLocalPitch} st local jump`);
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

test("only forward sinks are audible while feedback returns stay cycle-closing", () => {
  const chain = generateGraph({ type: "chain", nodeCount: 6 });
  assert.deepEqual(graphOutputNodeIds(chain), [5]);
  assert.deepEqual(graphSinkNodeIds(chain), [5]);

  const tree = generateGraph({ type: "tree", nodeCount: 7 });
  assert.deepEqual(graphOutputNodeIds(tree), [3, 4, 5, 6]);
  assert.deepEqual(graphSinkNodeIds(tree), [3, 4, 5, 6]);

  const ring = generateGraph({ type: "ring", nodeCount: 8 });
  assert.deepEqual(graphOutputNodeIds(ring), [7]);
  assert.deepEqual(graphSinkNodeIds(ring), [7]);
  assert.equal(ring.edges.find((edge) => edge.from === 7)?.feedbackEdge, true);
});

test("hub nodes add edges monotonically while staying inside the live turn budget", () => {
  let previousEdgeCount = 0;
  for (let nodeCount = 3; nodeCount <= 24; nodeCount += 1) {
    const hub = generateGraph({
      type: "hub",
      nodeCount,
      density: GRAPH_DELAY_PATCHES.hubScatter.density,
      seed: GRAPH_DELAY_PATCHES.hubScatter.seed,
    });
    const turnRoutes = graphTurnRoutings(hub, GRAPH_DELAY_PATCHES.hubScatter)
      .reduce((count, routing) => count + routing.turns.length, 0);
    assert.ok(hub.edges.length > previousEdgeCount);
    assert.ok(turnRoutes <= MAX_GRAPH_TURN_ROUTES);
    assert.deepEqual(
      graphSinkNodeIds(hub),
      Array.from({ length: nodeCount - 1 }, (_, index) => index + 1),
    );
    previousEdgeCount = hub.edges.length;
  }
  const sparse = generateGraph({ type: "hub", nodeCount: 24, density: 0, seed: 19 });
  const dense = generateGraph({ type: "hub", nodeCount: 24, density: 1, seed: 19 });
  assert.ok(dense.edges.length > sparse.edges.length);
  assert.equal(dense.edges.length, 30);
});

test("every dense graph setting simplifies to the greatest safe density", () => {
  for (const type of ["dag", "mesh", "random"]) {
    for (const nodeCount of [14, 17, 20, 24]) {
      for (const seed of [1, 17, 99]) {
        const result = generateGraphWithinTurnBudget({
          type,
          nodeCount,
          density: 1,
          seed,
        });
        assert.equal(result.graph.nodes.length, nodeCount);
        assert.ok(result.density >= 0 && result.density <= 1);
        assert.ok(result.turnRouteCount <= MAX_GRAPH_TURN_ROUTES);
        assert.equal(graphTurnRouteCount(result.graph), result.turnRouteCount);
        if (graphTurnRouteCount(generateGraph({ type, nodeCount, density: 1, seed }))
          > MAX_GRAPH_TURN_ROUTES) {
          assert.equal(result.limited, true);
          assert.ok(result.density < 1);
        }
      }
    }
  }
});

test("stereo spread is centered on vertical tap geometry instead of right-side progress", () => {
  const graph = generateGraph({ type: "tree", nodeCount: 7 });
  const taps = graphSinkNodeIds(graph);
  const before = graphNodePans(graph, taps, 0.8);
  const active = taps.map((nodeId) => before[nodeId]);
  assert.ok(active.some((pan) => pan < 0));
  assert.ok(active.some((pan) => pan > 0));
  assert.ok(Math.abs(active.reduce((sum, pan) => sum + pan, 0)) < 1e-12);
  assert.ok(active.every((pan) => Math.abs(pan) <= 0.8));
  graph.nodes.forEach((node) => { node.x = 0.98; });
  assert.deepEqual(graphNodePans(graph, taps, 0.8), before);
  assert.ok(graphNodePans(graph, taps, 0).every((pan) => pan === 0));
});

test("edge switches preserve outgoing branch energy without boosting merges", () => {
  const tree = generateGraph({ type: "tree", nodeCount: 7 });
  const allOpen = graphEdgeSwitchMultipliers(tree);
  assert.deepEqual(allOpen, Array(tree.edges.length).fill(1));

  const rootEdges = tree.edges.filter((edge) => edge.from === 0);
  assert.equal(rootEdges.length, 2);
  const enabled = Array(tree.edges.length).fill(true);
  enabled[rootEdges[0].id] = false;
  const switched = graphEdgeSwitchMultipliers(tree, enabled);
  assert.equal(switched[rootEdges[0].id], 0);
  assert.ok(Math.abs(switched[rootEdges[1].id] - Math.SQRT2) < 1e-12);
  const base = edgeAudioParameters(tree, { nodePass: 1 });
  assert.ok(
    Math.abs(base[rootEdges[1].id].gain * switched[rootEdges[1].id] - 1) < 1e-12,
  );

  const allClosed = graphEdgeSwitchMultipliers(
    tree,
    Array(tree.edges.length).fill(false),
  );
  assert.ok(allClosed.every((gain) => Number.isFinite(gain) && gain === 0));

  const merge = generateGraph({ type: "dag", nodeCount: 10, density: 0.6, seed: 17 });
  const mergeTarget = merge.nodes.find((node) => merge.indegree[node.id] > 1);
  assert.ok(mergeTarget);
  const incoming = merge.edges.filter((edge) => edge.to === mergeTarget.id);
  const mergeEnabled = Array(merge.edges.length).fill(true);
  mergeEnabled[incoming[0].id] = false;
  const mergeMultipliers = graphEdgeSwitchMultipliers(merge, mergeEnabled);
  assert.equal(
    mergeMultipliers[incoming[1].id],
    1,
    "closing another source must not amplify an incoming merge route",
  );
});

test("masked cyclic presets remain below unity", () => {
  for (const patch of Object.values(GRAPH_DELAY_PATCHES).filter(
    (candidate) => generateGraph({ ...candidate, type: candidate.topology }).cyclic,
  )) {
    const graph = generateGraph({ ...patch, type: patch.topology });
    const parameters = edgeAudioParameters(graph, {
      ...patch,
      nodePass: 1,
      feedback: MAX_GRAPH_FEEDBACK,
    });
    const masks = [
      Array(graph.edges.length).fill(true),
      graph.edges.map((_edge, index) => index % 2 === 0),
      graph.edges.map((_edge, index) => index % 3 !== 0),
    ];
    for (const enabled of masks) {
      const multipliers = graphEdgeSwitchMultipliers(graph, enabled);
      const effective = parameters.map((edge, index) => ({
        ...edge,
        gain: edge.gain * multipliers[index],
      }));
      assert.ok(
        spectralRadius(graph.nodes.length, effective) < 1,
        `${patch.label} gate mask must keep cyclic gain below unity`,
      );
    }
  }
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
  for (const id of ["stage", "audioButton", "micButton", "panicButton", "graphPatch", "topology", "nodeCount", "density", "seed", "openAllSwitchesButton", "nodeMotionPlayButton", "nodeMotionMode", "nodeMotionSpeed", "nodeMotionAmount", "micMotionPlayButton", "micMotionMode", "micMotionSpeed", "micMotionSize", "resetViewButton", "nodePass", "baseDelay", "timeScale", "timeCurve", "pitchScale", "pitchAsymmetry", "pitchCurve", "pitchSlew", "feedback", "damping", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of ["Delay Chain", "Branching Tree", "Layered DAG", "Bipartite Field", "Directed Ring", "Small World", "Hub \\+ Spokes", "Feedback Mesh", "Modular Islands", "Seeded Random"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  for (const [name, patch] of Object.entries(GRAPH_DELAY_PATCHES)) {
    assert.match(html, new RegExp(`>${patch.label}<`));
    assert.match(
      html,
      new RegExp(`id="graphPatch-${name}"[^>]*data-graph-patch="${name}"`),
    );
  }
  assert.ok(html.indexOf('id="topologySection"') < html.indexOf('id="listenSection"'));
  assert.ok(html.indexOf('id="graphInfoSection"') > html.indexOf('id="graphResetButton"'));
  assert.match(html, /id="graphResetButton"[^>]*data-reset-in-place[^>]*data-reset-all/);
  assert.match(html, /id="graphPatch" type="hidden"/);
  assert.match(html, /id="graphPatchGrid"/);
  assert.match(html, /id="pathReadout"/);
  assert.match(html, /Use headphones/);
  assert.match(html, /SPEAKERS OUT stays fixed/);
  assert.match(html, /Click a rectangular connection switch/);
  assert.match(html, /left branch, right branch, both, or neither/);
  assert.match(html, /role="application" aria-roledescription="interactive audio graph"/);
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
  assert.match(html, /id="pitchScale"[^>]*min="0"[^>]*max="2"[^>]*value="0.26"/);
  assert.doesNotMatch(html, /id="inputPitchReference"|id="pitchFloor"|id="pitchCeiling"/);
  assert.match(html, /id="baseDelay"[^>]*value="62"/);
  assert.match(html, /id="timeScale"[^>]*value="58"/);
  assert.match(html, /id="wet"[^>]*max="1.5"[^>]*value="1.16"/);
  assert.match(html, /Angle → octave span/);
  assert.match(app, /graph-turn-processor/);
  assert.match(turnProcessor, /morphazoid-graph-turns/);
  assert.match(turnProcessor, /this\.sourceCount/);
  assert.match(turnProcessor, /this\.outputCount/);
  assert.match(app, /function geometryModel/);
  assert.match(app, /for \(const nodeId of graphSinkNodeIds\(geometry\)\)/);
  assert.match(app, /graphSinkNodeIds/);
  assert.match(app, /graphNodePans/);
  assert.match(app, /function drawSpeakerConnection/);
  assert.doesNotMatch(app, /state\.output[XY]|audibleOutputNodeIds/);
  assert.match(app, /function terminalDelaySeconds/);
  assert.match(app, /function scheduleGraphRebuild/);
  assert.match(app, /generateGraphWithinTurnBudget/);
  assert.match(app, /function firstAudibleTapSeconds/);
  assert.match(app, /graphRebuildQueued/);
  assert.match(app, /inputAnalyser\.getFloatTimeDomainData/);
  assert.match(app, /function flushGraphRebuild/);
  assert.match(app, /nextGraph\.crossfade\.gain\.linearRampToValueAtTime\(1/);
  assert.match(app, /MAX_LIVE_TURN_ROUTES = MAX_GRAPH_TURN_ROUTES/);
  assert.match(html, /speaker tap route/);
  assert.match(app, /geometry: candidate/);
  assert.match(app, /Object\.assign\(state, lastAppliedConfiguration\)/);
  assert.match(app, /function graphRoutingSignature/);
  assert.match(app, /function edgeSwitchAt/);
  assert.match(app, /function setEdgeSwitch/);
  assert.match(app, /const switchGain = own\(audio\.createGain\(\)\)/);
  assert.match(app, /inputBus\.connect\(switchGain\)\.connect\(delay\)/);
  assert.match(app, /linearRampToValueAtTime\(value, now \+ EDGE_SWITCH_RAMP_SECONDS\)/);
  assert.match(app, /function drawEdgeSwitch/);
  assert.match(html, /click switch/);
  assert.match(html, /Only forward sink and leaf nodes are audible/);
  assert.match(html, /1 sink tap · 1 speaker route/);
  assert.match(app, /function loadGraphPatch/);
  assert.match(app, /node\.port\?\.close/);
  assert.match(app, /function audibleTapGain\(count\)/);
  assert.match(app, /audibleTapSet\.has\(spec\.id\) \? tapGain : 0/);
  assert.match(app, /audibleTapSet\.has\(index\) \? tapGain : 0/);
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
