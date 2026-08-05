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

function metricRecord(scene) {
  return Object.fromEntries(scene.metrics());
}

function ricochetArena(scene) {
  const closedPolylines = [];
  const painter = {
    width: 900,
    height: 700,
    scale: 300,
    center: { x: 450, y: 350 },
    toScreen: ({ x, y }) => ({ x: 450 + x * 300, y: 350 - y * 300 }),
    fromScreen: ({ x, y }) => ({ x: (x - 450) / 300, y: (350 - y) / 300 }),
    line() {},
    polyline(points, options = {}) {
      if (options.close) closedPolylines.push(points.map((point) => ({ ...point })));
    },
    circle() {},
    text() {},
    arrow() {},
  };
  scene.draw(painter);
  assert.ok(closedPolylines.length, "Ricochet must render its closed arena");
  return closedPolylines.reduce((longest, points) => (
    points.length > longest.length ? points : longest
  ), []);
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function edgeLengths(points) {
  return points.map((point, index) => pointDistance(point, points[(index + 1) % points.length]));
}

function hasReflexVertex(points) {
  const turns = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    return (point.x - previous.x) * (next.y - point.y)
      - (point.y - previous.y) * (next.x - point.x);
  }).filter((turn) => Math.abs(turn) > 1e-7);
  return turns.some((turn) => turn > 0) && turns.some((turn) => turn < 0);
}

function pointerPoint(point, time, previous = point) {
  return {
    ...point,
    dx: point.x - previous.x,
    dy: point.y - previous.y,
    time,
    pointerId: 1,
  };
}

function firstRicochetImpact(scene, maximumSteps = 2400) {
  scene.consumeEvents();
  for (let index = 0; index < maximumSteps; index += 1) {
    scene.step(1 / 120);
    const impact = scene.consumeEvents().find((event) => event.key.startsWith("tine-"));
    if (impact) return { impact, metrics: metricRecord(scene) };
  }
  assert.fail("Ricochet should strike an arena edge within the test interval");
}

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

test("Ricochet exposes editable asymmetric arenas, rotation, launch velocity, and multiball spawning", () => {
  const scene = createPhysicsScene("ricochet");
  const controls = new Map(scene.controls.map((control) => [control.key, control]));
  const presetValues = controls.get("preset").options.map((option) => option.value ?? option);

  assert.deepEqual(presetValues, ["regular", "asymmetric", "star", "tunnel"]);
  for (const key of [
    "sides",
    "rotation",
    "rotationSpeed",
    "launchVelocity",
    "launchAngle",
    "restitution",
    "trail",
  ]) {
    assert.ok(controls.has(key), `Ricochet must expose ${key}`);
  }
  assert.equal(controls.has("speed"), false, "launch velocity replaces the ambiguous speed control");
  assert.equal(scene.state.preset, "regular");
  assert.equal(scene.state.sides, 6);
  assert.equal(scene.state.rotationSpeed, 0);
  assert.equal(scene.state.launchVelocity, 0.78);
  assert.equal(scene.primaryActionLabel, "Spawn ball");

  const regular = ricochetArena(scene);
  assert.equal(regular.length, 6, "the familiar regular hexagon remains the default");

  scene.setParam("preset", "asymmetric");
  const asymmetric = ricochetArena(scene);
  const asymmetricEdges = edgeLengths(asymmetric);
  assert.ok(
    Math.max(...asymmetricEdges) - Math.min(...asymmetricEdges) > 0.04,
    "the asymmetric preset must not collapse to a regular polygon",
  );

  scene.setParam("preset", "star");
  const star = ricochetArena(scene);
  assert.ok(hasReflexVertex(star), "the star preset needs inward-facing corners");

  scene.setParam("preset", "tunnel");
  const tunnel = ricochetArena(scene);
  assert.ok(hasReflexVertex(tunnel), "the tunnel preset needs a genuinely concave channel");
  assert.notDeepEqual(tunnel, star, "star and tunnel presets must produce different arenas");

  scene.reset();
  scene.setParam("launchVelocity", 1.6);
  for (let index = 0; index < 20; index += 1) scene.primaryAction();
  assert.equal(Number(metricRecord(scene).Balls), 12, "ball spawning is capped at the shared 12-ball design limit");
  assert.equal(scene.voices().length, 12, "each spawned ball remains independently audible");
  assert.ok(Number(metricRecord(scene).Fastest) >= 1.59, "spawned balls use the selected launch velocity");
});

test("Ricochet geometry can be edited while balls move and an interior drag launches a new ball", () => {
  const scene = createPhysicsScene("ricochet");
  scene.step(1 / 120);
  const before = ricochetArena(scene);
  const ballCount = Number(metricRecord(scene).Balls);

  const vertex = before[0];
  const movedVertex = { x: vertex.x * 0.82, y: vertex.y * 0.82 };
  scene.pointerDown(pointerPoint(vertex, 1));
  scene.step(1 / 120);
  scene.pointerMove(pointerPoint(movedVertex, 1.1, vertex));
  const vertexRelease = scene.pointerUp(pointerPoint(movedVertex, 1.2, movedVertex));
  const afterMove = ricochetArena(scene);
  assert.notEqual(vertexRelease, true, "editing a vertex must not request transport auto-start");
  assert.equal(afterMove.length, before.length);
  assert.ok(pointDistance(afterMove[0], movedVertex) < 0.025, "the grabbed vertex follows the pointer");
  assert.equal(Number(metricRecord(scene).Balls), ballCount, "editing geometry preserves balls in flight");

  const edgeMidpoint = {
    x: (afterMove[1].x + afterMove[2].x) / 2,
    y: (afterMove[1].y + afterMove[2].y) / 2,
  };
  const insertedPoint = { x: edgeMidpoint.x * 0.88, y: edgeMidpoint.y * 0.88 };
  scene.pointerDown(pointerPoint(edgeMidpoint, 2));
  scene.pointerMove(pointerPoint(insertedPoint, 2.1, edgeMidpoint));
  const edgeRelease = scene.pointerUp(pointerPoint(insertedPoint, 2.2, insertedPoint));
  const afterInsert = ricochetArena(scene);
  assert.notEqual(edgeRelease, true, "inserting a vertex must not request transport auto-start");
  assert.equal(afterInsert.length, afterMove.length + 1, "pressing an edge inserts a live-editable vertex");
  assert.equal(Number(metricRecord(scene).Balls), ballCount);

  const aimStart = { x: 0.28, y: -0.16 };
  const aimEnd = { x: 0.48, y: -0.04 };
  scene.pointerDown(pointerPoint(aimStart, 3));
  scene.pointerMove(pointerPoint(aimEnd, 3.1, aimStart));
  const launchRelease = scene.pointerUp(pointerPoint(aimEnd, 3.2, aimEnd));
  assert.equal(launchRelease, true, "releasing an aimed interior ball requests transport auto-start");
  assert.equal(Number(metricRecord(scene).Balls), ballCount + 1);
});

test("Ricochet rotates its arena at the selected angular speed without changing its shape", () => {
  const scene = createPhysicsScene("ricochet");
  scene.setParam("preset", "asymmetric");
  const before = ricochetArena(scene);
  const lengthsBefore = edgeLengths(before);

  scene.setParam("rotationSpeed", 72);
  for (let index = 0; index < 120; index += 1) scene.step(1 / 120);
  const after = ricochetArena(scene);
  const lengthsAfter = edgeLengths(after);

  assert.ok(
    before.some((point, index) => pointDistance(point, after[index]) > 0.1),
    "nonzero rotation speed must visibly turn the arena during simulation",
  );
  assert.deepEqual(
    lengthsAfter.map((value) => Number(value.toFixed(6))),
    lengthsBefore.map((value) => Number(value.toFixed(6))),
    "arena rotation must be rigid",
  );
});

test("Ricochet tine strikes map incidence to free pitch and impact velocity to amplitude", () => {
  const slowScene = createPhysicsScene("ricochet");
  slowScene.setParam("launchVelocity", 0.3);
  const slow = firstRicochetImpact(slowScene);

  const fastScene = createPhysicsScene("ricochet");
  fastScene.setParam("launchVelocity", 1.8);
  const fast = firstRicochetImpact(fastScene);

  for (const result of [slow, fast]) {
    const incidence = Number.parseFloat(result.metrics.Incidence);
    assert.ok(Number.isFinite(incidence));
    assert.ok(result.impact.key.startsWith("tine-"), "edge contacts are modeled as tine strikes");
    assert.ok(
      Math.abs(result.impact.pitch01 - incidence / 90) < 0.015,
      "the collision pitch follows normalized incidence angle rather than wall identity",
    );
  }
  assert.ok(
    fast.impact.gain > slow.impact.gain + 0.15,
    "a faster impact must produce a materially louder tine strike",
  );
  assert.ok(sceneMappingIncludes(fastScene, "Incidence angle", "pitch"));
  assert.ok(sceneMappingIncludes(fastScene, "Impact velocity", "amplitude"));
});

function sceneMappingIncludes(scene, source, targetFragment) {
  return scene.mappings.some(([mappingSource, mappingTarget]) => (
    mappingSource === source && mappingTarget.toLowerCase().includes(targetFragment.toLowerCase())
  ));
}
