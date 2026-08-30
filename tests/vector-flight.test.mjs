import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FLIGHT_ARTICULATIONS,
  circularPitchAmount,
  circularPlayheadRadius,
  createFlightStar,
  flightTierForThrottle,
  mapFlightContact,
  plaidAmountForThrottle,
  projectFlightStar,
  projectedKinematics,
  radialPlayheadCrossing,
  recycleFlightStar,
  seededRandom,
  stepFlightStar,
  trailLengthForThrottle,
  travelSpeedForThrottle,
} from "../src/vector-flight.js";

test("throttle progresses continuously from vector points through full-circle plaid", () => {
  assert.equal(flightTierForThrottle(0).id, "vector");
  assert.equal(flightTierForThrottle(25).id, "vector");
  assert.equal(flightTierForThrottle(26).id, "attack");
  assert.equal(flightTierForThrottle(54).id, "hyper");
  assert.equal(flightTierForThrottle(78).id, "ludicrous");
  assert.equal(flightTierForThrottle(94).id, "plaid");
  assert.ok(travelSpeedForThrottle(90) > travelSpeedForThrottle(40));
  assert.ok(trailLengthForThrottle(80) > trailLengthForThrottle(30));
  assert.equal(plaidAmountForThrottle(92), 0);
  assert.equal(plaidAmountForThrottle(100), 1);
});

test("seeded stars are deterministic and occupy every quadrant around the ship", () => {
  const firstRandom = seededRandom(1979);
  const secondRandom = seededRandom(1979);
  const first = Array.from({ length: 96 }, (_, index) => createFlightStar(index, firstRandom));
  const second = Array.from({ length: 96 }, (_, index) => createFlightStar(index, secondRandom));
  assert.deepEqual(first, second);
  const quadrants = new Set(first.map((star) => `${star.x < 0 ? "L" : "R"}${star.y < 0 ? "T" : "B"}`));
  assert.deepEqual(quadrants, new Set(["LT", "RT", "LB", "RB"]));
  for (const star of first) {
    assert.ok(Number.isFinite(star.theta));
    assert.ok(star.radius >= 0.18 && star.radius <= 1.08);
    assert.ok(star.z >= 0.025 && star.z <= 1.08);
  }
});

test("recycling preserves star identity and clears its circular-contact latch", () => {
  const star = createFlightStar(12, seededRandom(4), 0.2);
  star.contacted = true;
  recycleFlightStar(star, seededRandom(8), 1.05);
  assert.equal(star.id, 12);
  assert.equal(star.z, 1.05);
  assert.equal(star.contacted, false);
});

test("near stars project farther from the centered ship in every direction", () => {
  const viewport = { width: 1_000, height: 700, centerX: 500, centerY: 350 };
  for (const [x, y] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
    const star = { x, y, z: 0.9 };
    const far = projectFlightStar(star, viewport);
    const near = projectFlightStar({ ...star, z: 0.22 }, viewport);
    assert.ok(
      Math.hypot(near.x - viewport.centerX, near.y - viewport.centerY)
        > Math.hypot(far.x - viewport.centerX, far.y - viewport.centerY),
    );
  }
});

test("projection remains circular at the four cardinals on a rectangular stage", () => {
  const viewport = { width: 1_200, height: 720, centerX: 600, centerY: 360 };
  const depth = 0.42;
  const right = projectFlightStar({ x: 1, y: 0, z: depth }, viewport);
  const bottom = projectFlightStar({ x: 0, y: 1, z: depth }, viewport);
  const left = projectFlightStar({ x: -1, y: 0, z: depth }, viewport);
  const top = projectFlightStar({ x: 0, y: -1, z: depth }, viewport);
  const offsets = [
    right.x - viewport.centerX,
    bottom.y - viewport.centerY,
    viewport.centerX - left.x,
    viewport.centerY - top.y,
  ];
  for (const offset of offsets.slice(1)) {
    assert.ok(Math.abs(offset - offsets[0]) < 1e-9);
  }
  assert.equal(right.y, viewport.centerY);
  assert.equal(bottom.x, viewport.centerX);
  assert.equal(left.y, viewport.centerY);
  assert.equal(top.x, viewport.centerX);
});

test("projected kinematics separates outward, inward, and tangential motion", () => {
  const center = { x: 20, y: -30 };
  const outward = projectedKinematics(
    { x: 70, y: -30 },
    { x: 80, y: -30 },
    center,
    0.1,
  );
  const inward = projectedKinematics(
    { x: 80, y: -30 },
    { x: 70, y: -30 },
    center,
    0.1,
  );
  const tangent = projectedKinematics(
    { x: 20 + Math.cos(-0.2) * 50, y: -30 + Math.sin(-0.2) * 50 },
    { x: 20 + Math.cos(0.2) * 50, y: -30 + Math.sin(0.2) * 50 },
    center,
    0.1,
  );

  assert.ok(outward.radialVelocity > 0);
  assert.ok(inward.radialVelocity < 0);
  assert.ok(Math.abs(outward.tangentialVelocity) < 1e-9);
  assert.ok(Math.abs(inward.tangentialVelocity) < 1e-9);
  assert.ok(Math.abs(tangent.radialVelocity) < 1e-9);
  assert.ok(tangent.tangentialVelocity > 0);
});

test("projected kinematics is invariant under rotation about its center", () => {
  const center = { x: 17, y: -9 };
  const previous = { x: 61, y: 3 };
  const current = { x: 68, y: 19 };
  const angle = 1.137;
  const rotate = (point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  };
  const original = projectedKinematics(previous, current, center, 1 / 120);
  const rotated = projectedKinematics(rotate(previous), rotate(current), center, 1 / 120);

  assert.ok(Math.abs(rotated.radialVelocity - original.radialVelocity) < 1e-9);
  assert.ok(Math.abs(rotated.tangentialVelocity - original.tangentialVelocity) < 1e-9);
});

test("a fast segment cannot tunnel through the circular playhead", () => {
  const crossing = radialPlayheadCrossing(
    { x: 0, y: 20 },
    { x: 0, y: 180 },
    { sensorRadius: 100, orbitLobes: 1, orbitDepth: 0 },
  );
  assert.ok(crossing);
  assert.equal(crossing.amount, 0.5);
  assert.equal(crossing.x, 0);
  assert.equal(crossing.y, 100);
  assert.equal(
    radialPlayheadCrossing(
      { x: 0, y: 180 },
      { x: 0, y: 20 },
      { sensorRadius: 100, orbitLobes: 1, orbitDepth: 0 },
    ),
    null,
    "inward motion does not retrigger an outward flight contact",
  );
  assert.equal(
    radialPlayheadCrossing(
      { x: 120, y: 0 },
      { x: 180, y: 0 },
      { sensorRadius: 100, orbitLobes: 1, orbitDepth: 0 },
    ),
    null,
  );
});

test("circular crossing includes exact outward boundary endpoints once", () => {
  const geometry = { sensorRadius: 100, orbitLobes: 1, orbitDepth: 0 };
  const arriving = radialPlayheadCrossing(
    { x: 99, y: 0 },
    { x: 100, y: 0 },
    geometry,
  );
  const departing = radialPlayheadCrossing(
    { x: 100, y: 0 },
    { x: 101, y: 0 },
    geometry,
  );

  assert.ok(arriving);
  assert.equal(arriving.amount, 1);
  assert.ok(departing);
  assert.equal(departing.amount, 0);
  assert.equal(
    radialPlayheadCrossing({ x: 100, y: 0 }, { x: 100, y: 0 }, geometry),
    null,
  );
  assert.equal(
    radialPlayheadCrossing({ x: 101, y: 0 }, { x: 100, y: 0 }, geometry),
    null,
  );
});

test("rotating contours cross correctly when heading wraps through minus pi", () => {
  const point = { x: 100, y: 0 };
  const crossing = radialPlayheadCrossing(point, point, {
    previousHeading: -Math.PI + 0.1,
    currentHeading: Math.PI - 0.1,
    sensorRadius: 100,
    orbitLobes: 1,
    orbitPhase: 0,
    orbitDepth: 0.2,
  });

  assert.ok(crossing);
  assert.ok(Math.abs(crossing.amount - 0.5) < 1e-12);
  assert.ok(Math.abs(Math.abs(crossing.localAngle) - Math.PI) < 1e-12);
});

test("circular pitch and playhead patterns are seamless at minus and plus pi", () => {
  for (const lobes of [1, 2, 3, 5, 8]) {
    assert.ok(Math.abs(
      circularPitchAmount(-Math.PI, { lobes, phase: 0.37 })
        - circularPitchAmount(Math.PI, { lobes, phase: 0.37 }),
    ) < 1e-12);
    assert.ok(Math.abs(
      circularPlayheadRadius(100, -Math.PI, { lobes, phase: 0.37 })
        - circularPlayheadRadius(100, Math.PI, { lobes, phase: 0.37 }),
    ) < 1e-12);
  }
});

test("geometry maps directly to continuous frequency, stereo, proximity, and Doppler", () => {
  const settings = {
    centerX: 0,
    centerY: 0,
    heading: -Math.PI / 2,
    sensorRadius: 100,
    sensorWidth: 30,
    orbitLobes: 3,
    orbitPhase: 0.2,
    orbitDepth: 0,
    minimumFrequency: 47,
    maximumFrequency: 2_333,
    radialVelocity: 0.8,
    brightness: 0.9,
    doppler: 0.75,
    stereoWidth: 1,
  };
  const rightInside = mapFlightContact({ id: 1, x: 95, y: 0 }, settings);
  const rightOutside = mapFlightContact({ id: 1, x: 105, y: 0 }, settings);
  const leftInside = mapFlightContact({ id: 2, x: -95, y: 0 }, settings);
  assert.ok(rightInside.frequency > rightOutside.frequency, "approach bends above recede");
  assert.ok(rightInside.frequency >= 20 && rightInside.frequency <= 20_000);
  assert.ok(rightInside.proximity > 0 && rightInside.proximity <= 1);
  assert.ok(rightInside.pan > 0);
  assert.ok(leftInside.pan < 0);
  assert.ok(Math.abs(Math.abs(rightInside.pan) - Math.abs(leftInside.pan)) < 1e-12);
  assert.notEqual(rightInside.baseFrequency, Math.round(rightInside.baseFrequency), "pitch remains unquantized");
});

test("star motion is monotone in depth and responds continuously to field spin", () => {
  const star = createFlightStar(2, seededRandom(22), 0.8);
  const beforeZ = star.z;
  const beforeTheta = star.theta;
  stepFlightStar(star, 1 / 60, travelSpeedForThrottle(72), { fieldSpin: 0.2, steeringCurl: 0.4 });
  assert.ok(star.z < beforeZ);
  assert.notEqual(star.theta, beforeTheta);
  assert.equal(star.previousZ, beforeZ);
});

test("Vector Flight exposes geometry articulations and retires score controls", async () => {
  const html = await readFile(new URL("../vector-flight.html", import.meta.url), "utf8");
  for (const articulation of FLIGHT_ARTICULATIONS) {
    assert.match(html, new RegExp(`<option value="${articulation}"`));
    assert.match(html, new RegExp(`data-articulation="${articulation}"`));
  }
  assert.match(html, /id="flightButton"[\s\S]*?aria-keyshortcuts="Space"/);
  assert.doesNotMatch(html, /id="flightButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="sensorRadius"/);
  assert.match(html, /id="orbitLobes"/);
  assert.match(html, /SHIP = PLAYHEAD \/ STAR FIELD = INSTRUMENT/);
  assert.doesNotMatch(html, /id="(?:rootNote|scale|scoreSummary|metricNotes|captureWidth)"/);
});

test("manual browser hook reports a permanently centered ship and mode switching", async () => {
  const app = await readFile(new URL("../vector-flight-app.js", import.meta.url), "utf8");
  assert.match(app, /globalThis\.__VECTOR_FLIGHT__/);
  assert.match(app, /setMode\(value\)/);
  assert.match(app, /ship: \{ x: 0\.5, y: 0\.5/);
  assert.match(app, /radialPlayheadCrossing\(/);
  assert.doesNotMatch(app, /noteForStar|rootMidi|state\.scale|crossingX|didCrossPlayhead/);
});
