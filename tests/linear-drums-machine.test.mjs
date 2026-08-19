import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PAINT_MACHINE_LAYER_DEFAULTS,
  createPaintMachineDemo,
  paintMachineApplyModulators,
  paintMachineDistanceToItem,
  paintMachineFrequency,
  paintMachineIntersections,
  paintMachineLoopDurationMs,
  paintMachineLoopPhase,
  paintMachinePhaseCrossed,
  sanitizePaintItem,
  simplifyPaintPoints,
} from "../src/linear-drums-machine.js";
import { sanitizeLinearDrumSettings } from "../src/linear-drums.js";

const root = new URL("../", import.meta.url);

test("painted drum-machine time wraps and crosses events deterministically", () => {
  assert.equal(paintMachineLoopDurationMs(120, 8), 4_000);
  assert.equal(paintMachineLoopPhase(2_000, 0, 120, 8), .5);
  assert.equal(paintMachineLoopPhase(5_000, 0, 120, 8), .25);
  assert.equal(paintMachinePhaseCrossed(.1, .3, .2), true);
  assert.equal(paintMachinePhaseCrossed(.9, .1, .98), true);
  assert.equal(paintMachinePhaseCrossed(.9, .1, .05), true);
  assert.equal(paintMachinePhaseCrossed(.9, .1, .5), false);
});

test("solid hits, freehand strokes, and ring outlines expose vertical intersections", () => {
  const hit = sanitizePaintItem({ type: "hit", x: .3, y: .7, radius: .02 });
  assert.deepEqual(paintMachineIntersections(hit, .3), [.7]);
  assert.deepEqual(paintMachineIntersections(hit, .4), []);

  const stroke = sanitizePaintItem({
    type: "stroke",
    points: [{ x: .1, y: .2 }, { x: .5, y: .8 }, { x: .9, y: .4 }],
  });
  assert.ok(Math.abs(paintMachineIntersections(stroke, .3)[0] - .5) < 1e-6);
  assert.ok(Math.abs(paintMachineIntersections(stroke, .7)[0] - .6) < 1e-6);

  const ring = sanitizePaintItem({
    type: "ring", x: .5, y: .5, radiusX: .2, radiusY: .3,
  });
  assert.deepEqual(paintMachineIntersections(ring, .5), [.2, .8]);
  assert.equal(paintMachineIntersections(ring, .7).length, 1);
  assert.deepEqual(paintMachineIntersections(ring, .8), []);
});

test("paint geometry sanitizes, simplifies, and remains erasable", () => {
  const points = simplifyPaintPoints([
    { x: 0, y: 0 }, { x: .001, y: .001 }, { x: .5, y: .5 }, { x: 1, y: 1 },
  ], .01);
  assert.deepEqual(points, [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]);
  const item = sanitizePaintItem({
    id: "ring", type: "ring", layer: 99, x: 4, y: -3, radiusX: 0, radiusY: 8,
  });
  assert.equal(item.layer, PAINT_MACHINE_LAYER_DEFAULTS.length - 1);
  assert.equal(item.x, 1);
  assert.equal(item.y, 0);
  assert.equal(item.radiusX, .006);
  assert.equal(item.radiusY, .5);
  assert.ok(paintMachineDistanceToItem(item, { x: .994, y: 0 }, 1) < .01);
});

test("modulator layers bend normalized synth parameters and override preset maps", () => {
  const settings = sanitizeLinearDrumSettings({
    hardness: .2,
    brightness: .8,
    parameterMaps: {
      hardness: { enabled: true, source: "pitch", low: .1, high: .9, curve: 0 },
    },
  });
  const result = paintMachineApplyModulators(settings, [
    { target: "hardness", value: .9, amount: .75 },
    { target: "brightness", value: .15, amount: -1 },
  ]);
  assert.ok(result.hardness > settings.hardness);
  assert.ok(result.brightness > settings.brightness);
  assert.equal(result.parameterMaps.hardness.enabled, false);
  assert.equal(settings.parameterMaps.hardness.enabled, true);
});

test("the starter painting contains notes, glisses, rings, and modulation", () => {
  const items = createPaintMachineDemo();
  assert.ok(items.some(({ type }) => type === "hit"));
  assert.ok(items.some(({ type }) => type === "stroke"));
  assert.ok(items.some(({ type }) => type === "ring"));
  assert.ok(items.some(({ layer }) => layer === 3));
  for (const item of items) {
    const intersections = paintMachineIntersections(item, .5);
    assert.ok(intersections.every((value) => value >= 0 && value <= 1));
  }
  assert.equal(paintMachineFrequency(0, 20, 16_000), 20);
  assert.equal(paintMachineFrequency(1, 20, 16_000), 16_000);
});

test("the painted drum-machine page exposes its complete editing surface", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("linear-drums-machine.html", root), "utf8"),
    readFile(new URL("linear-drums-machine-app.js", root), "utf8"),
    readFile(new URL("linear-drums-machine.css", root), "utf8"),
  ]);
  assert.match(html, /id="paintStage"/);
  assert.match(html, /data-paint-tool="hit"/);
  assert.match(html, /data-paint-tool="stroke"/);
  assert.match(html, /data-paint-tool="ring"/);
  assert.match(html, /data-paint-tool="erase"/);
  assert.match(html, /id="layerRoleVoice"/);
  assert.match(html, /id="layerRoleMod"/);
  assert.match(html, /id="layerPreset"/);
  assert.match(html, /id="modTarget"/);
  assert.match(app, /new LinearDrumAudio\(globalThis\)/);
  assert.match(app, /paintMachineIntersections/);
  assert.match(app, /paintMachineApplyModulators/);
  assert.match(app, /pointerdown/);
  const transport = app.slice(
    app.indexOf("function startPlayback()"),
    app.indexOf("function pausePlayback()", app.indexOf("function startPlayback()")),
  );
  assert.doesNotMatch(transport, /enableAudio|setAudioState|audio\.start/);
  assert.match(transport, /playing silently\. Turn Audio on to hear it/);
  assert.match(app, /if \(!state\.audioOn \|\| !audio\.context\) return;/);
  assert.match(app, /state\.previousPhase = phase;[\s\S]*state\.lastGlissAt = now;/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
