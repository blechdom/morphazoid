import assert from "node:assert/strict";
import test from "node:test";
import { createShapesState, projectShapesMotion } from "../src/instruments/shapes/shapes-state.js";
import { buildShapesScene } from "../src/instruments/shapes/shapes-scene.js";
import { originalCornerSample, originalCornerIntents } from "../src/instruments/shapes/original-audio.js";

// The original interpolation is deliberately retained as an independent
// reference: optimization must not remove markers or change their coordinates.
function referenceSample(state, scene) {
  const sample = originalCornerSample(state, scene);
  sample.vertices = [...scene.geometry.vertices];
  for (const [edgeIndex, edge] of scene.geometry.edges.entries()) {
    const a = scene.geometry.vertices[edge.a], b = scene.geometry.vertices[edge.b];
    for (let part = 1; part < state.play.divisions; part++) {
      const t = part / state.play.divisions;
      sample.vertices.push({
        ...Object.fromEntries(["x", "y", "z", ...(scene.dimension === "4d" ? ["w"] : [])]
          .map(axis => [axis, a[axis] + (b[axis] - a[axis]) * t])),
        edgeIndex, t,
      });
    }
  }
  return sample;
}

for (const [dimension, representation] of [["3d", "sphere"], ["4d", "hypersphere"], ["4d", "klein"]]) {
  test(`${dimension} ${representation}: all subdivision coordinates and events match the original interpolation`, () => {
    for (const divisions of [1, 2, 4, 16]) {
      const state = createShapesState({
        selection: { dimension, playingMode: "notes" },
        play: { running: true, continuousPhase: .1, rateCyclesPerSecond: .8, divisions },
        dimension: { [dimension]: { representation, rotationRunning: true } },
      });
      let previous, referencePrevious;
      for (let step = 0; step < 48; step++) {
        const projected = projectShapesMotion(state, step / 32), scene = buildShapesScene(projected);
        const actual = originalCornerSample(projected, scene), expected = referenceSample(projected, scene);
        assert.deepEqual(actual, expected, `divisions ${divisions}, step ${step}`);
        assert.deepEqual(originalCornerIntents(previous, actual, projected),
          originalCornerIntents(referencePrevious, expected, projected));
        previous = actual; referencePrevious = expected;
      }
    }
  });
}

for (const dimension of ["3d", "4d"]) {
  test(`${dimension}: reader-only motion reuses subdivision points without reallocating the full marker cloud`, () => {
    const state = createShapesState({
      selection: { dimension, playingMode: "notes" },
      play: { running: true, continuousPhase: .2, divisions: 16 },
      dimension: { [dimension]: { representation: dimension === "3d" ? "sphere" : "hypersphere" } },
    });
    const scene = buildShapesScene(state), first = originalCornerSample(state, scene);
    const saved = structuredClone(first.vertices), baseCount = scene.geometry.vertices.length;
    const projected = projectShapesMotion(state, .1), nextScene = buildShapesScene(projected);
    const second = originalCornerSample(projected, nextScene);
    assert.notEqual(first.phase, second.phase);
    assert.notStrictEqual(first.vertices, second.vertices, "each sample owns its list");
    assert.strictEqual(first.vertices[baseCount], second.vertices[baseCount], "unchanged interior geometry is reused");
    assert.deepEqual(second.vertices, referenceSample(projected, nextScene).vertices);

    // A genuine geometry edit must invalidate the cache, including in-place
    // edits to arrays already seen by the sampler.
    nextScene.geometry.vertices[0].x += .37;
    const changed = originalCornerSample(projected, nextScene);
    assert.notStrictEqual(changed.vertices[baseCount], second.vertices[baseCount]);
    assert.deepEqual(changed.vertices, referenceSample(projected, nextScene).vertices);
    assert.deepEqual(first.vertices.slice(baseCount), saved.slice(baseCount), "older scheduled points are never overwritten");
    nextScene.geometry.edges[0] = { ...nextScene.geometry.edges[0], b: 2 };
    assert.deepEqual(originalCornerSample(projected, nextScene).vertices, referenceSample(projected, nextScene).vertices);
    projected.play.divisions = 4;
    assert.deepEqual(originalCornerSample(projected, nextScene).vertices, referenceSample(projected, nextScene).vertices);
  });
}
