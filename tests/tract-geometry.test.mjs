import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { currentSourcePath } from "./helpers/relocated-sources.mjs";

import {
  PHONEMES, SPECIMENS, VOICE_PRESETS, specimenState, voicePresetState,
} from "../src/throatazoid.js";
import {
  buildTractDiameterProfile, buildTractGeometry, interpolatePoint, tractPoint,
} from "../src/families/tract/geometry.js";
import { createTractGeometryHarness, pageGeometryFunctions } from "./helpers/tract-geometry-harness.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/tract-geometry-v1.json", import.meta.url)));
const original = createTractGeometryHarness(fixture.records[0]);
const pages = await Promise.all(fixture.records.map(async (record) => {
  const source = await readFile(new URL(`../${currentSourcePath(record.file)}`, import.meta.url), "utf8");
  return { record, source, current: createTractGeometryHarness(record, pageGeometryFunctions(source)) };
}));
const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 679, height: 359 },
  { width: 680, height: 360 },
  { width: 900.25, height: 600.75 },
];
const states = [
  ...Object.keys(VOICE_PRESETS).map((name) => ({ name: `voice:${name}`, state: voicePresetState(name) })),
  ...Object.keys(SPECIMENS).map((name) => ({
    name: `specimen:${name}`,
    state: { ...voicePresetState("clear"), ...specimenState(name) },
  })),
];

function directGeometry(state, scene, profile = null) {
  original.setScene(state, scene);
  const currentArticulationIndex = original.context.currentArticulationIndex;
  const perceptualNoseOpening = original.context.perceptualNoseOpening;
  return buildTractGeometry(state, profile, {
    cssWidth: scene.width,
    cssHeight: scene.height,
    selectedThroat: scene.selectedThroat,
    currentArticulationIndex,
    perceptualNoseOpening,
    tractDiameterProfile: (performance) => buildTractDiameterProfile(performance, {
      selectedThroat: scene.selectedThroat, currentArticulationIndex,
    }),
  });
}

test("tract geometry and Float32 profiles retain every voice/specimen across viewport and mouth selections", () => {
  for (const { name, state } of states) {
    const before = structuredClone(state);
    for (const viewport of viewports) {
      for (const selectedThroat of new Set([0, state.throatCount - 1, state.throatCount + 1])) {
        const scene = { ...viewport, selectedThroat };
        original.setScene(state, scene);
        const expected = original.call("tractGeometry");
        const actual = directGeometry(state, scene);
        assert.deepEqual(actual, expected, `${name}, ${JSON.stringify(scene)}`);
        assert.ok(Buffer.from(actual.diameters.buffer).equals(Buffer.from(expected.diameters.buffer)));
        assert.equal(actual.bodyHandles[1].handle, actual.manifold, "geometry aliases stay intact");
      }
    }
    assert.deepEqual(state, before, `${name}: geometry must not mutate instrument state`);
  }
});

for (const { record, current } of pages) {
  test(`${record.file}: wrappers always use current state, viewport, and selected mouth`, () => {
    for (const { name, state } of states) {
      for (const viewport of viewports) {
        const scene = { ...viewport, selectedThroat: state.throatCount - 1 };
        original.setScene(state, scene);
        current.setScene(state, scene);
        assert.deepEqual(current.call("tractDiameterProfile"), original.call("tractDiameterProfile"), name);
        assert.deepEqual(current.call("tractGeometry"), original.call("tractGeometry"), name);
      }
    }
    const first = voicePresetState("clear");
    const alternate = { ...first, ...specimenState("hydra") };
    for (const state of [first, alternate, first]) {
      const scene = { width: 777, height: 555, selectedThroat: state.throatCount - 1 };
      current.setScene(state, scene);
      original.setScene(state, scene);
      assert.deepEqual(current.call("tractGeometry"), original.call("tractGeometry"));
    }
  });
}

test("phoneme constrictions, closure, lip shaping, and mutation preserve the original profile", () => {
  for (const name of [...Object.keys(PHONEMES), "glottal", "sh", "custom"]) {
    for (const aperture of [0, 0.3, 0.91, 1]) {
      const state = {
        ...voicePresetState("clear"), ...specimenState("hydra"),
        phoneme: name, articulationAperture: aperture, articulationPlace: 0.73,
        lipDiameter: aperture === 0 ? 0.35 : 1.2, mutation: 0.91,
      };
      const scene = { width: 900, height: 600, selectedThroat: 6 };
      original.setScene(state, scene);
      assert.deepEqual(directGeometry(state, scene), original.call("tractGeometry"), `${name}:${aperture}`);
    }
  }
});

test("supplied animated diameters are copied and bypass profile recomputation", () => {
  const state = voicePresetState("clear");
  const scene = { width: 900, height: 600, selectedThroat: 0 };
  const profile = Float32Array.from({ length: 44 }, (_, i) => 0.5 + (i % 7) * 0.25);
  const before = Float32Array.from(profile);
  original.setScene(state, scene);
  const expected = original.call("tractGeometry", state, profile);
  const result = buildTractGeometry(state, profile, {
    cssWidth: scene.width, cssHeight: scene.height, selectedThroat: 0,
    currentArticulationIndex: original.context.currentArticulationIndex,
    perceptualNoseOpening: original.context.perceptualNoseOpening,
    tractDiameterProfile: () => { throw new Error("Animated profile must not be recomputed"); },
  });
  assert.deepEqual(result, expected);
  result.diameters[0] = 99;
  assert.deepEqual(profile, before);
  for (const { current } of pages) {
    current.setScene(state, scene);
    assert.deepEqual(current.call("tractGeometry", state, profile), expected);
  }
});

test("point interpolation and tract coordinates preserve boundaries and off-path offsets", () => {
  const state = voicePresetState("clear");
  original.setScene(state);
  const geometry = original.call("tractGeometry");
  for (const progress of [-1, 0, 0.01, 0.5, 0.999, 1, 2]) {
    for (const diameter of [-2, 0, 0.5, 3]) {
      assert.deepEqual(tractPoint(geometry, progress, diameter), original.call("tractPoint", geometry, progress, diameter));
    }
    for (const points of [[], [{ x: 1, y: 2 }], geometry.pathAnchors]) {
      assert.deepEqual(interpolatePoint(points, progress), original.call("interpolatePoint", points, progress));
    }
  }
});

test("both pages use the shared geometry while keeping state defaults in small page-owned wrappers", () => {
  for (const { record, source } of pages) {
    const functions = pageGeometryFunctions(source);
    assert.match(source, /from "\.\.\/\.\.\/families\/tract\/geometry\.js"/, record.file);
    assert.equal(functions.tractPoint, undefined);
    assert.equal(functions.interpolatePoint, undefined);
    assert.match(functions.tractDiameterProfile, /buildTractDiameterProfile\(performance,/);
    assert.match(functions.tractGeometry, /buildTractGeometry\(performance, diameterProfile,/);
    assert.match(functions.tractGeometry, /performance = state/);
    assert.ok(functions.tractGeometry.split("\n").length < 20);
  }
});
