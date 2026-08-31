import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPH_JUST_SEMITONES,
  GRAPH_INSTRUMENT_PATCHES,
  GRAPH_SYNTH_SCALES,
  MAX_GRAPH_EQUAL_DIVISIONS,
  MAX_GRAPH_EVENT_SCHEDULE,
  MAX_GRAPH_INSTRUMENT_NODES,
  MIN_GRAPH_EVENT_AMPLITUDE,
  coalesceGraphEvents,
  graphDrumVoiceIndex,
  graphPulseIntervalSeconds,
  graphSynthVoice,
  mappedGraphDrumVoice,
  quantizeGraphEqualDivision,
  quantizeGraphJustSemitones,
  quantizeGraphSemitones,
  scheduleGraphPulse,
  tuneGraphSemitones,
} from "../src/graph-instruments.js";
import {
  graphInstrumentDefaultState,
  graphInstrumentPresetState,
} from "../src/graph-instrument-app.js";
import { edgeAudioParameters, generateGraph } from "../src/graph-delay.js";
import { GRAPH_DRUM_PERCUSSION_STYLES } from "../src/graph-drum-audio.js";

const closeTo = (actual, expected, epsilon = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const LEGACY_GRAPH_INSTRUMENT_TIME_SCALES = Object.freeze({
  clearSteps: 0,
  branchChoir: 310,
  layeredGlass: 58,
  haloRing: 15,
  shortcutChorus: 300,
  hubScatter: 50,
  softMesh: 220,
  islandSignals: 520,
});

test("shared graph instrument patches retain the selected safe graph-delay contracts", () => {
  assert.deepEqual(Object.keys(GRAPH_INSTRUMENT_PATCHES), [
    "clearSteps",
    "branchChoir",
    "layeredGlass",
    "haloRing",
    "shortcutChorus",
    "hubScatter",
    "softMesh",
    "islandSignals",
  ]);
  for (const patch of Object.values(GRAPH_INSTRUMENT_PATCHES)) {
    assert.ok(patch.tempo >= 35 && patch.tempo <= 220);
    assert.ok(patch.pulseBeats > 0);
    assert.ok(patch.baseDelay >= 20 && patch.baseDelay <= 600);
    assert.ok(patch.distanceRatio >= 1 && patch.distanceRatio <= 12);
    assert.equal(Object.hasOwn(patch, "timeScale"), false);
    assert.ok(patch.timeCurve >= 0.25 && patch.timeCurve <= 3);
    assert.ok(patch.feedback >= 0 && patch.feedback <= 0.92);
    assert.ok(patch.nodePass >= 0 && patch.nodePass <= 1);
    assert.ok(patch.nodeCount >= 3 && patch.nodeCount <= MAX_GRAPH_INSTRUMENT_NODES);
    assert.ok(typeof patch.description === "string" && patch.description.length > 20);
    assert.ok(Object.isFrozen(patch));
  }
  const patches = Object.values(GRAPH_INSTRUMENT_PATCHES);
  assert.deepEqual(
    Object.fromEntries(Object.entries(GRAPH_INSTRUMENT_PATCHES).map(([id, item]) => [
      id,
      [item.tempo, item.pulseBeats, item.baseDelay, item.distanceRatio, item.timeCurve],
    ])),
    {
      clearSteps: [144, 0.5, 55, 1, 1],
      branchChoir: [72, 4, 190, 50 / 19, 1.35],
      layeredGlass: [126, 1, 62, 60 / 31, 0.9],
      haloRing: [100, 2, 105, 8 / 7, 1],
      shortcutChorus: [108, 2, 36, 28 / 3, 1.8],
      hubScatter: [156, 0.5, 24, 37 / 12, 0.45],
      softMesh: [76, 2, 120, 17 / 6, 0.7],
      islandSignals: [60, 4, 260, 3, 1.45],
    },
  );
  assert.deepEqual(
    [...new Set(patches.map(({ pulseBeats }) => pulseBeats))].sort((a, b) => a - b),
    [0.5, 1, 2, 4],
  );
  assert.ok(Math.min(...patches.map(({ baseDelay }) => baseDelay)) <= 24);
  assert.ok(Math.max(...patches.map(({ baseDelay }) => baseDelay)) >= 260);
  assert.ok(Math.max(...patches.map(({ distanceRatio }) => distanceRatio)) >= 9);
  const pulseIntervals = patches.map(graphPulseIntervalSeconds);
  assert.ok(Math.min(...pulseIntervals) <= 0.21);
  assert.ok(Math.max(...pulseIntervals) >= 4);
  assert.equal(
    new Set(patches.map(({ baseDelay, distanceRatio, timeCurve }) => (
      `${baseDelay}:${distanceRatio}:${timeCurve}`
    ))).size,
    patches.length,
  );
  assert.ok(MAX_GRAPH_EVENT_SCHEDULE >= 1_024);
  assert.ok(MIN_GRAPH_EVENT_AMPLITUDE > 0 && MIN_GRAPH_EVENT_AMPLITUDE < 0.01);
});

test("both instruments initialize and reset to the timing of their selected preset", () => {
  const patch = GRAPH_INSTRUMENT_PATCHES.layeredGlass;
  for (const mode of ["drums", "synth"]) {
    const state = graphInstrumentDefaultState(mode);
    assert.equal(state.graphPatch, "layeredGlass");
    for (const key of [
      "topology", "nodeCount", "density", "seed", "tempo", "nodePass",
      "baseDelay", "distanceRatio", "timeCurve", "feedback",
    ]) assert.equal(state[key], patch[key]);
    assert.equal(state.pulseDivision, patch.pulseBeats);
  }
});

test("preset state maps every authored cadence into the runtime clock fields", () => {
  for (const [name, patch] of Object.entries(GRAPH_INSTRUMENT_PATCHES)) {
    const state = graphInstrumentPresetState(name);
    assert.equal(state.graphPatch, name);
    assert.equal(state.tempo, patch.tempo);
    assert.equal(state.pulseDivision, patch.pulseBeats);
    assert.equal(state.baseDelay, patch.baseDelay);
    assert.equal(state.distanceRatio, patch.distanceRatio);
    assert.equal(Object.hasOwn(state, "timeScale"), false);
    assert.equal(state.timeCurve, patch.timeCurve);
    closeTo(graphPulseIntervalSeconds(state.tempo, state.pulseDivision), (
      patch.pulseBeats * 60 / patch.tempo
    ));
  }
  assert.equal(graphInstrumentPresetState("missing"), null);
});

test("distance ratios preserve every authored preset edge time", () => {
  for (const [name, patch] of Object.entries(GRAPH_INSTRUMENT_PATCHES)) {
    const graph = generateGraph({
      type: patch.topology,
      nodeCount: patch.nodeCount,
      density: patch.density,
      seed: patch.seed,
    });
    const ratioParameters = edgeAudioParameters(graph, patch);
    const legacyParameters = edgeAudioParameters(graph, {
      ...patch,
      distanceRatio: null,
      timeScale: LEGACY_GRAPH_INSTRUMENT_TIME_SCALES[name],
    });
    assert.equal(ratioParameters.length, legacyParameters.length);
    ratioParameters.forEach((edge, index) => {
      closeTo(edge.delaySeconds, legacyParameters[index].delaySeconds);
    });
  }
});

test("distance ratio scales edge time from the base while preserving safety bounds", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0, y: 0 },
      { id: 1, x: 0, y: 0 },
      { id: 2, x: Math.SQRT1_2, y: 0 },
      { id: 3, x: 1, y: 1 },
    ],
    edges: [
      { id: 0, from: 0, to: 1, feedbackEdge: false },
      { id: 1, from: 0, to: 2, feedbackEdge: false },
      { id: 2, from: 0, to: 3, feedbackEdge: false },
    ],
    indegree: [0, 1, 1, 1],
    outdegree: [3, 0, 0, 0],
  };
  const delays = (settings) => edgeAudioParameters(graph, settings)
    .map(({ delaySeconds }) => delaySeconds);

  const ratioDelays = delays({
    baseDelay: 100,
    distanceRatio: 3,
    timeScale: 999,
    timeCurve: 2,
  });
  [0.1, 0.15, 0.3].forEach((expected, index) => closeTo(ratioDelays[index], expected));
  delays({ baseDelay: 100, distanceRatio: 1, timeCurve: 2 })
    .forEach((delay) => closeTo(delay, 0.1));
  delays({ baseDelay: 100, distanceRatio: -4, timeCurve: 2 })
    .forEach((delay) => closeTo(delay, 0.1));
  [0.2, 0.3, 0.6].forEach((expected, index) => closeTo(
    delays({ baseDelay: 200, distanceRatio: 3, timeCurve: 2 })[index],
    expected,
  ));
  closeTo(delays({ baseDelay: 600, distanceRatio: 12, timeCurve: 1 })[2], 2);
});

test("graph presets preserve synth controls while drum presets retain their sound palettes", () => {
  const drumKeys = [
    "mappingMode", "percussionStyle", "pitchDepth", "turnPitchDepth",
    "characterDepth",
  ];
  const synthControlKeys = [
    "output", "seedNote",
    "mappingMode", "tuningMode", "edoDivisions", "soundMode",
    "baseFrequency", "pitchRange", "turnPitchScale",
    "modulationIndex", "modulationRatio", "articulation", "noteDuration",
    "attack", "decay", "sustain", "release", "stereoSpread",
  ];
  const drumStyles = new Set();
  const validDrumStyles = new Set(GRAPH_DRUM_PERCUSSION_STYLES.map(({ id }) => id));
  const selectedSynth = {
    ...graphInstrumentDefaultState("synth"),
    output: 0.73,
    seedNote: 74,
    triggerScope: "all",
    mappingMode: "turn",
    tuningMode: "just",
    edoDivisions: 53,
    soundMode: "square",
    baseFrequency: 432,
    pitchRange: 4.25,
    turnPitchScale: 1.37,
    modulationIndex: 7.15,
    modulationRatio: 3.25,
    articulation: "edge",
    noteDuration: 770,
    attack: 321,
    decay: 654,
    sustain: 0.67,
    release: 987,
    stereoSpread: 0.23,
  };

  for (const [name, patch] of Object.entries(GRAPH_INSTRUMENT_PATCHES)) {
    assert.ok(Object.isFrozen(patch.drums));
    assert.equal(
      Object.hasOwn(patch, "synth"),
      false,
      `${name} must not carry a hidden Graph Synth sound preset`,
    );
    for (const key of drumKeys) assert.ok(Object.hasOwn(patch.drums, key));

    const drums = graphInstrumentPresetState(name, "drums");
    const synthPreset = graphInstrumentPresetState(name, "synth");
    assert.equal(Object.hasOwn(patch, "edgeSubdivisions"), false);
    for (const state of [drums, synthPreset]) {
      assert.equal(state.graphPatch, name);
      assert.equal(Object.hasOwn(state, "edgeSubdivisions"), false);
      assert.equal(state.feedbackTone, patch.feedbackTone);
    }
    assert.equal(drums.triggerScope, patch.triggerScope);
    assert.ok(["all", "leaves"].includes(drums.triggerScope));
    assert.equal(
      Object.hasOwn(synthPreset, "triggerScope"),
      false,
      `${name} must preserve the performer's current Synth attack scope`,
    );
    for (const key of drumKeys) assert.equal(drums[key], patch.drums[key]);
    for (const key of synthControlKeys) {
      assert.equal(
        Object.hasOwn(synthPreset, key),
        false,
        `${name} must not override Synth control ${key}`,
      );
    }
    assert.equal(drums.soundMode, undefined, "synth settings must not leak into drums");
    assert.equal(synthPreset.percussionStyle, undefined, "drum settings must not leak into synth");

    assert.ok(drums.pitchDepth >= 0 && drums.pitchDepth <= 24);
    assert.ok(drums.turnPitchDepth >= 0 && drums.turnPitchDepth <= 48);
    assert.ok(drums.characterDepth >= 0 && drums.characterDepth <= 1);
    assert.equal(validDrumStyles.has(drums.percussionStyle), true);

    drumStyles.add(drums.percussionStyle);

    const loadedSynth = { ...selectedSynth, ...synthPreset };
    assert.equal(loadedSynth.triggerScope, selectedSynth.triggerScope);
    for (const key of synthControlKeys) {
      assert.equal(loadedSynth[key], selectedSynth[key], `${name} changed Synth control ${key}`);
    }

    const graph = generateGraph({
      type: loadedSynth.topology,
      nodeCount: loadedSynth.nodeCount,
      density: loadedSynth.density,
      seed: loadedSynth.seed,
    });
    const arrivals = scheduleGraphPulse(graph, {
      ...loadedSynth,
      pitchScale: loadedSynth.turnPitchScale,
      maxEvents: 1,
    });
    assert.equal(arrivals.length, 1, `${name} must retain an immediate source arrival`);
    assert.equal(arrivals[0].time, 0);
    const sourceVoice = graphSynthVoice(arrivals[0], graph, {
      mappingMode: loadedSynth.mappingMode,
      baseFrequency: loadedSynth.baseFrequency,
      pitchRange: loadedSynth.pitchRange,
      tuningMode: loadedSynth.tuningMode,
      edoDivisions: loadedSynth.edoDivisions,
      soundMode: loadedSynth.soundMode,
      waveform: loadedSynth.soundMode,
      modulationIndex: loadedSynth.modulationIndex,
      modulationRatio: loadedSynth.modulationRatio,
      stereoSpread: loadedSynth.stereoSpread,
      feedbackTone: loadedSynth.feedbackTone,
    });
    assert.ok(sourceVoice.gain >= 0.1, `${name} source voice must begin at an audible level`);
    assert.equal(sourceVoice.soundMode, selectedSynth.soundMode);
  }

  assert.deepEqual(
    [...drumStyles].sort(),
    [
      "circuit",
      "drum-bank",
      "karplus-objects",
      "karplus-strong",
      "karplus-tines",
      "rattlesnake",
      "resonant-metal",
    ],
    "drum presets should demonstrate every authored FM and Karplus palette",
  );

  const defaultPatch = GRAPH_INSTRUMENT_PATCHES.layeredGlass;
  const defaultDrums = graphInstrumentDefaultState("drums");
  const defaultSynth = graphInstrumentDefaultState("synth");
  for (const key of drumKeys) assert.equal(defaultDrums[key], defaultPatch.drums[key]);
  assert.equal(defaultDrums.percussionStyle, "circuit");
  assert.equal(defaultDrums.seedNote, 60);
  assert.equal(defaultSynth.triggerScope, "all");
  assert.equal(defaultSynth.seedNote, 57);
  assert.equal(defaultSynth.output, 0.64);
  assert.equal(defaultSynth.soundMode, "fm");
  assert.equal(defaultSynth.edoDivisions, 19);
  assert.equal(GRAPH_INSTRUMENT_PATCHES.hubScatter.drums.percussionStyle, "drum-bank");
});

test("the fast even preset schedules its authored 55 ms graph steps", () => {
  const patch = GRAPH_INSTRUMENT_PATCHES.clearSteps;
  const graph = generateGraph({
    type: patch.topology,
    nodeCount: patch.nodeCount,
    density: patch.density,
    seed: patch.seed,
  });
  const events = scheduleGraphPulse(graph, { patch });
  assert.equal(events.length, 4);
  [0, 0.055, 0.11, 0.165].forEach((time, index) => {
    closeTo(events[index].time, time);
  });
});

test("an acyclic chain creates one finite, exactly timed arrival per node", () => {
  const graph = generateGraph({ type: "chain", nodeCount: 4 });
  const events = scheduleGraphPulse(graph, {
    baseDelay: 100,
    distanceRatio: 1,
    nodePass: 1,
    pitchScale: 1,
    amplitude: 0.8,
    horizonSeconds: 10,
  });
  assert.deepEqual(events.map(({ nodeId }) => nodeId), [0, 1, 2, 3]);
  events.forEach((event, index) => {
    closeTo(event.time, index * 0.1);
    closeTo(event.departTime, Math.max(0, index - 1) * 0.1);
    closeTo(event.amplitude, 0.8);
    assert.equal(event.depth, index);
    assert.equal(event.feedbackCount, 0);
    assert.equal(event.arrivalEdgeId, index === 0 ? null : index - 1);
    assert.equal(event.previousNodeId, index === 0 ? null : index - 1);
    assert.equal(typeof event.pathKey, "string");
  });
});

test("a directed ring returns at the exact lap time with one decay per lap", () => {
  const graph = generateGraph({ type: "ring", nodeCount: 3 });
  const events = scheduleGraphPulse(graph, {
    baseDelay: 100,
    distanceRatio: 1,
    nodePass: 1,
    feedback: 0.5,
    minAmplitude: 1e-9,
    maxFeedbackPasses: 2,
    horizonSeconds: 2,
  });
  assert.deepEqual(events.map(({ nodeId }) => nodeId), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  const entries = events.filter(({ nodeId }) => nodeId === 0);
  assert.equal(entries.length, 3);
  closeTo(entries[0].time, 0);
  closeTo(entries[1].time, 0.3);
  closeTo(entries[2].time, 0.6);
  closeTo(entries[0].amplitude, 1);
  closeTo(entries[1].amplitude, 0.5);
  closeTo(entries[2].amplitude, 0.25);
  assert.deepEqual(entries.map(({ feedbackCount }) => feedbackCount), [0, 1, 2]);

  const beforeFeedback = events.find(({ nodeId, depth }) => nodeId === 2 && depth === 2);
  const afterFeedback = events.find(({ nodeId, depth }) => nodeId === 0 && depth === 3);
  closeTo(beforeFeedback.amplitude, 1);
  closeTo(afterFeedback.amplitude, 0.5);
});

test("closed graph switches stop their route without changing deterministic ordering", () => {
  const graph = generateGraph({ type: "chain", nodeCount: 5 });
  const enabledEdges = graph.edges.map((_edge, index) => index !== 1);
  const first = scheduleGraphPulse(graph, {
    baseDelay: 50,
    distanceRatio: 1,
    nodePass: 1,
    enabledEdges,
  });
  const repeated = scheduleGraphPulse(graph, {
    baseDelay: 50,
    distanceRatio: 1,
    nodePass: 1,
    enabledEdges,
  });
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.map(({ nodeId }) => nodeId), [0, 1]);

  const opened = scheduleGraphPulse(graph, {
    baseDelay: 50,
    distanceRatio: 1,
    nodePass: 1,
    enabledEdges: new Set(graph.edges.map(({ id }) => id)),
  });
  assert.deepEqual(opened.map(({ nodeId }) => nodeId), [0, 1, 2, 3, 4]);
});

test("merge arrivals retain incoming provenance and make distinct following turns", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0.05, y: 0.15 },
      { id: 1, x: 0.05, y: 0.85 },
      { id: 2, x: 0.5, y: 0.5 },
      { id: 3, x: 0.95, y: 0.2 },
    ],
    edges: [
      { id: 0, from: 0, to: 2, feedbackEdge: false },
      { id: 1, from: 1, to: 2, feedbackEdge: false },
      { id: 2, from: 2, to: 3, feedbackEdge: false },
    ],
    entries: [0, 1],
  };
  const events = scheduleGraphPulse(graph, {
    baseDelay: 100,
    distanceRatio: 1,
    nodePass: 1,
    pitchScale: 1,
    pitchCurve: 1,
  });
  const merged = events.filter(({ nodeId }) => nodeId === 2);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(({ arrivalEdgeId }) => arrivalEdgeId), [0, 1]);
  assert.deepEqual(merged.map(({ previousNodeId }) => previousNodeId), [0, 1]);
  assert.notEqual(merged[0].pathKey, merged[1].pathKey);

  const descendants = events.filter(({ nodeId }) => nodeId === 3);
  assert.equal(descendants.length, 2);
  assert.equal(descendants[0].arrivalEdgeId, 2);
  assert.equal(descendants[1].arrivalEdgeId, 2);
  assert.notEqual(descendants[0].localTurn, descendants[1].localTurn);
  assert.notEqual(descendants[0].cumulativeSemitones, descendants[1].cumulativeSemitones);
  assert.notEqual(descendants[0].pathKey, descendants[1].pathKey);
});

test("event, depth, feedback-pass, horizon, and amplitude bounds stop cyclic expansion", () => {
  const graph = generateGraph({ type: "ring", nodeCount: 3 });
  const base = {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    feedback: 0.92,
    minAmplitude: 1e-12,
    horizonSeconds: 60,
  };
  assert.equal(scheduleGraphPulse(graph, { ...base, maxEvents: 17 }).length, 17);
  assert.equal(scheduleGraphPulse(graph, { ...base, maxDepth: 2 }).length, 3);
  assert.equal(
    scheduleGraphPulse(graph, { ...base, maxFeedbackPasses: 1 }).length,
    6,
  );
  assert.equal(
    scheduleGraphPulse(graph, { ...base, horizonSeconds: 0.007 }).length,
    2,
  );
  assert.equal(
    scheduleGraphPulse(graph, { ...base, minAmplitude: 0.95 }).length,
    3,
  );
  assert.ok(
    scheduleGraphPulse(graph, { ...base, maxEvents: Infinity }).length
      <= MAX_GRAPH_EVENT_SCHEDULE,
  );
});

test("the maximum 32-node chain traverses every sequential node", () => {
  const graph = generateGraph({
    type: "chain",
    nodeCount: MAX_GRAPH_INSTRUMENT_NODES,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  assert.equal(MAX_GRAPH_INSTRUMENT_NODES, 32);
  assert.equal(graph.nodes.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(graph.edges.length, MAX_GRAPH_INSTRUMENT_NODES - 1);

  const events = scheduleGraphPulse(graph, {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    horizonSeconds: 60,
    maxDepth: MAX_GRAPH_INSTRUMENT_NODES,
    maxEvents: MAX_GRAPH_EVENT_SCHEDULE,
  });
  assert.equal(events.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.deepEqual(
    events.map(({ nodeId }) => nodeId),
    Array.from({ length: MAX_GRAPH_INSTRUMENT_NODES }, (_item, nodeId) => nodeId),
  );
  assert.ok(events.every(({ kind }) => kind === "node"));
  assert.equal(events.at(-1).depth, MAX_GRAPH_INSTRUMENT_NODES - 1);
  closeTo(events.at(-1).departTime, (MAX_GRAPH_INSTRUMENT_NODES - 2) * 0.004, 1e-10);
  closeTo(events.at(-1).time, (MAX_GRAPH_INSTRUMENT_NODES - 1) * 0.004, 1e-10);
});

test("the scheduler hard-caps oversized graph input at 32 nodes", () => {
  const oversized = generateGraph({
    type: "chain",
    nodeCount: 512,
    maxNodes: 512,
  });
  assert.equal(oversized.nodes.length, 512, "the shared graph generator keeps its separate ceiling");

  const events = scheduleGraphPulse(oversized, {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    horizonSeconds: 60,
    maxDepth: MAX_GRAPH_EVENT_SCHEDULE,
    maxEvents: MAX_GRAPH_EVENT_SCHEDULE,
  });
  assert.equal(events.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.deepEqual(
    events.map(({ nodeId }) => nodeId),
    Array.from({ length: MAX_GRAPH_INSTRUMENT_NODES }, (_item, nodeId) => nodeId),
  );
  for (const event of events) {
    for (const obsoleteKey of [
      "edgeProgress", "subdivisionIndex", "subdivisions", "transitOnly",
    ]) assert.equal(Object.hasOwn(event, obsoleteKey), false);
  }
});

test("a 32-node ring can complete multiple decaying feedback laps", () => {
  const graph = generateGraph({
    type: "ring",
    nodeCount: MAX_GRAPH_INSTRUMENT_NODES,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  const events = scheduleGraphPulse(graph, {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    feedback: 0.72,
    minAmplitude: MIN_GRAPH_EVENT_AMPLITUDE,
    horizonSeconds: 1_024,
    maxDepth: MAX_GRAPH_EVENT_SCHEDULE,
    maxEvents: MAX_GRAPH_EVENT_SCHEDULE,
    maxFeedbackPasses: 24,
  });
  const rootReturns = events.filter(({ kind, nodeId }) => kind === "node" && nodeId === 0);

  assert.ok(rootReturns.length >= 3);
  closeTo(rootReturns[1].time, MAX_GRAPH_INSTRUMENT_NODES * 0.004, 1e-10);
  closeTo(rootReturns[1].amplitude, 0.72, 1e-10);
  closeTo(rootReturns[2].amplitude, 0.72 ** 2, 1e-10);
});

test("a dense cyclic 32-node schedule stays bounded and deterministic without shrinking topology", () => {
  const graph = generateGraph({
    type: "smallworld",
    nodeCount: MAX_GRAPH_INSTRUMENT_NODES,
    density: 0.9,
    seed: 83,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  const topologySnapshot = structuredClone(graph);
  const options = {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    feedback: 0.92,
    minAmplitude: 1e-12,
    horizonSeconds: 1_024,
    maxDepth: MAX_GRAPH_EVENT_SCHEDULE,
    maxEvents: MAX_GRAPH_EVENT_SCHEDULE,
    maxFeedbackPasses: 24,
  };

  assert.equal(graph.nodes.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(graph.cyclic, true);
  assert.ok(graph.edges.length > graph.nodes.length, "the regression graph must remain dense");

  const first = scheduleGraphPulse(graph, options);
  const second = scheduleGraphPulse(graph, options);
  assert.equal(first.length, MAX_GRAPH_EVENT_SCHEDULE);
  assert.equal(second.length, MAX_GRAPH_EVENT_SCHEDULE);
  assert.equal(
    new Set(first.map(({ nodeId }) => nodeId)).size,
    MAX_GRAPH_INSTRUMENT_NODES,
    "the bounded event schedule must still reach every available graph node",
  );
  assert.deepEqual(
    second.map((event) => [
      event.pathKey,
      event.nodeId,
      event.arrivalEdgeId,
      event.previousNodeId,
      event.time,
      event.amplitude,
      event.depth,
      event.feedbackCount,
    ]),
    first.map((event) => [
      event.pathKey,
      event.nodeId,
      event.arrivalEdgeId,
      event.previousNodeId,
      event.time,
      event.amplitude,
      event.depth,
      event.feedbackCount,
    ]),
    "equal dense graphs and seeds must retain deterministic traversal identities",
  );

  const maximumPathKeyLength = `p:${"0".repeat(16)}:${MAX_GRAPH_EVENT_SCHEDULE}`.length;
  assert.equal(new Set(first.map(({ pathKey }) => pathKey)).size, first.length);
  for (const event of first) {
    assert.match(event.pathKey, /^p:[0-9a-f]{16}:\d+$/);
    assert.ok(event.pathKey.length <= maximumPathKeyLength);
    assert.equal(Number(event.pathKey.split(":")[2]), event.depth);
    assert.ok(Number.isInteger(event.pathHashA) && event.pathHashA >= 0);
    assert.ok(Number.isInteger(event.pathHashB) && event.pathHashB >= 0);
    assert.ok(event.nodeId >= 0 && event.nodeId < MAX_GRAPH_INSTRUMENT_NODES);
    assert.ok(event.time <= options.horizonSeconds);
    assert.ok(event.feedbackCount <= options.maxFeedbackPasses);
  }

  assert.deepEqual(
    graph,
    topologySnapshot,
    "scheduling and overload bounds must not delete or rewrite graph nodes or routes",
  );
});

test("dense path competition preserves one first visit for every reachable node", () => {
  const graph = generateGraph({
    type: "random",
    nodeCount: MAX_GRAPH_INSTRUMENT_NODES,
    density: 1,
    seed: 17,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  const topologySnapshot = structuredClone(graph);
  const events = scheduleGraphPulse(graph, {
    baseDelay: 4,
    distanceRatio: 1,
    nodePass: 1,
    feedback: 0.92,
    minAmplitude: 1e-12,
    horizonSeconds: 1_024,
    maxDepth: MAX_GRAPH_EVENT_SCHEDULE,
    maxEvents: MAX_GRAPH_EVENT_SCHEDULE,
    maxFeedbackPasses: 24,
  });

  assert.equal(events.length, MAX_GRAPH_EVENT_SCHEDULE);
  assert.equal(
    new Set(events.map(({ nodeId }) => nodeId)).size,
    MAX_GRAPH_INSTRUMENT_NODES,
    "duplicate short paths must yield capacity to every reachable node's first visit",
  );
  assert.deepEqual(graph, topologySnapshot);
});

test("coalescing combines duplicate energy while preserving pitch-separated arrivals", () => {
  const events = [
    {
      nodeId: 2,
      time: 0.1,
      amplitude: 0.3,
      cumulativeSemitones: 7,
      feedbackCount: 0,
      depth: 2,
      pathKey: "a",
    },
    {
      nodeId: 2,
      time: 0.1 + 1e-8,
      amplitude: 0.4,
      cumulativeSemitones: 7,
      feedbackCount: 0,
      depth: 2,
      pathKey: "b",
    },
    {
      nodeId: 2,
      time: 0.1,
      amplitude: 0.8,
      cumulativeSemitones: 12,
      feedbackCount: 0,
      depth: 2,
      pathKey: "c",
    },
  ];
  const coalesced = coalesceGraphEvents(events);
  assert.equal(coalesced.length, 2);
  const seventh = coalesced.find(({ cumulativeSemitones }) => cumulativeSemitones === 7);
  closeTo(seventh.amplitude, 0.5);
  assert.equal(seventh.coalescedCount, 2);
  assert.equal(seventh.pathCount, 2);
  assert.deepEqual(seventh.pathKeys, ["a", "b"]);
  assert.equal(
    coalesceGraphEvents(events, { key: ({ nodeId }) => nodeId }).length,
    1,
  );
});

test("graph drum mappings always select the 16-voice bank and bound voice parameters", () => {
  const graph = generateGraph({ type: "smallworld", nodeCount: 16, density: 0.6, seed: 41 });
  const extremeEvents = Array.from({ length: 80 }, (_, index) => ({
    nodeId: index % graph.nodes.length,
    arrivalEdgeId: index - 40,
    depth: index * 3,
    feedbackCount: index % 9,
    localTurn: (index - 40) * Math.PI,
    cumulativeTurn: (index - 40) * Math.PI * 0.63,
    cumulativeSemitones: (index - 40) * 7,
    amplitude: index % 2 ? 3 : -2,
  }));
  for (const mode of [
    "node-turn",
    "position-grid",
    "degree-turn",
    "path-phase",
    "depth-route",
    "feedback-turn",
  ]) {
    for (const event of extremeEvents) {
      const index = graphDrumVoiceIndex(event, graph, { mode, voiceOffset: -35 });
      assert.ok(Number.isInteger(index));
      assert.ok(index >= 0 && index <= 15);
    }
  }

  const baseVoice = {
    name: "Test drum",
    frequency: 80,
    tone: 0.6,
    modIndex: 5,
    level: 0.8,
    attack: 0.002,
    decay: 0.2,
  };
  const snapshot = { ...baseVoice };
  for (const event of extremeEvents) {
    const voice = mappedGraphDrumVoice(baseVoice, event, graph, { eventCount: 8 });
    assert.ok(voice.voiceIndex >= 0 && voice.voiceIndex <= 15);
    assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
    assert.ok(voice.tone >= 0 && voice.tone <= 1);
    assert.ok(voice.modIndex >= 0 && voice.modIndex <= 20);
    assert.ok(voice.level >= 0 && voice.level <= 1);
    assert.equal(voice.gain, voice.level);
  }
  assert.deepEqual(baseVoice, snapshot, "mapping must not mutate the shared drum bank");

  const turnEvent = {
    nodeId: 0,
    localTurn: Math.PI,
    cumulativeTurn: Math.PI,
    cumulativeSemitones: 0,
    amplitude: 1,
    feedbackCount: 2,
    depth: 1,
    arrivalEdgeId: 3,
  };
  const aliased = mappedGraphDrumVoice(baseVoice, turnEvent, graph, {
    mode: "degree-turn",
    turnPitchDepth: 12,
    feedbackTone: 0.5,
  });
  const neutral = mappedGraphDrumVoice(baseVoice, {
    ...turnEvent,
    localTurn: 0,
    cumulativeTurn: 0,
    feedbackCount: 0,
  }, graph, {
    mode: "degree-turn",
    turnPitchDepth: 12,
    feedbackTone: 0.5,
  });
  assert.ok(aliased.frequency > neutral.frequency);
  assert.ok(aliased.tone < neutral.tone);
  assert.equal(
    aliased.voiceIndex,
    graphDrumVoiceIndex(turnEvent, graph, { mode: "degree-turn" }),
  );
});

test("degree-turn and path-phase drum modes use their named graph dimensions", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0, y: 0.5 },
      { id: 1, x: 0.5, y: 0.5 },
      { id: 2, x: 1, y: 0.5 },
    ],
    edges: [
      { id: 0, from: 0, to: 1 },
      { id: 1, from: 0, to: 2 },
    ],
  };
  const highDegreeLeft = graphDrumVoiceIndex({ nodeId: 0, localTurn: -Math.PI }, graph, {
    mode: "degree-turn",
  });
  const lowDegreeLeft = graphDrumVoiceIndex({ nodeId: 1, localTurn: -Math.PI }, graph, {
    mode: "degree-turn",
  });
  const highDegreeRight = graphDrumVoiceIndex({ nodeId: 0, localTurn: Math.PI }, graph, {
    mode: "degree-turn",
  });
  assert.notEqual(Math.floor(highDegreeLeft / 4), Math.floor(lowDegreeLeft / 4));
  assert.notEqual(highDegreeLeft % 4, highDegreeRight % 4);

  const firstPass = graphDrumVoiceIndex({
    nodeId: 1,
    depth: 5,
    arrivalEdgeId: 0,
    feedbackCount: 0,
  }, graph, { mode: "path-phase" });
  const secondPass = graphDrumVoiceIndex({
    nodeId: 1,
    depth: 5,
    arrivalEdgeId: 0,
    feedbackCount: 1,
  }, graph, { mode: "path-phase" });
  assert.equal(Math.floor(firstPass / 4), 1);
  assert.equal(Math.floor(secondPass / 4), 1);
  assert.notEqual(firstPass % 4, secondPass % 4);
});

test("pure, arbitrary equal-division, and just tuning preserve their lattice contracts", () => {
  assert.equal(MAX_GRAPH_EQUAL_DIVISIONS, 360);
  const fiveEdoStep = 12 / 5;
  closeTo(quantizeGraphEqualDivision(1.19, 5), 0);
  closeTo(quantizeGraphEqualDivision(1.21, 5), fiveEdoStep);
  closeTo(quantizeGraphEqualDivision(11.1, 5), 12);
  closeTo(quantizeGraphEqualDivision(3, 5, 1), 1 + fiveEdoStep);
  closeTo(quantizeGraphEqualDivision(0.017, 360), 12 / 360);

  const nineteenEdoStep = 12 / 19;
  closeTo(quantizeGraphEqualDivision(0.7, 19), nineteenEdoStep);
  closeTo(quantizeGraphEqualDivision(6.1, 19), 10 * nineteenEdoStep);
  const nineteenEdoPitch = tuneGraphSemitones(8.4, {
    mode: "equal",
    divisions: 19,
  });
  closeTo(nineteenEdoPitch / nineteenEdoStep, Math.round(8.4 / nineteenEdoStep));

  const unquantizedPitch = Math.PI;
  assert.equal(tuneGraphSemitones(unquantizedPitch, { mode: "pure" }), unquantizedPitch);
  assert.equal(tuneGraphSemitones(unquantizedPitch, { mode: "continuous" }), unquantizedPitch);
  assert.equal(tuneGraphSemitones(unquantizedPitch, { mode: "free" }), unquantizedPitch);

  assert.equal(GRAPH_JUST_SEMITONES.length, 12);
  closeTo(GRAPH_JUST_SEMITONES[0], 0);
  const perfectFifth = 12 * Math.log2(3 / 2);
  closeTo(GRAPH_JUST_SEMITONES[7], perfectFifth);
  closeTo(quantizeGraphJustSemitones(7), perfectFifth);
  closeTo(quantizeGraphJustSemitones(19), 12 + perfectFifth);
  closeTo(2 ** (tuneGraphSemitones(7, { mode: "just" }) / 12), 3 / 2);

  const graph = { nodes: [{ id: 0, x: 0.5, y: 0.5 }], edges: [], entries: [0] };
  const event = {
    nodeId: 0,
    time: 0,
    amplitude: 1,
    cumulativeSemitones: 0.7,
    depth: 0,
    feedbackCount: 0,
  };
  const equalVoice = graphSynthVoice(event, graph, {
    mappingMode: "turn",
    tuningMode: "equal",
    edoDivisions: 19,
    rootFrequency: 440,
  });
  const pureVoice = graphSynthVoice(event, graph, {
    mappingMode: "turn",
    tuningMode: "pure",
    edoDivisions: 19,
    rootFrequency: 440,
  });
  const justVoice = graphSynthVoice({ ...event, cumulativeSemitones: 7 }, graph, {
    mappingMode: "turn",
    tuningMode: "just",
    rootFrequency: 440,
  });
  closeTo(equalVoice.semitones, nineteenEdoStep);
  closeTo(pureVoice.semitones, 0.7);
  closeTo(justVoice.semitones, perfectFifth);
  closeTo(justVoice.frequency / 440, 3 / 2);
  assert.equal(equalVoice.tuningMode, "equal");
  assert.equal(equalVoice.edoDivisions, 19);
  assert.equal(pureVoice.tuningMode, "pure");
  assert.equal(justVoice.tuningMode, "just");
});

test("scale quantization and graph synth voices remain deterministic and bounded", () => {
  assert.deepEqual(GRAPH_SYNTH_SCALES.major, [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(quantizeGraphSemitones(1, "major"), 0);
  assert.equal(quantizeGraphSemitones(3, "major"), 2);
  assert.equal(quantizeGraphSemitones(-1, "major"), -1);
  assert.equal(quantizeGraphSemitones(6.2, [0, 3, 7]), 7);
  assert.equal(quantizeGraphSemitones(2, "pentatonic", 1), 1);
  assert.strictEqual(
    GRAPH_SYNTH_SCALES["minor-pentatonic"],
    GRAPH_SYNTH_SCALES.minorPentatonic,
  );
  assert.strictEqual(GRAPH_SYNTH_SCALES["whole-tone"], GRAPH_SYNTH_SCALES.wholeTone);
  assert.deepEqual(GRAPH_SYNTH_SCALES.octaves, [0]);
  assert.equal(quantizeGraphSemitones(4.8, "minor-pentatonic"), 5);
  assert.equal(quantizeGraphSemitones(5.2, "whole-tone"), 6);
  assert.equal(quantizeGraphSemitones(8, "octaves"), 12);

  const graph = {
    nodes: [{ id: 0, x: -5, y: 9 }],
    edges: [],
    entries: [0],
  };
  const event = {
    nodeId: 0,
    time: -5,
    amplitude: 9,
    cumulativeSemitones: 500,
    depth: 100,
    feedbackCount: 100,
  };
  const voice = graphSynthVoice(event, graph, {
    rootFrequency: 440,
    scale: "minorPentatonic",
    positionPitchDepth: 24,
    depthSemitones: 12,
    level: 4,
    spread: 4,
    minFrequency: -1,
    maxFrequency: 999_999,
    filterFrequency: 999_999,
    attack: -5,
    release: 99,
    duration: 99,
  });
  assert.ok(voice.frequency >= 20 && voice.frequency <= 20_000);
  assert.ok(voice.gain >= 0 && voice.gain <= 1);
  assert.equal(voice.level, voice.gain);
  assert.ok(voice.pan >= -1 && voice.pan <= 1);
  assert.ok(voice.brightness >= 0 && voice.brightness <= 1);
  assert.ok(voice.cutoff >= 80 && voice.cutoff <= 20_000);
  assert.ok(voice.attack >= 0.001 && voice.attack <= 2);
  assert.ok(voice.release >= 0.01 && voice.release <= 8);
  assert.ok(voice.duration >= 0.01 && voice.duration <= 16);
  assert.ok(voice.velocity >= 1 && voice.velocity <= 127);
  assert.ok(
    GRAPH_SYNTH_SCALES.minorPentatonic.includes(((voice.semitones % 12) + 12) % 12),
  );
  assert.deepEqual(voice, graphSynthVoice(event, graph, {
    rootFrequency: 440,
    scale: "minorPentatonic",
    positionPitchDepth: 24,
    depthSemitones: 12,
    level: 4,
    spread: 4,
    minFrequency: -1,
    maxFrequency: 999_999,
    filterFrequency: 999_999,
    attack: -5,
    release: 99,
    duration: 99,
  }));
});

test("graph synth UI mapping and sound aliases produce scheduler-ready voices", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0, y: 0 },
      { id: 1, x: 1, y: 1 },
      { id: 2, x: 0.5, y: 0.5 },
    ],
    edges: [
      { id: 0, from: 0, to: 1 },
      { id: 1, from: 0, to: 2 },
    ],
  };
  const event = {
    nodeId: 0,
    time: 0.25,
    amplitude: 0.8,
    cumulativeSemitones: 6,
    depth: 2,
    feedbackCount: 2,
  };
  const expectedRawPitch = {
    turn: 6,
    height: 12,
    degree: 12,
    progress: -12,
  };
  for (const [mappingMode, rawPitch] of Object.entries(expectedRawPitch)) {
    const mapped = graphSynthVoice(event, graph, {
      mode: mappingMode,
      pitchRange: 2,
      quantize: false,
    });
    assert.equal(mapped.mappingMode, mappingMode);
    assert.equal(mapped.rawSemitones, rawPitch);
  }

  const voice = graphSynthVoice(event, graph, {
    mappingMode: "progress",
    pitchRange: 1,
    scale: "minor-pentatonic",
    soundMode: "fm",
    waveform: "square",
    modulationIndex: 3.25,
    modulationRatio: 1.75,
    stereoSpread: 0.5,
    feedbackTone: 0.5,
  });
  assert.equal(voice.mappingMode, "progress");
  assert.equal(voice.mode, "fm");
  assert.equal(voice.soundMode, "fm");
  assert.equal(voice.waveform, "square");
  assert.equal(voice.modulationIndex, 3.25);
  assert.equal(voice.modIndex, 3.25);
  assert.equal(voice.modulationRatio, 1.75);
  assert.equal(voice.modRatio, 1.75);
  assert.equal(voice.stereoSpread, 0.5);
  const dry = graphSynthVoice({ ...event, feedbackCount: 0 }, graph, {
    mappingMode: "progress",
    feedbackTone: 0.5,
  });
  assert.ok(voice.brightness < dry.brightness);
});

test("graph pulse cadence is tempo-first and also accepts a patch object", () => {
  closeTo(graphPulseIntervalSeconds(120, 2), 1);
  closeTo(graphPulseIntervalSeconds(60, 0.5), 0.5);
  closeTo(
    graphPulseIntervalSeconds(GRAPH_INSTRUMENT_PATCHES.layeredGlass),
    GRAPH_INSTRUMENT_PATCHES.layeredGlass.pulseBeats
      * 60
      / GRAPH_INSTRUMENT_PATCHES.layeredGlass.tempo,
  );
  assert.ok(Number.isFinite(graphPulseIntervalSeconds(-Infinity, Infinity)));
  assert.ok(graphPulseIntervalSeconds(-Infinity, Infinity) > 0);
});
