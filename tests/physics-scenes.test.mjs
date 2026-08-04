import assert from "node:assert/strict";
import test from "node:test";

import {
  PHYSICS_SCENES,
  createPhysicsScene,
} from "../src/physics-scenes.js";

const EXPECTED_SCENES = [
  "gravity-walk",
  "ricochet",
  "rigidity",
  "rolling-measure",
  "falling-forms",
  "charge-garden",
  "packing-pressure",
  "geodesic-drift",
  "kinetic-hull",
];

test("physics registry exposes all nine named Morphazoid experiments", () => {
  assert.deepEqual(PHYSICS_SCENES.map((scene) => scene.id), EXPECTED_SCENES);
  assert.equal(new Set(PHYSICS_SCENES.map((scene) => scene.title)).size, EXPECTED_SCENES.length);
});

test("every physics scene remains finite under deterministic fixed stepping", () => {
  for (const id of EXPECTED_SCENES) {
    const first = createPhysicsScene(id);
    const second = createPhysicsScene(id);
    first.reset();
    second.reset();
    assert.deepEqual(first.metrics(), second.metrics(), `${id} reset should be deterministic`);

    for (let step = 0; step < 360; step += 1) {
      first.step(1 / 120);
      if (step % 20 === 0) first.consumeEvents();
    }

    const voices = first.voices();
    assert.ok(Array.isArray(voices), `${id} voices must be an array`);
    assert.ok(voices.length <= 24, `${id} must stay within the shared voice pool`);
    for (const voice of voices) {
      assert.ok(Number.isFinite(voice.pitch01), `${id} pitch must be finite`);
      assert.ok(voice.pitch01 >= 0 && voice.pitch01 <= 1, `${id} pitch must be normalized`);
      assert.ok(Number.isFinite(voice.gain), `${id} gain must be finite`);
      assert.ok(voice.gain >= 0 && voice.gain <= 1, `${id} gain must be normalized`);
      assert.ok(Number.isFinite(voice.pan), `${id} pan must be finite`);
      assert.ok(voice.pan >= -1 && voice.pan <= 1, `${id} pan must be normalized`);
    }

    const metrics = first.metrics();
    assert.ok(Array.isArray(metrics) || (metrics && typeof metrics === "object"), `${id} needs live metrics`);
    assert.equal(typeof first.description, "string");
    assert.equal(typeof first.instruction, "string");
    assert.equal(typeof first.lesson, "string");
    assert.ok(Array.isArray(first.mappings));
  }
});

test("scene controls are accepted and resettable without leaking non-finite state", () => {
  for (const id of EXPECTED_SCENES) {
    const scene = createPhysicsScene(id);
    scene.reset();
    for (const control of scene.controls ?? []) {
      if (control.type === "range") {
        scene.setParam(control.key, (Number(control.min) + Number(control.max)) / 2);
      } else if (control.type === "toggle") {
        scene.setParam(control.key, !Boolean(control.value));
      } else if (control.type === "select" && control.options?.length) {
        const option = control.options.at(-1);
        scene.setParam(control.key, typeof option === "object" ? option.value : option);
      }
    }
    scene.step(1 / 120);
    scene.reset();
    for (const value of Object.values(scene.state ?? {})) {
      if (typeof value === "number") assert.ok(Number.isFinite(value), `${id} reset state must remain finite`);
    }
  }
});

test("every scene renders through the shared painter and accepts direct manipulation", () => {
  for (const id of EXPECTED_SCENES) {
    let marks = 0;
    const painter = {
      width: 900,
      height: 700,
      scale: 300,
      center: { x: 450, y: 350 },
      toScreen: ({ x, y }) => ({ x: 450 + x * 300, y: 350 - y * 300 }),
      fromScreen: ({ x, y }) => ({ x: (x - 450) / 300, y: (350 - y) / 300 }),
      line() { marks += 1; },
      polyline() { marks += 1; },
      circle() { marks += 1; },
      text() { marks += 1; },
      arrow() { marks += 1; },
    };
    const scene = createPhysicsScene(id);
    scene.reset();
    scene.draw(painter);
    assert.ok(marks > 0, `${id} must render visible geometry`);
    const point = { x: 0.05, y: 0.05, dx: 0, dy: 0, time: 1, pointerId: 1 };
    scene.pointerDown?.(point);
    scene.pointerMove?.({ ...point, x: 0.12, dx: 0.07, time: 1.1 });
    scene.pointerUp?.({ ...point, x: 0.15, dx: 0.03, time: 1.2 });
    scene.step(1 / 120);
    for (const voice of scene.voices()) {
      assert.ok(Number.isFinite(voice.pitch01), `${id} pointer interaction must preserve finite pitch`);
      assert.ok(Number.isFinite(voice.gain), `${id} pointer interaction must preserve finite gain`);
      assert.ok(Number.isFinite(voice.pan), `${id} pointer interaction must preserve finite pan`);
    }
  }
});
