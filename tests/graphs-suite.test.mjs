import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPH_DISTANCE_RATIO_MAX,
  GRAPH_DISTANCE_RATIO_MIN,
  GRAPHS_ANALOG_PARAMETERS,
  GRAPHS_APP_MODES,
  GRAPHS_CROSSOVER_PARAMETERS,
  GRAPHS_IDENTICAL_PARAMETERS,
  GRAPHS_UNIQUE_PARAMETERS,
  graphDistanceRatioFromTimeScale,
  graphTimeScaleFromDistanceRatio,
  graphsModeFor,
} from "../src/instruments/graphs/graphs-suite.js";
import {
  GRAPH_DELAY_PATCHES,
  edgeAudioParameters,
  generateGraph,
} from "../src/instruments/graph-delay/graph-delay.js";

test("Graphs modes describe the synth, drum machine, and live microphone sources", () => {
  assert.deepEqual(
    GRAPHS_APP_MODES.map(({ id, label, title, href, audioKind }) => ({
      id,
      label,
      title,
      href,
      audioKind,
    })),
    [
      {
        id: "synth",
        label: "Synth",
        title: "Graph Synth",
        href: "graph-synth.html",
        audioKind: "synth",
      },
      {
        id: "drums",
        label: "Drums",
        title: "Graph Drum Machine",
        href: "graph-drum-machine.html",
        audioKind: "drums",
      },
      {
        id: "mic",
        label: "Mic",
        title: "Graph Delay",
        href: "graph-delay.html",
        audioKind: "mic",
      },
    ],
  );
  assert.equal(graphsModeFor("drums").title, "Graph Drum Machine");
  assert.equal(graphsModeFor("unknown").id, "synth");
  assert.equal(Object.isFrozen(GRAPHS_APP_MODES), true);
  assert.ok(GRAPHS_APP_MODES.every(Object.isFrozen));
});

test("Graphs metadata separates shared state, mode analogs, and unique controls", () => {
  const allModes = ["synth", "drums", "mic"];
  const identical = new Map(
    GRAPHS_IDENTICAL_PARAMETERS.map((item) => [item.id, item]),
  );
  for (const id of [
    "topology",
    "nodeCount",
    "density",
    "seed",
    "nodePositions",
    "edgeSwitches",
    "baseDelay",
    "distanceRatio",
    "timeCurve",
    "nodePass",
    "feedback",
    "nodeMotionMode",
    "nodeMotionSpeed",
    "nodeMotionAmount",
    "audio",
    "level",
  ]) {
    assert.deepEqual(
      identical.get(id)?.modes,
      allModes,
      `${id} should have one value across every mode`,
    );
  }

  const analog = new Map(
    GRAPHS_ANALOG_PARAMETERS.map((item) => [item.id, item]),
  );
  assert.deepEqual(analog.get("graphPatch")?.modes, allModes);
  assert.deepEqual(analog.get("turnPitch")?.modes, allModes);
  assert.deepEqual(analog.get("feedbackTone")?.modes, allModes);
  assert.deepEqual(analog.get("seedNote")?.modes, ["synth", "drums"]);
  assert.deepEqual(analog.get("pulseClock")?.modes, ["synth", "drums"]);

  assert.ok(GRAPHS_UNIQUE_PARAMETERS.synth.some(({ id }) => id === "adsr"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.synth.some(({ id }) => id === "tuningMode"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.drums.some(({ id }) => id === "percussionStyle"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.drums.some(({ id }) => id === "drumMap"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "microphoneInput"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "pitchSlew"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "wet"));
  assert.ok(GRAPHS_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "panic"));

  for (const items of [
    GRAPHS_IDENTICAL_PARAMETERS,
    GRAPHS_ANALOG_PARAMETERS,
    ...Object.values(GRAPHS_UNIQUE_PARAMETERS),
  ]) {
    assert.ok(items.every(({ modes }) => (
      modes.length > 0 && modes.every((mode) => allModes.includes(mode))
    )));
  }
});

test("Graphs records the useful crossovers without pretending the engines are identical", () => {
  const crossovers = new Map(
    GRAPHS_CROSSOVER_PARAMETERS.map((item) => [item.id, item]),
  );
  for (const id of [
    "time-scale-to-distance-ratio",
    "microphone-position-to-event-source",
    "turn-shaping-to-event-pitch",
    "synth-tuning-to-turn-network",
    "drum-maps-to-synth-character",
    "sink-policy-to-all-modes",
    "direct-source-to-event-modes",
    "mode-aware-scene-presets",
  ]) {
    assert.equal(crossovers.has(id), true, `${id} crossover should be tracked`);
  }
  assert.equal(crossovers.has("microphone-motion-to-event-source"), false);
  assert.deepEqual(
    crossovers.get("time-scale-to-distance-ratio")?.to,
    ["synth", "drums"],
  );
  assert.match(
    crossovers.get("time-scale-to-distance-ratio")?.recommendation ?? "",
    /distanceRatio = 1 \+ timeScale \/ baseDelay/,
  );
});

test("timeScale converts exactly to distanceRatio for every Graph Delay patch", () => {
  assert.equal(GRAPH_DISTANCE_RATIO_MIN, 1);
  assert.equal(GRAPH_DISTANCE_RATIO_MAX, 12);
  const graph = generateGraph({ type: "dag", nodeCount: 10, density: 0.34, seed: 17 });

  for (const [name, patch] of Object.entries(GRAPH_DELAY_PATCHES)) {
    const distanceRatio = graphDistanceRatioFromTimeScale(
      patch.baseDelay,
      patch.timeScale,
    );
    assert.ok(
      distanceRatio >= GRAPH_DISTANCE_RATIO_MIN
        && distanceRatio <= GRAPH_DISTANCE_RATIO_MAX,
      `${name} should fit the shared distance-ratio control`,
    );
    assert.ok(
      Math.abs(
        graphTimeScaleFromDistanceRatio(patch.baseDelay, distanceRatio)
          - patch.timeScale,
      ) < 1e-9,
      `${name} should round-trip its edge-time spread`,
    );

    const additive = edgeAudioParameters(graph, {
      baseDelay: patch.baseDelay,
      timeScale: patch.timeScale,
      timeCurve: patch.timeCurve,
      nodePass: patch.nodePass,
      feedback: patch.feedback,
    });
    const multiplicative = edgeAudioParameters(graph, {
      baseDelay: patch.baseDelay,
      distanceRatio,
      timeCurve: patch.timeCurve,
      nodePass: patch.nodePass,
      feedback: patch.feedback,
    });
    assert.equal(additive.length, multiplicative.length);
    additive.forEach((edge, index) => {
      assert.ok(
        Math.abs(edge.delaySeconds - multiplicative[index].delaySeconds) < 1e-12,
        `${name} edge ${index} should retain its exact delay`,
      );
      assert.equal(edge.gain, multiplicative[index].gain);
    });
  }
});

test("timing conversion helpers sanitize missing and negative inputs", () => {
  assert.equal(graphDistanceRatioFromTimeScale(100, 0), 1);
  assert.equal(graphDistanceRatioFromTimeScale(100, -50), 1);
  assert.equal(graphDistanceRatioFromTimeScale(100, 250), 3.5);
  assert.equal(graphTimeScaleFromDistanceRatio(100, 3.5), 250);
  assert.equal(graphTimeScaleFromDistanceRatio(100, -2), 0);
  assert.equal(graphTimeScaleFromDistanceRatio(-100, 3), 0);
});
