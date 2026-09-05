import assert from "node:assert/strict";
import test from "node:test";

import {
  NIGHTINGALE_MANIFOLD_LIMITS,
  analyzeNightingaleSequence,
  assembleAudioSegments,
  assembleStropheRoute,
  buildStropheTraversal,
  createDemoNightingaleSequence,
  nightingaleManifoldExport,
} from "../src/nightingale-manifold.js";

const demo = createDemoNightingaleSequence(16_000);
const analysis = analyzeNightingaleSequence(demo.samples, demo.sampleRate);

test("the compressed local study resolves into pause-bounded strophe occurrences", () => {
  assert.equal(demo.expectedStrophes, 18);
  assert.equal(analysis.strophes.length, demo.expectedStrophes);
  assert.equal(analysis.sequenceEdges.length, demo.expectedStrophes - 1);
  assert.ok(analysis.similarityEdges.length >= demo.expectedStrophes);
  assert.equal(analysis.segmentation.stropheGapSeconds, 0.8);
  assert.equal(analysis.segmentation.minimumStropheSeconds, 0.5);
  assert.match(analysis.segmentation.operationalDefinition, /pause/i);
  assert.equal(analysis.tones.length, 48);
  assert.deepEqual(
    analysis.strophes.flatMap((strophe) => strophe.tones),
    analysis.tones,
    "top-level tone candidates preserve source order and parent membership",
  );

  for (const [index, strophe] of analysis.strophes.entries()) {
    assert.equal(strophe.index, index);
    assert.equal(strophe.id, `S${String(index + 1).padStart(3, "0")}`);
    assert.ok(strophe.durationSeconds >= 0.5);
    assert.ok(strophe.startSample < strophe.endSample);
    assert.ok(strophe.frameStart <= strophe.frameEnd);
    assert.ok(strophe.family >= 1);
    assert.ok(Object.values(strophe.position).every(Number.isFinite));
    assert.equal(strophe.envelopeScales.length, 3);
    assert.ok(strophe.envelopeScales[0].windowSeconds < strophe.envelopeScales[1].windowSeconds);
    assert.ok(strophe.envelopeScales[1].windowSeconds < strophe.envelopeScales[2].windowSeconds);
    assert.ok(strophe.envelopeScales.every((scale) => (
      scale.modulation >= 0 && scale.variation >= 0
    )));
    assert.equal(strophe.similarityDescriptor.length, analysis.similarity.descriptorNames.length);
    assert.ok(strophe.similarityVector.every(Number.isFinite));
    assert.ok(strophe.tones.length >= 1);
    for (const tone of strophe.tones) {
      assert.equal(tone.parentStropheIndex, index);
      assert.equal(tone.parentStropheId, strophe.id);
      assert.ok(tone.startFrame >= strophe.frameStart);
      assert.ok(tone.endFrame <= strophe.frameEnd);
      assert.ok(tone.startSeconds >= strophe.startSeconds);
      assert.ok(tone.endSeconds <= strophe.endSeconds);
      assert.ok(tone.peakEnergy >= tone.energy);
      assert.ok(Object.values(tone.position).every(Number.isFinite));
      for (let frameIndex = tone.startFrame; frameIndex <= tone.endFrame; frameIndex += 1) {
        assert.equal(
          analysis.frames[frameIndex].active,
          true,
          `${tone.id} should contain only silence-gated active frames`,
        );
      }
    }
  }

  for (const [index, edge] of analysis.sequenceEdges.entries()) {
    assert.deepEqual(edge, { source: index, target: index + 1, weight: 1, observed: true });
  }
  for (const edge of analysis.similarityEdges) {
    assert.ok(edge.source < edge.target, "similarity links are undirected canonical pairs");
    assert.ok(edge.distance >= 0);
    assert.ok(edge.weight > 0 && edge.weight <= 1);
  }
});

test("the multiscale projection is finite, deterministic, and explicitly lossy", () => {
  const second = analyzeNightingaleSequence(demo.samples, demo.sampleRate);
  assert.equal(analysis.embedding.method, "standardized-pca-3");
  assert.equal(analysis.embedding.explainedVariance.length, 3);
  assert.ok(analysis.embedding.explainedVarianceTotal > 0);
  assert.ok(analysis.embedding.explainedVarianceTotal <= 1.000001);
  assert.deepEqual(
    second.strophes.map((strophe) => strophe.position),
    analysis.strophes.map((strophe) => strophe.position),
  );
  assert.match(analysis.warning, /projection/i);
  assert.match(analysis.warning, /observed order/i);
  assert.match(analysis.similarity.note, /three time scales/i);
});

test("silence returns an empty, usable manifold instead of invented nodes", () => {
  const silent = analyzeNightingaleSequence(new Float32Array(16_000), 16_000);
  assert.equal(silent.strophes.length, 0);
  assert.equal(silent.tones.length, 0);
  assert.equal(silent.similarityEdges.length, 0);
  assert.equal(silent.sequenceEdges.length, 0);
  assert.match(silent.warning, /No signal/i);
});

test("one valid phrase does not invent a self-similarity edge", () => {
  const samples = new Float32Array(32_000);
  for (let index = 4_000; index < 24_000; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * 1_300 * index / 16_000) * 0.7;
  }
  const single = analyzeNightingaleSequence(samples, 16_000);
  assert.equal(single.strophes.length, 1);
  assert.equal(single.similarityEdges.length, 0);
  assert.equal(single.sequenceEdges.length, 0);
});

test("profile geometry uses source-faithful polyphase downsampling instead of aliasing", () => {
  const sourceRate = 44_100;
  const audible = new Float32Array(sourceRate);
  for (let index = 4_000; index < 36_000; index += 1) {
    audible[index] = Math.sin(2 * Math.PI * 4_000 * index / sourceRate) * 0.7;
  }
  const resampled = analyzeNightingaleSequence(audible, sourceRate, {
    analysisTargetRate: 24_000,
  });
  assert.equal(resampled.analysisSampleRate, 24_000);
  assert.ok(Math.abs(resampled.downsampleStride - sourceRate / 24_000) < 1e-12);
  assert.equal(resampled.resampling, "polyphase-windowed-sinc");
  assert.equal(resampled.strophes.length, 1);

  const outOfBand = new Float32Array(48_000);
  for (let index = 0; index < outOfBand.length; index += 1) {
    outOfBand[index] = Math.sin(2 * Math.PI * 18_000 * index / 48_000) * 0.7;
  }
  const rejected = analyzeNightingaleSequence(outOfBand, 48_000, {
    analysisTargetRate: 24_000,
    minimumSpectralHz: 250,
    maximumSpectralHz: 11_000,
  });
  assert.equal(rejected.strophes.length, 0, "18 kHz should not alias into the 24 kHz analysis stream");
  assert.ok(rejected.frames.filter((frame) => frame.active).length <= 2);
});

test("chronology, similarity, and hybrid walks are bounded and repeatable", () => {
  const chronology = buildStropheTraversal(analysis, {
    rule: "chronology",
    length: 8,
    startIndex: 15,
  });
  assert.deepEqual(chronology, [15, 16, 17, 0, 1, 2, 3, 4]);

  for (const rule of ["similarity", "hybrid"]) {
    const options = { rule, length: 13, startIndex: 4, surprise: 0.7, seed: 91 };
    const first = buildStropheTraversal(analysis, options);
    const second = buildStropheTraversal(analysis, options);
    assert.deepEqual(first, second);
    assert.equal(first.length, 13);
    assert.ok(first.every((index) => index >= 0 && index < analysis.strophes.length));
  }

  const grouped = {
    strophes: [{}, {}, {}],
    similarityEdges: [{ source: 0, target: 2, weight: 0.1 }],
    sequenceEdges: [
      { source: 0, target: 1, weight: 1, withinConfiguredSequence: false },
      { source: 1, target: 2, weight: 1, withinConfiguredSequence: true },
    ],
  };
  assert.deepEqual(
    buildStropheTraversal(grouped, {
      rule: "hybrid",
      length: 2,
      startIndex: 0,
      surprise: 0,
      seed: 91,
    }),
    [0, 2],
    "a sequence-group break should not act as a hybrid graph edge",
  );
});

test("reverse, shuffled, spatial, and axis walks follow deterministic 3D rules", () => {
  const projected = {
    strophes: [
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 1, y: 0, z: 0 } },
      { position: { x: 1, y: 2, z: 0 } },
      { position: { x: 4, y: 0, z: 0 } },
      { position: { x: -2, y: 1, z: 3 } },
      { position: { x: Number.NaN, y: 5, z: 5 } },
    ],
  };
  const expected = {
    "reverse-chronology": [2, 1, 0, 5, 4, 3, 2, 1],
    "spatial-nearest": [2, 1, 0, 4, 3, 5, 0, 1],
    "spatial-farthest": [2, 4, 3, 0, 1, 5, 0, 3],
    "axis-x": [2, 3, 5, 4, 0, 1, 2, 3],
    "axis-y": [2, 5, 0, 1, 3, 4, 2, 5],
    "axis-z": [2, 3, 4, 5, 0, 1, 2, 3],
  };

  for (const [rule, route] of Object.entries(expected)) {
    const options = { rule, length: 8, startIndex: 2, seed: 91, surprise: 0 };
    const generated = buildStropheTraversal(projected, options);
    assert.deepEqual(generated, route, rule);
    assert.deepEqual(
      buildStropheTraversal(projected, { ...options, surprise: 1 }),
      route,
      `${rule} must ignore acoustic-walk surprise`,
    );
    assert.deepEqual(
      buildStropheTraversal(projected, { ...options, seed: 9_191 }),
      route,
      `${rule} must not depend on the shuffle seed`,
    );
    assert.equal(Object.isFrozen(generated), true);
    assert.equal(generated[0], 2);
    assert.equal(new Set(generated.slice(0, 6)).size, 6, `${rule} visits every node before repeating`);
  }

  const shuffled = buildStropheTraversal(projected, {
    rule: "shuffled",
    length: 14,
    startIndex: 2,
    seed: 91,
    surprise: 0,
  });
  assert.deepEqual(shuffled, [2, 5, 4, 3, 1, 0, 3, 0, 4, 2, 5, 1, 4, 3]);
  assert.deepEqual(
    buildStropheTraversal(projected, {
      rule: "shuffled", length: 14, startIndex: 2, seed: 91, surprise: 1,
    }),
    shuffled,
  );
  assert.notDeepEqual(
    buildStropheTraversal(projected, {
      rule: "shuffled", length: 14, startIndex: 2, seed: 92,
    }),
    shuffled,
  );
  assert.equal(Object.isFrozen(shuffled), true);
  assert.equal(new Set(shuffled.slice(0, 6)).size, 6);
  assert.equal(new Set(shuffled.slice(6, 12)).size, 6);
  assert.ok(shuffled.slice(1).every((index, step) => index !== shuffled[step]));
});

test("3D walks retain malformed nodes, resolve ties by index, and handle degenerates", () => {
  const malformed = {
    strophes: [
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 0, z: 0 } },
      { position: { x: 1, y: 0, z: 0 } },
      { position: { x: -1, y: 0, z: 0 } },
    ],
  };
  assert.deepEqual(
    buildStropheTraversal(malformed, {
      rule: "spatial-nearest", length: 4, startIndex: 0,
    }),
    [0, 2, 3, 1],
  );
  assert.deepEqual(
    buildStropheTraversal(malformed, {
      rule: "spatial-farthest", length: 4, startIndex: 0,
    }),
    [0, 2, 3, 1],
  );
  assert.deepEqual(
    buildStropheTraversal(malformed, {
      rule: "spatial-nearest", length: 4, startIndex: 1,
    }),
    [1, 0, 2, 3],
    "an invalid current point falls back to the lowest unvisited index",
  );
  assert.deepEqual(
    buildStropheTraversal(malformed, {
      rule: "axis-x", length: 4, startIndex: 3,
    }),
    [3, 0, 2, 1],
    "axis sorting places incomplete positions after every valid position",
  );

  const single = { strophes: [{ position: { x: 4, y: -2, z: 1 } }] };
  for (const rule of [
    "reverse-chronology",
    "shuffled",
    "spatial-nearest",
    "spatial-farthest",
    "axis-x",
    "axis-y",
    "axis-z",
  ]) {
    assert.deepEqual(
      buildStropheTraversal(single, { rule, length: 4, startIndex: 99 }),
      [0, 0, 0, 0],
      rule,
    );
  }
  assert.deepEqual(buildStropheTraversal({ strophes: [] }, { rule: "axis-x" }), []);
  assert.deepEqual(
    buildStropheTraversal(malformed, { rule: "manual", length: 4, startIndex: 2 }),
    [2],
    "manual-route compatibility remains one selected event",
  );
});

test("recording and generated segments assemble with an inspectable route timeline", () => {
  const indices = [0, 4, 2];
  const recording = assembleStropheRoute(demo.samples, analysis, indices, { gapSeconds: 0.1 });
  assert.equal(recording.timeline.length, indices.length);
  assert.deepEqual(recording.timeline.map((entry) => entry.stropheIndex), indices);
  assert.ok(recording.samples.length > 0);
  assert.ok(recording.timeline[1].startSeconds >= recording.timeline[0].endSeconds + 0.099);

  const generated = assembleAudioSegments([
    { stropheIndex: 7, samples: new Float32Array(160).fill(0.5) },
    { stropheIndex: 3, samples: new Float32Array(80).fill(-0.25) },
  ], 16_000, { gapSeconds: 0.05 });
  assert.equal(generated.samples.length, 160 + 800 + 80);
  assert.deepEqual(generated.timeline.map((entry) => entry.stropheIndex), [7, 3]);
  assert.ok(Math.abs(generated.samples[0]) < 0.01, "segment entrances are faded");
  assert.ok(Math.abs(generated.samples.at(-1)) < 0.01, "segment exits are faded");
});

test("the portable export keeps similarity distinct from observed succession", () => {
  const route = [2, 6, 1];
  const exported = nightingaleManifoldExport(analysis, route, {
    source: "local test",
    rule: "hybrid",
    listenMode: "physical",
    seed: 7,
  });
  assert.equal(exported.format, "morphazoid-nightingale-strophe-manifold");
  assert.deepEqual(exported.route.indices, route);
  assert.deepEqual(exported.route.ids, ["S003", "S007", "S002"]);
  assert.equal(exported.edges.observedSuccession.length, 17);
  assert.equal(exported.tones.length, analysis.tones.length);
  assert.equal(exported.edges.acousticSimilarity.length, analysis.similarityEdges.length);
  assert.match(exported.disclaimer, /pause-bounded occurrences/i);
  assert.match(exported.disclaimer, /only sequence edges/i);
  assert.equal(NIGHTINGALE_MANIFOLD_LIMITS.maximumDurationSeconds, 45);
});
