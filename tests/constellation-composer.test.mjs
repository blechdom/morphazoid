import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_PRESET_LIBRARY,
  DEVICE_LIBRARY,
  EVENT_SIGNAL_TYPES,
  MAX_PROJECTED_EVENTS,
  MAX_PROJECTION_BEATS,
  MAX_PROJECTION_QUEUE,
  PATCH_PRESETS,
  PRIMITIVE_LIBRARY,
  SIGNAL_TYPES,
  addConnection,
  addDeviceNode,
  applyDevicePreset,
  clockEventBranches,
  clonePatchPreset,
  currentGraph,
  devicePreset,
  devicePresets,
  flattenPatch,
  getGraph,
  isMidiClockEvent,
  isMidiNoteAttack,
  isMidiNoteRelease,
  midiMessageHasControlValue,
  midiMessageHasNote,
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

const directedMidiPathCount = (graph, sourceNodeId, destinationNodeId) => {
  const outgoing = new Map();
  for (const edge of graph.edges.filter(({ signal }) => signal === "midi")) {
    if (!outgoing.has(edge.from.nodeId)) outgoing.set(edge.from.nodeId, []);
    outgoing.get(edge.from.nodeId).push(edge.to.nodeId);
  }

  const visit = (nodeId, visited) => {
    if (nodeId === destinationNodeId) return 1;
    if (visited.has(nodeId)) return 0;
    const nextVisited = new Set(visited).add(nodeId);
    return (outgoing.get(nodeId) ?? []).reduce(
      (total, nextNodeId) => total + visit(nextNodeId, nextVisited),
      0,
    );
  };

  return visit(sourceNodeId, new Set());
};

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

test("MIDI, clock, surround, recorder, monitor, and converter devices expose stable typed metadata", () => {
  assert.deepEqual(SIGNAL_TYPES, ["trigger", "audio", "control", "midi"]);
  assert.deepEqual(EVENT_SIGNAL_TYPES, ["trigger", "control", "midi"]);

  const deviceIds = new Set(DEVICE_LIBRARY.map(({ id }) => id));
  for (const id of [
    "clock-divider", "clock-multiplier", "swing-clock", "phase-clock", "sync-bridge",
    "midi-input", "midi-clock", "midi-router", "midi-output", "hiccup-head", "webgpu-303",
    "surround-output", "stereo-recorder", "stem-recorder", "scope", "level-meter",
    "spectrum", "frequency-tracker", "control-display", "frequency-to-midi",
    "midi-to-frequency", "midi-to-control", "amplitude-to-midi", "audio-to-fft-bands",
  ]) assert.equal(deviceIds.has(id), true, id);

  assert.equal(devicePresets("hiccup-head").length, 16);
  assert.equal(devicePresets("webgpu-303").length, 12);
  assert.equal(devicePreset("hiccup-head", "cavern-gob")?.params.facePresetId, "cavern-gob");
  assert.equal(devicePreset("webgpu-303", "filter-snap")?.params.synthPresetId, "filter-snap");
  assert.equal(devicePreset("webgpu-303", "missing"), null);
  assert.equal(Object.isFrozen(DEVICE_PRESET_LIBRARY), true);

  const layouts = new Set(devicePresets("surround-output").map(({ params }) => params.layoutId));
  assert.deepEqual(layouts, new Set([
    "stereo", "binaural", "quad", "4-1", "5-1", "7-1", "8-circle", "8-cube", "7-4-1",
  ]));
  assert.equal(devicePreset("stereo-recorder", "stereo-mix")?.params.format, "browser");
  assert.equal(devicePreset("stem-recorder", "stereo-stem")?.params.recordMode, "stem");

  const runtimeExpectations = {
    scope: ["monitor", "waveform"],
    "level-meter": ["monitor", "rms-peak"],
    spectrum: ["monitor", "fft"],
    "frequency-tracker": ["monitor", "fundamental"],
    "control-display": ["monitor", "control-value"],
    "frequency-to-midi": ["converter", "frequency-to-midi"],
    "midi-to-frequency": ["converter", "midi-to-frequency"],
    "midi-to-control": ["converter", "midi-to-control"],
    "amplitude-to-midi": ["converter", "amplitude-to-midi"],
    "audio-to-fft-bands": ["converter", "audio-to-fft-bands"],
  };
  for (const [id, [kind, operation]] of Object.entries(runtimeExpectations)) {
    const primitive = PRIMITIVE_LIBRARY[id];
    assert.equal(primitive.runtime.kind, kind, id);
    assert.equal(kind === "monitor" ? primitive.runtime.analysis : primitive.runtime.conversion, operation, id);
    assert.ok(primitive.ports.every(({ signal }) => SIGNAL_TYPES.includes(signal)), id);
  }
  assert.deepEqual(
    PRIMITIVE_LIBRARY["audio-to-fft-bands"].ports
      .filter(({ direction, signal }) => direction === "out" && signal === "control")
      .map(({ id }) => id),
    ["low-out", "mid-out", "high-out", "air-out"],
  );
});

test("MIDI message predicates keep notes, releases, clocks, and numeric controls distinct", () => {
  const attack = { signal: "midi", midi: { type: "noteOn", note: 69, velocity: 100 } };
  const release = { signal: "midi", midi: { type: "noteOn", note: 69, velocity: 0 } };
  const clock = { signal: "midi", midi: { type: "timingClock" } };
  const control = { signal: "midi", midi: { type: "controlChange", controller: 74, value: 96 } };

  assert.equal(midiMessageHasNote(attack), true);
  assert.equal(isMidiNoteAttack(attack), true);
  assert.equal(isMidiNoteRelease(attack), false);
  assert.equal(isMidiNoteAttack(release), false);
  assert.equal(isMidiNoteRelease(release), true);
  assert.equal(isMidiClockEvent(clock), true);
  assert.equal(midiMessageHasNote(clock), false);
  assert.equal(isMidiNoteAttack(clock), false);
  assert.equal(midiMessageHasControlValue(clock), false);
  assert.equal(midiMessageHasControlValue(control), true);
});

test("shared clock branch transforms expose live-safe divider, multiplier, swing, and phase delays", () => {
  const trigger = { id: "pulse-1", signal: "trigger", occurrence: 0 };
  const delays = (options) => clockEventBranches(trigger, options).map(({ delayBeats }) => delayBeats);

  assert.deepEqual(delays({ eventTransform: "clock-divider", params: { division: 4 }, occurrence: 0 }), [0]);
  assert.deepEqual(delays({ eventTransform: "clock-divider", params: { division: 4 }, occurrence: 1 }), []);
  assert.deepEqual(delays({ eventTransform: "clock-multiplier", params: { multiplier: 3, spacingBeats: .125 } }), [0, .125, .25]);
  assert.deepEqual(delays({ eventTransform: "clock-swing", params: { amount: .4, stepBeats: .25 }, occurrence: 0 }), [0]);
  assert.deepEqual(delays({ eventTransform: "clock-swing", params: { amount: .4, stepBeats: .25 }, occurrence: 1 }), [.1]);
  assert.deepEqual(delays({ eventTransform: "clock-phase", params: { offsetBeats: .75 } }), [.75]);
  assert.equal(trigger.occurrence, 0, "branch transforms do not mutate their input event");
});

test("MIDI clock stays non-playable until a sync bridge converts it to a root-note trigger", () => {
  let direct = clonePatchPreset("composer-studio");
  getGraph(direct, direct.rootGraphId).edges = [];
  direct = addConnection(direct, direct.rootGraphId, "midi-clock", "acid", "midi", { id: "clock-direct-acid" });
  const directProjection = projectGraphEvents(direct, { durationBeats: .2, maximum: 256 });
  const directClockEvents = directProjection.events.filter((event) => (
    event.address.includes("/acid/") && event.signal === "midi" && isMidiClockEvent(event)
  ));
  assert.ok(directClockEvents.length > 0);
  assert.ok(directClockEvents.every(({ playable, note }) => playable === false && note === null));

  let synced = clonePatchPreset("composer-studio");
  getGraph(synced, synced.rootGraphId).edges = [];
  synced = addConnection(synced, synced.rootGraphId, "midi-clock", "sync", "midi", { id: "clock-sync" });
  synced = addConnection(synced, synced.rootGraphId, "sync", "acid", "trigger", { id: "sync-acid-trigger" });
  const syncedProjection = projectGraphEvents(synced, { durationBeats: .2, maximum: 256 });
  const triggeredNotes = syncedProjection.events.filter((event) => (
    event.address.includes("/acid/") && event.signal === "trigger" && event.playable
  ));
  assert.ok(triggeredNotes.length > 0);
  assert.ok(triggeredNotes.every(({ midi, note }) => midi === null && note === 36));
});

test("system clock cannot masquerade as middle C in MIDI-to-frequency conversion", () => {
  let patch = clonePatchPreset("composer-studio");
  getGraph(patch, patch.rootGraphId).edges = [];
  patch = addConnection(patch, patch.rootGraphId, "midi-clock", "midi-frequency", "midi", { id: "clock-frequency" });
  patch = addConnection(patch, patch.rootGraphId, "midi-frequency", "number", "control", { id: "frequency-number" });
  const clockProjection = projectGraphEvents(patch, { durationBeats: .2, maximum: 256 });
  assert.equal(clockProjection.events.some((event) => (
    event.address.includes("/number/") && event.signal === "control"
  )), false);

  const sourceNode = getGraph(patch, patch.rootGraphId).nodes.find(({ id }) => id === "midi-clock");
  const sourceCore = getGraph(patch, sourceNode.graphId).nodes.find(({ deviceCore }) => deviceCore);
  sourceCore.generator = {
    signal: "midi",
    steps: [1],
    stepBeats: .25,
    midi: { type: "noteOn", note: 69, velocity: 1 },
  };
  const noteProjection = projectGraphEvents(patch, { durationBeats: .3, maximum: 256 });
  const frequency = noteProjection.events.find((event) => (
    event.address.includes("/number/") && event.signal === "control"
  ));
  assert.ok(frequency);
  assert.ok(Math.abs(frequency.frequencyHz - 440) < 1e-9);
});

test("device presets apply immutably to the subgraph and its runtime core", () => {
  const source = clonePatchPreset("pulse-cascade");
  const graphId = source.rootGraphId;
  const inserted = addDeviceNode(source, graphId, "hiccup-head", {
    id: "preset-voice",
    presetId: "humming-head",
  });
  const changed = applyDevicePreset(inserted, graphId, "preset-voice", "cavern-gob");
  const insertedNode = getGraph(inserted, graphId).nodes.find(({ id }) => id === "preset-voice");
  const changedNode = getGraph(changed, graphId).nodes.find(({ id }) => id === "preset-voice");
  const child = getGraph(changed, changedNode.graphId);
  const core = child.nodes.find(({ deviceCore }) => deviceCore);

  assert.equal(insertedNode.presetId, "humming-head", "the source patch remains unchanged");
  assert.equal(changedNode.presetId, "cavern-gob");
  assert.equal(changedNode.params.facePresetId, "cavern-gob");
  assert.equal(child.presetId, "cavern-gob");
  assert.equal(core.presetId, "cavern-gob");
  assert.equal(core.params.facePresetId, "cavern-gob");
  assert.deepEqual(
    applyDevicePreset(changed, graphId, "preset-voice", "not-a-preset"),
    changed,
    "unknown presets are ignored",
  );
});

test("MIDI through and self routes use a positive delay and remain deterministic and bounded", () => {
  let patch = clonePatchPreset("pulse-cascade");
  const graphId = patch.rootGraphId;
  patch = addDeviceNode(patch, graphId, "midi-router", { id: "test-midi-router" });
  patch = addDeviceNode(patch, graphId, "midi-output", { id: "test-midi-output" });
  patch = addConnection(patch, graphId, "rhythm", "test-midi-router", "midi", {
    id: "voice-midi-through",
  });
  patch = addConnection(patch, graphId, "test-midi-router", "test-midi-router", "midi", {
    id: "safe-midi-self",
    delayBeats: 0,
  });
  patch = addConnection(patch, graphId, "test-midi-router", "test-midi-output", "midi", {
    id: "midi-destination",
  });

  const selfEdge = getGraph(patch, graphId).edges.find(({ id }) => id === "safe-midi-self");
  assert.equal(selfEdge.timing.delayBeats, .25);
  assert.equal(selfEdge.feedback, false, "event feedback uses delay rather than the audio feedback flag");
  assert.equal(validatePatch(patch).valid, true);

  const options = { durationBeats: 4, maximum: 257, maximumDepth: 32 };
  const first = projectGraphEvents(patch, options);
  const second = projectGraphEvents(patch, options);
  const destinationEvents = first.events.filter(({ address, signal }) => (
    signal === "midi" && address.includes("/test-midi-output/")
  ));
  assert.ok(destinationEvents.length > 0);
  assert.ok(destinationEvents.every(({ note, midi }) => (
    Number.isInteger(note) && note >= 0 && note <= 127 && midi?.type === "note"
  )));
  assert.ok(first.events.length <= options.maximum);
  assert.deepEqual(first.events.map(({ id }) => id), second.events.map(({ id }) => id));
});

test("control and MIDI converters project bounded deterministic values", () => {
  let patch = clonePatchPreset("pulse-cascade");
  const graphId = patch.rootGraphId;
  patch = addDeviceNode(patch, graphId, "frequency-to-midi", {
    id: "test-frequency-midi",
    params: { minimumHz: 40, maximumHz: 4_000, channel: 3 },
  });
  patch = addDeviceNode(patch, graphId, "midi-to-frequency", {
    id: "test-midi-frequency",
    params: { minimumHz: 20, maximumHz: 20_000 },
  });
  patch = addDeviceNode(patch, graphId, "control-display", { id: "test-number" });
  patch = addDeviceNode(patch, graphId, "midi-output", { id: "test-converter-output" });
  patch = addConnection(patch, graphId, "modulator", "test-frequency-midi", "control");
  patch = addConnection(patch, graphId, "test-frequency-midi", "test-midi-frequency", "midi");
  patch = addConnection(patch, graphId, "test-frequency-midi", "test-converter-output", "midi");
  patch = addConnection(patch, graphId, "test-midi-frequency", "test-number", "control");

  assert.equal(validatePatch(patch).valid, true);
  const first = projectGraphEvents(patch, { durationBeats: 4, maximum: 500 });
  const second = projectGraphEvents(patch, { durationBeats: 4, maximum: 500 });
  const midi = first.events.find(({ address, signal }) => (
    signal === "midi" && address.includes("/test-frequency-midi/midi-out")
  ));
  const frequency = first.events.find(({ address, signal }) => (
    signal === "control" && address.includes("/test-midi-frequency/control-out")
  ));

  assert.ok(midi);
  assert.ok(Number.isInteger(midi.note) && midi.note >= 0 && midi.note <= 127);
  assert.ok(midi.frequencyHz >= 40 && midi.frequencyHz <= 4_000);
  assert.equal(midi.midi.channel, 3);
  assert.ok(frequency);
  assert.ok(frequency.value >= 0 && frequency.value <= 1);
  assert.ok(Number.isFinite(frequency.frequencyHz));
  assert.deepEqual(eventSignature(first), eventSignature(second));
});

test("factory studio presets demonstrate merge, fan-out, delayed MIDI, and explicit audio feedback", () => {
  const studio = clonePatchPreset("composer-studio");
  const studioRoot = getGraph(studio, studio.rootGraphId);
  const studioDeviceIds = new Set(studioRoot.nodes.map(({ deviceId }) => deviceId));
  assert.equal(validatePatch(studio).valid, true);
  assert.ok(studioRoot.edges.filter(({ from, signal }) => (
    from.nodeId === "master-clock" && signal === "trigger"
  )).length >= 3, "one clock output fans to many destinations");
  assert.ok(studioRoot.edges.some(({ from, to, signal }) => (
    from.nodeId === "sync" && to.nodeId === "divider" && signal === "trigger"
  )), "internal or external sync pulses feed the divided sequencer branch");
  assert.equal(studioRoot.edges.filter(({ to, signal }) => (
    to.nodeId === "mixer" && signal === "audio"
  )).length, 3, "parallel instrument/effect paths merge into one mixer input");
  assert.ok(studioRoot.edges.filter(({ from, signal }) => (
    from.nodeId === "mixer" && signal === "audio"
  )).length >= 6, "one mixer output fans to recorder and analysis taps");
  assert.deepEqual(studioRoot.edges.filter(({ to, signal }) => (
    to.nodeId === "midi-router" && signal === "midi"
  )).map(({ from }) => from.nodeId).sort(), [
    "amp-midi", "frequency-midi", "hiccup", "midi-input", "synth",
  ], "independent MIDI sources merge into one router input");
  assert.equal(directedMidiPathCount(studioRoot, "midi-input", "midi-output"), 1,
    "external MIDI bytes have exactly one message-preserving route to hardware output");
  assert.equal(directedMidiPathCount(studioRoot, "midi-clock", "midi-output"), 1,
    "internal MIDI clock bytes have exactly one message-preserving route to hardware output");
  assert.ok(studioRoot.edges.some(({ from, to, signal }) => (
    from.nodeId === "midi-input" && to.nodeId === "acid" && signal === "midi"
  )), "Acid remains directly playable from MIDI notes");
  assert.equal(studioRoot.edges.some(({ from, to, signal }) => (
    from.nodeId === "acid" && to.nodeId === "midi-router" && signal === "midi"
  )), false, "Acid MIDI thru does not duplicate input at the hardware output");
  assert.equal(studioRoot.edges.some(({ from, to, signal }) => (
    from.nodeId === "midi-input" && to.nodeId === "synth" && signal === "midi"
  )), false, "Graph Synth does not create a second direct MIDI-thru route");
  assert.ok(studioRoot.edges.some(({ from, to, signal }) => (
    from.nodeId === "synth" && to.nodeId === "midi-router" && signal === "midi"
  )), "divided MIDI sync can emit newly generated Graph Synth notes");
  const studioProjection = projectGraphEvents(studio, { durationBeats: studio.cycleBeats });
  assert.equal(studioProjection.truncated, false);
  assert.equal(studioProjection.events.filter(({ playable }) => playable).length, 72,
    "deduplicating MIDI thru preserves the authored playable event pattern");
  for (const id of [
    "midi-input", "hiccup-head", "webgpu-303", "surround-output", "stereo-recorder", "stem-recorder",
    "scope", "level-meter", "spectrum", "frequency-tracker", "control-display",
    "frequency-to-midi", "midi-to-frequency", "midi-to-control", "amplitude-to-midi",
    "audio-to-fft-bands",
  ]) assert.equal(studioDeviceIds.has(id), true, id);

  const feedback = clonePatchPreset("feedback-observatory");
  const feedbackRoot = getGraph(feedback, feedback.rootGraphId);
  const audioLoop = feedbackRoot.edges.find(({ id }) => id === "delay-audio-feedback");
  const midiLoop = feedbackRoot.edges.find(({ id }) => id === "midi-delayed-self");
  const delayedInstrument = feedbackRoot.edges.find(({ id }) => id === "midi-delayed-acid");
  assert.equal(validatePatch(feedback).valid, true);
  assert.deepEqual(
    [audioLoop.signal, audioLoop.feedback, audioLoop.from.nodeId, audioLoop.to.nodeId],
    ["audio", true, "delay", "delay"],
  );
  assert.deepEqual([midiLoop.signal, midiLoop.feedback, midiLoop.timing.delayBeats], ["midi", false, .5]);
  assert.equal(delayedInstrument.timing.delayBeats, .25);
  const projected = projectGraphEvents(feedback, { durationBeats: 2, maximum: 401 });
  assert.ok(projected.events.length <= 401);
  assert.ok(projected.events.some(({ signal }) => signal === "midi"));
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
