import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAIN_MS, IDENTITY_ORIENTATION, MARBLE_RADIUS, MAX_GRAIN_MS, MIN_GRAIN_MS,
  ORBIT_SECONDS, PICKUP_REACH, SLICE_CELLS, SOURCE_COUNT, collectSweep,
  coordinatesOf, coveredSources, cutRibbon, floorRemaining,
  grainHit, grainSizeFor, laneAt, needleLatitudeAt, needleNormalAt, needleRadius, normalAt,
  phaseAt, playRadius, playerOrientation, rollOrientation, rollPlayPose,
  rotateNormal, zoneContains,
  zoneContainsNormal, zoneSurfacePoint,
} from "../src/instruments/globule-damacy/model.js";
import {
  PLAY_PRESETS, RECORD_PRESETS, matchingPreset,
} from "../src/instruments/globule-damacy/presets.js";

test("rolling collects many independent surface zones from all eight sounds, not loop-shaped source stripes", () => {
  const roll = collectSweep([], { phase: .15, lane: 0 }, { phase: .86, lane: 7 },
    IDENTITY_ORIENTATION, .85);
  assert.ok(roll.added.length > 80);
  assert.equal(coveredSources(roll.added), SOURCE_COUNT);
  assert.notDeepEqual(roll.orientation, IDENTITY_ORIENTATION);
  assert.ok(Math.abs(Math.hypot(...roll.orientation) - 1) < 1e-12);
  assert.equal(MARBLE_RADIUS, 44);
  assert.equal(PICKUP_REACH, .9, "the marble keeps one nearby-lane pickup footprint");
  assert.equal(DEFAULT_GRAIN_MS, 100);
  assert.equal(collectSweep(roll.added, { phase: .15, lane: 0 }, { phase: .86, lane: 7 },
    roll.orientation, .85).added.length, 0);
  assert.ok(new Set(roll.added.map(ribbon => ribbon.key)).size === roll.added.length);
  assert.ok(roll.added.every(ribbon => ribbon.cell >= 0 && ribbon.cell < SLICE_CELLS
    && ribbon.latitude >= 0 && ribbon.latitude <= 7 && ribbon.angle >= 0 && ribbon.angle < 1
    && Math.abs(Math.hypot(...ribbon.normal) - 1) < 1e-12
    && ribbon.angularRadius >= .015 && ribbon.angularRadius <= .031
    && ribbon.latitudeRadius >= .38 && ribbon.latitudeRadius <= .8
    && ribbon.grainMs === DEFAULT_GRAIN_MS));
  assert.deepEqual(roll, collectSweep([], { phase: .15, lane: 0 }, { phase: .86, lane: 7 },
    IDENTITY_ORIENTATION, .85));
  const firstSource = roll.added.filter(zone => zone.sourceIndex === 0);
  assert.ok(Math.max(...firstSource.map(zone => zone.latitude))
    - Math.min(...firstSource.map(zone => zone.latitude)) > 2,
  "grains from one source scatter over the sphere instead of making a latitude stripe");
  let crowded = roll.added;
  let orientation = roll.orientation;
  for (let lane = 0; lane < SOURCE_COUNT; lane++) {
    const more = collectSweep(crowded, { phase: 0, lane }, { phase: 1, lane },
      orientation);
    crowded = crowded.concat(more.added);
    orientation = more.orientation;
  }
  assert.ok(crowded.length > 640, "the old 640-grain cutoff is gone");
  assert.equal(floorRemaining(crowded), SOURCE_COUNT * SLICE_CELLS - crowded.length);
  const bottomlessBall = Array.from({ length: 10_000 }, (_, index) => ({ key: -index - 1 }));
  const fresh = collectSweep(bottomlessBall, { phase: .2, lane: 2 }, { phase: .4, lane: 3 });
  assert.ok(fresh.added.length > 0, "a heavily covered ball still collects new floor material");
  assert.deepEqual(fresh, collectSweep([], { phase: .2, lane: 2 }, { phase: .4, lane: 3 }),
    "prior grain count cannot change roll orientation, contact reach, or zone size");
  const full = Array.from({ length: SOURCE_COUNT * SLICE_CELLS }, (_, key) => ({ key }));
  assert.equal(floorRemaining(full), 0);
  const exhausted = collectSweep(full, { phase: .1, lane: 2 }, { phase: .8, lane: 5 });
  assert.equal(exhausted.added.length, 0);
  assert.notDeepEqual(exhausted.orientation, IDENTITY_ORIENTATION,
    "the same-sized marble still rolls over a bare floor");
  const replenished = [8, 1, 2, 3, 4, 5, 6, 7];
  assert.equal(floorRemaining(full, replenished), SLICE_CELLS);
  const newSound = collectSweep(full, { phase: .5, lane: 0 }, { phase: .5, lane: 0 },
    IDENTITY_ORIENTATION, PICKUP_REACH, DEFAULT_GRAIN_MS, replenished);
  assert.deepEqual(newSound.added.map(grain => grain.key), [8 * SLICE_CELLS + 80],
    "replacing one exhausted ribbon lays collectible material without removing old zones");
  assert.equal(floorRemaining(full.concat(newSound.added), replenished), SLICE_CELLS - 1);
  assert.throws(() => collectSweep([], { phase: NaN, lane: 0 }, { phase: 1, lane: 1 }),
    /Invalid globule roll/);
  assert.throws(() => collectSweep([], { phase: .1, lane: 0 },
    { phase: .2, lane: 0 }, [0, 0, 0, 0]), /Invalid globule roll/);
  assert.throws(() => collectSweep([], { phase: .1, lane: 0 },
    { phase: .2, lane: 0 }, IDENTITY_ORIENTATION, PICKUP_REACH, DEFAULT_GRAIN_MS,
    Array(8).fill(0)), /Invalid globule roll/);
});

test("two-axis rolling marks both poles and turns corners without changing the marble's radius", () => {
  const across = collectSweep([], { phase: .1, lane: 2 }, { phase: .9, lane: 2 });
  const down = collectSweep(across.added, { phase: .9, lane: 2 }, { phase: .9, lane: 6 },
    across.orientation);
  const painted = across.added.concat(down.added);
  const back = collectSweep(painted, { phase: .9, lane: 6 }, { phase: .1, lane: 6 },
    down.orientation);
  const all = painted.concat(back.added);
  assert.ok(all.some(grain => grain.normal[1] > .98),
    "a roll across a new meridian can mark the north pole");
  assert.ok(all.some(grain => grain.normal[1] < -.98),
    "the south pole is not excluded from pickup");
  assert.ok(Math.abs(back.orientation[1]) > .01,
    "turning a corner changes the axis and creates a non-equatorial pose");
  const xThenZ = rollOrientation(rollOrientation(IDENTITY_ORIENTATION, 40, 0, 40), 0, 40, 40);
  const zThenX = rollOrientation(rollOrientation(IDENTITY_ORIENTATION, 0, 40, 40), 40, 0, 40);
  assert.notDeepEqual(xThenZ, zThenX, "marble rotations about different axes do not commute");
  const reverse = rollOrientation(rollOrientation(xThenZ, 0, -40, 40), -40, 0, 40);
  assert.ok(reverse.every((value, index) => Math.abs(value - IDENTITY_ORIENTATION[index]) < 1e-12));
});

test("the Play marble follows screen gestures and motors around a horizontal roll, not a face spin", () => {
  const front = normalAt(0, 3.5), radius = 100;
  const right = rotateNormal(rollPlayPose(IDENTITY_ORIENTATION, 60, 0, radius), front);
  const down = rotateNormal(rollPlayPose(IDENTITY_ORIENTATION, 0, 60, radius), front);
  assert.ok(right[0] > .5 && Math.abs(right[1]) < 1e-12,
    "moving right carries the marble's front paint right rather than spinning around the tip");
  assert.ok(down[1] < -.5 && Math.abs(down[0]) < 1e-12,
    "moving down carries front paint down, the same direction as Record");
  assert.ok(Math.abs(Math.hypot(...rollPlayPose(IDENTITY_ORIENTATION, 60, 40, radius)) - 1) < 1e-12);
  const xThenY = rollPlayPose(rollPlayPose(IDENTITY_ORIENTATION, 60, 0, radius), 0, 60, radius);
  const yThenX = rollPlayPose(rollPlayPose(IDENTITY_ORIENTATION, 0, 60, radius), 60, 0, radius);
  assert.notDeepEqual(xThenY, yThenX, "turning a corner accumulates a free 3D roll");
  const returned = rollPlayPose(rollPlayPose(xThenY, 0, -60, radius), -60, 0, radius);
  assert.ok(returned.every((value, index) => Math.abs(value - IDENTITY_ORIENTATION[index]) < 1e-12));
  assert.equal(playRadius(1000, 600), MARBLE_RADIUS * 3.9);
  assert.equal(playRadius(320, 500), 96);
  assert.throws(() => rollPlayPose(IDENTITY_ORIENTATION, 1, 1, 0), /Invalid globule play roll/);

  const motor = rotateNormal(playerOrientation(IDENTITY_ORIENTATION, .125, 3.5, 0), front);
  assert.ok(motor[1] < -.7 && Math.abs(motor[0]) < 1e-12,
    "automatic playback rolls the ball downwards rather than yawing like a turntable");
  for (const [phase, pole] of [[.25, normalAt(0, 0)], [.75, normalAt(0, 7)]]) {
    const facing = rotateNormal(playerOrientation(IDENTITY_ORIENTATION, phase, 3.5, 0), pole);
    assert.ok(facing.every((value, index) => Math.abs(value - front[index]) < 1e-12),
      "both poles cross the stationary needle during one motor roll");
  }
  assert.equal(needleLatitudeAt(0, 3.5, .68), 3.5);
  assert.deepEqual(playerOrientation(IDENTITY_ORIENTATION, 0, 3.5, .68),
    IDENTITY_ORIENTATION, "Play opens at the recorded pose before starting the motor");
});

test("grain size changes owned PCM duration and spherical footprint, without resizing past grains", () => {
  const source = {
    sampleRate: 8000,
    channels: [Float32Array.from({ length: 8000 }, (_, frame) => Math.sin(frame / 7) * .4)],
  };
  const first = cutRibbon(source, 1), later = cutRibbon(source, 38);
  assert.equal(first.duration, .1);
  assert.notDeepEqual(first.channels[0], later.channels[0]);
  const captured = first.channels[0][300];
  source.channels[0].fill(0);
  assert.equal(first.channels[0][300], captured);
  assert.ok(first.channels[0].every(Number.isFinite));
  assert.equal(cutRibbon(source, 1, MIN_GRAIN_MS).channels[0].length, 320);
  assert.equal(cutRibbon(source, 1, MAX_GRAIN_MS).channels[0].length, 1920);
  const at = { phase: .5, lane: 0 };
  const tiny = collectSweep([], at, at, IDENTITY_ORIENTATION, PICKUP_REACH, MIN_GRAIN_MS).added[0];
  const broad = collectSweep([], at, at, IDENTITY_ORIENTATION, PICKUP_REACH, MAX_GRAIN_MS).added[0];
  assert.deepEqual(tiny.normal, broad.normal);
  assert.ok(broad.angularRadius > tiny.angularRadius * 2);
  assert.ok(broad.latitudeRadius > tiny.latitudeRadius * 2);
  assert.equal(tiny.grainMs, MIN_GRAIN_MS);
  assert.equal(broad.grainMs, MAX_GRAIN_MS);
  assert.equal(zoneContainsNormal(broad, broad.normal), true);
  assert.throws(() => cutRibbon(source, 0, 300), /bounded decoded/);
  assert.throws(() => cutRibbon({ sampleRate: 8000, channels: [new Float32Array(20)] }, 0),
    /bounded decoded/);
});

test("random pickup sizes are keyed to each new floor cell and change BOTH cut length and contact", () => {
  const start = { phase: .2, lane: 2 };
  const end = { phase: .8, lane: 5 };
  const fixed = collectSweep([], start, end);
  const random = collectSweep([], start, end, IDENTITY_ORIENTATION, PICKUP_REACH,
    150, Array.from({ length: SOURCE_COUNT }, (_, index) => index), "random", 90);
  assert.deepEqual(random, collectSweep([], start, end, IDENTITY_ORIENTATION,
    PICKUP_REACH, 150, Array.from({ length: SOURCE_COUNT }, (_, index) => index), "random", 90));
  assert.deepEqual(random.orientation, fixed.orientation);
  assert.ok(new Set(random.added.map(grain => grain.grainMs)).size >= 5);
  assert.ok(random.added.every(grain => grain.grainMs >= MIN_GRAIN_MS
    && grain.grainMs <= MAX_GRAIN_MS && grain.grainMs % 10 === 0));
  assert.ok(random.added.some((grain, index) => grain.angularRadius
    !== fixed.added[index].angularRadius));
  assert.deepEqual(random.added.map(grain => grain.normal), fixed.added.map(grain => grain.normal),
    "random size does not alter the rolling physics or spot centers");
  const source = { sampleRate: 8000, channels: [new Float32Array(8000).fill(.25)] };
  for (const grain of random.added.slice(0, 20)) {
    const copy = cutRibbon(source, grain.cell, grain.grainMs);
    assert.equal(copy.channels[0].length, grain.grainMs * 8);
    assert.equal(copy.duration, grain.grainMs / 1000);
  }
  assert.equal(grainSizeFor(random.added[0].key, 140), 140);
  assert.equal(grainSizeFor(12, 140, "random", 0), 140);
  assert.notEqual(grainSizeFor(12, 140, "random", 90),
    grainSizeFor(13, 140, "random", 90));
  assert.throws(() => grainSizeFor(12, 140, "random", 101), /Invalid globule grain size/);
  assert.throws(() => collectSweep([], start, end, IDENTITY_ORIENTATION,
    PICKUP_REACH, 150, Array.from({ length: 8 }, (_, index) => index), "shuffle"),
  /Invalid globule roll/);
});

test("Record and Play presets cover their own musical controls without storing audio or motion", () => {
  assert.ok(RECORD_PRESETS.length >= 3 && PLAY_PRESETS.length >= 3);
  assert.equal(matchingPreset(RECORD_PRESETS, RECORD_PRESETS[0]), RECORD_PRESETS[0].id);
  assert.equal(matchingPreset(PLAY_PRESETS, PLAY_PRESETS[0]), PLAY_PRESETS[0].id);
  assert.equal(matchingPreset(RECORD_PRESETS, { ...RECORD_PRESETS[0], grainMs: 120 }), "custom");
  assert.equal(matchingPreset(PLAY_PRESETS, { ...PLAY_PRESETS[0], speed: 1.4 }), "custom");
  assert.equal(matchingPreset(PLAY_PRESETS, { ...PLAY_PRESETS[0], needleWidth: 100 }), "custom",
    "needle width is an expressive Play preset parameter");
  assert.ok(RECORD_PRESETS.some(preset => preset.grainMode === "random"));
  assert.ok(PLAY_PRESETS.some(preset => preset.direction === -1));
  assert.ok(PLAY_PRESETS.some(preset => preset.needle !== 3.5));
  assert.ok(PLAY_PRESETS.some(preset => preset.needleWidth >= 80)
    && PLAY_PRESETS.some(preset => preset.needleWidth <= 10),
  "Play presets include wide collage and fine single-zone pickup");
  for (const preset of [...RECORD_PRESETS, ...PLAY_PRESETS]) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(!["playing", "audioOn", "ribbons", "sources", "position", "phase", "level"]
      .some(key => key in preset), "presets never own the ball, external Audio or transport");
  }
});

test("a needle triggers only real zone intersections, through overlap and the longitude seam", () => {
  const zone = {
    key: 7, angle: .99, latitude: 3.5, angularRadius: .02,
    latitudeRadius: .6, tilt: 0, shapeSeed: .25,
  };
  assert.equal(zoneContains(zone, .99, 3.5), true);
  assert.equal(zoneContains(zone, .003, 3.5), true, "spot straddles the seam");
  assert.equal(zoneContains(zone, .1, 3.5), false, "empty space has no nearest fallback");
  assert.equal(zoneContains(zone, .99, 6), false, "a different latitude misses");
  assert.equal(zoneContains(zone, .01, 3.5), false, "a fine tip misses the spot's edge");
  assert.equal(zoneContains(zone, .01, 3.5, needleRadius(100)), true,
    "a wide needle mouth can touch a grain missed by its center");
  assert.equal(needleLatitudeAt(.37, 3.5, 0), 3.5);
  assert.notEqual(needleLatitudeAt(.37, 3.5, 1), 3.5);
  assert.equal(needleRadius(0), 0);
  assert.ok(needleRadius(100) > needleRadius(30));
  assert.equal(needleRadius(101), needleRadius(100), "contact radius is bounded");
  assert.equal(zoneContains(zone, .1, 3.5, needleRadius(100)), false,
    "even the widest mouth never reads unrelated glass");
  const neighboringZone = { ...zone, angle: .035, key: 8 };
  const distantZone = { ...zone, angle: .17, key: 9 };
  const probe = normalAt(.99, 3.5);
  const narrow = [zone, neighboringZone, distantZone].filter(grain =>
    zoneContainsNormal(grain, probe, needleRadius(0)));
  const wide = [zone, neighboringZone, distantZone].filter(grain =>
    zoneContainsNormal(grain, probe, needleRadius(100)));
  assert.deepEqual(narrow.map(grain => grain.key), [7]);
  assert.deepEqual(wide.map(grain => grain.key), [7, 8],
    "increasing physical mouth width reads more independent sounds at once");
  const hits = Array.from({ length: 40 }, (_, step) => grainHit(zone, .8, step));
  assert.deepEqual(hits, Array.from({ length: 40 }, (_, step) => grainHit(zone, .8, step)));
  assert.ok(hits.some(hit => hit.reverse) && hits.some(hit => hit.rate !== 1));
  assert.ok(hits.every(hit => hit.rate >= .72 && hit.rate <= 1.28 && Math.abs(hit.pan) <= .62));
  assert.equal(grainHit(zone, 0, 0).rate, 1);
  assert.equal(grainHit(zone, 0, 0).reverse, false);
  assert.equal(grainHit(zone, 0, 0, -1).reverse, true);
  assert.equal(phaseAt({ phase: .25, anchorMs: 0, playing: false, speed: 1 }, 3000), .25);
  assert.ok(phaseAt({ phase: .25, anchorMs: 0, playing: true, speed: 1 }, ORBIT_SECONDS * 250) > .49);
  assert.ok(phaseAt({ phase: .25, anchorMs: 0, playing: true, speed: 1, direction: -1 },
    ORBIT_SECONDS * 250) < .01, "reverse spin crosses the seam without changing stored PCM");
  assert.equal(laneAt(2, .25), laneAt(2, .5),
    "the floor audio stays straight even though the sphere has scattered zones");
});

test("pole contact is independent of longitude and painting uses the same spherical footprint", () => {
  const pole = {
    key: 3, angle: .2, latitude: 0, normal: normalAt(.2, 0),
    angularRadius: .023, latitudeRadius: .58, tilt: .16, shapeSeed: .33,
  };
  assert.equal(zoneContains(pole, .2, 0), true);
  assert.equal(zoneContains(pole, .8, 0), true, "all azimuths meet at the pole");
  assert.equal(zoneContains(pole, .8, 3.5), false);
  assert.equal(zoneContains(pole, .2, 7), false);
  assert.equal(zoneContains(pole, .8, .75), false);
  assert.equal(zoneContains(pole, .8, .75, needleRadius(100)), true,
    "a broad needle also reaches real polar zones without a longitude stripe");
  for (const [u, v] of [[0, 0], [.25, .18], [-.2, .31]]) {
    const painted = zoneSurfacePoint(pole, u, v);
    assert.equal(zoneContainsNormal(pole, painted), true,
      "the paint and audio scanner agree on a point within the patch");
  }
  const turned = rollOrientation(IDENTITY_ORIENTATION, 53, -36, 37);
  const world = rotateNormal(turned, pole.normal);
  assert.ok(coordinatesOf(world).latitude > 1, "Record can move a polar mark off its original pole");
  const distance = Math.hypot(world[0], world[1]), angle = Math.acos(world[2]);
  const steering = rollPlayPose(IDENTITY_ORIENTATION,
    -world[0] * angle * 37 / distance, world[1] * angle * 37 / distance, 37);
  assert.equal(zoneContainsNormal(pole, needleNormalAt(turned, 0, 3.5, 0, steering)), true,
    "a free Play roll moves the recorded polar grain under the fixed straw");
  assert.equal(zoneContainsNormal(pole, needleNormalAt(turned, .5, 3.5, 0, steering)), false);
  const fixedTip = normalAt(0, 3.5);
  const moved = rollPlayPose(IDENTITY_ORIENTATION, 45, -33, 37);
  for (const pose of [IDENTITY_ORIENTATION, turned]) {
    for (const phase of [0, .13, .51, .99, 1.37]) {
      for (const height of [0, 1.5, 3.5, 6, 7]) {
        for (const sway of [0, .68, 1]) {
          for (const manual of [IDENTITY_ORIENTATION, moved]) {
            const ball = playerOrientation(pose, phase, height, sway, manual);
            const probe = needleNormalAt(pose, phase, height, sway, manual);
            const painted = rotateNormal(ball, probe);
            assert.ok(painted.every((axis, index) => Math.abs(axis - fixedTip[index]) < 1e-12),
              "the needle remains at the front through manual steering, tilt, sway and either pole");
            const onPrint = coordinatesOf(rotateNormal(pose, probe));
            const reprojected = normalAt(onPrint.angle, onPrint.latitude);
            const recorded = rotateNormal(pose, probe);
            assert.ok(reprojected.every((axis, index) => Math.abs(axis - recorded[index]) < 1e-12),
              "the print shows the same sphere location as the audio reader");
          }
        }
      }
    }
  }
  assert.notDeepEqual(playerOrientation(turned, .13, 0),
    playerOrientation(turned, .13, 7), "Ball tilt rotates the marble, not the straw");
  assert.notDeepEqual(playerOrientation(turned, .37, 3.5),
    playerOrientation(turned, .37, 3.5, 1), "Ball sway also rotates the marble");
  for (const [height, polarNormal] of [[0, normalAt(0, 0)], [7, normalAt(0, 7)]]) {
    const facing = rotateNormal(playerOrientation(IDENTITY_ORIENTATION, 0, height),
      polarNormal);
    assert.ok(facing.every((axis, index) => Math.abs(axis - fixedTip[index]) < 1e-12),
      "either pole can face the same stationary pickup");
  }
});
