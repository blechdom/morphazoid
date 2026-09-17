import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SPECIMENS, VOICE_PRESETS, specimenState, voicePresetState } from "../src/throatazoid.js";
import { drawPhysicalTract } from "../src/families/tract/rendering.js";
import { createTractGeometryHarness } from "./helpers/tract-geometry-harness.mjs";
import { createTractRenderingHarness, recordTractDrawing } from "./helpers/tract-rendering-harness.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/tract-rendering-v1.json", import.meta.url)));
const geometryFixture = JSON.parse(await readFile(new URL("./fixtures/tract-geometry-v1.json", import.meta.url)));
const originalGeometry = createTractGeometryHarness(geometryFixture.records[0]);
const original = createTractRenderingHarness(fixture);
const pages = await Promise.all(Object.keys(fixture.sources).map(async (file) => {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const start = source.indexOf("function drawTractText(");
  const block = start < 0 ? "" : source.slice(start, source.indexOf("function drawVoidGeometry("));
  const wrapper = source.match(/^function drawPhysicalTract\([^\n]*\) \{[\s\S]*?\n\}/m)?.[0];
  assert.ok(wrapper, `${file}: missing draw wrapper`);
  return { file, harness: createTractRenderingHarness(fixture, block || wrapper) };
}));

const states = [
  ...Object.keys(VOICE_PRESETS).map((name) => ({ name: `voice:${name}`, state: voicePresetState(name) })),
  ...Object.keys(SPECIMENS).map((name) => ({
    name: `specimen:${name}`, state: { ...voicePresetState("clear"), ...specimenState(name) },
  })),
];
const viewports = [[1440, 900], [390, 844], [844, 390]];
const modes = [
  { time: 0, liveAlpha: 0, awake: false, reduced: true, aperture: 1, closure: 0 },
  { time: 234.5, liveAlpha: 0.65, awake: true, reduced: false, aperture: 0.32, closure: 0 },
  { time: 817.25, liveAlpha: 1, awake: true, reduced: false, aperture: 0.01, closure: 0.95 },
  { time: 1200, liveAlpha: 0.4, awake: true, reduced: true, aperture: 0.7, closure: 0.9 },
];

function makeScene(state, [cssWidth, cssHeight], mode, selected = false) {
  const performance = structuredClone(state);
  performance.articulationAperture = mode.aperture;
  performance.glottalClosure = mode.closure;
  performance.mutation = selected ? 0.9 : 0;
  performance.coupling = selected ? 0.6 : 0;
  performance.throats[0].muted = selected;
  performance.pressureSources[0].open = !selected;
  const selectedThroat = selected ? performance.throatCount - 1 : 0;
  originalGeometry.setScene(performance, { width: cssWidth, height: cssHeight, selectedThroat });
  const geometry = originalGeometry.call("tractGeometry");
  return {
    state: performance, performance, geometry,
    time: mode.time, liveAlpha: mode.liveAlpha, awake: mode.awake,
    view: {
      cssWidth, cssHeight, selectedThroat,
      selectedTongue: selected ? performance.tongueCount - 1 : 0,
      selectedNose: selected ? performance.noseCount - 1 : 0,
      sourcePressures: performance.pressureSources.map((_, i) => i % 2 ? 1.1 : -0.1),
      mouthPressures: performance.throats.map((_, i) => i * 0.23),
      tractPressure: selected ? 1.2 : 0.28,
      prefersReducedMotion: mode.reduced,
      pointerDrag: selected ? { type: "tract-constriction" } : { type: "tract-glottis" },
      burstFlashUntil: mode.time + (selected ? 75 : -1),
      burstFlashPlace: 0.8,
      keyboardPulse: {
        startedAt: mode.time - (selected ? 120 : 400),
        letter: "s", capital: selected, place: 0.4,
      },
    },
  };
}

const originalColorWithAlpha = Function(`return (${fixture.colorWithAlpha});`)();

function drawShared(scene, missing = []) {
  const { drawing, commands } = recordTractDrawing(missing);
  drawPhysicalTract(drawing, scene.geometry, scene.time, scene.liveAlpha, scene.performance, {
    ...scene.view,
    isAwake() { commands.push(["isAwake"]); return scene.awake; },
    colorWithAlpha(color, alpha) {
      commands.push(["colorWithAlpha", color, alpha]);
      // Independent frozen original conversion, not the new renderer.
      return originalColorWithAlpha(color, alpha);
    },
  });
  return commands;
}

test("shared tract rendering preserves exact Canvas commands for every voice/anatomy and view", () => {
  for (const { name, state } of states) {
    for (const viewport of viewports) {
      for (const mode of modes) {
        for (const selected of [false, true]) {
          const scene = makeScene(state, viewport, mode, selected);
          const before = structuredClone(scene);
          const expected = original.render(scene);
          const actual = drawShared(scene);
          assert.deepEqual(actual, expected, `${name}, ${viewport}, ${mode.time}, selected=${selected}`);
          assert.deepEqual(scene, before, "renderer does not mutate inputs, geometry or instrument state");
          assert.ok(actual.filter(([kind, name]) => kind === "call" && name === "stroke").length > 0);
          for (const command of actual) {
            for (const value of command) {
              if (typeof value === "number") assert.ok(Number.isFinite(value), "finite Canvas arguments");
            }
          }
          assert.equal(actual.filter(([, name]) => name === "save").length,
            actual.filter(([, name]) => name === "restore").length, "balanced Canvas state");
        }
      }
    }
  }
});

test("tract rendering preserves optional Canvas APIs, keyboard pulses and flash boundaries", () => {
  const missingSets = [[], ["scale"], ["roundRect"], ["createLinearGradient"],
    ["scale", "roundRect", "createLinearGradient"]];
  for (const missing of missingSets) {
    for (const age of [-1, 0, 149, 359, 360]) {
      for (const capital of [false, true]) {
        const scene = makeScene(voicePresetState("clear"), [679, 359], modes[1], true);
        scene.view.keyboardPulse.startedAt = scene.time - age;
        scene.view.keyboardPulse.capital = capital;
        scene.view.burstFlashUntil = scene.time + age;
        scene.view.pointerDrag = null;
        assert.deepEqual(drawShared(scene, missing), original.render(scene, { missing }),
          `missing=${missing}, age=${age}, capital=${capital}`);
      }
    }
  }
});

for (const { file, harness } of pages) {
  test(`${file}: current-state drawing and hit-test aliases match the original across repeated frames`, () => {
    for (const { state } of states) {
      for (const viewport of viewports) {
        for (const mode of modes) {
          const scene = makeScene(state, viewport, mode, true);
          assert.deepEqual(harness.render(scene), original.render(scene));
          // Visual performance may differ from persistent state during animation.
          scene.state = voicePresetState("clear");
          scene.view.selectedThroat = 0;
          scene.view.selectedTongue = 0;
          scene.view.selectedNose = 0;
          scene.time += 0.125;
          assert.deepEqual(harness.render(scene, { explicitPerformance: true }),
            original.render(scene, { explicitPerformance: true }));
        }
      }
    }
  });
}
