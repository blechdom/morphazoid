import assert from "node:assert/strict";
import test from "node:test";
import { RUBIX_FACE_ROLES, RubixStickerMixer, createRubixDynamics } from "../src/instruments/rubix/rubix-mix.js";
import { createRubixSequenceSnapshot, createSolvedRubixCube, rubixReadFrame } from "../src/instruments/rubix/rubix.js";
import { createRubixVisibilityProfile, rubixUncoveredAreas } from "../src/instruments/rubix/rubix-visibility.js";
import { normalizeRubixDrumBuffer } from "../src/instruments/rubix/rubix-percussion.js";

const rect = (x, y, width, height) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
const tile = (id, points, extra = {}) => ({ sticker: { id }, points, ...extra });

test("uncovered area subtracts foreground paint and clips the actual viewport", () => {
  const geometry = [
    tile("back", rect(0, 0, 10, 10)),
    tile("front", rect(5, 0, 10, 10)),
    tile("offscreen", rect(20, 20, 10, 10)),
  ];
  assert.deepEqual(Object.fromEntries(rubixUncoveredAreas(geometry, { width: 10, height: 10 })), {
    offscreen: 0, front: 50, back: 50,
  });
  assert.deepEqual(createRubixVisibilityProfile([
    tile("hidden", rect(0, 0, 10, 10)),
    tile("front", rect(0, 0, 10, 10)),
  ], { width: 10, height: 10 }), { front: 1, hidden: 0 });
});

test("a foreground plastic base also hides the sound behind it; fans are unions", () => {
  const geometry = [
    tile("back", rect(0, 0, 10, 10)),
    tile("front", rect(2, 2, 6, 6), {
      baseSurface: { triangles: [{ visible: true, points: rect(0, 0, 10, 10) }] },
    }),
  ];
  assert.equal(rubixUncoveredAreas(geometry).get("back"), 0);
  const fan = [{
    sticker: { id: "fold" },
    projectedTriangles: [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }],
    ],
  }];
  assert.equal(rubixUncoveredAreas(fan).get("fold"), 50, "overlapping triangles count once");
});

test("camera orientation never changes the six continuously running score lanes", () => {
  for (const size of [2, 3, 6]) {
    const cube = createSolvedRubixCube(size);
    const a = createRubixSequenceSnapshot(cube);
    const b = createRubixSequenceSnapshot(cube, { x: -30, y: 135, z: 0 });
    assert.deepEqual(a.faceLanes, b.faceLanes);
    assert.equal(Object.values(a.faceLanes).flat().length, size * size * 6);
    const played = new Set();
    for (let step = 0; step < size * size; step += 1) {
      for (const lane of Object.values(a.faceLanes)) played.add(lane[step].id);
    }
    assert.equal(played.size, cube.stickers.length);
    for (let step = 0; step < 3; step += 1) {
      const roles = rubixReadFrame("face", step, size * size).activeRoles;
      assert.equal(Object.values(RUBIX_FACE_ROLES).filter((role) => roles.includes(role)).length, 2);
    }
  }
});

function fakeParam(value = 0) {
  return {
    value, events: [],
    cancelAndHoldAtTime(time) { this.events.push(["hold", time]); },
    linearRampToValueAtTime(target, time) { this.events.push(["ramp", target, time]); },
  };
}
function fakeContext() {
  return {
    currentTime: 2,
    createGain() { return { gain: fakeParam(), connect() {}, disconnect() { this.disconnected = true; } }; },
  };
}

test("live sticker gates affect existing tails and lookahead, reuse nodes and reach exact zero", () => {
  const context = fakeContext();
  const mixer = new RubixStickerMixer(context);
  const bus = {};
  mixer.update({ a: 1, b: 0.25 });
  const a = mixer.destination("a", bus);
  const b = mixer.destination("b", bus);
  const hidden = mixer.destination("hidden", bus);
  assert.equal(mixer.destination("a", bus), a);
  assert.equal(a.gain.value, 1);
  assert.equal(b.gain.value, 0.25);
  assert.equal(hidden.gain.value, 0);
  mixer.update({ a: 0, b: 1, hidden: 0.4 });
  assert.deepEqual(a.gain.events.at(-1), ["ramp", 0, 2.012]);
  assert.deepEqual(b.gain.events.at(-1), ["ramp", 1, 2.012]);
  assert.deepEqual(hidden.gain.events.at(-1), ["ramp", 0.4, 2.012]);
  const count = b.gain.events.length;
  mixer.update({ a: 0, b: 1, hidden: 0.4 });
  assert.equal(b.gain.events.length, count, "unchanged frames must not restart smoothing");
  mixer.dispose();
  assert.ok(a.disconnected && b.disconnected && hidden.disconnected);
  assert.equal(mixer.gates.size, 0);
});

test("compression preserves quiet linear output and has a bounded symmetric safety stage", () => {
  const context = {
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createDynamicsCompressor: () => Object.fromEntries([
      ...["threshold", "knee", "ratio", "attack", "release"].map((key) => [key, { value: 0 }]),
      ["connect", () => {}],
    ]),
    createWaveShaper: () => ({}),
  };
  const { compressor, makeup, output } = createRubixDynamics(context);
  assert.equal(makeup.gain.value, 2.8, "fixed makeup is separate from performer volume");
  assert.ok(compressor.threshold.value <= -20);
  assert.ok(compressor.ratio.value >= 4);
  assert.equal(output.curve[2048], 0);
  assert.equal(output.curve[2560], 0.25);
  assert.ok([...output.curve].every((value) => Number.isFinite(value) && Math.abs(value) < 0.8));
});

test("kit attack normalization is finite, bounded and leaves an exact silent tail", () => {
  const samples = Float32Array.from({ length: 4800 }, (_, i) => i === 1 ? NaN : Math.sin(i * 0.1) * 3);
  const buffer = { length: samples.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples };
  normalizeRubixDrumBuffer(buffer);
  assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.651));
  assert.equal(samples.at(-1), 0);
});
