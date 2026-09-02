import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_LIBRARY,
  MAX_PROJECTED_EVENTS,
  MAX_PROJECTION_BEATS,
  MAX_PROJECTION_QUEUE,
  PATCH_PRESETS,
  SIGNAL_TYPES,
  addConnection,
  addDeviceNode,
  clonePatchPreset,
  currentGraph,
  flattenPatch,
  getGraph,
  moveGraphNode,
  moveProjectedEvent,
  portsForNode,
  projectGraphEvents,
  projectTimeline,
  updateConnection,
  validatePatch,
} from "../src/constellation-composer.js";

const eventSignature = (projection) => projection.events.map((event) => ({
  address: event.address,
  beat: event.beat,
  signal: event.signal,
  playable: event.playable,
  occurrence: event.occurrence,
}));

test("patch presets are valid recursive graphs with typed device ports and edges", () => {
  assert.ok(PATCH_PRESETS.length >= 8);
  assert.ok(DEVICE_LIBRARY.some(({ category }) => category === "sound"));
  assert.ok(DEVICE_LIBRARY.some(({ category }) => category === "effect"));
  assert.ok(DEVICE_LIBRARY.some(({ category }) => category === "control"));

  for (const preset of PATCH_PRESETS) {
    assert.equal(preset.schemaVersion, 2, preset.id);
    assert.equal(validatePatch(preset).valid, true, preset.id);
    assert.equal(currentGraph(preset)?.id, preset.rootGraphId, preset.id);
    assert.ok(preset.graphs.length > 1, `${preset.id} should contain subgraphs`);
    assert.equal("sections" in preset, false, `${preset.id} must not encode song sections`);

    const root = getGraph(preset, preset.rootGraphId);
    assert.ok(root.nodes.some(({ type }) => type === "subgraph"), preset.id);
    for (const edge of root.edges) {
      assert.ok(SIGNAL_TYPES.includes(edge.signal), `${preset.id}/${edge.id}`);
      const fromNode = root.nodes.find(({ id }) => id === edge.from.nodeId);
      const toNode = root.nodes.find(({ id }) => id === edge.to.nodeId);
      const fromPort = portsForNode(preset, root, fromNode)
        .find(({ id }) => id === edge.from.portId);
      const toPort = portsForNode(preset, root, toNode)
        .find(({ id }) => id === edge.to.portId);
      assert.deepEqual(
        [fromPort?.direction, fromPort?.signal, toPort?.direction, toPort?.signal],
        ["out", edge.signal, "in", edge.signal],
        `${preset.id}/${edge.id}`,
      );
    }
  }
});

test("nested sound graphs project scoped events without colliding local node ids", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const root = getGraph(patch, patch.rootGraphId);
  const rhythm = root.nodes.find(({ id }) => id === "rhythm");
  const voice = root.nodes.find(({ id }) => id === "voice");

  assert.equal(getGraph(patch, rhythm.graphId).nodes.some(({ id }) => id === "voice"), true);
  assert.equal(getGraph(patch, voice.graphId).nodes.some(({ id }) => id === "voice"), true);

  const projection = projectGraphEvents(patch, { durationBeats: 4 });
  const rhythmEvent = projection.events.find((event) => (
    event.playable && event.instances.some(({ nodeId }) => nodeId === "rhythm")
  ));
  const voiceEvent = projection.events.find((event) => (
    event.playable && event.instances.some(({ nodeId }) => nodeId === "voice")
  ));

  assert.ok(rhythmEvent);
  assert.ok(voiceEvent);
  assert.equal(rhythmEvent.nodeId, "voice");
  assert.equal(voiceEvent.nodeId, "voice");
  assert.notEqual(rhythmEvent.address, voiceEvent.address);
  assert.match(rhythmEvent.address, new RegExp(`^${patch.rootGraphId}/rhythm/`));
  assert.match(voiceEvent.address, new RegExp(`^${patch.rootGraphId}/voice/`));

  const rootTimeline = projectTimeline(patch, patch.rootGraphId, { durationBeats: 4 });
  assert.ok(rootTimeline.events.some(({ laneId }) => laneId === `${patch.rootGraphId}:rhythm`));
  assert.ok(rootTimeline.events.some(({ laneId }) => laneId === `${patch.rootGraphId}:voice`));
});

test("only trigger and control edges affect projected event time", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const root = getGraph(patch, patch.rootGraphId);
  const firstVoiceBeat = (candidate) => projectGraphEvents(candidate, { durationBeats: 8 })
    .events.find((event) => event.playable && event.address.includes("/voice/voice"))?.beat;

  const baselineBeat = firstVoiceBeat(patch);
  const audioEdge = root.edges.find(({ signal }) => signal === "audio");
  const audioRetimed = updateConnection(patch, root.id, audioEdge.id, { delayBeats: 7 });
  assert.equal(firstVoiceBeat(audioRetimed), baselineBeat, "audio routing delay is not musical event time");

  const triggerEdge = root.edges.find(({ id }) => id === "clock-voice");
  const triggerRetimed = updateConnection(patch, root.id, triggerEdge.id, {
    delayBeats: triggerEdge.timing.delayBeats + 2,
  });
  assert.equal(firstVoiceBeat(triggerRetimed), baselineBeat + 2);

  const malformed = structuredClone(patch);
  getGraph(malformed, malformed.rootGraphId).edges.push({
    id: "clock-audio-voice",
    from: { nodeId: "clock", portId: "trigger-out" },
    to: { nodeId: "voice", portId: "trigger-in" },
    signal: "audio",
    timing: { delayBeats: 0, probability: 1 },
    gain: 1,
  });
  const validation = validatePatch(malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /Incompatible audio ports/.test(error)));
});

test("positive-delay trigger cycles project deterministically within hard bounds", () => {
  let patch = clonePatchPreset("pulse-cascade");
  const graphId = patch.rootGraphId;
  patch = addConnection(patch, graphId, "voice", "effect-b", "trigger", {
    id: "voice-to-echo",
    delayBeats: 0.5,
  });
  patch = addConnection(patch, graphId, "effect-b", "voice", "trigger", {
    id: "echo-to-voice",
    delayBeats: 0.5,
  });

  assert.equal(validatePatch(patch).valid, true);
  const first = projectGraphEvents(patch, {
    durationBeats: 64,
    maximum: 37,
    maximumDepth: 24,
  });
  const second = projectGraphEvents(patch, {
    durationBeats: 64,
    maximum: 37,
    maximumDepth: 24,
  });
  assert.equal(first.events.length, 37);
  assert.equal(first.truncated, true);
  assert.deepEqual(first.events.map(({ id }) => id), second.events.map(({ id }) => id));

  let zeroDelay = clonePatchPreset("pulse-cascade");
  zeroDelay = addConnection(zeroDelay, graphId, "voice", "effect-b", "trigger", {
    id: "voice-to-echo-zero",
    delayBeats: 0,
  });
  zeroDelay = addConnection(zeroDelay, graphId, "effect-b", "voice", "trigger", {
    id: "echo-to-voice-zero",
    delayBeats: 0,
  });
  const validation = validatePatch(zeroDelay);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /Zero-delay trigger\/control cycle/.test(error)));
});

test("graph layout is immutable and independent of event timing", () => {
  const patch = clonePatchPreset("polyrhythm-mesh");
  const root = getGraph(patch, patch.rootGraphId);
  const node = root.nodes.find(({ id }) => id === "voice");
  const before = projectGraphEvents(patch, { durationBeats: 8 });
  const moved = moveGraphNode(patch, root.id, node.id, 0.91, 0.08);
  const after = projectGraphEvents(moved, { durationBeats: 8 });

  assert.deepEqual(eventSignature(after), eventSignature(before));
  assert.deepEqual([
    getGraph(moved, root.id).nodes.find(({ id }) => id === node.id).x,
    getGraph(moved, root.id).nodes.find(({ id }) => id === node.id).y,
  ], [0.91, 0.08]);
  assert.deepEqual([node.x, node.y], [0.32, 0.66], "the source patch remains unchanged");
});

test("moving a projected event immutably edits its causal rule and reprojects", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const before = projectGraphEvents(patch, { durationBeats: 8 });
  const event = before.events.find((candidate) => (
    candidate.playable
    && candidate.address.includes("/voice/voice")
    && candidate.rule.kind === "edge"
  ));
  assert.ok(event);

  const sourceGraph = getGraph(patch, event.rule.graphId);
  const sourceEdge = sourceGraph.edges.find(({ id }) => id === event.rule.edgeId);
  const originalDelay = sourceEdge.timing.delayBeats;
  const requestedBeat = event.beat + 0.75;
  const changed = moveProjectedEvent(patch, event, requestedBeat);
  const changedEdge = getGraph(changed, event.rule.graphId).edges
    .find(({ id }) => id === event.rule.edgeId);

  assert.equal(sourceEdge.timing.delayBeats, originalDelay, "the source patch remains unchanged");
  assert.equal(changedEdge.timing.delayBeats, originalDelay + 0.75);

  const movedEvent = projectGraphEvents(changed, { durationBeats: 8 }).events.find((candidate) => (
    candidate.address === event.address
    && candidate.originAddress === event.originAddress
    && candidate.occurrence === event.occurrence
  ));
  assert.ok(movedEvent);
  assert.equal(movedEvent.beat, requestedBeat);
});

test("moving a root timeline event edits its nearest displayed-graph edge, not its nested last hop", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const rootGraphId = patch.rootGraphId;
  const event = projectTimeline(patch, rootGraphId, { durationBeats: 4 }).events.find((candidate) => (
    candidate.playable
    && candidate.displayNodeId === "voice"
    && candidate.rule?.edgeId === "trigger-voice"
    && candidate.edgePath.some(({ graphId, edgeId }) => (
      graphId === rootGraphId && edgeId === "clock-voice"
    ))
  ));
  assert.ok(event);
  assert.equal(event.displayGraphId, rootGraphId);
  assert.deepEqual(event.rule, {
    kind: "edge",
    graphId: `${rootGraphId}-voice`,
    edgeId: "trigger-voice",
  });

  const rootEdge = getGraph(patch, rootGraphId).edges.find(({ id }) => id === "clock-voice");
  const nestedEdge = getGraph(patch, event.rule.graphId).edges.find(({ id }) => id === "trigger-voice");
  const requestedBeat = event.beat + 0.75;
  const changed = moveProjectedEvent(patch, event, requestedBeat);
  const changedRootEdge = getGraph(changed, rootGraphId).edges.find(({ id }) => id === "clock-voice");
  const changedNestedEdge = getGraph(changed, event.rule.graphId).edges.find(({ id }) => id === "trigger-voice");

  assert.equal(rootEdge.timing.delayBeats, 1, "the source patch remains unchanged");
  assert.equal(changedRootEdge.timing.delayBeats, rootEdge.timing.delayBeats + 0.75);
  assert.equal(changedNestedEdge.timing.delayBeats, nestedEdge.timing.delayBeats);

  const movedEvent = projectTimeline(changed, rootGraphId, { durationBeats: 4 }).events.find((candidate) => (
    candidate.playable
    && candidate.address === event.address
    && candidate.originAddress === event.originAddress
    && candidate.occurrence === event.occurrence
  ));
  assert.ok(movedEvent);
  assert.equal(movedEvent.beat, requestedBeat);
});

test("device insertion adds a nested graph without implicit song-flow scaffolding", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const root = getGraph(patch, patch.rootGraphId);
  const changed = addDeviceNode(patch, root.id, "filter", { id: "second-filter" });
  const changedRoot = getGraph(changed, root.id);
  const inserted = changedRoot.nodes.find(({ id }) => id === "second-filter");

  assert.equal(changedRoot.nodes.length, root.nodes.length + 1);
  assert.equal(inserted.type, "subgraph");
  assert.equal(getGraph(changed, inserted.graphId).kind, "effect");
  assert.equal(root.nodes.some(({ id }) => id === "second-filter"), false);
  assert.equal(changedRoot.nodes.some(({ type }) => ["entry", "fork", "join", "exit"].includes(type)), false);
});

test("explicit subgraph port ids are exact and bogus ports are never silently retargeted", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const root = getGraph(patch, patch.rootGraphId);
  const changed = addConnection(patch, root.id, "clock", "rhythm", "trigger", {
    id: "bogus-exact-port",
    fromPortId: "not-a-real-trigger-output",
    toPortId: "trigger-in",
  });

  assert.equal(
    getGraph(changed, root.id).edges.some(({ id }) => id === "bogus-exact-port"),
    false,
    "a requested port id must not fall back to a different compatible port",
  );

  const malformed = structuredClone(patch);
  getGraph(malformed, root.id).edges.push({
    id: "stored-bogus-port",
    from: { nodeId: "clock", portId: "not-a-real-trigger-output" },
    to: { nodeId: "rhythm", portId: "trigger-in" },
    signal: "trigger",
    timing: { delayBeats: 0, probability: 1 },
    gain: 1,
    feedback: false,
  });
  const validation = validatePatch(malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /Incompatible trigger ports.*stored-bogus-port/.test(error)));
  assert.equal(
    flattenPatch(malformed).edges.some(({ id }) => id === "stored-bogus-port"),
    false,
    "invalid stored endpoints must not enter the flattened runtime graph",
  );
});

test("malformed graph collections and interface targets report invalid without throwing", () => {
  const malformedPatches = [
    ["graphs collection", (patch) => { patch.graphs = {}; }],
    ["node collection", (patch) => { getGraph(patch, patch.rootGraphId).nodes = {}; }],
    ["edge collection", (patch) => { getGraph(patch, patch.rootGraphId).edges = {}; }],
    ["interface collection", (patch) => {
      patch.graphs.find(({ id }) => id !== patch.rootGraphId).interface = {};
    }],
    ["interface target", (patch) => {
      const child = patch.graphs.find(({ id }) => id !== patch.rootGraphId);
      child.interface[0].nodeId = "missing-interface-node";
    }],
  ];

  for (const [label, mutate] of malformedPatches) {
    const patch = clonePatchPreset("pulse-cascade");
    mutate(patch);
    let validation;
    assert.doesNotThrow(() => { validation = validatePatch(patch); }, label);
    assert.equal(validation.valid, false, label);
    assert.doesNotThrow(() => flattenPatch(patch), `${label} flattening`);
  }
});

test("audio feedback must be explicit while delayed control feedback remains schedulable", () => {
  const patch = clonePatchPreset("pulse-cascade");
  const graphId = patch.rootGraphId;
  const unsafeAudio = structuredClone(patch);
  getGraph(unsafeAudio, graphId).edges.push({
    id: "stored-unsafe-direct-audio-cycle",
    from: { nodeId: "effect-b", portId: "audio-out" },
    to: { nodeId: "effect-b", portId: "audio-in" },
    signal: "audio",
    timing: { delayBeats: 0, probability: 1 },
    gain: 1,
    feedback: false,
  });
  const unsafeValidation = validatePatch(unsafeAudio);
  assert.equal(unsafeValidation.valid, false);
  assert.ok(unsafeValidation.errors.some((error) => /audio.*cycle|feedback/i.test(error)));

  const safeAudio = addConnection(patch, graphId, "effect-b", "effect-b", "audio", {
    id: "feedback-safe-audio-cycle",
  });
  assert.equal(
    getGraph(safeAudio, graphId).edges.find(({ id }) => id === "feedback-safe-audio-cycle").feedback,
    true,
    "an interactive connection that closes an audio cycle is made feedback-safe before recompilation",
  );
  assert.equal(validatePatch(safeAudio).valid, true);

  let delayedControl = addDeviceNode(patch, graphId, "blank-graph", { id: "control-a" });
  delayedControl = addDeviceNode(delayedControl, graphId, "blank-graph", { id: "control-b" });
  delayedControl = addConnection(delayedControl, graphId, "control-a", "control-b", "control", {
    id: "control-a-b",
    delayBeats: 0.25,
  });
  delayedControl = addConnection(delayedControl, graphId, "control-b", "control-a", "control", {
    id: "control-b-a",
    delayBeats: 0.25,
  });
  assert.equal(validatePatch(delayedControl).valid, true);

  const zeroDelayControl = updateConnection(delayedControl, graphId, "control-a-b", { delayBeats: 0 });
  const zeroDelayBoth = updateConnection(zeroDelayControl, graphId, "control-b-a", { delayBeats: 0 });
  const controlValidation = validatePatch(zeroDelayBoth);
  assert.equal(controlValidation.valid, false);
  assert.ok(controlValidation.errors.some((error) => /Zero-delay trigger\/control cycle/.test(error)));
});

test("simultaneous distinct trigger routes remain separate and retain ordered edge provenance", () => {
  let patch = clonePatchPreset("pulse-cascade");
  const graphId = patch.rootGraphId;
  patch = addConnection(patch, graphId, "clock", "voice", "trigger", {
    id: "clock-voice-parallel",
    fromPortId: "trigger-out",
    toPortId: "trigger-in",
    delayBeats: 1,
  });

  const simultaneous = projectGraphEvents(patch, { durationBeats: 1.5 }).events.filter((event) => (
    event.playable
    && event.address === `${graphId}/voice/voice`
    && Math.abs(event.beat - 1) < 1e-7
  ));
  assert.equal(simultaneous.length, 2);
  assert.equal(new Set(simultaneous.map(({ id }) => id)).size, 2);
  assert.deepEqual(
    simultaneous.map((event) => event.edgePath
      .find(({ graphId: edgeGraphId }) => edgeGraphId === graphId)?.edgeId).sort(),
    ["clock-voice", "clock-voice-parallel"],
  );
  for (const event of simultaneous) {
    assert.equal(event.edgePath[0].graphId, `${graphId}-clock`);
    assert.equal(event.edgePath.at(-1).edgeId, "trigger-voice");
    assert.ok(event.edgePath.every(({ graphId: edgeGraphId, edgeId, signal }) => (
      typeof edgeGraphId === "string" && typeof edgeId === "string" && signal === "trigger"
    )));
  }
});

test("projection clamps oversized horizons and bounds event and queue growth", () => {
  assert.ok(MAX_PROJECTION_QUEUE > MAX_PROJECTED_EVENTS);
  const patch = clonePatchPreset("feedback-garden");
  const projection = projectGraphEvents(patch, {
    durationBeats: MAX_PROJECTION_BEATS * 2,
    maximum: Number.MAX_SAFE_INTEGER,
    maximumDepth: Number.MAX_SAFE_INTEGER,
  });

  assert.equal(projection.durationBeats, MAX_PROJECTION_BEATS);
  assert.ok(projection.events.length <= MAX_PROJECTED_EVENTS);
  assert.equal(projection.truncated, true);
});
