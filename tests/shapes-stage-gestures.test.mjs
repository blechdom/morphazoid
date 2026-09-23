import assert from "node:assert/strict";
import test from "node:test";
import { createShapesState } from "../src/instruments/shapes/shapes-state.js";
import { beginShapes3dRotation, pickShapes3dDragTarget, updateShapes3dRotation } from "../src/instruments/shapes/stage-gestures.js";

const diamond = Object.freeze([{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }, { x: 50, y: 50 }].map(Object.freeze));

test("3D picking distinguishes the projected outline from its bounding-box corners", () => {
  assert.equal(pickShapes3dDragTarget({ x: 50, y: 50 }, diamond), "reader");
  assert.equal(pickShapes3dDragTarget({ x: 25, y: 25 }, diamond), "reader");
  assert.equal(pickShapes3dDragTarget({ x: 5, y: 5 }, diamond), "shape");
  assert.equal(pickShapes3dDragTarget({ x: 150, y: 50 }, diamond), "shape");
  assert.equal(pickShapes3dDragTarget({ x: 108, y: 50 }, diamond), "reader", "outline tolerance supports touch");
  assert.equal(pickShapes3dDragTarget({ x: 108, y: 50 }, diamond, 0), "shape");
});

test("3D picking handles empty, thin and malformed outlines without mutating input", () => {
  assert.equal(pickShapes3dDragTarget({ x: 0, y: 0 }, []), "shape");
  assert.equal(pickShapes3dDragTarget({ x: NaN, y: 0 }, diamond), "shape");
  assert.equal(pickShapes3dDragTarget({ x: 40, y: 43 }, [{ x: 20, y: 20 }, { x: 60, y: 60 }]), "reader");
  assert.equal(pickShapes3dDragTarget({ x: 40, y: 43 }, [{ x: NaN, y: Infinity }]), "shape");
  assert.equal(pickShapes3dDragTarget({ x: 50, y: 50 }, diamond), "reader");
  assert.equal(diamond[0].y, 0);
});

function movingState() {
  return createShapesState({
    selection: { dimension: "3d" }, audio: { enabled: true, level: .4 },
    play: { running: true, continuousPhase: .37 },
    dimension: { "3d": { rotationMotion: Object.fromEntries(["readerYaw", "readerPitch", "x", "y", "z"].map(axis => [axis, { running: true, speed: .05 }])) } },
  });
}

for (const target of ["shape", "reader"]) test(`3D ${target} drag owns only its angles and preserves the other transports`, () => {
  const state = movingState(), before = structuredClone(state);
  const start = beginShapes3dRotation(state, target);
  assert.equal(updateShapes3dRotation(state, start, .1, .05), true);
  const local = state.dimension["3d"], old = before.dimension["3d"];
  if (target === "reader") {
    assert.equal(local.readerYaw, old.readerYaw + 24);
    assert.equal(local.readerPitch, old.readerPitch - 12);
    assert.deepEqual(local.rotation, old.rotation);
  } else {
    assert.equal(local.rotation.y, old.rotation.y + 24);
    assert.equal(local.rotation.x, old.rotation.x - 12);
    assert.equal(local.rotation.z, old.rotation.z);
    assert.equal(local.readerYaw, old.readerYaw);
    assert.equal(local.readerPitch, old.readerPitch);
  }
  for (const axis of ["x", "y", "z", "readerYaw", "readerPitch"]) {
    const paused = target === "reader" ? ["readerYaw", "readerPitch"] : ["x", "y"];
    assert.equal(local.rotationMotion[axis].running, !paused.includes(axis));
  }
  assert.deepEqual(state.play, before.play);
  assert.deepEqual(state.audio, before.audio);
  assert.deepEqual(state.dimension["2d"], before.dimension["2d"]);
  assert.deepEqual(state.dimension["4d"], before.dimension["4d"]);
});

test("3D drag angles wrap and stale/nonfinite gestures cannot corrupt state", () => {
  const state = movingState(); state.dimension["3d"].rotation.y = 179;
  const start = beginShapes3dRotation(state, "shape");
  updateShapes3dRotation(state, start, .05, 0);
  assert.equal(state.dimension["3d"].rotation.y, -169);
  const before = structuredClone(state);
  assert.equal(updateShapes3dRotation(state, start, Infinity, 0), false);
  assert.equal(updateShapes3dRotation(state, start, 1e308, 0), false);
  assert.deepEqual(state, before);
  state.selection.dimension = "4d";
  const other = structuredClone(state);
  assert.equal(beginShapes3dRotation(state, "reader"), null);
  assert.equal(updateShapes3dRotation(state, start, .2, .2), false);
  assert.deepEqual(state, other);
});
